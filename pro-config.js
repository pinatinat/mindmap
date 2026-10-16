// Single Pro price. checkoutEnabled stays false until the price and PayPal button should appear.
var OMNIMIND_PRO = {
    priceUsd: '9.00',
    currency: 'USD',
    checkoutEnabled: false
};

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
        formatOmniMindProPrice: formatOmniMindProPrice
    };
}
