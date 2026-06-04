'use strict';

// Plain Node test: `node test/library.test.js`. Covers the content-pool module —
// CRUD/dedup/list + the regression-prone config migration (inline slots → itemIds).

const assert = require('assert');
const L = require('../src/library');

let passed = 0;
const ok = (n, c) => { assert.ok(c, n); console.log('  ✓ ' + n); passed++; };

// ---- idFor: stable + path-normalized ----
ok('idFor: stable for same path', L.idFor('C:/a.jpg') === L.idFor('C:/a.jpg'));
ok('idFor: case/slash/trailing-insensitive',
  L.idFor('C:\\Pics\\A.JPG\\') === L.idFor('c:/pics/a.jpg'));
ok('idFor: different paths differ', L.idFor('C:/a.jpg') !== L.idFor('C:/b.jpg'));

// ---- makeItem defaults ----
const it = L.makeItem('image', 'C:/a.jpg');
ok('makeItem: defaults', it.type === 'image' && it.favorite === false
  && Array.isArray(it.tags) && it.tags.length === 0 && it.author === ''
  && Number.isFinite(it.addedAt) && it.id === L.idFor('C:/a.jpg'));
ok('makeItem: folder type coerced', L.makeItem('folder', 'C:/d').type === 'folder');
ok('makeItem: unknown type -> image', L.makeItem('weird', 'C:/x').type === 'image');

// ---- addItem / dedup / getItem / removeItem ----
const lib = {};
const id1 = L.addPath(lib, 'image', 'C:/a.jpg');
const id2 = L.addPath(lib, 'image', 'C:/a.jpg'); // same path -> dedup
ok('addPath: dedup by id (same path => same id, one entry)',
  id1 === id2 && Object.keys(lib).length === 1);
ok('addItem: invalid -> null', L.addItem(lib, { type: 'image' }) === null && L.addPath(lib, 'image', '') === null);

// existing item preserved (metadata not clobbered on re-add)
lib[id1].favorite = true;
L.addPath(lib, 'image', 'C:/a.jpg');
ok('addItem: existing metadata preserved on re-add', lib[id1].favorite === true);

ok('getItem: hit / miss', L.getItem(lib, id1).path === 'C:/a.jpg' && L.getItem(lib, 'nope') === null);
const idFolder = L.addPath(lib, 'folder', 'C:/pics');
ok('removeItem: removes', L.removeItem(lib, idFolder) === true && L.getItem(lib, idFolder) === null);
ok('removeItem: missing -> false', L.removeItem(lib, 'nope') === false);

// ---- toggleFavorite ----
lib[id1].favorite = false;
ok('toggleFavorite: flips + returns state', L.toggleFavorite(lib, id1) === true && lib[id1].favorite === true);
ok('toggleFavorite: missing -> false', L.toggleFavorite(lib, 'nope') === false);

// ---- resolveIds: order preserved, unknown skipped ----
const lib2 = {};
const a = L.addPath(lib2, 'image', 'C:/a.jpg');
const b = L.addPath(lib2, 'image', 'C:/b.jpg');
const resolved = L.resolveIds(lib2, [b, 'ghost', a]);
ok('resolveIds: order kept + unknown skipped',
  resolved.length === 2 && resolved[0].path === 'C:/b.jpg' && resolved[1].path === 'C:/a.jpg');

// ---- listItems: filter + sort ----
const lib3 = {};
L.addItem(lib3, L.makeItem('image', 'C:/z.jpg', { addedAt: 100 }));
L.addItem(lib3, L.makeItem('image', 'C:/a.jpg', { addedAt: 300, favorite: true }));
L.addItem(lib3, L.makeItem('folder', 'C:/d',    { addedAt: 200 }));
ok('listItems: sort added (newest first)',
  L.listItems(lib3, { sort: 'added' }).map((x) => x.addedAt).join() === '300,200,100');
ok('listItems: sort name', L.listItems(lib3, { sort: 'name' }).map((x) => L.baseName(x.path)).join() === 'a.jpg,d,z.jpg');
ok('listItems: filter type=image', L.listItems(lib3, { filter: { type: 'image' } }).length === 2);
ok('listItems: filter favorite', (() => {
  const f = L.listItems(lib3, { filter: { favorite: true } });
  return f.length === 1 && f[0].path === 'C:/a.jpg';
})());

// ---- tags ----
const lib4 = {};
const t1 = L.addPath(lib4, 'image', 'C:/t1.jpg');
const t2 = L.addPath(lib4, 'image', 'C:/t2.jpg');
ok('addTag: normalizes (trim/case) + creates array', (() => {
  L.addTag(lib4, t1, '  Nature  ');
  return lib4[t1].tags.length === 1 && lib4[t1].tags[0] === 'nature';
})());
ok('addTag: dedups (case-insensitive)', L.addTag(lib4, t1, 'NATURE') === false && lib4[t1].tags.length === 1);
ok('addTag: empty tag ignored', L.addTag(lib4, t1, '   ') === false);
ok('removeTag: removes', (() => { L.addTag(lib4, t1, 'space'); L.removeTag(lib4, t1, 'Nature'); return JSON.stringify(lib4[t1].tags) === JSON.stringify(['space']); })());
ok('removeTag: missing -> false', L.removeTag(lib4, t1, 'ghost') === false);
ok('allTags: distinct + sorted', (() => {
  L.addTag(lib4, t2, 'beach'); L.addTag(lib4, t2, 'space');
  return JSON.stringify(L.allTags(lib4)) === JSON.stringify(['beach', 'space']);
})());
ok('listItems: filter by tag', (() => {
  const r = L.listItems(lib4, { filter: { tag: 'space' } });
  return r.length === 2;
})());

// ---- migrateSlot ----
const ms = {};
ok('migrateSlot: legacy string -> itemIds', (() => {
  const s = L.migrateSlot(ms, 'C:/one.jpg');
  return s.itemIds.length === 1 && L.getItem(ms, s.itemIds[0]).path === 'C:/one.jpg';
})());
ok('migrateSlot: {items} image+folder -> 2 ids w/ types', (() => {
  const lc = {};
  const s = L.migrateSlot(lc, { items: [{ type: 'image', path: 'C:/p.jpg' }, { type: 'folder', path: 'C:/dir' }] });
  return s.itemIds.length === 2
    && L.getItem(lc, s.itemIds[0]).type === 'image'
    && L.getItem(lc, s.itemIds[1]).type === 'folder';
})());
ok('migrateSlot: dedup same path within slot', (() => {
  const lc = {};
  const s = L.migrateSlot(lc, { items: [{ type: 'image', path: 'C:/dup.jpg' }, { type: 'image', path: 'C:/dup.jpg' }] });
  return s.itemIds.length === 1 && Object.keys(lc).length === 1;
})());
ok('migrateSlot: already-new {itemIds} kept', (() => {
  const s = L.migrateSlot({}, { itemIds: ['abc', 'def'] });
  return s.itemIds.join() === 'abc,def';
})());

// ---- migrateConfig: the real thing ----
ok('migrateConfig: two monitors, light/dark not mixed up', (() => {
  const cfg = {
    monitors: {
      M1: { light: 'C:/m1-light.jpg', dark: 'C:/m1-dark.jpg' },
      M2: { light: { items: [{ type: 'image', path: 'C:/m2-light.jpg' }] }, dark: '' },
    },
  };
  L.migrateConfig(cfg);
  const m1l = L.getItem(cfg.library, cfg.monitors.M1.light.itemIds[0]);
  const m1d = L.getItem(cfg.library, cfg.monitors.M1.dark.itemIds[0]);
  return m1l.path === 'C:/m1-light.jpg' && m1d.path === 'C:/m1-dark.jpg'
    && cfg.monitors.M2.light.itemIds.length === 1 && cfg.monitors.M2.dark.itemIds.length === 0
    && L.getItem(cfg.library, cfg.monitors.M2.light.itemIds[0]).path === 'C:/m2-light.jpg';
})());

ok('migrateConfig: legacy globals folded into pool, string fields kept', (() => {
  const cfg = { monitors: {}, lightWallpaper: 'C:/glob-l.jpg', darkWallpaper: 'C:/glob-d.jpg' };
  L.migrateConfig(cfg);
  const paths = Object.values(cfg.library).map((x) => x.path).sort();
  return paths.join() === 'C:/glob-d.jpg,C:/glob-l.jpg'
    && cfg.lightWallpaper === 'C:/glob-l.jpg' && cfg.darkWallpaper === 'C:/glob-d.jpg';
})());

ok('migrateConfig: idempotent (run twice = same)', (() => {
  const cfg = { monitors: { M: { light: 'C:/a.jpg', dark: '' } } };
  L.migrateConfig(cfg);
  const snap = JSON.stringify(cfg);
  L.migrateConfig(cfg);
  return JSON.stringify(cfg) === snap;
})());

ok('migrateConfig: empty/garbage safe', (() => {
  const cfg = {};
  L.migrateConfig(cfg);
  return typeof cfg.library === 'object' && Object.keys(cfg.library).length === 0;
})());

// ---- flattenImages: pool images + expanded folders, deduped by id ----
const lib5 = {};
L.addPath(lib5, 'image', 'C:/photos/a.jpg');
L.addPath(lib5, 'folder', 'C:/photos/dir');
// stub scanDeep: the folder expands to b.jpg + a.jpg (a.jpg duplicates the pool image by path)
const scanDeep = (d) => (d === 'C:/photos/dir' ? ['C:/photos/dir/b.jpg', 'C:/photos/a.jpg'] : []);
const flat = L.flattenImages(lib5, scanDeep);
ok('flattenImages: pool image present + inPool=true',
  flat.some((x) => x.path === 'C:/photos/a.jpg' && x.inPool === true));
ok('flattenImages: folder image present + inPool=false',
  flat.some((x) => x.path === 'C:/photos/dir/b.jpg' && x.inPool === false));
ok('flattenImages: dedup pool vs folder by id (a.jpg once, pool wins)',
  flat.filter((x) => x.id === L.idFor('C:/photos/a.jpg')).length === 1
  && flat.find((x) => x.id === L.idFor('C:/photos/a.jpg')).inPool === true);
ok('flattenImages: folder items themselves excluded', !flat.some((x) => x.path === 'C:/photos/dir'));
ok('flattenImages: no scanDeep -> pool images only',
  L.flattenImages(lib5, null).every((x) => x.inPool) && L.flattenImages(lib5, null).length === 1);

console.log('\nAll ' + passed + ' library tests passed.');
