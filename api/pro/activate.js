const { activateProCode, normalizeEmail } = require('../lib/pro-store');
const { getFirestore, verifyIdToken } = require('../lib/firebase');
const { enforceActivationRateLimit, clientIp } = require('../lib/rate-limit');
const { sendJson, readBody, httpError, run } = require('../lib/http');

function authorizationHeader(req) {
    const headers = (req && req.headers) || {};
    let header = '';
    Object.keys(headers).forEach((key) => {
        if (String(key).toLowerCase() === 'authorization') header = headers[key];
    });
    return String(header || '');
}

/**
 * A Firebase ID token binds Pro to that account only when the token is valid,
 * the email is verified, and it is the same email as the activation request.
 * Anything else leaves activation device-only. The request body never supplies the uid.
 */
async function accountUidFromRequest(req, email, deps) {
    const match = /^Bearer\s+(\S+)/i.exec(authorizationHeader(req).trim());
    if (!match) return null;
    const verify = deps.verifyIdToken || verifyIdToken;
    let decoded;
    try {
        decoded = await verify(match[1]);
    } catch (err) {
        if (err && err.status === 503) throw err;
        return null;
    }
    if (!decoded || decoded.email_verified !== true) return null;
    const uid = String(decoded.uid || '').trim();
    if (!uid || uid.includes('/')) return null;
    if (normalizeEmail(decoded.email) !== normalizeEmail(email)) return null;
    return uid;
}

async function handleActivate(req, res, deps = {}) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 204, {});
        return;
    }
    if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'Method not allowed' });
        return;
    }
    await run(res, async () => {
        const body = readBody(req);
        if (body === null) throw httpError(400, 'Invalid JSON');
        const db = deps.db || getFirestore();
        const limit = deps.enforceRateLimit || enforceActivationRateLimit;
        const ip = (deps.clientIp || clientIp)(req);
        const decision = await limit(db, { ip, code: body.code, now: deps.now });
        if (!decision || decision.allowed === false) {
            sendJson(res, 429, { ok: false, error: 'Too many attempts. Try again in a minute.' });
            return;
        }
        const uid = await accountUidFromRequest(req, body.email, deps);
        const result = await activateProCode(db, {
            email: body.email,
            code: body.code,
            deviceId: body.deviceId,
            uid
        });
        if (!result.ok) {
            sendJson(res, result.status || 400, { ok: false, error: result.error });
            return;
        }
        sendJson(res, 200, { ok: true, email: result.email, code: result.code, already: !!result.already });
    });
}

module.exports = (req, res) => handleActivate(req, res);
module.exports.handleActivate = handleActivate;
module.exports.accountUidFromRequest = accountUidFromRequest;
