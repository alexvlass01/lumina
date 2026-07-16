'use strict';

const assert = require('assert');
const J = require('../renderer/justified-layout');
const V = require('../renderer/virtual-window');

let passed = 0;
const ok = (name, condition) => { assert.ok(condition, name); console.log('  ✓ ' + name); passed++; };
const near = (a, b, epsilon = 0.01) => Math.abs(a - b) <= epsilon;

// A realistic grid: 300 landscape cards, ~5 per row → 60 rows of ~190px + 10px gap.
const { rows, totalHeight, gap } = J.layoutRows(new Array(300).fill(1.6), 1000, { gap: 10, targetHeight: 178 });
ok('fixture produced a tall multi-row grid', rows.length >= 50 && totalHeight > 5000);

// --- rowRangeForViewport ---
const atTop = V.rowRangeForViewport(rows, -1600, 800 + 1600);
ok('window at the top starts at row 0', atTop.first === 0 && atTop.last > 0 && atTop.last < rows.length - 1);

const mid = V.rowRangeForViewport(rows, 4000, 4800);
ok('mid-scroll window excludes rows above and below', mid.first > 0 && mid.last < rows.length - 1 && mid.first <= mid.last);
ok('first row of the window really intersects the viewport',
  rows[mid.first].top + rows[mid.first].height > 4000 && rows[mid.first].top < 4800);
ok('row before the window is fully above the viewport', rows[mid.first - 1].top + rows[mid.first - 1].height <= 4000);
ok('row after the window is fully below the viewport', rows[mid.last + 1].top >= 4800);

const atEnd = V.rowRangeForViewport(rows, totalHeight - 500, totalHeight + 2000);
ok('window at the bottom ends at the last row', atEnd.last === rows.length - 1);

const beyond = V.rowRangeForViewport(rows, totalHeight + 5000, totalHeight + 6000);
ok('scroll far beyond the end clamps to a real row instead of blanking', beyond.first === rows.length - 1 && beyond.last === rows.length - 1);

const before = V.rowRangeForViewport(rows, -9000, -8000);
ok('viewport above the grid clamps to the first row', before.first === 0 && before.last === 0);

ok('empty rows produce an empty range', V.rowRangeForViewport([], 0, 100).last === -1);

// --- padHeights: spacers must reproduce the exact scroll geometry ---
const pads = V.padHeights(rows, mid.first, mid.last, gap, totalHeight);
// Materialized block: topPad + gap + rows[first..last] + gap + bottomPad == totalHeight.
const windowHeight = rows[mid.last].top + rows[mid.last].height - rows[mid.first].top;
ok('top pad + gap lands the first window row at its true offset', near(pads.top + gap, rows[mid.first].top));
ok('pads + window + gaps reconstruct the full grid height',
  near(pads.top + gap + windowHeight + gap + pads.bottom, totalHeight));

const topPads = V.padHeights(rows, 0, mid.last, gap, totalHeight);
ok('window touching the top needs no top pad', topPads.top === 0 && topPads.bottom > 0);

const bottomPads = V.padHeights(rows, mid.first, rows.length - 1, gap, totalHeight);
ok('window touching the bottom needs no bottom pad', bottomPads.bottom === 0 && bottomPads.top > 0);

const allPads = V.padHeights(rows, 0, rows.length - 1, gap, totalHeight);
ok('fully materialized grid needs no pads', allPads.top === 0 && allPads.bottom === 0);

ok('empty range needs no pads', V.padHeights(rows, 3, 2, gap, totalHeight).top === 0);

// --- cardRangeForRows ---
const cardRange = V.cardRangeForRows(rows, mid.first, mid.last);
ok('card range maps rows to inclusive card indices',
  cardRange.first === rows[mid.first].start && cardRange.last === rows[mid.last].end - 1);
ok('empty row range maps to an empty card range', V.cardRangeForRows(rows, 0, -1).last === -1);

// --- logical scroll anchor survives a width-dependent relayout ---
const anchorCard = 137;
const oldRowIndex = V.rowIndexForCard(rows, anchorCard);
ok('row lookup finds the row containing a virtual card',
  oldRowIndex >= 0 && rows[oldRowIndex].start <= anchorCard && rows[oldRowIndex].end > anchorCard);
ok('row lookup rejects cards outside the layout',
  V.rowIndexForCard(rows, -1) === -1 && V.rowIndexForCard(rows, 9999) === -1);

const gridTop = 260;
const desiredViewportTop = 34;
const narrower = J.layoutRows(new Array(300).fill(1.6), 720, { gap: 10, targetHeight: 160 });
const restoredScrollTop = V.scrollTopForCardAnchor(
  narrower.rows,
  anchorCard,
  gridTop,
  desiredViewportTop
);
const newRow = narrower.rows[V.rowIndexForCard(narrower.rows, anchorCard)];
ok('logical anchor keeps the same card row at the same viewport position after relayout',
  near(gridTop + newRow.top - restoredScrollTop, desiredViewportTop));
ok('invalid logical anchors do not produce a scroll target',
  V.scrollTopForCardAnchor(narrower.rows, 9999, gridTop, desiredViewportTop) === null);

const wider = J.layoutRows(new Array(300).fill(1.6), 1400, { gap: 10, targetHeight: 178 });
const widenedScrollTop = V.scrollTopForCardAnchor(wider.rows, anchorCard, gridTop, desiredViewportTop);
const widenedRow = wider.rows[V.rowIndexForCard(wider.rows, anchorCard)];
ok('the same logical card survives a second wider resize burst',
  near(gridTop + widenedRow.top - widenedScrollTop, desiredViewportTop));
const roundTripScrollTop = V.scrollTopForCardAnchor(rows, anchorCard, gridTop, desiredViewportTop);
const roundTripRow = rows[V.rowIndexForCard(rows, anchorCard)];
ok('the same logical card survives a width round trip',
  near(gridTop + roundTripRow.top - roundTripScrollTop, desiredViewportTop));

// --- mixed aspect ratios keep the math consistent ---
const aspects = Array.from({ length: 500 }, (_, i) => [0.7, 1, 1.5, 2.4, 1.78][i % 5]);
const mixed = J.layoutRows(aspects, 860, { gap: 10, targetHeight: 160 });
for (let viewTop = -1000; viewTop < mixed.totalHeight + 1000; viewTop += 777) {
  const r = V.rowRangeForViewport(mixed.rows, viewTop, viewTop + 900);
  const p = V.padHeights(mixed.rows, r.first, r.last, 10, mixed.totalHeight);
  // Invariant 1: with the top spacer in place, the first materialized row sits at
  // its true offset inside the grid.
  const firstOffset = p.top > 0 ? p.top + 10 : 0;
  assert.ok(near(firstOffset, mixed.rows[r.first].top), `first-row offset holds at viewTop=${viewTop}`);
  // Invariant 2: spacers + materialized window + their joining gaps reconstruct the
  // exact total height, so the scrollbar never jumps as the window moves.
  const windowH = mixed.rows[r.last].top + mixed.rows[r.last].height - mixed.rows[r.first].top;
  const reconstructed = firstOffset + windowH + (p.bottom > 0 ? 10 + p.bottom : 0);
  assert.ok(near(reconstructed, mixed.totalHeight), `total height holds at viewTop=${viewTop}`);
}
ok('scroll sweep across mixed aspects keeps spacer geometry exact', true);

console.log('\nAll ' + passed + ' virtual-window tests passed.');
