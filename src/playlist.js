'use strict';

// Pure-ish playlist logic for the slideshow engine, extracted from main.js so it
// can be unit-tested WITHOUT launching Electron (see test/playlist.test.js).
// These functions take their inputs as arguments and only touch the filesystem —
// no Electron/app/config globals — which is what makes them safe to test.

const fs = require('fs');
const path = require('path');

const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif']);

// Normalize a slot to { items: Item[] }. Legacy format was a plain string path
// (or empty). Item = { type: 'image' | 'folder', path }.
function normalizeSlot(slot) {
  if (typeof slot === 'string') return { items: slot ? [{ type: 'image', path: slot }] : [] };
  if (slot && Array.isArray(slot.items)) {
    return { items: slot.items.filter((it) => it && it.path && (it.type === 'image' || it.type === 'folder')) };
  }
  return { items: [] };
}

// List image files in a folder (sorted by name), cached for a few seconds so a
// rotating slideshow doesn't re-read the directory on every tick.
const folderScanCache = new Map(); // dir -> { at, files }
function scanFolder(dir) {
  const cached = folderScanCache.get(dir);
  if (cached && Date.now() - cached.at < 5000) return cached.files;
  let files = [];
  try {
    files = fs.readdirSync(dir)
      .filter((f) => IMG_EXTS.has(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
      .map((f) => path.join(dir, f));
  } catch { files = []; }
  folderScanCache.set(dir, { at: Date.now(), files });
  return files;
}

// Like scanFolder but returns BOTH subfolders and images (one level) — for in-place
// library navigation (opening a folder to browse its contents + drill into subfolders).
const folderEntriesCache = new Map(); // dir -> { at, entries }
function scanFolderEntries(dir) {
  const cached = folderEntriesCache.get(dir);
  if (cached && Date.now() - cached.at < 5000) return cached.entries;
  const folders = [];
  const images = [];
  try {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) folders.push(full);
      else if (d.isFile() && IMG_EXTS.has(path.extname(d.name).toLowerCase())) images.push(full);
    }
    folders.sort((a, b) => a.localeCompare(b));
    images.sort((a, b) => a.localeCompare(b));
  } catch { /* unreadable dir -> empty */ }
  const entries = { folders, images };
  folderEntriesCache.set(dir, { at: Date.now(), entries });
  return entries;
}

// Recursively collect image paths under `dir`, depth- and count-limited. Guards
// against huge trees (cap) and symlink cycles (realpath set). Powers the flat
// "All" view and folder image counts. NOTE: deliberately NOT used by resolveSlot —
// the slideshow stays one-level so assigning a folder behaves as before.
function scanFolderImagesDeep(dir, opts = {}) {
  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : 8;
  const cap = Number.isFinite(opts.cap) ? opts.cap : 10000;
  const out = [];
  const seenDirs = new Set();
  const stack = [{ dir, depth: 0 }];
  while (stack.length && out.length < cap) {
    const { dir: d, depth } = stack.pop();
    let real;
    try { real = fs.realpathSync(d); } catch { continue; }
    if (seenDirs.has(real)) continue; // cycle guard
    seenDirs.add(real);
    const { folders, images } = scanFolderEntries(d);
    for (const img of images) { if (out.length >= cap) break; out.push(img); }
    if (depth < maxDepth) {
      for (const f of folders) stack.push({ dir: f, depth: depth + 1 });
    }
  }
  return out;
}

// Expand a slot to a flat list of EXISTING paths (images + folder contents),
// de-duplicated, preserving order.
//
// New model: slot = { itemIds:[…] } + a `library` pool → items are resolved by id.
// Backward compatible: called as resolveSlot(slot) on a legacy { items:[…] } slot
// (no library) it behaves exactly as before. (Library model lands fully in Этап B.)
function resolveSlot(slot, library) {
  const out = [];
  const seen = new Set();
  let items;
  if (library && slot && Array.isArray(slot.itemIds)) {
    items = slot.itemIds.map((id) => library[id]).filter(Boolean);
  } else {
    items = slot && Array.isArray(slot.items) ? slot.items : [];
  }
  for (const it of items) {
    if (!it || !it.path) continue;
    const paths = it.type === 'folder' ? scanFolder(it.path) : [it.path];
    for (const p of paths) {
      const k = p.toLowerCase();
      if (!seen.has(k) && fs.existsSync(p)) { seen.add(k); out.push(p); }
    }
  }
  return out;
}

// Index of a specific path within a slot's EXPANDED playlist (-1 if absent). The
// slideshow index addresses the expanded list (a folder is one strip item but many
// resolved paths), so "apply this exact thumbnail" must map a path → expanded index
// rather than trusting the strip's item index. Case-insensitive match.
function resolvedIndexOf(slot, library, p) {
  if (!p) return -1;
  const list = resolveSlot(slot, library);
  const key = String(p).toLowerCase();
  return list.findIndex((x) => String(x).toLowerCase() === key);
}

// Element of `list` at `idx`, wrapped into range. '' for an empty list.
function pickCurrent(list, idx) {
  if (!list || !list.length) return '';
  let i = (Number.isFinite(idx) ? idx : 0) % list.length;
  if (i < 0) i += list.length;
  return list[i];
}

// Next slideshow index: sequential (+1, wrap) or shuffle (random, never the
// current one). `rnd` is injectable for deterministic tests.
function nextIndex(cur, len, shuffle, rnd = Math.random) {
  if (len < 2) return Number.isFinite(cur) ? cur : 0;
  if (!shuffle) return ((Number.isFinite(cur) ? cur : 0) + 1) % len;
  let n;
  do { n = Math.floor(rnd() * len); } while (n === cur);
  return n;
}

// Existing configs predate the interval toggle, so only an explicit false disables it.
function usesInterval(slideshow) {
  return !!(slideshow && slideshow.enabled && slideshow.intervalEnabled !== false);
}

module.exports = {
  IMG_EXTS, normalizeSlot, scanFolder, scanFolderEntries, scanFolderImagesDeep,
  resolveSlot, resolvedIndexOf, pickCurrent, nextIndex, usesInterval,
};
