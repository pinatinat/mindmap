/**
 * OmniMind PayMongo Webhook Handler for Vercel Serverless
 * 
 * Automatically upgrades paying customers to "Lifetime Pro" (50 Cloud Map Slots)
 * Supports PayMongo events:
 *  - link.payment.paid
 *  - checkout_session.payment.paid
 *  - payment.paid
 */

const crypto = require('crypto');

// Optional: If you install firebase-admin and set FIREBASE_SERVICE_ACCOUNT in Vercel
let admin = null;
try {
    admin = require('firebase-admin');
    if (!admin.apps.length && process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
} catch (e) {
    // firebase-admin not installed or env var not set yet
}

module.exports = async (req, res) => {
    // Only accept POST requests
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        const signatureHeader = req.headers['paymongo-signature'];
        const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;

        // Verify PayMongo webhook signature if secret is configured
        if (webhookSecret && signatureHeader) {
            try {
                // Header format: t=timestamp,te=test_sig,li=live_sig
                const parts = signatureHeader.split(',').reduce((acc, part) => {
                    const [k, v] = part.split('=');
                    if (k && v) acc[k.trim()] = v.trim();
                    return acc;
                }, {});

                const timestamp = parts['t'];
                const signature = parts['li'] || parts['te'];

                if (timestamp && signature) {
                    const comparisonString = `${timestamp}.${rawBody}`;
                    const expectedSig = crypto
                        .createHmac('sha256', webhookSecret)
                        .update(comparisonString)
                        .digest('hex');

                    if (signature !== expectedSig) {
                        console.warn('⚠️ PayMongo webhook signature mismatch');
                        return res.status(400).json({ error: 'Invalid webhook signature' });
                    }
                }
            } catch (sigErr) {
                console.warn('⚠️ Error during signature verification:', sigErr.message);
            }
        }

        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const event = body.data;

        if (!event || !event.attributes) {
            return res.status(400).json({ error: 'Invalid payload structure' });
        }

        const eventType = event.attributes.type;
        console.log(`🔔 PayMongo Webhook received event: ${eventType}`);

        // Extract payment attributes
        const paymentData = event.attributes.data;
        const paymentAttrs = (paymentData && paymentData.attributes) || {};

        // 1. Locate User UID or Client Reference
        let userId = null;
        let customerEmail = null;

        // Try extracting UID from client_reference_id or description or metadata
        if (paymentAttrs.client_reference_id) {
            userId = paymentAttrs.client_reference_id;
        } else if (paymentAttrs.description && paymentAttrs.description.startsWith('uid:')) {
            userId = paymentAttrs.description.replace('uid:', '').trim();
        } else if (paymentAttrs.metadata && paymentAttrs.metadata.uid) {
            userId = paymentAttrs.metadata.uid;
        }

        // Try extracting email
        if (paymentAttrs.billing && paymentAttrs.billing.email) {
            customerEmail = paymentAttrs.billing.email.toLowerCase().trim();
        }

        const amountCentavos = paymentAttrs.amount || 29900;
        const amountPhp = amountCentavos / 100;
        const paymentId = (paymentData && paymentData.id) || event.id;

        console.log(`💰 Payment verified: ₱${amountPhp} for UID: ${userId || 'unknown'} / Email: ${customerEmail || 'unknown'}`);

        // 2. If Firebase Admin is initialized, automatically update Firestore
        if (admin && admin.apps.length) {
            const db = admin.firestore();
            const updateData = {
                maxMaps: 50,
                plan: 'lifetime_pro',
                upgradedAt: admin.firestore.FieldValue.serverTimestamp(),
                paymentId: paymentId,
                paymentAmount: amountPhp,
                paymentSource: 'paymongo',
                updatedBy: 'webhook'
            };

            if (userId) {
                await db.collection('users').doc(userId).set(updateData, { merge: true });
                console.log(`✅ Firestore upgraded users/${userId} to Lifetime Pro (50 maps)`);
            } else if (customerEmail) {
                // Lookup user by email in users collection
                const querySnap = await db.collection('users').where('email', '==', customerEmail).get();
                if (!querySnap.empty) {
                    for (const doc of querySnap.docs) {
                        await doc.ref.set(updateData, { merge: true });
                        console.log(`✅ Firestore upgraded user doc ${doc.id} (${customerEmail})`);
                    }
                } else {
                    // Record in pending_upgrades collection so user gets upgraded upon next login
                    await db.collection('pending_upgrades').doc(customerEmail).set({
                        ...updateData,
                        email: customerEmail
                    }, { merge: true });
                    console.log(`📝 Recorded pending upgrade for email: ${customerEmail}`);
                }
            }
        }

        return res.status(200).json({
            received: true,
            eventType: eventType,
            userId: userId,
            customerEmail: customerEmail,
            upgraded: !!(userId || customerEmail)
        });
    } catch (err) {
        console.error('❌ PayMongo webhook error:', err);
        return res.status(500).json({ error: 'Internal server error', message: err.message });
    }
};

