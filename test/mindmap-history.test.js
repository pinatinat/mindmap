const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const history = require('../js/mindmap-history.js');

function snap(nodes, extra) {
    return Object.assign({
        nodes,
        canvasDecorations: {},
        canvasBgColor: '#f8fafc',
        canvasGridStyle: 'dots',
        selectedNodeId: null,
        selectedDecorationId: null
    }, extra || {});
}

test('one typed word is a single undo step, and the next edit is another', () => {
    const h = history.createHistory();
    h.reset(snap({ a: { id: 'a', text: '' } }));
    h.commit(snap({ a: { id: 'a', text: 'h' } }), { coalesceKey: 'text:a' });
    h.commit(snap({ a: { id: 'a', text: 'he' } }), { coalesceKey: 'text:a' });
    h.commit(snap({ a: { id: 'a', text: 'hello' } }), { coalesceKey: 'text:a' });
    h.seal();
    h.commit(snap({ a: { id: 'a', text: 'hello!' } }), { coalesceKey: 'text:a' });
    h.commit(snap({ a: { id: 'a', text: 'hello!!' } }), { coalesceKey: 'text:a' });

    assert.equal(h.undo().nodes.a.text, 'hello');
    assert.equal(h.undo().nodes.a.text, '');
    assert.equal(h.canUndo(), false);
    assert.equal(h.redo().nodes.a.text, 'hello');
});

test('a whole drag is one step even when every pixel is committed', () => {
    const h = history.createHistory();
    h.reset(snap({ a: { id: 'a', x: 0, y: 0 } }));
    for (let x = 1; x <= 40; x += 1) {
        const result = h.commit(snap({ a: { id: 'a', x, y: x / 2 } }), { coalesceKey: 'drag:a' });
        if (x === 1) assert.equal(result.coalesced, false);
        else assert.equal(result.coalesced, true);
    }
    h.seal();
    assert.equal(h.undo().nodes.a.x, 0);
    assert.equal(h.canUndo(), false);
    assert.equal(h.redo().nodes.a.x, 40);
});

test('identical snapshots and suspended edits do not create steps', () => {
    const h = history.createHistory();
    const base = snap({ a: { id: 'a', text: 'Same' } });
    h.reset(base);
    assert.equal(h.commit(snap({ a: { id: 'a', text: 'Same' } })).reason, 'unchanged');
    assert.equal(history.recordMapEdit(h, snap({ a: { id: 'a', text: 'Next' } }), {
        ready: true,
        suspended: true
    }).reason, 'skipped');
    assert.equal(history.recordMapEdit(h, snap({ a: { id: 'a', text: 'Next' } }), {
        ready: true,
        applying: true
    }).reason, 'skipped');
    assert.equal(h.canUndo(), false);
    assert.equal(history.recordMapEdit(h, snap({ a: { id: 'a', text: 'Next' } }), {
        ready: true,
        coalesceKey: null
    }).recorded, true);
    assert.equal(h.canUndo(), true);
});

test('undo and redo autosave the restored snapshot and can pan to it', () => {
    const h = history.createHistory();
    h.reset(snap({ a: { id: 'a', parentId: null, text: 'Here', x: 100, y: 100 } }));
    h.commit(snap({ a: { id: 'a', parentId: null, text: 'Here', x: 4000, y: 100 } }));
    const saves = [];
    const pans = [];
    const undone = history.navigateHistory(h, 'undo', {
        apply(snapshot) { saves.push(['apply', snapshot.nodes.a.x]); },
        viewport: { panX: 0, panY: 0, zoom: 1, viewWidth: 800, viewHeight: 600, padLeft: 20, padRight: 20, padTop: 20, padBottom: 20 },
        applyPan(pan) { pans.push(pan); },
        save(snapshot) { saves.push(['save', snapshot.nodes.a.x]); }
    });
    assert.equal(undone.applied, true);
    assert.deepEqual(saves, [['apply', 100], ['save', 100]]);
    assert.equal(pans.length, 0, 'the restored node is already on screen');

    const redone = history.navigateHistory(h, 'redo', {
        viewport: { panX: 0, panY: 0, zoom: 1, viewWidth: 800, viewHeight: 600, padLeft: 20, padRight: 20, padTop: 20, padBottom: 20 },
        applyPan(pan) { pans.push(pan); },
        save(snapshot) { saves.push(['save', snapshot.nodes.a.x]); }
    });
    assert.equal(redone.applied, true);
    assert.equal(pans.length, 1);
    assert.equal(pans[0].changed, true);
    assert.ok(pans[0].panX < 0, 'pans left so the off-screen node comes back');
    const screenX = pans[0].panX + 4000;
    assert.ok(screenX >= 20 && screenX <= 780);
    assert.equal(saves[saves.length - 1][0], 'save');
    assert.equal(history.navigateHistory(h, 'redo', { save() { saves.push('extra'); } }).applied, false);
    assert.equal(saves.includes('extra'), false);
});

test('an on-screen change does not move the viewport', () => {
    const before = snap({ a: { id: 'a', parentId: null, text: 'A', x: 200, y: 180, bg: '#fff' } });
    const after = snap({ a: { id: 'a', parentId: null, text: 'A', x: 200, y: 180, bg: '#ef4444' } });
    const rects = history.diffFocusRects(before, after);
    const pan = history.panToRevealRects({
        panX: 40, panY: 30, zoom: 1, viewWidth: 900, viewHeight: 700,
        padLeft: 16, padRight: 16, padTop: 16, padBottom: 16
    }, rects);
    assert.equal(pan.changed, false);
    assert.equal(pan.panX, 40);
    assert.equal(pan.panY, 30);
});

test('a change below the viewport is panned into view without recentering a small box', () => {
    const pan = history.panToRevealRects({
        panX: 0, panY: 0, zoom: 1, viewWidth: 800, viewHeight: 600,
        padLeft: 10, padRight: 10, padTop: 10, padBottom: 10
    }, [{ x: 100, y: 900, w: 80, h: 40 }]);
    assert.equal(pan.changed, true);
    const bottom = pan.panY + 940;
    assert.ok(bottom <= 590);
    assert.ok(bottom >= 500);
});

test('shortcuts ignore typing targets and open dialogs', () => {
    const undo = { key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
    const redoShift = { key: 'Z', ctrlKey: false, metaKey: true, shiftKey: true, altKey: false };
    const redoY = { key: 'y', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
    const plain = { key: 'z', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };

    assert.equal(history.undoShortcutFromEvent(undo), 'undo');
    assert.equal(history.undoShortcutFromEvent(redoShift), 'redo');
    assert.equal(history.undoShortcutFromEvent(redoY), 'redo');
    assert.equal(history.undoShortcutFromEvent(plain), null);
    assert.equal(history.undoShortcutFromEvent({ key: 'z', ctrlKey: true, altKey: true }), null);

    assert.equal(history.shouldHandleUndoShortcut(undo, { target: { tagName: 'TEXTAREA' } }).handle, false);
    assert.equal(history.shouldHandleUndoShortcut(undo, { target: { tagName: 'INPUT' } }).handle, false);
    assert.equal(history.shouldHandleUndoShortcut(undo, { target: { tagName: 'DIV', isContentEditable: true } }).handle, false);
    assert.equal(history.shouldHandleUndoShortcut(undo, { dialogOpen: true, target: { tagName: 'BUTTON' } }).handle, false);
    assert.equal(history.shouldHandleUndoShortcut(undo, { overlayOpen: true, target: { tagName: 'DIV' } }).handle, false);
    assert.equal(history.shouldHandleUndoShortcut(undo, { inlineEditing: true, target: { tagName: 'DIV' } }).handle, false);
    assert.equal(history.shouldHandleUndoShortcut(undo, { editingDecoration: true }).handle, false);
    const allowed = history.shouldHandleUndoShortcut(redoY, { target: { tagName: 'DIV' } });
    assert.equal(allowed.handle, true);
    assert.equal(allowed.command, 'redo');
    assert.equal(history.shouldSealCoalesceOnPointerUp('font:n1'), true);
    assert.equal(history.shouldSealCoalesceOnPointerUp('text:n1'), false);
    assert.equal(history.shouldSealCoalesceOnPointerUp('drag:n1'), false);
});

test('deleting a root or a branch asks for the undo toast, a leaf does not', () => {
    const nodes = {
        root: { id: 'root', parentId: null },
        child: { id: 'child', parentId: 'root' },
        leaf: { id: 'leaf', parentId: 'child' }
    };
    assert.equal(history.shouldToastBranchDelete(nodes.root, nodes), true);
    assert.equal(history.shouldToastBranchDelete(nodes.child, nodes), true);
    assert.equal(history.shouldToastBranchDelete(nodes.leaf, nodes), false);
    assert.equal(history.BRANCH_DELETED_TOAST, 'Branch deleted · Undo');
});

test('tree layout is highlighted as down, including when a child is selected', () => {
    // Downward tree whose children sit on one row. Their average x offset is
    // larger than the vertical gap, and a selected child is even further right
    // of its siblings. The old check highlighted Right for both.
    const nodes = {
        root: { id: 'root', parentId: null, x: 200, y: 150 },
        a: { id: 'a', parentId: 'root', x: 200, y: 290 },
        b: { id: 'b', parentId: 'root', x: 500, y: 290 },
        c: { id: 'c', parentId: 'root', x: 900, y: 290 }
    };
    assert.equal(history.inferBranchDirection(nodes, 'root'), 'down');
    assert.equal(history.inferBranchDirection(nodes, 'a'), 'down');

    const right = {
        root: { id: 'root', parentId: null, x: 200, y: 250 },
        a: { id: 'a', parentId: 'root', x: 480, y: 170 },
        b: { id: 'b', parentId: 'root', x: 480, y: 330 }
    };
    assert.equal(history.inferBranchDirection(right, 'root'), 'right');
    assert.equal(history.inferBranchDirection(right, 'a'), 'right');

    const left = {
        root: { id: 'root', parentId: null, x: 800, y: 250 },
        a: { id: 'a', parentId: 'root', x: 520, y: 180 },
        b: { id: 'b', parentId: 'root', x: 520, y: 320 }
    };
    assert.equal(history.inferBranchDirection(left, 'b'), 'left');

    const up = {
        root: { id: 'root', parentId: null, x: 400, y: 500 },
        a: { id: 'a', parentId: 'root', x: 250, y: 360 },
        b: { id: 'b', parentId: 'root', x: 550, y: 360 }
    };
    assert.equal(history.inferBranchDirection(up, 'root'), 'up');
    assert.equal(history.inferBranchDirection({
        root: { id: 'root', parentId: null, x: 10, y: 10 },
        only: { id: 'only', parentId: 'root', x: 280, y: 12 }
    }, 'only'), 'right');
});

test('history keeps a bounded stack and redo is dropped after a new edit', () => {
    const h = history.createHistory({ limit: 3 });
    h.reset(snap({ a: { id: 'a', text: '0' } }));
    for (let i = 1; i <= 5; i += 1) {
        h.commit(snap({ a: { id: 'a', text: String(i) } }));
    }
    assert.equal(h.counts().past, 3);
    h.undo();
    h.undo();
    assert.equal(h.canRedo(), true);
    h.commit(snap({ a: { id: 'a', text: 'fresh' } }));
    assert.equal(h.canRedo(), false);
    assert.equal(h.present().nodes.a.text, 'fresh');
});

test('the editor page wires undo without changing the Pro gate', () => {
    const root = path.join(__dirname, '..');
    const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const twin = fs.readFileSync(path.join(root, 'MINDMAP.html'), 'utf8');
    assert.equal(index, twin);
    assert.match(index, /js\/mindmap-history\.js/);
    assert.match(index, /id="btn-undo"/);
    assert.match(index, /id="btn-redo"/);
    assert.match(index, /id="btn-undo-design"/);
    assert.match(index, /id="btn-redo-design"/);
    assert.match(index, /data-undo-btn/);
    assert.match(index, /data-redo-btn/);
    assert.match(index, /function undoMapEdit\(/);
    assert.match(index, /function showBranchDeletedToast\(/);
    assert.match(index, /MindmapHistory\.inferBranchDirection/);
    assert.match(index, /coalesceKey: 'text:'/);
    assert.match(index, /coalesceKey: 'font:'/);
    assert.match(index, /coalesceKey: dragKey/);
    assert.match(index, /save\(\) \{ triggerAutoSave\(\); \}/);
    assert.match(index, /function isPro\(\) \{\s*return true;\s*\}/);
    assert.doesNotMatch(index, /Delete collapsed branch/);
});

test('shape, colour, collapse, and layout snapshots restore as separate steps', () => {
    const h = history.createHistory();
    const base = snap(
        { root: { id: 'root', parentId: null, text: 'Idea', x: 0, y: 0, bg: '#fff', collapsed: false } },
        { canvasDecorations: {} }
    );
    h.reset(base);
    h.commit(snap(
        { root: { id: 'root', parentId: null, text: 'Idea', x: 0, y: 0, bg: '#fff', collapsed: false } },
        { canvasDecorations: { z: { id: 'z', type: 'zone', x: 10, y: 10, width: 80, height: 40 } } }
    ));
    h.commit(snap(
        { root: { id: 'root', parentId: null, text: 'Idea', x: 0, y: 0, bg: '#111', collapsed: false } },
        { canvasDecorations: { z: { id: 'z', type: 'zone', x: 10, y: 10, width: 80, height: 40 } } }
    ));
    h.commit(snap(
        { root: { id: 'root', parentId: null, text: 'Idea', x: 0, y: 0, bg: '#111', collapsed: true } },
        { canvasDecorations: { z: { id: 'z', type: 'zone', x: 10, y: 10, width: 80, height: 40 } } }
    ));
    h.commit(snap(
        { root: { id: 'root', parentId: null, text: 'Idea', x: 300, y: 40, bg: '#111', collapsed: true } },
        { canvasDecorations: { z: { id: 'z', type: 'zone', x: 10, y: 10, width: 80, height: 40 } } }
    ));

    assert.equal(h.undo().nodes.root.x, 0);
    assert.equal(h.undo().nodes.root.collapsed, false);
    assert.equal(h.undo().nodes.root.bg, '#fff');
    assert.deepEqual(h.undo().canvasDecorations, {});
    assert.equal(h.canUndo(), false);
});
