const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFunction(source, name) {
    const marker = 'function ' + name + '(';
    let start = source.indexOf(marker);
    assert.notEqual(start, -1, name + ' is missing');
    if (start >= 6 && source.slice(start - 6, start) === 'async ') start -= 6;
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

function classList(initial) {
    const names = new Set(initial || []);
    return {
        add() { Array.from(arguments).forEach((name) => names.add(name)); },
        remove() { Array.from(arguments).forEach((name) => names.delete(name)); },
        contains(name) { return names.has(name); }
    };
}

function element() {
    return { textContent: '', classList: classList(), value: '' };
}

test('the redeem panel stays visible while checkout is off', () => {
    assert.equal(html, fs.readFileSync(path.join(root, 'MINDMAP.html'), 'utf8'));
    const apply = new Function(
        extractFunction(html, 'proCheckoutOpen') + '\n' + extractFunction(html, 'applyProOfferCopy') + '\nreturn applyProOfferCopy;'
    )();
    const ids = [
        'pro-modal-title',
        'pro-modal-tagline',
        'pro-modal-price',
        'pro-modal-amount',
        'pro-modal-price-note',
        'pro-checkout-panel',
        'pro-activate-panel',
        'home-footer-pro-line',
        'quota-upgrade-label'
    ];
    const nodes = {};
    ids.forEach((id) => { nodes[id] = element(); });
    nodes['pro-activate-panel'].classList.add('hidden');
    nodes['pro-checkout-panel'].classList.add('hidden');
    global.document = { getElementById(id) { return nodes[id] || null; } };
    global.OMNIMIND_PRO = { checkoutEnabled: false, priceUsd: '9.00', currency: 'USD' };
    global.formatOmniMindProPrice = () => '$9';
    apply();
    assert.equal(nodes['pro-activate-panel'].classList.contains('hidden'), false);
    assert.equal(nodes['pro-checkout-panel'].classList.contains('hidden'), true);
    assert.match(html, /await currentUser\.getIdToken\(\)/);
    assert.match(html, /That code and email don't match\. Check both and try again\./);
    assert.match(html, /Too many tries\. Wait a minute and try again\./);
});

test('a signed-in redeem request sends the Firebase ID token', async () => {
    global.getProDeviceId = () => 'device-1';
    global.PRO_CLOUD_MAPS = 50;
    global.currentCloudUserQuota = 3;
    global.isUserOmniMindPro = false;
    global.PRO_ACTIVATION_STORAGE_KEY = 'omnimind_pro_activation';
    global.localStorage = { setItem() {} };
    global.closeOmniMindProModal = () => {};
    global.closeQuotaExceededModal = () => {};
    global.renderCloudMapsList = () => {};
    global.renderHomepage = () => {};
    global.updateCloudAuthUI = () => {};
    global.showAlert = () => {};
    const status = element();
    const email = element();
    email.value = 'buyer@example.com';
    const code = element();
    code.value = 'OMNI-ZZZZ-9999';
    global.document = {
        getElementById(id) {
            if (id === 'pro-activate-email') return email;
            if (id === 'pro-activate-code') return code;
            if (id === 'pro-activate-status') return status;
            return null;
        }
    };
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        const statusCode = calls.length === 1 ? 403 : 429;
        return { ok: false, status: statusCode, json: async () => ({ ok: false, error: 'raw' }) };
    };
    global.fbAuth = { currentUser: { getIdToken: async () => 'token-123' } };
    const activate = new Function(extractFunction(html, 'activateOmniMindPro') + '\nreturn activateOmniMindPro;')();
    await activate({ preventDefault() {} });
    assert.equal(calls[0].options.headers.Authorization, 'Bearer token-123');
    assert.equal(JSON.parse(calls[0].options.body).uid, undefined);
    assert.equal(status.textContent, "That code and email don't match. Check both and try again.");
    await activate({ preventDefault() {} });
    assert.equal(status.textContent, 'Too many tries. Wait a minute and try again.');

    global.fbAuth = { currentUser: null };
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        return { ok: false, status: 400, json: async () => ({ ok: false, error: 'Email, code, and device id are required' }) };
    };
    await activate({ preventDefault() {} });
    assert.equal(calls[2].options.headers.Authorization, undefined);
    assert.equal(status.textContent, 'Email, code, and device id are required');
});
