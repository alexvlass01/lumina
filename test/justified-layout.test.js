'use strict';

const assert = require('assert');
const J = require('../renderer/justified-layout');

let passed = 0;
const ok = (name, condition) => { assert.ok(condition, name); console.log('  ✓ ' + name); passed++; };
const near = (a, b, epsilon = 0.01) => Math.abs(a - b) <= epsilon;

ok('normalizeAspect: uses fallback and clamps extremes',
  J.normalizeAspect(null) === 1.6
  && J.normalizeAspect(0.1) === 0.5
  && J.normalizeAspect(8) === 3);

const full = J.layout([1.5, 1.5, 1.5, 1.5], 1000, { gap: 10, targetHeight: 200 });
ok('complete row fills the available width',
  near(full.slice(0, 3).reduce((sum, box) => sum + box.width, 0) + 20, 1000));
ok('row break chooses the height closest to target',
  near(full[0].height, full[2].height)
  && Math.abs(full[0].height - 200) < Math.abs(161.67 - 200)
  && near(full[3].height, 200));
ok('layout preserves source aspect ratios', full.every((box) => near(box.width / box.height, 1.5)));

const last = J.layout([1.5, 1.5], 1000, { gap: 10, targetHeight: 200 });
ok('incomplete final row keeps target height instead of stretching',
  last.every((box) => near(box.height, 200))
  && last.reduce((sum, box) => sum + box.width, 0) + 10 < 1000);

const mixed = J.layout([0.2, 1, 6], 620, { gap: 10, targetHeight: 150 });
ok('extreme portraits and panoramas are capped without overflow',
  mixed.length === 3
  && near(mixed[0].width / mixed[0].height, 0.5)
  && near(mixed[2].width / mixed[2].height, 3)
  && mixed.reduce((sum, box) => sum + box.width, 0) + 20 <= 620.01);

ok('empty input returns no boxes', J.layout([], 500).length === 0);

// A 562px container used to produce three serialized widths whose sum was 562.01px.
// Flexbox then wrapped the third card even though the layout model kept it in row one,
// breaking both visual width and virtual scroll geometry.
const cssSafe = J.layoutRows(new Array(20).fill(1.6), 562, { gap: 10, targetHeight: 142 });
ok('CSS-rounded complete rows never overflow and wrap their final card',
  cssSafe.rows.slice(0, -1).every((row) => {
    const serializedWidth = cssSafe.boxes.slice(row.start, row.end)
      .reduce((sum, box) => sum + Number(box.width.toFixed(2)), 0)
      + 10 * (row.end - row.start - 1);
    return serializedWidth <= 562 && 562 - serializedWidth < 0.05;
  }));

// --- layoutRows: row geometry for the virtualized grid ---
const rich = J.layoutRows([1.5, 1.5, 1.5, 1.5], 1000, { gap: 10, targetHeight: 200 });
ok('layoutRows returns the same boxes as layout', rich.boxes.length === 4
  && rich.boxes.every((box, i) => near(box.width, full[i].width) && near(box.height, full[i].height)));
ok('rows partition the boxes without gaps or overlap', rich.rows.length === 2
  && rich.rows[0].start === 0 && rich.rows[0].end === 3
  && rich.rows[1].start === 3 && rich.rows[1].end === 4);
ok('row tops are cumulative heights plus gaps',
  rich.rows[0].top === 0 && near(rich.rows[1].top, rich.rows[0].height + 10));
ok('totalHeight covers all rows and inner gaps',
  near(rich.totalHeight, rich.rows[0].height + 10 + rich.rows[1].height));
ok('every box height matches its row height', rich.rows.every((row) => {
  for (let i = row.start; i < row.end; i++) if (!near(rich.boxes[i].height, row.height)) return false;
  return true;
}));
const emptyRows = J.layoutRows([], 500);
ok('layoutRows on empty input yields no rows and zero height',
  emptyRows.rows.length === 0 && emptyRows.totalHeight === 0 && emptyRows.boxes.length === 0);

// --- fixed row membership during a native horizontal resize ---
ok('canonical rows retain whether the real final row is filled',
  rich.rows[0].fill === true && rich.rows[rich.rows.length - 1].fill === false);
const exactFullFinal = J.layoutRows([1.5, 1.5], 600, { gap: 10, targetHeight: 200 });
ok('a final row completed by the breaker is marked as filled',
  exactFullFinal.rows.length === 1 && exactFullFinal.rows[0].fill === true);

const stickyAspects = Array.from({ length: 60 }, (_, i) => [0.72, 1, 1.35, 1.6, 2.4][i % 5]);
const stickyOptions = { gap: 10, targetHeight: 178, minAspect: 0.65, maxAspect: 3 };
const stickySeed = J.layoutRows(stickyAspects, 1122, stickyOptions);
const stickyTopology = J.captureRowTopology(stickySeed.rows, stickyAspects.length);
const stickySame = J.layoutRowsWithTopology(stickyAspects, 1122, stickyTopology, stickyOptions);
ok('captured topology is a detached complete row partition',
  Array.isArray(stickyTopology)
  && stickyTopology.length === stickySeed.rows.length
  && stickyTopology.every((row, i) => row !== stickySeed.rows[i]));
ok('enabling fixed topology at the seed width causes no geometry jump',
  stickySame.rows.every((row, i) => row.start === stickySeed.rows[i].start
    && row.end === stickySeed.rows[i].end && row.fill === stickySeed.rows[i].fill)
  && stickySame.boxes.every((box, i) => near(box.width, stickySeed.boxes[i].width)
    && near(box.height, stickySeed.boxes[i].height)));

const stickyWidths = [1068, 900, 718, 620, 558, 780, 1122, 1698];
let stickyRowsStable = true;
let stickyRowsCssSafe = true;
let stickyRatiosSafe = true;
for (const width of stickyWidths) {
  const fixed = J.layoutRowsWithTopology(stickyAspects, width, stickyTopology, {
    ...stickyOptions,
    targetHeight: width >= 1000 ? 178 : (width >= 700 ? 160 : 142),
  });
  stickyRowsStable = stickyRowsStable && fixed.rows.every((row, i) => (
    row.start === stickyTopology[i].start
    && row.end === stickyTopology[i].end
    && row.fill === stickyTopology[i].fill
  ));
  stickyRowsCssSafe = stickyRowsCssSafe && fixed.rows.filter((row) => row.fill).every((row) => {
    const occupied = fixed.boxes.slice(row.start, row.end)
      .reduce((sum, box) => sum + Number(box.width.toFixed(2)), 0)
      + 10 * (row.end - row.start - 1);
    return occupied <= width && width - occupied < 0.05;
  });
  stickyRatiosSafe = stickyRatiosSafe && fixed.boxes.every((box, i) => (
    near(box.width / box.height, J.normalizeAspect(stickyAspects[i], 0.65, 3), 0.04)
  ));
}
ok('fixed topology keeps every card in the same row across the owner width sequence', stickyRowsStable);
ok('fixed complete rows remain CSS-safe and cannot flex-wrap a card', stickyRowsCssSafe);
ok('fixed geometry preserves normalized image aspect ratios', stickyRatiosSafe);

const incompleteAspects = stickyAspects.slice(0, -1);
const incompleteSeed = J.layoutRows(incompleteAspects, 1122, stickyOptions);
const incompleteTopology = J.captureRowTopology(incompleteSeed.rows, incompleteAspects.length);
const stickyWide = J.layoutRowsWithTopology(incompleteAspects, 1698, incompleteTopology, stickyOptions);
const stickyNarrow = J.layoutRowsWithTopology(incompleteAspects, 558, incompleteTopology, stickyOptions);
const lastWide = stickyWide.rows[stickyWide.rows.length - 1];
const lastNarrow = stickyNarrow.rows[stickyNarrow.rows.length - 1];
const occupied = (result, row) => result.boxes.slice(row.start, row.end)
  .reduce((sum, box) => sum + box.width, 0) + 10 * (row.end - row.start - 1);
ok('an incomplete final row stays left-aligned when wide and shrinks without overflow when narrow',
  lastWide.fill === false && occupied(stickyWide, lastWide) < 1698
  && occupied(stickyNarrow, lastNarrow) <= 558.01);

const narrowCanonical = J.layoutRows(stickyAspects, 558, stickyOptions);
ok('settle can return to the canonical narrow layout after one fixed resize burst',
  narrowCanonical.rows.some((row, i) => !stickyTopology[i]
    || row.start !== stickyTopology[i].start || row.end !== stickyTopology[i].end)
  && J.layoutRows(stickyAspects, 558, stickyOptions).rows.every((row, i) => (
    row.start === narrowCanonical.rows[i].start && row.end === narrowCanonical.rows[i].end
  )));
ok('stale or partial topology is rejected safely',
  J.layoutRowsWithTopology(stickyAspects.slice(0, -1), 900, stickyTopology, stickyOptions) === null
  && J.captureRowTopology(stickyTopology.slice(0, -1), stickyAspects.length) === null);

console.log('\nAll ' + passed + ' justified-layout tests passed.');
