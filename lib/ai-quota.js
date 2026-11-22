const { AI_MAP_LIMITS, profileIsOmniMindPro, aiDailyLimit } = require('../pro-config');

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Calendar day for the usage counter. Asia/Manila is UTC+8 year-round.
 * The fallback is that same fixed offset if Intl cannot name the zone.
 */
function aiDayKey(now, timeZone) {
    const date = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const zone = timeZone || AI_MAP_LIMITS.dayTimeZone;
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: zone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(date);
        const pick = (type) => {
            const part = parts.find((item) => item.type === type);
            return part ? part.value : '';
        };
        const key = pick('year') + '-' + pick('month') + '-' + pick('day');
        if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
    } catch (e) {}
    return new Date(date.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

function usageDocId(uid, day) {
    return String(uid) + '_' + day;
}

function quotaFrom(count, isPro, day) {
    const limit = aiDailyLimit(isPro);
    const used = Math.max(0, Number(count) || 0);
    return {
        pro: !!isPro,
        plan: isPro ? 'pro' : 'free',
        used,
        limit,
        remaining: Math.max(0, limit - used),
        day,
        timeZone: AI_MAP_LIMITS.dayTimeZone
    };
}

async function readProfile(tx, db, uid) {
    const snap = await tx.get(db.collection('users').doc(uid));
    return snap.exists ? snap.data() : null;
}

async function readAiQuota(db, input) {
    const now = input && input.now;
    const uid = input.uid;
    const day = aiDayKey(now);
    const usageRef = db.collection('ai_usage').doc(usageDocId(uid, day));
    const userRef = db.collection('users').doc(uid);
    return db.runTransaction(async (tx) => {
        const profileSnap = await tx.get(userRef);
        const usageSnap = await tx.get(usageRef);
        const profile = profileSnap.exists ? profileSnap.data() : null;
        const count = usageSnap.exists ? usageSnap.data().count : 0;
        return quotaFrom(count, profileIsOmniMindPro(profile), day);
    });
}

/**
 * Reserve one generation for this user and Manila day.
 * Reads the profile inside the transaction so the cap matches stored Pro.
 */
async function consumeAiQuota(db, input) {
    const now = input && input.now;
    const uid = input.uid;
    const day = aiDayKey(now);
    const usageRef = db.collection('ai_usage').doc(usageDocId(uid, day));
    const userRef = db.collection('users').doc(uid);
    return db.runTransaction(async (tx) => {
        const profile = await readProfile(tx, db, uid);
        const usageSnap = await tx.get(usageRef);
        const isPro = profileIsOmniMindPro(profile);
        const current = quotaFrom(usageSnap.exists ? usageSnap.data().count : 0, isPro, day);
        if (current.remaining <= 0) {
            return Object.assign({ allowed: false }, current);
        }
        const used = current.used + 1;
        tx.set(usageRef, {
            uid,
            day,
            count: used,
            timeZone: AI_MAP_LIMITS.dayTimeZone,
            updatedAt: new Date(now == null ? Date.now() : now).toISOString()
        });
        return Object.assign({ allowed: true }, quotaFrom(used, isPro, day));
    });
}

async function releaseAiQuota(db, input) {
    const uid = input.uid;
    const day = input.day || aiDayKey(input.now);
    const usageRef = db.collection('ai_usage').doc(usageDocId(uid, day));
    const userRef = db.collection('users').doc(uid);
    return db.runTransaction(async (tx) => {
        const profile = await readProfile(tx, db, uid);
        const usageSnap = await tx.get(usageRef);
        const isPro = profileIsOmniMindPro(profile);
        const count = usageSnap.exists ? Math.max(0, (Number(usageSnap.data().count) || 0) - 1) : 0;
        tx.set(usageRef, {
            uid,
            day,
            count,
            timeZone: AI_MAP_LIMITS.dayTimeZone,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        return Object.assign({ allowed: true }, quotaFrom(count, isPro, day));
    });
}

module.exports = {
    aiDayKey,
    usageDocId,
    readAiQuota,
    consumeAiQuota,
    releaseAiQuota
};
