'use strict';

// Fallback mock so the UI can be previewed in a plain browser (outside Electron).
// In the real app window.api is always provided by preload.js, so this is skipped.
if (!window.api) {
  let mock = { lightWallpaper: '', darkWallpaper: '', autoSwitch: true, style: 'fill', autostart: false };
  window.api = {
    getConfig: async () => mock,
    setConfig: async (p) => (mock = { ...mock, ...p }),
    getVersion: async () => '1.0.0',
    getDisplays: async () => [
      { id: 1, width: 1920, height: 1080, scaleFactor: 1, isPrimary: true },
      { id: 2, width: 960, height: 1536, scaleFactor: 1, isPrimary: false },
    ],
    getTheme: async () => 'light',
    pickImage: async () => null,
    applyNow: async () => ({ ok: false, reason: 'no-wallpaper' }),
    setAutostart: async (v) => (mock.autostart = v),
    fileUrl: async (p) => p,
    quitApp: () => {},
    onTheme: () => {},
    onConfig: () => {},
    onDisplays: () => {},
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
// Rendering
// ---------------------------------------------------------------------------
// How each wallpaper "style" maps to a CSS preview, so the preview shows roughly
// how the image will actually sit on the desktop.
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

// Monitors + which one drives the preview aspect ratio.
// (Wallpapers are currently applied to all monitors equally; the map only
//  controls which monitor's shape the preview mimics. Per-monitor wallpapers
//  are a future step via the IDesktopWallpaper COM API.)
let monitorAspect = 16 / 9;
let displaysCache = [];
let selectedDisplayId = null;

function selectedDisplay() {
  return displaysCache.find((d) => d.id === selectedDisplayId) || null;
}

function applySelectedAspect() {
  const d = selectedDisplay();
  monitorAspect = d && d.height ? d.width / d.height : 16 / 9;
  layoutMonitors();
}

function setDisplays(displays) {
  displaysCache = Array.isArray(displays) && displays.length ? displays : [];
  if (!displaysCache.find((d) => d.id === selectedDisplayId)) {
    const primary = displaysCache.find((d) => d.isPrimary) || displaysCache[0];
    selectedDisplayId = primary ? primary.id : null;
  }
  applySelectedAspect();
  buildMonitorMap();
}

function updateMonLabel() {
  const el = $('#monLabel');
  if (!el) return;
  const d = selectedDisplay();
  if (!d) { el.textContent = ''; return; }
  const idx = displaysCache.findIndex((x) => x.id === d.id) + 1;
  el.textContent = `Превью для: Монитор ${idx} · ${d.width}×${d.height}` + (d.isPrimary ? ' (основной)' : '');
}

function selectDisplay(d) {
  selectedDisplayId = d.id;
  applySelectedAspect();
  document.querySelectorAll('.monchip').forEach((c) => {
    c.classList.toggle('sel', Number(c.dataset.id) === selectedDisplayId);
  });
  updateMonLabel();
}

// Build the monitor map (only shown when there is more than one monitor).
function buildMonitorMap() {
  const bar = $('#monitorBar');
  const map = $('#monMap');
  if (!bar || !map) return;
  if (displaysCache.length < 2) { bar.hidden = true; map.innerHTML = ''; return; }
  bar.hidden = false;

  const MAX_H = 92, MAX_W = 156;
  const maxH = Math.max(...displaysCache.map((d) => d.height));
  const maxW = Math.max(...displaysCache.map((d) => d.width));
  const scale = Math.min(MAX_H / maxH, MAX_W / maxW);

  map.innerHTML = '';
  displaysCache.forEach((d, i) => {
    const chip = document.createElement('button');
    chip.className = 'monchip' + (d.id === selectedDisplayId ? ' sel' : '');
    chip.dataset.id = String(d.id);
    chip.style.width = Math.max(22, Math.round(d.width * scale)) + 'px';
    chip.style.height = Math.max(22, Math.round(d.height * scale)) + 'px';
    chip.title = `Монитор ${i + 1}: ${d.width}×${d.height}` + (d.isPrimary ? ' (основной)' : '');
    chip.innerHTML = `<span class="mnum">${i + 1}</span>`;
    chip.addEventListener('click', () => selectDisplay(d));
    map.appendChild(chip);
  });
  updateMonLabel();
}

// Size each monitor thumbnail to fit ("contain") inside its fixed-size stage,
// preserving the real monitor aspect ratio for any orientation.
const STAGE_PADDING = 20; // 10px padding on each side (see .stage)
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

async function setPreview(which, filePath) {
  const el = which === 'dark' ? $('#previewDark') : $('#previewLight');
  if (filePath) {
    const url = await window.api.fileUrl(filePath);
    el.style.backgroundImage = `url("${url}")`;
    el.innerHTML = '';
  } else {
    el.style.backgroundImage = '';
    el.innerHTML = '<div class="preview-empty">Изображение не выбрано</div>';
  }
  applyPreviewStyle();
}

function applyThemeToUI(theme) {
  currentTheme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');

  const isDark = theme === 'dark';
  $('#heroIcon').textContent = isDark ? '🌙' : '☀️';
  $('#heroSub').textContent = isDark ? 'Тёмная (ночная)' : 'Светлая (дневная)';

  // highlight the active card
  document.querySelectorAll('.wallcard').forEach((c) => {
    c.style.outline = c.dataset.theme === theme ? '2px solid var(--accent)' : 'none';
    c.style.outlineOffset = '1px';
  });
}

function setSwitch(el, on) {
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

async function renderConfig() {
  await setPreview('light', config.lightWallpaper);
  await setPreview('dark', config.darkWallpaper);
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
  setDisplays(await window.api.getDisplays());
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

  // pick image
  document.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const which = btn.dataset.pick;
      const file = await window.api.pickImage(which);
      if (!file) return;
      const key = which === 'dark' ? 'darkWallpaper' : 'lightWallpaper';
      config = await window.api.setConfig({ [key]: file });
      await setPreview(which, file);
      toast(which === 'dark' ? 'Ночные обои выбраны' : 'Дневные обои выбраны');

      // if this theme is active, apply immediately
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

  // style select — applies live to the current theme's wallpaper
  $('#selStyle').addEventListener('change', async (e) => {
    config = await window.api.setConfig({ style: e.target.value });
    applyPreviewStyle(); // обновляем превью под новый режим
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

  window.api.onDisplays((displays) => {
    setDisplays(displays);
  });

  // keep thumbnails fitted when the window (and thus cards) resize
  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(layoutMonitors, 60);
  });
}

init();
