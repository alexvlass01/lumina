'use strict';

// Fallback mock so the UI can be previewed in a plain browser (outside Electron).
// In the real app window.api is always provided by preload.js, so this is skipped.
if (!window.api) {
  let mock = { lightWallpaper: '', darkWallpaper: '', monitors: {}, autoSwitch: true, style: 'fill', autostart: false, language: 'system', themeSchedule: { mode: 'off', lightStart: '07:00', darkStart: '20:00', lat: '', lng: '' } };
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
    pickImage: async () => null,
    setMonitorWallpaper: async (id, which, path) => {
      if (!mock.monitors[id]) mock.monitors[id] = { light: '', dark: '' };
      mock.monitors[id][which === 'dark' ? 'dark' : 'light'] = path;
      return mock;
    },
    applyNow: async () => ({ ok: false, reason: 'no-wallpaper' }),
    setAutostart: async (v) => (mock.autostart = v),
    fileUrl: async (p) => p,
    quitApp: () => {},
    createShortcuts: async (which) => {
      if (which === 'desktop' || which === 'both' || !which) mockSc.desktop = true;
      if (which === 'startmenu' || which === 'both' || !which) mockSc.startmenu = true;
      return ['ok'];
    },
    shortcutsStatus: async () => ({ ...mockSc }),
    onTheme: () => {},
    onConfig: () => {},
    onMonitors: () => {},
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
  applyI18n();
  applyThemeToUI(currentTheme); // hero subtitle
  buildMonitorMap();            // chip titles + label
  renderPreviews();             // "not selected" placeholders
  renderHome();                 // status values + thumbnail labels
  updateShortcutButtons();      // re-translate shortcut buttons + keep "done" state
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
  if (monitorList.length < 2) { bar.hidden = true; map.innerHTML = ''; updateMonLabel(); return; }
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

// Wallpaper path for a monitor + theme (own pick, or global fallback).
function wallpaperForMonitor(id, theme) {
  const mon = config.monitors && config.monitors[id];
  const per = mon ? mon[theme] : '';
  const fb = theme === 'dark' ? config.darkWallpaper : config.lightWallpaper;
  return per || fb || '';
}

// Wallpaper for the currently selected monitor (used by the settings previews).
function wallpaperFor(theme) {
  return wallpaperForMonitor(selectedMonitorId, theme);
}

async function setPreview(which, filePath) {
  const el = which === 'dark' ? $('#previewDark') : $('#previewLight');
  if (filePath) {
    const url = await window.api.fileUrl(filePath);
    // cache-bust: stored file may reuse the same name (monitor+theme+ext) → same
    // file:// URL would show a stale cached image. ?v= forces a fresh load.
    el.style.backgroundImage = `url("${url}?v=${Date.now()}")`;
    el.innerHTML = '';
  } else {
    el.style.backgroundImage = '';
    el.innerHTML = `<span class="preview-empty">${t('design.notSelected')}</span>`;
  }
  applyPreviewStyle();
}

async function renderPreviews() {
  if (!config) return;
  await setPreview('light', wallpaperFor('light'));
  await setPreview('dark', wallpaperFor('dark'));
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

async function renderConfig() {
  await renderPreviews();
  setSwitch($('#swAuto'), config.autoSwitch);
  setSwitch($('#swStartup'), config.autostart);
  setSwitch($('#swTelemetry'), !!config.telemetry);
  $('#selStyle').value = config.style || 'fill';
  renderThemeSchedule();
}

// ---------------------------------------------------------------------------
// Page navigation (Home / Settings)
// ---------------------------------------------------------------------------
function showPage(name) {
  const views = { home: 'viewHome', design: 'viewDesign', prefs: 'viewPrefs' };
  const target = views[name] || 'viewHome';
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== target; });
  document.querySelectorAll('.navbtn').forEach((b) => {
    b.classList.toggle('active', b.dataset.page === name);
  });
  const gear = $('#btnPrefs');
  if (gear) gear.classList.toggle('active', name === 'prefs');

  if (name === 'home') {
    renderHome();
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
    wrap.innerHTML = '';
    if (!monitorList.length) {
      wrap.innerHTML = `<div class="home-empty">${t('home.noMonitors')}</div>`;
    } else {
      monitorList.forEach((m, i) => {
        const ar = m.h ? m.w / m.h : 16 / 9;
        const cell = document.createElement('div');
        cell.className = 'home-mon';
        const thumb = document.createElement('div');
        thumb.className = 'home-thumb';
        thumb.style.height = HOME_THUMB_H + 'px';
        thumb.style.width = Math.round(HOME_THUMB_H * ar) + 'px';
        const wp = wallpaperForMonitor(m.id, currentTheme);
        if (wp) {
          thumb.textContent = '';
          window.api.fileUrl(wp).then((u) => { thumb.style.backgroundImage = `url("${u}?v=${Date.now()}")`; });
        } else {
          thumb.classList.add('empty');
          thumb.textContent = t('home.noWallpaper');
        }
        const lbl = document.createElement('div');
        lbl.className = 'home-mon-label';
        lbl.textContent = t('monitor.label', { n: i + 1 }) + (m.primary ? ' ★' : '');
        cell.appendChild(thumb);
        cell.appendChild(lbl);
        wrap.appendChild(cell);
      });
    }
  }
  const a = $('#stAuto'); if (a) a.textContent = config.autoSwitch ? t('val.on') : t('val.off');
  const s = $('#stStartup'); if (s) s.textContent = config.autostart ? t('val.on') : t('val.off');
  const mc = $('#stMonitors'); if (mc) mc.textContent = String(monitorList.length);
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

  // ---- settings: usage statistics (opt-in placeholder) ----
  $('#swTelemetry').addEventListener('click', async () => {
    const on = $('#swTelemetry').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swTelemetry'), on);
    config = await window.api.setConfig({ telemetry: on });
  });

  // ---- settings: re-open the welcome screen ----
  $('#btnShowWelcome').addEventListener('click', () => enterFirstRun());

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

  // pick image for the SELECTED monitor
  document.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const which = btn.dataset.pick;
      const file = await window.api.pickImage(which, selectedMonitorId);
      if (!file) return;
      config = await window.api.setMonitorWallpaper(selectedMonitorId, which, file);
      await setPreview(which, file);
      renderHome();
      toast(which === 'dark' ? t('toast.darkChosen') : t('toast.lightChosen'));

      if (which === currentTheme) {
        const res = await window.api.applyNow(which);
        if (res.ok) toast(t('toast.applied'));
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

  $('#swStartup').addEventListener('click', async () => {
    const on = $('#swStartup').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swStartup'), on);
    await window.api.setAutostart(on);
    renderHome();
    toast(on ? t('toast.startupOn') : t('toast.startupOff'));
  });

  // style select — applies live
  $('#selStyle').addEventListener('change', async (e) => {
    config = await window.api.setConfig({ style: e.target.value });
    applyPreviewStyle();
    const res = await window.api.applyNow();
    if (res.ok) toast(t('toast.styleUpdated'));
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
  });

  window.api.onMonitors((list) => {
    setMonitors(list);
  });

  // keep thumbnails fitted when the window (and thus cards) resize
  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(layoutMonitors, 60);
  });
}

init();
