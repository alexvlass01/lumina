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
    libraryAssign: async (id, monitorId, which) => {
      const theme = which === 'dark' ? 'dark' : 'light';
      const mid = monitorId || 'MON-1';
      if (!mock.monitors[mid]) mock.monitors[mid] = { light: { itemIds: [] }, dark: { itemIds: [] } };
      const slot = mock.monitors[mid][theme];
      if (!slot.itemIds.includes(id)) slot.itemIds.push(id);
      return mock;
    },
    setSlideshow: async (patch) => { mock.slideshow = { ...mock.slideshow, ...patch }; return mock; },
    setSlideshowIndex: async (monitorId, which, index) => {
      const theme = which === 'dark' ? 'dark' : 'light';
      if (!mock.slideshowIndex[monitorId]) mock.slideshowIndex[monitorId] = { light: 0, dark: 0 };
      mock.slideshowIndex[monitorId][theme] = index;
      return mock;
    },
    applyNow: async () => ({ ok: false, reason: 'no-wallpaper' }),
    setAutostart: async (v) => (mock.autostart = v),
    setStartMinimized: async (v) => (mock.startMinimized = v),
    fileUrl: async (p) => p,
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
    const s = t(el.dataset.i18nTitle);
    el.title = s;
    el.setAttribute('aria-label', s);
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
      // Preload thumbnail image before displaying to prevent flicker
      window.api.fileUrl(it.path).then((u) => {
        if (u) {
          const img = new Image();
          img.onload = () => {
            el.style.backgroundImage = `url("${u}")`;
          };
          img.src = u;
        }
      });

      // Click on thumbnail → switch wallpaper to this item
      if (items.length > 1) {
        el.classList.add('clickable');
        el.addEventListener('click', async (ev) => {
          if (ev.target.closest('.thumb-remove')) return; // don't trigger on delete button
          const mon = editTargetId();
          if (!mon) return;
          config = await window.api.setSlideshowIndex(mon, theme, idx);
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
  $('#selStyle').value = config.style || 'fill';
  updateSingleWallRow();
  updateSlideshowControls();
  renderThemeSchedule();
}

// ---------------------------------------------------------------------------
// Library (content pool) — browse/organize all wallpapers, assign from a card.
// ---------------------------------------------------------------------------
const LIB = { filter: 'all', sort: 'added', q: '' };

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

function libList() {
  let items = Object.values(config.library || {});
  if (LIB.filter === 'favorite') items = items.filter((it) => it.favorite);
  else if (LIB.filter === 'folder') items = items.filter((it) => it.type === 'folder');
  const q = LIB.q.trim().toLowerCase();
  if (q) items = items.filter((it) => baseName(it.path).toLowerCase().includes(q));
  if (LIB.sort === 'name') items.sort((a, b) => baseName(a.path).localeCompare(baseName(b.path)));
  else items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  return items;
}

function renderLibrary() {
  const grid = $('#libGrid');
  if (!grid) return;
  const items = libList();
  const assigned = assignedIds();
  const empty = $('#libEmpty');
  if (empty) empty.hidden = items.length > 0;
  grid.innerHTML = '';
  items.forEach((it) => grid.appendChild(buildLibCard(it, assigned.has(it.id))));
}

function buildLibCard(it, isAssigned) {
  const card = document.createElement('div');
  card.className = 'lib-card' + (it.type === 'folder' ? ' folder' : '') + (isAssigned ? ' assigned' : '');
  card.dataset.id = it.id;

  if (it.type === 'folder') {
    card.innerHTML = '<span class="lib-ic">📁</span>';
    card.title = it.path;
  } else {
    card.title = baseName(it.path);
    window.api.fileUrl(it.path).then((u) => {
      if (!u) { card.classList.add('missing'); return; }
      const url = `${u}?v=${it.addedAt || 0}`;
      const img = new Image();
      img.onload = () => { card.style.backgroundImage = `url("${url}")`; card.classList.remove('missing'); };
      img.onerror = () => card.classList.add('missing');
      img.src = url;
    });
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

  card.addEventListener('click', () => openAssignMenu(it, menu));
  return card;
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

function initLibrary() {
  document.querySelectorAll('.lib-railbtn').forEach((b) => {
    b.addEventListener('click', () => {
      LIB.filter = b.dataset.filter;
      document.querySelectorAll('.lib-railbtn').forEach((x) => x.classList.toggle('active', x === b));
      renderLibrary();
    });
  });
  const sortEl = $('#libSort');
  if (sortEl) sortEl.addEventListener('change', () => { LIB.sort = sortEl.value; renderLibrary(); });
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
const HOME_THUMB_H = 116;
function renderHome() {
  if (!config) return;
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
  const a = $('#stAuto'); if (a) a.textContent = config.autoSwitch ? t('val.on') : t('val.off');
  const s = $('#stStartup'); if (s) s.textContent = config.autostart ? t('val.on') : t('val.off');
  const mc = $('#stMonitors'); if (mc) mc.textContent = String(monitorList.length);
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

  // ---- page navigation ----
  document.querySelectorAll('.navbtn').forEach((b) => {
    b.addEventListener('click', () => showPage(b.dataset.page));
  });
  $('#btnPrefs').addEventListener('click', () => showPage('prefs'));

  // ---- home: apply current theme now ----
  $('#btnApplyNow').addEventListener('click', async () => {
    const res = await window.api.applyNow();
    if (res.ok) toast(t('toast.applied'));
    else if (res.reason === 'no-wallpaper') toast(t('toast.noWallpaper'));
    else toast(t('toast.error', { msg: res.reason }));
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

  // add photos / a folder to the SELECTED monitor's playlist (primary in single mode)
  document.querySelectorAll('[data-add-photos]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const which = btn.dataset.addPhotos;
      const mon = editTargetId();
      if (!mon) return;
      const res = await window.api.addSlotImages(mon, which);
      config = (res && res.config) || config;
      renderSlot(which);
      renderHome();
      if (res && res.added) {
        toast(t('toast.photosAdded', { n: res.added }));
        if (which === currentTheme) window.api.applyNow(which);
      }
    });
  });
  document.querySelectorAll('[data-add-folder]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const which = btn.dataset.addFolder;
      const mon = editTargetId();
      if (!mon) return;
      const res = await window.api.addSlotFolder(mon, which);
      config = (res && res.config) || config;
      renderSlot(which);
      renderHome();
      if (res && res.added) {
        toast(t('toast.folderAdded'));
        if (which === currentTheme) window.api.applyNow(which);
      }
    });
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

  initDragDrop();
  initLibrary();
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
