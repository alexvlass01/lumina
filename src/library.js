'use strict';

// Wallpaper library — the CONTENT POOL, decoupled from placement.
//
// Design (agreed 2026-06-03, see future-todo #16): a slot (monitor × theme) stops
// embedding wallpaper objects and instead references pool items by `id`. This module
// owns the pool itself: create/dedup/list/resolve items + a one-time migration that
// hoists the old inline-slot model into the pool. Pure & injectable (no Electron) so
// the regression-prone migration is unit-testable directly (see test/library.test.js).
//
// Item = { id, type:'image'|'folder', path, addedAt, favorite, tags:[], author }
// Library (pool) = { [id]: Item }
//
// NOTE (Этап A): this module is additive — config.normalize() does NOT call
// migrateConfig() yet, so the live app keeps using inline slots. Etап B flips the
// model (normalize → migrate, main.js/renderer → itemIds) atomically.

const crypto = require('crypto');
const playlist = require('./playlist');

// Stable id from a normalized absolute path (cheap; no file read). Import already
// content-hashes stored filenames, so identical images mostly collapse to one path.
function idFor(p) {
  const norm = String(p || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

function baseName(p) {
  const s = String(p || '').replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : s;
}

// Build a pool item with metadata defaults. type: 'image' | 'folder'.
function makeItem(type, p, extra = {}) {
  return {
    id: idFor(p),
    type: type === 'folder' ? 'folder' : 'image',
    path: p,
    addedAt: Number.isFinite(extra.addedAt) ? extra.addedAt : Date.now(),
    favorite: !!extra.favorite,
    tags: Array.isArray(extra.tags) ? extra.tags.slice() : [],
    author: typeof extra.author === 'string' ? extra.author : '',
  };
}

// Add an item to the pool (dedup by id). Returns the id, or null if invalid.
// An existing item is preserved (its metadata — e.g. favorite/tags — is not clobbered).
function addItem(library, item) {
  if (!library || typeof library !== 'object' || !item || !item.path) return null;
  const it = item.id && item.type ? item : makeItem(item.type, item.path, item);
  if (!library[it.id]) library[it.id] = it;
  return it.id;
}

// Convenience: add by (type, path). Returns id.
function addPath(library, type, p, extra) {
  if (!p || typeof p !== 'string') return null;
  return addItem(library, makeItem(type, p, extra));
}

function getItem(library, id) {
  return library && id && library[id] ? library[id] : null;
}

function removeItem(library, id) {
  if (library && id && library[id]) { delete library[id]; return true; }
  return false;
}

function toggleFavorite(library, id) {
  const it = getItem(library, id);
  if (!it) return false;
  it.favorite = !it.favorite;
  return it.favorite;
}

// Resolve an ordered list of ids → items (skips unknown ids), preserving order.
function resolveIds(library, ids) {
  const out = [];
  for (const id of (Array.isArray(ids) ? ids : [])) {
    const it = getItem(library, id);
    if (it) out.push(it);
  }
  return out;
}

// List pool items with optional filter + sort.
//   filter: { type?: 'image'|'folder', favorite?: true }
//   sort:   'added' (newest first, default) | 'added-asc' | 'name' | 'name-desc'
function listItems(library, opts = {}) {
  let items = Object.values(library || {});
  const f = opts.filter || {};
  if (f.type) items = items.filter((it) => it.type === f.type);
  if (f.favorite) items = items.filter((it) => it.favorite);
  const byName = (a, b) => baseName(a.path).localeCompare(baseName(b.path));
  switch (opts.sort) {
    case 'name': items.sort(byName); break;
    case 'name-desc': items.sort((a, b) => byName(b, a)); break;
    case 'added-asc': items.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0)); break;
    default: items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)); // newest first
  }
  return items;
}

// ---- migration: inline-slot model → library-pool model (idempotent) ----

// One slot → { itemIds:[…] }. Accepts the new {itemIds} shape (kept as-is), the
// current {items:[{type,path}]} shape, or the legacy string path. Populates `library`.
function migrateSlot(library, slot) {
  if (slot && Array.isArray(slot.itemIds)) {
    return { itemIds: slot.itemIds.filter((id) => typeof id === 'string' && id) };
  }
  const norm = playlist.normalizeSlot(slot); // -> { items: [{type,path}] }
  const itemIds = [];
  for (const it of norm.items) {
    const id = addPath(library, it.type, it.path);
    if (id && !itemIds.includes(id)) itemIds.push(id); // dedup within the slot
  }
  return { itemIds };
}

// Migrate a whole config: populate cfg.library and rewrite monitor slots to itemIds.
// Non-destructive to legacy globals (lightWallpaper/darkWallpaper kept as fallback
// strings AND folded into the pool so they show up in the library). Idempotent.
function migrateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  if (!cfg.library || typeof cfg.library !== 'object') cfg.library = {};
  const lib = cfg.library;

  if (cfg.monitors && typeof cfg.monitors === 'object') {
    for (const devId of Object.keys(cfg.monitors)) {
      const m = cfg.monitors[devId] || {};
      cfg.monitors[devId] = { light: migrateSlot(lib, m.light), dark: migrateSlot(lib, m.dark) };
    }
  }
  for (const p of [cfg.lightWallpaper, cfg.darkWallpaper]) {
    if (p && typeof p === 'string') addPath(lib, 'image', p);
  }
  return cfg;
}

module.exports = {
  idFor, baseName, makeItem, addItem, addPath, getItem, removeItem,
  toggleFavorite, resolveIds, listItems, migrateSlot, migrateConfig,
};
