const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { generateProCode, issueProCode, activateProCode, MAX_DEVICES } = require('../api/lib/pro-store');
const { fulfillPurchase } = require('../api/lib/fulfill');
const { createProOrder, assertProPrice, readCompletedPurchase, purchaseFromCaptureEvent, PRO_PRICE, OMNIMIND_PRO, formatOmniMindProPrice, paypalConfig } = require('../api/lib/paypal');
const { resolveCheckoutEnabled, PAYPAL_SANDBOX_API, PAYPAL_LIVE_API } = require('../pro-config');
const { handleProCheckoutScript } = require('../api/pro-checkout');
const { handleCreateOrder } = require('../api/paypal/create-order');
const { handleCaptureOrder } = require('../api/paypal/capture-order');
const { handleWebhook } = require('../api/paypal/webhook');
const { handleActivate } = require('../api/pro/activate');
const { createMemoryDb } = require('./memory-db');

const config = {
    clientId: 'client',
    secret: 'secret',
    webhookId: 'WH-TEST',
    mode: 'sandbox',
    base: 'https://api-m.sandbox.paypal.com'
};

function completedOrder(overrides = {}) {
    return {
        id: 'ORDER1',
        status: 'COMPLETED',
        payer: { email_address: 'Buyer@Example.com' },
        purchase_units: [{
            custom_id: 'omnimind_pro',
            payments: {
                captures: [{
                    id: 'CAP1',
                    status: 'COMPLETED',
                    amount: { currency_code: 'USD', value: OMNIMIND_PRO.priceUsd }
                }]
            }
        }],
        ...overrides
    };
}

function mockRes() {
    return {
        statusCode: 0,
        headers: {},
        body: '',
        setHeader(key, value) { this.headers[key] = value; },
        end(text) {
            this.body = text || '';
            this.json = this.body ? JSON.parse(this.body) : {};
        }
    };
}

test('codes look like OMNI-XXXX-XXXX and avoid ambiguous characters', () => {
    const seen = new Set();
    for (let i = 0; i < 20; i++) {
        const code = generateProCode();
        assert.match(code, /^OMNI-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
        seen.add(code);
    }
    assert.ok(seen.size > 1);
});

test('issueProCode is idempotent per capture id', async () => {
    const db = createMemoryDb();
    const purchase = { captureId: 'CAP1', orderId: 'ORDER1', email: 'a@b.co', value: OMNIMIND_PRO.priceUsd, currency: OMNIMIND_PRO.currency };
    let n = 0;
    const gen = () => `OMNI-TEST-${String(++n).padStart(4, '0')}`;
    const first = await issueProCode(db, purchase, gen);
    const second = await issueProCode(db, purchase, gen);
    assert.equal(first.alreadyIssued, false);
    assert.equal(second.alreadyIssued, true);
    assert.equal(second.code, first.code);
    assert.equal(n, 1);
    const captures = [...db.docs.keys()].filter((key) => key.startsWith('pro_captures/'));
    assert.deepEqual(captures, ['pro_captures/CAP1']);
});

test('activation allows 3 devices and rejects a fourth', async () => {
    const db = createMemoryDb();
    const purchase = { captureId: 'CAP1', email: 'buyer@example.com', value: OMNIMIND_PRO.priceUsd, currency: OMNIMIND_PRO.currency };
    const issued = await issueProCode(db, purchase, () => 'OMNI-ABCD-2345');
    for (let i = 1; i <= MAX_DEVICES; i++) {
        const result = await activateProCode(db, {
            email: 'Buyer@Example.com',
            code: 'omni-abcd-2345',
            deviceId: `device-${i}`
        });
        assert.equal(result.ok, true, result.error);
    }
    const again = await activateProCode(db, {
        email: 'buyer@example.com',
        code: issued.code,
        deviceId: 'device-1'
    });
    assert.equal(again.ok, true);
    assert.equal(again.already, true);
    const fourth = await activateProCode(db, {
        email: 'buyer@example.com',
        code: issued.code,
        deviceId: 'device-4'
    });
    assert.equal(fourth.status, 409);
    const mismatch = await activateProCode(db, {
        email: 'other@example.com',
        code: issued.code,
        deviceId: 'device-9'
    });
    assert.equal(mismatch.status, 403);
});

test('assertProPrice uses the configured price', () => {
    assert.equal(OMNIMIND_PRO.priceUsd, '9.00');
    assert.equal(OMNIMIND_PRO.currency, 'USD');
    const label = formatOmniMindProPrice(OMNIMIND_PRO);
    assert.throws(() => assertProPrice({ captureId: 'C', email: 'a@b.co', value: '8.00', currency: 'USD' }), new RegExp(label.replace('$', '\\$')));
    assert.throws(() => assertProPrice({ captureId: 'C', email: 'a@b.co', value: PRO_PRICE, currency: 'PHP' }), new RegExp(label.replace('$', '\\$')));
    assert.equal(assertProPrice({ captureId: 'C', email: 'a@b.co', value: PRO_PRICE, currency: OMNIMIND_PRO.currency }).email, 'a@b.co');
    const custom = { priceUsd: '12.50', currency: 'USD', checkoutEnabled: true };
    assert.equal(assertProPrice({ captureId: 'C', email: 'a@b.co', value: '12.50', currency: 'USD' }, custom).value, '12.50');
});

test('create order uses pro-config and stays closed while checkout is off', async () => {
    let calls = 0;
    let orderBody;
    const fetchImpl = async (url, options = {}) => {
        calls += 1;
        if (String(url).includes('/v1/oauth2/token')) {
            return { ok: true, json: async () => ({ access_token: 'tok' }) };
        }
        orderBody = JSON.parse(options.body);
        return { ok: true, json: async () => ({ id: 'ORDER9' }) };
    };
    const closed = mockRes();
    await handleCreateOrder({ method: 'POST' }, closed, { config, fetchImpl });
    assert.equal(closed.statusCode, 403);
    assert.equal(calls, 0);
    assert.equal(OMNIMIND_PRO.checkoutEnabled, false);

    const custom = { priceUsd: '12.50', currency: 'USD', checkoutEnabled: true };
    const order = await createProOrder(config, fetchImpl, custom);
    assert.equal(order.id, 'ORDER9');
    assert.equal(orderBody.purchase_units[0].amount.value, '12.50');
    assert.equal(orderBody.purchase_units[0].amount.currency_code, 'USD');
    assert.equal(orderBody.purchase_units[0].custom_id, 'omnimind_pro');

    const open = mockRes();
    await handleCreateOrder({ method: 'POST' }, open, { config, fetchImpl, pro: OMNIMIND_PRO.checkoutEnabled ? OMNIMIND_PRO : Object.assign({}, OMNIMIND_PRO, { checkoutEnabled: true }) });
    assert.equal(open.statusCode, 200);
    assert.equal(orderBody.purchase_units[0].amount.value, OMNIMIND_PRO.priceUsd);
    assert.equal(orderBody.purchase_units[0].amount.currency_code, OMNIMIND_PRO.currency);
    assert.equal(orderBody.purchase_units[0].custom_id, 'omnimind_pro');
});

test('readCompletedPurchase accepts only custom_id omnimind_pro', () => {
    const purchase = readCompletedPurchase(completedOrder());
    assert.equal(purchase.captureId, 'CAP1');
    assert.equal(purchase.email, 'buyer@example.com');
    const missing = completedOrder();
    delete missing.purchase_units[0].custom_id;
    assert.equal(readCompletedPurchase(missing), null);
    const wrong = completedOrder();
    wrong.purchase_units[0].custom_id = 'something_else';
    assert.equal(readCompletedPurchase(wrong), null);
});

test('a capture event without an order id still requires custom_id', async () => {
    const fetchImpl = async () => { throw new Error('order lookup should not run'); };
    const accepted = await purchaseFromCaptureEvent(config, fetchImpl, {
        resource: {
            id: 'CAP9',
            status: 'COMPLETED',
            custom_id: 'omnimind_pro',
            amount: { currency_code: 'USD', value: OMNIMIND_PRO.priceUsd },
            payer: { email_address: 'Buyer@Example.com' }
        }
    });
    assert.equal(accepted.captureId, 'CAP9');
    assert.equal(accepted.email, 'buyer@example.com');
    const rejected = await purchaseFromCaptureEvent(config, fetchImpl, {
        resource: {
            id: 'CAP9',
            status: 'COMPLETED',
            amount: { currency_code: 'USD', value: OMNIMIND_PRO.priceUsd },
            payer: { email_address: 'buyer@example.com' }
        }
    });
    assert.equal(rejected, null);
});

test('capture rejects a completed order that is not OmniMind Pro', async () => {
    const fetchImpl = async (url) => {
        if (String(url).includes('/v1/oauth2/token')) {
            return { ok: true, json: async () => ({ access_token: 'tok' }) };
        }
        const order = completedOrder();
        delete order.purchase_units[0].custom_id;
        return { ok: true, json: async () => order };
    };
    const res = mockRes();
    await handleCaptureOrder(
        { method: 'POST', body: { orderID: 'ORDER1' } },
        res,
        { config, fetchImpl, db: createMemoryDb(), resendKey: '' }
    );
    assert.equal(res.statusCode, 402);
    assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('capture fulfills once and capture plus webhook share the code', async () => {
    const emails = [];
    function fetchImplFactory() {
        return async (url, options = {}) => {
            const href = String(url);
            if (href.includes('/v1/oauth2/token')) {
                return { ok: true, json: async () => ({ access_token: 'tok' }) };
            }
            if (href.includes('/capture')) {
                return { ok: true, json: async () => completedOrder() };
            }
            if (href.includes('/v2/checkout/orders/')) {
                return { ok: true, json: async () => completedOrder() };
            }
            if (href.includes('/verify-webhook-signature')) {
                return { ok: true, json: async () => ({ verification_status: 'SUCCESS' }) };
            }
            if (href.includes('api.resend.com')) {
                emails.push(JSON.parse(options.body));
                return { ok: true, text: async () => '' };
            }
            throw new Error('unexpected url ' + href);
        };
    }
    const db = createMemoryDb();
    const fetchImpl = fetchImplFactory();
    const captureRes = mockRes();
    await handleCaptureOrder(
        { method: 'POST', body: { orderID: 'ORDER1' } },
        captureRes,
        { config, fetchImpl, db, resendKey: 're_test' }
    );
    assert.equal(captureRes.statusCode, 200);
    assert.equal(captureRes.json.ok, true);
    assert.equal(captureRes.json.email, 'buyer@example.com');
    assert.match(captureRes.json.code, /^OMNI-/);
    assert.equal(captureRes.json.emailed, true);
    assert.equal(emails.length, 1);

    const issued = await fulfillPurchase({
        db,
        purchase: {
            captureId: 'CAP1',
            orderId: 'ORDER1',
            email: 'buyer@example.com',
            value: OMNIMIND_PRO.priceUsd,
            currency: OMNIMIND_PRO.currency
        },
        fetchImpl,
        resendKey: 're_test'
    });
    assert.equal(issued.alreadyIssued, true);
    assert.equal(issued.code, captureRes.json.code);
    assert.equal(emails.length, 1);

    const fresh = createMemoryDb();
    emails.length = 0;
    const hook = mockRes();
    await handleWebhook({
        method: 'POST',
        headers: {
            'paypal-auth-algo': 'SHA256withRSA',
            'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
            'paypal-transmission-id': 'tx',
            'paypal-transmission-sig': 'sig',
            'paypal-transmission-time': '2026-10-14T00:00:00Z'
        },
        body: {
            event_type: 'PAYMENT.CAPTURE.COMPLETED',
            resource: {
                id: 'CAP1',
                status: 'COMPLETED',
                amount: { currency_code: OMNIMIND_PRO.currency, value: OMNIMIND_PRO.priceUsd },
                supplementary_data: { related_ids: { order_id: 'ORDER1' } }
            }
        }
    }, hook, { config, fetchImpl: fetchImplFactory(), db: fresh, resendKey: 're_test' });
    assert.equal(hook.statusCode, 200);
    assert.equal(hook.json.alreadyIssued, false);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to[0], 'buyer@example.com');
    assert.match(emails[0].text, /OMNI-/);

    const hookAgain = mockRes();
    await handleWebhook({
        method: 'POST',
        headers: { 'paypal-transmission-id': 'tx' },
        body: {
            event_type: 'PAYMENT.CAPTURE.COMPLETED',
            resource: {
                id: 'CAP1',
                status: 'COMPLETED',
                supplementary_data: { related_ids: { order_id: 'ORDER1' } }
            }
        }
    }, hookAgain, { config, fetchImpl: fetchImplFactory(), db: fresh, resendKey: 're_test' });
    assert.equal(hookAgain.json.alreadyIssued, true);
    assert.equal(emails.length, 1);
});

test('a webhook after the return-page capture keeps a single pro_captures row', async () => {
    const emails = [];
    const fetchImpl = async (url, options = {}) => {
        const href = String(url);
        if (href.includes('/v1/oauth2/token')) {
            return { ok: true, json: async () => ({ access_token: 'tok' }) };
        }
        if (href.includes('/capture') || href.includes('/v2/checkout/orders/')) {
            return { ok: true, json: async () => completedOrder() };
        }
        if (href.includes('/verify-webhook-signature')) {
            return { ok: true, json: async () => ({ verification_status: 'SUCCESS' }) };
        }
        if (href.includes('api.resend.com')) {
            emails.push(JSON.parse(options.body));
            return { ok: true, text: async () => '' };
        }
        throw new Error('unexpected url ' + href);
    };
    const db = createMemoryDb();
    const captureRes = mockRes();
    await handleCaptureOrder(
        { method: 'POST', body: { orderID: 'ORDER1' } },
        captureRes,
        { config, fetchImpl, db, resendKey: 're_test' }
    );
    assert.equal(captureRes.json.alreadyIssued, false);
    const hook = mockRes();
    await handleWebhook({
        method: 'POST',
        headers: { 'paypal-transmission-id': 'tx-after-return' },
        body: {
            event_type: 'PAYMENT.CAPTURE.COMPLETED',
            resource: {
                id: 'CAP1',
                status: 'COMPLETED',
                supplementary_data: { related_ids: { order_id: 'ORDER1' } }
            }
        }
    }, hook, { config, fetchImpl, db, resendKey: 're_test' });
    assert.equal(hook.statusCode, 200);
    assert.equal(hook.json.ok, true);
    assert.equal(hook.json.alreadyIssued, true);
    assert.equal(db.docs.get('pro_captures/CAP1').code, captureRes.json.code);
    const captures = [...db.docs.keys()].filter((key) => key.startsWith('pro_captures/'));
    assert.deepEqual(captures, ['pro_captures/CAP1']);
    assert.equal(emails.length, 1);
});

test('checkout copy distinguishes opening PayPal from a capture after approval', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
    assert.match(html, /We couldn't open PayPal\. You weren't charged\. Please try again in a moment\./);
    assert.match(html, /id="paypal-pro-retry"[^>]*class="hidden/);
    assert.match(html, /We're confirming your payment\. Don't pay again\. Check your email for your Pro code, or enter the email and code below in a few minutes\./);
    assert.match(html, /function showPayPalOpenFailure\(/);
    assert.match(html, /function showPayPalConfirming\(/);
    assert.match(html, /if \(buyerApproved\) showPayPalConfirming\(\);\s*else showPayPalOpenFailure\(\);/);
    assert.match(html, /href="\/favicon\.ico"/);
    assert.equal(require('fs').existsSync(require('path').join(__dirname, '..', 'favicon.ico')), true);
});

test('webhook rejects a signature that PayPal does not mark SUCCESS', async () => {
    const db = createMemoryDb();
    const fetchImpl = async (url) => {
        if (String(url).includes('/v1/oauth2/token')) {
            return { ok: true, json: async () => ({ access_token: 'tok' }) };
        }
        return { ok: true, json: async () => ({ verification_status: 'FAILURE' }) };
    };
    const res = mockRes();
    await handleWebhook({
        method: 'POST',
        headers: {},
        body: { event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP1', status: 'COMPLETED' } }
    }, res, { config, fetchImpl, db, resendKey: '' });
    assert.equal(res.statusCode, 401);
    assert.equal(db.docs.size, 0);
});

test('checkout turns on only for non-production sandbox', () => {
    assert.equal(OMNIMIND_PRO.checkoutEnabled, false);
    assert.equal(OMNIMIND_PRO.priceUsd, '9.00');
    assert.equal(resolveCheckoutEnabled({}), false);
    assert.equal(resolveCheckoutEnabled({ VERCEL_ENV: 'production', PAYPAL_ENV: 'sandbox', OMNIMIND_CHECKOUT: 'true' }), false);
    assert.equal(resolveCheckoutEnabled({ VERCEL_ENV: 'preview' }), true);
    assert.equal(resolveCheckoutEnabled({ VERCEL_ENV: 'preview', PAYPAL_ENV: 'live' }), true);
    assert.equal(resolveCheckoutEnabled({ VERCEL_ENV: 'development' }), true);
    assert.equal(resolveCheckoutEnabled({ OMNIMIND_CHECKOUT: 'true' }), true);
    assert.equal(resolveCheckoutEnabled({ OMNIMIND_CHECKOUT: 'yes' }), true);
    assert.equal(resolveCheckoutEnabled({ PAYPAL_ENV: 'live', OMNIMIND_CHECKOUT: 'true' }), false);
    assert.equal(resolveCheckoutEnabled({ VERCEL_ENV: 'production', PAYPAL_ENV: 'live' }), false);

    const preview = paypalConfig({ VERCEL_ENV: 'preview', PAYPAL_ENV: 'live', PAYPAL_CLIENT_ID: 'c', PAYPAL_CLIENT_SECRET: 's' });
    assert.equal(preview.mode, 'sandbox');
    assert.equal(preview.base, PAYPAL_SANDBOX_API);
    const production = paypalConfig({ VERCEL_ENV: 'production', PAYPAL_ENV: 'live' });
    assert.equal(production.mode, 'live');
    assert.equal(production.base, PAYPAL_LIVE_API);
    const productionDefault = paypalConfig({ VERCEL_ENV: 'production' });
    assert.equal(productionDefault.mode, 'sandbox');
    assert.equal(productionDefault.base, PAYPAL_SANDBOX_API);
});

test('preview create and capture call the sandbox API and keep the $9 price', async () => {
    const previewEnv = { VERCEL_ENV: 'preview', PAYPAL_ENV: 'live', PAYPAL_CLIENT_ID: 'c', PAYPAL_CLIENT_SECRET: 's' };
    const urls = [];
    const fetchImpl = async (url, options = {}) => {
        urls.push(String(url));
        if (String(url).includes('/v1/oauth2/token')) {
            return { ok: true, json: async () => ({ access_token: 'tok' }) };
        }
        if (String(url).includes('/v2/checkout/orders') && options.method === 'POST' && !String(url).includes('/capture')) {
            const body = JSON.parse(options.body);
            assert.equal(body.purchase_units[0].amount.value, '9.00');
            assert.equal(body.purchase_units[0].amount.currency_code, 'USD');
            assert.equal(body.purchase_units[0].custom_id, 'omnimind_pro');
            return { ok: true, json: async () => ({ id: 'ORDER-PREVIEW' }) };
        }
        return {
            ok: true,
            json: async () => completedOrder({ id: 'ORDER-PREVIEW' })
        };
    };
    const created = mockRes();
    await handleCreateOrder({ method: 'POST' }, created, { env: previewEnv, fetchImpl, config: paypalConfig(previewEnv) });
    assert.equal(created.statusCode, 200);
    assert.equal(created.json.id, 'ORDER-PREVIEW');
    assert.ok(urls.every((url) => url.startsWith(PAYPAL_SANDBOX_API)));

    const captured = mockRes();
    const db = createMemoryDb();
    await handleCaptureOrder({ method: 'POST', body: { orderID: 'ORDER-PREVIEW' } }, captured, {
        config: paypalConfig(previewEnv),
        fetchImpl,
        db,
        resendKey: ''
    });
    assert.equal(captured.statusCode, 200);
    assert.equal(captured.json.ok, true);
    assert.ok(urls.some((url) => url === PAYPAL_SANDBOX_API + '/v2/checkout/orders/ORDER-PREVIEW/capture'));
    assert.ok(urls.every((url) => url.startsWith(PAYPAL_SANDBOX_API)));
});

test('pro-checkout script follows the same gate and loads via a Windows-style path', () => {
    function scriptRes() {
        return {
            statusCode: 0,
            headers: {},
            body: '',
            setHeader(key, value) { this.headers[key] = value; },
            end(text) { this.body = text || ''; }
        };
    }
    const off = scriptRes();
    handleProCheckoutScript({ method: 'GET' }, off, { env: { VERCEL_ENV: 'production', OMNIMIND_CHECKOUT: 'true' } });
    assert.match(off.body, /checkoutEnabled=false/);
    const on = scriptRes();
    handleProCheckoutScript({ method: 'GET' }, on, { env: { VERCEL_ENV: 'preview', PAYPAL_ENV: 'live' } });
    assert.match(on.body, /checkoutEnabled=true/);
    assert.equal(on.headers['Cache-Control'], 'no-store');

    const rel = path.win32.join('api', 'pro-checkout.js');
    const abs = path.join.apply(path, [path.resolve(__dirname, '..')].concat(rel.split(path.win32.sep)));
    assert.equal(typeof require(abs).handleProCheckoutScript, 'function');
});

test('activate endpoint returns the server decision', async () => {
    const db = createMemoryDb();
    await issueProCode(db, {
        captureId: 'CAP1',
        email: 'buyer@example.com',
        value: OMNIMIND_PRO.priceUsd,
        currency: OMNIMIND_PRO.currency
    }, () => 'OMNI-ZZZZ-9999');
    const res = mockRes();
    await handleActivate({
        method: 'POST',
        body: { email: 'buyer@example.com', code: 'OMNI-ZZZZ-9999', deviceId: 'phone-1' }
    }, res, { db });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.ok, true);
    const missing = mockRes();
    await handleActivate({ method: 'GET' }, missing, { db });
    assert.equal(missing.statusCode, 405);
});
