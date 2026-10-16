const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function walk(dir, acc = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, acc);
        else acc.push(full);
    }
    return acc;
}

test('shipped text has no lifetime, PayMongo, or Lemon Squeezy wording', () => {
    const hits = [];
    for (const file of walk(root)) {
        const rel = path.relative(root, file);
        if (rel === 'tests/wording.test.js') continue;
        if (!/\.(html|js|md|json|rules)$/.test(rel)) continue;
        const text = fs.readFileSync(file, 'utf8');
        if (/lifetime/i.test(text)) hits.push(rel + ' lifetime');
        if (/paymongo/i.test(text)) hits.push(rel + ' paymongo');
        if (/lemon\s*squeezy|lemonsqueezy/i.test(text)) hits.push(rel + ' lemon');
    }
    assert.deepEqual(hits, []);
});

test('footer, legal contact, and public PayPal client id are present', () => {
    const html = read('index.html');
    assert.equal(html, read('MINDMAP.html'));
    assert.match(html, /legal\/terms\.html/);
    assert.match(html, /legal\/privacy\.html/);
    assert.match(html, /legal\/refund\.html/);
    assert.match(html, /support@omnimindmap\.app/);
    assert.match(html, /AfLUWmx3V0glGmHJI9Lwq2vSeYMP4HWrdlrjnmx9UPtK7ssmgO8AldGDFOr5KrX17Usx8W_gyl9v6lT8/);
    assert.match(html, /id="paypal-pro-button"/);
    assert.match(html, /id="pro-checkout-panel" class="hidden"/);
    assert.match(html, /id="pro-activate-panel" class="hidden"/);
    assert.match(html, /getElementById\('pro-activate-panel'\)/);
    assert.match(html, /Already paid\? Enter the email and code/);
    assert.match(html, /OmniMind Pro, coming soon/);
    const config = read('pro-config.js');
    assert.match(config, /priceUsd:/);
    assert.match(config, /checkoutEnabled:\s*false/);
    assert.equal((config.match(/priceUsd:/g) || []).length, 1);
    const priceHits = [];
    for (const rel of ['index.html', 'MINDMAP.html', 'README.md', 'legal/terms.html', 'legal/privacy.html', 'legal/refund.html', 'package.json']) {
        const text = read(rel);
        if (/\$\d+(?:\.\d+)?(?!")/.test(text)) priceHits.push(rel);
    }
    assert.deepEqual(priceHits, []);
    for (const page of ['legal/terms.html', 'legal/privacy.html', 'legal/refund.html']) {
        assert.match(read(page), /support@omnimindmap\.app/);
    }
    const readme = read('README.md');
    for (const name of [
        'PAYPAL_CLIENT_ID',
        'PAYPAL_CLIENT_SECRET',
        'PAYPAL_WEBHOOK_ID',
        'PAYPAL_ENV',
        'FIREBASE_SERVICE_ACCOUNT',
        'RESEND_API_KEY'
    ]) {
        assert.match(readme, new RegExp(name));
    }
    assert.equal(fs.existsSync(path.join(root, 'api/paymongo-webhook.js')), false);
    assert.equal(fs.existsSync(path.join(root, 'README_PAYMONGO.md')), false);
});
