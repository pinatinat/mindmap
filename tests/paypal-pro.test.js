const test = require('node:test');
const assert = require('node:assert/strict');
const { generateProCode, issueProCode, activateProCode, MAX_DEVICES } = require('../api/lib/pro-store');
const { fulfillPurchase } = require('../api/lib/fulfill');
const { createProOrder, assertProPrice, PRO_PRICE } = require('../api/lib/paypal');
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
            payments: {
                captures: [{
                    id: 'CAP1',
                    status: 'COMPLETED',
                    amount: { currency_code: 'USD', value: '9.00' }
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
    const purchase = { captureId: 'CAP1', orderId: 'ORDER1', email: 'a@b.co', value: '9.00', currency: 'USD' };
    let n = 0;
    const gen = () => `OMNI-TEST-${String(++n).padStart(4, '0')}`;
    const first = await issueProCode(db, purchase, gen);
    const second = await issueProCode(db, purchase, gen);
    assert.equal(first.alreadyIssued, false);
    assert.equal(second.alreadyIssued, true);
    assert.equal(second.code, first.code);
    assert.equal(n, 1);
});

test('activation allows 3 devices and rejects a fourth', async () => {
    const db = createMemoryDb();
    const purchase = { captureId: 'CAP1', email: 'buyer@example.com', value: '9.00', currency: 'USD' };
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

test('assertProPrice rejects anything other than 9.00 USD', () => {
    assert.throws(() => assertProPrice({ captureId: 'C', email: 'a@b.co', value: '8.00', currency: 'USD' }), /9\.00/);
    assert.throws(() => assertProPrice({ captureId: 'C', email: 'a@b.co', value: '9.00', currency: 'PHP' }), /9\.00/);
    assert.equal(assertProPrice({ captureId: 'C', email: 'a@b.co', value: PRO_PRICE, currency: 'USD' }).email, 'a@b.co');
});

test('create order always asks PayPal for 9.00 USD', async () => {
    let orderBody;
    const fetchImpl = async (url, options = {}) => {
        if (String(url).includes('/v1/oauth2/token')) {
            return { ok: true, json: async () => ({ access_token: 'tok' }) };
        }
        orderBody = JSON.parse(options.body);
        return { ok: true, json: async () => ({ id: 'ORDER9' }) };
    };
    const order = await createProOrder(config, fetchImpl);
    assert.equal(order.id, 'ORDER9');
    assert.equal(orderBody.purchase_units[0].amount.value, '9.00');
    assert.equal(orderBody.purchase_units[0].amount.currency_code, 'USD');
    const res = mockRes();
    await handleCreateOrder({ method: 'POST' }, res, { config, fetchImpl });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.id, 'ORDER9');
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
            value: '9.00',
            currency: 'USD'
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
                amount: { currency_code: 'USD', value: '9.00' },
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

test('activate endpoint returns the server decision', async () => {
    const db = createMemoryDb();
    await issueProCode(db, {
        captureId: 'CAP1',
        email: 'buyer@example.com',
        value: '9.00',
        currency: 'USD'
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
