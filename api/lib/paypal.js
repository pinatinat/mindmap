const { OMNIMIND_PRO, formatOmniMindProPrice, resolvePaypalMode, paypalApiBase } = require('../../pro-config');
const PRO_PRICE = OMNIMIND_PRO.priceUsd;
const PRO_CURRENCY = OMNIMIND_PRO.currency;
const PRO_DESCRIPTION = 'OmniMind Pro (one-time)';

function paypalConfig(env = process.env) {
    const clientId = env.PAYPAL_CLIENT_ID;
    const secret = env.PAYPAL_CLIENT_SECRET;
    const webhookId = env.PAYPAL_WEBHOOK_ID;
    const mode = resolvePaypalMode(env);
    return { clientId, secret, webhookId, mode, base: paypalApiBase(mode) };
}

async function requestAccessToken(config, fetchImpl) {
    const auth = Buffer.from(`${config.clientId}:${config.secret}`).toString('base64');
    const res = await fetchImpl(`${config.base}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
        const err = new Error(data.error_description || 'PayPal authentication failed');
        err.status = res.status >= 500 ? 502 : 502;
        throw err;
    }
    return data.access_token;
}

async function getAccessToken(config, fetchImpl) {
    if (!config.clientId || !config.secret) {
        const err = new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required');
        err.status = 503;
        throw err;
    }
    try {
        return await requestAccessToken(config, fetchImpl);
    } catch (err) {
        if (err && err.status === 503) throw err;
        return requestAccessToken(config, fetchImpl);
    }
}

async function createProOrder(config, fetchImpl, pro) {
    const offer = pro || OMNIMIND_PRO;
    const token = await getAccessToken(config, fetchImpl);
    const res = await fetchImpl(`${config.base}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            intent: 'CAPTURE',
            purchase_units: [{
                description: PRO_DESCRIPTION,
                custom_id: 'omnimind_pro',
                amount: { currency_code: offer.currency || PRO_CURRENCY, value: String(offer.priceUsd) }
            }]
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
        const err = new Error((data.message) || 'Could not create PayPal order');
        err.status = 502;
        throw err;
    }
    return data;
}

function paypalIssues(data) {
    const details = data && Array.isArray(data.details) ? data.details : [];
    return details.map((item) => item && item.issue).filter(Boolean);
}

function approvedProUnit(order) {
    if (!order || order.status === 'COMPLETED') return null;
    const unit = order.purchase_units && order.purchase_units[0];
    const amount = unit && unit.amount;
    if (!unit || unit.custom_id !== 'omnimind_pro') return null;
    if (!amount || amount.value !== PRO_PRICE || amount.currency_code !== PRO_CURRENCY) return null;
    return unit;
}

function applyVerifiedCustomId(order, unit) {
    if (!order || order.status !== 'COMPLETED' || !unit) return order;
    const target = order.purchase_units && order.purchase_units[0];
    const capture = target && target.payments && target.payments.captures && target.payments.captures[0];
    if (!target || !capture || capture.status !== 'COMPLETED') return order;
    if (!target.custom_id) target.custom_id = unit.custom_id;
    if (!capture.amount) capture.amount = unit.amount;
    return order;
}

async function captureProOrder(config, fetchImpl, orderId) {
    if (!orderId || typeof orderId !== 'string') {
        const err = new Error('orderID is required');
        err.status = 400;
        throw err;
    }
    const token = await getAccessToken(config, fetchImpl);
    const current = await getOrder(config, fetchImpl, orderId, token);
    if (current.status === 'COMPLETED') return current;
    const unit = approvedProUnit(current);
    if (!unit) {
        const err = new Error('This PayPal order is not OmniMind Pro');
        err.status = 400;
        throw err;
    }
    const res = await fetchImpl(`${config.base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        if (paypalIssues(data).includes('ORDER_ALREADY_CAPTURED')) {
            const again = await getOrder(config, fetchImpl, orderId, token);
            if (again.status === 'COMPLETED') return again;
        }
        const err = new Error((data.message) || 'PayPal capture failed');
        err.status = 402;
        throw err;
    }
    if (readCompletedPurchase(data)) return data;
    const again = await getOrder(config, fetchImpl, orderId, token);
    if (readCompletedPurchase(again)) return again;
    return applyVerifiedCustomId(data.status === 'COMPLETED' ? data : again, unit);
}

async function getCapture(config, fetchImpl, captureId, token) {
    const access = token || await getAccessToken(config, fetchImpl);
    const res = await fetchImpl(`${config.base}/v2/payments/captures/${encodeURIComponent(captureId)}`, {
        headers: { Authorization: `Bearer ${access}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.message || 'Could not load PayPal capture');
        err.status = res.status === 404 ? 404 : 502;
        throw err;
    }
    return data;
}

function orderIdFromCapture(capture) {
    const related = capture && capture.supplementary_data && capture.supplementary_data.related_ids;
    if (related && related.order_id) return related.order_id;
    const links = capture && Array.isArray(capture.links) ? capture.links : [];
    for (let i = 0; i < links.length; i++) {
        const href = String(links[i] && links[i].href || '');
        const match = href.match(/\/v2\/checkout\/orders\/([^/?]+)/);
        if (match) return decodeURIComponent(match[1]);
    }
    return '';
}

async function purchaseFromPayPalReference(config, fetchImpl, reference) {
    const ref = String(reference || '').trim();
    if (!ref || ref.includes('@')) return null;
    const token = await getAccessToken(config, fetchImpl);
    let order = null;
    try {
        order = await getOrder(config, fetchImpl, ref, token);
    } catch (err) {
        if (!err || err.status === 404) order = null;
        else if (err.status && err.status !== 404) {
            /* fall through to the capture lookup */
            order = null;
        }
    }
    if (order && order.status === 'COMPLETED') {
        const purchase = readCompletedPurchase(order);
        if (purchase) return purchase;
    }
    let capture;
    try {
        capture = await getCapture(config, fetchImpl, ref, token);
    } catch (err) {
        if (err && err.status === 404) return null;
        throw err;
    }
    if (!capture || capture.status !== 'COMPLETED') return null;
    const orderId = orderIdFromCapture(capture);
    if (!orderId) return null;
    const linked = await getOrder(config, fetchImpl, orderId, token);
    return readCompletedPurchase(linked);
}

async function getOrder(config, fetchImpl, orderId, token) {
    const access = token || await getAccessToken(config, fetchImpl);
    const res = await fetchImpl(`${config.base}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
        headers: { Authorization: `Bearer ${access}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.message || 'Could not load PayPal order');
        err.status = 502;
        throw err;
    }
    return data;
}

function readCompletedPurchase(order) {
    if (!order || order.status !== 'COMPLETED') return null;
    const unit = order.purchase_units && order.purchase_units[0];
    if (!unit || unit.custom_id !== 'omnimind_pro') return null;
    const capture = unit.payments && unit.payments.captures && unit.payments.captures[0];
    if (!capture || capture.status !== 'COMPLETED') return null;
    const email = order.payer && order.payer.email_address;
    return {
        captureId: capture.id,
        orderId: order.id,
        email: email ? String(email).toLowerCase().trim() : '',
        value: capture.amount && capture.amount.value,
        currency: capture.amount && capture.amount.currency_code
    };
}

function assertProPrice(purchase, pro) {
    const offer = pro || OMNIMIND_PRO;
    const price = String(offer.priceUsd);
    const currency = offer.currency || PRO_CURRENCY;
    if (!purchase || purchase.value !== price || purchase.currency !== currency) {
        const err = new Error('Payment amount is not OmniMind Pro (' + formatOmniMindProPrice(offer) + ' ' + currency + ')');
        err.status = 400;
        throw err;
    }
    if (!purchase.captureId || !purchase.email) {
        const err = new Error('PayPal did not return a capture id and buyer email');
        err.status = 400;
        throw err;
    }
    return purchase;
}

function headerMap(headers) {
    const out = {};
    Object.keys(headers || {}).forEach((key) => {
        out[String(key).toLowerCase()] = headers[key];
    });
    return out;
}

/**
 * PAYMENT.CAPTURE.COMPLETED resource is the capture. Prefer the PayPal order
 * so the buyer email and amount come from PayPal, not from the webhook body.
 */
async function purchaseFromCaptureEvent(config, fetchImpl, event) {
    const resource = event && event.resource;
    if (!resource || resource.status !== 'COMPLETED' || !resource.id) return null;
    const related = resource.supplementary_data && resource.supplementary_data.related_ids;
    const orderId = related && related.order_id;
    if (orderId) {
        const order = await getOrder(config, fetchImpl, orderId);
        return readCompletedPurchase(order);
    }
    if (resource.custom_id !== 'omnimind_pro') return null;
    const payer = resource.payer || {};
    const email = payer.email_address || payer.email || '';
    return {
        captureId: resource.id,
        orderId: null,
        email: email ? String(email).toLowerCase().trim() : '',
        value: resource.amount && resource.amount.value,
        currency: resource.amount && resource.amount.currency_code
    };
}

async function verifyWebhookSignature(config, fetchImpl, headers, event) {
    if (!config.webhookId) {
        const err = new Error('PAYPAL_WEBHOOK_ID is required');
        err.status = 503;
        throw err;
    }
    const h = headerMap(headers);
    const token = await getAccessToken(config, fetchImpl);
    const res = await fetchImpl(`${config.base}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            auth_algo: h['paypal-auth-algo'],
            cert_url: h['paypal-cert-url'],
            transmission_id: h['paypal-transmission-id'],
            transmission_sig: h['paypal-transmission-sig'],
            transmission_time: h['paypal-transmission-time'],
            webhook_id: config.webhookId,
            webhook_event: event
        })
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && data.verification_status === 'SUCCESS';
}

module.exports = {
    OMNIMIND_PRO,
    formatOmniMindProPrice,
    PRO_PRICE,
    PRO_CURRENCY,
    PRO_DESCRIPTION,
    paypalApiBase,
    paypalConfig,
    getAccessToken,
    createProOrder,
    captureProOrder,
    getOrder,
    getCapture,
    purchaseFromPayPalReference,
    readCompletedPurchase,
    assertProPrice,
    purchaseFromCaptureEvent,
    verifyWebhookSignature
};
