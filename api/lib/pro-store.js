const crypto = require('crypto');

const MAX_DEVICES = 3;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateProCode(bytes) {
    const buf = bytes || crypto.randomBytes(8);
    let body = '';
    for (let i = 0; i < 8; i++) body += ALPHABET[buf[i] % ALPHABET.length];
    return `OMNI-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function normalizeCode(code) {
    return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Issue one Pro code per PayPal capture. A repeat call for the same capture
 * returns the original code and does not send another record.
 */
async function issueProCode(db, purchase, generate) {
    const makeCode = generate || generateProCode;
    const captureRef = db.collection('pro_captures').doc(purchase.captureId);
    return db.runTransaction(async (tx) => {
        const existing = await tx.get(captureRef);
        if (existing.exists) {
            const data = existing.data() || {};
            return { code: data.code, email: data.email, alreadyIssued: true };
        }
        let code = makeCode();
        for (let attempt = 0; attempt < 5; attempt++) {
            const taken = await tx.get(db.collection('pro_codes').doc(code));
            if (!taken.exists) break;
            code = makeCode();
        }
        const now = new Date().toISOString();
        tx.set(captureRef, {
            code,
            email: purchase.email,
            orderId: purchase.orderId || null,
            amount: purchase.value,
            currency: purchase.currency,
            createdAt: now
        });
        tx.set(db.collection('pro_codes').doc(code), {
            code,
            email: purchase.email,
            captureId: purchase.captureId,
            orderId: purchase.orderId || null,
            amount: purchase.value,
            currency: purchase.currency,
            devices: [],
            createdAt: now
        });
        return { code, email: purchase.email, alreadyIssued: false };
    });
}

async function activateProCode(db, { email, code, deviceId }) {
    const cleanEmail = normalizeEmail(email);
    const cleanCode = normalizeCode(code);
    const cleanDevice = String(deviceId || '').trim();
    if (!cleanEmail || !cleanEmail.includes('@') || !cleanCode || !cleanDevice) {
        return { ok: false, status: 400, error: 'Email, code, and device id are required' };
    }
    const ref = db.collection('pro_codes').doc(cleanCode);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { ok: false, status: 404, error: 'Code not found' };
        const data = snap.data() || {};
        if (normalizeEmail(data.email) !== cleanEmail) {
            return { ok: false, status: 403, error: 'Email does not match this code' };
        }
        const devices = Array.isArray(data.devices) ? data.devices.slice() : [];
        if (devices.some((device) => device && device.id === cleanDevice)) {
            return { ok: true, status: 200, email: cleanEmail, code: cleanCode, already: true };
        }
        if (devices.length >= MAX_DEVICES) {
            return { ok: false, status: 409, error: 'This code is already active on 3 devices' };
        }
        devices.push({ id: cleanDevice, activatedAt: new Date().toISOString() });
        tx.update(ref, { devices });
        return { ok: true, status: 200, email: cleanEmail, code: cleanCode, already: false };
    });
}

module.exports = {
    MAX_DEVICES,
    generateProCode,
    normalizeEmail,
    normalizeCode,
    issueProCode,
    activateProCode
};
