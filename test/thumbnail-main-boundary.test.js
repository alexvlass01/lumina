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
assert.ok(block.includes('const key = `${p}|${W}`;'), 'dedup key matches the helper scalar size');
assert.ok(!main.includes('createThumbnailFromPath'), 'main no longer runs Windows thumbnail extraction');
assert.ok(main.includes('void thumbnailHost.dispose();'), 'app shutdown disposes the helper');

console.log('thumbnail-main-boundary.test.js ok');
