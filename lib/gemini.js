const GEMINI_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash',
    'gemini-2.5-pro',
    'gemini-1.5-pro'
];

const MAX_NODES = 80;
const MAX_DEPTH = 6;

function modelChain(preferred) {
    const chain = [];
    const first = String(preferred || '').trim();
    if (GEMINI_MODELS.indexOf(first) !== -1) chain.push(first);
    GEMINI_MODELS.forEach((model) => {
        if (chain.indexOf(model) === -1) chain.push(model);
    });
    return chain;
}

function upstreamError(message) {
    const err = new Error(message || 'The AI service could not generate a map.');
    err.status = 502;
    err.code = 'upstream';
    return err;
}

function notConfiguredError() {
    const err = new Error('AI not configured');
    err.status = 503;
    err.code = 'not_configured';
    return err;
}

function normalizeTree(rawText) {
    let parsed;
    try {
        parsed = JSON.parse(String(rawText || '').replace(/```json/gi, '').replace(/```/g, '').trim());
    } catch (e) {
        throw upstreamError('The AI service could not generate a map.');
    }
    if (parsed && !Array.isArray(parsed)) {
        if (Array.isArray(parsed.roots)) parsed = parsed.roots;
        else if (Array.isArray(parsed.mindmap)) parsed = parsed.mindmap;
        else parsed = [parsed];
    }
    const list = Array.isArray(parsed) ? parsed : [];
    const used = new Set();
    let count = 0;
    function node(obj, depth) {
        if (!obj || typeof obj !== 'object' || count >= MAX_NODES || depth > MAX_DEPTH) return null;
        let id = String(obj.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
        if (!id || used.has(id)) id = 'n' + count;
        used.add(id);
        count += 1;
        const topic = String(obj.topic || obj.text || obj.title || 'Idea').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Idea';
        const children = [];
        const rawKids = Array.isArray(obj.children) ? obj.children : [];
        rawKids.forEach((child) => {
            const next = node(child, depth + 1);
            if (next) children.push(next);
        });
        return { id, topic, children };
    }
    const roots = [];
    list.forEach((item) => {
        const next = node(item, 0);
        if (next) roots.push(next);
    });
    if (!roots.length) throw upstreamError('The AI service could not generate a map.');
    return roots;
}

function promptFor(topic) {
    return 'Generate a structured hierarchical mind map for: "' + topic + '". Return valid JSON as an array of root objects. Each root object should match this schema: {"id":"unique_id","topic":"Title","children":[{"id":"c1","topic":"Branch","children":[]}]}. Always return a JSON array of root objects.';
}

function isModelMissing(status, data) {
    const message = data && data.error && data.error.message ? String(data.error.message) : '';
    const code = data && data.error ? data.error.code : 0;
    return status === 404 || code === 404 || /not found/i.test(message);
}

/**
 * Calls Gemini with the key kept on the server. A missing model falls through
 * the existing chain. Any other failure stops the chain.
 */
async function generateMindMap(topic, options) {
    const opts = options || {};
    const apiKey = opts.apiKey;
    if (!apiKey) throw notConfiguredError();
    const fetchImpl = opts.fetchImpl || fetch;
    const payload = {
        contents: [{ parts: [{ text: promptFor(topic) }] }],
        generationConfig: { responseMimeType: 'application/json' }
    };
    let lastMissing = '';
    const chain = modelChain(opts.preferredModel);
    for (let i = 0; i < chain.length; i++) {
        const model = chain[i];
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
        let res;
        try {
            res = await fetchImpl(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify(payload)
            });
        } catch (e) {
            throw upstreamError('The AI service could not generate a map.');
        }
        const data = await res.json().catch(() => ({}));
        if (data && data.error) {
            if (isModelMissing(res.status, data)) {
                lastMissing = model;
                continue;
            }
            throw upstreamError('The AI service could not generate a map.');
        }
        const text = data && data.candidates && data.candidates[0]
            && data.candidates[0].content && data.candidates[0].content.parts
            && data.candidates[0].content.parts[0]
            && data.candidates[0].content.parts[0].text;
        if (text) {
            return { tree: normalizeTree(text), model };
        }
        lastMissing = model;
    }
    if (lastMissing) throw upstreamError('The AI service could not generate a map.');
    throw upstreamError('The AI service could not generate a map.');
}

module.exports = {
    GEMINI_MODELS,
    modelChain,
    normalizeTree,
    generateMindMap
};
