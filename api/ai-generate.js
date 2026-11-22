const { getFirestore, verifyIdToken } = require('../lib/firebase');
const { sendJson, readBody, httpError, run } = require('../lib/http');
const { readAiQuota, consumeAiQuota, releaseAiQuota } = require('../lib/ai-quota');
const { generateMindMap } = require('../lib/gemini');
const { AI_MAP_LIMITS } = require('../pro-config');

const MAX_PROMPT = 4000;

function authorizationHeader(req) {
    const headers = (req && req.headers) || {};
    let header = '';
    Object.keys(headers).forEach((key) => {
        if (String(key).toLowerCase() === 'authorization') header = headers[key];
    });
    return String(header || '');
}

function bearerToken(req) {
    const match = /^Bearer\s+(\S+)/i.exec(authorizationHeader(req).trim());
    return match ? match[1] : '';
}

function signInError() {
    return httpError(401, 'Sign in to generate an AI map.', { code: 'auth' });
}

async function signedInUser(req, deps) {
    const token = bearerToken(req);
    if (!token) throw signInError();
    const verify = deps.verifyIdToken || verifyIdToken;
    let decoded;
    try {
        decoded = await verify(token);
    } catch (err) {
        if (err && err.status === 503) throw err;
        throw signInError();
    }
    const uid = decoded && decoded.uid ? String(decoded.uid).trim() : '';
    if (!uid || uid.indexOf('/') !== -1) throw signInError();
    const provider = decoded.firebase && decoded.firebase.sign_in_provider;
    if (provider === 'anonymous') throw signInError();
    return { uid, email: decoded.email || '' };
}

function limitError(quota) {
    const message = quota.plan === 'pro'
        ? 'You have used today\'s ' + quota.limit + ' AI maps. They reset at midnight Philippine time.'
        : 'You have used today\'s ' + quota.limit + ' free AI maps. Pro includes ' + AI_MAP_LIMITS.proPerDay + ' a day.';
    return httpError(429, message, {
        code: 'limit',
        plan: quota.plan,
        used: quota.used,
        limit: quota.limit,
        remaining: 0
    });
}

function publicQuota(quota, configured) {
    return {
        ok: true,
        plan: quota.plan,
        used: quota.used,
        limit: quota.limit,
        remaining: quota.remaining,
        day: quota.day,
        timeZone: quota.timeZone,
        configured: !!configured
    };
}

async function handleAiGenerate(req, res, deps) {
    const depsSafe = deps || {};
    if (req.method === 'OPTIONS') {
        sendJson(res, 204, {});
        return;
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'Method not allowed' });
        return;
    }
    await run(res, async () => {
        const env = depsSafe.env || process.env;
        const user = await signedInUser(req, depsSafe);
        const db = depsSafe.db || getFirestore();
        const now = depsSafe.now;
        const configured = !!env.GEMINI_API_KEY;
        if (req.method === 'GET') {
            const quota = await readAiQuota(db, { uid: user.uid, now });
            sendJson(res, 200, publicQuota(quota, configured));
            return;
        }
        const body = readBody(req);
        if (body === null) throw httpError(400, 'Invalid JSON');
        const prompt = String(body.prompt || '').trim();
        if (!prompt) throw httpError(400, 'Enter a topic to generate a mind map.');
        if (prompt.length > MAX_PROMPT) throw httpError(400, 'That prompt is too long.');
        if (!configured) {
            throw httpError(503, 'AI not configured', { code: 'not_configured' });
        }
        const quota = await consumeAiQuota(db, { uid: user.uid, now });
        if (!quota.allowed) throw limitError(quota);
        try {
            const generate = depsSafe.generate || generateMindMap;
            const result = await generate(prompt, {
                apiKey: env.GEMINI_API_KEY,
                fetchImpl: depsSafe.fetchImpl,
                preferredModel: body.model
            });
            sendJson(res, 200, Object.assign(publicQuota(quota, true), {
                tree: result.tree,
                model: result.model
            }));
        } catch (err) {
            try {
                await releaseAiQuota(db, { uid: user.uid, day: quota.day });
            } catch (releaseErr) {}
            const code = (err && err.code) || 'upstream';
            if (code === 'not_configured') {
                throw httpError(503, 'AI not configured', { code: 'not_configured' });
            }
            throw httpError(502, 'The AI service could not generate a map.', { code: 'upstream' });
        }
    });
}

module.exports = (req, res) => handleAiGenerate(req, res);
module.exports.handleAiGenerate = handleAiGenerate;
