const { activateProCode } = require('../lib/pro-store');
const { getFirestore } = require('../lib/firebase');
const { sendJson, readBody, httpError, run } = require('../lib/http');

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
        const result = await activateProCode(db, {
            email: body.email,
            code: body.code,
            deviceId: body.deviceId
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
