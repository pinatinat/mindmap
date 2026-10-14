async function sendProCodeEmail({ fetchImpl, apiKey, to, code }) {
    if (!apiKey) return { emailed: false, reason: 'RESEND_API_KEY is not set' };
    const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: 'OmniMind <support@omnimindmap.app>',
            to: [to],
            subject: 'Your OmniMind Pro code',
            text: [
                'Thanks for buying OmniMind Pro ($9, one-time).',
                '',
                `Your code: ${code}`,
                `Buyer email: ${to}`,
                '',
                'In OmniMind, open OmniMind Pro and enter this email and code.',
                'A code works on up to 3 devices.',
                '',
                'Questions: support@omnimindmap.app'
            ].join('\n')
        })
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { emailed: false, reason: body || `Resend status ${res.status}` };
    }
    return { emailed: true };
}

module.exports = { sendProCodeEmail };
