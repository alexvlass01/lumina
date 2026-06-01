'use strict';

// Fallback mock so the UI can be previewed in a plain browser (outside Electron).
// In the real app window.api is always provided by preload.js, so this is skipped.
if (!window.api) {
  let mock = { lightWallpaper: '', darkWallpaper: '', autoSwitch: true, style: 'fill', autostart: false };
  window.api = {
    getConfig: async () => mock,
    setConfig: async (p) => (mock = { ...mock, ...p }),
    getVersion: async () => '1.0.0',
    getTheme: async () => 'light',
    pickImage: async () => null,
    applyNow: async () => ({ ok: false, reason: 'no-wallpaper' }),
    setAutostart: async (v) => (mock.autostart = v),
    fileUrl: async (p) => p,
    quitApp: () => {},
    onTheme: () => {},
    onConfig: () => {},
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
}

init();
