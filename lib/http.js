function sendJson(res, status, body) {
    res.statusCode = status;
    if (typeof res.setHeader === 'function') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
    }
    const text = JSON.stringify(body);
    if (typeof res.end === 'function') res.end(text);
    else res.body = text;
}

function readBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string' && req.body.trim()) {
        try { return JSON.parse(req.body); } catch (e) { return null; }
    }
    return {};
}

function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

async function run(res, fn) {
    try {
        await fn();
    } catch (err) {
        sendJson(res, err.status || 500, { ok: false, error: err.message || 'Server error' });
    }
}

module.exports = { sendJson, readBody, httpError, run };
