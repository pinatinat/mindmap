const { paypalConfig, createProOrder } = require('../lib/paypal');
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
    await run(res, async () => {
        const config = deps.config || paypalConfig();
        const fetchImpl = deps.fetchImpl || fetch;
        const order = await createProOrder(config, fetchImpl);
        sendJson(res, 200, { id: order.id });
    });
}

module.exports = (req, res) => handleCreateOrder(req, res);
module.exports.handleCreateOrder = handleCreateOrder;
