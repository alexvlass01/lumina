'use strict';

// Persistent discovery metadata for images exposed through live library folders.
// This module never copies, removes, or edits wallpaper files. Filesystem-backed
// loading/saving is kept here so the recovery rules can be tested without Electron.

const fs = require('fs');
const path = require('path');

const VERSION = 1;
const VALID_SCAN_STATUSES = new Set(['complete', 'partial', 'unavailable']);

function emptyState() {
  return { version: VERSION, folders: {} };
}

function finiteTime(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function normalizeRelativePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');
}

function relativeEntry(rootPath, filePath) {
  if (!rootPath || !filePath) return null;
  const relative = path.relative(path.resolve(rootPath), path.resolve(filePath));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  const displayPath = normalizeRelativePath(relative);
  if (!displayPath) return null;
  return { key: displayPath.toLowerCase(), relativePath: displayPath };
}

function normalizeState(raw) {
  const out = emptyState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const folders = raw.folders && typeof raw.folders === 'object' && !Array.isArray(raw.folders)
    ? raw.folders
    : {};

  for (const [folderId, folder] of Object.entries(folders)) {
    if (!folderId || !folder || typeof folder !== 'object' || typeof folder.rootPath !== 'string') continue;
    const files = {};
    const inputFiles = folder.files && typeof folder.files === 'object' && !Array.isArray(folder.files)
      ? folder.files
      : {};
    for (const [rawKey, file] of Object.entries(inputFiles)) {
      if (!file || typeof file !== 'object') continue;
      const relativePath = normalizeRelativePath(file.relativePath || rawKey);
      if (!relativePath) continue;
      const key = relativePath.toLowerCase();
      files[key] = {
        relativePath,
        firstSeenAt: finiteTime(file.firstSeenAt),
        modifiedAt: finiteTime(file.modifiedAt),
      };
    }
    out.folders[folderId] = { rootPath: folder.rootPath, files };
  }
  return out;
}

function sameRoot(a, b) {
  return path.resolve(String(a || '')).toLowerCase() === path.resolve(String(b || '')).toLowerCase();
}

// Reconcile one scan with persisted state. Only a COMPLETE scan may remove
// unseen paths; partial/unavailable results are deliberately conservative.
function reconcileFolder(rawState, options = {}) {
  const state = normalizeState(rawState);
  const folderId = String(options.folderId || '').trim();
  const rootPath = String(options.rootPath || '').trim();
  const status = VALID_SCAN_STATUSES.has(options.status) ? options.status : 'partial';
  const now = finiteTime(options.now, Date.now());
  const baselineAt = finiteTime(options.folderAddedAt, now);
  const scanEntries = Array.isArray(options.entries) ? options.entries : [];

  if (!folderId || !rootPath || status === 'unavailable') {
    return { state, images: [], changed: false, added: 0, removed: 0 };
  }

  let folder = state.folders[folderId];
  let changed = false;
  const isBaseline = !folder || !sameRoot(folder.rootPath, rootPath);
  if (isBaseline) {
    folder = { rootPath, files: {} };
    state.folders[folderId] = folder;
    changed = true;
  }

  const seen = new Set();
  const images = [];
  let added = 0;
  for (const entry of scanEntries) {
    const filePath = typeof entry === 'string' ? entry : entry && entry.path;
    const rel = relativeEntry(rootPath, filePath);
    if (!rel || seen.has(rel.key)) continue;
    seen.add(rel.key);

    let metadata = folder.files[rel.key];
    if (!metadata) {
      metadata = {
        relativePath: rel.relativePath,
        firstSeenAt: isBaseline ? baselineAt : now,
        modifiedAt: finiteTime(entry && entry.modifiedAt),
      };
      folder.files[rel.key] = metadata;
      added++;
      changed = true;
    } else if (metadata.relativePath !== rel.relativePath) {
      // Preserve discovery time for case-only renames on Windows.
      metadata.relativePath = rel.relativePath;
      changed = true;
    }

    images.push({
      path: path.resolve(rootPath, rel.relativePath),
      firstSeenAt: metadata.firstSeenAt,
      addedAt: metadata.firstSeenAt,
      modifiedAt: metadata.modifiedAt,
    });
  }

  let removed = 0;
  if (status === 'complete') {
    for (const key of Object.keys(folder.files)) {
      if (!seen.has(key)) {
        delete folder.files[key];
        removed++;
        changed = true;
      }
    }
  }

  return { state, images, changed, added, removed };
}

function removeFolder(rawState, folderId) {
  const state = normalizeState(rawState);
  const removed = !!(folderId && state.folders[folderId]);
  if (removed) delete state.folders[folderId];
  return { state, removed };
}

function validateStoredState(raw) {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw)
    && raw.version === VERSION
    && raw.folders && typeof raw.folders === 'object' && !Array.isArray(raw.folders);
}

function loadState(filePath, options = {}) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { state: emptyState(), recovered: false, brokenPath: '' };
    throw err;
  }

  try {
    const raw = JSON.parse(text);
    if (!validateStoredState(raw)) throw new Error('Unsupported folder-state format');
    return { state: normalizeState(raw), recovered: false, brokenPath: '' };
  } catch {
    const stamp = finiteTime(options.now, Date.now());
    const brokenPath = `${filePath}.broken-${stamp}`;
    try { fs.renameSync(filePath, brokenPath); }
    catch { return { state: emptyState(), recovered: true, brokenPath: '' }; }
    return { state: emptyState(), recovered: true, brokenPath };
  }
}

function saveState(filePath, rawState) {
  const state = normalizeState(rawState);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch {}
    throw err;
  }
  return state;
}

module.exports = {
  VERSION,
  emptyState,
  normalizeRelativePath,
  relativeEntry,
  normalizeState,
  reconcileFolder,
  removeFolder,
  loadState,
  saveState,
};
