const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFunction(source, name) {
    const marker = 'function ' + name + '(';
    const start = source.indexOf(marker);
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
