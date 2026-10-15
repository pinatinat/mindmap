// Undo/redo history, branch-direction detection, and viewport reveal.
// Pure helpers so the map editor and node tests share one implementation.
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.MindmapHistory = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    const BRANCH_DELETED_TOAST = 'Branch deleted · Undo';
    const CONTINUOUS_COALESCE = /^(font:|opacity:|canvas-bg)/;

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function stable(value) {
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
        const keys = Object.keys(value).sort();
        return '{' + keys.map((key) => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
    }

    function same(a, b) {
        if (a === b) return true;
        if (!a || !b) return false;
        return stable(a) === stable(b);
    }

    function createHistory(options) {
        const limit = Math.max(1, (options && options.limit) || 80);
        let past = [];
        let present = null;
        let future = [];
        let coalesceKey = null;
        let suppressDepth = 0;

        // Ignore edits caused by painting a restore (blur, focus moves, z-index
        // noise) so they cannot push a lookalike step that makes the next undo
        // appear to do nothing.
        function suppressEdits() {
            suppressDepth += 1;
            let released = false;
            return function release() {
                if (released) return;
                released = true;
                suppressDepth = Math.max(0, suppressDepth - 1);
            };
        }

        function reset(snapshot) {
            past = [];
            future = [];
            present = clone(snapshot);
            coalesceKey = null;
        }

        // Replace the tip after a load or remote refresh without creating a step.
        function rebase(snapshot) {
            const next = clone(snapshot);
            if (present && same(present, next)) return { changed: false };
            present = next;
            future = [];
            coalesceKey = null;
            return { changed: true };
        }

        function commit(snapshot, commitOptions) {
            const next = clone(snapshot);
            const key = (commitOptions && commitOptions.coalesceKey) || null;
            if (suppressDepth > 0) {
                return { recorded: false, coalesced: false, reason: 'suppressed' };
            }
            if (!present) {
                present = next;
                coalesceKey = key;
                return { recorded: false, coalesced: false, reason: 'baseline' };
            }
            // A drag selects the node on pointer-down, which is not itself a
            // history step. Stamp that id onto the state we are about to leave
            // so undo keeps the dragged node selected. A press that does not
            // change the map still returns unchanged and leaves the stack alone.
            const retain = commitOptions && commitOptions.retainSelection;
            let outgoing = present;
            if (retain && present.nodes && present.nodes[retain] && present.selectedNodeId !== retain) {
                outgoing = clone(present);
                outgoing.selectedNodeId = retain;
            }
            if (same(outgoing, next)) {
                return { recorded: false, coalesced: false, reason: 'unchanged' };
            }
            if (key && key === coalesceKey) {
                present = next;
                future = [];
                return { recorded: true, coalesced: true };
            }
            past.push(outgoing);
            if (past.length > limit) past.shift();
            present = next;
            future = [];
            coalesceKey = key;
            return { recorded: true, coalesced: false };
        }

        function seal() {
            coalesceKey = null;
        }

        function undo() {
            if (!past.length) return null;
            coalesceKey = null;
            future.push(present);
            present = past.pop();
            return clone(present);
        }

        function redo() {
            if (!future.length) return null;
            coalesceKey = null;
            past.push(present);
            present = future.pop();
            return clone(present);
        }

        return {
            reset,
            rebase,
            commit,
            seal,
            suppressEdits,
            undo,
            redo,
            canUndo: function () { return past.length > 0; },
            canRedo: function () { return future.length > 0; },
            present: function () { return present ? clone(present) : null; },
            getCoalesceKey: function () { return coalesceKey; },
            counts: function () { return { past: past.length, future: future.length }; }
        };
    }

    function recordMapEdit(history, snapshot, flags) {
        const state = flags || {};
        if (!history || state.applying || state.suspended || !state.ready) {
            return { recorded: false, reason: 'skipped' };
        }
        return history.commit(snapshot, {
            coalesceKey: state.coalesceKey || null,
            retainSelection: state.retainSelection || null
        });
    }

    function navigateHistory(history, direction, hooks) {
        const fns = hooks || {};
        if (!history || (direction !== 'undo' && direction !== 'redo')) {
            return { applied: false };
        }
        const before = history.present();
        const snap = direction === 'undo' ? history.undo() : history.redo();
        if (!snap) return { applied: false };
        if (fns.apply) fns.apply(snap);
        const rects = diffFocusRects(before, snap);
        const viewport = typeof fns.viewport === 'function' ? fns.viewport() : fns.viewport;
        let pan = null;
        if (viewport) {
            pan = panToRevealRects(viewport, rects);
            if (pan && pan.changed && fns.applyPan) fns.applyPan(pan);
        }
        if (fns.save) fns.save(snap);
        return { applied: true, snapshot: snap, pan, rects };
    }

    function undoShortcutFromEvent(event) {
        if (!event) return null;
        const key = String(event.key || '').toLowerCase();
        const mod = !!(event.ctrlKey || event.metaKey);
        if (!mod || event.altKey) return null;
        if (key === 'z' && !event.shiftKey) return 'undo';
        if (key === 'z' && event.shiftKey) return 'redo';
        if (key === 'y' && !event.shiftKey) return 'redo';
        return null;
    }

    function isTypingTarget(target) {
        if (!target) return false;
        const tag = String(target.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (target.isContentEditable) return true;
        return false;
    }

    // A stuck inline-edit flag must not swallow Ctrl+Z once focus has left the
    // editor. The flag only counts while the event target is still that editor.
    function reconcileEditingFlags(target, flags) {
        const state = flags || {};
        const tag = String((target && target.tagName) || '').toUpperCase();
        return {
            inlineEditing: !!(state.inlineEditing && (tag === 'INPUT' || tag === 'TEXTAREA')),
            editingDecoration: !!(state.editingDecoration && target && target.isContentEditable)
        };
    }

    function shouldBlurAfterHistoryNav(target) {
        if (!target || !target.tagName) return false;
        const tag = String(target.tagName).toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (target.isContentEditable) return true;
        if (typeof target.closest === 'function' && target.closest('[data-undo-btn],[data-redo-btn]')) return true;
        return false;
    }

    // pointerdown runs the action before a moving or disappearing toast can
    // drop the click. A later click on the same press is ignored.
    function createToastAction(run) {
        let ran = false;
        return {
            handle(event) {
                const type = String((event && event.type) || 'click');
                if (type !== 'pointerdown' && type !== 'click') return false;
                if (event) {
                    if (typeof event.preventDefault === 'function') event.preventDefault();
                    if (typeof event.stopPropagation === 'function') event.stopPropagation();
                }
                if (ran) return false;
                ran = true;
                if (typeof run === 'function') run();
                return true;
            }
        };
    }

    function shouldHandleUndoShortcut(event, context) {
        const command = undoShortcutFromEvent(event);
        if (!command) return { handle: false, command: null };
        const ctx = context || {};
        const target = ctx.target || event.target;
        if (ctx.overlayOpen || ctx.dialogOpen || ctx.inlineEditing || ctx.editingDecoration || isTypingTarget(target)) {
            return { handle: false, command };
        }
        return { handle: true, command };
    }

    function shouldSealCoalesceOnPointerUp(key) {
        return !!(key && CONTINUOUS_COALESCE.test(key));
    }

    function shouldToastBranchDelete(node, allNodes) {
        if (!node) return false;
        if (node.parentId == null) return true;
        const nodes = allNodes || {};
        return Object.keys(nodes).some((id) => nodes[id] && nodes[id].parentId === node.id);
    }

    function mean(values) {
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    function range(values) {
        return Math.max.apply(null, values) - Math.min.apply(null, values);
    }

    function directionFromOffset(dx, dy) {
        if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
        return dy >= 0 ? 'down' : 'up';
    }

    // Tree layouts put siblings on one row (or one column). Measuring the average
    // offset from a selected leaf, or from an off-center parent, used to report
    // "right" after a downward tree layout.
    function inferBranchDirection(nodes, nodeId) {
        if (!nodes || !nodeId || !nodes[nodeId]) return 'right';
        let anchor = nodes[nodeId];
        let children = Object.keys(nodes)
            .map((id) => nodes[id])
            .filter((node) => node && node.parentId === anchor.id);
        if (!children.length && anchor.parentId && nodes[anchor.parentId]) {
            anchor = nodes[anchor.parentId];
            children = Object.keys(nodes)
                .map((id) => nodes[id])
                .filter((node) => node && node.parentId === anchor.id);
        }
        if (!children.length) return 'right';

        const dxs = children.map((child) => (child.x || 0) - (anchor.x || 0));
        const dys = children.map((child) => (child.y || 0) - (anchor.y || 0));
        const meanDx = mean(dxs);
        const meanDy = mean(dys);
        if (children.length === 1) return directionFromOffset(meanDx, meanDy);

        const dxRange = range(dxs);
        const dyRange = range(dys);
        const slack = 36;
        if (dyRange + slack < dxRange && Math.abs(meanDy) > 24) {
            return meanDy >= 0 ? 'down' : 'up';
        }
        if (dxRange + slack < dyRange && Math.abs(meanDx) > 24) {
            return meanDx >= 0 ? 'right' : 'left';
        }
        return directionFromOffset(meanDx, meanDy);
    }

    function estimateNodeRect(node) {
        if (!node || typeof node.x !== 'number' || typeof node.y !== 'number') return null;
        const size = node.size || 16;
        const text = node.text || '';
        let w;
        let h;
        if (node.wrap) {
            w = node.maxWidth || 240;
            const chars = Math.max(8, Math.floor(w / (size * 0.55)));
            const lines = Math.max(1, Math.ceil(Math.max(text.length, 1) / chars));
            h = lines * size * 1.35 + 22;
        } else {
            w = Math.max(text.length * size * 0.62 + 48, 72);
            h = size * 1.7 + 18;
        }
        return { x: node.x - w / 2, y: node.y - h / 2, w, h };
    }

    function visibleAnchor(nodes, id) {
        let node = nodes[id];
        if (!node) return null;
        let visible = node;
        let parentId = node.parentId;
        const seen = new Set();
        while (parentId && nodes[parentId] && !seen.has(parentId)) {
            seen.add(parentId);
            if (nodes[parentId].collapsed) visible = nodes[parentId];
            parentId = nodes[parentId].parentId;
        }
        return visible;
    }

    function decorationRect(dec) {
        if (!dec) return null;
        if (typeof dec.x === 'number' && typeof dec.y === 'number') {
            return {
                x: dec.x,
                y: dec.y,
                w: dec.width || dec.w || 120,
                h: dec.height || dec.h || 80
            };
        }
        const xs = [dec.startX, dec.endX].filter((value) => typeof value === 'number');
        const ys = [dec.startY, dec.endY].filter((value) => typeof value === 'number');
        if (!xs.length || !ys.length) return null;
        const minX = Math.min.apply(null, xs);
        const maxX = Math.max.apply(null, xs);
        const minY = Math.min.apply(null, ys);
        const maxY = Math.max.apply(null, ys);
        return {
            x: minX - 12,
            y: minY - 12,
            w: Math.max(24, maxX - minX + 24),
            h: Math.max(24, maxY - minY + 24)
        };
    }

    function focusRectForNode(nodes, node) {
        if (!node) return null;
        const anchor = nodes[node.id] ? visibleAnchor(nodes, node.id) : node;
        return estimateNodeRect(anchor || node);
    }

    function diffFocusRects(before, after) {
        const prev = before || { nodes: {}, canvasDecorations: {} };
        const next = after || { nodes: {}, canvasDecorations: {} };
        const prevNodes = prev.nodes || {};
        const nextNodes = next.nodes || {};
        const rects = [];
        const nodeIds = new Set(Object.keys(prevNodes).concat(Object.keys(nextNodes)));
        nodeIds.forEach((id) => {
            const a = prevNodes[id];
            const b = nextNodes[id];
            if (same(a || null, b || null)) return;
            const sourceNodes = b ? nextNodes : prevNodes;
            const source = b || a;
            const rect = focusRectForNode(sourceNodes, source);
            if (rect) rects.push(rect);
        });

        const prevDecs = prev.canvasDecorations || {};
        const nextDecs = next.canvasDecorations || {};
        const decIds = new Set(Object.keys(prevDecs).concat(Object.keys(nextDecs)));
        decIds.forEach((id) => {
            const a = prevDecs[id];
            const b = nextDecs[id];
            if (same(a || null, b || null)) return;
            const rect = decorationRect(b || a);
            if (rect) rects.push(rect);
        });
        return rects;
    }

    function panToRevealRects(viewport, rects) {
        const view = viewport || {};
        const panX = view.panX || 0;
        const panY = view.panY || 0;
        const zoom = view.zoom > 0 ? view.zoom : 1;
        if (!rects || !rects.length) return { panX, panY, changed: false };

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        rects.forEach((rect) => {
            minX = Math.min(minX, rect.x);
            minY = Math.min(minY, rect.y);
            maxX = Math.max(maxX, rect.x + (rect.w || 0));
            maxY = Math.max(maxY, rect.y + (rect.h || 0));
        });
        if (!isFinite(minX) || !isFinite(minY)) return { panX, panY, changed: false };

        const viewWidth = view.viewWidth || 0;
        const viewHeight = view.viewHeight || 0;
        const padLeft = view.padLeft || 0;
        const padRight = view.padRight || 0;
        const padTop = view.padTop || 0;
        const padBottom = view.padBottom || 0;
        const left = panX + minX * zoom;
        const top = panY + minY * zoom;
        const right = panX + maxX * zoom;
        const bottom = panY + maxY * zoom;
        const safeLeft = padLeft;
        const safeTop = padTop;
        const safeRight = viewWidth - padRight;
        const safeBottom = viewHeight - padBottom;
        const availW = Math.max(1, safeRight - safeLeft);
        const availH = Math.max(1, safeBottom - safeTop);
        const fullyInside = left >= safeLeft - 0.5 && top >= safeTop - 0.5
            && right <= safeRight + 0.5 && bottom <= safeBottom + 0.5;
        if (fullyInside) return { panX, panY, changed: false };

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const newPanX = Math.round((safeLeft + availW / 2) - cx * zoom);
        const newPanY = Math.round((safeTop + availH / 2) - cy * zoom);
        return {
            panX: newPanX,
            panY: newPanY,
            changed: newPanX !== Math.round(panX) || newPanY !== Math.round(panY)
        };
    }

    // Toolbars and the bottom-left Guide sit on top of the canvas. Inset the
    // safe area so a restored node is centred in the space that is actually visible.
    function overlayInsets(viewWidth, viewHeight, base, overlays) {
        const width = viewWidth || 0;
        const height = viewHeight || 0;
        const pads = base || {};
        let padLeft = pads.padLeft || 0;
        let padRight = pads.padRight || 0;
        let padTop = pads.padTop || 0;
        let padBottom = pads.padBottom || 0;
        (overlays || []).forEach((box) => {
            if (!box || !(width > 0) || !(height > 0)) return;
            const left = Math.max(0, box.left);
            const top = Math.max(0, box.top);
            const right = Math.min(width, box.right);
            const bottom = Math.min(height, box.bottom);
            const w = right - left;
            const h = bottom - top;
            if (w < 8 || h < 8) return;
            if (w >= width * 0.55) {
                const fromTop = top;
                const fromBottom = height - bottom;
                if (fromTop <= fromBottom) padTop = Math.max(padTop, bottom + 8);
                else padBottom = Math.max(padBottom, height - top + 8);
                return;
            }
            if (left < width * 0.5) padLeft = Math.max(padLeft, right + 12);
            else padRight = Math.max(padRight, width - left + 12);
            if (bottom > height * 0.55) padBottom = Math.max(padBottom, height - top + 12);
            else if (top < height * 0.45) padTop = Math.max(padTop, bottom + 12);
        });
        const capX = width * 0.4;
        const capY = height * 0.4;
        return {
            padLeft: Math.min(padLeft, capX),
            padRight: Math.min(padRight, capX),
            padTop: Math.min(padTop, capY),
            padBottom: Math.min(padBottom, capY)
        };
    }

    return {
        BRANCH_DELETED_TOAST,
        createHistory,
        recordMapEdit,
        navigateHistory,
        undoShortcutFromEvent,
        isTypingTarget,
        reconcileEditingFlags,
        shouldBlurAfterHistoryNav,
        createToastAction,
        shouldHandleUndoShortcut,
        shouldSealCoalesceOnPointerUp,
        overlayInsets,
        shouldToastBranchDelete,
        inferBranchDirection,
        estimateNodeRect,
        diffFocusRects,
        panToRevealRects
    };
});
