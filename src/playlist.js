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

// Expand a slot to a flat list of EXISTING paths (images + folder contents),
// de-duplicated, preserving order.
function resolveSlot(slot) {
  const out = [];
  const seen = new Set();
  const items = slot && Array.isArray(slot.items) ? slot.items : [];
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

module.exports = { IMG_EXTS, normalizeSlot, scanFolder, resolveSlot, pickCurrent, nextIndex };
