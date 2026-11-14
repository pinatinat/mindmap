const { resolveCheckoutEnabled } = require('../pro-config');

function handleProCheckoutScript(req, res, deps = {}) {
    const enabled = resolveCheckoutEnabled(deps.env || process.env) === true;
    const body = 'if(typeof OMNIMIND_PRO!=="undefined")OMNIMIND_PRO.checkoutEnabled=' + (enabled ? 'true' : 'false') + ';\n';
    res.statusCode = 200;
    if (typeof res.setHeader === 'function') {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
    }
    if (typeof res.end === 'function') res.end(body);
    else res.body = body;
}

module.exports = (req, res) => handleProCheckoutScript(req, res);
module.exports.handleProCheckoutScript = handleProCheckoutScript;
