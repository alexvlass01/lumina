'use strict';

// Plain Node test: `node test/config.test.js`. Covers config load / migration /
// save — the logic that silently lost user settings in the past if it regressed.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../src/config');
const L = require('../src/library');

let passed = 0;
const ok = (n, c) => { assert.ok(c, n); console.log('  ✓ ' + n); passed++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-cfg-'));
const p = (name) => path.join(tmp, name);

// missing file -> defaults
const d = C.load(p('nope.json'));
ok('load missing file -> defaults', d.autoSwitch === true && d.slideshow.intervalMin === 30 && typeof d.monitors === 'object');

// freshDefaults must be independent (no shared nested objects)
const a = C.freshDefaults();
const b = C.freshDefaults();
a.monitors.X = 1; a.slideshowIndex.Y = 2;
ok('freshDefaults are independent copies',
  b.monitors.X === undefined && b.slideshowIndex.Y === undefined && C.DEFAULT_CONFIG.monitors.X === undefined);

// legacy migration: string slot -> { items: [...] }, slideshow sanitized
fs.writeFileSync(p('legacy.json'), JSON.stringify({
  monitors: { M1: { light: 'C:/a.jpg', dark: '' } },
  slideshow: { intervalMin: 0, order: 'weird', enabled: 1 },
}));
const mig = C.load(p('legacy.json'));
ok('legacy string slot migrated to library itemIds',
  mig.monitors.M1.light.itemIds.length === 1
  && L.getItem(mig.library, mig.monitors.M1.light.itemIds[0]).path === 'C:/a.jpg'
  && mig.monitors.M1.dark.itemIds.length === 0);
ok('slideshow values sanitized',
  mig.slideshow.intervalMin === 30 && mig.slideshow.order === 'sequential' && mig.slideshow.enabled === true);

// save + reload round-trip (atomic write)
const cfg = C.freshDefaults();
cfg.style = 'fit';
cfg.monitors.MON = { light: { items: [{ type: 'folder', path: 'C:/pics' }] }, dark: { items: [] } };
C.save(cfg, p('rt.json'));
const back = C.load(p('rt.json'));
ok('save then reload round-trips (slots → library itemIds)',
  back.style === 'fit'
  && L.getItem(back.library, back.monitors.MON.light.itemIds[0]).type === 'folder');

// corrupt file -> defaults + a backup is written
fs.writeFileSync(p('bad.json'), '{ this is not valid json ');
const rec = C.load(p('bad.json'));
const backups = fs.readdirSync(tmp).filter((f) => f.startsWith('bad.json.corrupt-'));
ok('corrupt file -> defaults + backup saved', rec.autoSwitch === true && backups.length === 1);

// Hotkey normalization tests
const fresh = C.freshDefaults();
ok('fresh defaults contain hotkeys config', fresh.hotkeys && fresh.hotkeys.nextWallpaper && fresh.hotkeys.nextWallpaper.enabled === false && fresh.hotkeys.nextWallpaper.shortcut === '');

fs.writeFileSync(p('hotkeys_bad.json'), JSON.stringify({
  hotkeys: {
    nextWallpaper: {
      enabled: 1,
      shortcut: 123
    }
  }
}));
const loadedHotkeys = C.load(p('hotkeys_bad.json'));
ok('hotkeys config is normalized correctly', loadedHotkeys.hotkeys.nextWallpaper.enabled === true && loadedHotkeys.hotkeys.nextWallpaper.shortcut === '');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\nAll ' + passed + ' config tests passed.');
