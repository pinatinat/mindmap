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

test('an off-screen node is centred in the safe area, not parked on the edge', () => {
    const pan = history.panToRevealRects({
        panX: 0, panY: 0, zoom: 1, viewWidth: 800, viewHeight: 600,
        padLeft: 10, padRight: 10, padTop: 10, padBottom: 10
    }, [{ x: 100, y: 900, w: 80, h: 40 }]);
    assert.equal(pan.changed, true);
    const screenX = pan.panX + 140;
    const screenY = pan.panY + 920;
    assert.ok(Math.abs(screenX - 400) <= 1, 'horizontal centre, got ' + screenX);
    assert.ok(Math.abs(screenY - 300) <= 1, 'vertical centre, got ' + screenY);
    assert.ok(screenY < 500, 'not left sitting on the bottom edge');
});

test('the guide and the design toolbar shift the centre into the visible area', () => {
    const insets = history.overlayInsets(1000, 640, {
        padLeft: 16, padRight: 16, padTop: 16, padBottom: 16
    }, [
        { left: 8, top: 8, right: 992, bottom: 52 },
        { left: 16, top: 400, right: 276, bottom: 620 }
    ]);
    assert.ok(insets.padTop >= 60, 'toolbar clears the top');
    assert.equal(insets.padLeft >= 288, true);
    assert.ok(insets.padBottom >= 32, 'guide clears the bottom');
    const pan = history.panToRevealRects({
        panX: 0, panY: 0, zoom: 1, viewWidth: 1000, viewHeight: 640,
        padLeft: insets.padLeft, padRight: insets.padRight,
        padTop: insets.padTop, padBottom: insets.padBottom
    }, [{ x: 20, y: 560, w: 90, h: 40 }]);
    const screenX = pan.panX + 65;
    const screenY = pan.panY + 580;
    const safeCx = (insets.padLeft + (1000 - insets.padRight)) / 2;
    const safeCy = (insets.padTop + (640 - insets.padBottom)) / 2;
    assert.ok(Math.abs(screenX - safeCx) <= 1, screenX + ' vs ' + safeCx);
    assert.ok(Math.abs(screenY - safeCy) <= 1, screenY + ' vs ' + safeCy);
    const nodeLeft = pan.panX + 20;
    const nodeTop = pan.panY + 560;
    const overlapsGuide = nodeLeft < 276 && nodeLeft + 90 > 16 && nodeTop < 620 && nodeTop + 40 > 400;
    assert.equal(overlapsGuide, false);
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

test('the editor page wires undo and keeps the verified Pro gate', () => {
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
    assert.match(index, /retainSelection: moved \? dragInfo\.nodeId/);
    assert.match(index, /data-toast-action/);
    assert.match(index, /createToastAction/);
    assert.match(index, /suppressEdits/);
    assert.match(index, /overlayInsets/);
    assert.match(index, /reconcileEditingFlags/);
    assert.match(index, /save\(\) \{ triggerAutoSave\(\); \}/);
    assert.match(index, /function isPro\(\) \{\s*return !!\(isUserOmniMindPro \|\| readLocalProActivation\(\)\);\s*\}/);
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

test('undoing a drag keeps the dragged node selected', () => {
    const h = history.createHistory();
    h.reset(snap({
        root: { id: 'root', parentId: null, x: 0, y: 0 },
        n4: { id: 'n4', parentId: 'root', x: 80, y: 40 }
    }, { selectedNodeId: 'root' }));
    h.commit(snap({
        root: { id: 'root', parentId: null, x: 0, y: 0 },
        n4: { id: 'n4', parentId: 'root', x: 260, y: 180 }
    }, { selectedNodeId: 'n4' }), { coalesceKey: 'drag:n4', retainSelection: 'n4' });
    h.seal();
    const undone = h.undo();
    assert.equal(undone.nodes.n4.x, 80);
    assert.equal(undone.selectedNodeId, 'n4');
    const redone = h.redo();
    assert.equal(redone.nodes.n4.x, 260);
    assert.equal(redone.selectedNodeId, 'n4');
});

test('a press that does not move the node does not rewrite history', () => {
    const h = history.createHistory();
    h.reset(snap({ a: { id: 'a', x: 10, y: 10 } }, { selectedNodeId: 'root' }));
    const result = h.commit(snap({ a: { id: 'a', x: 10, y: 10 } }, { selectedNodeId: 'a' }), {
        coalesceKey: 'drag:a',
        retainSelection: 'a'
    });
    assert.equal(result.reason, 'unchanged');
    assert.equal(h.canUndo(), false);
    assert.equal(h.present().selectedNodeId, 'root');
});

test('toast undo runs on pointerdown and a following click does not undo twice', () => {
    let runs = 0;
    const action = history.createToastAction(() => { runs += 1; });
    const stopped = [];
    const event = (type) => ({
        type,
        preventDefault() { stopped.push(type); },
        stopPropagation() { stopped.push('stop-' + type); }
    });
    assert.equal(action.handle(event('pointerdown')), true);
    assert.equal(runs, 1);
    assert.equal(action.handle(event('click')), false);
    assert.equal(runs, 1);
    assert.ok(stopped.includes('pointerdown'));
    assert.ok(stopped.includes('stop-pointerdown'));
    const keyboard = history.createToastAction(() => { runs += 1; });
    assert.equal(keyboard.handle(event('click')), true);
    assert.equal(runs, 2);
    assert.equal(action.handle(event('mousedown')), false);
});

test('a side effect after redo does not swallow the next undo', () => {
    const h = history.createHistory();
    h.reset(snap({ a: { id: 'a', text: 'one' } }));
    h.commit(snap({ a: { id: 'a', text: 'two' } }));
    h.commit(snap({ a: { id: 'a', text: 'three' } }));
    assert.equal(h.undo().nodes.a.text, 'two');
    const release = h.suppressEdits();
    assert.equal(h.redo().nodes.a.text, 'three');
    const side = h.commit(snap({ a: { id: 'a', text: 'three', noise: 1 } }));
    assert.equal(side.reason, 'suppressed');
    assert.equal(h.present().nodes.a.text, 'three');
    assert.equal(h.present().nodes.a.noise, undefined);
    release();
    release();
    assert.equal(h.undo().nodes.a.text, 'two');
    assert.equal(h.canRedo(), true);
});

test('stale editing flags do not block undo once focus has left the editor', () => {
    const stale = history.reconcileEditingFlags({ tagName: 'BODY' }, {
        inlineEditing: true,
        editingDecoration: true
    });
    assert.equal(stale.inlineEditing, false);
    assert.equal(stale.editingDecoration, false);
    const typing = history.reconcileEditingFlags({ tagName: 'INPUT' }, { inlineEditing: true });
    assert.equal(typing.inlineEditing, true);
    const deco = history.reconcileEditingFlags(
        { tagName: 'DIV', isContentEditable: true },
        { editingDecoration: true }
    );
    assert.equal(deco.editingDecoration, true);
    assert.equal(history.shouldBlurAfterHistoryNav({ tagName: 'INPUT' }), true);
    assert.equal(history.shouldBlurAfterHistoryNav({
        tagName: 'BUTTON',
        closest(sel) { return sel.indexOf('data-redo-btn') !== -1; }
    }), true);
    assert.equal(history.shouldBlurAfterHistoryNav({
        tagName: 'DIV',
        closest() { return null; }
    }), false);
    const undo = { key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
    assert.equal(history.shouldHandleUndoShortcut(undo, {
        target: { tagName: 'BODY' },
        inlineEditing: false,
        editingDecoration: false
    }).handle, true);
});
