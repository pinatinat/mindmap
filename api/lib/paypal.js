const PRO_PRICE = '9.00';
const PRO_CURRENCY = 'USD';
const PRO_DESCRIPTION = 'OmniMind Pro (one-time)';

function paypalApiBase(env) {
    return env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

function paypalConfig(env = process.env) {
    const clientId = env.PAYPAL_CLIENT_ID;
    const secret = env.PAYPAL_CLIENT_SECRET;
    const webhookId = env.PAYPAL_WEBHOOK_ID;
    const mode = (env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';
    return { clientId, secret, webhookId, mode, base: paypalApiBase(mode) };
}

async function getAccessToken(config, fetchImpl) {
    if (!config.clientId || !config.secret) {
        const err = new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required');
        err.status = 503;
        throw err;
    }
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
        err.status = 502;
        throw err;
    }
    return data.access_token;
}

async function createProOrder(config, fetchImpl) {
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
                amount: { currency_code: PRO_CURRENCY, value: PRO_PRICE }
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

async function captureProOrder(config, fetchImpl, orderId) {
    if (!orderId || typeof orderId !== 'string') {
        const err = new Error('orderID is required');
        err.status = 400;
        throw err;
    }
    const token = await getAccessToken(config, fetchImpl);
    const res = await fetchImpl(`${config.base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error((data.message) || 'PayPal capture failed');
        err.status = 402;
        throw err;
    }
    return data;
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
    const capture = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
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

function assertProPrice(purchase) {
    if (!purchase || purchase.value !== PRO_PRICE || purchase.currency !== PRO_CURRENCY) {
        const err = new Error('Payment amount is not OmniMind Pro ($9.00 USD)');
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
    PRO_PRICE,
    PRO_CURRENCY,
    PRO_DESCRIPTION,
    paypalApiBase,
    paypalConfig,
    getAccessToken,
    createProOrder,
    captureProOrder,
    getOrder,
    readCompletedPurchase,
    assertProPrice,
    purchaseFromCaptureEvent,
    verifyWebhookSignature
};
