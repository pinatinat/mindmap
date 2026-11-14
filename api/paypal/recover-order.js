const { paypalConfig, purchaseFromPayPalReference } = require('../lib/paypal');
const { fulfillPurchase } = require('../lib/fulfill');
const { findRecordedPurchase, normalizeEmail } = require('../lib/pro-store');
const { getFirestore } = require('../lib/firebase');
const { sendJson, readBody, httpError, run } = require('../lib/http');

const EMAIL_ONLY = 'Email only finds purchases we already recorded. Paste the transaction ID from your PayPal receipt email.';

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
        const typedEmail = normalizeEmail(body.email);
        const emailOnly = !reference || reference.includes('@');
        const email = typedEmail || (reference.includes('@') ? normalizeEmail(reference) : '');
        if (!reference && !email) throw httpError(400, 'Enter a PayPal transaction ID, order ID, or email');
        const config = deps.config || paypalConfig();
        const fetchImpl = deps.fetchImpl || fetch;
        const db = deps.db || getFirestore();
        let purchase = null;
        if (!emailOnly) {
            purchase = await purchaseFromPayPalReference(config, fetchImpl, reference);
        }
        if (!purchase && email) {
            purchase = await findRecordedPurchase(db, email);
            if (!purchase) throw httpError(404, EMAIL_ONLY);
        }
        if (!purchase) throw httpError(404, 'That PayPal payment is not a completed OmniMind Pro purchase');
        if (email && purchase.email && email !== purchase.email) {
            throw httpError(403, "That email does not match this PayPal payment");
        }
        const result = await fulfillPurchase({
            db,
            purchase,
            fetchImpl,
            resendKey: deps.resendKey !== undefined ? deps.resendKey : process.env.RESEND_API_KEY
        });
        sendJson(res, 200, Object.assign({ recordedOnly: emailOnly }, result));
    });
}

module.exports = (req, res) => handleRecoverOrder(req, res);
module.exports.handleRecoverOrder = handleRecoverOrder;
module.exports.EMAIL_ONLY = EMAIL_ONLY;
