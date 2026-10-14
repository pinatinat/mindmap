const { paypalConfig, captureProOrder, readCompletedPurchase } = require('../lib/paypal');
const { fulfillPurchase } = require('../lib/fulfill');
const { getFirestore } = require('../lib/firebase');
const { sendJson, readBody, httpError, run } = require('../lib/http');

async function handleCaptureOrder(req, res, deps = {}) {
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
        const orderId = body.orderID || body.orderId;
        const config = deps.config || paypalConfig();
        const fetchImpl = deps.fetchImpl || fetch;
        const db = deps.db || getFirestore();
        const order = await captureProOrder(config, fetchImpl, orderId);
        const purchase = readCompletedPurchase(order);
        if (!purchase) throw httpError(402, 'PayPal order is not completed');
        const result = await fulfillPurchase({
            db,
            purchase,
            fetchImpl,
            resendKey: deps.resendKey !== undefined ? deps.resendKey : process.env.RESEND_API_KEY
        });
        sendJson(res, 200, result);
    });
}

module.exports = (req, res) => handleCaptureOrder(req, res);
module.exports.handleCaptureOrder = handleCaptureOrder;
