const { paypalConfig, createProOrder, OMNIMIND_PRO } = require('../lib/paypal');
const { sendJson, run } = require('../lib/http');

async function handleCreateOrder(req, res, deps = {}) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 204, {});
        return;
    }
    if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'Method not allowed' });
        return;
    }
    const pro = deps.pro || OMNIMIND_PRO;
    if (!pro.checkoutEnabled) {
        sendJson(res, 403, { ok: false, error: 'OmniMind Pro checkout is not open yet' });
        return;
    }
    await run(res, async () => {
        const config = deps.config || paypalConfig();
        const fetchImpl = deps.fetchImpl || fetch;
        const order = await createProOrder(config, fetchImpl, pro);
        sendJson(res, 200, { id: order.id });
    });
}

module.exports = (req, res) => handleCreateOrder(req, res);
module.exports.handleCreateOrder = handleCreateOrder;
