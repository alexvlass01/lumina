'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeTheme, dialog, shell, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');

// ---------------------------------------------------------------------------
// Squirrel.Windows install/update/uninstall events (creates/removes shortcuts,
// then quits immediately). No-op for the portable build / when not installed.
// ---------------------------------------------------------------------------
try {
  if (require('electron-squirrel-startup')) {
    app.quit();
  }
} catch { /* module absent (e.g. running from source) — ignore */ }

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
const WALLPAPERS_DIR = path.join(app.getPath('userData'), 'wallpapers');

// Short stable filename key for a monitor (device path is long & has special chars).
function monitorKey(id) {
  return crypto.createHash('md5').update(String(id)).digest('hex').slice(0, 12);
}

// Copy a chosen image into the app's own data dir so it survives app updates
// and the original file being moved/deleted. `fileKey` makes the name unique
// (e.g. per monitor + theme). Returns the stored path.
function importWallpaper(fileKey, srcPath) {
  fs.mkdirSync(WALLPAPERS_DIR, { recursive: true });
  const ext = (path.extname(srcPath) || '.img').toLowerCase();
  // drop any previous file for this slot (could have a different extension)
  try {
    for (const f of fs.readdirSync(WALLPAPERS_DIR)) {
      if (f.startsWith(fileKey + '.')) fs.rmSync(path.join(WALLPAPERS_DIR, f), { force: true });
    }
  } catch {}
  const dest = path.join(WALLPAPERS_DIR, fileKey + ext);
  fs.copyFileSync(srcPath, dest);
  return dest;
}

const DEFAULT_CONFIG = {
  lightWallpaper: '', // global fallback (used by a monitor that has no own pick)
  darkWallpaper: '',
  monitors: {}, // { [deviceId]: { light: path, dark: path } }
  autoSwitch: true,
  style: 'fill', // fill | fit | stretch | center | tile | span
  autostart: false,
  language: 'system', // 'system' | 'en' | 'ru' | 'uk'
  firstRunDone: false, // показывали ли стартовый экран приветствия
  telemetry: false, // опционально (задел): сбор анонимной статистики. Пока ничего не отправляется.
  // Lumina itself switching the Windows light/dark theme on a schedule
  // mode: 'off' | 'time' | 'sun'; lat/lng (strings) used by 'sun'
  themeSchedule: { mode: 'off', lightStart: '07:00', darkStart: '20:00', lat: '', lng: '' },
};

let config = { ...DEFAULT_CONFIG };

function loadConfig() {
  let raw = null;
  try { raw = fs.readFileSync(CONFIG_PATH, 'utf8'); } catch { raw = null; } // нет файла = первый запуск
  if (raw != null) {
    try {
      config = { ...DEFAULT_CONFIG, ...JSON.parse(raw.replace(/^﻿/, '')) }; // срезаем BOM, если есть
    } catch (err) {
      // конфиг повреждён — сохраняем копию, НЕ теряем данные молча
      try { fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.corrupt-${Date.now()}.bak`); } catch {}
      console.error('config.json повреждён, откат к дефолтам (бэкап сохранён):', err);
      config = { ...DEFAULT_CONFIG };
    }
  } else {
    config = { ...DEFAULT_CONFIG };
  }
  if (!config.monitors || typeof config.monitors !== 'object') config.monitors = {};
  config.themeSchedule = {
    mode: 'off', lightStart: '07:00', darkStart: '20:00', lat: '', lng: '',
    ...(config.themeSchedule && typeof config.themeSchedule === 'object' ? config.themeSchedule : {}),
  };
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    // атомарная запись: пишем во временный файл и переименовываем, чтобы при
    // сбое посреди записи не получить «обрезанный»/битый config.json
    const tmp = `${CONFIG_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_PATH);
  } catch (err) {
    console.error('Не удалось сохранить конфиг:', err);
  }
}

// ---------------------------------------------------------------------------
// i18n — dictionaries are the single source of truth (used by both the UI and
// the tray menu). config.language: 'system' | 'en' | 'ru' | 'uk'.
// ---------------------------------------------------------------------------
const LOCALES = {
  en: require('./locales/en.json'),
  ru: require('./locales/ru.json'),
  uk: require('./locales/uk.json'),
};
const SUPPORTED_LANGS = ['en', 'ru', 'uk'];

function tPath(obj, key) {
  return key.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj);
}
function systemLangCode() {
  const l = (app.getLocale() || 'en').toLowerCase();
  if (l.startsWith('uk')) return 'uk';
  if (l.startsWith('ru')) return 'ru';
  return 'en';
}
function effectiveLang() {
  const set = config.language || 'system';
  return SUPPORTED_LANGS.includes(set) ? set : systemLangCode();
}
function tMain(key) {
  const code = effectiveLang();
  const v = tPath(LOCALES[code] || LOCALES.en, key);
  if (v != null) return v;
  const f = tPath(LOCALES.en, key);
  return f != null ? f : key;
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

// ---------------------------------------------------------------------------
// Per-monitor wallpaper via IDesktopWallpaper COM (PowerShell + Add-Type)
// ---------------------------------------------------------------------------
const COM_SCRIPT_PATH = path.join(app.getPath('userData'), 'wallpaper-com.ps1');
const APPLY_DATA_PATH = path.join(app.getPath('userData'), 'apply.json');

// our style names -> DESKTOP_WALLPAPER_POSITION
const COM_POS = { center: 0, tile: 1, stretch: 2, fit: 3, fill: 4, span: 5 };

const COM_SCRIPT = `param([string]$Mode='enum',[string]$DataFile='')
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)]
public struct DW_RECT { public int Left, Top, Right, Bottom; }
[ComImport, Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDesktopWallpaper {
  void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID, [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
  [return: MarshalAs(UnmanagedType.LPWStr)] string GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID);
  [return: MarshalAs(UnmanagedType.LPWStr)] string GetMonitorDevicePathAt(uint monitorIndex);
  uint GetMonitorDevicePathCount();
  DW_RECT GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitorID);
  void SetBackgroundColor(uint color);
  uint GetBackgroundColor();
  void SetPosition(int position);
}
public static class DW {
  static IDesktopWallpaper _i;
  static IDesktopWallpaper I { get { if(_i==null){ _i=(IDesktopWallpaper)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("C2CF3110-460E-4fc1-B9D0-8A1C0C9CC4BD"))); } return _i; } }
  public static uint Count(){ return I.GetMonitorDevicePathCount(); }
  public static string PathAt(uint i){ return I.GetMonitorDevicePathAt(i); }
  public static int[] Rect(string id){ var r=I.GetMonitorRECT(id); return new int[]{r.Left,r.Top,r.Right,r.Bottom}; }
  public static void SetPosition(int p){ I.SetPosition(p); }
  public static void SetWallpaper(string id,string p){ I.SetWallpaper(id,p); }
}
"@
if ($Mode -eq 'enum') {
  $list = New-Object System.Collections.ArrayList
  $n = [DW]::Count()
  for ($i=0; $i -lt $n; $i++) {
    $id = [DW]::PathAt([uint32]$i)
    try { $r = [DW]::Rect($id) } catch { continue }
    [void]$list.Add([pscustomobject]@{ id=$id; x=$r[0]; y=$r[1]; w=($r[2]-$r[0]); h=($r[3]-$r[1]) })
  }
  ConvertTo-Json -InputObject @($list) -Compress
} elseif ($Mode -eq 'apply') {
  $data = Get-Content -LiteralPath $DataFile -Raw | ConvertFrom-Json
  [DW]::SetPosition([int]$data.position)
  foreach ($it in $data.items) { [DW]::SetWallpaper([string]$it.id, [string]$it.path) }
}
`;

function ensureComScript() {
  try {
    fs.mkdirSync(path.dirname(COM_SCRIPT_PATH), { recursive: true });
    fs.writeFileSync(COM_SCRIPT_PATH, COM_SCRIPT, 'utf8');
  } catch (err) {
    console.error('Не удалось записать COM-скрипт:', err);
  }
}

function runCom(args) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', COM_SCRIPT_PATH, ...args],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(stdout);
      }
    );
  });
}

let monitorsCache = [];

async function getMonitors() {
  try {
    const out = await runCom(['-Mode', 'enum']);
    let parsed = JSON.parse((out || '').trim() || '[]');
    if (!Array.isArray(parsed)) parsed = [parsed];
    monitorsCache = parsed.map((m) => ({
      id: m.id,
      x: m.x, y: m.y, w: m.w, h: m.h,
      primary: m.x === 0 && m.y === 0,
    }));
  } catch (err) {
    console.error('Не удалось перечислить мониторы (COM):', err);
    monitorsCache = [];
  }
  return monitorsCache;
}

// ---------------------------------------------------------------------------
// Theme schedule — Lumina itself switches the Windows light/dark theme by time.
// ---------------------------------------------------------------------------
const THEME_SCRIPT_PATH = path.join(app.getPath('userData'), 'set-theme.ps1');

const THEME_SCRIPT = `param([int]$Light)
$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'
Set-ItemProperty -Path $p -Name AppsUseLightTheme -Value $Light -Type Dword -ErrorAction SilentlyContinue
Set-ItemProperty -Path $p -Name SystemUsesLightTheme -Value $Light -Type Dword -ErrorAction SilentlyContinue
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ThemeBcast {
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam, uint flags, uint timeout, out IntPtr result);
}
"@
$r=[IntPtr]::Zero
# HWND_BROADCAST=0xffff, WM_SETTINGCHANGE=0x1A, SMTO_ABORTIFHUNG=2
[ThemeBcast]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [IntPtr]::Zero, "ImmersiveColorSet", 2, 200, [ref]$r) | Out-Null
`;

function ensureThemeScript() {
  try {
    fs.mkdirSync(path.dirname(THEME_SCRIPT_PATH), { recursive: true });
    fs.writeFileSync(THEME_SCRIPT_PATH, THEME_SCRIPT, 'utf8');
  } catch (err) {
    console.error('Не удалось записать theme-скрипт:', err);
  }
}

function setWindowsTheme(isDark) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', THEME_SCRIPT_PATH, '-Light', isDark ? '0' : '1'],
      { windowsHide: true },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve();
      }
    );
  });
}

let themeTimer = null;

function parseHM(s) {
  const [h, m] = String(s || '').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

// Sunrise/sunset in UTC hours for a date + coordinates (classic sunrise equation).
function sunUT(date, lat, lng) {
  const D2R = Math.PI / 180, R2D = 180 / Math.PI, zenith = 90.833;
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 0);
  const N = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - yearStart) / 86400000);
  function calc(rise) {
    const lngHour = lng / 15;
    const t = N + ((rise ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    let L = M + 1.916 * Math.sin(M * D2R) + 0.020 * Math.sin(2 * M * D2R) + 282.634;
    L = (L % 360 + 360) % 360;
    let RA = R2D * Math.atan(0.91764 * Math.tan(L * D2R));
    RA = (RA % 360 + 360) % 360;
    RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
    RA /= 15;
    const sinDec = 0.39782 * Math.sin(L * D2R);
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(zenith * D2R) - sinDec * Math.sin(lat * D2R)) / (cosDec * Math.cos(lat * D2R));
    if (cosH > 1 || cosH < -1) return null; // polar day / night
    let H = rise ? 360 - R2D * Math.acos(cosH) : R2D * Math.acos(cosH);
    H /= 15;
    const UT = (H + RA - 0.06571 * t - 6.622 - lngHour) % 24;
    return (UT + 24) % 24;
  }
  return { sunrise: calc(true), sunset: calc(false) };
}

// Light/dark boundaries as minutes after LOCAL midnight, or null if unknown.
function scheduleBoundaries(date) {
  const sch = config.themeSchedule || {};
  if (sch.mode === 'sun') {
    const lat = parseFloat(sch.lat);
    const lng = parseFloat(sch.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const { sunrise, sunset } = sunUT(date, lat, lng);
    if (sunrise == null || sunset == null) return null;
    const tz = date.getTimezoneOffset(); // local = UTC - tz
    const toMin = (ut) => ((Math.round(ut * 60 - tz)) % 1440 + 1440) % 1440;
    return { lightMin: toMin(sunrise), darkMin: toMin(sunset) };
  }
  return { lightMin: parseHM(sch.lightStart || '07:00'), darkMin: parseHM(sch.darkStart || '20:00') };
}

function boundariesSayDark(b, date) {
  const now = date.getHours() * 60 + date.getMinutes();
  const ls = b.lightMin, ds = b.darkMin;
  let isLight;
  if (ls === ds) isLight = true;
  else if (ls < ds) isLight = now >= ls && now < ds;
  else isLight = now >= ls || now < ds; // light period wraps midnight
  return !isLight;
}

function clearThemeTimer() {
  if (themeTimer) { clearTimeout(themeTimer); themeTimer = null; }
}

// Apply the scheduled theme now (modes: time / sun) and schedule the next flip.
function applyThemeSchedule() {
  clearThemeTimer();
  const sch = config.themeSchedule || {};
  if (sch.mode !== 'time' && sch.mode !== 'sun') return; // 'off' — Lumina does not drive the theme
  const now = new Date();
  const b = scheduleBoundaries(now);
  if (!b) { themeTimer = setTimeout(applyThemeSchedule, 60 * 60000); return; } // no coords / polar — retry in 1h
  const wantDark = boundariesSayDark(b, now);
  if (wantDark !== nativeTheme.shouldUseDarkColors) {
    setWindowsTheme(wantDark).catch((e) => console.error('Не удалось сменить тему Windows:', e));
  }
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const minsUntil = [b.lightMin, b.darkMin].map((x) => { let d = x - nowMin; if (d <= 0) d += 1440; return d; });
  const mins = Math.max(1, Math.min(...minsUntil));
  themeTimer = setTimeout(applyThemeSchedule, mins * 60000 + 3000);
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

// Wallpaper path for a given monitor + theme: the monitor's own pick, or the
// global fallback if it has none.
function wallpaperFor(monitorId, theme) {
  const m = config.monitors && config.monitors[monitorId];
  const per = m ? m[theme] : '';
  const fallback = theme === 'dark' ? config.darkWallpaper : config.lightWallpaper;
  return per || fallback || '';
}

async function applyForTheme(themeName) {
  const theme = themeName || currentThemeName();
  const monitors = monitorsCache.length ? monitorsCache : await getMonitors();

  // Preferred path: per-monitor via COM
  if (monitors.length) {
    const items = [];
    for (const m of monitors) {
      const p = wallpaperFor(m.id, theme);
      if (p && fs.existsSync(p)) items.push({ id: m.id, path: p });
    }
    if (!items.length) return { ok: false, reason: 'no-wallpaper', theme };
    try {
      const pos = COM_POS[config.style] != null ? COM_POS[config.style] : 4;
      fs.writeFileSync(APPLY_DATA_PATH, JSON.stringify({ position: pos, items }), 'utf8');
      await runCom(['-Mode', 'apply', '-DataFile', APPLY_DATA_PATH]);
      return { ok: true, theme };
    } catch (err) {
      console.error('Ошибка применения per-monitor (COM), пробую legacy:', err);
      // fall through to legacy
    }
  }

  // Fallback: single wallpaper for all monitors (older Windows / COM failure)
  const target = theme === 'dark' ? config.darkWallpaper : config.lightWallpaper;
  if (target && fs.existsSync(target)) {
    try {
      await setWallpaper(target);
      return { ok: true, theme, path: target };
    } catch (err) {
      console.error('Ошибка смены обоев:', err);
      return { ok: false, reason: err.message, theme };
    }
  }
  return { ok: false, reason: 'no-wallpaper', theme };
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
    title: 'Lumina',
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

function bringToFront(win) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  // Windows often suppresses focus from a background process; this flicker
  // reliably pulls the window to the foreground.
  win.setAlwaysOnTop(true);
  win.setAlwaysOnTop(false);
  win.moveTop();
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    mainWindow.once('ready-to-show', () => bringToFront(mainWindow));
    return;
  }
  bringToFront(mainWindow);
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: tMain('tray.open'), click: () => showWindow() },
    { label: tMain('tray.applyCurrent'), click: () => applyForTheme() },
    { type: 'separator' },
    { label: tMain('tray.quit'), click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(img);
  tray.setToolTip('Lumina');
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

ipcMain.handle('get-i18n', () => {
  const code = effectiveLang();
  return {
    setting: config.language || 'system',
    system: systemLangCode(),
    locale: code,
    dict: LOCALES[code] || LOCALES.en,
    fallback: LOCALES.en,
  };
});

ipcMain.handle('get-monitors', () => getMonitors());

ipcMain.handle('get-theme', () => currentThemeName());

ipcMain.handle('set-config', (e, patch) => {
  config = { ...config, ...patch };
  saveConfig();
  refreshTray();
  if (patch && 'themeSchedule' in patch) applyThemeSchedule();
  return config;
});

ipcMain.handle('pick-image', async (e, which, monitorId) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Выберите изображение',
    properties: ['openFile'],
    filters: [
      { name: 'Изображения', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'gif'] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return null;
  const theme = which === 'dark' ? 'dark' : 'light';
  const key = monitorId ? `${monitorKey(monitorId)}-${theme}` : theme;
  try {
    return importWallpaper(key, res.filePaths[0]);
  } catch (err) {
    console.error('Не удалось импортировать обои:', err);
    return res.filePaths[0]; // запасной вариант — исходный путь
  }
});

ipcMain.handle('set-monitor-wallpaper', (e, monitorId, which, p) => {
  const theme = which === 'dark' ? 'dark' : 'light';
  if (!monitorId) {
    // no monitor context → store as global fallback
    config[theme === 'dark' ? 'darkWallpaper' : 'lightWallpaper'] = p || '';
  } else {
    if (!config.monitors) config.monitors = {};
    if (!config.monitors[monitorId]) config.monitors[monitorId] = { light: '', dark: '' };
    config.monitors[monitorId][theme] = p || '';
  }
  saveConfig();
  refreshTray();
  return config;
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

ipcMain.handle('shortcuts-status', () => ({
  desktop: fs.existsSync(path.join(app.getPath('desktop'), 'Lumina.lnk')),
  startmenu: fs.existsSync(path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Lumina.lnk')),
}));

ipcMain.handle('create-shortcuts', (e, which) => {
  const target = process.execPath;
  const done = [];
  const make = (lnkPath, label) => {
    try {
      if (fs.existsSync(lnkPath)) fs.rmSync(lnkPath, { force: true });
      const ok = shell.writeShortcutLink(lnkPath, {
        target,
        cwd: path.dirname(target),
        icon: target,
        iconIndex: 0,
        description: 'Lumina',
      });
      if (ok) done.push(label);
    } catch (err) {
      console.error('Не удалось создать ярлык:', label, err);
    }
  };
  if (which === 'desktop' || which === 'both' || !which) {
    make(path.join(app.getPath('desktop'), 'Lumina.lnk'), 'desktop');
  }
  if (which === 'startmenu' || which === 'both' || !which) {
    make(path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Lumina.lnk'), 'startmenu');
  }
  return done;
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
app.on('second-instance', () => showWindow());

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); // убираем стандартное меню File/Edit/View
  loadConfig();
  ensurePsScript();
  ensureComScript();
  ensureThemeScript();

  // sync autostart state with OS
  const login = app.getLoginItemSettings();
  if (login.openAtLogin !== config.autostart) {
    setAutostart(config.autostart);
  }

  createWindow();
  createTray();

  // refresh monitor list when displays change (added/removed/resolution/rotation)
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(ev, async () => {
      const mons = await getMonitors();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('monitors-changed', mons);
      }
    });
  }

  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.setTitleBarOverlay(titleBarOverlayColors()); } catch {}
    }
    broadcastTheme();
    if (config.autoSwitch) applyForTheme();
  });

  // enumerate monitors, then apply correct wallpaper on launch
  await getMonitors();
  if (config.autoSwitch) applyForTheme();

  // start theme schedule (if enabled): set the right theme now + schedule flips
  applyThemeSchedule();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Keep running in tray after all windows are closed
app.on('window-all-closed', () => {
  // do nothing — app lives in the tray
});
