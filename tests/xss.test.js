const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mindmapHtml = fs.readFileSync(path.join(root, 'MINDMAP.html'), 'utf8');

const PAYLOAD = '"><img src=x onerror="alert(1)"><script>alert(1)</script>';
const JS_URL = 'javascript:alert(1)';
const SVG_DATA = 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=';
const BAD_COLOR = 'red" onload="alert(1)';
const PNG_DATA = 'data:image/png;base64,iVBORw0KGgo=';

function appScript() {
    const start = indexHtml.search(/<script>\r?\n        \/\/ =/);
    const end = indexHtml.lastIndexOf('</script>');
    assert.ok(start > 0 && end > start);
    const openEnd = indexHtml.indexOf('>', start) + 1;
    const body = indexHtml.slice(openEnd, end).replace(/initDomainMove\(\);\r?\n\s*init\(\);/, '');
    return body + `
        window.__xssSet = function (state) {
            if ('cloudMapsCache' in state) cloudMapsCache = state.cloudMapsCache;
            if ('currentCloudUser' in state) currentCloudUser = state.currentCloudUser;
            if ('fbAuth' in state) fbAuth = state.fbAuth;
            if ('projectRegistry' in state) projectRegistry = state.projectRegistry;
            if ('nodes' in state) nodes = state.nodes;
            if ('canvasDecorations' in state) canvasDecorations = state.canvasDecorations;
            if ('canvasImageAssets' in state) canvasImageAssets = state.canvasImageAssets;
            if ('selectedDecorationId' in state) selectedDecorationId = state.selectedDecorationId;
            if ('selectedNodeId' in state) selectedNodeId = state.selectedNodeId;
            if ('isDesignSelectable' in state) isDesignSelectable = state.isDesignSelectable;
            if ('currentProjectId' in state) currentProjectId = state.currentProjectId;
            if ('activeLibraryTab' in state) activeLibraryTab = state.activeLibraryTab;
            if ('homeMapFilter' in state) homeMapFilter = state.homeMapFilter;
            if ('activeCollabMapId' in state) activeCollabMapId = state.activeCollabMapId;
            if ('activeCollabOwnerId' in state) activeCollabOwnerId = state.activeCollabOwnerId;
        };
    `;
}

function boot() {
    const dom = new JSDOM(`<!doctype html><html><body>
        <div id="app-homepage-view"></div>
        <div id="cloud-list-container"></div>
        <div id="modal-project-count"></div>
        <div id="home-maps-grid"></div>
        <input id="home-map-search" value="">
        <div id="share-members-list"></div>
        <div id="shared-list-container"></div>
        <div id="project-list-container"></div>
        <div id="canvas-decorations-back"></div>
        <div id="canvas-decorations-front"></div>
        <div id="nodes-container"></div>
        <svg id="edges-svg"></svg>
        <div id="attachment-preview"></div>
        <div id="attachment-preview-content"></div>
        <div id="cloud-user-avatar"></div>
        <div id="home-auth-widget"></div>
        <div id="cloud-user-name"></div>
        <div id="cloud-user-email"></div>
        <div id="canvas-bg"></div>
    </body></html>`, { url: 'https://omnimind.test/', runScripts: 'dangerously' });
    const { window } = dom;
    window.eval(fs.readFileSync(path.join(root, 'pro-config.js'), 'utf8'));
    window.eval(fs.readFileSync(path.join(root, 'js/mindmap-history.js'), 'utf8'));
    window.eval(appScript());
    return window;
}

function assertNoInjection(element, label) {
    assert.equal(element.querySelectorAll('script, iframe, object, embed').length, 0, label + ' injected element');
    element.querySelectorAll('img').forEach((img) => {
        assert.notEqual(img.getAttribute('src'), 'x', label + ' breakout img');
        assert.equal(/alert\s*\(/.test(img.getAttribute('onerror') || ''), false, label + ' img onerror');
    });
    element.querySelectorAll('*').forEach((el) => {
        [...el.attributes].forEach((attr) => {
            const name = attr.name.toLowerCase();
            const value = attr.value || '';
            if (name.startsWith('on')) {
                assert.equal(/alert\s*\(/.test(value), false, label + ' handler ' + name);
                assert.equal(value.includes('javascript:'), false, label + ' javascript url in ' + name);
            }
            if (name === 'src' || name === 'href') {
                assert.equal(/^\s*javascript:/i.test(value), false, label + ' ' + name);
                assert.equal(/data:image\/svg\+xml/i.test(value), false, label + ' svg ' + name);
            }
        });
    });
}

test('index.html and MINDMAP.html stay identical', () => {
    assert.equal(indexHtml, mindmapHtml);
});

test('sanitizers accept safe colors and image links and reject active content', () => {
    const window = boot();
    assert.equal(window.sanitizeColor('#3b82f6'), '#3b82f6');
    assert.equal(window.sanitizeColor('rgb(1, 2, 3)'), 'rgb(1, 2, 3)');
    assert.equal(window.sanitizeColor('rgba(1, 2, 3, 0.5)'), 'rgba(1, 2, 3, 0.5)');
    assert.equal(window.sanitizeColor('transparent'), 'transparent');
    assert.equal(window.sanitizeColor('Rebeccapurple'), 'rebeccapurple');
    assert.equal(window.sanitizeColor(BAD_COLOR), '');
    assert.equal(window.sanitizeImageUrl('https://cdn.example/a.png'), 'https://cdn.example/a.png');
    assert.equal(window.sanitizeImageUrl('blob:https://omnimind.test/11111111-1111-1111-1111-111111111111').startsWith('blob:'), true);
    assert.equal(window.sanitizeImageUrl(PNG_DATA), PNG_DATA);
    assert.equal(window.sanitizeImageUrl(SVG_DATA), '');
    assert.equal(window.sanitizeImageUrl(JS_URL), '');
    assert.equal(window.sanitizeLinkUrl('https://photos.example/a'), 'https://photos.example/a');
    assert.equal(window.sanitizeLinkUrl(JS_URL), '');
    assert.equal(window.sanitizeLinkUrl('blob:https://omnimind.test/x'), '');
    assert.equal(window.finiteNumber('12px;color:red', 4), 4);
    assert.equal(window.finiteNumber(12, 4), 12);
});

test('malicious map, decoration, and profile values do not inject handlers', () => {
    const window = boot();
    const evilId = PAYLOAD;
    window.__xssSet({
        fbAuth: {},
        activeLibraryTab: 'cloud',
        homeMapFilter: 'all',
        currentProjectId: 'local-1',
        currentCloudUser: {
            uid: 'owner',
            displayName: PAYLOAD,
            email: 'owner@example.com',
            photoURL: JS_URL,
            isAnonymous: false
        },
        cloudMapsCache: [{
            id: evilId,
            name: PAYLOAD,
            nodeCount: PAYLOAD,
            updatedAt: Date.now(),
            data: { nodes: {} }
        }],
        projectRegistry: {
            activeId: 'local-1',
            projects: [{ id: evilId, name: PAYLOAD, nodeCount: PAYLOAD, updatedAt: Date.now() }]
        },
        nodes: {
            root: {
                id: 'root',
                parentId: null,
                text: PAYLOAD,
                x: '10");alert(1)',
                y: 20,
                bg: BAD_COLOR,
                fg: BAD_COLOR,
                size: '16px;}</style><script>alert(1)</script>',
                attachment: SVG_DATA,
                attachmentOriginalUrl: JS_URL
            }
        },
        selectedNodeId: 'root',
        canvasImageAssets: {},
        canvasDecorations: {
            [evilId]: {
                id: evilId,
                type: 'image',
                src: JS_URL,
                fileName: PAYLOAD,
                x: '1");alert(1)',
                y: 2,
                width: '200</svg><script>alert(1)</script>',
                height: 80,
                bg: BAD_COLOR,
                borderStyle: 'solid; background: url(javascript:alert(1))',
                borderColor: BAD_COLOR,
                borderWidth: '2px; background:url(javascript:alert(1))',
                color: BAD_COLOR,
                fontSize: '14</style><script>alert(1)</script>',
                opacity: '1");alert(1)',
                zIndex: '3");alert(1)',
                rotation: '90");alert(1)',
                strokeWidth: '4");alert(1)',
                layer: 'front',
                arrowStyle: 'straight',
                title: PAYLOAD,
                text: PAYLOAD
            },
            arrow1: {
                id: 'arrow' + PAYLOAD,
                type: 'arrow',
                x: 10,
                y: 10,
                width: 200,
                height: 40,
                startX: 10,
                startY: 20,
                endX: 180,
                endY: 20,
                color: BAD_COLOR,
                strokeWidth: '9");alert(1)',
                title: PAYLOAD,
                layer: 'behind',
                zIndex: 1,
                arrowStyle: 'straight'
            }
        },
        selectedDecorationId: evilId,
        isDesignSelectable: true
    });
    window.localStorage.setItem('omnimind_shared_history', JSON.stringify([{
        id: evilId,
        ownerUid: evilId,
        ownerEmail: PAYLOAD,
        name: PAYLOAD,
        accessLevel: 'edit',
        allowCopy: true,
        nodeCount: PAYLOAD,
        updatedAt: Date.now()
    }]));

    window.updateCloudAuthUI();
    window.renderHomepage();
    window.renderCloudMapsList();
    window.renderHomepageMapsList();
    window.renderSharedMapsList();
    window.renderProjectList();
    window.renderShareMembersList([{ email: PAYLOAD, role: 'edit' }]);
    window.renderTree();
    window.updateAttachmentPreview();
    window.renderDecorations();
    window.selectedDecorationId = 'arrow' + PAYLOAD;
    window.__xssSet({ selectedDecorationId: 'arrow' + PAYLOAD });
    window.renderDecorations();

    const doc = window.document;
    [
        'cloud-user-avatar',
        'home-auth-widget',
        'cloud-list-container',
        'home-maps-grid',
        'shared-list-container',
        'project-list-container',
        'share-members-list',
        'nodes-container',
        'attachment-preview-content',
        'canvas-decorations-back',
        'canvas-decorations-front'
    ].forEach((id) => assertNoInjection(doc.getElementById(id), id));

    const avatar = doc.getElementById('cloud-user-avatar');
    assert.equal(avatar.querySelector('img'), null);
    const homeAvatar = doc.querySelector('#home-auth-widget img');
    assert.equal(homeAvatar, null);
    const bubbleImg = doc.querySelector('#nodes-container img');
    assert.equal(bubbleImg, null);
    const previewLink = doc.querySelector('#attachment-preview-content a');
    assert.equal(previewLink, null);
    const guideImg = doc.querySelector('#canvas-decorations-front img, #canvas-decorations-back img');
    if (guideImg) assert.equal(guideImg.getAttribute('src'), '');
    const arrowSvg = doc.querySelector('.arrow-svg-wrapper');
    assert.ok(arrowSvg);
    assert.equal(arrowSvg.querySelectorAll('script').length, 0);
    arrowSvg.querySelectorAll('*').forEach((el) => {
        [...el.attributes].forEach((attr) => {
            if (attr.name.toLowerCase().startsWith('on') && attr.name.toLowerCase() !== 'onmousedown') {
                assert.equal(/alert\s*\(/.test(attr.value || ''), false, attr.name);
            }
        });
    });
    const stroke = arrowSvg.querySelector('line, path, polygon');
    if (stroke) assert.equal(stroke.getAttribute('stroke') || stroke.getAttribute('fill'), '#3b82f6');
});
