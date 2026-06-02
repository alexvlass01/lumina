'use strict';

// `node test/tray.test.js` — tests the (conditional) tray menu logic without Electron.

const assert = require('assert');
const { buildMenuTemplate } = require('../src/tray');

const t = (k) => k; // identity i18n
const A = { onOpen: 'open', onApplyCurrent: 'apply', onNextWallpaper: 'next', onInstallUpdate: 'upd', onQuit: 'quit' };
const labels = (items) => items.filter((i) => i.label).map((i) => i.label);

let passed = 0;
const ok = (n, c) => { assert.ok(c, n); console.log('  ✓ ' + n); passed++; };

let m = buildMenuTemplate({ slideshowEnabled: false, hasSlideshowItems: false, updateState: 'idle' }, t, A);
ok('base menu = open + applyCurrent + quit (no next, no update)',
  JSON.stringify(labels(m)) === JSON.stringify(['tray.open', 'tray.applyCurrent', 'tray.quit']));

m = buildMenuTemplate({ slideshowEnabled: true, hasSlideshowItems: false, updateState: 'idle' }, t, A);
ok('shows "next wallpaper" when slideshow enabled', labels(m).includes('tray.nextWallpaper'));

m = buildMenuTemplate({ slideshowEnabled: false, hasSlideshowItems: true, updateState: 'idle' }, t, A);
ok('shows "next wallpaper" when playlist has 2+ items', labels(m).includes('tray.nextWallpaper'));

m = buildMenuTemplate({ slideshowEnabled: false, hasSlideshowItems: false, updateState: 'ready' }, t, A);
ok('shows "install update" only when update ready', labels(m).includes('tray.installUpdate'));

ok('click handlers are wired through', m[0].click === A.onOpen && m[m.length - 1].click === A.onQuit);

console.log('\nAll ' + passed + ' tray tests passed.');
