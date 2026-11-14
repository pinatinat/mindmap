const { issueProCode } = require('./pro-store');
const { sendProCodeEmail } = require('./email');
const { assertProPrice } = require('./paypal');

async function fulfillPurchase({ db, purchase, fetchImpl, resendKey }) {
    const checked = assertProPrice(purchase);
    const issued = await issueProCode(db, checked);
    let emailResult = { emailed: false, reason: 'already issued' };
    if (!issued.alreadyIssued) {
        emailResult = await sendProCodeEmail({
            fetchImpl: fetchImpl || fetch,
            apiKey: resendKey,
            to: issued.email,
            code: issued.code
        });
    }
    return {
        ok: true,
        code: issued.code,
        email: issued.email,
        alreadyIssued: issued.alreadyIssued,
        emailed: !!emailResult.emailed
    };
}

module.exports = { fulfillPurchase };
