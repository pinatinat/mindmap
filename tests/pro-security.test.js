const test = require('node:test');
const assert = require('node:assert/strict');
const { issueProCode, activateProCode } = require('../api/lib/pro-store');
const { handleActivate } = require('../api/pro/activate');
const { sendJson } = require('../api/lib/http');
const { verifyIdToken } = require('../api/lib/firebase');
const { enforceActivationRateLimit, clientIp, MAX_ATTEMPTS } = require('../api/lib/rate-limit');
const { OMNIMIND_PRO } = require('../api/lib/paypal');
const { createMemoryDb } = require('./memory-db');

const CODE = 'OMNI-ZZZZ-9999';

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

async function seedCode(db, email = 'buyer@example.com') {
    await issueProCode(db, {
        captureId: 'CAP-' + email,
        email,
        value: OMNIMIND_PRO.priceUsd,
        currency: OMNIMIND_PRO.currency
    }, () => CODE);
}

function activateBody(extra = {}) {
    return {
        method: 'POST',
        headers: extra.headers || {},
        body: {
            email: 'buyer@example.com',
            code: CODE,
            deviceId: extra.deviceId || 'phone-1',
            uid: 'body-uid',
            ...extra.body
        }
    };
}

test('sendJson marks responses as uncached', () => {
    const res = mockRes();
    sendJson(res, 200, { ok: true });
    assert.equal(res.headers['Content-Type'], 'application/json');
    assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('unknown codes and wrong emails share one error', async () => {
    const db = createMemoryDb();
    await seedCode(db);
    const unknown = await activateProCode(db, {
        email: 'buyer@example.com',
        code: 'OMNI-NOPE-0000',
        deviceId: 'phone-1'
    });
    const mismatch = await activateProCode(db, {
        email: 'other@example.com',
        code: CODE,
        deviceId: 'phone-1'
    });
    assert.equal(unknown.status, 403);
    assert.equal(mismatch.status, 403);
    assert.equal(unknown.error, "That code and email don't match. Check both and try again.");
    assert.equal(mismatch.error, unknown.error);
    assert.equal(unknown.ok, false);
});

test('a request uid does not bind Pro, and a verified matching token does', async () => {
    const db = createMemoryDb();
    await seedCode(db);
    db.docs.set('users/real-uid', { displayName: 'Ada', plan: 'free' });

    const bare = mockRes();
    await handleActivate(activateBody(), bare, { db });
    assert.equal(bare.statusCode, 200);
    assert.equal(bare.headers['Cache-Control'], 'no-store');
    assert.equal(db.docs.has('users/body-uid'), false);
    assert.equal(db.docs.get('users/real-uid').plan, 'free');

    const unverified = mockRes();
    await handleActivate(activateBody({
        headers: { Authorization: 'Bearer unverified' }
    }), unverified, {
        db,
        verifyIdToken: async () => ({ uid: 'real-uid', email: 'buyer@example.com', email_verified: false })
    });
    assert.equal(unverified.statusCode, 200);
    assert.equal(db.docs.get('users/real-uid').plan, 'free');

    const otherAccount = mockRes();
    await handleActivate(activateBody({
        headers: { authorization: 'Bearer other' }
    }), otherAccount, {
        db,
        verifyIdToken: async () => ({ uid: 'real-uid', email: 'other@example.com', email_verified: true })
    });
    assert.equal(otherAccount.statusCode, 200);
    assert.equal(db.docs.get('users/real-uid').plan, 'free');

    const badToken = mockRes();
    await handleActivate(activateBody({
        headers: { authorization: 'Bearer bad' }
    }), badToken, {
        db,
        verifyIdToken: async () => { throw new Error('invalid token'); }
    });
    assert.equal(badToken.statusCode, 200);
    assert.equal(db.docs.get('users/real-uid').plan, 'free');

    let seenToken = '';
    const bound = mockRes();
    await handleActivate(activateBody({
        headers: { authorization: 'Bearer good-token' }
    }), bound, {
        db,
        verifyIdToken: async (token) => {
            seenToken = token;
            return { uid: 'real-uid', email: 'Buyer@Example.com', email_verified: true };
        }
    });
    assert.equal(bound.statusCode, 200);
    assert.equal(bound.json.already, true);
    assert.equal(seenToken, 'good-token');
    const profile = db.docs.get('users/real-uid');
    assert.equal(profile.displayName, 'Ada');
    assert.equal(profile.plan, 'omnimind_pro');
    assert.equal(profile.maxMaps, 50);
    assert.equal(profile.codeUsed, CODE);
    assert.match(profile.proActivatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(db.docs.has('users/body-uid'), false);
});

test('rate limits hold per IP and per code across calls', async () => {
    const db = createMemoryDb();
    const now = 1_700_000_000_000;
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
        const decision = await enforceActivationRateLimit(db, { ip: '203.0.113.5', code: 'OMNI-AAAA-BBBB', now });
        assert.equal(decision.allowed, true, 'attempt ' + i);
    }
    const blockedIp = await enforceActivationRateLimit(db, { ip: '203.0.113.5', code: 'OMNI-CCCC-DDDD', now });
    assert.equal(blockedIp.allowed, false);
    const otherIpSameCode = await enforceActivationRateLimit(db, { ip: '203.0.113.9', code: 'OMNI-AAAA-BBBB', now });
    assert.equal(otherIpSameCode.allowed, false);
    const reset = await enforceActivationRateLimit(db, {
        ip: '203.0.113.5',
        code: 'OMNI-CCCC-DDDD',
        now: now + 60 * 1000
    });
    assert.equal(reset.allowed, true);

    const keys = [...db.docs.keys()];
    assert.ok(keys.some((key) => key.startsWith('rate_limits/ip_')));
    assert.ok(keys.some((key) => key.startsWith('rate_limits/code_')));
    assert.equal(keys.some((key) => key.includes('203.0.113.5') || key.includes('OMNI-AAAA')), false);
});

test('the activate endpoint returns 429 from the shared limiter', async () => {
    const db = createMemoryDb();
    await seedCode(db);
    const ip = '198.51.100.20';
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const res = mockRes();
        await handleActivate({
            method: 'POST',
            headers: { 'x-forwarded-for': ip + ', 10.0.0.1' },
            body: { email: 'buyer@example.com', code: 'OMNI-NOPE-1111', deviceId: 'phone-' + i }
        }, res, { db, now: 5_000 });
        assert.equal(res.statusCode, 403, res.body);
        assert.equal(res.json.error, "That code and email don't match. Check both and try again.");
    }
    const limited = mockRes();
    await handleActivate({
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
        body: { email: 'buyer@example.com', code: CODE, deviceId: 'phone-new' }
    }, limited, { db, now: 5_000 });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json.ok, false);
    assert.equal(limited.json.error, 'Too many tries. Wait a minute and try again.');
    assert.equal(db.docs.get('pro_codes/' + CODE).devices.length, 0);

    let called = 0;
    const injected = mockRes();
    await handleActivate(activateBody({ deviceId: 'injected' }), injected, {
        db,
        enforceRateLimit: async () => {
            called += 1;
            return { allowed: false };
        }
    });
    assert.equal(called, 1);
    assert.equal(injected.statusCode, 429);
});

test('clientIp prefers Vercel, then the real IP, then the first forwarded address', () => {
    const socket = { remoteAddress: '127.0.0.1' };
    assert.equal(clientIp({
        headers: {
            'x-vercel-forwarded-for': '203.0.113.9',
            'x-real-ip': '203.0.113.8',
            'x-forwarded-for': '198.51.100.1, 10.0.0.1'
        },
        socket
    }), '203.0.113.9');
    assert.equal(clientIp({
        headers: {
            'X-Real-IP': '203.0.113.8',
            'X-Forwarded-For': '198.51.100.1, 10.0.0.1'
        },
        socket
    }), '203.0.113.8');
    assert.equal(clientIp({ headers: { 'X-Forwarded-For': '203.0.113.8, 10.1.1.1' }, socket }), '203.0.113.8');
    assert.equal(clientIp({ headers: {}, socket }), '127.0.0.1');
});

test('verifyIdToken does not run without a service account', async () => {
    const previous = process.env.FIREBASE_SERVICE_ACCOUNT;
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    try {
        await assert.rejects(() => verifyIdToken('not-a-token'), (err) => err.status === 503);
    } finally {
        if (previous === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT;
        else process.env.FIREBASE_SERVICE_ACCOUNT = previous;
    }
});
