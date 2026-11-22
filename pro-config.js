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

// Daily AI map caps. Asia/Manila (UTC+8, no daylight saving) is the calendar day.
// Pro matches the client: a positive maxMaps, and plan omnimind_pro or maxMaps >= 50.
var AI_MAP_LIMITS = {
    freePerDay: 3,
    proPerDay: 30,
    dayTimeZone: 'Asia/Manila',
    proPlan: 'omnimind_pro',
    proMaxMaps: 50
};

function profileIsOmniMindPro(data) {
    if (!data || typeof data.maxMaps !== 'number' || !(data.maxMaps > 0)) return false;
    return data.plan === AI_MAP_LIMITS.proPlan || data.maxMaps >= AI_MAP_LIMITS.proMaxMaps;
}

function aiDailyLimit(isPro) {
    return isPro ? AI_MAP_LIMITS.proPerDay : AI_MAP_LIMITS.freePerDay;
}

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
        resolveCheckoutEnabled: resolveCheckoutEnabled,
        AI_MAP_LIMITS: AI_MAP_LIMITS,
        profileIsOmniMindPro: profileIsOmniMindPro,
        aiDailyLimit: aiDailyLimit
    };
}
