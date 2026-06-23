'use strict';

// Fallback mock so the UI can be previewed in a plain browser (outside Electron).
// In the real app window.api is always provided by preload.js, so this is skipped.
if (!window.api) {
  let mock = { lightWallpaper: '', darkWallpaper: '', singleWallpaper: false, separateThemes: true, monitors: {}, library: {}, autoSwitch: true, wallpaperSchedule: { mode: 'system', lightStart: '07:00', darkStart: '20:00' }, style: 'fill', autostart: false, startMinimized: true, language: 'system', themeSchedule: { mode: 'off', lightStart: '07:00', darkStart: '20:00', lat: '', lng: '' }, slideshow: { enabled: false, intervalEnabled: true, intervalMin: 30, order: 'sequential' }, slideshowIndex: {}, slideshowCurrentPath: {}, triggers: { onStartup: false, onWakeup: false, stealth: false }, onlineSources: { lumina: false, internet: true }, onlineSort: 'date_added', onlinePurity: { sfw: true, sketchy: true, nsfw: false } };
  const mockAdd = (type, p) => { const iid = 'm' + p; mock.library[iid] = { id: iid, type, path: p }; return iid; };
  let mockSc = { desktop: false, startmenu: false };
  let mockCloud = { signedIn: false, user: null };
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
    getWallpaperTheme: async () => {
      if (mock.separateThemes === false) return 'light';
      const sch = mock.wallpaperSchedule || {};
      if (sch.mode !== 'time') return 'light';
      const hm = (s) => { const [h, m] = String(s || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
      const now = new Date();
      const n = now.getHours() * 60 + now.getMinutes();
      const light = hm(sch.lightStart || '07:00'), dark = hm(sch.darkStart || '20:00');
      const isLight = light < dark ? n >= light && n < dark : n >= light || n < dark;
      return isLight ? 'light' : 'dark';
    },
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
    libraryRefresh: async () => ({ config: mock, removed: 0 }),
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
    libraryRecent: async (limit) => ({ items: Object.values(mock.library || {})
      .filter((item) => item && item.type === 'image' && item.path)
      .sort((a, b) => (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0))
      .slice(0, Number(limit) || 5) }),
    libraryEnsureSizes: async () => mock,
    libraryMaterialize: async (p, type) => ({ config: mock, id: mockAdd(type === 'folder' ? 'folder' : 'image', p) }),
    getCloudCapability: async () => ({ environment: 'unavailable', available: false, authAvailable: false, reason: 'coming_soon' }),
    cloudCatalog: async (opts) => {
      const o = opts || {};
      const rating = o.rating === 'suggestive' ? 'suggestive' : 'general';
      const mk = (i, color) => ({ id: 'cloud' + i, title: 'Sample ' + i, rating, published_at: Date.now() / 1000, width: 1920, height: 1080,
        thumb_url: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/></svg>`) });
      if (!o.cursor) return { items: [mk(1, '#3584e4'), mk(2, '#e23'), mk(3, '#2c6'), mk(4, '#fb0')], nextCursor: 'p2', error: null };
      return { items: [mk(5, '#8e24aa'), mk(6, '#1e88e5')], nextCursor: null, error: null };
    },
    cloudAdd: async (item) => { const iid = 'cl' + item.id; mock.library[iid] = { id: iid, type: 'image', path: 'C:/fake/' + item.id + '.jpg', source: 'lumina:' + item.id }; return { config: mock, id: iid, error: null }; },
    cloudSession: async () => ({ available: true, signedIn: mockCloud.signedIn, user: mockCloud.signedIn ? mockCloud.user : null, entitlements: mockCloud.signedIn ? ['online_catalog'] : [] }),
    cloudSignin: async () => { mockCloud.signedIn = true; mockCloud.user = { id: 'u1', display_name: 'Test User', email: 'test@example.com', role: 'user', explicit_opt_in: false, created_at: Math.floor(Date.now() / 1000) }; return { ok: true, state: { available: true, signedIn: true, user: mockCloud.user, entitlements: ['online_catalog'] } }; },
    cloudSignout: async () => { mockCloud.signedIn = false; mockCloud.user = null; mockCloud.favs = {}; return { ok: true, state: { available: true, signedIn: false, user: null, entitlements: [] } }; },
    onCloudSession: () => {},
    cloudFavorites: async () => { const favs = mockCloud.favs || {}; const items = Object.keys(favs).map((id) => favs[id]); return { items, error: null }; },
    cloudFavorite: async (id, on) => { mockCloud.favs = mockCloud.favs || {}; if (on) mockCloud.favs[id] = { id, title: 'Fav ' + id, rating: 'general', published_at: Date.now() / 1000, width: 1920, height: 1080, thumb_url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#e91e63"/></svg>') }; else delete mockCloud.favs[id]; return { ok: true, error: null }; },
    internetStatus: async () => ({ hasKey: false, bundled: false, nsfwAvailable: true }),
    internetSearch: async (opts) => {
      const page = (opts && opts.page) || 1;
      const mk = (i, color) => ({ id: 'net' + page + '_' + i, provider: 'wallhaven', page: 'https://wh/' + page + '-' + i, full: 'data:', thumb: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="${color}"/></svg>`), resolution: '1920x1080', category: 'general', width: 1920, height: 1080 });
      return { items: [mk(1, '#4b5563'), mk(2, '#374151'), mk(3, '#475569'), mk(4, '#334155')], meta: { currentPage: page, lastPage: 3 }, error: null, hasKey: false, nsfwAvailable: true };
    },
    internetTagSuggest: async (opts) => {
      const q = String(opts && opts.q || '').toLowerCase();
      const items = [
        { name: 'blue_hair', count: 450000, category: 'general' },
        { name: 'blue_eyes', count: 390000, category: 'general' },
        { name: 'blue_archive', count: 90000, category: 'copyright' },
        { name: 'landscape', count: 70000, category: 'general' },
        { name: 'night_sky', count: 42000, category: 'general' },
      ].filter((it) => it.name.startsWith(q)).slice(0, (opts && opts.limit) || 10);
      return { items, error: null };
    },
    internetThumbnail: async (item) => ({ dataUrl: item && String(item.thumb || '').startsWith('data:') ? item.thumb : '', error: null }),
    internetAdd: async () => ({ config: mock, error: null }),
    openGalleryViewer: async () => ({ ok: true }),
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
    thumbInfo: async (p) => ({ url: p, width: 16, height: 10 }),
    thumbAspects: async (entries) => entries.map((entry) => ({ path: entry.path, aspect: 1.6 })),
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
    detectLocation: async () => ({ ok: true, lat: 50.45, lng: 30.52, city: 'Kyiv' }),
    getUpdateState: async () => ({ state: 'idle', supported: false }),
    onTheme: () => {},
    onWallpaperTheme: () => {},
    onConfig: () => {},
    onLiveFoldersChanged: () => {},
    onMonitors: () => {},
    onUpdate: () => {},
  };
}

const $ = (sel) => document.querySelector(sel);

let config = null;
let currentTheme = 'light';
let currentWallpaperTheme = 'light';

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
    if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', txt);
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
let homeSelectedMonitorId = null;
let homePage = 0;
let homeRenderVersion = 0;
let homeBackdropVersion = 0;
const homeWallpaperCache = new Map();
let monitorAspect = 16 / 9;
let previewContextVersion = 0;

function selectedMonitor() {
  return monitorList.find((m) => m.id === selectedMonitorId) || null;
}

function applySelectedAspect() {
  const m = selectedMonitor();
  monitorAspect = m && m.h ? m.w / m.h : 16 / 9;
  layoutMonitors();
}

function setMonitors(list) {
  const previousMonitorId = selectedMonitorId;
  monitorList = Array.isArray(list) && list.length ? list : [];
  if (!monitorList.find((m) => m.id === selectedMonitorId)) {
    const primary = monitorList.find((m) => m.primary) || monitorList[0];
    selectedMonitorId = primary ? primary.id : null;
  }
  if (!monitorList.find((m) => m.id === homeSelectedMonitorId)) homeSelectedMonitorId = null;
  if (selectedMonitorId !== previousMonitorId) resetPreviewsForMonitor(selectedMonitorId);
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
  const changed = selectedMonitorId !== m.id;
  selectedMonitorId = m.id;
  if (changed) resetPreviewsForMonitor(m.id);
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
  // Windows DWPOS_FILL keeps vertical overflow near the upper third rather than CSS' 50% center.
  // Matching that anchor keeps square/portrait wallpaper previews aligned with the real desktop.
  fill:    { size: 'cover',     repeat: 'no-repeat', position: 'center 33.333%' },
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

async function setPreview(which, filePath, monitorId = selectedMonitorId) {
  const el = which === 'dark' ? $('#previewDark') : $('#previewLight');
  const contextId = monitorId || '';

  // A different monitor is a different visual context. Never cross-fade its old
  // wallpaper into the new monitor's geometry.
  if (el.dataset.monitorId !== contextId) {
    el.dataset.monitorId = contextId;
    el.style.backgroundImage = 'none';
    el.innerHTML = '';
    el.classList.remove('empty');
    el.removeAttribute('data-bg-path');
  }

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

function resetPreviewsForMonitor(monitorId) {
  previewContextVersion++;
  ['#previewLight', '#previewDark'].forEach((selector) => {
    const el = $(selector);
    if (!el) return;
    const loadId = (Number.parseInt(el.dataset.loadId, 10) || 0) + 1;
    el.dataset.loadId = String(loadId);
    el.dataset.monitorId = monitorId || '';
    el.removeAttribute('data-bg-path');
    el.style.backgroundImage = 'none';
    el.innerHTML = '';
    el.classList.remove('empty');
  });
}

// big preview = resolved current image (main scans folders); strip = playlist items
function renderSlot(which) {
  const theme = which === 'dark' ? 'dark' : 'light';
  const monitorId = selectedMonitorId;
  const contextVersion = previewContextVersion;
  renderStrip(theme);
  window.api.currentImage(monitorId, theme).then((cur) => {
    if (contextVersion !== previewContextVersion || monitorId !== selectedMonitorId) return;
    setPreview(theme, cur, monitorId);
  });
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

// Theme currently used for wallpapers. It may be independent from the Windows/UI theme.
function wallTheme() {
  return (config && config.separateThemes === false) ? 'light' : currentWallpaperTheme;
}

// Включает/выключает «единый» режим интерфейса: один широкий слот вместо пары день/ночь.
function updateSeparateThemesUI() {
  const single = !!(config && config.separateThemes === false);
  document.body.classList.toggle('single-theme', single);
  // Подпись под картой мониторов: в едином режиме без слов про «пару день/ночь».
  // Меняем сам data-i18n, чтобы applyI18n() при смене языка брал актуальный ключ.
  const note = document.querySelector('#monitorBar .mon-note');
  if (note) {
    note.dataset.i18n = single ? 'design.monitorNoteSingle' : 'design.monitorNote';
    note.textContent = t(note.dataset.i18n);
  }
}

function applyThemeToUI(theme) {
  currentTheme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');

  const isDark = theme === 'dark';
  $('#heroIcon').textContent = isDark ? '🌙' : '☀️';
  $('#heroSub').textContent = isDark ? t('home.themeDark') : t('home.themeLight');

  // Theme indicator doubles as a toggle: a 📌 pin marks a manual override (forced
  // light/dark), no pin means Auto. Tooltip explains the current mode + that it's clickable.
  if (config) {
    const mode = config.themeOverride;
    const ind = $('#themeIndicator');
    ind.style.cursor = 'pointer';
    if (mode === 'light') {
      ind.title = t('home.forceLight');
      $('#heroIcon').textContent = '☀️📌';
    } else if (mode === 'dark') {
      ind.title = t('home.forceDark');
      $('#heroIcon').textContent = '🌙📌';
    } else {
      ind.title = t('home.themeAuto');
    }
  }

  // Подсвечиваем карточку слота, из которого СЕЙЧАС берутся обои (в едином режиме это
  // всегда светлый/общий слот, независимо от темы Windows).
  const activeSlot = wallTheme();
  document.querySelectorAll('.wallcard').forEach((c) => {
    c.style.outline = c.dataset.theme === activeSlot ? '2px solid var(--accent)' : 'none';
    c.style.outlineOffset = '1px';
  });
}

function setSwitch(el, on) {
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

function renderSharedCoordinates() {
  const sch = (config && config.themeSchedule) || {};
  for (const id of ['#latInput', '#wallpaperLatInput']) if ($(id)) $(id).value = sch.lat || '';
  for (const id of ['#lngInput', '#wallpaperLngInput']) if ($(id)) $(id).value = sch.lng || '';
}

function renderWallpaperSchedule() {
  const sch = (config && config.wallpaperSchedule) || { mode: 'system', lightStart: '07:00', darkStart: '20:00' };
  if ($('#selWallpaperMode')) $('#selWallpaperMode').value = sch.mode || 'system';
  if ($('#wallpaperLightStart')) $('#wallpaperLightStart').value = sch.lightStart || '07:00';
  if ($('#wallpaperDarkStart')) $('#wallpaperDarkStart').value = sch.darkStart || '20:00';
  if ($('#wallpaperTimes')) $('#wallpaperTimes').hidden = (sch.mode !== 'time');
  if ($('#wallpaperSun')) $('#wallpaperSun').hidden = (sch.mode !== 'sun');
  renderSharedCoordinates();
}

function renderThemeSchedule() {
  const sch = (config && config.themeSchedule) || { mode: 'off', lightStart: '07:00', darkStart: '20:00', lat: '', lng: '' };
  const sel = $('#selThemeMode');
  if (sel) sel.value = sch.mode || 'off';
  if ($('#lightStart')) $('#lightStart').value = sch.lightStart || '07:00';
  if ($('#darkStart')) $('#darkStart').value = sch.darkStart || '20:00';
  if ($('#themeTimes')) $('#themeTimes').hidden = (sch.mode !== 'time');
  if ($('#themeSun')) $('#themeSun').hidden = (sch.mode !== 'sun');
  renderSharedCoordinates();
}

function updateSlideshowControls() {
  const ss = (config && config.slideshow) || { enabled: false, intervalEnabled: true, intervalMin: 30, order: 'sequential' };
  const trig = (config && config.triggers) || {};
  setSwitch($('#swSlideshow'), !!ss.enabled);
  setSwitch($('#swSlideInterval'), ss.intervalEnabled !== false);
  if ($('#slideInterval')) $('#slideInterval').value = ss.intervalMin || 30;
  if ($('#slideInterval')) $('#slideInterval').hidden = ss.intervalEnabled === false;
  if ($('#selSlideOrder')) $('#selSlideOrder').value = ss.order || 'sequential';
  setSwitch($('#swTriggerStartup'), !!trig.onStartup);
  setSwitch($('#swTriggerWakeup'), !!trig.onWakeup);
  setSwitch($('#swTriggerStealth'), !!trig.stealth);
  document.querySelectorAll('.slideshow-option').forEach((row) => { row.hidden = !ss.enabled; });
  const list = $('#slideshowList');
  if (list) list.classList.toggle('collapsed', !ss.enabled);
}

async function renderConfig() {
  renderPreviews();
  applyPreviewStyle();
  setSwitch($('#swSeparate'), config.separateThemes !== false);
  updateSeparateThemesUI();
  setSwitch($('#swStartup'), config.autostart);
  setSwitch($('#swStartMin'), config.startMinimized !== false);
  setSwitch($('#swSingle'), !!config.singleWallpaper);
  setSwitch($('#swTelemetry'), !!config.telemetry);
  setSwitch($('#swGameMode'), !!config.gameModeBlock);
  $('#selStyle').value = config.style || 'fill';
  const selVb = $('#selViewerBackground');
  selVb.value = config.viewerBackground || 'ambient';
  if (!selVb.value) selVb.value = 'ambient'; // a stored mode that isn't exposed yet → show ambient
  updateSingleWallRow();
  updateSlideshowControls();
  renderWallpaperSchedule();
  renderThemeSchedule();

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
const LIB = { filter: 'all', sort: 'added', q: '', folderPath: null, crumbs: [], shuffleRank: {}, selection: new Set(), lastSelected: null, aspectCache: new Map() };
let libObserver = null; // IntersectionObserver for lazy "All" rendering
let allViewToken = 0;   // guards async folder/All renders against races
let thumbIO = null;     // IntersectionObserver that loads thumbnails on scroll
let pendingLibRefresh = false; // a live-folder change arrived while hidden → refresh on re-show only
let lastLibRenderKey = '';     // view+content the grid was last rendered for; skip rebuild when unchanged
let justifiedFrame = 0;
const justifiedPending = new Set();
const INTERNET = { q: '', sort: 'date_added', purity: { sfw: true, sketchy: true, nsfw: false }, page: 1, lastPage: 1, nsfwAvailable: false, searched: false, statusFetched: false };
const INTERNET_TAG_SUGGEST = { timer: 0, seq: 0, cache: new Map(), items: [], index: -1, token: null };
const INTERNET_TAG_SUGGEST_DEBOUNCE_MS = 450;
const INTERNET_TAG_SUGGEST_MIN_LEN = 3;
// Cloud C2: capability state (environment/available/reason) fetched once from main.
const CLOUD = { cap: null, fetched: false };
// Unified online feed state. view = 'search' | 'favorites'; loaded gates the initial
// auto-search and is reset when leaving the Online tab (so signed R2 URLs stay fresh).
const ONLINE = { view: 'search', loaded: false, loading: false };
// Lumina cursor pagination within the shared feed.
const LUMINA = { cursor: null };
// Cloud C4: account/session state (renderer-safe; the token never leaves main).
const CLOUDAUTH = { state: null, fetched: false, signingIn: false };
// Cloud C5: account-synced favorites (ids of catalog items the user has hearted).
const CLOUDFAV = { ids: new Set(), fetched: false };

function setLibCardAspect(card, aspect) {
  if (!card) return;
  const safe = window.JustifiedLayout.normalizeAspect(aspect, 0.65, 3);
  const previous = Number(card.dataset.aspect);
  if (Number.isFinite(previous) && Math.abs(previous - safe) < 0.005) return;
  card.dataset.aspect = String(safe);
  const grid = card.closest('.lib-grid');
  if (grid) scheduleJustifiedLayout(grid);
}

function knownLibAspect(item, p) {
  const direct = item && Number(item.aspect);
  if (Number.isFinite(direct) && direct > 0) return direct;
  if (item && item.width > 0 && item.height > 0) return item.width / item.height;
  return LIB.aspectCache.get(normPathKey(p || (item && item.path))) || 0;
}

function primeLibCardAspect(card, item, p) {
  const aspect = knownLibAspect(item, p);
  card.dataset.aspectKnown = aspect > 0 ? 'true' : 'false';
  setLibCardAspect(card, aspect || 1.6);
}

function layoutLibGrid(grid) {
  if (!grid || !grid.isConnected) return;
  const width = grid.clientWidth;
  if (width < 40) return;
  const cards = Array.from(grid.children).filter((el) => el.classList.contains('lib-card'));
  if (!cards.length) return;
  const targetHeight = width >= 1000 ? 178 : width >= 700 ? 160 : 142;
  const boxes = window.JustifiedLayout.layout(
    cards.map((card) => Number(card.dataset.aspect) || 1.6),
    width,
    { gap: 10, targetHeight, minAspect: 0.65, maxAspect: 3 }
  );
  cards.forEach((card, i) => {
    const box = boxes[i];
    card.style.width = `${box.width.toFixed(2)}px`;
    card.style.height = `${box.height.toFixed(2)}px`;
  });
}

function scheduleJustifiedLayout(grid) {
  if (grid) justifiedPending.add(grid);
  if (justifiedFrame) return;
  justifiedFrame = requestAnimationFrame(() => {
    justifiedFrame = 0;
    const grids = Array.from(justifiedPending);
    justifiedPending.clear();
    grids.forEach(layoutLibGrid);
  });
}

function scheduleAllLibraryLayouts() {
  scheduleJustifiedLayout($('#libGrid'));
  scheduleJustifiedLayout($('#whGrid'));
}

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

// Cheap fingerprint of everything the Library grid renders from (pool items +
// their favorite/type, the sort, and the assigned set). Used to skip a wasteful
// full re-render on config broadcasts that don't touch the library (theme,
// schedule, viewer background, …) — those were flashing the whole grid.
function librarySignature() {
  const lib = (config && config.library) || {};
  const items = Object.keys(lib).sort().map((id) => {
    const it = lib[id] || {};
    return id + (it.favorite ? '*' : '') + (it.type === 'folder' ? 'F' : '');
  }).join(',');
  return `${items}|${(config && config.librarySort) || ''}|${[...assignedIds()].sort().join(',')}`;
}

// Full identity of what the Library grid currently shows (view + filter + folder +
// query + sort + content). When this is unchanged, a tab switch back to Library can
// reuse the existing DOM (and its loaded thumbnails) instead of rebuilding/flashing.
function libRenderKey() {
  return [LIB.filter, LIB.folderPath || '', LIB.q || '', LIB.sort || '', librarySignature()].join('');
}

function libAllTags() {
  const set = new Set();
  Object.values(config.library || {}).forEach((it) => (it.tags || []).forEach((tg) => set.add(tg)));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// Tag → number of pool items carrying it (popularity). Used by the assign-menu autocomplete.
function libTagCounts() {
  const counts = {};
  Object.values(config.library || {}).forEach((it) => (it.tags || []).forEach((tg) => { counts[tg] = (counts[tg] || 0) + 1; }));
  return counts;
}

// Сортировка массива на месте по LIB.sort (added/name/size/shuffle). `get` — аксессоры,
// чтобы одна логика работала и для элементов пула, и для записей плоского «Все» ({path,item,id}).
function sortItems(arr, get) {
  const g = {
    path: (x) => x.path,
    added: (x) => x.addedAt || 0,
    modified: (x) => x.modifiedAt || 0,
    size: (x) => x.size || 0,
    id: (x) => x.id,
    ...(get || {}),
  };
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const byName = (a, b) => baseName(g.path(a)).localeCompare(baseName(g.path(b)));
  if (LIB.sort === 'name') arr.sort((a, b) => baseName(g.path(a)).localeCompare(baseName(g.path(b))));
  else if (LIB.sort === 'size') arr.sort((a, b) => g.size(b) - g.size(a));
  else if (LIB.sort === 'shuffle') {
    arr.forEach((x) => { const id = g.id(x); if (LIB.shuffleRank[id] === undefined) LIB.shuffleRank[id] = Math.random(); });
    arr.sort((a, b) => LIB.shuffleRank[g.id(a)] - LIB.shuffleRank[g.id(b)]);
  } else {
    arr.sort((a, b) => number(g.added(b)) - number(g.added(a))
      || number(g.modified(b)) - number(g.modified(a))
      || byName(a, b));
  }
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
      const ic = document.createElement('span');
      ic.className = 'lib-rail-ic lib-rail-hash';
      ic.textContent = '#';
      const lbl = document.createElement('span');
      lbl.textContent = tg;
      b.append(ic, lbl);
      box.appendChild(b);
    });
  }
  // if the active tag filter no longer exists, fall back to "all"
  if (LIB.filter.startsWith('tag:') && !tags.includes(LIB.filter.slice(4))) LIB.filter = 'all';
  document.querySelectorAll('#viewLibrary .lib-railbtn').forEach((b) => {
    b.classList.toggle('active', b.dataset.filter === LIB.filter);
  });
}

function setLibViewHeader(count = null) {
  const title = $('#libViewTitle');
  const countEl = $('#libViewCount');
  let label = t('library.all');
  if (LIB.folderPath && LIB.crumbs.length) label = LIB.crumbs[LIB.crumbs.length - 1].name;
  else if (LIB.filter === 'favorite') label = t('library.favorites');
  else if (LIB.filter === 'folder') label = t('library.folders');
  else if (LIB.filter === 'online') label = t('online.rail');
  else if (LIB.filter.startsWith('tag:')) label = `#${LIB.filter.slice(4)}`;
  if (title) title.textContent = label;
  if (!countEl) return;
  const hasCount = Number.isFinite(count) && count >= 0;
  countEl.hidden = !hasCount;
  if (hasCount) countEl.textContent = t('library.itemsCount', { n: count });
}

function renderLibrary() {
  // Record what we're about to render so a later tab switch can detect "nothing
  // changed" and skip a needless rebuild; any pending refresh is now satisfied.
  pendingLibRefresh = false;
  lastLibRenderKey = libRenderKey();
  renderLibRailTags();
  setLibViewHeader();
  const local = $('#libLocal');
  const online = $('#libOnline');
  const canAddLocalSources = !LIB.folderPath && (LIB.filter === 'all' || LIB.filter === 'folder');
  const addPhotos = $('#libAddPhotos');
  const addFolder = $('#libAddFolder');
  if (addPhotos) addPhotos.hidden = !canAddLocalSources;
  if (addFolder) addFolder.hidden = !canAddLocalSources;
  if (LIB.filter === 'online') {
    if (local) local.hidden = true;
    if (online) online.hidden = false;
    exitFolderState(); // leaving the local view drops any folder navigation
    renderBreadcrumbs();
    renderOnline();
    scheduleJustifiedLayout($('#whGrid'));
    return;
  }
  if (online) online.hidden = true;
  if (local) local.hidden = false;
  ONLINE.loaded = false; // re-fetch fresh signed URLs next time Online opens
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
  setLibViewHeader(items.length);
  grid.innerHTML = '';
  items.forEach((it) => grid.appendChild(buildLibCard(it, assigned.has(it.id))));
  scheduleJustifiedLayout(grid);
}

function buildLibCard(it, isAssigned) {
  const card = document.createElement('div');
  card.className = 'lib-card' + (it.type === 'folder' ? ' folder' : '') + (isAssigned ? ' assigned' : '');
  card.dataset.id = it.id;
  makeLibCardFocusable(card);
  primeLibCardAspect(card, it, it.path);

  if (it.type === 'folder') {
    fillFolderCollage(card, it.path);
  } else {
    card.title = baseName(it.path);
    lazyThumb(card, it.path, 320, 200);
    card.__galleryItem = galleryItemFromLibrary(it);
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
    const mark = document.createElement('span');
    mark.className = 'lib-assigned';
    mark.title = t('library.assigned');
    card.appendChild(mark);
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
    // Folder with no modifiers → navigate into it.
    if (it.type === 'folder' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      enterFolder(it.path, baseName(it.path));
      return;
    }
    if (e.shiftKey) {
      // Shift+click: extend the selection from the anchor to this card (Explorer-style).
      // Without an anchor yet, behave like a plain select of this single card.
      if (LIB.lastSelected && LIB.lastSelected !== it.id) {
        const cards = Array.from(document.querySelectorAll('.lib-card[data-id]'));
        const i1 = cards.findIndex((c) => c.dataset.id === LIB.lastSelected);
        const i2 = cards.findIndex((c) => c.dataset.id === it.id);
        if (i1 !== -1 && i2 !== -1) {
          LIB.selection.clear();
          for (let i = Math.min(i1, i2); i <= Math.max(i1, i2); i++) LIB.selection.add(cards[i].dataset.id);
        }
      } else {
        LIB.selection.add(it.id);
        LIB.lastSelected = it.id;
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle this card and make it the new range anchor.
      if (LIB.selection.has(it.id)) LIB.selection.delete(it.id);
      else LIB.selection.add(it.id);
      LIB.lastSelected = it.id;
    } else {
      // Plain click: leave selection mode if active, otherwise preview the image.
      if (LIB.selection.size > 0) { clearSelection(); syncSelectionUI(); return; }
      LIB.lastSelected = it.id; // remember anchor so a later Shift+click can extend from here
      if (card.__galleryItem) openGalleryFromCard(card, card.__galleryItem);
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
  collage.innerHTML = '<svg class="lib-ic" viewBox="0 0 64 64" aria-hidden="true"><path class="lib-folder-back" d="M6 18c0-3 2.4-5.5 5.5-5.5h15l6 7H53c3 0 5.5 2.5 5.5 5.5v24c0 3-2.5 5.5-5.5 5.5H11.5C8.4 54.5 6 52 6 49z"/><path class="lib-folder-front" d="M6 25h52.5v24c0 3-2.5 5.5-5.5 5.5H11.5C8.4 54.5 6 52 6 49z"/></svg>';
  card.appendChild(collage);
  const cap = document.createElement('span');
  cap.className = 'lib-card-name';
  cap.textContent = baseName(dirPath);
  card.appendChild(cap);
  const cnt = document.createElement('span');
  cnt.className = 'lib-count';
  cnt.textContent = '0';
  card.appendChild(cnt);
  card.title = dirPath;
  window.api.folderInfo(dirPath).then((info) => {
    const previews = (info && info.previews) || [];
    const sub = (info && info.subfolders) || 0;
    const n = (info && info.count) || 0;
    cnt.textContent = sub > 0 ? `${n} · +${sub}` : String(n);
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
  assignBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Materialize the folder into the pool only once the user picks a slot in the menu.
    openAssignMenu(null, assignBtn, async () => {
      const res = await window.api.libraryMaterialize(LIB.folderPath, 'folder');
      config = (res && res.config) || config;
      return res && res.id ? config.library[res.id] : null;
    });
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
  const w = +card.dataset.thumbW || 320;
  const h = +card.dataset.thumbH || 200;
  const request = window.api.thumbInfo
    ? window.api.thumbInfo(p, w, h)
    : window.api.thumb(p, w, h).then((url) => ({ url, width: 0, height: 0 }));
  request.then((info) => {
    const u = info && info.url;
    if (!u) { card.classList.add('missing'); return; }
    card.classList.remove('missing');
    card.style.backgroundImage = `url("${u}")`;
    if (info.width > 0 && info.height > 0) {
      const aspect = info.width / info.height;
      LIB.aspectCache.set(normPathKey(p), aspect);
      if (card.dataset.aspectKnown !== 'true') setLibCardAspect(card, aspect);
      card.dataset.aspectKnown = 'true';
    }
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
  scheduleJustifiedLayout(grid);
  const total = folders.length + images.length;
  setLibViewHeader(total);
  if (empty) { empty.hidden = total > 0; if (!total) setLibEmptyText('library.emptyFolder'); }
}

// A subfolder card (not a pool item): click drills in; ⋯ assigns it as a source.
function buildSubfolderCard(f) {
  const card = document.createElement('div');
  card.className = 'lib-card folder';
  card.dataset.path = f.path;
  makeLibCardFocusable(card);
  setLibCardAspect(card, 1.6);
  fillFolderCollage(card, f.path);
  const menu = document.createElement('button');
  menu.className = 'lib-menu-btn';
  menu.textContent = '⋯';
  menu.title = t('library.assign');
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    // Don't add the subfolder to the pool just for opening its menu — only if the
    // user actually assigns it as a source.
    openAssignMenu(null, menu, async () => {
      const res = await window.api.libraryMaterialize(f.path, 'folder');
      config = (res && res.config) || config;
      return res && res.id ? config.library[res.id] : null;
    });
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

// Image living inside a folder, not yet in the pool. Preview can open it directly;
// actions that mutate library state first materialize it by reference (no copy).
function buildEphemeralImageCard(p) {
  const card = document.createElement('div');
  card.className = 'lib-card';
  card.title = baseName(p);
  makeLibCardFocusable(card);
  primeLibCardAspect(card, null, p);
  lazyThumb(card, p, 320, 200);
  card.__galleryItem = galleryItemFromPath(p);
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
  // Open the menu WITHOUT materializing; it is added to the pool only if the user
  // actually assigns/tags/removes inside the menu (materialize passed as callback).
  menu.addEventListener('click', (e) => { e.stopPropagation(); openAssignMenu(null, menu, materialize); });
  card.appendChild(menu);

  card.addEventListener('mouseenter', () => setLibStatus(baseName(p)));
  card.addEventListener('click', () => openGalleryFromCard(card, card.__galleryItem));
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
    .concat(folderImgs.map((fi) => ({
      path: fi.path,
      item: null,
      id: fi.id,
      addedAt: fi.addedAt,
      modifiedAt: fi.modifiedAt,
    })));
  const q = LIB.q.trim().toLowerCase();
  if (q) entries = entries.filter((en) => baseName(en.path).toLowerCase().includes(q));
  sortItems(entries, {
    path: (x) => x.path,
    added: (x) => x.item ? x.item.addedAt : x.addedAt,
    modified: (x) => x.item ? x.item.modifiedAt : x.modifiedAt,
    size: (x) => (x.item && x.item.size) || 0,
    id: (x) => x.id,
  });
  if (empty) { empty.hidden = entries.length > 0; if (!entries.length) setLibEmptyText('library.empty'); }
  setLibViewHeader(entries.length);
  grid.innerHTML = '';
  renderEntriesLazily(grid, entries, assignedIds(), tok);
}

// Append entries in chunks; an IntersectionObserver on #libSentinel pulls the next chunk
// as the user scrolls. Falls back to rendering everything if observers are unavailable.
function renderEntriesLazily(grid, entries, assigned, tok) {
  const CHUNK = 60;
  const sentinel = $('#libSentinel');
  let i = 0;
  let drawPromise = null;
  const drawNext = () => {
    if (drawPromise) return drawPromise;
    if (tok !== allViewToken) return Promise.resolve();
    drawPromise = (async () => {
      const end = Math.min(i + CHUNK, entries.length);
      const chunk = entries.slice(i, end);
      try {
        const missing = chunk.filter((en) => !knownLibAspect(en.item, en.path));
        if (missing.length && window.api.thumbAspects) {
          const aspects = await window.api.thumbAspects(
            missing.map((en) => ({ id: en.item && en.item.id, path: en.path })),
            320,
            200
          );
          if (tok !== allViewToken) return;
          for (const info of (aspects || [])) {
            if (info && info.path && info.aspect > 0) LIB.aspectCache.set(normPathKey(info.path), info.aspect);
          }
          for (const en of missing) {
            const aspect = LIB.aspectCache.get(normPathKey(en.path));
            if (aspect && en.item) en.item.aspect = aspect;
          }
        }
      } catch (err) {
        console.error('library: aspect prefetch failed', err);
      }
      if (tok !== allViewToken) return;
      for (; i < end; i++) {
        const en = entries[i];
        grid.appendChild(en.item ? buildLibCard(en.item, assigned.has(en.item.id)) : buildEphemeralImageCard(en.path));
      }
      scheduleJustifiedLayout(grid);
      if (sentinel) sentinel.hidden = i >= entries.length;
    })().finally(() => { drawPromise = null; });
    return drawPromise;
  };
  if (libObserver) { libObserver.disconnect(); libObserver = null; }
  if (sentinel && 'IntersectionObserver' in window) {
    drawNext().then(() => {
      if (tok !== allViewToken || i >= entries.length) return;
      libObserver = new IntersectionObserver((ents) => {
        if (tok === allViewToken && i < entries.length && ents.some((x) => x.isIntersecting)) drawNext();
      }, { root: null, rootMargin: '400px' });
      libObserver.observe(sentinel);
    });
  } else {
    (async () => { while (i < entries.length && tok === allViewToken) await drawNext(); })();
  }
}

// Faint Explorer-style status line: shows the hovered item's name at the bottom.
function setLibStatus(text) {
  const el = $('#libStatus');
  if (el) el.textContent = text || '';
}

function makeLibCardFocusable(card) {
  card.tabIndex = 0;
  card.addEventListener('keydown', (e) => {
    if (e.target !== card || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    card.click();
  });
}

// ---- Gallery viewer helpers ----
function gallerySubtitle(parts) {
  return parts.filter(Boolean).join(' - ');
}

function galleryItemFromLibrary(it) {
  return {
    kind: 'library',
    key: `library:${it.id}`,
    title: baseName(it.path),
    subtitle: t('viewer.local'),
    path: it.path,
    raw: it,
  };
}

function galleryItemFromPath(p) {
  return {
    kind: 'path',
    key: `path:${normPathKey(p)}`,
    title: baseName(p),
    subtitle: t('viewer.localFolder'),
    path: p,
    raw: { path: p },
  };
}

function galleryItemFromCloud(item) {
  const resolution = item.width && item.height ? `${item.width}x${item.height}` : '';
  return {
    kind: 'cloud',
    key: `cloud:${item.id}`,
    title: item.title || t('online.sourceLumina'),
    subtitle: gallerySubtitle([t('online.sourceLumina'), resolution, item.rating && t(`online.rating${item.rating[0].toUpperCase()}${item.rating.slice(1)}`)]),
    previewUrl: item.thumb_url || '',
    raw: item,
  };
}

function galleryItemFromInternet(item) {
  return {
    kind: 'internet',
    key: `internet:${item.provider || 'source'}:${item.id || item.page || item.full || item.thumb}`,
    title: item.resolution || item.id || t('online.source'),
    subtitle: gallerySubtitle([t('online.source'), item.category, item.purity]),
    previewUrl: item.thumb || '',
    raw: item,
    query: INTERNET.q,
  };
}

function openGalleryFromCard(card, fallbackItem) {
  const grid = card && card.closest('.lib-grid');
  const cards = grid
    ? Array.from(grid.querySelectorAll('.lib-card')).filter((c) => c.__galleryItem)
    : [card].filter(Boolean);
  const items = cards.map((c) => c.__galleryItem).filter(Boolean);
  const index = Math.max(0, cards.indexOf(card));
  openGalleryViewer(items.length ? items : [fallbackItem].filter(Boolean), index);
}

function openGalleryViewer(items, index = 0) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return;
  closeLibPopup();
  hideOnlineTagSuggest();
  const payloadItems = list.map((entry) => ({
    ...entry,
    added: entry.added || isGalleryItemAdded(entry),
  }));
  window.api.openGalleryViewer({
    items: payloadItems,
    index: Math.max(0, Math.min(payloadItems.length - 1, index || 0)),
  }).catch(() => toast(t('viewer.loadError')));
}

function isGalleryItemAdded(entry) {
  if (!entry || !entry.raw) return false;
  if (entry.kind === 'cloud') return cloudAlreadyAdded(entry.raw);
  if (entry.kind === 'internet') return internetAlreadyAdded(entry.raw);
  return false;
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

// Shared monitor×theme grid for both the single- and multi-assign popups.
// onPick(monitorId, theme) performs the actual assignment.
function appendAssignRows(pop, onPick) {
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
    // Единый режим (separateThemes off): у монитора один слот — одна кнопка «Назначить».
    const themes = (config && config.separateThemes === false)
      ? [['light', '', t('library.assignAction')]]
      : [['light', '☀ ', t('design.lightTheme')], ['dark', '🌙 ', t('design.darkTheme')]];
    themes.forEach(([th, ic, label]) => {
      const b = document.createElement('button');
      b.className = 'lib-popup-btn';
      b.textContent = `${ic}${label}`;
      b.addEventListener('click', (e) => { e.stopPropagation(); onPick(m.id, th); });
      row.appendChild(b);
    });
    pop.appendChild(row);
  });
}

// Bulk assign: apply the chosen monitor×theme to every selected item. Anchored above the
// "assign" button in the selection bar (which sits at the bottom of the window).
function openMassAssignMenu(anchor) {
  closeLibPopup();
  const pop = document.createElement('div');
  pop.className = 'lib-popup';
  pop.id = 'libPopup';

  appendAssignRows(pop, async (monitorId, th) => {
    for (const id of LIB.selection) config = await window.api.libraryAssign(id, monitorId, th);
    closeLibPopup();
    clearSelection();
    syncSelectionUI();
    renderLibrary();
    renderPreviews();
    renderHome();
    toast(t('library.assignedToast'));
  });

  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  let left = r.left + r.width / 2 - pop.offsetWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - pop.offsetWidth - 8));
  let top = r.top - pop.offsetHeight - 8;
  if (top < 8) top = r.bottom + 8; // not enough room above → drop below
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  setTimeout(() => document.addEventListener('click', onDocClosePopup, true), 0);
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
function openAssignMenu(it, anchor, materializeFn) {
  closeLibPopup();
  // `it` may be null: an ephemeral folder image not yet in the pool. We add it to
  // the pool (materialize, by reference) ONLY when the user commits an action here
  // — assign / add tag / remove — never just for opening the menu. Opening it used
  // to materialize immediately, which jumped the card to the top under "newest
  // first" and left stray pool items behind after the folder was removed.
  const ensureItem = async () => {
    if (!it && materializeFn) it = await materializeFn();
    return it;
  };
  const pop = document.createElement('div');
  pop.className = 'lib-popup';
  pop.id = 'libPopup';

  appendAssignRows(pop, async (monitorId, th) => {
    const item = await ensureItem();
    if (!item) return;
    config = await window.api.libraryAssign(item.id, monitorId, th);
    closeLibPopup();
    renderLibrary();
    renderPreviews();
    renderHome();
    toast(t('library.assignedToast'));
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
  // Autocomplete dropdown of existing tags (by popularity). mousedown→preventDefault keeps the
  // input focused when a suggestion is clicked (so blur doesn't hide the list before the click).
  const suggest = document.createElement('div');
  suggest.className = 'lib-tag-suggest';
  suggest.hidden = true;
  suggest.addEventListener('mousedown', (e) => e.preventDefault());
  tagBox.appendChild(suggest);
  pop.appendChild(tagBox);

  const curTags = () => { const f = it && config.library[it.id]; return (f && f.tags) || []; };
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
        if (!it) return; // chips only exist once the item is in the pool
        config = await window.api.libraryRemoveTag(it.id, tg);
        renderChips();
        renderSuggest();
        renderLibrary();
      });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
  }

  // Tag popularity snapshot — built ONCE when the menu opens, reused for every keystroke.
  const tagFreq = libTagCounts();
  async function applyTag(raw) {
    const v = String(raw || '').trim();
    if (!v) return;
    const item = await ensureItem();
    if (!item) return;
    config = await window.api.libraryAddTag(item.id, v);
    tagInput.value = '';
    renderChips();
    renderSuggest();
    renderLibrary();
    tagInput.focus(); // stay in the field to keep picking tags
  }
  function renderSuggest() {
    const q = tagInput.value.trim().toLowerCase();
    const have = new Set(curTags());
    const list = Object.keys(tagFreq)
      .filter((tg) => !have.has(tg) && (!q || tg.includes(q)))
      .sort((a, b) => (tagFreq[b] - tagFreq[a]) || a.localeCompare(b))
      .slice(0, 40);
    suggest.innerHTML = '';
    if (!list.length) { suggest.hidden = true; return; }
    list.forEach((tg) => {
      const b = document.createElement('button');
      b.className = 'lib-tag-sug';
      const name = document.createElement('span');
      name.textContent = tg;
      const cnt = document.createElement('span');
      cnt.className = 'lib-tag-cnt';
      cnt.textContent = tagFreq[tg];
      b.append(name, cnt);
      b.addEventListener('click', (e) => { e.stopPropagation(); applyTag(tg); });
      suggest.appendChild(b);
    });
    suggest.hidden = false;
  }

  renderChips();
  tagInput.addEventListener('focus', renderSuggest);
  tagInput.addEventListener('input', renderSuggest);
  tagInput.addEventListener('blur', () => setTimeout(() => { suggest.hidden = true; }, 100));
  tagInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && tagInput.value.trim()) { e.stopPropagation(); await applyTag(tagInput.value); }
    else if (e.key === 'Escape') { suggest.hidden = true; }
  });

  const sep2 = document.createElement('div');
  sep2.className = 'lib-popup-sep';
  pop.appendChild(sep2);

  const rm = document.createElement('button');
  rm.className = 'lib-popup-btn danger';
  rm.textContent = t('library.remove');
  rm.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!it) { closeLibPopup(); return; } // ephemeral, not in the pool → nothing to remove
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
    closeLibPopup();
    clearSelection();
    syncSelectionUI();
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
  if (selAssign) selAssign.addEventListener('click', () => openMassAssignMenu(selAssign));
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
  const refreshBtn = $('#libRefresh');
  if (refreshBtn) refreshBtn.addEventListener('click', async () => {
    if (refreshBtn.classList.contains('spinning')) return;
    refreshBtn.classList.add('spinning');
    try {
      const res = await window.api.libraryRefresh();
      if (res && res.config) config = res.config;
      renderLibrary();
      renderPreviews();
      renderHome();
    } finally {
      setTimeout(() => refreshBtn.classList.remove('spinning'), 600);
    }
  });
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

  // online source selector (Cloud C2)
  const srcLumina = $('#srcLumina');
  if (srcLumina) srcLumina.addEventListener('click', () => toggleOnlineSource('lumina'));
  const srcInternet = $('#srcInternet');
  if (srcInternet) srcInternet.addEventListener('click', () => toggleOnlineSource('internet'));

  // Lumina favorites toggle (Cloud C5) — shares the unified search bar.
  const favToggle = $('#onlineFavToggle');
  if (favToggle) favToggle.addEventListener('click', toggleFavoritesView);

  // Unified online search. The wh* DOM ids are retained for compatibility.
  const whSearchBtn = $('#whSearch');
  if (whSearchBtn) whSearchBtn.addEventListener('click', () => { hideOnlineTagSuggest(); doOnlineSearch(true); });
  const whQ = $('#whQuery');
  const whSuggest = $('#whSuggest');
  if (whSuggest) whSuggest.addEventListener('mousedown', (e) => e.preventDefault());
  if (whQ) {
    whQ.addEventListener('input', scheduleOnlineTagSuggest);
    whQ.addEventListener('focus', scheduleOnlineTagSuggest);
    whQ.addEventListener('blur', () => setTimeout(hideOnlineTagSuggest, 120));
    whQ.addEventListener('keydown', (e) => {
      if (handleOnlineTagSuggestKeydown(e)) return;
      if (e.key === 'Enter') {
        hideOnlineTagSuggest();
        doOnlineSearch(true);
      }
    });
  }
  const whSortEl = $('#whSort');
  if (whSortEl) whSortEl.addEventListener('change', () => { INTERNET.sort = whSortEl.value; persistOnlineParams(); if (ONLINE.loaded) doOnlineSearch(true); });
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
      if (p === 'nsfw' && !INTERNET.nsfwAvailable) {
        cb.checked = false;
        toast(t('online.nsfwNeedsKey'));
        return;
      }
      INTERNET.purity[p] = cb.checked;
      // Don't allow unchecking the last category — keep at least one purity on.
      if (!INTERNET.purity.sfw && !INTERNET.purity.sketchy && !INTERNET.purity.nsfw) {
        cb.checked = true;
        INTERNET.purity[p] = true;
        return;
      }
      persistOnlineParams();
      if (ONLINE.loaded) doOnlineSearch(true);
    });
  });
  const whMoreBtn = $('#whMore');
  if (whMoreBtn) whMoreBtn.addEventListener('click', loadMoreOnline);

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

// ---- External online providers ----
function updatePurityToggle() {
  document.querySelectorAll('.wh-purity-cb').forEach(cb => {
    const p = cb.dataset.purity;
    cb.checked = !!INTERNET.purity[p];
    if (p === 'nsfw') {
      cb.disabled = !INTERNET.nsfwAvailable;
      const lbl = $('#lblPurityNsfw');
      if (lbl) {
        lbl.style.opacity = INTERNET.nsfwAvailable ? '1' : '0.5';
        lbl.title = INTERNET.nsfwAvailable ? '' : t('online.nsfwNeedsKey');
      }
    }
  });
}

function onlineTagToken(input) {
  if (!input) return null;
  const value = String(input.value || '');
  const caret = Number.isFinite(input.selectionStart) ? input.selectionStart : value.length;
  const pos = Math.max(0, Math.min(value.length, caret));
  let start = pos;
  while (start > 0 && !/[\s,]/.test(value[start - 1])) start -= 1;
  let end = pos;
  while (end < value.length && !/[\s,]/.test(value[end])) end += 1;
  const raw = value.slice(start, end);
  const prefix = raw
    .trim()
    .toLowerCase()
    .replace(/^[-~]+/, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_()]+/g, '');
  return { start, end, raw, prefix };
}

function onlineTagSuggestAllowed(token) {
  return !!(token
    && token.prefix.length >= INTERNET_TAG_SUGGEST_MIN_LEN
    && !token.raw.includes(':'));
}

function compactOnlineTagCount(value) {
  const n = Number(value) || 0;
  if (!n) return '';
  try {
    return new Intl.NumberFormat(document.documentElement.lang || undefined, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(n);
  } catch {
    return String(n);
  }
}

function hideOnlineTagSuggest() {
  const box = $('#whSuggest');
  const input = $('#whQuery');
  INTERNET_TAG_SUGGEST.seq += 1;
  clearTimeout(INTERNET_TAG_SUGGEST.timer);
  INTERNET_TAG_SUGGEST.items = [];
  INTERNET_TAG_SUGGEST.index = -1;
  INTERNET_TAG_SUGGEST.token = null;
  if (box) {
    box.innerHTML = '';
    box.hidden = true;
  }
  if (input) {
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
}

function setOnlineTagSuggestIndex(index) {
  const box = $('#whSuggest');
  const input = $('#whQuery');
  const items = INTERNET_TAG_SUGGEST.items;
  if (!box || !items.length) return;
  const next = ((index % items.length) + items.length) % items.length;
  INTERNET_TAG_SUGGEST.index = next;
  Array.from(box.children).forEach((el, i) => {
    const selected = i === next;
    el.classList.toggle('active', selected);
    el.setAttribute('aria-selected', selected ? 'true' : 'false');
    if (selected) {
      el.scrollIntoView({ block: 'nearest' });
      if (input) input.setAttribute('aria-activedescendant', el.id);
    }
  });
}

function renderOnlineTagSuggest(items, token) {
  const box = $('#whSuggest');
  const input = $('#whQuery');
  if (!box || !input || !items || !items.length) {
    hideOnlineTagSuggest();
    return;
  }

  INTERNET_TAG_SUGGEST.items = items;
  INTERNET_TAG_SUGGEST.token = token;
  INTERNET_TAG_SUGGEST.index = 0;
  box.innerHTML = '';
  items.forEach((item, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'online-tag-sug';
    btn.id = `whSuggestOpt${index}`;
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
    if (index === 0) btn.classList.add('active');

    const name = document.createElement('span');
    name.className = 'online-tag-name';
    name.textContent = item.name;
    const meta = document.createElement('span');
    meta.className = 'online-tag-meta';
    const count = compactOnlineTagCount(item.count);
    meta.textContent = [count, item.category].filter(Boolean).join(' · ');
    btn.append(name, meta);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      applyOnlineTagSuggestion(item);
    });
    box.appendChild(btn);
  });
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-activedescendant', 'whSuggestOpt0');
  box.hidden = false;
}

async function loadOnlineTagSuggestions(token) {
  if (!onlineTagSuggestAllowed(token)) {
    hideOnlineTagSuggest();
    return;
  }
  const key = token.prefix;
  if (INTERNET_TAG_SUGGEST.cache.has(key)) {
    renderOnlineTagSuggest(INTERNET_TAG_SUGGEST.cache.get(key), token);
    return;
  }

  const seq = ++INTERNET_TAG_SUGGEST.seq;
  let res;
  try { res = await window.api.internetTagSuggest({ q: token.prefix, limit: 10 }); }
  catch { res = { items: [] }; }
  if (seq !== INTERNET_TAG_SUGGEST.seq) return;
  const items = (res && Array.isArray(res.items)) ? res.items : [];
  INTERNET_TAG_SUGGEST.cache.set(key, items);
  renderOnlineTagSuggest(items, token);
}

function scheduleOnlineTagSuggest() {
  const input = $('#whQuery');
  const token = onlineTagToken(input);
  clearTimeout(INTERNET_TAG_SUGGEST.timer);
  if (!onlineTagSuggestAllowed(token)) {
    hideOnlineTagSuggest();
    return;
  }
  if (INTERNET_TAG_SUGGEST.cache.has(token.prefix)) {
    renderOnlineTagSuggest(INTERNET_TAG_SUGGEST.cache.get(token.prefix), token);
    return;
  }
  INTERNET_TAG_SUGGEST.timer = setTimeout(() => loadOnlineTagSuggestions(token), INTERNET_TAG_SUGGEST_DEBOUNCE_MS);
}

function applyOnlineTagSuggestion(item) {
  const input = $('#whQuery');
  const token = onlineTagToken(input);
  if (!input || !token || !item || !item.name) return;

  const value = String(input.value || '');
  const marker = token.raw.startsWith('-') || token.raw.startsWith('~') ? token.raw[0] : '';
  const before = value.slice(0, token.start);
  let after = value.slice(token.end);
  let inserted = marker + item.name;
  if (!after) inserted += ' ';
  else if (!/^[\s,]/.test(after)) after = ` ${after}`;
  input.value = before + inserted + after;
  const caret = (before + inserted).length;
  input.setSelectionRange(caret, caret);
  hideOnlineTagSuggest();
  input.focus();
}

function handleOnlineTagSuggestKeydown(e) {
  const box = $('#whSuggest');
  const open = !!(box && !box.hidden && INTERNET_TAG_SUGGEST.items.length);
  if (!open) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') scheduleOnlineTagSuggest();
    return false;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setOnlineTagSuggestIndex(INTERNET_TAG_SUGGEST.index + 1);
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    setOnlineTagSuggestIndex(INTERNET_TAG_SUGGEST.index - 1);
    return true;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const item = INTERNET_TAG_SUGGEST.items[INTERNET_TAG_SUGGEST.index] || INTERNET_TAG_SUGGEST.items[0];
    applyOnlineTagSuggestion(item);
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    hideOnlineTagSuggest();
    return true;
  }
  return false;
}

// Active online content sources (Cloud C2). Defaults to external-only and never
// returns both off, so the Online tab is never empty.
function onlineSources() {
  const s = (config && config.onlineSources) || {};
  const lumina = !!s.lumina;
  let internet = s.internet !== false;
  if (!lumina && !internet) internet = true;
  return { lumina, internet };
}

// Restore persisted Online search params (sort + purity) into INTERNET at startup.
// Sources are read live from config.onlineSources; sort/purity live in INTERNET.
function hydrateOnlineFromConfig() {
  const sort = config && config.onlineSort;
  if (['date_added', 'toplist', 'random', 'views'].includes(sort)) INTERNET.sort = sort;
  const p = config && config.onlinePurity;
  if (p && typeof p === 'object') {
    INTERNET.purity = { sfw: !!p.sfw, sketchy: !!p.sketchy, nsfw: !!p.nsfw };
    if (!INTERNET.purity.sfw && !INTERNET.purity.sketchy && !INTERNET.purity.nsfw) INTERNET.purity.sfw = true;
  }
}

// Persist the current sort + purity so they survive a restart.
function persistOnlineParams() {
  if (!config) return;
  config.onlineSort = INTERNET.sort;
  config.onlinePurity = { sfw: !!INTERNET.purity.sfw, sketchy: !!INTERNET.purity.sketchy, nsfw: !!INTERNET.purity.nsfw };
  window.api.setConfig({ onlineSort: config.onlineSort, onlinePurity: config.onlinePurity });
}

// Fetch the cloud capability once from main (safe subset: no URL/token).
async function ensureCloudCapability() {
  if (CLOUD.fetched) return;
  try { CLOUD.cap = await window.api.getCloudCapability(); }
  catch { CLOUD.cap = { environment: 'unavailable', available: false, authAvailable: false, reason: 'coming_soon' }; }
  CLOUD.fetched = true;
}

// Reflect the source selection: chip pressed-state + which panel(s) show.
function applyOnlineSourceUI(sources) {
  const lum = $('#srcLumina'), net = $('#srcInternet');
  if (lum) { lum.setAttribute('aria-pressed', sources.lumina ? 'true' : 'false'); lum.classList.toggle('active', sources.lumina); }
  if (net) { net.setAttribute('aria-pressed', sources.internet ? 'true' : 'false'); net.classList.toggle('active', sources.internet); }
  if (!sources.internet) hideOnlineTagSuggest();
}

// --- Cloud account (C4) ---
async function ensureCloudSession(force) {
  if (CLOUDAUTH.fetched && !force) return CLOUDAUTH.state;
  try { CLOUDAUTH.state = await window.api.cloudSession(); }
  catch { CLOUDAUTH.state = { available: false, signedIn: false, user: null, entitlements: [] }; }
  CLOUDAUTH.fetched = true;
  return CLOUDAUTH.state;
}

// Explicit tier is offered only to a signed-in user who has opted in (backend gate).
function explicitAllowed() {
  const s = CLOUDAUTH.state;
  return !!(s && s.signedIn && s.user && s.user.explicit_opt_in);
}

// Account strip atop the Lumina panel: sign-in button / signing-in / profile + sign-out.
function renderCloudAccount() {
  const host = $('#libCloudAccount');
  if (!host) return;
  host.hidden = false;
  host.innerHTML = '';
  const s = CLOUDAUTH.state || { signedIn: false };

  if (CLOUDAUTH.signingIn) {
    const msg = document.createElement('span');
    msg.className = 'lib-cloud-acc-msg';
    msg.textContent = t('online.signingIn');
    host.appendChild(msg);
    return;
  }

  if (s.signedIn && s.user) {
    const info = document.createElement('div');
    info.className = 'lib-cloud-acc-user';
    const name = document.createElement('strong'); name.textContent = s.user.display_name || s.user.email || '';
    const email = document.createElement('small'); email.textContent = s.user.email || '';
    info.append(name, email);
    const out = document.createElement('button');
    out.className = 'pill ghost';
    out.textContent = t('online.signOut');
    out.addEventListener('click', doCloudSignout);
    host.append(info, out);
    return;
  }

  // signed out (optionally after an expiry)
  if (s.expired) {
    const exp = document.createElement('span');
    exp.className = 'lib-cloud-acc-msg';
    exp.textContent = t('online.sessionExpired');
    host.appendChild(exp);
  }
  const btn = document.createElement('button');
  btn.className = 'pill suggested';
  btn.textContent = t('online.signIn');
  btn.addEventListener('click', doCloudSignin);
  host.appendChild(btn);
}

async function doCloudSignin() {
  if (CLOUDAUTH.signingIn) return;
  CLOUDAUTH.signingIn = true;
  renderCloudAccount();
  toast(t('online.signingIn'));
  let res;
  try { res = await window.api.cloudSignin(); } catch { res = { ok: false, error: 'signin_failed' }; }
  CLOUDAUTH.signingIn = false;
  if (res && res.ok) {
    CLOUDAUTH.state = res.state; CLOUDAUTH.fetched = true;
    renderCloudAccount();
    applyFavToggleUI();
    await ensureCloudFavorites(true); // heart states before the feed renders
    ONLINE.loaded = false;
    doOnlineSearch(true); // session may unlock the explicit tier / personalize
    toast(t('online.signedIn'));
  } else {
    renderCloudAccount();
    if (!res || res.error !== 'cancelled') toast(t('online.signinFailed'));
  }
}

async function doCloudSignout() {
  let res;
  try { res = await window.api.cloudSignout(); } catch { res = { ok: true, state: { available: true, signedIn: false } }; }
  CLOUDAUTH.state = (res && res.state) || { available: true, signedIn: false, user: null, entitlements: [] };
  CLOUDAUTH.fetched = true;
  CLOUDFAV.ids = new Set(); CLOUDFAV.fetched = false;
  ONLINE.view = 'search';
  renderCloudAccount();
  applyFavToggleUI();
  ONLINE.loaded = false;
  doOnlineSearch(true);
  toast(t('online.signedOut'));
}

// Lumina is reachable only when capability says staging/production.
function cloudAvailable() {
  const c = CLOUD.cap;
  return !!(c && c.available && (c.environment === 'staging' || c.environment === 'production'));
}

// The shared content filter (SFW/Sketchy/NSFW) maps to a Lumina rating tier;
// explicit only for a signed-in user who has opted in (backend gate).
function luminaRatingFromPurity() {
  const p = INTERNET.purity || {};
  if (p.nsfw && explicitAllowed()) return 'explicit';
  if (p.sketchy) return 'suggestive';
  return 'general';
}

// "Избранное" toggle in the search bar — only when Lumina is on and signed in.
function applyFavToggleUI() {
  const btn = $('#onlineFavToggle');
  if (!btn) return;
  const sources = onlineSources();
  const show = sources.lumina && cloudAvailable() && cloudSignedIn();
  btn.hidden = !show;
  if (!show && ONLINE.view === 'favorites') ONLINE.view = 'search';
  const isFav = ONLINE.view === 'favorites';
  btn.classList.toggle('active', isFav);
  btn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
}

function toggleFavoritesView() {
  ONLINE.view = ONLINE.view === 'favorites' ? 'search' : 'favorites';
  applyFavToggleUI();
  if (ONLINE.view === 'favorites') loadFavoritesFeed();
  else { ONLINE.loaded = false; doOnlineSearch(true); }
}

// --- Cloud favorites (C5): account-synced, distinct from the local Library "Избранное" ---
function cloudSignedIn() { const s = CLOUDAUTH.state; return !!(s && s.signedIn); }

async function ensureCloudFavorites(force) {
  if (!cloudSignedIn()) { CLOUDFAV.ids = new Set(); CLOUDFAV.fetched = false; return; }
  if (CLOUDFAV.fetched && !force) return;
  try {
    const res = await window.api.cloudFavorites();
    CLOUDFAV.ids = new Set(((res && res.items) || []).map((it) => it.id));
  } catch { CLOUDFAV.ids = new Set(); }
  CLOUDFAV.fetched = true;
}

// The account's Lumina favorites, shown in the same shared grid (a distinct mode).
async function loadFavoritesFeed() {
  if (ONLINE.loading) return;
  ONLINE.loading = true;
  const grid = $('#whGrid'); const note = $('#whNote'); const more = $('#whMore');
  if (more) more.hidden = true;
  if (grid) grid.innerHTML = '';
  if (note) note.textContent = t('online.loading');
  let res;
  try { res = await window.api.cloudFavorites(); } catch { res = { error: 'network' }; }
  ONLINE.loading = false;
  if (!res || res.error) {
    if (note) note.textContent = res && res.error === 'network' ? t('online.offline') : t('online.error', { e: (res && res.error) || '?' });
    setLibViewHeader(0);
    return;
  }
  CLOUDFAV.ids = new Set((res.items || []).map((it) => it.id)); CLOUDFAV.fetched = true;
  (res.items || []).forEach((it) => { if (grid) grid.appendChild(buildCloudCard(it)); });
  if (grid) scheduleJustifiedLayout(grid);
  const n = grid ? grid.children.length : 0;
  setLibViewHeader(n);
  if (note) note.textContent = n ? '' : t('online.favEmpty');
}

// Append a page of Lumina catalog results into the shared grid (#whGrid). The Lumina
// source is searched by the same tag and content filter as the Internet source.
async function loadLuminaResults(reset) {
  const grid = $('#whGrid');
  let res;
  try {
    res = await window.api.cloudCatalog({
      rating: luminaRatingFromPurity(),
      tag: INTERNET.q || undefined,
      cursor: reset ? null : LUMINA.cursor,
    });
  } catch { res = { error: 'network' }; }
  if (!res || res.error) { LUMINA.cursor = null; return; }
  LUMINA.cursor = res.nextCursor || null;
  (res.items || []).forEach((it) => { if (grid) grid.appendChild(buildCloudCard(it)); });
}

// Already imported? Cloud items carry a stable "lumina:<id>" source marker.
function cloudAlreadyAdded(item) {
  const marker = 'lumina:' + item.id;
  return Object.values(config.library || {}).some((it) => it.source === marker);
}

function buildCloudCard(item) {
  const card = document.createElement('div');
  card.className = 'lib-card';
  makeLibCardFocusable(card);
  setLibCardAspect(card, item.width && item.height ? item.width / item.height : 1.6);
  card.__galleryItem = galleryItemFromCloud(item);
  if (item.thumb_url) card.style.backgroundImage = `url("${item.thumb_url}")`;
  const label = [item.width && item.height ? `${item.width}×${item.height}` : '', item.title].filter(Boolean).join(' · ');
  card.title = item.title || '';
  const add = document.createElement('button');
  add.className = 'lib-menu-btn wh-add';
  const markAdded = () => { add.textContent = '✓'; add.classList.add('added'); add.disabled = true; add.title = t('online.added'); };
  if (cloudAlreadyAdded(item)) markAdded();
  else { add.textContent = '+'; add.title = t('online.add'); }
  add.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (add.disabled) return;
    add.disabled = true;
    let res;
    try { res = await window.api.cloudAdd(item); } catch { res = { error: 'download' }; }
    if (res && res.config) config = res.config;
    if (res && !res.error) { markAdded(); toast(t('online.added')); }
    else { add.disabled = false; toast(t('online.error', { e: (res && res.error) || '?' })); }
  });
  card.appendChild(add);

  // Cloud favorite heart (account-synced; signed-in only). Distinct from the local
  // Library "Избранное" (a star on local cards).
  if (cloudSignedIn()) {
    const fav = document.createElement('button');
    const setFavUi = () => {
      const on = CLOUDFAV.ids.has(item.id);
      fav.className = 'lib-menu-btn cloud-fav' + (on ? ' on' : '');
      fav.title = t(on ? 'online.favRemove' : 'online.favAdd');
    };
    fav.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 14s-5.2-3.3-6.7-6.2C.2 5.3 1.5 3 3.8 3c1.4 0 2.3.8 2.9 1.6.3.4.6.4.9 0C8.2 3.8 9.1 3 10.5 3c2.3 0 3.6 2.3 2.5 4.8C12 10.7 8 14 8 14z"/></svg>';
    setFavUi();
    fav.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (fav.disabled) return;
      const on = !CLOUDFAV.ids.has(item.id);
      fav.disabled = true;
      let res;
      try { res = await window.api.cloudFavorite(item.id, on); } catch { res = { ok: false, error: 'network' }; }
      fav.disabled = false;
      if (res && res.ok) {
        if (on) CLOUDFAV.ids.add(item.id); else CLOUDFAV.ids.delete(item.id);
        if (!on && ONLINE.view === 'favorites') {
          card.remove();
          const grid = $('#whGrid');
          const left = grid ? grid.children.length : 0;
          const note = $('#whNote');
          if (!left && note) note.textContent = t('online.favEmpty');
          setLibViewHeader(left);
          return;
        }
        setFavUi();
      } else { toast(t('online.error', { e: (res && res.error) || '?' })); }
    });
    card.appendChild(fav);
  }

  card.addEventListener('mouseenter', () => setLibStatus(label || t('online.sourceLumina')));
  card.addEventListener('click', () => openGalleryFromCard(card, card.__galleryItem));
  return card;
}

async function renderOnline() {
  await ensureCloudCapability();
  const sources = onlineSources();
  applyOnlineSourceUI(sources);
  await refreshOnlineAccount(sources);
  if (sources.internet && !INTERNET.statusFetched) {
    try { const st = await window.api.internetStatus(); INTERNET.nsfwAvailable = !!st.nsfwAvailable; }
    catch { INTERNET.nsfwAvailable = false; }
    INTERNET.statusFetched = true;
  }
  updatePurityToggle();
  const sortEl = $('#whSort'); if (sortEl && sortEl.value !== INTERNET.sort) sortEl.value = INTERNET.sort;
  if (ONLINE.view === 'favorites') { loadFavoritesFeed(); return; }
  if (!ONLINE.loaded) { doOnlineSearch(true); return; }
  const grid = $('#whGrid');
  setLibViewHeader(grid ? grid.children.length : 0);
}

// Account chip + favorites toggle reflect the session (only when Lumina is reachable).
async function refreshOnlineAccount(sources) {
  const acc = $('#libCloudAccount');
  if (!(sources.lumina && cloudAvailable())) {
    if (acc) acc.hidden = true;
    applyFavToggleUI();
    return;
  }
  await ensureCloudSession();
  renderCloudAccount();
  applyFavToggleUI();
  if (cloudSignedIn()) await ensureCloudFavorites();
}

// Toggle a content source on/off (keeps at least one on), persist, re-search.
function toggleOnlineSource(key) {
  const cur = onlineSources();
  const next = { lumina: cur.lumina, internet: cur.internet };
  next[key] = !next[key];
  if (!next.lumina && !next.internet) return; // never leave the tab empty
  config.onlineSources = next;
  window.api.setConfig({ onlineSources: next });
  ONLINE.loaded = false;
  renderOnline();
}

// Unified search: one query + content filter drives every active source into #whGrid.
async function doOnlineSearch(reset) {
  hideOnlineTagSuggest();
  if (ONLINE.loading) return;
  ONLINE.view = 'search';
  applyFavToggleUI();
  const sources = onlineSources();
  const qEl = $('#whQuery'); INTERNET.q = (qEl && qEl.value || '').trim();
  const grid = $('#whGrid'); const note = $('#whNote'); const more = $('#whMore');
  if (reset) { INTERNET.page = 1; LUMINA.cursor = null; ONLINE.loaded = true; if (grid) grid.innerHTML = ''; }
  ONLINE.loading = true; if (more) more.disabled = true;
  if (note) note.textContent = t('online.loading');

  const tasks = [];
  if (sources.internet) tasks.push(loadInternetResults());
  if (sources.lumina && cloudAvailable()) tasks.push(loadLuminaResults(reset));
  await Promise.all(tasks);

  ONLINE.loading = false; if (more) more.disabled = false;
  if (grid) scheduleJustifiedLayout(grid);
  finalizeOnlineFeed();
}

// Append one Internet page (Wallhaven + Gelbooru/Danbooru, merged in main) into #whGrid.
async function loadInternetResults() {
  const grid = $('#whGrid');
  let res;
  try { res = await window.api.internetSearch({ q: INTERNET.q, sort: INTERNET.sort, purity: INTERNET.purity, page: INTERNET.page }); }
  catch { res = { error: 'network' }; }
  INTERNET.searched = true;
  if (typeof res.nsfwAvailable !== 'undefined') { INTERNET.nsfwAvailable = !!res.nsfwAvailable; updatePurityToggle(); }
  if (res.error) { INTERNET.lastPage = INTERNET.page; return; }
  INTERNET.lastPage = (res.meta && res.meta.lastPage) || INTERNET.page;
  (res.items || []).forEach((it) => { if (grid) grid.appendChild(buildInternetCard(it)); });
}

// Note + "more" button + header for the current shared grid.
function finalizeOnlineFeed() {
  const sources = onlineSources();
  const grid = $('#whGrid'); const note = $('#whNote'); const more = $('#whMore');
  const n = grid ? grid.children.length : 0;
  setLibViewHeader(n);
  if (note) note.textContent = n ? '' : t('online.noResults');
  const hasMore = (sources.internet && INTERNET.page < INTERNET.lastPage)
    || (sources.lumina && cloudAvailable() && !!LUMINA.cursor);
  if (more) more.hidden = !hasMore;
}

// "Показать ещё" advances every active source that still has a next page.
async function loadMoreOnline() {
  if (ONLINE.loading || ONLINE.view === 'favorites') return;
  const sources = onlineSources();
  const more = $('#whMore'); if (more) more.disabled = true;
  ONLINE.loading = true;
  const tasks = [];
  if (sources.internet && INTERNET.page < INTERNET.lastPage) { INTERNET.page += 1; tasks.push(loadInternetResults()); }
  if (sources.lumina && cloudAvailable() && LUMINA.cursor) tasks.push(loadLuminaResults(false));
  await Promise.all(tasks);
  ONLINE.loading = false; if (more) more.disabled = false;
  const grid = $('#whGrid'); if (grid) scheduleJustifiedLayout(grid);
  finalizeOnlineFeed();
}

// Already in the pool? Online items carry their source page; we match on it so the
// "added ✓" survives re-searches (was only set in-session before — fixed).
function internetAlreadyAdded(item) {
  return Object.values(config.library || {}).some((it) => it.source && it.source === item.page);
}

function setInternetCardThumbnail(card, item) {
  if (!item.thumb) return;
  if (item.provider === 'wallhaven') {
    card.style.backgroundImage = `url("${item.thumb}")`;
    return;
  }
  window.api.internetThumbnail(item).then((result) => {
    if (result && result.dataUrl) card.style.backgroundImage = `url("${result.dataUrl}")`;
  }).catch(() => {});
}

function buildInternetCard(item) {
  const card = document.createElement('div');
  card.className = 'lib-card';
  card.dataset.provider = item.provider || '';
  makeLibCardFocusable(card);
  setLibCardAspect(card, item.width && item.height ? item.width / item.height : 1.6);
  card.__galleryItem = galleryItemFromInternet(item);
  setInternetCardThumbnail(card, item);
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
  if (internetAlreadyAdded(item)) markAdded();
  else { add.textContent = '+'; add.title = t('online.add'); }
  add.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (add.disabled) return;
    add.disabled = true;
    let res;
    try { res = await window.api.internetAdd(item, INTERNET.q); } catch (err) { res = { error: 'download' }; }
    if (res && res.config) config = res.config;
    if (res && !res.error) { markAdded(); toast(t('online.added')); }
    else { add.disabled = false; toast(t('online.error', { e: (res && res.error) || '?' })); }
  });
  card.appendChild(add);
  card.addEventListener('mouseenter', () => setLibStatus(label || t('online.source')));
  card.addEventListener('click', () => openGalleryFromCard(card, card.__galleryItem));
  return card;
}

// ---------------------------------------------------------------------------
// Page navigation (Home / Settings)
// ---------------------------------------------------------------------------
function showPage(name) {
  const views = { home: 'viewHome', library: 'viewLibrary', design: 'viewDesign', prefs: 'viewPrefs' };
  const target = views[name] || 'viewHome';
  const page = document.querySelector('.page');
  if (page) {
    page.classList.toggle('library-page', name === 'library');
    page.classList.toggle('home-page', name === 'home');
  }
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== target; });
  document.querySelectorAll('.navbtn').forEach((b) => {
    b.classList.toggle('active', b.dataset.page === name);
  });
  const gear = $('#btnPrefs');
  if (gear) gear.classList.toggle('active', name === 'prefs');

  if (name === 'home') {
    renderHome();
  } else if (name === 'library') {
    // Returning to a Library tab whose view + contents are unchanged reuses the
    // already-rendered grid (keeps scroll + loaded thumbnails). Rebuild only when
    // something actually changed, a live-folder refresh is pending, or it's Online.
    const grid = $('#libGrid');
    const upToDate = grid && grid.childElementCount > 0 && !pendingLibRefresh
      && LIB.filter !== 'online' && libRenderKey() === lastLibRenderKey;
    if (!upToDate) renderLibrary();
    scheduleAllLibraryLayouts();
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
  setSwitch($('#welcomeAuto'), !!(config.wallpaperSchedule && config.wallpaperSchedule.mode !== 'off'));
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
// Кнопка «Сменить обои» на Главной активна, когда есть что листать (слайдшоу включено,
// либо в плейлисте текущей темы ≥2 кадров / есть папка-источник).
function hasNextWallpaper(monitorId = null) {
  if (config.slideshow && config.slideshow.enabled) return true;
  const th = wallTheme();
  const monitorConfigs = monitorId
    ? [config.monitors && config.monitors[monitorId]]
    : Object.values(config.monitors || {});
  for (const m of monitorConfigs) {
    const slot = m && m[th];
    if (!slot || !Array.isArray(slot.itemIds)) continue;
    if (slot.itemIds.length >= 2) return true;
    for (const id of slot.itemIds) {
      const it = (config.library || {})[id];
      if (it && it.type === 'folder') return true;
    }
  }
  return false;
}

function homeMonitorNumber(monitor) {
  return monitorList.findIndex((m) => m.id === monitor.id) + 1;
}

function homePageSize() {
  const stage = $('#homeMonitors');
  const width = stage ? stage.clientWidth : window.innerWidth;
  if (width >= 510) return 3;
  if (width >= 320) return 2;
  return 1;
}

function homeMonitorPages() {
  const perPage = homePageSize();
  const ordered = [...monitorList].sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const primaryIndex = ordered.findIndex((m) => m.primary);
  if (primaryIndex >= 0) {
    const [primary] = ordered.splice(primaryIndex, 1);
    ordered.splice(Math.min(perPage >= 3 ? 1 : 0, ordered.length), 0, primary);
  }
  const pages = [];
  for (let i = 0; i < ordered.length; i += perPage) pages.push(ordered.slice(i, i + perPage));
  return pages.length ? pages : [[]];
}

function homePageLabel(monitors) {
  const numbers = monitors.map(homeMonitorNumber).filter((n) => n > 0).sort((a, b) => a - b);
  if (!numbers.length) return '';
  if (numbers.length === 1) return t('home.monitorSingle', { n: numbers[0] });
  const contiguous = numbers.every((number, index) => index === 0 || number === numbers[index - 1] + 1);
  const range = contiguous ? `${numbers[0]}–${numbers[numbers.length - 1]}` : numbers.join(', ');
  return t('home.monitorRange', { range });
}

function homeAutomationCopy() {
  const slideshow = config.slideshow || {};
  if (slideshow.enabled) {
    if (slideshow.intervalEnabled !== false) {
      return {
        title: t('home.automaticChange'),
        detail: t('home.everyMinutes', { n: Math.max(1, Math.floor(Number(slideshow.intervalMin) || 30)) }),
      };
    }
    return { title: t('home.automaticChange'), detail: t('home.eventTriggers') };
  }

  const schedule = config.wallpaperSchedule || {};
  if (config.separateThemes !== false && schedule.mode && schedule.mode !== 'off') {
    const detailKeys = { system: 'home.followWindows', time: 'home.byTime', sun: 'home.bySun' };
    return { title: t('home.automaticTheme'), detail: t(detailKeys[schedule.mode] || 'home.followWindows') };
  }
  return { title: t('home.manualChange'), detail: t('home.manualControl') };
}

function updateHomeInfo() {
  const selected = monitorList.find((m) => m.id === homeSelectedMonitorId) || null;
  const title = $('#homeInfoTitle');
  const meta = $('#homeInfoMeta');
  const nextLabel = $('#homeNextLabel');
  const nextButton = $('#btnNextWall');
  const automation = homeAutomationCopy();

  if (selected) {
    const n = homeMonitorNumber(selected);
    title.textContent = t('monitor.label', { n });
    meta.textContent = fmtResolution(selected) + (selected.primary ? ` · ${t('monitor.primary')}` : '');
    nextLabel.textContent = config.singleWallpaper ? t('home.switchAll') : t('home.switchThis');
  } else {
    title.textContent = t('home.allMonitors');
    meta.textContent = t('home.generalMode');
    nextLabel.textContent = t('home.switchAll');
  }

  $('#homeAutoTitle').textContent = automation.title;
  $('#homeAutoDetail').textContent = automation.detail;
  const targetMonitorId = selected && !config.singleWallpaper ? selected.id : null;
  nextButton.disabled = !hasNextWallpaper(targetMonitorId);
  nextButton.title = nextButton.disabled ? t('home.noNextWallpaper') : t('home.nextWallpaperHint');
}

function sizeHomeDisplays(monitors) {
  const stage = $('#homeMonitors');
  const buttons = [...stage.querySelectorAll('.home-display')];
  if (!buttons.length) return;
  const gapSize = Number.parseFloat(getComputedStyle(stage).columnGap) || 0;
  const gap = buttons.length > 1 ? gapSize * (buttons.length - 1) : 0;
  const availableWidth = Math.max(180, stage.clientWidth - gap - 4);
  const availableHeight = Math.max(120, stage.clientHeight - 16);
  const primaryHeight = Math.min(220, availableHeight * 0.92);
  const dimensions = monitors.map((m) => {
    const aspect = Math.max(0.48, Math.min(2.45, m.h ? m.w / m.h : 16 / 9));
    const height = primaryHeight * (m.primary ? 1 : 0.74);
    return { primary: !!m.primary, aspect, height, width: height * aspect };
  });

  let totalWidth = dimensions.reduce((sum, d) => sum + d.width, 0);
  if (totalWidth < availableWidth) {
    const secondary = dimensions.filter((d) => !d.primary);
    const aspectSum = secondary.reduce((sum, d) => sum + d.aspect, 0);
    const maxSecondaryHeight = primaryHeight * 0.92;
    const sharedGrowth = aspectSum > 0
      ? Math.min(maxSecondaryHeight - primaryHeight * 0.74, (availableWidth - totalWidth) / aspectSum)
      : 0;
    secondary.forEach((d) => {
      d.height += Math.max(0, sharedGrowth);
      d.width = d.height * d.aspect;
    });
    totalWidth = dimensions.reduce((sum, d) => sum + d.width, 0);
  }

  const scale = Math.min(1, availableWidth / Math.max(1, totalWidth));
  buttons.forEach((button, index) => {
    button.style.setProperty('--display-w', `${Math.max(42, Math.round(dimensions[index].width * scale))}px`);
    button.style.setProperty('--display-h', `${Math.max(58, Math.round(dimensions[index].height * scale))}px`);
  });
}

async function homeWallpaperUrl(monitor) {
  if (!monitor) return '';
  const cacheKey = `${monitor.id}|${wallTheme()}`;
  const path = await window.api.currentImage(monitor.id, wallTheme());
  const url = path ? await window.api.fileUrl(path) : '';
  homeWallpaperCache.set(cacheKey, url);
  return url;
}

function applyHomeDisplayWallpaper(wallpaper, url) {
  const empty = wallpaper.parentElement.querySelector('.home-display-empty');
  if (!url) {
    wallpaper.style.backgroundImage = '';
    wallpaper.classList.add('empty');
    if (empty) empty.hidden = false;
    return;
  }
  const css = STYLE_CSS[config.style] || STYLE_CSS.fill;
  wallpaper.style.backgroundImage = `url("${url}")`;
  wallpaper.style.backgroundSize = css.size;
  wallpaper.style.backgroundRepeat = css.repeat;
  wallpaper.style.backgroundPosition = css.position;
  wallpaper.classList.remove('empty');
  if (empty) empty.hidden = true;
}

async function loadHomeDisplayWallpaper(monitor, wallpaper, version) {
  try {
    const url = await homeWallpaperUrl(monitor);
    if (version !== homeRenderVersion || !wallpaper.isConnected) return;
    applyHomeDisplayWallpaper(wallpaper, url);
  } catch {
    if (version === homeRenderVersion && wallpaper.isConnected) applyHomeDisplayWallpaper(wallpaper, '');
  }
}

async function updateHomeBackdrop() {
  const version = ++homeBackdropVersion;
  const selected = monitorList.find((m) => m.id === homeSelectedMonitorId);
  const primary = monitorList.find((m) => m.primary) || monitorList[0];
  try {
    const url = await homeWallpaperUrl(selected || primary);
    if (version !== homeBackdropVersion) return;
    $('#homeBackdrop').style.backgroundImage = url ? `url("${url}")` : '';
  } catch {
    if (version === homeBackdropVersion) $('#homeBackdrop').style.backgroundImage = '';
  }
}

function selectHomeMonitor(monitorId) {
  homeSelectedMonitorId = monitorId;
  document.querySelectorAll('.home-display').forEach((button) => {
    const selected = button.dataset.monitorId === monitorId;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  updateHomeInfo();
  updateHomeBackdrop();
}

function renderHomePager(pages) {
  const pager = $('#homePager');
  const scene = $('#homeScene');
  pager.setAttribute('aria-label', t('home.monitorPages'));
  const lastPage = Math.max(0, pages.length - 1);
  homePage = Math.max(0, Math.min(homePage, lastPage));
  pager.innerHTML = '';
  const hasPager = pages.length > 1;
  pager.hidden = !hasPager;
  scene.classList.toggle('has-pager', hasPager);
  if (!hasPager) return;

  const left = document.createElement('div');
  left.className = 'home-pager-side';
  if (homePage > 0) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `‹ ${homePageLabel(pages[homePage - 1])}`;
    button.addEventListener('click', () => { homePage--; homeSelectedMonitorId = null; renderHome(); });
    left.appendChild(button);
  } else {
    const current = document.createElement('span');
    current.className = 'current';
    current.textContent = homePageLabel(pages[homePage]);
    left.appendChild(current);
  }

  const dots = document.createElement('div');
  dots.className = 'home-page-dots';
  pages.forEach((_, index) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'home-page-dot' + (index === homePage ? ' active' : '');
    dot.title = t('home.pageLabel', { n: index + 1 });
    dot.setAttribute('aria-label', dot.title);
    dot.addEventListener('click', () => { homePage = index; homeSelectedMonitorId = null; renderHome(); });
    dots.appendChild(dot);
  });

  const right = document.createElement('div');
  right.className = 'home-pager-side';
  if (homePage < lastPage) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${homePageLabel(pages[homePage + 1])} ›`;
    button.addEventListener('click', () => { homePage++; homeSelectedMonitorId = null; renderHome(); });
    right.appendChild(button);
  } else if (homePage > 0) {
    const current = document.createElement('span');
    current.className = 'current';
    current.textContent = homePageLabel(pages[homePage]);
    right.appendChild(current);
  }

  pager.append(left, dots, right);
}

function renderHome() {
  if (!config) return;
  const version = ++homeRenderVersion;
  const wrap = $('#homeMonitors');
  const pages = homeMonitorPages();
  const selectedPage = homeSelectedMonitorId
    ? pages.findIndex((page) => page.some((monitor) => monitor.id === homeSelectedMonitorId))
    : -1;
  homePage = selectedPage >= 0 ? selectedPage : Math.max(0, Math.min(homePage, pages.length - 1));
  const visibleMonitors = pages[homePage];
  wrap.innerHTML = '';

  if (!visibleMonitors.length) {
    wrap.innerHTML = `<div class="home-empty">${t('home.noMonitors')}</div>`;
  } else {
    visibleMonitors.forEach((monitor) => {
      const n = homeMonitorNumber(monitor);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'home-display'
        + (monitor.w < monitor.h ? ' portrait' : '')
        + (monitor.id === homeSelectedMonitorId ? ' selected' : '');
      button.dataset.monitorId = monitor.id;
      button.title = t('home.monitorDetails', { n });
      button.setAttribute('aria-pressed', monitor.id === homeSelectedMonitorId ? 'true' : 'false');
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        selectHomeMonitor(monitor.id);
      });

      const screen = document.createElement('span');
      screen.className = 'home-display-screen';
      const wallpaper = document.createElement('span');
      wallpaper.className = 'home-display-wallpaper empty';
      const empty = document.createElement('span');
      empty.className = 'home-display-empty';
      empty.textContent = t('home.noWallpaper');
      const cacheKey = `${monitor.id}|${wallTheme()}`;
      const hasCachedWallpaper = homeWallpaperCache.has(cacheKey);
      const cachedWallpaper = homeWallpaperCache.get(cacheKey) || '';
      empty.hidden = !hasCachedWallpaper || !!cachedWallpaper;
      const label = document.createElement('span');
      label.className = 'home-display-label';
      label.textContent = t('monitor.label', { n }) + (monitor.primary ? ` · ${t('monitor.primary')}` : '');
      screen.append(wallpaper, empty, label);
      if (cachedWallpaper) applyHomeDisplayWallpaper(wallpaper, cachedWallpaper);

      button.appendChild(screen);
      wrap.appendChild(button);
      loadHomeDisplayWallpaper(monitor, wallpaper, version);
    });
  }

  renderHomePager(pages);
  sizeHomeDisplays(visibleMonitors);
  updateHomeInfo();
  updateHomeBackdrop();
  renderHomeRecent();
}

const HOME_RECENT_LIMIT = 5;
let homeRecentRenderVersion = 0;

function homeRecentItems() {
  return Object.values((config && config.library) || {})
    .filter((item) => item && item.type === 'image' && item.path)
    .sort((a, b) => (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0)
      || (Number(b.modifiedAt) || 0) - (Number(a.modifiedAt) || 0)
      || baseName(a.path).localeCompare(baseName(b.path)))
    .slice(0, HOME_RECENT_LIMIT);
}

function homeRecentLabel(item) {
  const file = baseName(item.path).replace(/\.[^.]+$/, '');
  if (!/^wp-[a-f0-9]{16}$/i.test(file)) return file;
  if (item.author) return item.author;
  const tag = Array.isArray(item.tags) ? item.tags.find(Boolean) : '';
  return tag ? String(tag).replace(/_/g, ' ') : t('home.recentWallpaper');
}

function homeRecentDate(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return t('home.recentWallpaper');
  try {
    return new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
      day: 'numeric', month: 'short', year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    }).format(new Date(value));
  } catch { return t('home.recentWallpaper'); }
}

function openRecentLibrary() {
  closeLibPopup();
  clearSelection();
  LIB.filter = 'all';
  LIB.sort = 'added';
  LIB.q = '';
  exitFolderState();
  const search = $('#libSearch'); if (search) search.value = '';
  const sort = $('#libSort'); if (sort) sort.value = 'added';
  showPage('library');
  const page = document.querySelector('.page');
  if (page) page.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderHomeRecentItems(items, version) {
  const grid = $('#homeRecentGrid');
  const empty = $('#homeRecentEmpty');
  const all = $('#homeRecentAll');
  if (!grid || !empty || !all) return;
  grid.innerHTML = '';
  grid.hidden = items.length === 0;
  empty.hidden = items.length > 0;
  all.hidden = items.length === 0;

  items.forEach((item) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'home-recent-card';
    card.title = t('home.recentAssignHint');
    card.dataset.pathKey = normPathKey(item.path);

    const preview = document.createElement('span');
    preview.className = 'home-recent-preview';
    const placeholder = document.createElement('span');
    placeholder.className = 'home-recent-placeholder';
    placeholder.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m5.5 17 4-4.5 3 3 2.4-2.5 3.6 4"/><circle cx="15.5" cy="8.5" r="1.5"/></svg>';
    preview.appendChild(placeholder);

    const copy = document.createElement('span');
    copy.className = 'home-recent-copy';
    const title = document.createElement('strong');
    title.textContent = homeRecentLabel(item);
    const date = document.createElement('small');
    date.textContent = homeRecentDate(item.addedAt);
    copy.append(title, date);
    card.append(preview, copy);
    card.addEventListener('click', () => {
      // Open the assign menu on the existing card; an ephemeral folder image is
      // materialized into the pool only when the user commits an action in the menu
      // (so merely opening it no longer reorders "recently added" or leaves strays).
      if (!item.ephemeral) { openAssignMenu(item, card); return; }
      openAssignMenu(null, card, async () => {
        const res = await window.api.libraryMaterialize(item.path, 'image');
        config = (res && res.config) || config;
        return res && res.id ? config.library[res.id] : null;
      });
    });
    grid.appendChild(card);

    window.api.thumb(item.path, 360, 220).then((url) => {
      if (version !== homeRecentRenderVersion || !card.isConnected || !url) return;
      preview.style.backgroundImage = `url("${url}")`;
      preview.classList.add('loaded');
    }).catch(() => {});
  });
}

function renderHomeRecent() {
  const version = ++homeRecentRenderVersion;
  renderHomeRecentItems(homeRecentItems(), version);
  if (typeof window.api.libraryRecent !== 'function') return;
  window.api.libraryRecent(HOME_RECENT_LIMIT).then((res) => {
    if (version !== homeRecentRenderVersion) return;
    renderHomeRecentItems((res && Array.isArray(res.items)) ? res.items : homeRecentItems(), version);
  }).catch(() => {});
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
  hydrateOnlineFromConfig();
  currentTheme = await window.api.getTheme();
  currentWallpaperTheme = await window.api.getWallpaperTheme();
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
    // Blur after a mouse click so the tab doesn't keep keyboard focus — otherwise pressing a
    // modifier (e.g. Shift for range-select) would light up its focus ring out of nowhere.
    b.addEventListener('click', () => { showPage(b.dataset.page); b.blur(); });
  });
  $('#btnPrefs').addEventListener('click', (e) => { showPage('prefs'); e.currentTarget.blur(); });

  // ---- home: switch to the next wallpaper now ----
  const btnNextWall = $('#btnNextWall');
  if (btnNextWall) btnNextWall.addEventListener('click', async () => {
    btnNextWall.disabled = true;
    try {
      await window.api.nextWallpaper(config.singleWallpaper ? null : homeSelectedMonitorId);
      toast(t('toast.nextWallpaper'));
    } finally {
      setTimeout(() => { renderHome(); renderPreviews(); }, 350);
    }
  });

  const recentAll = $('#homeRecentAll');
  if (recentAll) recentAll.addEventListener('click', openRecentLibrary);
  const recentAdd = $('#homeRecentAdd');
  if (recentAdd) recentAdd.addEventListener('click', async () => {
    recentAdd.disabled = true;
    try {
      const res = await window.api.libraryAddImages();
      config = (res && res.config) || config;
      renderHome();
      if (res && res.added > 0) toast(t('toast.photosAdded', { n: res.added }));
    } finally {
      recentAdd.disabled = false;
    }
  });

  $('#homeScene').addEventListener('click', (event) => {
    if (!homeSelectedMonitorId) return;
    if (event.target !== event.currentTarget && event.target !== $('#homeMonitors')) return;
    selectHomeMonitor(null);
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
    config = await window.api.setConfig({
      wallpaperSchedule: { ...(config.wallpaperSchedule || {}), mode: on ? 'system' : 'off' }
    });
    currentWallpaperTheme = await window.api.getWallpaperTheme();
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

  // Independent wallpaper day/night trigger.
  async function saveWallpaperSchedule(announce) {
    const sch = {
      mode: $('#selWallpaperMode').value,
      lightStart: $('#wallpaperLightStart').value || '07:00',
      darkStart: $('#wallpaperDarkStart').value || '20:00',
    };
    config = await window.api.setConfig({ wallpaperSchedule: sch });
    currentWallpaperTheme = await window.api.getWallpaperTheme();
    renderWallpaperSchedule();
    applyThemeToUI(currentTheme);
    renderHome();
    if (announce) toast(t('toast.wallpaperScheduleUpdated'));
  }
  $('#selWallpaperMode').addEventListener('change', () => saveWallpaperSchedule(true));
  $('#wallpaperLightStart').addEventListener('change', () => saveWallpaperSchedule(false));
  $('#wallpaperDarkStart').addEventListener('change', () => saveWallpaperSchedule(false));

  // separate day/night wallpapers (Lumina's signature) vs. one unified wallpaper list.
  // Turning it off hides the dark slot in the UI but KEEPS its data; main re-applies
  // wallpapers from the now-active slot immediately (set-config side effect).
  $('#swSeparate').addEventListener('click', async () => {
    const on = $('#swSeparate').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swSeparate'), on);
    config = await window.api.setConfig({ separateThemes: on });
    currentWallpaperTheme = await window.api.getWallpaperTheme();
    updateSeparateThemesUI();
    applyThemeToUI(currentTheme); // re-aim the active-slot outline
    renderPreviews();
    renderHome();
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
    renderHome();
    const res = await window.api.applyNow();
    if (res.ok) toast(t('toast.styleUpdated'));
  });

  // viewer background select — live (the open viewer, if any, updates via gallery-background)
  $('#selViewerBackground').addEventListener('change', async (e) => {
    config = await window.api.setConfig({ viewerBackground: e.target.value });
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
  $('#swSlideInterval').addEventListener('click', async () => {
    const on = $('#swSlideInterval').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swSlideInterval'), on);
    config = await window.api.setSlideshow({ intervalEnabled: on });
    updateSlideshowControls();
  });

  // Slideshow event triggers (startup, wake from sleep, optional stealth delay)
  $('#swTriggerStartup').addEventListener('click', async () => {
    const on = $('#swTriggerStartup').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swTriggerStartup'), on);
    config = await window.api.setConfig({ triggers: { ...config.triggers, onStartup: on } });
    updateSlideshowControls();
  });
  $('#swTriggerWakeup').addEventListener('click', async () => {
    const on = $('#swTriggerWakeup').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swTriggerWakeup'), on);
    config = await window.api.setConfig({ triggers: { ...config.triggers, onWakeup: on } });
    updateSlideshowControls();
  });
  $('#swTriggerStealth').addEventListener('click', async () => {
    const on = $('#swTriggerStealth').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swTriggerStealth'), on);
    config = await window.api.setConfig({ triggers: { ...config.triggers, stealth: on } });
    updateSlideshowControls();
  });

  async function saveSharedCoordinates(lat, lng) {
    const sch = { ...(config.themeSchedule || {}), lat, lng };
    config = await window.api.setConfig({ themeSchedule: sch });
    renderSharedCoordinates();
  }

  // theme schedule (Lumina switches the Windows theme itself)
  async function saveThemeSchedule(announce) {
    const sch = {
      ...(config.themeSchedule || {}),
      mode: $('#selThemeMode').value,
      lightStart: $('#lightStart').value || '07:00',
      darkStart: $('#darkStart').value || '20:00',
    };
    config = await window.api.setConfig({ themeSchedule: sch });
    $('#themeTimes').hidden = (sch.mode !== 'time');
    $('#themeSun').hidden = (sch.mode !== 'sun');
    if (announce) toast(sch.mode === 'off' ? t('toast.scheduleOff') : t('toast.scheduleOn'));
  }
  $('#selThemeMode').addEventListener('change', () => saveThemeSchedule(true));
  $('#lightStart').addEventListener('change', () => saveThemeSchedule(false));
  $('#darkStart').addEventListener('change', () => saveThemeSchedule(false));
  for (const [latSel, lngSel] of [['#latInput', '#lngInput'], ['#wallpaperLatInput', '#wallpaperLngInput']]) {
    $(latSel).addEventListener('change', () => saveSharedCoordinates($(latSel).value.trim(), $(lngSel).value.trim()));
    $(lngSel).addEventListener('change', () => saveSharedCoordinates($(latSel).value.trim(), $(lngSel).value.trim()));
  }

  async function detectCoordinates(buttonSel, statusSel) {
    const btn = $(buttonSel);
    const status = $(statusSel);
    btn.disabled = true;
    status.textContent = t('theme.autoCoordsChecking') || '...';
    const res = await window.api.detectLocation();
    btn.disabled = false;
    if (res.ok) {
      await saveSharedCoordinates(String(res.lat), String(res.lng));
      const success = t('theme.autoCoordsSuccess', { city: res.city, lat: parseFloat(res.lat).toFixed(2), lng: parseFloat(res.lng).toFixed(2) });
      for (const id of ['#lblCoordsStatus', '#lblWallpaperCoordsStatus']) if ($(id)) $(id).textContent = success;
      toast(t('toast.locationUpdated'));
    } else {
      status.textContent = t('theme.autoCoordsError', { msg: res.reason });
      toast(t('toast.error', { msg: res.reason }));
    }
  }
  $('#btnDetectCoords').addEventListener('click', () => detectCoordinates('#btnDetectCoords', '#lblCoordsStatus'));
  $('#btnDetectWallpaperCoords').addEventListener('click', () => detectCoordinates('#btnDetectWallpaperCoords', '#lblWallpaperCoordsStatus'));

  // live updates from main process
  window.api.onTheme((theme) => {
    applyThemeToUI(theme);
    renderHome();
    // A hidden autostart window must not queue a stale theme toast that appears
    // when the user opens Lumina moments later. Visible theme changes still announce.
    if (!document.hidden) toast(theme === 'dark' ? t('toast.themeDark') : t('toast.themeLight'));
  });

  window.api.onWallpaperTheme((theme) => {
    currentWallpaperTheme = theme;
    applyThemeToUI(currentTheme);
    renderHome();
  });

  window.api.onConfig((cfg) => {
    const prevSig = librarySignature();
    config = cfg;
    renderConfig();
    renderHome();
    // Only rebuild the Library grid when its contents actually changed. Unrelated
    // config broadcasts (theme, schedule, viewer background, …) used to flash the
    // whole grid and drop the scroll position back to the top. While hidden, defer
    // to the next show instead of rebuilding an invisible grid.
    if (!$('#viewLibrary').hidden && LIB.filter !== 'online' && librarySignature() !== prevSig) {
      if (document.hidden) pendingLibRefresh = true;
      else renderLibrary();
    }
    window.api.getWallpaperTheme().then((theme) => {
      currentWallpaperTheme = theme;
      applyThemeToUI(currentTheme);
      renderHome();
    });
  });

  window.api.onLiveFoldersChanged(() => {
    // While the window is hidden, just remember to refresh once it is shown again
    // (a full re-render of a hidden grid would only cost work and reset scroll).
    if (document.hidden) { pendingLibRefresh = true; return; }
    if (!$('#viewHome').hidden) renderHomeRecent();
    if (!$('#viewLibrary').hidden && LIB.filter !== 'online') renderLibrary();
    else pendingLibRefresh = true; // Library on another tab → catch up when it's shown again
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    // Re-showing the window (un-minimize, viewer closed over it) must NOT rebuild
    // the grid on its own — that emptied the grid at a deep scroll position and
    // reloaded every thumbnail. Only catch up if live folders changed while hidden.
    if (!pendingLibRefresh) return;
    pendingLibRefresh = false;
    if (!$('#viewHome').hidden) renderHomeRecent();
    else if (!$('#viewLibrary').hidden && LIB.filter !== 'online') renderLibrary();
  });

  window.api.onMonitors((list) => {
    setMonitors(list);
  });

  window.api.onUpdate((st) => renderUpdate(st));

  // Cloud session changed in main (e.g. a 401 dropped an expired session) → refresh
  // the account chip + favorites toggle if the Online tab is open.
  window.api.onCloudSession((s) => {
    CLOUDAUTH.state = s; CLOUDAUTH.fetched = true;
    if (LIB.filter === 'online' && onlineSources().lumina) { renderCloudAccount(); applyFavToggleUI(); }
  });

  // keep thumbnails fitted when the window (and thus cards) resize
  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      layoutMonitors();
      scheduleAllLibraryLayouts();
      if (!$('#viewHome').hidden) renderHome();
    }, 60);
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
