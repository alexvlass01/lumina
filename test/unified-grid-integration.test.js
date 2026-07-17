'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
let passed = 0;
function ok(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log('  ✓ ' + name);
}

const unifiedPos = html.indexOf('<script src="unified-grid.js"></script>');
const rendererPos = html.indexOf('<script src="renderer.js"></script>');
ok('the shared controller loads before renderer.js', unifiedPos >= 0 && rendererPos > unifiedPos);
ok('the rejected legacy grid implementation is gone', !renderer.includes('renderEntriesLazilyLegacy'));
ok('local images use a path-stable key across materialization',
  renderer.includes("'local-image'"));
ok('local folders use a separate path-stable key namespace',
  renderer.includes("'local-folder'"));
ok('mixed folder/image views assign gallery indexes independently from grid indexes',
  renderer.includes('galleryIndex: entry && entry.galleryItem ? galleryIndex++ : -1'));
ok('aspect refinement writes by virtual grid index',
  renderer.includes('virtual.setAspect(gridIndex, safe, { relayout: false })'));
ok('All, open folder and pool filters all enter the shared local adapter',
  (renderer.match(/renderEntriesLazily\(/g) || []).length === 4);
ok('the active resize target switches between local and Online grids',
  renderer.includes("return LIB.filter === 'online' ? $('#whGrid') : $('#libGrid');"));

const onlineStart = renderer.indexOf('// ---- External online providers ----');
const onlineEnd = renderer.indexOf('// Page navigation', onlineStart);
const online = renderer.slice(onlineStart, onlineEnd);
ok('Online state is model-backed instead of counted from materialized DOM',
  online.includes('ONLINE.entries.length') && !online.includes('grid.children.length'));
ok('Online rendering never appends cards directly to the grid',
  !online.includes('grid.appendChild(card)') && !online.includes("grid.innerHTML = ''"));
ok('Online reset and pagination are guarded by a generation token',
  online.includes('++ONLINE.generation')
  && online.includes("generation !== ONLINE.generation || ONLINE.view !== 'search'"));
ok('Cloud favorite removal updates the shared model',
  online.includes('removeOnlineEntry(`cloud:${item.id}`)'));
ok('both local and Online adapters call the same mount function',
  renderer.includes('mountUnifiedGrid(grid, descriptors, LOCAL_GRID_ADAPTER')
  && renderer.includes('mountUnifiedGrid(grid, ONLINE.entries, ONLINE_GRID_ADAPTER'));
const mountStart = renderer.indexOf('function mountUnifiedGrid(');
const mountEnd = renderer.indexOf('const LOCAL_GRID_ADAPTER', mountStart);
const mountSource = renderer.slice(mountStart, mountEnd);
ok('an adapter switch restores grid context after destroying the old controller',
  mountSource.indexOf('destroyUnifiedGrid(grid)') < mountSource.indexOf('grid.__gridContext ='));
ok('local folder cards use a refresh epoch while image versions stay structural',
  renderer.includes("entry.kind === 'subfolder' || entry.kind === 'pool-folder'")
  && renderer.includes('return `${entry.kind}:${folderCardEpoch}`')
  && renderer.includes('getVersion: (entry) => localGridVersion(entry)'));
ok('Online providers publish independently while stale hidden-tab results are rejected',
  online.includes('publishOnlineBatch(internetTask, generation)')
  && online.includes('publishOnlineBatch(luminaTask, generation)')
  && online.includes("return LIB.filter === 'online'"));
ok('fresh Online feeds cancel the previous feed resize lifecycle',
  online.includes('if (opts.fresh) resetLibObservers(grid)'));
ok('session expiry replaces an invalid in-flight favorites feed',
  renderer.includes("if (wasFavorites && ONLINE.view !== 'favorites')")
  && renderer.includes('ONLINE.loaded = false;\n        doOnlineSearch(true);'));

console.log('\nAll ' + passed + ' unified-grid integration tests passed.');
