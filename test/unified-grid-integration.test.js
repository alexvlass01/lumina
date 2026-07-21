'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Read sources with LF-normalized line endings so multi-line substring checks below stay
// valid on Windows working trees checked out with core.autocrlf=true (CRLF).
const readSrc = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const renderer = readSrc('renderer', 'renderer.js');
const html = readSrc('renderer', 'index.html');
const interaction = readSrc('renderer', 'card-interaction.js');
const preload = readSrc('preload.js');
const main = readSrc('main.js');
let passed = 0;
function ok(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log('  ✓ ' + name);
}

const unifiedPos = html.indexOf('<script src="unified-grid.js"></script>');
const interactionPos = html.indexOf('<script src="card-interaction.js"></script>');
const rendererPos = html.indexOf('<script src="renderer.js"></script>');
ok('the shared controller loads before renderer.js', unifiedPos >= 0 && rendererPos > unifiedPos);
ok('the card interaction model loads before renderer.js',
  interactionPos > unifiedPos && rendererPos > interactionPos);
ok('the rejected legacy grid implementation is gone', !renderer.includes('renderEntriesLazilyLegacy'));
ok('local images use a path-stable key across materialization',
  interaction.includes('return `local-${safeType}:${normalized}`')
  && renderer.includes('window.CardInteraction.localKey(path'));
ok('local folders use a separate path-stable key namespace',
  interaction.includes("type === 'folder' ? 'folder' : 'image'"));
ok('every local descriptor exposes its stable key for selection',
  (renderer.match(/selectionKey: key/g) || []).length === 2);
ok('selection is model-backed instead of restricted to pool ids',
  renderer.includes('selection: window.CardInteraction.createSelectionModel()')
  && renderer.includes("#libGrid .lib-card[data-selection-key]"));
ok('ordinary selection clicks do not build the full virtual ordering unless Shift is held',
  (renderer.match(/e\.shiftKey \? orderedSelectionRecords\(\) : \[\]/g) || []).length === 2);
ok('all local builders use the shared checkbox and context-menu controls',
  (renderer.match(/appendSelectionToggle\(card, selectionRecord\)/g) || []).length === 3
  && (renderer.match(/bindLocalCardContextMenu\(card, selectionRecord\)/g) || []).length === 3);
ok('local kebab controls are gone while Online keeps explicit add buttons',
  !renderer.includes("textContent = '⋯'")
  && (renderer.match(/add\.textContent = '\+'/g) || []).length >= 2);
const massAssignStart = renderer.indexOf('function openMassAssignMenu(');
const massAssignEnd = renderer.indexOf('function closeLibPopup(', massAssignStart);
const massAssign = renderer.slice(massAssignStart, massAssignEnd);
ok('bulk assignment uses the atomic record IPC instead of materialize-then-assign',
  massAssign.includes('await assignLibraryRecords(records, monitorId, th)')
  && !massAssign.includes('ensurePoolItemForRecord(record)'));
ok('bulk assignment is guarded against repeated clicks while IPC is pending',
  renderer.includes('if (librarySelectionBatchPending()) return;')
  && massAssign.includes("pop.setAttribute('aria-busy', 'true')")
  && massAssign.includes('button.disabled = true'));
ok('bulk assignment completion only closes its own popup and removes its own snapshot',
  massAssign.includes("pop.isConnected && $('#libPopup') === pop")
  && massAssign.includes('removeSelectionSnapshot(records)')
  && !massAssign.includes('clearSelection()'));
ok('single and batch atomic assignment channels cross preload and main',
  preload.includes("ipcRenderer.invoke('library-assign-record'")
  && main.includes("ipcMain.handle('library-assign-record'")
  && preload.includes("ipcRenderer.invoke('library-assign-records'")
  && main.includes("ipcMain.handle('library-assign-records'"));
const assignRecordsMainStart = main.indexOf("ipcMain.handle('library-assign-records'");
const assignRecordsMainEnd = main.indexOf("ipcMain.handle('library-materialize'", assignRecordsMainStart);
const assignRecordsMain = main.slice(assignRecordsMainStart, assignRecordsMainEnd);
ok('existing-card batch assignment skips the unlimited live-folder discovery scan',
  assignRecordsMain.includes('const needsDiscovery = records.some')
  && assignRecordsMain.indexOf('if (needsDiscovery)') < assignRecordsMain.indexOf('folderState.listImages(liveFolderState)'));
ok('transient action popups share one lazy materialization promise',
  renderer.includes('window.CardInteraction.createLazyPoolItem(it, materializeFn)'));
ok('transient-only selections cannot invoke library removal',
  renderer.includes('remove.disabled = batchPending || removable !== n')
  && renderer.includes('if (ids.size !== selected.length)')
  && renderer.includes('window.api.libraryRemoveMany(Array.from(ids))'));
ok('bulk removal crosses one batch IPC instead of looping config writes',
  preload.includes("ipcRenderer.invoke('library-remove-many'")
  && main.includes("ipcMain.handle('library-remove-many'"));
const removeManyStart = main.indexOf("ipcMain.handle('library-remove-many'");
const removeManyEnd = main.indexOf("ipcMain.handle('library-toggle-favorite'", removeManyStart);
const removeMany = main.slice(removeManyStart, removeManyEnd);
ok('bulk removal filters each slot once and rejects oversized batches without slicing',
  removeMany.includes('slot.itemIds.filter((id) => !idSet.has(id))')
  && !removeMany.includes('removeFromLibrary(')
  && !removeMany.includes('.slice('));
ok('failed bulk removal keeps selection instead of reporting a partial success',
  renderer.includes('res.removed !== ids.size')
  && renderer.includes("toast(t('library.massDeleteFailed'))"));
ok('bulk removal is guarded against repeated clicks and always releases its busy state',
  (renderer.match(/if \(librarySelectionBatchPending\(\)\) return;/g) || []).length >= 5
  && renderer.includes('libraryBatchRemovePending = true;')
  && renderer.includes('libraryBatchRemovePending = false;')
  && renderer.includes("bar.toggleAttribute('aria-busy', batchPending)")
  && renderer.includes('clear.disabled = batchPending'));
ok('bulk removal completion removes only the original selection snapshot',
  renderer.includes('removeSelectionSnapshot(selected)'));
ok('selection action refresh reuses the pool lookup built for the current grid',
  renderer.includes('const pooledByPath = LIB.poolBySelectionKey;')
  && renderer.includes('poolItemForRecord(record, LIB.poolBySelectionKey)'));
ok('ephemeral Home cards never show a dead remove-from-library command',
  renderer.includes('{ assignmentRecord: record, remove: false }'));
ok('the first Escape closes an open tag suggestion list without bubbling to the popup',
  renderer.includes("e.key === 'Escape' && !suggest.hidden")
  && renderer.includes('e.stopPropagation();\n      suggest.hidden = true;'));
ok('a mixed image/folder materialization falls back to a complete grid refresh',
  renderer.includes("addedItems.some((it) => it.type !== 'image')")
  && renderer.includes('new Set(Object.keys(config.library || {}))'));
const upgradeStart = renderer.indexOf('function tryUpgradeMaterializedCards(');
const upgradeEnd = renderer.indexOf('// Shared monitor×theme grid', upgradeStart);
const upgradeSource = renderer.slice(upgradeStart, upgradeEnd);
ok('multi-card materialization rebuilds the gallery lookup only once after all replacements',
  upgradeSource.includes('syncVirtualCardReplacement(card, replacement, it, true)')
  && (upgradeSource.match(/setGridGallerySource\(/g) || []).length === 1);
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
