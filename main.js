'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeTheme, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');

// ---------------------------------------------------------------------------
// Single instance
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

const STARTED_HIDDEN = process.argv.includes('--hidden');

let mainWindow = null;
let tray = null;
app.isQuitting = false;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

const DEFAULT_CONFIG = {
  lightWallpaper: '',
  darkWallpaper: '',
  autoSwitch: true,
  style: 'fill', // fill | fit | stretch | center | tile | span
  autostart: false,
};

let config = { ...DEFAULT_CONFIG };

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    config = { ...DEFAULT_CONFIG };
  }
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('Не удалось сохранить конфиг:', err);
  }
}

// ---------------------------------------------------------------------------
// Wallpaper setting (Windows API via PowerShell P/Invoke)
// ---------------------------------------------------------------------------
const STYLE_MAP = {
  fill: { style: 10, tile: 0 },
  fit: { style: 6, tile: 0 },
  stretch: { style: 2, tile: 0 },
  center: { style: 0, tile: 0 },
  tile: { style: 0, tile: 1 },
  span: { style: 22, tile: 0 },
};

const PS_SCRIPT_PATH = path.join(app.getPath('userData'), 'set-wallpaper.ps1');

const PS_SCRIPT = `param([string]$Path,[int]$Style,[int]$Tile)
Set-ItemProperty 'HKCU:\\Control Panel\\Desktop' -Name WallpaperStyle -Value $Style.ToString()
Set-ItemProperty 'HKCU:\\Control Panel\\Desktop' -Name TileWallpaper -Value $Tile.ToString()
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NativeWallpaper {
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
"@
# SPI_SETDESKWALLPAPER = 20, SPIF_UPDATEINIFILE | SPIF_SENDWININICHANGE = 3
[NativeWallpaper]::SystemParametersInfo(20, 0, $Path, 3) | Out-Null
`;

function ensurePsScript() {
  try {
    fs.mkdirSync(path.dirname(PS_SCRIPT_PATH), { recursive: true });
    fs.writeFileSync(PS_SCRIPT_PATH, PS_SCRIPT, 'utf8');
  } catch (err) {
    console.error('Не удалось записать PS-скрипт:', err);
  }
}

function setWallpaper(imagePath) {
  return new Promise((resolve, reject) => {
    if (!imagePath || !fs.existsSync(imagePath)) {
      return reject(new Error('Файл обоев не найден: ' + imagePath));
    }
    const map = STYLE_MAP[config.style] || STYLE_MAP.fill;
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', PS_SCRIPT_PATH,
        '-Path', imagePath,
        '-Style', String(map.style),
        '-Tile', String(map.tile),
      ],
      { windowsHide: true },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve();
      }
    );
  });
}

function currentThemeName() {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

async function applyForTheme(themeName) {
  const which = themeName || currentThemeName();
  const target = which === 'dark' ? config.darkWallpaper : config.lightWallpaper;
  if (!target) return { ok: false, reason: 'no-wallpaper', theme: which };
  try {
    await setWallpaper(target);
    return { ok: true, theme: which, path: target };
  } catch (err) {
    console.error('Ошибка смены обоев:', err);
    return { ok: false, reason: err.message, theme: which };
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
const TITLEBAR_HEIGHT = 44;

function titleBarOverlayColors() {
  const dark = nativeTheme.shouldUseDarkColors;
  return {
    color: dark ? '#303030' : '#ffffff',
    symbolColor: dark ? '#ffffff' : '#2e3436',
    height: TITLEBAR_HEIGHT,
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 940,
    height: 660,
    minWidth: 780,
    minHeight: 560,
    show: false,
    title: 'Adwaita Wallpaper',
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlayColors(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#242424' : '#fafafa',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!STARTED_HIDDEN) mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    mainWindow.once('ready-to-show', () => mainWindow.show());
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Открыть Adwaita Wallpaper', click: () => showWindow() },
    { type: 'separator' },
    {
      label: 'Применить дневные обои',
      enabled: !!config.lightWallpaper,
      click: () => applyForTheme('light'),
    },
    {
      label: 'Применить ночные обои',
      enabled: !!config.darkWallpaper,
      click: () => applyForTheme('dark'),
    },
    {
      label: 'Применить для текущей темы',
      click: () => applyForTheme(),
    },
    { type: 'separator' },
    {
      label: 'Автосмена при переключении темы',
      type: 'checkbox',
      checked: config.autoSwitch,
      click: (item) => {
        config.autoSwitch = item.checked;
        saveConfig();
        broadcastConfig();
      },
    },
    {
      label: 'Автозапуск с Windows',
      type: 'checkbox',
      checked: config.autostart,
      click: (item) => {
        setAutostart(item.checked);
        broadcastConfig();
      },
    },
    { type: 'separator' },
    { label: 'Выход', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(img);
  tray.setToolTip('Adwaita Wallpaper');
  refreshTray();
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
}

// ---------------------------------------------------------------------------
// Autostart
// ---------------------------------------------------------------------------
function setAutostart(enabled) {
  config.autostart = enabled;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: ['--hidden'],
  });
  saveConfig();
}

// ---------------------------------------------------------------------------
// Renderer communication
// ---------------------------------------------------------------------------
function broadcastConfig() {
  refreshTray();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('config-changed', config);
  }
}

function broadcastTheme() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('theme-changed', currentThemeName());
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.handle('get-config', () => config);

ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('get-theme', () => currentThemeName());

ipcMain.handle('set-config', (e, patch) => {
  config = { ...config, ...patch };
  saveConfig();
  refreshTray();
  return config;
});

ipcMain.handle('pick-image', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Выберите изображение',
    properties: ['openFile'],
    filters: [
      { name: 'Изображения', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'gif'] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('apply-now', (e, which) => applyForTheme(which));

ipcMain.handle('set-autostart', (e, v) => {
  setAutostart(v);
  return config.autostart;
});

ipcMain.handle('file-url', (e, p) => {
  try {
    return p ? pathToFileURL(p).href : '';
  } catch {
    return '';
  }
});

ipcMain.handle('quit-app', () => {
  app.isQuitting = true;
  app.quit();
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
app.on('second-instance', () => showWindow());

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // убираем стандартное меню File/Edit/View
  loadConfig();
  ensurePsScript();

  // sync autostart state with OS
  const login = app.getLoginItemSettings();
  if (login.openAtLogin !== config.autostart) {
    setAutostart(config.autostart);
  }

  createWindow();
  createTray();

  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.setTitleBarOverlay(titleBarOverlayColors()); } catch {}
    }
    broadcastTheme();
    if (config.autoSwitch) applyForTheme();
  });

  // Apply correct wallpaper on launch to sync with current theme
  if (config.autoSwitch) applyForTheme();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Keep running in tray after all windows are closed
app.on('window-all-closed', () => {
  // do nothing — app lives in the tray
});
