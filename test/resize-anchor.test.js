'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ResizeAnchor = require('../renderer/resize-anchor');

let passed = 0;
const ok = (name, condition) => { assert.ok(condition, name); console.log('  ✓ ' + name); passed++; };

const session = ResizeAnchor.createSession();
const first = { key: 'path:first.jpg', combinedIndex: 137, top: -24 };
const shifted = { key: 'path:shifted.jpg', combinedIndex: 143, top: -24 };

const start = session.begin(first);
ok('first resize event starts a session with its logical anchor', start.anchor === first);

const observer = session.begin(shifted);
ok('later resize and observer events retain the first anchor', observer.anchor === first);
ok('later events advance the revision', observer.revision > start.revision);
ok('a stale settle callback cannot finish a newer resize revision', session.finish(start.revision) === null);

const touched = session.touch();
ok('observer relayout touches keep the same anchor', touched.anchor === first);
ok('observer relayout invalidates an older settle callback', session.finish(observer.revision) === null);

ok('the latest settle callback finishes the original anchor', session.finish(touched.revision) === first);
ok('a finished session becomes inactive', session.current() === null);

// The renderer keeps the finished logical anchor as its view anchor. A wider row
// can prepend another card (`shifted`), but the following restore burst must start
// from the original card until a real user scroll replaces it.
const preservedViewAnchor = first;
const restarted = session.begin(preservedViewAnchor || shifted);
ok('a later restore/maximize burst reuses the preserved logical anchor', restarted.anchor === first);
ok('explicit user interaction cancels the active anchor', session.cancel() === first && session.current() === null);
ok('cancelled sessions reject delayed settle callbacks', session.finish(restarted.revision) === null);

const afterScroll = session.begin(shifted);
ok('a later user scroll can establish a genuinely new anchor', afterScroll.anchor === shifted);
session.cancel();

const rendererHtml = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const modulePos = rendererHtml.indexOf('<script src="resize-anchor.js"></script>');
const rendererPos = rendererHtml.indexOf('<script src="renderer.js"></script>');
ok('resize-anchor runtime loads before renderer.js', modulePos >= 0 && rendererPos > modulePos);

const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const rendererJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
ok('main reports the native manual width-resize lifetime',
  mainJs.includes("mainWindow.on('will-resize'")
  && mainJs.includes("mainWindow.on('resized'")
  && mainJs.includes("send('window-resize-phase', phase)"));
ok('preload exposes only the resize phase value to the isolated renderer',
  preloadJs.includes("onWindowResizePhase: (cb) => ipcRenderer.on('window-resize-phase'"));
ok('renderer fixes row membership only for a native drag and canonicalizes on finish',
  rendererJs.includes('if (libraryManualWidthResizeActive)')
  && rendererJs.includes('layoutRowsWithTopology(')
  && rendererJs.includes('virtual.resizeRows = null'));
const geometryPos = rendererJs.indexOf('grid.__virtual.relayout({ deferWindow: true });');
const restorePos = rendererJs.indexOf('restoreLibraryScrollAnchor(scrollAnchor, grid, { refreshVirtual: false });');
const materializePos = rendererJs.indexOf('grid.__virtual.updateWindow(true);', restorePos);
ok('virtual relayout restores the logical anchor before its single DOM materialization pass',
  geometryPos >= 0 && restorePos > geometryPos && materializePos > restorePos);
ok('hide/show and reset-time release retain a pending canonical escape path',
  rendererJs.includes('resizeNeedsCanonical')
  && rendererJs.includes('visibleGrid.__virtual.resizeNeedsCanonical')
  && rendererJs.includes('!libraryResizeActive && !currentLibraryResizeAnchor() && !needsCanonical'));
const phaseHandlerPos = rendererJs.indexOf('window.api.onWindowResizePhase');
const phaseCapturePos = rendererJs.indexOf('captureRowTopology(virtual.rows, total)', phaseHandlerPos);
const phaseBeginPos = rendererJs.indexOf('beginLibraryResizeAnchor(grid)', phaseHandlerPos);
ok('native start captures current row membership before beginning the resize session',
  phaseHandlerPos >= 0 && phaseCapturePos > phaseHandlerPos && phaseBeginPos > phaseCapturePos);

console.log('\nAll ' + passed + ' resize-anchor tests passed.');
