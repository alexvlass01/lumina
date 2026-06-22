'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('../src/folder-state');

let passed = 0;
const ok = (name, condition) => { assert.ok(condition, name); console.log('  ✓ ' + name); passed++; };

const root = path.join('C:\\', 'Wallpapers');
const a = path.join(root, 'a.jpg');
const b = path.join(root, 'b.jpg');
const c = path.join(root, 'nested', 'c.png');

let result = F.reconcileFolder(F.emptyState(), {
  folderId: 'folder-1', rootPath: root, folderAddedAt: 1000, now: 9000, status: 'complete',
  entries: [{ path: a, modifiedAt: 100 }, { path: b, modifiedAt: 200 }],
});
ok('baseline inherits folder addedAt', result.added === 2
  && result.images.every((x) => x.firstSeenAt === 1000));
ok('baseline preserves initial modifiedAt', result.images.find((x) => x.path === b).modifiedAt === 200);

result = F.reconcileFolder(result.state, {
  folderId: 'folder-1', rootPath: root, folderAddedAt: 1000, now: 10000, status: 'complete',
  entries: [{ path: a, modifiedAt: 999 }, { path: b, modifiedAt: 200 }, { path: c, modifiedAt: 50 }],
});
ok('later file receives discovery time', result.added === 1
  && result.images.find((x) => x.path === c).firstSeenAt === 10000);
ok('known file keeps original metadata', result.images.find((x) => x.path === a).modifiedAt === 100);

const beforePartial = result.state;
result = F.reconcileFolder(beforePartial, {
  folderId: 'folder-1', rootPath: root, now: 11000, status: 'partial', entries: [{ path: a }],
});
ok('partial scan never removes unseen files', result.removed === 0
  && Object.keys(result.state.folders['folder-1'].files).length === 3);

result = F.reconcileFolder(result.state, {
  folderId: 'folder-1', rootPath: root, now: 12000, status: 'complete', entries: [{ path: a }, { path: c }],
});
ok('complete scan removes missing files', result.removed === 1
  && Object.keys(result.state.folders['folder-1'].files).length === 2);

result = F.reconcileFolder(result.state, {
  folderId: 'folder-1', rootPath: root, now: 13000, status: 'complete', entries: [{ path: a }, { path: b }, { path: c }],
});
ok('reappearing file is new again', result.images.find((x) => x.path === b).firstSeenAt === 13000);

const unavailable = F.reconcileFolder(result.state, {
  folderId: 'folder-1', rootPath: root, now: 14000, status: 'unavailable', entries: [],
});
ok('unavailable folder preserves state', unavailable.changed === false
  && Object.keys(unavailable.state.folders['folder-1'].files).length === 3);

const outside = F.reconcileFolder(result.state, {
  folderId: 'folder-1', rootPath: root, now: 15000, status: 'partial',
  entries: [{ path: path.join('C:\\', 'Elsewhere', 'escape.jpg') }],
});
ok('paths outside the folder are ignored', outside.images.length === 0 && outside.added === 0);

const removedFolder = F.removeFolder(result.state, 'folder-1');
ok('explicit folder removal prunes state', removedFolder.removed && !removedFolder.state.folders['folder-1']);

const listed = F.listImages(result.state, ['folder-1']);
ok('listImages exposes persisted discovery metadata', listed.length === 3
  && listed.find((x) => x.path === b).addedAt === 13000
  && listed.every((x) => x.folderId === 'folder-1'));

const sanitized = F.normalizeState({ version: 1, folders: { bad: { rootPath: root, files: {
  '../escape.jpg': { firstSeenAt: 1 },
  'C:/absolute.jpg': { firstSeenAt: 2 },
  'safe.jpg': { firstSeenAt: 3 },
} } } });
ok('stored traversal and absolute paths are rejected', Object.keys(sanitized.folders.bad.files).length === 1
  && sanitized.folders.bad.files['safe.jpg'].firstSeenAt === 3);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-folder-state-'));
const statePath = path.join(temp, 'folder-state.json');
try {
  const saved = F.saveState(statePath, result.state);
  const loaded = F.loadState(statePath);
  ok('state round-trips through disk', !loaded.recovered
    && JSON.stringify(loaded.state) === JSON.stringify(saved));

  fs.writeFileSync(statePath, '{broken json', 'utf8');
  const recovered = F.loadState(statePath, { now: 4242 });
  ok('corrupt state is backed up and rebuilt safely', recovered.recovered
    && recovered.brokenPath.endsWith('.broken-4242')
    && fs.existsSync(recovered.brokenPath)
    && Object.keys(recovered.state.folders).length === 0);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

async function testScanner() {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-folder-scan-'));
  try {
    fs.writeFileSync(path.join(tree, 'top.jpg'), 'x');
    fs.writeFileSync(path.join(tree, 'ignore.txt'), 'x');
    const nested = path.join(tree, 'nested');
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, 'deep.png'), 'x');

    const complete = await F.scanFolderTree(tree);
    ok('recursive scanner returns supported images', complete.status === 'complete'
      && complete.entries.length === 2
      && complete.entries.every((x) => Number.isFinite(x.modifiedAt)));

    const shallow = await F.scanFolderTree(tree, { maxDepth: 0 });
    ok('depth limit produces a conservative partial result', shallow.status === 'partial'
      && shallow.entries.length === 1
      && shallow.entries[0].path.endsWith('top.jpg'));

    const capped = await F.scanFolderTree(tree, { cap: 1 });
    ok('file cap produces a conservative partial result', capped.status === 'partial'
      && capped.entries.length === 1);

    const unavailable = await F.scanFolderTree(path.join(tree, 'missing'));
    ok('missing root is unavailable, not an empty complete folder', unavailable.status === 'unavailable'
      && unavailable.entries.length === 0);

    const emptyRoot = await F.scanFolderTree('');
    ok('empty root never scans the process working directory', emptyRoot.status === 'unavailable'
      && emptyRoot.entries.length === 0);
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
  }
}

testScanner()
  .then(() => console.log('\nAll ' + passed + ' folder-state tests passed.'))
  .catch((err) => { console.error(err); process.exitCode = 1; });
