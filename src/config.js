'use strict';

// Config defaults + load / migrate / save. No Electron dependency — the config
// path is passed in — so the (regression-prone) migration logic is unit-testable
// directly (see test/config.test.js). main.js keeps the live `config` object and
// just calls load()/save() through thin wrappers.

const fs = require('fs');
const path = require('path');
const library = require('./library');

const DEFAULT_CONFIG = {
  lightWallpaper: '',     // legacy global fallback (only on COM failure / empty playlist)
  darkWallpaper: '',
  singleWallpaper: false, // одни обои на все мониторы (вместо своей пары на каждый)
  separateThemes: true,   // раздельные обои день/ночь (фишка Lumina). false = один общий слот:
                          // UI прячет ночной слот, applyForTheme всегда берёт 'light', тема ОС
                          // игнорируется. Данные ночного слота при выключении НЕ стираются.
  monitors: {},           // { [deviceId]: { light: Slot, dark: Slot } }; Slot = { items: Item[] } (→ itemIds in Этап B)
  library: {},            // content pool { [id]: Item } — decoupled from placement (see src/library.js, future-todo #16)
  // Legacy compatibility mirror. New code uses wallpaperSchedule.mode; this stays true
  // only for mode='system' so older installed builds do not react to Windows while a
  // newer dev config is using an independent time/sun wallpaper schedule.
  autoSwitch: true,
  wallpaperSchedule: { mode: 'system', lightStart: '07:00', darkStart: '20:00' },
  style: 'fill',          // fill | fit | stretch | center | tile | span
  autostart: false,
  startMinimized: true,   // при автозапуске стартовать сразу в трее (флаг --hidden)
  language: 'system',     // 'system' | 'en' | 'ru' | 'uk'
  firstRunDone: false,
  telemetry: false,       // задел: анонимная статистика (пока ничего не отправляется)
  librarySort: 'added',   // сортировка в «Библиотеке»: 'added' | 'name' | 'size' | 'shuffle'
  // Lumina itself switching the Windows theme on a schedule. mode: 'off'|'time'|'sun'
  themeSchedule: { mode: 'off', lightStart: '07:00', darkStart: '20:00', lat: '', lng: '' },
  themeOverride: null,    // manual override from the Home theme indicator: null (Auto) | 'light' | 'dark'
  _lastAutoTheme: null,   // theme that was active when the override was engaged (drives the Auto→light→dark→Auto cycle)
  // Слайдшоу: кадр меняют выбранные триггеры. order: 'sequential' | 'shuffle'
  slideshow: { enabled: false, intervalEnabled: true, intervalMin: 30, order: 'sequential' },
  slideshowIndex: {},     // { [deviceId]: { light: idx, dark: idx } } — текущий кадр
  hotkeys: { nextWallpaper: { enabled: false, shortcut: '' } },
  gameModeBlock: false,
  triggers: { onStartup: false, onWakeup: false, stealth: false },
  // Online tab content sources (Cloud C2). 'internet' = existing external search,
  // 'lumina' = the Lumina Cloud catalog. Either or both may be on; default keeps the
  // previous behavior (external only) so existing users see no change.
  onlineSources: { lumina: false, internet: true },
};

// Independent deep copy of the defaults — avoids sharing nested objects (monitors,
// slideshowIndex) with DEFAULT_CONFIG, which previously could leak runtime state.
function freshDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

// Bring any config (old or new shape) into the current shape. Idempotent.
function normalize(cfg) {
  if (!cfg.monitors || typeof cfg.monitors !== 'object') cfg.monitors = {};
  cfg.themeSchedule = {
    mode: 'off', lightStart: '07:00', darkStart: '20:00', lat: '', lng: '',
    ...(cfg.themeSchedule && typeof cfg.themeSchedule === 'object' ? cfg.themeSchedule : {}),
  };
  if (!['off', 'time', 'sun'].includes(cfg.themeSchedule.mode)) cfg.themeSchedule.mode = 'off';
  for (const key of ['lightStart', 'darkStart', 'lat', 'lng']) {
    if (typeof cfg.themeSchedule[key] !== 'string') cfg.themeSchedule[key] = key === 'lightStart' ? '07:00' : key === 'darkStart' ? '20:00' : '';
  }

  // Migrate the old autoSwitch boolean without changing existing user behavior:
  // true -> follow Windows, false -> stay on the current slot until changed manually.
  const rawWallpaperSchedule = cfg.wallpaperSchedule && typeof cfg.wallpaperSchedule === 'object'
    ? cfg.wallpaperSchedule
    : null;
  cfg.wallpaperSchedule = {
    mode: cfg.autoSwitch === false ? 'off' : 'system',
    lightStart: '07:00',
    darkStart: '20:00',
    ...(rawWallpaperSchedule || {}),
  };
  if (!['off', 'system', 'time', 'sun'].includes(cfg.wallpaperSchedule.mode)) cfg.wallpaperSchedule.mode = 'system';
  if (typeof cfg.wallpaperSchedule.lightStart !== 'string') cfg.wallpaperSchedule.lightStart = '07:00';
  if (typeof cfg.wallpaperSchedule.darkStart !== 'string') cfg.wallpaperSchedule.darkStart = '20:00';
  cfg.autoSwitch = cfg.wallpaperSchedule.mode === 'system';
  // Content-pool model (see src/library.js, future-todo #16): populate cfg.library and
  // rewrite each monitor slot { string | items[] } → { itemIds[] }. Handles legacy
  // shapes and is idempotent (re-running on a migrated config is a no-op).
  library.migrateConfig(cfg);
  cfg.slideshow = {
    enabled: false, intervalEnabled: true, intervalMin: 30, order: 'sequential',
    ...(cfg.slideshow && typeof cfg.slideshow === 'object' ? cfg.slideshow : {}),
  };
  cfg.slideshow.enabled = !!cfg.slideshow.enabled;
  cfg.slideshow.intervalEnabled = cfg.slideshow.intervalEnabled !== false;
  if (!Number.isFinite(+cfg.slideshow.intervalMin) || +cfg.slideshow.intervalMin < 1) cfg.slideshow.intervalMin = 30;
  cfg.slideshow.intervalMin = Math.floor(+cfg.slideshow.intervalMin);
  if (cfg.slideshow.order !== 'shuffle') cfg.slideshow.order = 'sequential';
  if (!cfg.slideshowIndex || typeof cfg.slideshowIndex !== 'object') cfg.slideshowIndex = {};

  cfg.hotkeys = {
    nextWallpaper: { enabled: false, shortcut: '' },
    ...(cfg.hotkeys && typeof cfg.hotkeys === 'object' ? cfg.hotkeys : {}),
  };
  if (cfg.hotkeys.nextWallpaper && typeof cfg.hotkeys.nextWallpaper === 'object') {
    cfg.hotkeys.nextWallpaper = {
      enabled: !!cfg.hotkeys.nextWallpaper.enabled,
      shortcut: typeof cfg.hotkeys.nextWallpaper.shortcut === 'string' ? cfg.hotkeys.nextWallpaper.shortcut : '',
    };
  } else {
    cfg.hotkeys.nextWallpaper = { enabled: false, shortcut: '' };
  }

  cfg.gameModeBlock = !!cfg.gameModeBlock;
  cfg.separateThemes = cfg.separateThemes !== false; // default ON (упавшее/чужое значение → true)

  // Manual theme override: only 'light' | 'dark' | null are meaningful — anything else
  // (corrupt config, older builds) collapses to null (= Auto) instead of wedging the cycle.
  if (cfg.themeOverride !== 'light' && cfg.themeOverride !== 'dark') cfg.themeOverride = null;
  if (cfg._lastAutoTheme !== 'light' && cfg._lastAutoTheme !== 'dark') cfg._lastAutoTheme = null;
  if (!['added', 'name', 'size', 'shuffle'].includes(cfg.librarySort)) cfg.librarySort = 'added';

  cfg.triggers = {
    onStartup: false, onWakeup: false, stealth: false,
    ...(cfg.triggers && typeof cfg.triggers === 'object' ? cfg.triggers : {}),
  };
  cfg.triggers.onStartup = !!cfg.triggers.onStartup;
  cfg.triggers.onWakeup = !!cfg.triggers.onWakeup;
  cfg.triggers.stealth = !!cfg.triggers.stealth;

  cfg.onlineSources = {
    lumina: false, internet: true,
    ...(cfg.onlineSources && typeof cfg.onlineSources === 'object' ? cfg.onlineSources : {}),
  };
  cfg.onlineSources.lumina = !!cfg.onlineSources.lumina;
  cfg.onlineSources.internet = !!cfg.onlineSources.internet;
  // Never leave the Online tab with no source selected (avoids an empty page).
  if (!cfg.onlineSources.lumina && !cfg.onlineSources.internet) cfg.onlineSources.internet = true;

  return cfg;
}

// Read + parse + migrate + apply defaults. Never throws: a missing file yields
// defaults; a CORRUPT file is backed up (.corrupt-<ts>.bak) then replaced by defaults.
function load(configPath) {
  let raw = null;
  try { raw = fs.readFileSync(configPath, 'utf8'); } catch { raw = null; }
  let cfg;
  if (raw != null) {
    try {
      const parsed = JSON.parse(raw.replace(/^﻿/, '')); // strip BOM if present
      cfg = { ...freshDefaults(), ...parsed };
      // The defaults are merged before normalize(). Preserve whether the new field
      // existed so legacy autoSwitch:false can migrate to mode='off'.
      if (!Object.prototype.hasOwnProperty.call(parsed, 'wallpaperSchedule')) cfg.wallpaperSchedule = null;
    } catch (err) {
      try { fs.copyFileSync(configPath, `${configPath}.corrupt-${Date.now()}.bak`); } catch {}
      console.error('config.json повреждён, откат к дефолтам (бэкап сохранён):', err);
      cfg = freshDefaults();
    }
  } else {
    cfg = freshDefaults();
  }
  return normalize(cfg);
}

// Atomic write (tmp + rename) so a crash mid-write can't truncate config.json.
function save(config, configPath) {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const tmp = `${configPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(tmp, configPath);
  } catch (err) {
    console.error('Не удалось сохранить конфиг:', err);
  }
}

module.exports = { DEFAULT_CONFIG, freshDefaults, normalize, load, save };
