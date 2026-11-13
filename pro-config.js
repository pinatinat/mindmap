// Single Pro price. The shipped flag stays false. Preview and an explicit
// OMNIMIND_CHECKOUT opt-in can turn it on only while the PayPal sandbox API is in use.
// Production (VERCEL_ENV=production) never turns it on.
var PAYPAL_SANDBOX_API = 'https://api-m.sandbox.paypal.com';
var PAYPAL_LIVE_API = 'https://api-m.paypal.com';

var OMNIMIND_PRO = {
    priceUsd: '9.00',
    currency: 'USD',
    checkoutEnabled: false
};

function resolvePaypalMode(env) {
    var source = env || {};
    var vercel = String(source.VERCEL_ENV || '');
    if (vercel === 'preview' || vercel === 'development') return 'sandbox';
    return String(source.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';
}

function paypalApiBase(mode) {
    return mode === 'live' ? PAYPAL_LIVE_API : PAYPAL_SANDBOX_API;
}

function resolveCheckoutEnabled(env) {
    var source = env || {};
    if (String(source.VERCEL_ENV || '') === 'production') return false;
    if (paypalApiBase(resolvePaypalMode(source)) !== PAYPAL_SANDBOX_API) return false;
    var vercel = String(source.VERCEL_ENV || '');
    if (vercel === 'preview' || vercel === 'development') return true;
    var flag = String(source.OMNIMIND_CHECKOUT || '').toLowerCase();
    return flag === '1' || flag === 'true' || flag === 'yes';
}

function formatOmniMindProPrice(config) {
    var cfg = config || OMNIMIND_PRO;
    var raw = String(cfg.priceUsd);
    var display = /\.00$/.test(raw) ? String(Number(raw)) : raw;
    if ((cfg.currency || 'USD') === 'USD') return '$' + display;
    return display + ' ' + cfg.currency;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        OMNIMIND_PRO: OMNIMIND_PRO,
        formatOmniMindProPrice: formatOmniMindProPrice,
        PAYPAL_SANDBOX_API: PAYPAL_SANDBOX_API,
        PAYPAL_LIVE_API: PAYPAL_LIVE_API,
        resolvePaypalMode: resolvePaypalMode,
        paypalApiBase: paypalApiBase,
        resolveCheckoutEnabled: resolveCheckoutEnabled
    };
}
