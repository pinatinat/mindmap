// Shared copy and query parsing for Pro code redemption.
// Loaded in the browser as a classic script and required by the activation API.
var PRO_REDEEM_ERRORS = {
    notFound: 'Unknown code. Check the code and try again.',
    emailMismatch: 'That email does not match this code.',
    deviceLimit: 'This code is already active on 3 devices.'
};

function normalizeRedeemCode(code) {
    return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

function proRedeemErrorText(status, serverError) {
    var code = Number(status);
    if (code === 404) return PRO_REDEEM_ERRORS.notFound;
    if (code === 403) return PRO_REDEEM_ERRORS.emailMismatch;
    if (code === 409) return PRO_REDEEM_ERRORS.deviceLimit;
    return serverError || 'Activation failed';
}

/**
 * Read ?code= from a search string and return the search with that param removed.
 * Other params (for example share=) stay. An empty code is still marked as present
 * so the page can strip it without opening the form.
 */
function consumeCodeQuery(search) {
    var raw = String(search || '');
    var body = raw.charAt(0) === '?' ? raw.slice(1) : raw;
    var params = new URLSearchParams(body);
    var hadCode = params.has('code');
    var code = hadCode ? normalizeRedeemCode(params.get('code')) : '';
    if (hadCode) params.delete('code');
    var next = params.toString();
    return {
        code: code,
        hadCode: hadCode,
        search: next ? '?' + next : ''
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        PRO_REDEEM_ERRORS: PRO_REDEEM_ERRORS,
        normalizeRedeemCode: normalizeRedeemCode,
        proRedeemErrorText: proRedeemErrorText,
        consumeCodeQuery: consumeCodeQuery
    };
}
