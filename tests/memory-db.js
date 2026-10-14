function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createMemoryDb() {
    const docs = new Map();
    return {
        docs,
        collection(name) {
            return {
                doc(id) {
                    const path = `${name}/${id}`;
                    return { path };
                }
            };
        },
        async runTransaction(fn) {
            const writes = [];
            const tx = {
                async get(docRef) {
                    const value = docs.get(docRef.path);
                    return {
                        exists: value !== undefined,
                        data() { return clone(value); }
                    };
                },
                set(docRef, data) {
                    writes.push(() => docs.set(docRef.path, clone(data)));
                },
                update(docRef, data) {
                    writes.push(() => {
                        const current = docs.get(docRef.path) || {};
                        docs.set(docRef.path, Object.assign({}, current, clone(data)));
                    });
                }
            };
            const result = await fn(tx);
            writes.forEach((write) => write());
            return result;
        }
    };
}

module.exports = { createMemoryDb };
