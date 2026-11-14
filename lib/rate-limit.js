const crypto = require('crypto');
const { normalizeCode } = require('./pro-store');

const WINDOW_MS = 60 * 1000;
const MAX_ATTEMPTS = 10;

function hashKey(prefix, value) {
    const digest = crypto.createHash('sha256').update(String(value)).digest('hex');
    return prefix + digest;
}

function firstHeader(headers, name) {
    let value = '';
    Object.keys(headers || {}).forEach((key) => {
        if (String(key).toLowerCase() === name) value = headers[key];
    });
    if (Array.isArray(value)) value = value[0];
    const first = String(value || '').split(',')[0].trim();
    return first;
}

function clientIp(req) {
    const headers = (req && req.headers) || {};
    return firstHeader(headers, 'x-vercel-forwarded-for')
        || firstHeader(headers, 'x-real-ip')
        || firstHeader(headers, 'x-forwarded-for')
        || (req && req.socket && req.socket.remoteAddress)
        || 'unknown';
}

function nextBucket(current, now, windowMs) {
    const start = current && typeof current.windowStart === 'number' ? current.windowStart : 0;
    const fresh = !start || now - start >= windowMs;
    const windowStart = fresh ? now : start;
    const count = (fresh ? 0 : (current.count || 0)) + 1;
    return { count, windowStart };
}

/**
 * Fixed one-minute window stored in Firestore so the limit holds across
 * serverless instances. Counts the IP and, when present, the activation code.
 */
async function enforceActivationRateLimit(db, input = {}) {
    const now = typeof input.now === 'number' ? input.now : Date.now();
    const limit = input.limit || MAX_ATTEMPTS;
    const windowMs = input.windowMs || WINDOW_MS;
    const ip = input.ip || 'unknown';
    const code = normalizeCode(input.code);
    const ipRef = db.collection('rate_limits').doc(hashKey('ip_', ip));
    const codeRef = code ? db.collection('rate_limits').doc(hashKey('code_', code)) : null;
    return db.runTransaction(async (tx) => {
        const ipSnap = await tx.get(ipRef);
        const codeSnap = codeRef ? await tx.get(codeRef) : null;
        const ipNext = nextBucket(ipSnap.exists ? ipSnap.data() : null, now, windowMs);
        const codeNext = codeRef ? nextBucket(codeSnap.exists ? codeSnap.data() : null, now, windowMs) : null;
        tx.set(ipRef, { count: ipNext.count, windowStart: ipNext.windowStart });
        if (codeRef) tx.set(codeRef, { count: codeNext.count, windowStart: codeNext.windowStart });
        const allowed = ipNext.count <= limit && (!codeNext || codeNext.count <= limit);
        return { allowed, ipCount: ipNext.count, codeCount: codeNext ? codeNext.count : 0 };
    });
}

module.exports = {
    WINDOW_MS,
    MAX_ATTEMPTS,
    hashKey,
    clientIp,
    enforceActivationRateLimit
};
