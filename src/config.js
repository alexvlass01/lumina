'use strict';

// Config defaults + load / migrate / save. No Electron dependency — the config
// path is passed in — so the (regression-prone) migration logic is unit-testable
// directly (see test/config.test.js). main.js keeps the live `config` object and
// just calls load()/save() through thin wrappers.

const fs = require('fs');
const path = require('path');
const playlist = require('./playlist');

const DEFAULT_CONFIG = {
  lightWallpaper: '',     // legacy global fallback (only on COM failure / empty playlist)
  darkWallpaper: '',
  singleWallpaper: false, // одни обои на все мониторы (вместо своей пары на каждый)
  monitors: {},           // { [deviceId]: { light: Slot, dark: Slot } }; Slot = { items: Item[] }
  autoSwitch: true,
  style: 'fill',          // fill | fit | stretch | center | tile | span
  autostart: false,
  startMinimized: true,   // при автозапуске стартовать сразу в трее (флаг --hidden)
  language: 'system',     // 'system' | 'en' | 'ru' | 'uk'
  firstRunDone: false,
  telemetry: false,       // задел: анонимная статистика (пока ничего не отправляется)
  // Lumina itself switching the Windows theme on a schedule. mode: 'off'|'time'|'sun'
  themeSchedule: { mode: 'off', lightStart: '07:00', darkStart: '20:00', lat: '', lng: '' },
  // Слайдшоу: плейлист крутится по интервалу. order: 'sequential' | 'shuffle'
  slideshow: { enabled: false, intervalMin: 30, order: 'sequential' },
  slideshowIndex: {},     // { [deviceId]: { light: idx, dark: idx } } — текущий кадр
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
  // migrate each monitor slot from legacy "string path" → playlist { items: [...] }
  for (const id of Object.keys(cfg.monitors)) {
    const m = cfg.monitors[id] || {};
    cfg.monitors[id] = { light: playlist.normalizeSlot(m.light), dark: playlist.normalizeSlot(m.dark) };
  }
  cfg.slideshow = {
    enabled: false, intervalMin: 30, order: 'sequential',
    ...(cfg.slideshow && typeof cfg.slideshow === 'object' ? cfg.slideshow : {}),
  };
  cfg.slideshow.enabled = !!cfg.slideshow.enabled;
  if (!Number.isFinite(+cfg.slideshow.intervalMin) || +cfg.slideshow.intervalMin < 1) cfg.slideshow.intervalMin = 30;
  cfg.slideshow.intervalMin = Math.floor(+cfg.slideshow.intervalMin);
  if (cfg.slideshow.order !== 'shuffle') cfg.slideshow.order = 'sequential';
  if (!cfg.slideshowIndex || typeof cfg.slideshowIndex !== 'object') cfg.slideshowIndex = {};
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
      cfg = { ...freshDefaults(), ...JSON.parse(raw.replace(/^﻿/, '')) }; // strip BOM if present
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
