const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { AI_MAP_LIMITS, profileIsOmniMindPro, aiDailyLimit } = require('../pro-config');
const { aiDayKey, usageDocId, consumeAiQuota, readAiQuota } = require('../lib/ai-quota');
const { generateMindMap, modelChain, normalizeTree } = require('../lib/gemini');
const { handleAiGenerate } = require('../api/ai-generate');
const { createMemoryDb } = require('./memory-db');

const root = path.join(__dirname, '..');
const DAY = Date.parse('2026-11-22T04:00:00.000Z');
const NEXT_MANILA_DAY = Date.parse('2026-11-22T16:00:00.000Z');
const KEY = 'test-gemini-key-not-real';

function mockRes() {
    return {
        statusCode: 0,
        headers: {},
        body: '',
        setHeader(name, value) { this.headers[name] = value; },
        end(text) {
            this.body = text || '';
            this.json = this.body ? JSON.parse(this.body) : {};
        }
    };
}

function authed(method, body, token) {
    return {
        method,
        headers: { Authorization: 'Bearer ' + (token || 'good-token') },
        body: body
    };
}

function googleUser(uid) {
    return async () => ({ uid, email: uid + '@example.com', firebase: { sign_in_provider: 'google.com' } });
}

function sampleTree() {
    return [{
        id: 'root',
        topic: 'Rivers',
        children: [{ id: 'a', topic: 'Source', children: [] }]
    }];
}

function jsonResponse(status, body) {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => body
    };
}

function deps(extra) {
    return Object.assign({
        db: createMemoryDb(),
        env: { GEMINI_API_KEY: KEY },
        now: DAY,
        verifyIdToken: googleUser('free-1')
    }, extra);
}

test('daily caps and Pro detection live in one config', () => {
    assert.equal(AI_MAP_LIMITS.freePerDay, 3);
    assert.equal(AI_MAP_LIMITS.proPerDay, 30);
    assert.equal(AI_MAP_LIMITS.dayTimeZone, 'Asia/Manila');
    assert.equal(aiDailyLimit(false), 3);
    assert.equal(aiDailyLimit(true), 30);
    assert.equal(profileIsOmniMindPro(null), false);
    assert.equal(profileIsOmniMindPro({ plan: 'omnimind_pro' }), false);
    assert.equal(profileIsOmniMindPro({ plan: 'omnimind_pro', maxMaps: 50 }), true);
    assert.equal(profileIsOmniMindPro({ plan: 'free', maxMaps: 50 }), true);
    assert.equal(profileIsOmniMindPro({ plan: 'free', maxMaps: 5 }), false);
});

test('the usage day follows Asia/Manila, including the UTC evening rollover', () => {
    assert.equal(aiDayKey(DAY), '2026-11-22');
    assert.equal(aiDayKey(Date.parse('2026-11-22T15:59:59.000Z')), '2026-11-22');
    assert.equal(aiDayKey(NEXT_MANILA_DAY), '2026-11-23');
    assert.equal(usageDocId('uid/nope', '2026-11-22'), 'uid/nope_2026-11-22');
});

test('free users stop at 3, Pro users stop at 30, and the next Manila day resets', async () => {
    const db = createMemoryDb();
    db.docs.set('users/pro-1', { plan: 'omnimind_pro', maxMaps: 50 });
    for (let i = 0; i < 3; i++) {
        const turn = await consumeAiQuota(db, { uid: 'free-1', now: DAY });
        assert.equal(turn.allowed, true);
        assert.equal(turn.plan, 'free');
        assert.equal(turn.remaining, 2 - i);
    }
    const blocked = await consumeAiQuota(db, { uid: 'free-1', now: DAY });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.equal(blocked.limit, 3);
    const other = await consumeAiQuota(db, { uid: 'free-2', now: DAY });
    assert.equal(other.allowed, true);
    assert.equal(other.used, 1);

    for (let i = 0; i < 30; i++) {
        const turn = await consumeAiQuota(db, { uid: 'pro-1', now: DAY });
        assert.equal(turn.allowed, true);
        assert.equal(turn.plan, 'pro');
    }
    const proBlocked = await consumeAiQuota(db, { uid: 'pro-1', now: DAY });
    assert.equal(proBlocked.allowed, false);
    assert.equal(proBlocked.limit, 30);

    const reset = await consumeAiQuota(db, { uid: 'free-1', now: NEXT_MANILA_DAY });
    assert.equal(reset.allowed, true);
    assert.equal(reset.day, '2026-11-23');
    assert.equal(reset.remaining, 2);
    const stillToday = await readAiQuota(db, { uid: 'free-1', now: DAY });
    assert.equal(stillToday.remaining, 0);
});

test('a missing key, a signed-out caller, and a bad method do not count usage', async () => {
    const db = createMemoryDb();
    const base = deps({ db, env: {} });
    const missing = mockRes();
    await handleAiGenerate(authed('POST', { prompt: 'Volcanoes' }), missing, base);
    assert.equal(missing.statusCode, 503);
    assert.equal(missing.json.ok, false);
    assert.equal(missing.json.error, 'AI not configured');
    assert.equal(missing.json.code, 'not_configured');
    assert.equal(db.docs.has('ai_usage/free-1_2026-11-22'), false);
    assert.equal(JSON.stringify(missing.json).includes('GEMINI'), false);

    const anon = mockRes();
    await handleAiGenerate(authed('POST', { prompt: 'Volcanoes' }), anon, deps({
        db,
        verifyIdToken: async () => ({ uid: 'guest', firebase: { sign_in_provider: 'anonymous' } })
    }));
    assert.equal(anon.statusCode, 401);
    assert.match(anon.json.error, /Sign in/);

    const signedOut = mockRes();
    await handleAiGenerate({ method: 'POST', headers: {}, body: { prompt: 'Volcanoes' } }, signedOut, deps({ db }));
    assert.equal(signedOut.statusCode, 401);

    const badToken = mockRes();
    await handleAiGenerate(authed('POST', { prompt: 'Volcanoes' }), badToken, deps({
        db,
        verifyIdToken: async () => { throw new Error('bad token'); }
    }));
    assert.equal(badToken.statusCode, 401);

    const method = mockRes();
    await handleAiGenerate({ method: 'PUT', headers: {} }, method, deps({ db }));
    assert.equal(method.statusCode, 405);

    const empty = mockRes();
    await handleAiGenerate(authed('POST', { prompt: '   ' }), empty, deps({ db }));
    assert.equal(empty.statusCode, 400);
    assert.equal(db.docs.size, 0);
});

test('the free cap is 429, the body cannot grant Pro, and a failure refunds the count', async () => {
    const db = createMemoryDb();
    let calls = 0;
    const generate = async () => {
        calls += 1;
        return { tree: sampleTree(), model: 'gemini-2.5-flash' };
    };
    for (let i = 0; i < 3; i++) {
        const res = mockRes();
        await handleAiGenerate(authed('POST', { prompt: 'Topic ' + i, plan: 'pro', isPro: true }), res, deps({ db, generate }));
        assert.equal(res.statusCode, 200);
        assert.equal(res.json.plan, 'free');
        assert.equal(res.json.limit, 3);
        assert.equal(res.json.remaining, 2 - i);
        assert.equal(res.json.tree[0].topic, 'Rivers');
        assert.equal(JSON.stringify(res.json).includes(KEY), false);
    }
    const blocked = mockRes();
    await handleAiGenerate(authed('POST', { prompt: 'One more' }), blocked, deps({ db, generate }));
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.json.code, 'limit');
    assert.equal(blocked.json.plan, 'free');
    assert.equal(blocked.json.remaining, 0);
    assert.match(blocked.json.error, /free AI maps/);
    assert.match(blocked.json.error, /30/);
    assert.equal(calls, 3);

    const broken = mockRes();
    const brokenDb = createMemoryDb();
    await handleAiGenerate(authed('POST', { prompt: 'Break' }), broken, deps({
        db: brokenDb,
        generate: async () => {
            const err = new Error('upstream blew up and echoed ' + KEY);
            err.status = 500;
            throw err;
        }
    }));
    assert.equal(broken.statusCode, 502);
    assert.equal(broken.json.code, 'upstream');
    assert.equal(broken.json.error, 'The AI service could not generate a map.');
    assert.equal(JSON.stringify(broken.json).includes(KEY), false);
    assert.equal(brokenDb.docs.get('ai_usage/free-1_2026-11-22').count, 0);
});

test('status reports remaining without spending a map, including when AI is not configured', async () => {
    const db = createMemoryDb();
    await consumeAiQuota(db, { uid: 'free-1', now: DAY });
    const open = mockRes();
    await handleAiGenerate(authed('GET'), open, deps({ db, env: {} }));
    assert.equal(open.statusCode, 200);
    assert.equal(open.json.configured, false);
    assert.equal(open.json.remaining, 2);
    assert.equal(open.json.limit, 3);
    assert.equal(open.headers['Cache-Control'], 'no-store');
    const again = await readAiQuota(db, { uid: 'free-1', now: DAY });
    assert.equal(again.used, 1);
});

test('Gemini keeps the key in a header and falls through a missing model only', async () => {
    assert.deepEqual(modelChain('gemini-2.0-flash')[0], 'gemini-2.0-flash');
    assert.deepEqual(modelChain('gemini-does-not-exist')[0], 'gemini-2.5-flash');
    const calls = [];
    const tree = await generateMindMap('Rivers', {
        apiKey: KEY,
        preferredModel: 'gemini-evil',
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            const model = decodeURIComponent(url.split('/models/')[1].split(':')[0]);
            if (model === 'gemini-2.5-flash') {
                return jsonResponse(404, { error: { code: 404, message: 'models/gemini-2.5-flash is not found' } });
            }
            return jsonResponse(200, {
                candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(sampleTree()) + '\n```' }] } }]
            });
        }
    });
    assert.equal(tree.model, 'gemini-2.0-flash');
    assert.equal(tree.tree[0].id, 'root');
    assert.equal(calls.length, 2);
    calls.forEach((call) => {
        assert.equal(call.url.includes('key='), false);
        assert.equal(call.url.includes(KEY), false);
        assert.equal(call.options.headers['x-goog-api-key'], KEY);
    });

    const stopped = [];
    await assert.rejects(() => generateMindMap('Rivers', {
        apiKey: KEY,
        fetchImpl: async (url) => {
            stopped.push(url);
            return jsonResponse(400, { error: { code: 400, message: 'API key ' + KEY + ' rejected' } });
        }
    }), (err) => {
        assert.equal(err.status, 502);
        assert.equal(err.message.includes(KEY), false);
        return true;
    });
    assert.equal(stopped.length, 1);

    await assert.rejects(() => generateMindMap('Rivers', { apiKey: '' }), (err) => err.message === 'AI not configured');
    const cleaned = normalizeTree('[{"id":"../x","topic":"  Hello   there  ","children":[{"topic":"Child"}]}]');
    assert.equal(cleaned[0].id, 'x');
    assert.equal(cleaned[0].topic, 'Hello there');
    assert.equal(cleaned[0].children[0].topic, 'Child');
});

test('the page shows hosted AI and does not keep a browser key or the mock tree', () => {
    const indexPath = path.join(root, 'index.html');
    const twinPath = path.join(root, 'MINDMAP.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    assert.equal(html, fs.readFileSync(twinPath, 'utf8'));
    assert.equal(html.includes('id="ai_key"'), false);
    assert.equal(html.includes('generativelanguage.googleapis.com'), false);
    assert.equal(html.includes('Phase 1: Planning'), false);
    assert.equal(html.includes('style="display: none;"'), false);
    assert.match(html, /id="tab-ai"/);
    assert.match(html, /homeGenerateWithAI/);
    assert.match(html, /\/api\/ai-generate/);
    assert.match(html, /AI maps left today/);
    assert.match(html, /AI not configured/);
    const rel = path.win32.join('api', 'ai-generate.js');
    const abs = path.join.apply(path, [path.resolve(root)].concat(rel.split(path.win32.sep)));
    assert.equal(typeof require(abs).handleAiGenerate, 'function');
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    assert.match(readme, /GEMINI_API_KEY/);
    assert.match(readme, /ai_usage/);
    assert.match(readme, /Asia\/Manila/);
});
