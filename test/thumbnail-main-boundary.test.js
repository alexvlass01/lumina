'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const start = main.indexOf('const thumbCache = new Map();');
const end = main.indexOf('function liveFolderDiscovery', start);
assert.ok(start >= 0 && end > start, 'thumbnail integration block is present');
const block = main.slice(start, end);

assert.ok(block.includes('thumbnailHost.thumbnail(p, W, 82)'), 'main delegates extraction to ThumbnailHost');
assert.ok(block.includes('result.dataBase64'), 'main consumes the encoded helper payload');
assert.ok(block.includes("url: 'data:' + mime + ';base64,' + body"), 'thumbInfo keeps its data URL shape');
assert.ok(block.includes("ipcMain.handle('thumb'"), 'thumb IPC remains registered');
assert.ok(block.includes("ipcMain.handle('thumb-info'"), 'thumb-info IPC remains registered');
assert.ok(block.includes("ipcMain.handle('thumb-aspects'"), 'thumb-aspects IPC remains registered');
assert.ok(block.includes('thumbPending.get(key)'), 'matching pending work stays deduplicated');
assert.ok(block.includes('runThumbnailTask(async () =>'), 'thumbnail work stays in the bounded task queue');
assert.ok(block.includes('}, { priority }).finally'), 'current virtual window priority reaches the task queue');
assert.ok(block.includes('queueLiveFolderAspect(p, data.width / data.height)'),
  'successful thumbnails enqueue persistent live-folder aspect metadata');
assert.ok(main.includes('library.setAspect(config.library, id, update.path, update.aspect)'),
  'materialized live-folder images receive the same persistent aspect metadata');
assert.ok(main.includes('if (configChanged) configMod.save(config, CONFIG_PATH);'),
  'aspect-only pool backfill is saved without a renderer config broadcast');
assert.ok(block.includes('const key = `${p}|${W}`;'), 'dedup key matches the helper scalar size');
assert.ok(!main.includes('createThumbnailFromPath'), 'main no longer runs Windows thumbnail extraction');
assert.ok(main.includes('void thumbnailHost.dispose();'), 'app shutdown disposes the helper');
assert.ok(/flushPendingLiveFolderAspects\(\);\r?\n  flushLiveFolderState\(\);/.test(main),
  'shutdown flushes learned aspects before saving folder state');
assert.ok(main.includes('aspect: (m && m.aspect) || 0'),
  'folder navigation exposes persisted aspect metadata to renderer');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
assert.ok(renderer.includes('knownLibAspect(item, path, entry && entry.aspect)'),
  'virtual layout uses persisted folder aspects before creating cards');
assert.ok(renderer.includes('buildEphemeralImageCard(entry.path, entry.aspect)'),
  'ephemeral cards start with their persisted aspect metadata');
assert.ok(renderer.includes('Math.abs(current - window.JustifiedLayout.normalizeAspect(aspect, 0.65, 3))'),
  'a replaced file can correct stale persisted geometry from its real thumbnail');

console.log('thumbnail-main-boundary.test.js ok');
