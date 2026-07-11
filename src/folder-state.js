'use strict';

// Persistent discovery metadata for images exposed through live library folders.
// This module never copies, removes, or edits wallpaper files. Filesystem-backed
// loading/saving is kept here so the recovery rules can be tested without Electron.

const fs = require('fs');
const path = require('path');

const VERSION = 3;
const VALID_SCAN_STATUSES = new Set(['complete', 'partial', 'unavailable']);
const DEFAULT_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif']);

function emptyState() {
  return { version: VERSION, folders: {} };
}

function finiteTime(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function finiteAspect(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeRelativePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');
}

function isSafeRelativePath(value) {
  const relativePath = normalizeRelativePath(value);
  if (!relativePath || relativePath.split('/').includes('..')) return false;
  return !path.isAbsolute(relativePath.replace(/\//g, path.sep));
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
      if (!isSafeRelativePath(relativePath)) continue;
      const key = relativePath.toLowerCase();
      files[key] = {
        relativePath,
        firstSeenAt: finiteTime(file.firstSeenAt),
        modifiedAt: finiteTime(file.modifiedAt),
      };
      const aspect = finiteAspect(file.aspect);
      if (aspect) files[key].aspect = aspect;
    }
    out.folders[folderId] = {
      rootPath: folder.rootPath,
      files,
      // Version 1 did not persist whether the 10k-limited scan was complete.
      // Continue it as a baseline so an old unseen tail is not labelled "new".
      baselineComplete: raw.version === 1 ? false : folder.baselineComplete !== false,
    };
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
    return { state, images: [], changed: false, contentChanged: false, added: 0, removed: 0 };
  }

  let folder = state.folders[folderId];
  let changed = false;
  let contentChanged = false;
  const isBaseline = !folder || !sameRoot(folder.rootPath, rootPath);
  if (isBaseline) {
    folder = { rootPath, files: {}, baselineComplete: false };
    state.folders[folderId] = folder;
    changed = true;
  }
  const baselinePending = folder.baselineComplete === false;

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
        firstSeenAt: baselinePending ? baselineAt : now,
        modifiedAt: finiteTime(entry && entry.modifiedAt),
      };
      const aspect = finiteAspect(entry && entry.aspect);
      if (aspect) metadata.aspect = aspect;
      folder.files[rel.key] = metadata;
      added++;
      changed = true;
      contentChanged = true;
    } else if (metadata.relativePath !== rel.relativePath) {
      // Preserve discovery time for case-only renames on Windows.
      metadata.relativePath = rel.relativePath;
      changed = true;
      contentChanged = true;
    }

    images.push({
      path: path.resolve(rootPath, rel.relativePath),
      firstSeenAt: metadata.firstSeenAt,
      addedAt: metadata.firstSeenAt,
      modifiedAt: metadata.modifiedAt,
      aspect: finiteAspect(metadata.aspect),
    });
  }

  let removed = 0;
  if (status === 'complete') {
    for (const key of Object.keys(folder.files)) {
      if (!seen.has(key)) {
        delete folder.files[key];
        removed++;
        changed = true;
        contentChanged = true;
      }
    }
    if (!folder.baselineComplete) {
      folder.baselineComplete = true;
      changed = true;
    }
  }

  return { state, images, changed, contentChanged, added, removed };
}

function removeFolder(rawState, folderId) {
  const state = normalizeState(rawState);
  const removed = !!(folderId && state.folders[folderId]);
  if (removed) delete state.folders[folderId];
  return { state, removed };
}

// Persist dimensions learned by the thumbnail pipeline without rescanning folders.
// The live in-memory state is already normalized, so mutate only matching metadata
// entries and return the same object. One path may belong to overlapping roots; all
// matching records receive the aspect so either source remains stable on its own.
function setAspects(rawState, updates) {
  const state = rawState && rawState.version === VERSION && rawState.folders
    ? rawState
    : normalizeState(rawState);
  const input = Array.isArray(updates) ? updates : [];
  let changed = false;
  let updated = 0;

  for (const update of input) {
    const filePath = update && typeof update.path === 'string' ? update.path : '';
    const aspect = finiteAspect(update && update.aspect);
    if (!filePath || !aspect) continue;
    for (const folder of Object.values(state.folders)) {
      const rel = relativeEntry(folder.rootPath, filePath);
      if (!rel) continue;
      const file = folder.files[rel.key];
      if (!file || Math.abs(finiteAspect(file.aspect) - aspect) < 0.0001) continue;
      file.aspect = aspect;
      changed = true;
      updated++;
    }
  }
  return { state, changed, updated };
}

function listImages(rawState, folderIds = null) {
  const state = normalizeState(rawState);
  const requested = Array.isArray(folderIds) ? new Set(folderIds) : null;
  const images = [];
  for (const [folderId, folder] of Object.entries(state.folders)) {
    if (requested && !requested.has(folderId)) continue;
    for (const file of Object.values(folder.files)) {
      images.push({
        folderId,
        path: path.resolve(folder.rootPath, file.relativePath),
        firstSeenAt: file.firstSeenAt,
        addedAt: file.firstSeenAt,
        modifiedAt: file.modifiedAt,
        aspect: finiteAspect(file.aspect),
      });
    }
  }
  return images;
}

function knownPathKeys(rawState, folderId) {
  const state = normalizeState(rawState);
  const folder = state.folders[folderId];
  if (!folder) return new Set();
  return new Set(Object.values(folder.files).map((file) => (
    path.resolve(folder.rootPath, file.relativePath).toLowerCase()
  )));
}

// Recursive, status-aware scan used for the library view and discovery index.
// A partial result may add confirmed files but must never prove that unseen files
// were deleted. The scan is async so large folders do not block Electron's main loop.
async function scanFolderTree(rootPath, options = {}) {
  const requestedRoot = String(rootPath || '').trim();
  if (!requestedRoot) return { status: 'unavailable', entries: [] };
  const root = path.resolve(requestedRoot);
  const maxDepth = Number.isFinite(options.maxDepth) ? Math.max(0, Math.floor(options.maxDepth)) : Infinity;
  // cap is retained only for explicit callers/tests. Production scans are
  // unlimited and yield/persist in batches instead of silently truncating.
  const cap = Number.isFinite(options.cap) ? Math.max(0, Math.floor(options.cap)) : Infinity;
  const batchSize = Number.isFinite(options.batchSize) ? Math.max(1, Math.floor(options.batchSize)) : 10000;
  const onBatch = typeof options.onBatch === 'function' ? options.onBatch : null;
  const yieldFn = typeof options.yieldFn === 'function'
    ? options.yieldFn
    : () => new Promise((resolve) => setImmediate(resolve));
  const knownPaths = options.knownPaths instanceof Set
    ? new Set(Array.from(options.knownPaths, (p) => path.resolve(String(p)).toLowerCase()))
    : new Set();
  const imageExts = options.imageExts instanceof Set ? options.imageExts : DEFAULT_IMAGE_EXTS;
  const io = options.fsPromises && typeof options.fsPromises === 'object' ? options.fsPromises : fs.promises;

  try {
    const stat = await io.stat(root);
    if (!stat.isDirectory()) return { status: 'unavailable', entries: [] };
  } catch {
    return { status: 'unavailable', entries: [] };
  }

  const entries = [];
  let batch = [];
  const seenDirs = new Set();
  const stack = [{ dir: root, depth: 0 }];
  let partial = false;

  scan: while (stack.length) {
    const current = stack.pop();
    let real;
    try { real = (await io.realpath(current.dir)).toLowerCase(); }
    catch {
      if (current.depth === 0) return { status: 'unavailable', entries: [] };
      partial = true;
      continue;
    }
    if (seenDirs.has(real)) continue;
    seenDirs.add(real);

    let children;
    try {
      children = await io.readdir(current.dir, { withFileTypes: true });
    } catch {
      if (current.depth === 0) return { status: 'unavailable', entries: [] };
      partial = true;
      continue;
    }
    children.sort((a, b) => a.name.localeCompare(b.name));

    for (const child of children) {
      const full = path.join(current.dir, child.name);
      if (child.isDirectory()) {
        if (current.depth < maxDepth) stack.push({ dir: full, depth: current.depth + 1 });
        else partial = true;
        continue;
      }
      if (!child.isFile() || !imageExts.has(path.extname(child.name).toLowerCase())) continue;
      if (entries.length >= cap) {
        partial = true;
        break scan;
      }
      try {
        const key = path.resolve(full).toLowerCase();
        const modifiedAt = knownPaths.has(key) ? 0 : finiteTime((await io.stat(full)).mtimeMs);
        const entry = { path: full, modifiedAt };
        entries.push(entry);
        batch.push(entry);
        if (batch.length >= batchSize) {
          if (onBatch) await onBatch(batch.slice(), { processed: entries.length });
          batch = [];
          await yieldFn();
        }
      } catch { partial = true; }
    }
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { status: partial ? 'partial' : 'complete', entries };
}

function validateStoredState(raw) {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw)
    && (raw.version === 1 || raw.version === 2 || raw.version === VERSION)
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
  isSafeRelativePath,
  relativeEntry,
  normalizeState,
  reconcileFolder,
  removeFolder,
  setAspects,
  listImages,
  knownPathKeys,
  scanFolderTree,
  loadState,
  saveState,
};
