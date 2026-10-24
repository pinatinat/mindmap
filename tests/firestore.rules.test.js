const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds
} = require('@firebase/rules-unit-testing');
const {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc
} = require('firebase/firestore');

const PROJECT_ID = 'demo-omnimind';
const RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

let testEnv;

function mapDoc(extra = {}) {
    return Object.assign({
        name: 'Shared map',
        userId: 'owner',
        nodeCount: 1,
        data: { nodes: { root: { text: 'Idea' } } }
    }, extra);
}

function bigData(keys) {
    const data = {};
    for (let i = 0; i < keys; i++) data['k' + i] = i;
    return data;
}

async function seed() {
    await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'users/owner'), {
            displayName: 'Owner',
            plan: 'free',
            maxMaps: 3
        });
        await setDoc(doc(db, 'users/owner/maps/private1'), mapDoc({ name: 'Private' }));
        await setDoc(doc(db, 'users/owner/maps/view1'), mapDoc({
            shareSettings: {
                accessLevel: 'view',
                allowCopy: true,
                invitedEmails: [],
                editorEmails: []
            }
        }));
        await setDoc(doc(db, 'users/owner/maps/edit1'), mapDoc({
            shareSettings: {
                accessLevel: 'edit',
                allowCopy: true,
                invitedEmails: [],
                editorEmails: []
            }
        }));
        await setDoc(doc(db, 'users/owner/maps/restricted1'), mapDoc({
            name: 'Restricted',
            shareSettings: {
                accessLevel: 'restricted',
                allowCopy: false,
                invitedEmails: ['guest@example.com', 'editor@example.com'],
                editorEmails: ['editor@example.com']
            }
        }));
    });
}

test.before(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules: RULES }
    });
});

test.after(async () => {
    if (testEnv) await testEnv.cleanup();
});

test.beforeEach(async () => {
    await testEnv.clearFirestore();
    await seed();
});

function asUser(uid, token) {
    return testEnv.authenticatedContext(uid, token).firestore();
}

test('owner can read their profile and cannot list users', async () => {
    const owner = asUser('owner', { email: 'owner@example.com', email_verified: true });
    await assertSucceeds(getDoc(doc(owner, 'users/owner')));
    await assertFails(getDocs(collection(owner, 'users')));
});

test('another signed-in user, anonymous, and signed-out cannot read a profile', async () => {
    const other = asUser('other', { email: 'other@example.com', email_verified: true });
    const anon = asUser('anon-1', { firebase: { sign_in_provider: 'anonymous' } });
    const signedOut = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(other, 'users/owner')));
    await assertFails(getDoc(doc(anon, 'users/owner')));
    await assertFails(getDoc(doc(signedOut, 'users/owner')));
    await assertFails(getDocs(collection(other, 'users')));
});

test('owner can create and update a profile but cannot self-set plan fields', async () => {
    const fresh = asUser('fresh', { email: 'fresh@example.com', email_verified: true });
    const sneaky = asUser('sneaky', { email: 'sneaky@example.com', email_verified: true });
    const owner = asUser('owner', { email: 'owner@example.com', email_verified: true });
    await assertSucceeds(setDoc(doc(fresh, 'users/fresh'), { displayName: 'Fresh', email: 'fresh@example.com' }));
    await assertFails(setDoc(doc(sneaky, 'users/sneaky'), { displayName: 'Sneaky', plan: 'omnimind_pro' }));
    await assertFails(updateDoc(doc(owner, 'users/owner'), { plan: 'omnimind_pro' }));
    await assertFails(updateDoc(doc(owner, 'users/owner'), { maxMaps: 50 }));
    await assertFails(updateDoc(doc(owner, 'users/owner'), { codeUsed: 'OMNI-ABCD-2345' }));
    await assertFails(updateDoc(doc(owner, 'users/owner'), { proActivatedAt: '2026-10-24T00:00:00.000Z' }));
    await assertSucceeds(updateDoc(doc(owner, 'users/owner'), { displayName: 'Owner renamed' }));
});

test('owner can list, get, create, update, and delete their maps', async () => {
    const owner = asUser('owner', { email: 'owner@example.com', email_verified: true });
    await assertSucceeds(getDocs(collection(owner, 'users/owner/maps')));
    await assertSucceeds(getDoc(doc(owner, 'users/owner/maps/private1')));
    await assertSucceeds(setDoc(doc(owner, 'users/owner/maps/new1'), mapDoc({ name: 'New' })));
    await assertSucceeds(updateDoc(doc(owner, 'users/owner/maps/private1'), { name: 'Renamed', updatedAt: Date.now() }));
    await assertSucceeds(setDoc(doc(owner, 'users/owner/maps/private1'), {
        shareSettings: {
            accessLevel: 'restricted',
            allowCopy: true,
            invitedMembers: [{ email: 'editor@example.com', role: 'edit' }],
            invitedEmails: ['editor@example.com'],
            editorEmails: ['editor@example.com'],
            updatedAt: Date.now()
        }
    }, { merge: true }));
    await assertSucceeds(deleteDoc(doc(owner, 'users/owner/maps/private1')));
    await assertFails(setDoc(doc(owner, 'users/owner/maps/bad1'), { name: 12, data: { nodes: {} } }));
    await assertFails(setDoc(doc(owner, 'users/owner/maps/bad2'), { name: 'Ok', data: 'nope' }));
});

test('view access allows get but never list, and blocks writes from non-owners', async () => {
    const viewer = asUser('viewer', { email: 'viewer@example.com', email_verified: true });
    const anon = asUser('anon-2', { firebase: { sign_in_provider: 'anonymous' } });
    const signedOut = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(getDoc(doc(viewer, 'users/owner/maps/view1')));
    await assertSucceeds(getDoc(doc(anon, 'users/owner/maps/view1')));
    await assertFails(getDoc(doc(signedOut, 'users/owner/maps/view1')));
    await assertFails(getDocs(collection(viewer, 'users/owner/maps')));
    await assertFails(getDocs(collection(anon, 'users/owner/maps')));
    await assertFails(getDoc(doc(viewer, 'users/owner/maps/private1')));
    await assertFails(updateDoc(doc(viewer, 'users/owner/maps/view1'), {
        data: { nodes: { root: { text: 'changed' } } },
        nodeCount: 1,
        updatedAt: Date.now()
    }));
    await assertFails(deleteDoc(doc(viewer, 'users/owner/maps/view1')));
    await assertFails(setDoc(doc(viewer, 'users/owner/maps/forged'), mapDoc()));
});

test('edit access lets a collaborator update map content only', async () => {
    const editor = asUser('editor', { email: 'editor@example.com', email_verified: false });
    const anon = asUser('anon-3', { firebase: { sign_in_provider: 'anonymous' } });
    const content = {
        data: { nodes: { root: { text: 'team edit' } } },
        nodeCount: 2,
        updatedAt: Date.now()
    };

    await assertSucceeds(getDoc(doc(editor, 'users/owner/maps/edit1')));
    await assertSucceeds(setDoc(doc(editor, 'users/owner/maps/edit1'), content, { merge: true }));
    await assertSucceeds(updateDoc(doc(anon, 'users/owner/maps/edit1'), {
        data: { nodes: { root: { text: 'anon edit' } } },
        nodeCount: 3,
        updatedAt: Date.now()
    }));
    await assertFails(getDocs(collection(editor, 'users/owner/maps')));
    await assertFails(updateDoc(doc(editor, 'users/owner/maps/edit1'), { name: 'hijack' }));
    await assertFails(updateDoc(doc(editor, 'users/owner/maps/edit1'), { userId: 'editor' }));
    await assertFails(updateDoc(doc(editor, 'users/owner/maps/edit1'), {
        shareSettings: { accessLevel: 'edit', invitedEmails: ['editor@example.com'], editorEmails: ['editor@example.com'] }
    }));
    await assertFails(updateDoc(doc(editor, 'users/owner/maps/edit1'), {
        data: { nodes: {} },
        nodeCount: 1,
        updatedAt: Date.now(),
        name: 'still hijack'
    }));
    await assertFails(deleteDoc(doc(editor, 'users/owner/maps/edit1')));
    await assertFails(setDoc(doc(editor, 'users/owner/maps/edit-new'), mapDoc()));
    await assertFails(updateDoc(doc(editor, 'users/owner/maps/edit1'), {
        data: bigData(41),
        nodeCount: 1,
        updatedAt: Date.now()
    }));
});

test('restricted maps require a verified email on the invite or editor list', async () => {
    const verifiedGuest = asUser('guest', { email: 'Guest@Example.com', email_verified: true });
    const unverifiedGuest = asUser('guest-unverified', { email: 'guest@example.com', email_verified: false });
    const verifiedEditor = asUser('editor-verified', { email: 'editor@example.com', email_verified: true });
    const verifiedStranger = asUser('stranger', { email: 'stranger@example.com', email_verified: true });
    const anon = asUser('anon-4', { firebase: { sign_in_provider: 'anonymous' } });
    const signedOut = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(getDoc(doc(verifiedGuest, 'users/owner/maps/restricted1')));
    await assertFails(updateDoc(doc(verifiedGuest, 'users/owner/maps/restricted1'), {
        data: { nodes: { root: { text: 'viewer write' } } },
        nodeCount: 1,
        updatedAt: Date.now()
    }));
    await assertFails(getDoc(doc(unverifiedGuest, 'users/owner/maps/restricted1')));
    await assertFails(getDoc(doc(verifiedStranger, 'users/owner/maps/restricted1')));
    await assertFails(getDoc(doc(anon, 'users/owner/maps/restricted1')));
    await assertFails(getDoc(doc(signedOut, 'users/owner/maps/restricted1')));
    await assertFails(getDocs(collection(verifiedGuest, 'users/owner/maps')));

    await assertSucceeds(getDoc(doc(verifiedEditor, 'users/owner/maps/restricted1')));
    await assertSucceeds(updateDoc(doc(verifiedEditor, 'users/owner/maps/restricted1'), {
        data: { nodes: { root: { text: 'editor write' } } },
        nodeCount: 4,
        updatedAt: Date.now()
    }));
    await assertFails(updateDoc(doc(verifiedEditor, 'users/owner/maps/restricted1'), {
        shareSettings: {
            accessLevel: 'edit',
            invitedEmails: ['editor@example.com'],
            editorEmails: ['editor@example.com']
        }
    }));
    await assertFails(updateDoc(doc(verifiedEditor, 'users/owner/maps/restricted1'), { name: 'nope' }));
    await assertFails(updateDoc(doc(verifiedEditor, 'users/owner/maps/restricted1'), { userId: 'editor-verified' }));
    await assertFails(deleteDoc(doc(verifiedEditor, 'users/owner/maps/restricted1')));
});

test('clients cannot read pro codes or rate limit counters', async () => {
    const owner = asUser('owner', { email: 'owner@example.com', email_verified: true });
    await assertFails(getDoc(doc(owner, 'pro_codes/OMNI-ABCD-2345')));
    await assertFails(getDoc(doc(owner, 'rate_limits/ip_abc')));
    await assertFails(setDoc(doc(owner, 'rate_limits/ip_abc'), { count: 0 }));
});
