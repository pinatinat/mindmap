let cached = null;

function loadAdmin() {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
        const err = new Error('FIREBASE_SERVICE_ACCOUNT is not set');
        err.status = 503;
        throw err;
    }
    let serviceAccount;
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (e) {
        const err = new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
        err.status = 503;
        throw err;
    }
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    return admin;
}

function getFirestore() {
    if (cached) return cached;
    const admin = loadAdmin();
    cached = admin.firestore();
    return cached;
}

async function verifyIdToken(token) {
    const admin = loadAdmin();
    return admin.auth().verifyIdToken(token);
}

module.exports = { getFirestore, verifyIdToken };
