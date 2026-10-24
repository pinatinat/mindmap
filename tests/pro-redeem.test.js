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
        toggle(name, force) {
            const on = force === undefined ? !names.has(name) : !!force;
            if (on) names.add(name);
            else names.delete(name);
            return on;
        },
        contains(name) { return names.has(name); }
    };
}

function element() {
    return { textContent: '', classList: classList(), value: '' };
}

test('the redeem panel stays visible while checkout is off', () => {
    assert.equal(html, fs.readFileSync(path.join(root, 'MINDMAP.html'), 'utf8'));
    const apply = new Function(
        [
            extractFunction(html, 'proCheckoutOpen'),
            extractFunction(html, 'syncQuotaUpgradeOffer'),
            extractFunction(html, 'applyProOfferCopy')
        ].join('\n') + '\nreturn applyProOfferCopy;'
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
        'quota-upgrade-label',
        'quota-upgrade-btn'
    ];
    const nodes = {};
    ids.forEach((id) => { nodes[id] = element(); });
    nodes['pro-activate-panel'].classList.add('hidden');
    nodes['pro-checkout-panel'].classList.add('hidden');
    nodes['quota-upgrade-btn'].classList.add('hidden');
    global.document = { getElementById(id) { return nodes[id] || null; } };
    global.OMNIMIND_PRO = { checkoutEnabled: false, priceUsd: '9.00', currency: 'USD' };
    global.formatOmniMindProPrice = () => '$9';
    apply();
    assert.equal(nodes['pro-activate-panel'].classList.contains('hidden'), false);
    assert.equal(nodes['pro-checkout-panel'].classList.contains('hidden'), true);
    assert.equal(nodes['quota-upgrade-btn'].classList.contains('hidden'), true);
    assert.equal(nodes['quota-upgrade-label'].textContent, '');
    assert.match(html, /await currentUser\.getIdToken\(\)/);
    assert.match(html, /That code and email don't match\. Check both and try again\./);
    assert.match(html, /Too many tries\. Wait a minute and try again\./);
});

test('a signed-in redeem request sends the Firebase ID token', async () => {
    global.getProDeviceId = () => 'device-1';
    global.PRO_CLOUD_MAPS = 50;
    global.currentCloudUserQuota = 5;
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

test('a successful redeem shows You\'re Pro, and the 5 of 5 quota dialog opens and closes', async () => {
    assert.match(html, /function openQuotaExceededModal\(/);
    assert.match(html, /function closeQuotaExceededModal\(/);
    assert.match(html, /Remove one from the cloud/);
    assert.match(html, /You're Pro ✓/);
    const source = [
        extractFunction(html, 'proCheckoutOpen'),
        extractFunction(html, 'syncQuotaUpgradeOffer'),
        extractFunction(html, 'openQuotaExceededModal'),
        extractFunction(html, 'closeQuotaExceededModal'),
        extractFunction(html, 'closeOmniMindProModal'),
        extractFunction(html, 'showYoureProConfirmation'),
        extractFunction(html, 'activateOmniMindPro')
    ].join('\n');
    const quotaModal = element();
    quotaModal.classList.add('hidden');
    const subtitle = element();
    const proModal = element();
    const status = element();
    const email = element();
    email.value = 'buyer@example.com';
    const code = element();
    code.value = 'OMNI-ZZZZ-9999';
    const nodes = {
        'quota-exceeded-modal': quotaModal,
        'quota-modal-subtitle': subtitle,
        'omnimind-pro-modal': proModal,
        'pro-activate-status': status,
        'pro-activate-email': email,
        'pro-activate-code': code
    };
    global.document = { getElementById(id) { return nodes[id] || null; } };
    global.getProDeviceId = () => 'device-1';
    global.PRO_CLOUD_MAPS = 50;
    global.currentCloudUserQuota = 5;
    global.isUserOmniMindPro = false;
    global.PRO_ACTIVATION_STORAGE_KEY = 'omnimind_pro_activation';
    global.OMNIMIND_PRO = { checkoutEnabled: false, priceUsd: '9.00', currency: 'USD' };
    global.fbAuth = { currentUser: null };
    const stored = [];
    global.localStorage = { setItem(key, value) { stored.push(key + '=' + value); } };
    const alerts = [];
    global.showAlert = (opts) => { alerts.push(opts); };
    let refreshed = 0;
    global.renderCloudMapsList = () => { refreshed += 1; };
    global.renderHomepage = () => { refreshed += 1; };
    global.updateCloudAuthUI = () => { refreshed += 1; };
    global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, email: 'buyer@example.com', code: 'OMNI-ZZZZ-9999' })
    });
    const api = new Function(source + '\nreturn { activateOmniMindPro, openQuotaExceededModal, closeQuotaExceededModal };')();
    await api.activateOmniMindPro({ preventDefault() {} });
    assert.equal(status.textContent, "You're Pro ✓");
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].title, "You're Pro ✓");
    assert.match(alerts[0].message, /You're Pro ✓/);
    assert.match(alerts[0].message, /50 maps/);
    assert.equal(refreshed, 3);
    assert.equal(global.isUserOmniMindPro, true);
    assert.equal(global.currentCloudUserQuota, 50);
    assert.equal(proModal.classList.contains('hidden'), true);
    assert.equal(stored.length, 1);

    api.openQuotaExceededModal(5, 5);
    assert.equal(quotaModal.classList.contains('hidden'), false);
    assert.equal(subtitle.textContent, '5 of 5 cloud maps');
    api.closeQuotaExceededModal();
    assert.equal(quotaModal.classList.contains('hidden'), true);

    alerts.length = 0;
    refreshed = 0;
    global.fetch = async () => { throw new Error('offline'); };
    await api.activateOmniMindPro({ preventDefault() {} });
    assert.equal(status.textContent, 'Could not reach the activation server.');
    assert.equal(alerts.length, 0);
    assert.equal(refreshed, 0);
});

test('a free account at 5 cloud maps sees only the quota dialog', async () => {
    assert.match(html, /const DEFAULT_MAX_CLOUD_MAPS = 5;/);
    assert.match(html, /const PRO_CLOUD_MAPS = 50;/);
    assert.doesNotMatch(html, /DEFAULT_MAX_CLOUD_MAPS = 3/);
    assert.match(html, /top 5 maps/);
    assert.match(html, /0 of 5 cloud slots used/);
    assert.match(html, /0 \/ 5 Maps/);
    assert.match(html, /Expand from 5 free cloud maps to 50/);
    assert.doesNotMatch(html, /top 3 maps/);
    assert.doesNotMatch(html, /from 3 free maps/);
    assert.doesNotMatch(html, /0 of 3 cloud/);
    assert.match(fs.readFileSync(path.join(root, 'api/lib/pro-store.js'), 'utf8'), /maxMaps: 50/);
    const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
    assert.doesNotMatch(rules, /maxMaps\s*(==|<=|>=|<|>)\s*[0-9]/);
    const saveSource = extractFunction(html, 'saveActiveMapToCloud');
    assert.match(saveSource, /openQuotaExceededModal\(currentCloudUserQuota, cloudMapsCache\.length\)/);
    assert.doesNotMatch(saveSource, /openOmniMindProModal/);
    assert.doesNotMatch(saveSource, /Cloud Storage Limit Reached/);
    assert.doesNotMatch(extractFunction(html, 'setSaveStatus'), /openOmniMindProModal/);

    const quotaModal = element();
    quotaModal.classList.add('hidden');
    const subtitle = element();
    const upgradeBtn = element();
    upgradeBtn.classList.add('hidden');
    const upgradeLabel = element();
    const proModal = element();
    proModal.classList.add('hidden');
    const nodes = {
        'quota-exceeded-modal': quotaModal,
        'quota-modal-subtitle': subtitle,
        'quota-upgrade-btn': upgradeBtn,
        'quota-upgrade-label': upgradeLabel,
        'omnimind-pro-modal': proModal
    };
    global.document = { getElementById(id) { return nodes[id] || null; } };
    global.OMNIMIND_PRO = { checkoutEnabled: false, priceUsd: '9.00', currency: 'USD' };
    global.formatOmniMindProPrice = () => '$9';
    const alerts = [];
    global.alert = (message) => { alerts.push(message); };
    const proOpens = [];
    global.openOmniMindProModal = (source) => {
        proOpens.push(source);
        proModal.classList.remove('hidden');
    };
    const statuses = [];
    global.setSaveStatus = (state, message) => { statuses.push(state + ':' + message); };
    global.cleanNodesForStorage = () => ({});
    global.cleanDecorationsForStorage = () => [];
    global.getCurrentProjectMeta = () => ({ id: 'map-new', name: 'New idea' });
    global.nodes = {};
    global.canvasDecorations = [];
    global.fbDb = { collection() { throw new Error('should not write'); } };
    global.currentCloudUser = { uid: 'free-user' };
    global.cloudMapsCache = [1, 2, 3, 4, 5].map((n) => ({ id: 'map-' + n }));
    global.currentCloudUserQuota = 5;

    const api = new Function(
        [
            extractFunction(html, 'proCheckoutOpen'),
            extractFunction(html, 'syncQuotaUpgradeOffer'),
            extractFunction(html, 'openQuotaExceededModal'),
            extractFunction(html, 'closeQuotaExceededModal'),
            extractFunction(html, 'upgradeFromQuotaDialog'),
            saveSource
        ].join('\n') + '\nreturn { saveActiveMapToCloud, upgradeFromQuotaDialog, openQuotaExceededModal };'
    )();

    await api.saveActiveMapToCloud(null, false);
    assert.equal(quotaModal.classList.contains('hidden'), false);
    assert.equal(subtitle.textContent, '5 of 5 cloud maps');
    assert.equal(upgradeBtn.classList.contains('hidden'), true);
    assert.equal(alerts.length, 0);
    assert.deepEqual(proOpens, []);
    assert.equal(proModal.classList.contains('hidden'), true);
    assert.equal(statuses.length, 2);
    assert.match(statuses[1], /5 of 5 cloud maps/);

    api.upgradeFromQuotaDialog();
    assert.deepEqual(proOpens, []);
    assert.equal(proModal.classList.contains('hidden'), true);
    assert.equal(quotaModal.classList.contains('hidden'), false);

    global.OMNIMIND_PRO = { checkoutEnabled: true, priceUsd: '9.00', currency: 'USD' };
    api.openQuotaExceededModal(5, 5);
    assert.equal(upgradeBtn.classList.contains('hidden'), false);
    assert.equal(upgradeLabel.textContent, '⭐ Upgrade to OmniMind Pro ($9 · 5 free cloud maps to 50)');
    api.upgradeFromQuotaDialog();
    assert.deepEqual(proOpens, ['quota_limit']);
    assert.equal(quotaModal.classList.contains('hidden'), true);
    assert.equal(proModal.classList.contains('hidden'), false);
});
