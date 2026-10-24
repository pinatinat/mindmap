const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFunction(source, name) {
    const marker = 'function ' + name + '(';
    let start = source.indexOf(marker);
    if (start >= 6 && source.slice(start - 6, start) === 'async ') start -= 6;
    assert.notEqual(start, -1, name + ' is missing');
    const open = source.indexOf('{', start);
    let depth = 0;
    let quote = '';
    for (let i = open; i < source.length; i++) {
        const ch = source[i];
        if (quote) {
            if (ch === '\\') { i += 1; continue; }
            if (ch === quote) quote = '';
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error('unterminated ' + name);
}

test('opening the share modal does not write a view default', () => {
    assert.equal(html, fs.readFileSync(path.join(root, 'MINDMAP.html'), 'utf8'));
    const openShare = extractFunction(html, 'openShareModal');
    assert.equal(openShare.includes('handleShareSettingsChanged('), false);
    assert.match(openShare, /shareModalHydrating/);
    const viewRadio = html.match(/name="share-access-level" value="view"[^>]*>/);
    assert.ok(viewRadio, 'view access radio is missing');
    assert.equal(viewRadio[0].includes('checked'), false);
});

test('share settings persist lower-cased invite and editor emails only after an access level is chosen', () => {
    const save = extractFunction(html, 'handleShareSettingsChanged');
    assert.match(save, /if \(shareModalHydrating\) return;/);
    assert.match(save, /if \(!selectedAccess \|\| \['restricted', 'view', 'edit'\]\.indexOf\(selectedAccess\) < 0\) return;/);
    assert.match(save, /invitedEmails: roleEmails\.invitedEmails/);
    assert.match(save, /editorEmails: roleEmails\.editorEmails/);
    const normalize = extractFunction(html, 'normalizedShareRoleEmails');
    const fn = new Function(normalize + '\nreturn normalizedShareRoleEmails;')();
    const lists = fn([
        { email: 'Editor@Example.com', role: 'edit' },
        { email: ' viewer@example.com ', role: 'view' },
        { email: 'not-an-email', role: 'edit' },
        { email: 'editor@example.com', role: 'view' }
    ]);
    assert.deepEqual(lists.invitedEmails, ['editor@example.com', 'viewer@example.com']);
    assert.deepEqual(lists.editorEmails, ['editor@example.com']);
});

function classList(initial) {
    const names = new Set(initial || []);
    return {
        add() { Array.from(arguments).forEach(name => names.add(name)); },
        remove() { Array.from(arguments).forEach(name => names.delete(name)); },
        contains(name) { return names.has(name); },
        toggle(name, on) {
            const force = (on === undefined) ? !names.has(name) : !!on;
            if (force) names.add(name);
            else names.delete(name);
            return force;
        }
    };
}

test('a private map link shows a page instead of the rules error', () => {
    assert.match(html, /This map is private\. Ask the owner to share it with you\./);
    assert.match(html, />Go to my maps</);
    assert.match(html, /id="private-map-sign-in"/);
    const gate = extractFunction(html, 'showPrivateMapGate');
    const signedOut = extractFunction(html, 'shareViewerIsSignedOut');
    assert.equal(gate.includes('err.message'), false);
    const load = extractFunction(html, 'loadSharedMap');
    const catchAt = load.lastIndexOf('catch (err)');
    const catchBody = load.slice(catchAt);
    assert.match(catchBody, /if \(isSharePermissionError\(err\)\)/);
    assert.match(catchBody, /showPrivateMapGate\(\)/);
    assert.ok(catchBody.indexOf('isSharePermissionError') < catchBody.indexOf("alert('Could not load shared map:"));
    assert.equal(load.includes("alert('Could not load shared map: ' + err.message)"), true);

    const signIn = { id: 'private-map-sign-in', classList: classList(['hidden']) };
    const panel = { id: 'private-map-gate', classList: classList(['hidden']) };
    global.document = {
        getElementById(id) {
            if (id === 'private-map-gate') return panel;
            if (id === 'private-map-sign-in') return signIn;
            return null;
        }
    };
    global.setSaveStatus = () => {};
    global.fbAuth = null;
    global.currentCloudUser = null;
    const show = new Function(signedOut + '\n' + gate + '\nreturn { showPrivateMapGate, shareViewerIsSignedOut };')();
    assert.equal(show.shareViewerIsSignedOut(), true);
    show.showPrivateMapGate();
    assert.equal(panel.classList.contains('hidden'), false);
    assert.equal(panel.classList.contains('flex'), true);
    assert.equal(signIn.classList.contains('hidden'), false);

    global.fbAuth = { currentUser: { isAnonymous: false, email: 'owner@example.com' } };
    show.showPrivateMapGate();
    assert.equal(signIn.classList.contains('hidden'), true);

    global.fbAuth = { currentUser: { isAnonymous: true } };
    global.currentCloudUser = { isAnonymous: true };
    assert.equal(show.shareViewerIsSignedOut(), true);
});

test('inviting a teammate before an access level saves them as a restricted viewer', async () => {
    const source = [
        extractFunction(html, 'normalizedShareRoleEmails'),
        extractFunction(html, 'syncShareAccessLabelStyles'),
        extractFunction(html, 'handleShareSettingsChanged'),
        extractFunction(html, 'addTeammateInvite')
    ].join('\n');
    const radios = [
        { value: 'restricted', checked: false },
        { value: 'view', checked: false },
        { value: 'edit', checked: false }
    ];
    const labels = {};
    ['lbl-access-restricted', 'lbl-access-view', 'lbl-access-edit'].forEach((id) => {
        labels[id] = { classList: classList(['border-slate-200']) };
    });
    const writes = [];
    global.shareModalHydrating = false;
    global.currentCloudUser = { uid: 'owner' };
    global.currentProjectId = 'map-1';
    global.cloudMapsCache = [{ id: 'map-1' }];
    global.activeCollabMode = '';
    global.activeCollabOwnerId = '';
    global.activeCollabMapId = '';
    global.activeCollabAllowCopy = true;
    global.renderShareMembersList = () => {};
    global.alert = () => { throw new Error('invite should not alert'); };
    global.document = {
        getElementsByName(name) {
            return name === 'share-access-level' ? radios : [];
        },
        getElementById(id) {
            if (id === 'share-invite-email') return { value: 'Viewer@Example.com' };
            if (id === 'share-invite-role') return { value: 'view' };
            if (id === 'share-toggle-allow-copy') return { checked: true };
            if (id === 'share-save-indicator') return { textContent: '' };
            return labels[id] || null;
        }
    };
    global.fbDb = {
        collection() {
            return { doc() { return { collection() { return { doc() { return {
                set(data, options) {
                    writes.push({ data, options });
                    return Promise.resolve();
                }
            }; } }; } }; } };
        }
    };
    const api = new Function(source + '\nreturn addTeammateInvite;')();
    await api();
    assert.equal(radios.find(radio => radio.value === 'restricted').checked, true);
    assert.equal(writes.length, 1);
    const saved = writes[0].data.shareSettings;
    assert.equal(saved.accessLevel, 'restricted');
    assert.deepEqual(saved.invitedEmails, ['viewer@example.com']);
    assert.deepEqual(saved.editorEmails, []);
    assert.equal(saved.invitedMembers[0].role, 'view');
    assert.equal(writes[0].options.merge, true);
});
