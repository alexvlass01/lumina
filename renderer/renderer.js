'use strict';

// Fallback mock so the UI can be previewed in a plain browser (outside Electron).
// In the real app window.api is always provided by preload.js, so this is skipped.
if (!window.api) {
  let mock = { lightWallpaper: '', darkWallpaper: '', singleWallpaper: false, monitors: {}, library: {}, autoSwitch: true, style: 'fill', autostart: false, startMinimized: true, language: 'system', themeSchedule: { mode: 'off', lightStart: '07:00', darkStart: '20:00', lat: '', lng: '' }, slideshow: { enabled: false, intervalMin: 30, order: 'sequential' }, slideshowIndex: {} };
  const mockAdd = (type, p) => { const iid = 'm' + p; mock.library[iid] = { id: iid, type, path: p }; return iid; };
  let mockSc = { desktop: false, startmenu: false };
  window.api = {
    getConfig: async () => mock,
    setConfig: async (p) => (mock = { ...mock, ...p }),
    getVersion: async () => '1.0.0',
    getI18n: async () => {
      const load = async (code) => { try { return await (await fetch('../locales/' + code + '.json')).json(); } catch { return {}; } };
      const sys = 'ru';
      const set = mock.language || 'system';
      const code = set === 'system' ? sys : set;
      return { setting: set, system: sys, locale: code, dict: await load(code), fallback: await load('en') };
    },
    getMonitors: async () => [
      { id: 'MON-1', x: 0, y: 0, w: 1920, h: 1080, primary: true },
      { id: 'MON-2', x: 1920, y: -440, w: 1200, h: 1920, primary: false },
    ],
    getTheme: async () => 'light',
    addSlotImages: async (id, which) => {
      const theme = which === 'dark' ? 'dark' : 'light';
      if (!mock.monitors[id]) mock.monitors[id] = { light: { itemIds: [] }, dark: { itemIds: [] } };
      const slot = mock.monitors[id][theme];
      const iid = mockAdd('image', `C:/fake/photo${Object.keys(mock.library).length + 1}.jpg`);
      if (!slot.itemIds.includes(iid)) slot.itemIds.push(iid);
      return { config: mock, added: 1 };
    },
    addSlotFolder: async (id, which) => {
      const theme = which === 'dark' ? 'dark' : 'light';
      if (!mock.monitors[id]) mock.monitors[id] = { light: { itemIds: [] }, dark: { itemIds: [] } };
      const slot = mock.monitors[id][theme];
      const iid = mockAdd('folder', 'C:/fake/Pictures');
      if (!slot.itemIds.includes(iid)) slot.itemIds.push(iid);
      return { config: mock, added: 1 };
    },
    removeSlotItem: async (id, which, index) => {
      const theme = which === 'dark' ? 'dark' : 'light';
      const slot = mock.monitors[id] && mock.monitors[id][theme];
      if (slot && slot.itemIds) slot.itemIds.splice(index, 1);
      return mock;
    },
    clearSlot: async (id, which) => {
      const theme = which === 'dark' ? 'dark' : 'light';
      if (mock.monitors[id] && mock.monitors[id][theme]) mock.monitors[id][theme].itemIds = [];
      return mock;
    },
    currentImage: async (id, which) => {
      const theme = which === 'dark' ? 'dark' : 'light';
      const realId = mock.singleWallpaper ? 'MON-1' : id;
      const slot = mock.monitors[realId] && mock.monitors[realId][theme];
      const ids = slot && slot.itemIds ? slot.itemIds : [];
      const it = ids.map((x) => mock.library[x]).filter(Boolean)[0];
      if (!it) return '';
      return it.type === 'folder' ? '' : it.path; // mock can't scan folders
    },
    libraryAddImages: async () => { mockAdd('image', `C:/fake/lib${Object.keys(mock.library).length + 1}.jpg`); return { config: mock, added: 1 }; },
    libraryAddFolder: async () => { mockAdd('folder', 'C:/fake/LibFolder'); return { config: mock, added: 1 }; },
    libraryAddPaths: async (paths) => { (paths || []).forEach((p) => mockAdd('image', p)); return { config: mock, added: (paths || []).length }; },
    libraryRemove: async (id) => {
      delete mock.library[id];
      for (const m of Object.values(mock.monitors)) for (const th of ['light', 'dark']) if (m[th] && m[th].itemIds) m[th].itemIds = m[th].itemIds.filter((x) => x !== id);
      return mock;
    },
    libraryToggleFavorite: async (id) => { if (mock.library[id]) mock.library[id].favorite = !mock.library[id].favorite; return mock; },
    libraryAddTag: async (id, tag) => { const it = mock.library[id]; const t = String(tag || '').trim().toLowerCase(); if (it && t) { it.tags = it.tags || []; if (!it.tags.includes(t)) it.tags.push(t); } return mock; },
    libraryRemoveTag: async (id, tag) => { const it = mock.library[id]; const t = String(tag || '').trim().toLowerCase(); if (it && it.tags) it.tags = it.tags.filter((x) => x !== t); return mock; },
    libraryAssign: async (id, monitorId, which) => {
      const theme = which === 'dark' ? 'dark' : 'light';
      const mid = monitorId || 'MON-1';
      if (!mock.monitors[mid]) mock.monitors[mid] = { light: { itemIds: [] }, dark: { itemIds: [] } };
      const slot = mock.monitors[mid][theme];
      if (!slot.itemIds.includes(id)) slot.itemIds.push(id);
      return mock;
    },
    folderInfo: async () => ({ count: 0, subfolders: 0, previews: [] }),
    folderEntries: async () => ({ folders: [], images: [], count: 0 }),
    expandFolders: async () => ({ images: [] }),
    libraryEnsureSizes: async () => mock,
    libraryMaterialize: async (p, type) => ({ config: mock, id: mockAdd(type === 'folder' ? 'folder' : 'image', p) }),
    wallhavenStatus: async () => ({ hasKey: false, bundled: false }),
    wallhavenSearch: async () => ({ items: [], meta: { currentPage: 1, lastPage: 1 }, error: null, hasKey: false }),
    wallhavenAdd: async () => ({ config: mock, error: null }),
    setSlideshow: async (patch) => { mock.slideshow = { ...mock.slideshow, ...patch }; return mock; },
    setSlideshowIndex: async (monitorId, which, index) => {
      const theme = which === 'dark' ? 'dark' : 'light';
      if (!mock.slideshowIndex[monitorId]) mock.slideshowIndex[monitorId] = { light: 0, dark: 0 };
      mock.slideshowIndex[monitorId][theme] = index;
      return mock;
    },
    setSlideshowToPath: async () => mock,
    applyNow: async () => ({ ok: false, reason: 'no-wallpaper' }),
    nextWallpaper: async () => mock,
    setAutostart: async (v) => (mock.autostart = v),
    setStartMinimized: async (v) => (mock.startMinimized = v),
    fileUrl: async (p) => p,
    thumb: async (p) => p,
    quitApp: () => {},
    createShortcuts: async (which) => {
      if (which === 'desktop' || which === 'both' || !which) mockSc.desktop = true;
      if (which === 'startmenu' || which === 'both' || !which) mockSc.startmenu = true;
      return ['ok'];
    },
    shortcutsStatus: async () => ({ ...mockSc }),
    checkForUpdates: async () => ({ started: false, supported: false }),
    installUpdate: () => {},
    openReleases: () => {},
    getUpdateState: async () => ({ state: 'idle', supported: false }),
    onTheme: () => {},
    onConfig: () => {},
    onMonitors: () => {},
    onUpdate: () => {},
  };
}

const $ = (sel) => document.querySelector(sel);

let config = null;
let currentTheme = 'light';

// ---------------------------------------------------------------------------
// i18n — dictionaries come from the main process (single source of truth).
// t(key, params) looks up the active locale, falls back to English, then key.
// ---------------------------------------------------------------------------
const I18N = { dict: {}, fallback: {} };

function tPath(obj, key) {
  return key.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj);
}
function t(key, params) {
  let v = tPath(I18N.dict, key);
  if (v == null) v = tPath(I18N.fallback, key);
  if (v == null) v = key;
  if (params) for (const k in params) v = v.split('{' + k + '}').join(params[k]);
  return v;
}
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const txt = t(el.dataset.i18nTitle);
    if (el.tagName === 'OPTGROUP') el.label = txt;
    else el.title = txt;
  });
  document.querySelectorAll('[data-i18n-tooltip]').forEach((el) => {
    el.setAttribute('data-tooltip', t(el.dataset.i18nTooltip));
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
}
async function loadI18n() {
  const info = await window.api.getI18n();
  I18N.dict = info.dict || {};
  I18N.fallback = info.fallback || {};
  const sel = $('#selLang');
  if (sel) sel.value = info.setting || 'system';
  if (info.locale) document.documentElement.lang = info.locale;
}
// Re-apply every string after a language change.
function refreshTexts() {
  const sl = $('#stripLight'); if (sl) sl.removeAttribute('data-items');
  const sd = $('#stripDark'); if (sd) sd.removeAttribute('data-items');

  // Clear preview/thumbnail path cache so they re-render with new translations
  ['#previewLight', '#previewDark'].forEach((id) => {
    const el = $(id);
    if (el) el.removeAttribute('data-bg-path');
  });
  document.querySelectorAll('.home-thumb').forEach((el) => {
    el.removeAttribute('data-bg-path');
  });

  applyI18n();
  applyThemeToUI(currentTheme); // hero subtitle
  buildMonitorMap();            // chip titles + label
  updateSingleWallRow();        // toggle row visibility + state
  renderPreviews();             // "not selected" placeholders
  renderHome();                 // status values + thumbnail labels
  updateShortcutButtons();      // re-translate shortcut buttons + keep "done" state
  renderUpdate();               // re-translate update status + button
  renderSmartPanel();           // re-translate smart panel texts
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ---------------------------------------------------------------------------
// Monitors (from IDesktopWallpaper). Each: { id, x, y, w, h, primary }.
// The selected monitor is the one being configured + previewed.
// ---------------------------------------------------------------------------
let monitorList = [];
let selectedMonitorId = null;
let monitorAspect = 16 / 9;

function selectedMonitor() {
  return monitorList.find((m) => m.id === selectedMonitorId) || null;
}

function applySelectedAspect() {
  const m = selectedMonitor();
  monitorAspect = m && m.h ? m.w / m.h : 16 / 9;
  layoutMonitors();
}

function setMonitors(list) {
  monitorList = Array.isArray(list) && list.length ? list : [];
  if (!monitorList.find((m) => m.id === selectedMonitorId)) {
    const primary = monitorList.find((m) => m.primary) || monitorList[0];
    selectedMonitorId = primary ? primary.id : null;
  }
  applySelectedAspect();
  buildMonitorMap();
  updateSingleWallRow();
  renderPreviews();
  renderHome();
}

function fmtResolution(m) {
  let s = `${m.w}×${m.h}`;
  if (m.w < m.h) s += ' · ' + t('monitor.vertical');
  return s;
}

function updateMonLabel() {
  const el = $('#monLabel');
  if (!el) return;
  const m = selectedMonitor();
  if (!m) { el.textContent = ''; return; }
  const idx = monitorList.findIndex((x) => x.id === m.id) + 1;
  el.textContent = t('monitor.label', { n: idx }) + ` · ${fmtResolution(m)}` + (m.primary ? ` (${t('monitor.primary')})` : '');
}

function selectMonitor(m) {
  selectedMonitorId = m.id;
  applySelectedAspect();
  document.querySelectorAll('.monchip').forEach((c) => {
    c.classList.toggle('sel', c.dataset.id === selectedMonitorId);
  });
  updateMonLabel();
  renderPreviews();
}

// Build the monitor map (shown only when there is more than one monitor).
function buildMonitorMap() {
  const bar = $('#monitorBar');
  const map = $('#monMap');
  if (!bar || !map) return;
  // hidden for a single monitor, and when one wallpaper is shared across all
  if (monitorList.length < 2 || (config && config.singleWallpaper)) { bar.hidden = true; map.innerHTML = ''; updateMonLabel(); return; }
  bar.hidden = false;

  const MAX_H = 92, MAX_W = 156;
  const maxH = Math.max(...monitorList.map((m) => m.h));
  const maxW = Math.max(...monitorList.map((m) => m.w));
  const scale = Math.min(MAX_H / maxH, MAX_W / maxW);

  map.innerHTML = '';
  monitorList.forEach((m, i) => {
    const chip = document.createElement('button');
    chip.className = 'monchip' + (m.id === selectedMonitorId ? ' sel' : '');
    chip.dataset.id = m.id;
    chip.style.width = Math.max(22, Math.round(m.w * scale)) + 'px';
    chip.style.height = Math.max(22, Math.round(m.h * scale)) + 'px';
    chip.title = t('monitor.label', { n: i + 1 }) + `: ${fmtResolution(m)}` + (m.primary ? ` (${t('monitor.primary')})` : '');
    chip.innerHTML = `<span class="mnum">${i + 1}</span>`;
    chip.addEventListener('click', () => selectMonitor(m));
    map.appendChild(chip);
  });
  updateMonLabel();
}

// The "one wallpaper for all monitors" toggle is only meaningful with 2+ monitors.
function updateSingleWallRow() {
  const row = $('#rowSingleWall');
  if (!row) return;
  row.hidden = monitorList.length < 2;
  setSwitch($('#swSingle'), !!(config && config.singleWallpaper));
}

// ---------------------------------------------------------------------------
// Preview rendering
// ---------------------------------------------------------------------------
// How each wallpaper "style" maps to a CSS preview.
const STYLE_CSS = {
  fill:    { size: 'cover',     repeat: 'no-repeat', position: 'center' },
  fit:     { size: 'contain',   repeat: 'no-repeat', position: 'center' },
  stretch: { size: '100% 100%', repeat: 'no-repeat', position: 'center' },
  center:  { size: 'auto',      repeat: 'no-repeat', position: 'center' },
  tile:    { size: 'auto',      repeat: 'repeat',    position: 'top left' },
  span:    { size: 'cover',     repeat: 'no-repeat', position: 'center' },
};

function applyPreviewStyle() {
  const css = STYLE_CSS[config.style] || STYLE_CSS.fill;
  ['#previewLight', '#previewDark'].forEach((sel) => {
    const el = $(sel);
    el.style.backgroundSize = css.size;
    el.style.backgroundRepeat = css.repeat;
    el.style.backgroundPosition = css.position;
  });
}

// Size each monitor thumbnail to fit ("contain") inside its fixed-size stage.
const STAGE_PADDING = 20; // 10px padding each side (see .stage)
function layoutMonitors() {
  document.querySelectorAll('.stage').forEach((stage) => {
    const W = stage.clientWidth - STAGE_PADDING;
    const H = stage.clientHeight - STAGE_PADDING;
    if (W <= 0 || H <= 0) return;
    let tw = W;
    let th = W / monitorAspect;
    if (th > H) { th = H; tw = H * monitorAspect; }
    const mon = stage.querySelector('.monitor');
    if (mon) {
      mon.style.width = Math.round(tw) + 'px';
      mon.style.height = Math.round(th) + 'px';
    }
  });
}

// id основного монитора (для режима «одни обои на все мониторы»)
function primaryMonitorId() {
  const p = monitorList.find((m) => m.primary) || monitorList[0];
  return p ? p.id : null;
}

// монитор, для которого редактируем плейлист (single-режим → основной)
function editTargetId() {
  return config.singleWallpaper ? primaryMonitorId() : selectedMonitorId;
}

function baseName(p) { return String(p).split(/[\\/]/).filter(Boolean).pop() || String(p); }

// элементы плейлиста выбранного (или основного) монитора для темы.
// Слот хранит ССЫЛКИ (itemIds) в пул config.library — резолвим в объекты {id,type,path}.
function slotItems(theme) {
  const m = config.monitors && config.monitors[editTargetId()];
  const slot = m && m[theme];
  const ids = slot && Array.isArray(slot.itemIds) ? slot.itemIds : [];
  const lib = config.library || {};
  return ids.map((id) => lib[id]).filter(Boolean);
}

async function setPreview(which, filePath) {
  const el = which === 'dark' ? $('#previewDark') : $('#previewLight');

  // If the path is already set, do not reload or rebuild to prevent flickering
  if (el.dataset.bgPath === filePath) {
    return;
  }
  el.dataset.bgPath = filePath;

  // Increment load ID to cancel any pending stale loads
  const loadId = (el.dataset.loadId ? parseInt(el.dataset.loadId, 10) : 0) + 1;
  el.dataset.loadId = loadId;

  // Get current state
  const oldBg = el.style.backgroundImage;

  let newBg = '';
  let newHtml = '';
  
  if (filePath) {
    el.classList.remove('empty');
    const url = await window.api.fileUrl(filePath);
    const newBgUrl = `${url}?v=${Date.now()}`;
    newBg = `url("${newBgUrl}")`;
    
    // Preload image
    await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve(); // continue even if loading fails
      img.src = newBgUrl;
    });
  } else {
    el.classList.add('empty');
    newHtml = `<span class="preview-empty">${t('design.notSelected')}</span>`;
  }

  // If another load has started in the meantime, discard this stale update
  if (parseInt(el.dataset.loadId, 10) !== loadId) {
    return;
  }

  // Apply instantly and flicker-free (browser has the image cached now)
  if (oldBg && oldBg !== 'none' && oldBg !== newBg) {
    el.style.backgroundImage = `${newBg}, ${oldBg}`;
    setTimeout(() => {
      if (parseInt(el.dataset.loadId, 10) === loadId) {
        el.style.backgroundImage = newBg;
      }
    }, 150);
  } else {
    el.style.backgroundImage = newBg;
  }
  el.innerHTML = newHtml;
  applyPreviewStyle();
}

// big preview = resolved current image (main scans folders); strip = playlist items
function renderSlot(which) {
  const theme = which === 'dark' ? 'dark' : 'light';
  renderStrip(theme);
  window.api.currentImage(selectedMonitorId, theme).then((cur) => setPreview(theme, cur));
}

function renderStrip(theme) {
  const strip = theme === 'dark' ? $('#stripDark') : $('#stripLight');
  if (!strip) return;
  const items = slotItems(theme);
  
  // Skip rebuilding if the items are identical to prevent flickering/re-rendering
  const itemsJson = JSON.stringify(items);
  if (strip.dataset.items === itemsJson) {
    return;
  }
  strip.dataset.items = itemsJson;
  
  strip.innerHTML = '';
  items.forEach((it, idx) => {
    const el = document.createElement('div');
    el.className = 'thumb' + (it.type === 'folder' ? ' folder' : '');
    if (it.type === 'folder') {
      el.innerHTML = '<span class="thumb-ic">📁</span>';
      el.title = it.path;
    } else {
      el.title = baseName(it.path);
      // small thumbnail (data-URL is instant, no flicker; avoids decoding full-size files)
      window.api.thumb(it.path, 200, 130).then((u) => { if (u) el.style.backgroundImage = `url("${u}")`; });

      // Click on thumbnail → switch wallpaper to this item
      if (items.length > 1) {
        el.classList.add('clickable');
        el.addEventListener('click', async (ev) => {
          if (ev.target.closest('.thumb-remove')) return; // don't trigger on delete button
          const mon = editTargetId();
          if (!mon) return;
          // apply by PATH (folders expand, so the strip index != the slideshow index)
          config = await window.api.setSlideshowToPath(mon, theme, it.path);
          // Clear preview cache so setPreview reloads with the new image
          const preview = theme === 'dark' ? $('#previewDark') : $('#previewLight');
          if (preview) preview.removeAttribute('data-bg-path');
          renderSlot(theme);
          renderHome();
          toast(t('toast.applied'));
        });
      }
    }
    const rm = document.createElement('button');
    rm.className = 'thumb-remove';
    rm.textContent = '×';
    rm.title = t('design.removeItem');
    rm.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      config = await window.api.removeSlotItem(editTargetId(), theme, idx);
      renderSlot(theme);
      renderHome();
      if (theme === currentTheme) window.api.applyNow();
    });
    el.appendChild(rm);
    strip.appendChild(el);
  });
}

function renderPreviews() {
  if (!config) return;
  renderSlot('light');
  renderSlot('dark');
}

function applyThemeToUI(theme) {
  currentTheme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');

  const isDark = theme === 'dark';
  $('#heroIcon').textContent = isDark ? '🌙' : '☀️';
  $('#heroSub').textContent = isDark ? t('home.themeDark') : t('home.themeLight');
  
  if (config) {
    const mode = config.themeOverride;
    const ind = $('#themeIndicator');
    ind.style.cursor = 'pointer';
    if (mode === 'light') {
      ind.title = 'Принудительно Светлая (клик для переключения)';
      $('#heroIcon').textContent = '☀️ 📌';
    } else if (mode === 'dark') {
      ind.title = 'Принудительно Тёмная (клик для переключения)';
      $('#heroIcon').textContent = '🌙 📌';
    } else {
      ind.title = 'Режим: Авто (клик для переключения)';
    }
  }

  document.querySelectorAll('.wallcard').forEach((c) => {
    c.style.outline = c.dataset.theme === theme ? '2px solid var(--accent)' : 'none';
    c.style.outlineOffset = '1px';
  });
}

function setSwitch(el, on) {
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

function renderThemeSchedule() {
  const sch = (config && config.themeSchedule) || { mode: 'off', lightStart: '07:00', darkStart: '20:00', lat: '', lng: '' };
  const sel = $('#selThemeMode');
  if (sel) sel.value = sch.mode || 'off';
  if ($('#lightStart')) $('#lightStart').value = sch.lightStart || '07:00';
  if ($('#darkStart')) $('#darkStart').value = sch.darkStart || '20:00';
  if ($('#latInput')) $('#latInput').value = sch.lat || '';
  if ($('#lngInput')) $('#lngInput').value = sch.lng || '';
  if ($('#themeTimes')) $('#themeTimes').hidden = (sch.mode !== 'time');
  if ($('#themeSun')) $('#themeSun').hidden = (sch.mode !== 'sun');
}

function updateSlideshowControls() {
  const ss = (config && config.slideshow) || { enabled: false, intervalMin: 30, order: 'sequential' };
  setSwitch($('#swSlideshow'), !!ss.enabled);
  if ($('#slideInterval')) $('#slideInterval').value = ss.intervalMin || 30;
  if ($('#selSlideOrder')) $('#selSlideOrder').value = ss.order || 'sequential';
}

async function renderConfig() {
  renderPreviews();
  applyPreviewStyle();
  setSwitch($('#swAuto'), config.autoSwitch);
  setSwitch($('#swStartup'), config.autostart);
  setSwitch($('#swStartMin'), config.startMinimized !== false);
  setSwitch($('#swSingle'), !!config.singleWallpaper);
  setSwitch($('#swTelemetry'), !!config.telemetry);
  setSwitch($('#swGameMode'), !!config.gameModeBlock);
  $('#selStyle').value = config.style || 'fill';
  updateSingleWallRow();
  updateSlideshowControls();
  renderThemeSchedule();

  // Triggers (on startup, on wake)
  const trig = (config.triggers) || {};
  setSwitch($('#swTriggerStartup'), !!trig.onStartup);
  setSwitch($('#swTriggerWakeup'), !!trig.onWakeup);
  setSwitch($('#swTriggerStealth'), !!trig.stealth);
  $('#rowTriggerStealth').style.display = trig.onStartup ? 'flex' : 'none';

  // Hotkeys
  const hk = config.hotkeys && config.hotkeys.nextWallpaper;
  const isEnabled = hk ? !!hk.enabled : false;
  const shortcutText = (hk && hk.shortcut) ? hk.shortcut : '';
  setSwitch($('#swShortcutEnabled'), isEnabled);
  const recBtn = $('#btnRecordShortcut');
  if (recBtn) {
    if (shortcutText) {
      recBtn.textContent = shortcutText;
      recBtn.classList.add('assigned');
    } else {
      recBtn.textContent = t('shortcuts.pressKeys');
      recBtn.classList.remove('assigned');
    }
  }
  const clearBtn = $('#btnClearShortcut');
  if (clearBtn) {
    clearBtn.hidden = !shortcutText;
  }
}

// ---------------------------------------------------------------------------
// Library (content pool) — browse/organize all wallpapers, assign from a card.
// ---------------------------------------------------------------------------
const LIB = { filter: 'all', sort: 'added', q: '', folderPath: null, crumbs: [], shuffleRank: {}, selection: new Set(), lastSelected: null };
let libObserver = null; // IntersectionObserver for lazy "All" rendering
let allViewToken = 0;   // guards async folder/All renders against races
let thumbIO = null;     // IntersectionObserver that loads thumbnails on scroll
const WH = { q: '', sort: 'date_added', purity: { sfw: true, sketchy: true, nsfw: false }, page: 1, lastPage: 1, hasKey: false, searched: false, statusFetched: false };

// ids referenced by any monitor×theme slot (to mark assigned items)
function assignedIds() {
  const set = new Set();
  for (const m of Object.values(config.monitors || {})) {
    for (const th of ['light', 'dark']) {
      const s = m[th];
      if (s && Array.isArray(s.itemIds)) s.itemIds.forEach((id) => set.add(id));
    }
  }
  return set;
}

function libAllTags() {
  const set = new Set();
  Object.values(config.library || {}).forEach((it) => (it.tags || []).forEach((tg) => set.add(tg)));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// Сортировка массива на месте по LIB.sort (added/name/size/shuffle). `get` — аксессоры,
// чтобы одна логика работала и для элементов пула, и для записей плоского «Все» ({path,item,id}).
function sortItems(arr, get) {
  const g = get || { path: (x) => x.path, added: (x) => x.addedAt || 0, size: (x) => x.size || 0, id: (x) => x.id };
  if (LIB.sort === 'name') arr.sort((a, b) => baseName(g.path(a)).localeCompare(baseName(g.path(b))));
  else if (LIB.sort === 'size') arr.sort((a, b) => g.size(b) - g.size(a));
  else if (LIB.sort === 'shuffle') {
    arr.forEach((x) => { const id = g.id(x); if (LIB.shuffleRank[id] === undefined) LIB.shuffleRank[id] = Math.random(); });
    arr.sort((a, b) => LIB.shuffleRank[g.id(a)] - LIB.shuffleRank[g.id(b)]);
  } else arr.sort((a, b) => g.added(b) - g.added(a));
}

function libList() {
  let items = Object.values(config.library || {});
  if (LIB.filter === 'favorite') items = items.filter((it) => it.favorite);
  else if (LIB.filter === 'folder') items = items.filter((it) => it.type === 'folder');
  else if (LIB.filter.startsWith('tag:')) {
    const tg = LIB.filter.slice(4);
    items = items.filter((it) => Array.isArray(it.tags) && it.tags.includes(tg));
  }
  const q = LIB.q.trim().toLowerCase();
  if (q) items = items.filter((it) => baseName(it.path).toLowerCase().includes(q));
  sortItems(items);
  return items;
}

function renderLibRailTags() {
  const box = $('#libTags');
  if (!box) return;
  const tags = libAllTags();
  box.innerHTML = '';
  if (tags.length) {
    const hdr = document.createElement('div');
    hdr.className = 'lib-rail-hdr';
    hdr.textContent = t('library.tags');
    box.appendChild(hdr);
    tags.forEach((tg) => {
      const b = document.createElement('button');
      b.className = 'lib-railbtn';
      b.dataset.filter = `tag:${tg}`;
      b.textContent = `# ${tg}`;
      box.appendChild(b);
    });
  }
  // if the active tag filter no longer exists, fall back to "all"
  if (LIB.filter.startsWith('tag:') && !tags.includes(LIB.filter.slice(4))) LIB.filter = 'all';
  document.querySelectorAll('#viewLibrary .lib-railbtn').forEach((b) => {
    b.classList.toggle('active', b.dataset.filter === LIB.filter);
  });
}

function renderLibrary() {
  renderLibRailTags();
  const local = $('#libLocal');
  const online = $('#libOnline');
  if (LIB.filter === 'online') {
    if (local) local.hidden = true;
    if (online) online.hidden = false;
    exitFolderState(); // leaving the local view drops any folder navigation
    renderBreadcrumbs();
    renderOnline();
    return;
  }
  if (online) online.hidden = true;
  if (local) local.hidden = false;
  renderBreadcrumbs();
  const tok = ++allViewToken; // invalidate any in-flight async render

  if (LIB.folderPath) { renderFolderView(tok); return; }
  if (LIB.filter === 'all') { renderAllView(tok); return; }

  // "Папки" / favorite / tag → plain pool-items grid (folders are entities here)
  resetLibObservers();
  const sentinel = $('#libSentinel'); if (sentinel) sentinel.hidden = true;
  const grid = $('#libGrid');
  if (!grid) return;
  const items = libList();
  const assigned = assignedIds();
  const empty = $('#libEmpty');
  if (empty) { empty.hidden = items.length > 0; if (!items.length) setLibEmptyText('library.empty'); }
  grid.innerHTML = '';
  items.forEach((it) => grid.appendChild(buildLibCard(it, assigned.has(it.id))));
}

function buildLibCard(it, isAssigned) {
  const card = document.createElement('div');
  card.className = 'lib-card' + (it.type === 'folder' ? ' folder' : '') + (isAssigned ? ' assigned' : '');
  card.dataset.id = it.id;

  if (it.type === 'folder') {
    fillFolderCollage(card, it.path);
  } else {
    card.title = baseName(it.path);
    lazyThumb(card, it.path, 320, 200);
  }

  const fav = document.createElement('button');
  fav.className = 'lib-fav' + (it.favorite ? ' on' : '');
  fav.textContent = it.favorite ? '★' : '☆';
  fav.title = t('library.favorite');
  fav.addEventListener('click', async (e) => {
    e.stopPropagation();
    config = await window.api.libraryToggleFavorite(it.id);
    renderLibrary();
  });
  card.appendChild(fav);

  if (isAssigned) {
    const badge = document.createElement('span');
    badge.className = 'lib-badge';
    badge.textContent = '✓';
    badge.title = t('library.assigned');
    card.appendChild(badge);
  }

  const menu = document.createElement('button');
  menu.className = 'lib-menu-btn';
  menu.textContent = '⋯';
  menu.title = t('library.assign');
  menu.addEventListener('click', (e) => { e.stopPropagation(); openAssignMenu(it, menu); });
  card.appendChild(menu);

  card.addEventListener('mouseenter', () => setLibStatus(baseName(it.path)));
  card.addEventListener('mouseleave', () => setLibStatus(''));
  card.addEventListener('click', (e) => {
    // Folder click — always navigate unless using Ctrl/Shift
    if (it.type === 'folder' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      enterFolder(it.path, baseName(it.path));
      return;
    }
    // Ctrl+click: toggle this item in/out of selection
    if (e.ctrlKey || e.metaKey) {
      if (LIB.selection.has(it.id)) { LIB.selection.delete(it.id); }
      else { LIB.selection.add(it.id); LIB.lastSelected = it.id; }
    // Shift+click: select range from anchor to this item
    } else if (e.shiftKey && LIB.lastSelected) {
      const cards = Array.from(document.querySelectorAll('.lib-card[data-id]'));
      const idx1 = cards.findIndex(c => c.dataset.id === LIB.lastSelected);
      const idx2 = cards.findIndex(c => c.dataset.id === it.id);
      if (idx1 !== -1 && idx2 !== -1) {
        LIB.selection.clear();
        const lo = Math.min(idx1, idx2), hi = Math.max(idx1, idx2);
        for (let i = lo; i <= hi; i++) LIB.selection.add(cards[i].dataset.id);
      }
    // Plain click with something selected — clear selection, open normal menu
    } else {
      if (LIB.selection.size > 0) { clearSelection(); syncSelectionUI(); return; }
      openAssignMenu(it, menu);
      return;
    }
    syncSelectionUI();
  });
  return card;
}

// Fill a .lib-card.folder with the 2×2 preview collage + name + count (count shows
// "N · ▸M" when the folder has M subfolders). Shared by pool folders and subfolders.
function fillFolderCollage(card, dirPath) {
  const collage = document.createElement('div');
  collage.className = 'lib-folder-collage';
  collage.innerHTML = '<span class="lib-ic">📁</span>';
  card.appendChild(collage);
  const cap = document.createElement('span');
  cap.className = 'lib-card-name';
  cap.textContent = baseName(dirPath);
  card.appendChild(cap);
  const cnt = document.createElement('span');
  cnt.className = 'lib-count';
  cnt.textContent = '📁';
  card.appendChild(cnt);
  card.title = dirPath;
  window.api.folderInfo(dirPath).then((info) => {
    const previews = (info && info.previews) || [];
    const sub = (info && info.subfolders) || 0;
    const n = (info && info.count) || 0;
    cnt.textContent = sub > 0 ? `📁 ${n} · ▸${sub}` : `📁 ${n}`;
    if (!previews.length) return;
    collage.innerHTML = '';
    previews.slice(0, 4).forEach((p) => {
      const tile = document.createElement('div');
      tile.className = 'ff';
      collage.appendChild(tile);
      window.api.thumb(p, 160, 160).then((u) => { if (u) tile.style.backgroundImage = `url("${u}")`; });
    });
  });
}

// ---------------------------------------------------------------------------
// Folder navigation (open a folder in place, drill into subfolders, breadcrumbs)
// ---------------------------------------------------------------------------
function exitFolderState() { LIB.folderPath = null; LIB.crumbs = []; }

function enterFolder(p, name) {
  LIB.folderPath = p;
  LIB.crumbs.push({ path: p, name: name || baseName(p) });
  if (LIB.q) { LIB.q = ''; const s = $('#libSearch'); if (s) s.value = ''; }
  renderLibrary();
}
function crumbTo(i) {
  LIB.crumbs = LIB.crumbs.slice(0, i + 1);
  LIB.folderPath = LIB.crumbs.length ? LIB.crumbs[LIB.crumbs.length - 1].path : null;
  renderLibrary();
}
function exitToFolders() { exitFolderState(); renderLibrary(); }

// Render the breadcrumb bar (hidden unless inside a folder). Includes a "‹ all folders"
// back link and an "Assign this folder" action that materializes the current dir + assigns.
function renderBreadcrumbs() {
  const bar = $('#libCrumbs');
  if (!bar) return;
  if (!LIB.folderPath || !LIB.crumbs.length) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  bar.innerHTML = '';
  const back = document.createElement('button');
  back.className = 'lib-crumb lib-crumb-back';
  back.textContent = t('library.back');
  back.addEventListener('click', exitToFolders);
  bar.appendChild(back);
  LIB.crumbs.forEach((c, i) => {
    const sep = document.createElement('span');
    sep.className = 'lib-crumb-sep';
    sep.textContent = '›';
    bar.appendChild(sep);
    const b = document.createElement('button');
    b.className = 'lib-crumb' + (i === LIB.crumbs.length - 1 ? ' current' : '');
    b.textContent = c.name;
    b.addEventListener('click', () => crumbTo(i));
    bar.appendChild(b);
  });
  const assignBtn = document.createElement('button');
  assignBtn.className = 'pill lib-assign-folder';
  assignBtn.textContent = t('library.assignThisFolder');
  assignBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const res = await window.api.libraryMaterialize(LIB.folderPath, 'folder');
    config = (res && res.config) || config;
    const it = res && res.id && config.library[res.id];
    if (it) openAssignMenu(it, assignBtn);
  });
  bar.appendChild(assignBtn);
}

// path → pool image item lookup (normalized like library.idFor, minus the hash), so a
// folder image that's already in the pool renders as the real card (favorite/assigned).
function normPathKey(p) {
  return String(p || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
function poolImageMap() {
  const map = new Map();
  for (const it of Object.values(config.library || {})) {
    if (it && it.type === 'image' && it.path) map.set(normPathKey(it.path), it);
  }
  return map;
}

// ---- lazy thumbnails: fetch a small preview only when the card scrolls into view ----
// Большие сетки «Все» иначе декодировали бы тысячи полноразмерных фото разом → зависания.
function resetLibObservers() {
  if (libObserver) { libObserver.disconnect(); libObserver = null; }
  if (thumbIO) { thumbIO.disconnect(); thumbIO = null; }
}
function loadThumbInto(card) {
  const p = card.dataset.thumbPath;
  if (!p) return;
  window.api.thumb(p, +card.dataset.thumbW || 320, +card.dataset.thumbH || 200).then((u) => {
    if (!u) { card.classList.add('missing'); return; }
    card.classList.remove('missing');
    card.style.backgroundImage = `url("${u}")`;
  });
}
function lazyThumb(card, p, w, h) {
  card.dataset.thumbPath = p;
  if (w) card.dataset.thumbW = w;
  if (h) card.dataset.thumbH = h;
  if ('IntersectionObserver' in window) {
    if (!thumbIO) {
      thumbIO = new IntersectionObserver((ents) => {
        for (const en of ents) {
          if (en.isIntersecting) { thumbIO.unobserve(en.target); loadThumbInto(en.target); }
        }
      }, { root: null, rootMargin: '300px' });
    }
    thumbIO.observe(card);
  } else {
    loadThumbInto(card); // no observer support → load immediately
  }
}

// Inside-a-folder view: subfolders first (drill in), then images (one level).
async function renderFolderView(tok) {
  const grid = $('#libGrid');
  const empty = $('#libEmpty');
  if (!grid) return;
  resetLibObservers();
  const sentinel = $('#libSentinel'); if (sentinel) sentinel.hidden = true;
  const dir = LIB.folderPath;
  let res;
  try { res = await window.api.folderEntries(dir); } catch { res = null; }
  if (tok !== allViewToken) return; // navigated away while awaiting
  const folders = (res && res.folders) || [];
  let images = (res && res.images) || [];
  const q = LIB.q.trim().toLowerCase();
  if (q) images = images.filter((p) => baseName(p).toLowerCase().includes(q));
  if (LIB.sort === 'name') images = images.slice().sort((a, b) => baseName(a).localeCompare(baseName(b)));
  const assigned = assignedIds();
  const pmap = poolImageMap();
  grid.innerHTML = '';
  folders.forEach((f) => grid.appendChild(buildSubfolderCard(f)));
  images.forEach((p) => grid.appendChild(buildPathImageCard(p, assigned, pmap)));
  const total = folders.length + images.length;
  if (empty) { empty.hidden = total > 0; if (!total) setLibEmptyText('library.emptyFolder'); }
}

// A subfolder card (not a pool item): click drills in; ⋯ assigns it as a source.
function buildSubfolderCard(f) {
  const card = document.createElement('div');
  card.className = 'lib-card folder';
  card.dataset.path = f.path;
  fillFolderCollage(card, f.path);
  const menu = document.createElement('button');
  menu.className = 'lib-menu-btn';
  menu.textContent = '⋯';
  menu.title = t('library.assign');
  menu.addEventListener('click', async (e) => {
    e.stopPropagation();
    const res = await window.api.libraryMaterialize(f.path, 'folder');
    config = (res && res.config) || config;
    const it = res && res.id && config.library[res.id];
    if (it) openAssignMenu(it, menu);
  });
  card.appendChild(menu);
  card.addEventListener('mouseenter', () => setLibStatus(f.path));
  card.addEventListener('click', () => enterFolder(f.path, f.name));
  return card;
}

// An image found by path: real pool card if it's already in the pool, else ephemeral.
function buildPathImageCard(p, assigned, pmap) {
  const real = pmap ? pmap.get(normPathKey(p)) : null;
  if (real) return buildLibCard(real, assigned.has(real.id));
  return buildEphemeralImageCard(p);
}

// Image living inside a folder, not yet in the pool. Any action first "materializes"
// it (adds by reference, no copy) → then the normal assign menu / favorite flow runs.
function buildEphemeralImageCard(p) {
  const card = document.createElement('div');
  card.className = 'lib-card';
  card.title = baseName(p);
  lazyThumb(card, p, 320, 200);
  const materialize = async () => {
    const res = await window.api.libraryMaterialize(p, 'image');
    config = (res && res.config) || config;
    return res && res.id ? config.library[res.id] : null;
  };

  const fav = document.createElement('button');
  fav.className = 'lib-fav';
  fav.textContent = '☆';
  fav.title = t('library.favorite');
  fav.addEventListener('click', async (e) => {
    e.stopPropagation();
    const it = await materialize();
    if (it) { config = await window.api.libraryToggleFavorite(it.id); }
    renderLibrary();
  });
  card.appendChild(fav);

  const menu = document.createElement('button');
  menu.className = 'lib-menu-btn';
  menu.textContent = '⋯';
  menu.title = t('library.assign');
  const open = async () => {
    const it = await materialize();
    if (it) openAssignMenu(it, menu); // menu anchor is still in the DOM (no re-render yet)
  };
  menu.addEventListener('click', (e) => { e.stopPropagation(); open(); });
  card.appendChild(menu);

  card.addEventListener('mouseenter', () => setLibStatus(baseName(p)));
  card.addEventListener('click', open);
  return card;
}

// Flat "All" view: pool images + recursively-expanded folder images, deduped, lazily
// rendered in chunks (folders can hold thousands of files).
async function renderAllView(tok) {
  const grid = $('#libGrid');
  const empty = $('#libEmpty');
  if (!grid) return;
  resetLibObservers();
  const poolImgs = Object.values(config.library || {}).filter((it) => it.type === 'image' && it.path);
  let folderImgs = [];
  try { const res = await window.api.expandFolders(); folderImgs = (res && res.images) || []; }
  catch { folderImgs = []; }
  if (tok !== allViewToken || LIB.folderPath || LIB.filter !== 'all') return; // stale
  // entries: pool items (with metadata) + ephemeral folder images (no overlap — expand
  // excludes anything already in the pool by content id)
  let entries = poolImgs.map((it) => ({ path: it.path, item: it, id: it.id }))
    .concat(folderImgs.map((fi) => ({ path: fi.path, item: null, id: fi.id })));
  const q = LIB.q.trim().toLowerCase();
  if (q) entries = entries.filter((en) => baseName(en.path).toLowerCase().includes(q));
  sortItems(entries, {
    path: (x) => x.path,
    added: (x) => (x.item && x.item.addedAt) || 0,
    size: (x) => (x.item && x.item.size) || 0,
    id: (x) => x.id,
  });
  if (empty) { empty.hidden = entries.length > 0; if (!entries.length) setLibEmptyText('library.empty'); }
  grid.innerHTML = '';
  renderEntriesLazily(grid, entries, assignedIds(), tok);
}

// Append entries in chunks; an IntersectionObserver on #libSentinel pulls the next chunk
// as the user scrolls. Falls back to rendering everything if observers are unavailable.
function renderEntriesLazily(grid, entries, assigned, tok) {
  const CHUNK = 60;
  const sentinel = $('#libSentinel');
  let i = 0;
  const drawNext = () => {
    if (tok !== allViewToken) return;
    const end = Math.min(i + CHUNK, entries.length);
    for (; i < end; i++) {
      const en = entries[i];
      grid.appendChild(en.item ? buildLibCard(en.item, assigned.has(en.item.id)) : buildEphemeralImageCard(en.path));
    }
    if (sentinel) sentinel.hidden = i >= entries.length;
  };
  drawNext();
  if (libObserver) { libObserver.disconnect(); libObserver = null; }
  if (sentinel && 'IntersectionObserver' in window) {
    libObserver = new IntersectionObserver((ents) => {
      if (tok === allViewToken && i < entries.length && ents.some((x) => x.isIntersecting)) drawNext();
    }, { root: null, rootMargin: '400px' });
    libObserver.observe(sentinel);
  } else {
    while (i < entries.length) drawNext(); // no observer → render all
  }
}

// Faint Explorer-style status line: shows the hovered item's name at the bottom.
function setLibStatus(text) {
  const el = $('#libStatus');
  if (el) el.textContent = text || '';
}

// ---- Multi-selection helpers ----
function clearSelection() {
  LIB.selection.clear();
  LIB.lastSelected = null;
}

function syncSelectionUI() {
  // Sync .selected class on cards
  document.querySelectorAll('.lib-card[data-id]').forEach(c => {
    c.classList.toggle('selected', LIB.selection.has(c.dataset.id));
  });
  // Show/hide selection bar
  const bar = $('#libSelectionBar');
  if (!bar) return;
  if (LIB.selection.size === 0) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const n = LIB.selection.size;
  $('#libSelCount').textContent = t('library.selected', { n });
  $('#libSelAssign').textContent = t('library.massAssign');
  $('#libSelDelete').textContent = t('library.massDelete');
}

function openMassAssignMenu() {
  closeLibPopup();
  const pop = document.createElement('div');
  pop.className = 'lib-popup';
  pop.id = 'libPopup';

  const title = document.createElement('div');
  title.className = 'lib-popup-title';
  title.textContent = t('library.assignTo');
  pop.appendChild(title);

  const mons = monitorList.length ? monitorList : [{ id: null, primary: true }];
  mons.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'lib-popup-row';
    const lbl = document.createElement('span');
    lbl.className = 'lib-popup-mon';
    lbl.textContent = t('monitor.label', { n: i + 1 }) + (m.primary ? ' ★' : '');
    row.appendChild(lbl);
    [['light', '☀'], ['dark', '🌙']].forEach(([th, ic]) => {
      const b = document.createElement('button');
      b.className = 'lib-popup-btn';
      b.textContent = `${ic} ${t(th === 'dark' ? 'design.darkTheme' : 'design.lightTheme')}`;
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        for (const id of LIB.selection) {
          config = await window.api.libraryAssign(id, m.id, th);
        }
        closeLibPopup();
        clearSelection();
        syncSelectionUI();
        renderLibrary();
        renderPreviews();
        renderHome();
        toast(t('library.assignedToast'));
      });
      row.appendChild(b);
    });
    pop.appendChild(row);
  });

  // Position in center of screen
  document.body.appendChild(pop);
  const rect = pop.getBoundingClientRect();
  pop.style.left = `${(window.innerWidth - rect.width) / 2}px`;
  pop.style.top = `${(window.innerHeight - rect.height) / 2}px`;
}

// Set the empty-state caption (different wording inside an empty folder vs empty library).
function setLibEmptyText(key) {
  const empty = $('#libEmpty');
  if (!empty) return;
  const sp = empty.querySelector('span') || empty;
  sp.textContent = t(key);
}

function closeLibPopup() {
  const p = $('#libPopup');
  if (p) p.remove();
  document.removeEventListener('click', onDocClosePopup, true);
}
function onDocClosePopup(e) {
  const p = $('#libPopup');
  if (p && !p.contains(e.target)) closeLibPopup();
}

// Floating popup: assign this item to a monitor×theme, or remove it from the library.
function openAssignMenu(it, anchor) {
  closeLibPopup();
  const pop = document.createElement('div');
  pop.className = 'lib-popup';
  pop.id = 'libPopup';

  const title = document.createElement('div');
  title.className = 'lib-popup-title';
  title.textContent = t('library.assignTo');
  pop.appendChild(title);

  const mons = monitorList.length ? monitorList : [{ id: null, primary: true }];
  mons.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'lib-popup-row';
    const lbl = document.createElement('span');
    lbl.className = 'lib-popup-mon';
    lbl.textContent = t('monitor.label', { n: i + 1 }) + (m.primary ? ' ★' : '');
    row.appendChild(lbl);
    [['light', '☀'], ['dark', '🌙']].forEach(([th, ic]) => {
      const b = document.createElement('button');
      b.className = 'lib-popup-btn';
      b.textContent = `${ic} ${t(th === 'dark' ? 'design.darkTheme' : 'design.lightTheme')}`;
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        config = await window.api.libraryAssign(it.id, m.id, th);
        closeLibPopup();
        renderLibrary();
        renderPreviews();
        renderHome();
        toast(t('library.assignedToast'));
      });
      row.appendChild(b);
    });
    pop.appendChild(row);
  });

  const sep = document.createElement('div');
  sep.className = 'lib-popup-sep';
  pop.appendChild(sep);

  // tags editor (chips + add input)
  const tagBox = document.createElement('div');
  tagBox.className = 'lib-popup-tags';
  const tagHdr = document.createElement('div');
  tagHdr.className = 'lib-popup-title';
  tagHdr.textContent = t('library.tags');
  tagBox.appendChild(tagHdr);
  const chips = document.createElement('div');
  chips.className = 'lib-chips';
  tagBox.appendChild(chips);
  const tagInput = document.createElement('input');
  tagInput.className = 'lib-tag-input';
  tagInput.placeholder = t('library.addTagPh');
  tagInput.addEventListener('click', (e) => e.stopPropagation());
  tagBox.appendChild(tagInput);
  pop.appendChild(tagBox);

  const curTags = () => { const f = config.library[it.id]; return (f && f.tags) || []; };
  function renderChips() {
    chips.innerHTML = '';
    curTags().forEach((tg) => {
      const chip = document.createElement('span');
      chip.className = 'lib-chip';
      chip.textContent = tg;
      const x = document.createElement('button');
      x.className = 'lib-chip-x';
      x.textContent = '×';
      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        config = await window.api.libraryRemoveTag(it.id, tg);
        renderChips();
        renderLibrary();
      });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
  }
  renderChips();
  tagInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && tagInput.value.trim()) {
      e.stopPropagation();
      config = await window.api.libraryAddTag(it.id, tagInput.value);
      tagInput.value = '';
      renderChips();
      renderLibrary();
      tagInput.focus();
    }
  });

  const sep2 = document.createElement('div');
  sep2.className = 'lib-popup-sep';
  pop.appendChild(sep2);

  const rm = document.createElement('button');
  rm.className = 'lib-popup-btn danger';
  rm.textContent = t('library.remove');
  rm.addEventListener('click', async (e) => {
    e.stopPropagation();
    config = await window.api.libraryRemove(it.id);
    closeLibPopup();
    renderLibrary();
    renderPreviews();
    renderHome();
    toast(t('library.removedToast'));
  });
  pop.appendChild(rm);

  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  let left = r.right - pop.offsetWidth;
  if (left < 8) left = 8;
  let top = r.bottom + 6;
  if (top + pop.offsetHeight > window.innerHeight - 8) top = r.top - pop.offsetHeight - 6;
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(8, top)}px`;
  setTimeout(() => document.addEventListener('click', onDocClosePopup, true), 0);
}

// ---------------------------------------------------------------------------
// Smart Panel
// ---------------------------------------------------------------------------
let currentSmartTipIndex = -1;

function showSmartTip() {
  const tips = tPath(I18N.dict, 'smart.tips') || tPath(I18N.fallback, 'smart.tips') || [];
  if (!tips || !tips.length) return;
  const panel = $('#smartPanel');
  if (!panel) return;
  panel.className = 'smart-panel';
  $('#spIcon').textContent = '💡';
  $('#spTitle').hidden = true; // No title for tips, looks cleaner
  $('#spText').textContent = tips[currentSmartTipIndex % tips.length];
  $('#btnSpAction').hidden = true;
  panel.hidden = false;
  
  panel.style.animation = 'none';
  panel.offsetHeight; // trigger reflow
  panel.style.animation = 'fadeSlideIn 0.3s ease';
}

// Smart panel = an "update ready" notice (if one is downloaded) or a random tip of the day.
async function renderSmartPanel() {
  const panel = $('#smartPanel');
  if (!panel) return;

  // update ready → "restart to update" with an action button
  const up = await window.api.getUpdateState();
  if (up && up.state === 'ready') {
    panel.className = 'smart-panel update';
    $('#spIcon').textContent = '🚀';
    $('#spTitle').hidden = false;
    $('#spTitle').textContent = t('smart.updateTitle');
    $('#spText').textContent = t('smart.updateText');
    const btn = $('#btnSpAction');
    btn.textContent = t('smart.updateBtn');
    btn.className = 'pill suggested';
    btn.hidden = false;
    btn.onclick = () => window.api.installUpdate();
    panel.hidden = false;
    return;
  }

  // otherwise → tip of the day (random, picked once per session)
  const tips = tPath(I18N.dict, 'smart.tips') || tPath(I18N.fallback, 'smart.tips') || [];
  if (tips && tips.length) {
    if (currentSmartTipIndex === -1) currentSmartTipIndex = Math.floor(Math.random() * tips.length);
    showSmartTip();
  }
}

function initSmartPanel() {
  window.api.onUpdate(() => renderSmartPanel());
  renderSmartPanel();
}

function initLibrary() {
  // Delegated so dynamically-rendered tag buttons work too.
  const rail = document.querySelector('#viewLibrary .lib-rail');
  if (rail) rail.addEventListener('click', (e) => {
    const btn = e.target.closest('.lib-railbtn');
    if (!btn) return;
    LIB.filter = btn.dataset.filter;
    exitFolderState(); // switching rail leaves any open folder
    renderLibrary();
  });

  // Click on empty space in library clears selection
  const libView = $('#viewLibrary');
  if (libView) libView.addEventListener('click', (e) => {
    if (LIB.selection.size === 0) return;
    if (e.target.closest('.lib-card') || e.target.closest('.lib-popup') || e.target.closest('.lib-selection-bar') || e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
    clearSelection();
    syncSelectionUI();
  });

  // Escape key clears selection
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && LIB.selection.size > 0) {
      clearSelection();
      syncSelectionUI();
    }
  });

  // Selection bar buttons
  const selClear = $('#libSelClear');
  if (selClear) selClear.addEventListener('click', () => { clearSelection(); syncSelectionUI(); });
  const selAssign = $('#libSelAssign');
  if (selAssign) selAssign.addEventListener('click', () => openMassAssignMenu());
  const selDelete = $('#libSelDelete');
  if (selDelete) selDelete.addEventListener('click', async () => {
    for (const id of LIB.selection) {
      config = await window.api.libraryRemove(id);
    }
    clearSelection();
    syncSelectionUI();
    renderLibrary();
    renderPreviews();
    renderHome();
    toast(t('library.removedToast'));
  });
  const sortEl = $('#libSort');
  if (sortEl) {
    LIB.sort = config.librarySort || 'added';
    sortEl.value = LIB.sort;
    sortEl.addEventListener('change', async () => {
      LIB.sort = sortEl.value;
      if (LIB.sort === 'shuffle') LIB.shuffleRank = {}; // новый случайный порядок при каждом выборе
      if (LIB.sort === 'size') config = await window.api.libraryEnsureSizes();
      config = await window.api.setConfig({ librarySort: LIB.sort });
      renderLibrary();
    });
  }
  const searchEl = $('#libSearch');
  if (searchEl) searchEl.addEventListener('input', () => { LIB.q = searchEl.value; renderLibrary(); });
  const addP = $('#libAddPhotos');
  if (addP) addP.addEventListener('click', async () => {
    const res = await window.api.libraryAddImages();
    config = (res && res.config) || config;
    renderLibrary();
    if (res && res.added > 0) toast(t('toast.photosAdded', { n: res.added }));
  });
  const addF = $('#libAddFolder');
  if (addF) addF.addEventListener('click', async () => {
    const res = await window.api.libraryAddFolder();
    config = (res && res.config) || config;
    renderLibrary();
    if (res && res.added > 0) toast(t('toast.folderAdded'));
  });

  // online (Wallhaven)
  const whSearchBtn = $('#whSearch');
  if (whSearchBtn) whSearchBtn.addEventListener('click', () => doWhSearch(true));
  const whQ = $('#whQuery');
  if (whQ) whQ.addEventListener('keydown', (e) => { if (e.key === 'Enter') doWhSearch(true); });
  const whSortEl = $('#whSort');
  if (whSortEl) whSortEl.addEventListener('change', () => { WH.sort = whSortEl.value; if (WH.searched) doWhSearch(true); });
  const whFilterToggle = $('#whFilterToggle');
  const whFiltersRow = $('#whFiltersRow');
  if (whFilterToggle && whFiltersRow) {
    whFilterToggle.addEventListener('click', () => {
      whFiltersRow.hidden = !whFiltersRow.hidden;
      whFilterToggle.classList.toggle('suggested', !whFiltersRow.hidden);
    });
  }

  document.querySelectorAll('.wh-purity-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const p = cb.dataset.purity;
      if (p === 'nsfw' && !WH.hasKey) { 
        cb.checked = false; 
        toast(t('online.nsfwNeedsKey')); 
        return; 
      }
      WH.purity[p] = cb.checked;
      
      // Prevent unchecking everything
      if (!WH.purity.sfw && !WH.purity.sketchy && !WH.purity.nsfw) {
        cb.checked = true;
        WH.purity[p] = true;
        return;
      }
      
      if (WH.searched) doWhSearch(true);
    });
  });
  const whMoreBtn = $('#whMore');
  if (whMoreBtn) whMoreBtn.addEventListener('click', () => { WH.page += 1; doWhSearch(false); });

  initLibraryDragDrop();
}

function initLibraryDragDrop() {
  const view = $('#viewLibrary');
  const grid = $('#libGrid');
  if (!view || !grid) return;
  let dc = 0;
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((ev) => {
    view.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
  });
  view.addEventListener('dragenter', () => { dc++; grid.classList.add('drag-over'); });
  view.addEventListener('dragover', (e) => { e.dataTransfer.dropEffect = 'copy'; });
  view.addEventListener('dragleave', () => { dc--; if (dc <= 0) { dc = 0; grid.classList.remove('drag-over'); } });
  view.addEventListener('drop', async (e) => {
    dc = 0;
    grid.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (!files || !files.length) return;
    const paths = [];
    for (let i = 0; i < files.length; i++) {
      try { const p = window.api.getPathForFile(files[i]); if (p) paths.push(p); }
      catch (err) { console.error('lib drop path:', err); }
    }
    if (!paths.length) return;
    const res = await window.api.libraryAddPaths(paths);
    config = (res && res.config) || config;
    renderLibrary();
    if (res && res.added > 0) toast(t('toast.photosAdded', { n: res.added }));
  });
}

// ---- Online (Wallhaven) ----
function updatePurityToggle() {
  document.querySelectorAll('.wh-purity-cb').forEach(cb => {
    const p = cb.dataset.purity;
    cb.checked = !!WH.purity[p];
    
    if (p === 'nsfw') {
      cb.disabled = !WH.hasKey;
      const lbl = $('#lblPurityNsfw');
      if (lbl) {
        lbl.style.opacity = WH.hasKey ? '1' : '0.5';
        lbl.title = WH.hasKey ? '' : t('online.nsfwNeedsKey');
      }
    }
  });
}

async function renderOnline() {
  if (!WH.statusFetched) {
    try { const st = await window.api.wallhavenStatus(); WH.hasKey = !!st.hasKey; }
    catch { WH.hasKey = false; }
    WH.statusFetched = true;
  }
  updatePurityToggle();
  if (!WH.searched) {
    const note = $('#whNote');
    if (note) note.textContent = t('online.hint');
    const grid = $('#whGrid'); if (grid) grid.innerHTML = '';
    const more = $('#whMore'); if (more) more.hidden = true;
  }
}

async function doWhSearch(reset) {
  const qEl = $('#whQuery');
  WH.q = (qEl && qEl.value || '').trim();
  if (reset) WH.page = 1;
  const note = $('#whNote');
  const grid = $('#whGrid');
  if (note) note.textContent = t('online.loading');
  let res;
  try { res = await window.api.wallhavenSearch({ q: WH.q, sort: WH.sort, purity: WH.purity, page: WH.page }); }
  catch (err) { res = { error: 'network' }; }
  WH.searched = true;
  WH.hasKey = !!res.hasKey;
  updatePurityToggle();
  if (res.error) { if (note) note.textContent = t('online.error', { e: res.error }); return; }
  WH.lastPage = (res.meta && res.meta.lastPage) || 1;
  if (reset && grid) grid.innerHTML = '';
  (res.items || []).forEach((it) => grid.appendChild(buildWhCard(it)));
  if (note) note.textContent = (grid && grid.children.length) ? '' : t('online.noResults');
  const more = $('#whMore'); if (more) more.hidden = WH.page >= WH.lastPage;
}

// Already in the pool? Online items carry their source page; we match on it so the
// "added ✓" survives re-searches (was only set in-session before — fixed).
function whAlreadyAdded(item) {
  return Object.values(config.library || {}).some((it) => it.source && it.source === item.page);
}

function buildWhCard(item) {
  const card = document.createElement('div');
  card.className = 'lib-card';
  if (item.thumb) card.style.backgroundImage = `url("${item.thumb}")`;
  const label = [item.resolution, item.category].filter(Boolean).join(' · ');
  card.title = label;
  const add = document.createElement('button');
  add.className = 'lib-menu-btn wh-add';
  const markAdded = () => {
    add.textContent = '✓';
    add.classList.add('added');
    add.disabled = true;
    add.title = t('online.added');
  };
  if (whAlreadyAdded(item)) markAdded();
  else { add.textContent = '+'; add.title = t('online.add'); }
  add.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (add.disabled) return;
    add.disabled = true;
    let res;
    try { res = await window.api.wallhavenAdd(item, WH.q); } catch (err) { res = { error: 'download' }; }
    if (res && res.config) config = res.config;
    if (res && !res.error) { markAdded(); toast(t('online.added')); }
    else { add.disabled = false; toast(t('online.error', { e: (res && res.error) || '?' })); }
  });
  card.appendChild(add);
  card.addEventListener('mouseenter', () => setLibStatus(label || 'Wallhaven'));
  card.addEventListener('click', () => { if (!add.disabled) add.click(); });
  return card;
}

// ---------------------------------------------------------------------------
// Page navigation (Home / Settings)
// ---------------------------------------------------------------------------
function showPage(name) {
  const views = { home: 'viewHome', library: 'viewLibrary', design: 'viewDesign', prefs: 'viewPrefs' };
  const target = views[name] || 'viewHome';
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== target; });
  document.querySelectorAll('.navbtn').forEach((b) => {
    b.classList.toggle('active', b.dataset.page === name);
  });
  const gear = $('#btnPrefs');
  if (gear) gear.classList.toggle('active', name === 'prefs');

  if (name === 'home') {
    renderHome();
  } else if (name === 'library') {
    renderLibrary();
  } else if (name === 'design') {
    renderPreviews();   // reflect current config
    layoutMonitors();   // stages just became visible — refit thumbnails
  }
}

// First-run welcome screen (one-time).
function enterFirstRun() {
  document.body.classList.add('first-run');
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== 'viewWelcome'; });
  $('#welcomeLang').value = config.language || 'system';
  setSwitch($('#welcomeAuto'), config.autoSwitch);
  setSwitch($('#welcomeStartup'), config.autostart);
  setSwitch($('#welcomeTheme'), !!(config.themeSchedule && config.themeSchedule.mode !== 'off'));
  updateShortcutButtons();
}

function exitFirstRun() {
  document.body.classList.remove('first-run');
  showPage('home');
}

// Reflect whether shortcuts already exist: disable the button + show "Created".
async function updateShortcutButtons() {
  let st = { desktop: false, startmenu: false };
  try { st = await window.api.shortcutsStatus(); } catch {}
  const apply = (btn, exists) => {
    if (!btn) return;
    btn.disabled = !!exists;
    btn.classList.toggle('done', !!exists);
    btn.textContent = exists ? t('welcome.shortcutDone') : t('welcome.shortcutsBtn');
  };
  apply($('#welcomeShortcutDesktop'), st.desktop);
  apply($('#welcomeShortcutStart'), st.startmenu);
}

// Home dashboard: current wallpaper per monitor (active theme) + status.
// Кнопка «Сменить обои» на Главной: видна, когда есть что листать (слайдшоу включено,
// либо в плейлисте текущей темы ≥2 кадров / есть папка-источник).
function hasNextWallpaper() {
  if (config.slideshow && config.slideshow.enabled) return true;
  const th = currentTheme;
  for (const m of Object.values(config.monitors || {})) {
    const slot = m && m[th];
    if (slot && Array.isArray(slot.itemIds)) {
      if (slot.itemIds.length >= 2) return true;
      for (const id of slot.itemIds) {
        const it = (config.library || {})[id];
        if (it && it.type === 'folder') return true;
      }
    }
  }
  return false;
}
function updateNextWallBtn() {
  const b = $('#btnNextWall');
  if (b) b.hidden = !hasNextWallpaper();
}

const HOME_THUMB_H = 180;
function renderHome() {
  if (!config) return;
  updateNextWallBtn();
  const wrap = $('#homeMonitors');
  if (wrap) {
    if (!monitorList.length) {
      wrap.innerHTML = `<div class="home-empty">${t('home.noMonitors')}</div>`;
    } else {
      const existingCells = wrap.querySelectorAll('.home-mon');
      if (existingCells.length === monitorList.length) {
        // Update elements in-place to prevent disappearing / flickering
        monitorList.forEach((m, i) => {
          const cell = existingCells[i];
          const thumb = cell.querySelector('.home-thumb');
          const lbl = cell.querySelector('.home-mon-label');
          
          if (lbl) {
            lbl.textContent = t('monitor.label', { n: i + 1 }) + (m.primary ? ' ★' : '');
          }
          
          if (thumb) {
            window.api.currentImage(m.id, currentTheme).then(async (wp) => {
              if (wp) {
                // If it is already showing this wallpaper path, do nothing
                if (thumb.dataset.bgPath === wp) {
                  return;
                }
                thumb.dataset.bgPath = wp;

                const url = await window.api.fileUrl(wp);
                const newBgUrl = `${url}?v=${Date.now()}`;
                const newBg = `url("${newBgUrl}")`;
                
                const oldBg = thumb.style.backgroundImage;

                // Preload the image so it swaps instantly without a blank flash
                const img = new Image();
                img.onload = () => {
                  if (oldBg && oldBg !== 'none' && oldBg !== newBg) {
                    thumb.style.backgroundImage = `${newBg}, ${oldBg}`;
                    setTimeout(() => {
                      thumb.style.backgroundImage = newBg;
                    }, 150);
                  } else {
                    thumb.style.backgroundImage = newBg;
                  }
                  thumb.classList.remove('empty');
                  thumb.textContent = '';
                };
                img.src = newBgUrl;
              } else {
                thumb.dataset.bgPath = '';
                thumb.style.backgroundImage = '';
                thumb.classList.add('empty');
                thumb.textContent = t('home.noWallpaper');
              }
            });
          }
        });
      } else {
        // Fallback: Full rebuild only if monitor count changed
        wrap.innerHTML = '';
        monitorList.forEach((m, i) => {
          const ar = m.h ? m.w / m.h : 16 / 9;
          const cell = document.createElement('div');
          cell.className = 'home-mon';
          cell.title = t('home.editMonitor') || "Настроить обои";
          cell.addEventListener('click', () => {
            selectMonitor(m);
            showPage('design');
          });
          const thumb = document.createElement('div');
          thumb.className = 'home-thumb';
          thumb.style.height = HOME_THUMB_H + 'px';
          thumb.style.width = Math.round(HOME_THUMB_H * ar) + 'px';
          thumb.classList.add('empty');
          
          window.api.currentImage(m.id, currentTheme).then(async (wp) => {
            if (wp) {
              thumb.dataset.bgPath = wp;
              const url = await window.api.fileUrl(wp);
              const newBgUrl = `${url}?v=${Date.now()}`;
              
              // Preload before display
              const img = new Image();
              img.onload = () => {
                thumb.style.backgroundImage = `url("${newBgUrl}")`;
                thumb.classList.remove('empty');
                thumb.textContent = '';
              };
              img.src = newBgUrl;
            } else {
              thumb.dataset.bgPath = '';
              thumb.textContent = t('home.noWallpaper');
            }
          });
          
          const lbl = document.createElement('div');
          lbl.className = 'home-mon-label';
          lbl.textContent = t('monitor.label', { n: i + 1 }) + (m.primary ? ' ★' : '');
          
          cell.appendChild(thumb);
          cell.appendChild(lbl);
          wrap.appendChild(cell);
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Updates (Squirrel via main). Status text + a button that checks, then turns
// into "Restart" once an update is downloaded. On dev/portable (unsupported)
// the button opens the Releases page instead.
// ---------------------------------------------------------------------------
let lastUpdate = { state: 'idle', supported: true };
const UPDATE_STATUS_KEY = {
  idle: 'prefs.updateIdle', checking: 'prefs.updateChecking',
  downloading: 'prefs.updateDownloading', ready: 'prefs.updateReady',
  none: 'prefs.updateNone', error: 'prefs.updateError',
};
function renderUpdate(st) {
  if (st) lastUpdate = st;
  const btn = $('#btnCheckUpdate');
  const status = $('#updateStatus');
  if (!btn || !status) return;
  const state = lastUpdate.state || 'idle';
  status.textContent = t(UPDATE_STATUS_KEY[state] || 'prefs.updateIdle');
  const busy = state === 'checking' || state === 'downloading';
  if (state === 'ready') {
    btn.textContent = t('prefs.updateRestart');
    btn.classList.add('suggested');
    btn.disabled = false;
  } else {
    btn.textContent = t('prefs.updateCheck');
    btn.classList.remove('suggested');
    btn.disabled = busy;
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  config = await window.api.getConfig();
  currentTheme = await window.api.getTheme();
  await loadI18n();
  applyI18n();
  applyThemeToUI(currentTheme);
  setMonitors(await window.api.getMonitors());
  await renderConfig();
  if (!config.firstRunDone) enterFirstRun();
  else showPage('home');

  window.api.getVersion().then((v) => {
    $('#appVersion').textContent = 'v' + v;
  });

  window.api.getUpdateState().then(renderUpdate);
  initSmartPanel();

  // ---- page navigation ----
  document.querySelectorAll('.navbtn').forEach((b) => {
    b.addEventListener('click', () => showPage(b.dataset.page));
  });
  $('#btnPrefs').addEventListener('click', () => showPage('prefs'));

  // ---- home: switch to the next wallpaper now ----
  const btnNextWall = $('#btnNextWall');
  if (btnNextWall) btnNextWall.addEventListener('click', async () => {
    btnNextWall.disabled = true;
    try { await window.api.nextWallpaper(); toast(t('toast.nextWallpaper')); }
    finally { setTimeout(() => { renderHome(); renderPreviews(); btnNextWall.disabled = false; }, 350); }
  });

  // ---- settings: quit the app ----
  $('#btnQuit').addEventListener('click', () => window.api.quitApp());

  // ---- settings: open the project website ----
  $('#btnWebsite').addEventListener('click', () => window.api.openWebsite());

  // ---- settings: usage statistics (opt-in placeholder) ----
  $('#swTelemetry').addEventListener('click', async () => {
    const on = $('#swTelemetry').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swTelemetry'), on);
    config = await window.api.setConfig({ telemetry: on });
  });

  $('#swGameMode').addEventListener('click', async () => {
    const on = $('#swGameMode').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swGameMode'), on);
    config = await window.api.setConfig({ gameModeBlock: on });
    renderConfig();
    toast(on ? t('toast.gameModeOn') : t('toast.gameModeOff'));
  });

  // ---- settings: re-open the welcome screen ----
  $('#btnShowWelcome').addEventListener('click', () => enterFirstRun());

  // ---- settings: check for / install updates ----
  $('#btnCheckUpdate').addEventListener('click', async () => {
    const cur = await window.api.getUpdateState();
    if (cur.state === 'ready') { window.api.installUpdate(); return; }
    const res = await window.api.checkForUpdates();
    if (!res || res.supported === false) {
      // dev / portable build (no Squirrel) — send the user to the Releases page
      toast(t('toast.updateManual'));
      window.api.openReleases();
    }
  });

  // ---- language ----
  $('#selLang').addEventListener('change', async () => {
    config = await window.api.setConfig({ language: $('#selLang').value });
    await loadI18n();
    refreshTexts();
  });

  // ---- first-run welcome ----
  $('#welcomeLang').addEventListener('change', async () => {
    config = await window.api.setConfig({ language: $('#welcomeLang').value });
    await loadI18n();
    refreshTexts();
    $('#welcomeLang').value = config.language || 'system';
  });
  $('#welcomeAuto').addEventListener('click', async () => {
    const on = $('#welcomeAuto').getAttribute('aria-checked') !== 'true';
    setSwitch($('#welcomeAuto'), on);
    config = await window.api.setConfig({ autoSwitch: on });
  });
  $('#welcomeStartup').addEventListener('click', async () => {
    const on = $('#welcomeStartup').getAttribute('aria-checked') !== 'true';
    setSwitch($('#welcomeStartup'), on);
    await window.api.setAutostart(on);
    config.autostart = on;
  });
  $('#welcomeTheme').addEventListener('click', async () => {
    const on = $('#welcomeTheme').getAttribute('aria-checked') !== 'true';
    setSwitch($('#welcomeTheme'), on);
    const sch = { ...(config.themeSchedule || {}), mode: on ? 'time' : 'off' };
    config = await window.api.setConfig({ themeSchedule: sch });
  });
  $('#welcomeShortcutDesktop').addEventListener('click', async () => {
    await window.api.createShortcuts('desktop');
    await updateShortcutButtons();
    toast(t('toast.shortcutsDone'));
  });
  $('#welcomeShortcutStart').addEventListener('click', async () => {
    await window.api.createShortcuts('startmenu');
    await updateShortcutButtons();
    toast(t('toast.shortcutsDone'));
  });
  $('#welcomeStart').addEventListener('click', async () => {
    config = await window.api.setConfig({ firstRunDone: true });
    renderConfig(); // sync the main settings controls with welcome choices
    exitFirstRun();
  });

  $('#themeIndicator').addEventListener('click', async () => {
    const override = await window.api.cycleThemeOverride();
    config.themeOverride = override;
    applyThemeToUI(currentTheme); // Update tooltip immediately
  });

  // shortcut to Library to pick wallpapers when the monitor preview is empty
  ['#previewLight', '#previewDark'].forEach((sel) => {
    const el = $(sel);
    if (el) {
      el.addEventListener('click', () => {
        if (el.classList.contains('empty')) {
          showPage('library');
        }
      });
    }
  });

  // switches
  $('#swAuto').addEventListener('click', async () => {
    const on = $('#swAuto').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swAuto'), on);
    config = await window.api.setConfig({ autoSwitch: on });
    renderHome();
    toast(on ? t('toast.autoOn') : t('toast.autoOff'));
  });

  // one wallpaper for all monitors (vs. a separate pair per monitor)
  $('#swSingle').addEventListener('click', async () => {
    const on = $('#swSingle').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swSingle'), on);
    config = await window.api.setConfig({ singleWallpaper: on });
    buildMonitorMap();   // show/hide the monitor map
    renderPreviews();    // previews now reflect global vs per-monitor
    renderHome();
    await window.api.applyNow();
    toast(on ? t('toast.singleOn') : t('toast.singleOff'));
  });

  $('#swStartup').addEventListener('click', async () => {
    const on = $('#swStartup').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swStartup'), on);
    await window.api.setAutostart(on);
    renderHome();
    toast(on ? t('toast.startupOn') : t('toast.startupOff'));
  });

  // start minimized to tray (only affects the autostart launch; decoupled from it)
  $('#swStartMin').addEventListener('click', async () => {
    const on = $('#swStartMin').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swStartMin'), on);
    await window.api.setStartMinimized(on);
    config.startMinimized = on;
    toast(on ? t('toast.startMinOn') : t('toast.startMinOff'));
  });

  // style select — applies live
  $('#selStyle').addEventListener('change', async (e) => {
    config = await window.api.setConfig({ style: e.target.value });
    applyPreviewStyle();
    const res = await window.api.applyNow();
    if (res.ok) toast(t('toast.styleUpdated'));
  });

  // slideshow controls (live)
  $('#swSlideshow').addEventListener('click', async () => {
    const on = $('#swSlideshow').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swSlideshow'), on);
    config = await window.api.setSlideshow({ enabled: on });
    updateSlideshowControls();
    toast(on ? t('toast.slideshowOn') : t('toast.slideshowOff'));
  });
  $('#slideInterval').addEventListener('change', async () => {
    let v = parseInt($('#slideInterval').value, 10);
    if (!Number.isFinite(v) || v < 1) v = 30;
    config = await window.api.setSlideshow({ intervalMin: v });
    $('#slideInterval').value = config.slideshow.intervalMin;
  });
  $('#selSlideOrder').addEventListener('change', async () => {
    config = await window.api.setSlideshow({ order: $('#selSlideOrder').value });
  });

  // wallpaper triggers (on startup, on wake from sleep)
  $('#swTriggerStartup').addEventListener('click', async () => {
    const on = $('#swTriggerStartup').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swTriggerStartup'), on);
    $('#rowTriggerStealth').style.display = on ? 'flex' : 'none';
    config = await window.api.setConfig({ triggers: { ...config.triggers, onStartup: on } });
    renderConfig();
  });
  $('#swTriggerWakeup').addEventListener('click', async () => {
    const on = $('#swTriggerWakeup').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swTriggerWakeup'), on);
    config = await window.api.setConfig({ triggers: { ...config.triggers, onWakeup: on } });
    renderConfig();
  });
  $('#swTriggerStealth').addEventListener('click', async () => {
    const on = $('#swTriggerStealth').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swTriggerStealth'), on);
    config = await window.api.setConfig({ triggers: { ...config.triggers, stealth: on } });
    renderConfig();
  });

  // theme schedule (Lumina switches the Windows theme itself)
  async function saveThemeSchedule(announce) {
    const sch = {
      mode: $('#selThemeMode').value,
      lightStart: $('#lightStart').value || '07:00',
      darkStart: $('#darkStart').value || '20:00',
      lat: $('#latInput').value.trim(),
      lng: $('#lngInput').value.trim(),
    };
    config = await window.api.setConfig({ themeSchedule: sch });
    $('#themeTimes').hidden = (sch.mode !== 'time');
    $('#themeSun').hidden = (sch.mode !== 'sun');
    if (announce) toast(sch.mode === 'off' ? t('toast.scheduleOff') : t('toast.scheduleOn'));
  }
  $('#selThemeMode').addEventListener('change', () => saveThemeSchedule(true));
  $('#lightStart').addEventListener('change', () => saveThemeSchedule(false));
  $('#darkStart').addEventListener('change', () => saveThemeSchedule(false));
  $('#latInput').addEventListener('change', () => saveThemeSchedule(false));
  $('#lngInput').addEventListener('change', () => saveThemeSchedule(false));

  $('#btnDetectCoords').addEventListener('click', async () => {
    const btn = $('#btnDetectCoords');
    const status = $('#lblCoordsStatus');
    btn.disabled = true;
    status.textContent = t('theme.autoCoordsChecking') || '...';
    const res = await window.api.detectLocation();
    btn.disabled = false;
    if (res.ok) {
      $('#latInput').value = res.lat;
      $('#lngInput').value = res.lng;
      status.textContent = t('theme.autoCoordsSuccess', { city: res.city, lat: parseFloat(res.lat).toFixed(2), lng: parseFloat(res.lng).toFixed(2) });
      const sch = {
        ...(config.themeSchedule || {}),
        lat: res.lat,
        lng: res.lng
      };
      config = await window.api.setConfig({ themeSchedule: sch });
      toast(t('toast.styleUpdated'));
    } else {
      status.textContent = t('theme.autoCoordsError', { msg: res.reason });
      toast(t('toast.error', { msg: res.reason }));
    }
  });

  // live updates from main process
  window.api.onTheme((theme) => {
    applyThemeToUI(theme);
    renderHome();
    toast(theme === 'dark' ? t('toast.themeDark') : t('toast.themeLight'));
  });

  window.api.onConfig((cfg) => {
    config = cfg;
    renderConfig();
    renderHome();
    if (!$('#viewLibrary').hidden) renderLibrary();
  });

  window.api.onMonitors((list) => {
    setMonitors(list);
  });

  window.api.onUpdate((st) => renderUpdate(st));

  // keep thumbnails fitted when the window (and thus cards) resize
  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(layoutMonitors, 60);
  });

  initHotkeys();
  initDragDrop();
  initLibrary();
}

function initHotkeys() {
  const recBtn = $('#btnRecordShortcut');
  const clearBtn = $('#btnClearShortcut');
  const swEnabled = $('#swShortcutEnabled');
  if (!recBtn || !clearBtn || !swEnabled) return;

  let isRecording = false;

  function getElectronKeyName(event) {
    const code = event.code;
    if (code.startsWith('Key')) {
      return code.substring(3); // 'KeyW' -> 'W'
    }
    if (code.startsWith('Digit')) {
      return code.substring(5); // 'Digit1' -> '1'
    }
    if (code.startsWith('F') && code.length > 1) {
      const num = parseInt(code.substring(1), 10);
      if (num >= 1 && num <= 24) return code;
    }

    const map = {
      'ArrowUp': 'Up',
      'ArrowDown': 'Down',
      'ArrowLeft': 'Left',
      'ArrowRight': 'Right',
      'Space': 'Space',
      'Escape': 'Escape',
      'Tab': 'Tab',
      'Backspace': 'Backspace',
      'Delete': 'Delete',
      'Insert': 'Insert',
      'Enter': 'Enter',
      'NumpadEnter': 'Enter',
      'PageUp': 'PageUp',
      'PageDown': 'PageDown',
      'Home': 'Home',
      'End': 'End',
      'Minus': 'Minus',
      'Equal': 'Equal',
      'Comma': 'Comma',
      'Period': 'Period',
      'Slash': 'Slash',
      'Semicolon': 'Semicolon',
      'Quote': 'Quote',
      'BracketLeft': 'BracketLeft',
      'BracketRight': 'BracketRight',
      'Backslash': 'Backslash',
      'Backquote': 'Backquote',
    };

    return map[code] || null;
  }

  function handleKeydown(e) {
    e.preventDefault();
    e.stopPropagation();

    const modifiers = [];
    if (e.ctrlKey) modifiers.push('Ctrl');
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');
    if (e.metaKey) modifiers.push('Super');

    const isModifierOnly = ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code);

    if (isModifierOnly) {
      if (modifiers.length > 0) {
        recBtn.textContent = modifiers.join(' + ') + ' + ...';
      } else {
        recBtn.textContent = t('shortcuts.pressKeys');
      }
      return;
    }

    const mainKey = getElectronKeyName(e);
    if (!mainKey) return;

    const hasModifier = modifiers.length > 0;
    const isFunctionKey = /^F\d+$/.test(mainKey);
    const mediaKeys = ['MediaNextTrack', 'MediaPreviousTrack', 'MediaStop', 'MediaPlayPause', 'VolumeUp', 'VolumeDown', 'VolumeMute'];
    const isMediaKey = mediaKeys.includes(mainKey);

    if (!hasModifier && !isFunctionKey && !isMediaKey) {
      toast(t('toast.shortcutInvalid'));
      stopRecording(false);
      return;
    }

    const shortcut = [...modifiers, mainKey].join('+');
    saveShortcut(shortcut);
    stopRecording(true);
  }

  function startRecording() {
    if (isRecording) return;
    isRecording = true;
    recBtn.classList.add('recording');
    recBtn.textContent = t('shortcuts.recording') || 'Recording...';
    window.addEventListener('keydown', handleKeydown, true);
  }

  function stopRecording(success) {
    if (!isRecording) return;
    isRecording = false;
    recBtn.classList.remove('recording');
    window.removeEventListener('keydown', handleKeydown, true);
    if (!success) {
      const hk = config.hotkeys && config.hotkeys.nextWallpaper;
      const val = hk ? hk.shortcut : '';
      recBtn.textContent = val || t('shortcuts.pressKeys');
      if (val) recBtn.classList.add('assigned');
      else recBtn.classList.remove('assigned');
    }
  }

  async function saveShortcut(shortcut) {
    const hk = {
      nextWallpaper: {
        enabled: true,
        shortcut: shortcut
      }
    };
    config = await window.api.setConfig({ hotkeys: hk });
    renderConfig();
    toast(t('toast.shortcutUpdated'));
  }

  recBtn.addEventListener('click', () => {
    startRecording();
  });

  clearBtn.addEventListener('click', async () => {
    const hk = {
      nextWallpaper: {
        enabled: false,
        shortcut: ''
      }
    };
    config = await window.api.setConfig({ hotkeys: hk });
    renderConfig();
    toast(t('toast.shortcutUpdated'));
  });

  swEnabled.addEventListener('click', async () => {
    const on = swEnabled.getAttribute('aria-checked') !== 'true';
    setSwitch(swEnabled, on);
    const hk = {
      nextWallpaper: {
        enabled: on,
        shortcut: (config.hotkeys && config.hotkeys.nextWallpaper && config.hotkeys.nextWallpaper.shortcut) || ''
      }
    };
    config = await window.api.setConfig({ hotkeys: hk });
    renderConfig();
  });
}

function initDragDrop() {
  document.querySelectorAll('.wallcard').forEach((card) => {
    const theme = card.dataset.theme;
    let dragCounter = 0;

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
      card.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, false);
    });

    card.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      card.classList.add('drag-over');
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    card.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        card.classList.remove('drag-over');
      }
    });

    // Handle dropped files
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCounter = 0;
      card.classList.remove('drag-over');

      const files = e.dataTransfer.files;
      if (!files || !files.length) return;

      const mon = editTargetId();
      if (!mon) return;

      const filePaths = [];
      for (let i = 0; i < files.length; i++) {
        try {
          const path = window.api.getPathForFile(files[i]);
          if (path) filePaths.push(path);
        } catch (err) {
          console.error('Failed to get path for dropped file:', err);
        }
      }

      if (filePaths.length === 0) return;

      const res = await window.api.addSlotPaths(mon, theme, filePaths);
      config = (res && res.config) || config;
      renderSlot(theme);
      renderHome();
      if (res && res.added > 0) {
        toast(t('toast.photosAdded', { n: res.added }));
        if (theme === currentTheme) window.api.applyNow(theme);
      }
    });
  });
}

init();
