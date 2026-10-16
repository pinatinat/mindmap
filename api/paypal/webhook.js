const { paypalConfig, verifyWebhookSignature, purchaseFromCaptureEvent } = require('../lib/paypal');
const { fulfillPurchase } = require('../lib/fulfill');
const { getFirestore } = require('../lib/firebase');
const { sendJson, readBody, httpError, run } = require('../lib/http');

async function handleWebhook(req, res, deps = {}) {
    if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'Method not allowed' });
        return;
    }
    await run(res, async () => {
        const event = readBody(req);
        if (!event || !event.event_type) throw httpError(400, 'Invalid webhook body');
        const config = deps.config || paypalConfig();
        const fetchImpl = deps.fetchImpl || fetch;
        const verified = await verifyWebhookSignature(config, fetchImpl, req.headers || {}, event);
        if (!verified) throw httpError(401, 'PayPal webhook signature was not verified');
        if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
            sendJson(res, 200, { ok: true, ignored: true });
            return;
        }
        const purchase = await purchaseFromCaptureEvent(config, fetchImpl, event);
        if (!purchase) throw httpError(400, 'Capture is not completed');
        const db = deps.db || getFirestore();
        const result = await fulfillPurchase({
            db,
            purchase,
            fetchImpl,
            resendKey: deps.resendKey !== undefined ? deps.resendKey : process.env.RESEND_API_KEY
        });
        sendJson(res, 200, { ok: true, alreadyIssued: result.alreadyIssued });
    });
}

module.exports = (req, res) => handleWebhook(req, res);
module.exports.handleWebhook = handleWebhook;
