const { paypalConfig, purchaseFromPayPalReference } = require('../../lib/paypal');
const { fulfillPurchase } = require('../../lib/fulfill');
const { normalizeEmail } = require('../../lib/pro-store');
const { getFirestore } = require('../../lib/firebase');
const { sendJson, readBody, httpError, run } = require('../../lib/http');
const { enforceActivationRateLimit, clientIp } = require('../../lib/rate-limit');

const RECOVER_NEED_BOTH = 'Enter the PayPal transaction ID and the email you paid with.';
const RECOVER_MISMATCH = "That transaction ID and email don't match.";

async function handleRecoverOrder(req, res, deps = {}) {
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
        const reference = String(body.reference || body.orderID || body.orderId || body.captureId || '').trim();
        const email = normalizeEmail(body.email);
        const idOk = reference && !reference.includes('@');
        if (!idOk || !email) throw httpError(400, RECOVER_NEED_BOTH);
        const db = deps.db || getFirestore();
        const ip = (deps.clientIp || clientIp)(req);
        const limit = await enforceActivationRateLimit(db, { ip, code: reference });
        if (!limit.allowed) throw httpError(429, 'Too many attempts. Try again in a minute.');
        const config = deps.config || paypalConfig();
        const fetchImpl = deps.fetchImpl || fetch;
        const purchase = await purchaseFromPayPalReference(config, fetchImpl, reference);
        if (!purchase || !purchase.email || normalizeEmail(purchase.email) !== email) {
            throw httpError(403, RECOVER_MISMATCH);
        }
        const result = await fulfillPurchase({
            db,
            purchase,
            fetchImpl,
            resendKey: deps.resendKey !== undefined ? deps.resendKey : process.env.RESEND_API_KEY
        });
        sendJson(res, 200, result);
    });
}

module.exports = (req, res) => handleRecoverOrder(req, res);
module.exports.handleRecoverOrder = handleRecoverOrder;
module.exports.RECOVER_NEED_BOTH = RECOVER_NEED_BOTH;
module.exports.RECOVER_MISMATCH = RECOVER_MISMATCH;
