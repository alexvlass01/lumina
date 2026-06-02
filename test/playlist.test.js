'use strict';

// Plain Node test (no framework): `node test/playlist.test.js`.
// Covers the slideshow playlist logic that powers wallpaper resolution — the
// part most prone to silent regressions as multiple people touch main.js.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../src/playlist');

let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; };

// ---- normalizeSlot (config migration) ----
ok('normalizeSlot: legacy string -> one image item',
  JSON.stringify(P.normalizeSlot('a.jpg')) === JSON.stringify({ items: [{ type: 'image', path: 'a.jpg' }] }));
ok('normalizeSlot: empty string -> empty', P.normalizeSlot('').items.length === 0);
ok('normalizeSlot: drops invalid items',
  P.normalizeSlot({ items: [{ type: 'image', path: 'x' }, { type: 'bad', path: 'y' }, { type: 'folder' }] }).items.length === 1);
ok('normalizeSlot: null -> empty', P.normalizeSlot(null).items.length === 0);

// ---- pickCurrent (index -> image) ----
ok('pickCurrent: empty list -> ""', P.pickCurrent([], 0) === '');
ok('pickCurrent: wraps out-of-range', P.pickCurrent(['a', 'b', 'c'], 5) === 'c'); // 5 % 3 = 2
ok('pickCurrent: handles negative', P.pickCurrent(['a', 'b', 'c'], -1) === 'c');
ok('pickCurrent: index 0', P.pickCurrent(['a', 'b'], 0) === 'a');

// ---- nextIndex (slideshow advance) ----
ok('nextIndex: sequential +1', P.nextIndex(0, 3, false) === 1);
ok('nextIndex: sequential wraps', P.nextIndex(2, 3, false) === 0);
ok('nextIndex: <2 items stays', P.nextIndex(0, 1, false) === 0);
ok('nextIndex: shuffle never repeats current', (() => {
  for (let i = 0; i < 100; i++) if (P.nextIndex(1, 3, true) === 1) return false;
  return true;
})());
ok('nextIndex: shuffle deterministic with rnd', P.nextIndex(0, 3, true, () => 0.99) === 2); // floor(0.99*3)=2

// ---- resolveSlot (real temp folder) ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-pl-'));
fs.writeFileSync(path.join(dir, 'b.jpg'), 'x');
fs.writeFileSync(path.join(dir, 'a.png'), 'x');
fs.writeFileSync(path.join(dir, 'note.txt'), 'x'); // not an image
const realImg = path.join(dir, 'a.png');
const missing = path.join(dir, 'gone.jpg');
const list = P.resolveSlot({ items: [
  { type: 'image', path: realImg },   // explicit, also lives in the folder
  { type: 'image', path: missing },   // does not exist -> excluded
  { type: 'folder', path: dir },      // expands to a.png + b.jpg (sorted)
] });
ok('resolveSlot: excludes missing files', !list.includes(missing));
ok('resolveSlot: excludes non-images (.txt)', !list.some((p) => p.endsWith('.txt')));
ok('resolveSlot: de-dups folder vs explicit', list.filter((p) => p === realImg).length === 1);
ok('resolveSlot: includes folder images', list.some((p) => p.endsWith('a.png')) && list.some((p) => p.endsWith('b.jpg')));
fs.rmSync(dir, { recursive: true, force: true });

console.log('\nAll ' + passed + ' playlist tests passed.');
