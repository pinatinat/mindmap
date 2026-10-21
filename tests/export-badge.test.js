const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mindmapHtml = fs.readFileSync(path.join(root, 'MINDMAP.html'), 'utf8');

function extractFunction(source, name) {
    const marker = 'function ' + name + '(';
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, name + ' is missing');
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error('unterminated ' + name);
}

test('index.html and MINDMAP.html stay identical', () => {
    assert.equal(indexHtml, mindmapHtml);
});

test('collapsed-count export nudge is the label baseline shift for a line-height of 1', () => {
    const exportInkNudge = new Function(
        extractFunction(indexHtml, 'exportInkNudge') + '\nreturn exportInkNudge;'
    )();

    // 16px text on a 24px line. html2canvas baseline 25, glyph ascent 12.
    // The label fix shifts by font-size minus line-height, which is -8.
    assert.equal(exportInkNudge(355, 24, 356, 25, 12, 0), -8);

    // Collapsed "+8" pill: 18px box, text rect 1.5px below the top,
    // html2canvas baseline 18, ascent 8, descent 0.
    assert.equal(exportInkNudge(0, 18, 1.5, 18, 8, 0), -6.5);

    assert.equal(exportInkNudge(0, 0, 1, 18, 8, 0), 0);
    assert.equal(exportInkNudge(NaN, 18, 1, 18, 8, 0), 0);
});

test('export clone shifts the collapsed count and the live badge CSS does not', () => {
    const start = indexHtml.indexOf('function crispExportNodes');
    const end = indexHtml.indexOf('function imageSizeFromDataUrl');
    const crisp = indexHtml.slice(start, end);
    assert.match(crisp, /nudgeCollapsedCountBadges\(clonedDoc\)/);
    assert.match(indexHtml, /collapse-toggle\.is-collapsed \.collapse-toggle-face/);
    assert.match(indexHtml, /wrap\.style\.top = nudge \+ 'px'/);

    const faceRule = indexHtml.match(/\.collapse-toggle-face \{[\s\S]*?\n        \}/);
    assert.ok(faceRule, 'collapse-toggle-face rule');
    assert.match(faceRule[0], /align-items: center/);
    assert.doesNotMatch(faceRule[0], /\btop\s*:/);

    const calls = indexHtml.match(/nudgeCollapsedCountBadges\(/g) || [];
    assert.deepEqual(calls, ['nudgeCollapsedCountBadges(', 'nudgeCollapsedCountBadges(']);
});
