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
ok('load missing file -> defaults', d.autoSwitch === true && d.wallpaperSchedule.mode === 'system' && d.slideshow.intervalEnabled === true && d.slideshow.intervalMin === 30 && typeof d.monitors === 'object');

// freshDefaults must be independent (no shared nested objects)
const a = C.freshDefaults();
const b = C.freshDefaults();
a.monitors.X = 1; a.slideshowIndex.Y = 2; a.slideshowCurrentPath.Z = { light: 'C:/x.jpg' };
ok('freshDefaults are independent copies',
  b.monitors.X === undefined && b.slideshowIndex.Y === undefined && b.slideshowCurrentPath.Z === undefined
  && C.DEFAULT_CONFIG.monitors.X === undefined);

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
  mig.slideshow.intervalEnabled === true && mig.slideshow.intervalMin === 30
  && mig.slideshow.order === 'sequential' && mig.slideshow.enabled === true);
fs.writeFileSync(p('interval_off.json'), JSON.stringify({ slideshow: { enabled: true, intervalEnabled: false, intervalMin: 15 } }));
const intervalOff = C.load(p('interval_off.json'));
ok('explicitly disabled slideshow interval survives load',
  intervalOff.slideshow.enabled === true && intervalOff.slideshow.intervalEnabled === false && intervalOff.slideshow.intervalMin === 15);
fs.writeFileSync(p('slideshow_paths.json'), JSON.stringify({
  slideshowCurrentPath: { M1: { light: 'C:/light.jpg', dark: 42 }, bad: 'junk' },
}));
const slideshowPaths = C.load(p('slideshow_paths.json'));
ok('slideshow current paths are normalized safely', slideshowPaths.slideshowCurrentPath.M1.light === 'C:/light.jpg'
  && slideshowPaths.slideshowCurrentPath.M1.dark === ''
  && slideshowPaths.slideshowCurrentPath.bad === undefined);

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

// Game Mode configuration tests
ok('fresh defaults contain gameModeBlock config', fresh.gameModeBlock === false);
fs.writeFileSync(p('gamemode_bad.json'), JSON.stringify({
  gameModeBlock: 1
}));
const loadedGameMode = C.load(p('gamemode_bad.json'));
ok('gameModeBlock config is normalized to boolean', loadedGameMode.gameModeBlock === true);

// Trigger configuration tests
ok('fresh defaults contain triggers config', fresh.triggers && fresh.triggers.onStartup === false && fresh.triggers.onWakeup === false && fresh.triggers.stealth === false);
fs.writeFileSync(p('triggers_bad.json'), JSON.stringify({
  triggers: {
    onStartup: 1,
    onWakeup: 'yes',
    stealth: 1
  }
}));
const loadedTriggers = C.load(p('triggers_bad.json'));
ok('triggers config is normalized to booleans', loadedTriggers.triggers.onStartup === true && loadedTriggers.triggers.onWakeup === true && loadedTriggers.triggers.stealth === true);

// triggers missing entirely → defaults
fs.writeFileSync(p('triggers_missing.json'), JSON.stringify({ autoSwitch: true }));
const loadedNoTriggers = C.load(p('triggers_missing.json'));
ok('missing triggers → defaults (all false)', loadedNoTriggers.triggers.onStartup === false && loadedNoTriggers.triggers.onWakeup === false && loadedNoTriggers.triggers.stealth === false);

// themeOverride / librarySort: invalid values collapse to safe defaults, valid pass through
fs.writeFileSync(p('override_bad.json'), JSON.stringify({ themeOverride: 'banana', _lastAutoTheme: 42, librarySort: 'nope' }));
const loadedBadOverride = C.load(p('override_bad.json'));
ok('invalid themeOverride/_lastAutoTheme → null, bad librarySort → added',
  loadedBadOverride.themeOverride === null && loadedBadOverride._lastAutoTheme === null && loadedBadOverride.librarySort === 'added');
fs.writeFileSync(p('override_ok.json'), JSON.stringify({ themeOverride: 'dark', _lastAutoTheme: 'light', librarySort: 'shuffle' }));
const loadedOkOverride = C.load(p('override_ok.json'));
ok('valid themeOverride/_lastAutoTheme/librarySort pass through',
  loadedOkOverride.themeOverride === 'dark' && loadedOkOverride._lastAutoTheme === 'light' && loadedOkOverride.librarySort === 'shuffle');

// separateThemes: defaults ON; only an explicit false turns it off (old configs without
// the field — i.e. every pre-1.2.5 user — must stay in the classic day/night mode)
ok('separateThemes defaults to true', C.freshDefaults().separateThemes === true);
fs.writeFileSync(p('sep_missing.json'), JSON.stringify({ autoSwitch: true }));
ok('missing separateThemes → true (existing users keep day/night)', C.load(p('sep_missing.json')).separateThemes === true);
fs.writeFileSync(p('sep_off.json'), JSON.stringify({ separateThemes: false }));
ok('explicit separateThemes:false survives load', C.load(p('sep_off.json')).separateThemes === false);
fs.writeFileSync(p('sep_junk.json'), JSON.stringify({ separateThemes: 0 }));
ok('junk separateThemes coerces to true (safe default)', C.load(p('sep_junk.json')).separateThemes === true);

// wallpaperSchedule: migrate the legacy autoSwitch flag and keep the mirror compatible
// with old installed builds that may read the same config after a dev run.
fs.writeFileSync(p('wall_legacy_on.json'), JSON.stringify({ autoSwitch: true }));
const wallLegacyOn = C.load(p('wall_legacy_on.json'));
ok('legacy autoSwitch:true -> wallpaper system mode', wallLegacyOn.wallpaperSchedule.mode === 'system' && wallLegacyOn.autoSwitch === true);
fs.writeFileSync(p('wall_legacy_off.json'), JSON.stringify({ autoSwitch: false }));
const wallLegacyOff = C.load(p('wall_legacy_off.json'));
ok('legacy autoSwitch:false -> wallpaper off mode', wallLegacyOff.wallpaperSchedule.mode === 'off' && wallLegacyOff.autoSwitch === false);
fs.writeFileSync(p('wall_time.json'), JSON.stringify({ autoSwitch: true, wallpaperSchedule: { mode: 'time', lightStart: '06:30', darkStart: '22:15' } }));
const wallTime = C.load(p('wall_time.json'));
ok('wallpaper time schedule survives and disables legacy system-follow mirror',
  wallTime.wallpaperSchedule.mode === 'time'
  && wallTime.wallpaperSchedule.lightStart === '06:30'
  && wallTime.wallpaperSchedule.darkStart === '22:15'
  && wallTime.autoSwitch === false);
fs.writeFileSync(p('wall_bad.json'), JSON.stringify({ wallpaperSchedule: { mode: 'banana', lightStart: 7, darkStart: null } }));
const wallBad = C.load(p('wall_bad.json'));
ok('invalid wallpaper schedule falls back safely',
  wallBad.wallpaperSchedule.mode === 'system'
  && wallBad.wallpaperSchedule.lightStart === '07:00'
  && wallBad.wallpaperSchedule.darkStart === '20:00');

// onlineSources (Cloud C2): default external-only; booleanized; never both-off
ok('fresh defaults: onlineSources internet on, lumina off',
  fresh.onlineSources && fresh.onlineSources.internet === true && fresh.onlineSources.lumina === false);
fs.writeFileSync(p('sources_missing.json'), JSON.stringify({ autoSwitch: true }));
ok('missing onlineSources → external only', (() => {
  const s = C.load(p('sources_missing.json')).onlineSources;
  return s.internet === true && s.lumina === false;
})());
fs.writeFileSync(p('sources_both.json'), JSON.stringify({ onlineSources: { lumina: 1, internet: 'yes' } }));
ok('onlineSources coerced to booleans', (() => {
  const s = C.load(p('sources_both.json')).onlineSources;
  return s.lumina === true && s.internet === true;
})());
fs.writeFileSync(p('sources_none.json'), JSON.stringify({ onlineSources: { lumina: false, internet: false } }));
ok('both sources off → internet forced on (no empty Online page)', (() => {
  const s = C.load(p('sources_none.json')).onlineSources;
  return s.internet === true && s.lumina === false;
})());
fs.writeFileSync(p('sources_lumina.json'), JSON.stringify({ onlineSources: { lumina: true, internet: false } }));
ok('lumina-only selection survives', (() => {
  const s = C.load(p('sources_lumina.json')).onlineSources;
  return s.lumina === true && s.internet === false;
})());

// onlineSort / onlinePurity (persisted Online search params)
ok('fresh defaults: onlineSort date_added, purity sfw+sketchy',
  fresh.onlineSort === 'date_added' && fresh.onlinePurity.sfw === true && fresh.onlinePurity.sketchy === true && fresh.onlinePurity.nsfw === false);
fs.writeFileSync(p('online_params.json'), JSON.stringify({ onlineSort: 'toplist', onlinePurity: { sfw: false, sketchy: 0, nsfw: 'yes' } }));
ok('valid onlineSort survives; purity coerced to booleans', (() => {
  const c = C.load(p('online_params.json'));
  return c.onlineSort === 'toplist' && c.onlinePurity.sfw === false && c.onlinePurity.sketchy === false && c.onlinePurity.nsfw === true;
})());
fs.writeFileSync(p('online_bad.json'), JSON.stringify({ onlineSort: 'banana', onlinePurity: { sfw: false, sketchy: false, nsfw: false } }));
ok('bad onlineSort → date_added; all-off purity → sfw forced on', (() => {
  const c = C.load(p('online_bad.json'));
  return c.onlineSort === 'date_added' && c.onlinePurity.sfw === true;
})());

// viewerBackground: fresh default is ambient; valid values pass; bad → ambient
ok('fresh default: viewerBackground ambient', fresh.viewerBackground === 'ambient');
fs.writeFileSync(p('viewerbg_ok.json'), JSON.stringify({ viewerBackground: 'aurora' }));
ok('valid viewerBackground passes through', C.load(p('viewerbg_ok.json')).viewerBackground === 'aurora');
fs.writeFileSync(p('viewerbg_bad.json'), JSON.stringify({ viewerBackground: 'banana' }));
ok('bad viewerBackground → ambient', C.load(p('viewerbg_bad.json')).viewerBackground === 'ambient');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\nAll ' + passed + ' config tests passed.');
