'use strict';

// Fallback mock so the UI can be previewed in a plain browser (outside Electron).
// In the real app window.api is always provided by preload.js, so this is skipped.
if (!window.api) {
  let mock = { lightWallpaper: '', darkWallpaper: '', monitors: {}, autoSwitch: true, style: 'fill', autostart: false };
  window.api = {
    getConfig: async () => mock,
    setConfig: async (p) => (mock = { ...mock, ...p }),
    getVersion: async () => '1.0.0',
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
    onTheme: () => {},
    onConfig: () => {},
    onMonitors: () => {},
  };
}

const $ = (sel) => document.querySelector(sel);

let config = null;
let currentTheme = 'light';

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
}

function fmtResolution(m) {
  let s = `${m.w}×${m.h}`;
  if (m.w < m.h) s += ' · вертикальный';
  return s;
}

function updateMonLabel() {
  const el = $('#monLabel');
  if (!el) return;
  const m = selectedMonitor();
  if (!m) { el.textContent = ''; return; }
  const idx = monitorList.findIndex((x) => x.id === m.id) + 1;
  el.textContent = `Монитор ${idx} · ${fmtResolution(m)}` + (m.primary ? ' (основной)' : '');
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
    chip.title = `Монитор ${i + 1}: ${fmtResolution(m)}` + (m.primary ? ' (основной)' : '');
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

// Wallpaper path for the selected monitor + theme (own pick, or global fallback).
function wallpaperFor(theme) {
  const mon = config.monitors && config.monitors[selectedMonitorId];
  const per = mon ? mon[theme] : '';
  const fb = theme === 'dark' ? config.darkWallpaper : config.lightWallpaper;
  return per || fb || '';
}

async function setPreview(which, filePath) {
  const el = which === 'dark' ? $('#previewDark') : $('#previewLight');
  if (filePath) {
    const url = await window.api.fileUrl(filePath);
    el.style.backgroundImage = `url("${url}")`;
    el.innerHTML = '';
  } else {
    el.style.backgroundImage = '';
    el.innerHTML = '<span class="preview-empty">Не выбрано</span>';
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
  $('#heroSub').textContent = isDark ? 'Тёмная (ночная)' : 'Светлая (дневная)';

  document.querySelectorAll('.wallcard').forEach((c) => {
    c.style.outline = c.dataset.theme === theme ? '2px solid var(--accent)' : 'none';
    c.style.outlineOffset = '1px';
  });
}

function setSwitch(el, on) {
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

async function renderConfig() {
  await renderPreviews();
  setSwitch($('#swAuto'), config.autoSwitch);
  setSwitch($('#swStartup'), config.autostart);
  $('#selStyle').value = config.style || 'fill';
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  config = await window.api.getConfig();
  currentTheme = await window.api.getTheme();
  applyThemeToUI(currentTheme);
  setMonitors(await window.api.getMonitors());
  await renderConfig();

  window.api.getVersion().then((v) => {
    $('#appVersion').textContent = 'v' + v;
  });

  // ---- title bar menu (hamburger) ----
  const menu = $('#menuPopover');
  const btnMenu = $('#btnMenu');
  function closeMenu() { menu.hidden = true; }
  function toggleMenu() { menu.hidden = !menu.hidden; }

  btnMenu.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btnMenu) closeMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  menu.querySelectorAll('.menu-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      closeMenu();
      if (action === 'apply') {
        const res = await window.api.applyNow();
        if (res.ok) toast('Обои применены');
        else if (res.reason === 'no-wallpaper') toast('Для текущей темы не выбраны обои');
        else toast('Ошибка: ' + res.reason);
      } else if (action === 'quit') {
        window.api.quitApp();
      }
    });
  });

  // pick image for the SELECTED monitor
  document.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const which = btn.dataset.pick;
      const file = await window.api.pickImage(which, selectedMonitorId);
      if (!file) return;
      config = await window.api.setMonitorWallpaper(selectedMonitorId, which, file);
      await setPreview(which, file);
      toast(which === 'dark' ? 'Ночные обои выбраны' : 'Дневные обои выбраны');

      if (which === currentTheme) {
        const res = await window.api.applyNow(which);
        if (res.ok) toast('Обои применены');
      }
    });
  });

  // switches
  $('#swAuto').addEventListener('click', async () => {
    const on = $('#swAuto').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swAuto'), on);
    config = await window.api.setConfig({ autoSwitch: on });
    toast(on ? 'Автосмена включена' : 'Автосмена выключена');
  });

  $('#swStartup').addEventListener('click', async () => {
    const on = $('#swStartup').getAttribute('aria-checked') !== 'true';
    setSwitch($('#swStartup'), on);
    await window.api.setAutostart(on);
    toast(on ? 'Автозапуск включён' : 'Автозапуск выключен');
  });

  // style select — applies live
  $('#selStyle').addEventListener('change', async (e) => {
    config = await window.api.setConfig({ style: e.target.value });
    applyPreviewStyle();
    const res = await window.api.applyNow();
    if (res.ok) toast('Расположение обновлено');
  });

  // live updates from main process
  window.api.onTheme((theme) => {
    applyThemeToUI(theme);
    toast(theme === 'dark' ? 'Windows перешёл в тёмную тему' : 'Windows перешёл в светлую тему');
  });

  window.api.onConfig((cfg) => {
    config = cfg;
    renderConfig();
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
