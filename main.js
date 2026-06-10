'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeTheme, dialog, shell, nativeImage, screen, autoUpdater, globalShortcut, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const playlist = require('./src/playlist'); // чистая логика плейлистов (тестируется отдельно)
const library = require('./src/library'); // пул контента { [id]: Item }; слоты ссылаются по id
const wallhaven = require('./src/wallhaven'); // клиент Wallhaven (онлайн-обои): URL + разбор
const { WallpaperHost, HOST_SCRIPT } = require('./src/wallpaper-host'); // живой PowerShell-COM-хост
const configMod = require('./src/config'); // дефолты + load/migrate/save (тестируется отдельно)
const { createTrayController } = require('./src/tray'); // системный трей (меню + иконка)
const schedule = require('./src/schedule'); // чистая математика расписаний день/ночь (время/солнце)

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
const START_TS = Date.now();

let mainWindow = null;
app.isQuitting = false;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const WALLPAPERS_DIR = path.join(app.getPath('userData'), 'wallpapers');

// Copy a chosen image into the app's own data dir so it survives app updates and
// the original being moved/deleted. Content-addressed name (wp-<md5>) → identical
// images dedupe automatically and re-adding the same file is a no-op. Returns path.
async function importWallpaper(srcPath) {
  await fs.promises.mkdir(WALLPAPERS_DIR, { recursive: true });
  const buf = await fs.promises.readFile(srcPath); // async: не блокируем main-поток на больших файлах
  const hash = crypto.createHash('md5').update(buf).digest('hex').slice(0, 16);
  const ext = (path.extname(srcPath) || '.img').toLowerCase();
  const dest = path.join(WALLPAPERS_DIR, `wp-${hash}${ext}`);
  if (!fs.existsSync(dest)) await fs.promises.writeFile(dest, buf);
  return dest;
}

// Download a remote image into the app's data dir (content-addressed, like importWallpaper).
async function downloadWallpaperFromUrl(url) {
  await fs.promises.mkdir(WALLPAPERS_DIR, { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = crypto.createHash('md5').update(buf).digest('hex').slice(0, 16);
  let ext = '.jpg';
  try { const e = path.extname(new URL(url).pathname).toLowerCase(); if (/^\.[a-z0-9]{2,5}$/.test(e)) ext = e; } catch {}
  const dest = path.join(WALLPAPERS_DIR, `wp-${hash}${ext}`);
  if (!fs.existsSync(dest)) await fs.promises.writeFile(dest, buf);
  return dest;
}

// Bundled Wallhaven API key — official builds only. It lives in a gitignored file
// (wallhaven-key.json) so it's never in the public repo; absent for self-builds, where
// the app simply stays keyless (SFW+sketchy still work, NSFW needs the bundled key).
function loadBundledWallhavenKey() {
  try {
    const k = require('./wallhaven-key.json');
    return k && typeof k.apikey === 'string' ? k.apikey.trim() : '';
  } catch { return ''; }
}
const BUNDLED_WALLHAVEN_KEY = loadBundledWallhavenKey();
// Effective key: the bundled one (official builds only). Users can't enter their own —
// the Wallhaven key is internal-only by design.
function wallhavenKey() {
  return BUNDLED_WALLHAVEN_KEY || '';
}

// Дефолты + load/migrate/save вынесены в ./src/config.js (тестируется: test/config.test.js).
let config = configMod.freshDefaults();

function loadConfig() {
  config = configMod.load(CONFIG_PATH);
}

function saveConfig() {
  configMod.save(config, CONFIG_PATH);
  broadcastConfig();
}

// ---------------------------------------------------------------------------
// i18n — dictionaries are the single source of truth (used by both the UI and
// the tray menu). config.language: 'system' | 'en' | 'ru' | 'uk'.
// ---------------------------------------------------------------------------
const LOCALES = {
  en: require('./locales/en.json'),
  ru: require('./locales/ru.json'),
  uk: require('./locales/uk.json'),
  de: require('./locales/de.json'),
  es: require('./locales/es.json'),
  fr: require('./locales/fr.json'),
  it: require('./locales/it.json'),
  pt: require('./locales/pt.json'),
  pl: require('./locales/pl.json'),
  tr: require('./locales/tr.json'),
  nl: require('./locales/nl.json'),
  zh: require('./locales/zh.json'),
  ja: require('./locales/ja.json'),
  ko: require('./locales/ko.json'),
  ar: require('./locales/ar.json'),
  vi: require('./locales/vi.json'),
  hi: require('./locales/hi.json'),
  id: require('./locales/id.json'),
  sv: require('./locales/sv.json'),
  no: require('./locales/no.json'),
  da: require('./locales/da.json'),
  fi: require('./locales/fi.json'),
  cs: require('./locales/cs.json'),
  hu: require('./locales/hu.json'),
  ro: require('./locales/ro.json'),
  sk: require('./locales/sk.json'),
  bg: require('./locales/bg.json'),
  el: require('./locales/el.json'),
  he: require('./locales/he.json'),
  th: require('./locales/th.json'),
};
const SUPPORTED_LANGS = [
  'en', 'ru', 'uk', 'de', 'es', 'fr', 'it', 'pt', 'pl', 'tr', 'nl',
  'zh', 'ja', 'ko', 'ar', 'vi', 'hi', 'id', 'sv', 'no', 'da',
  'fi', 'cs', 'hu', 'ro', 'sk', 'bg', 'el', 'he', 'th'
];

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

  [DllImport("shell32.dll")]
  public static extern int SHQueryUserNotificationState(out int pqunsState);
  public static bool IsUserBusy() {
    int state;
    int hr = SHQueryUserNotificationState(out state);
    if (hr == 0) {
      return (state == 2 || state == 3 || state == 4 || state == 6);
    }
    return false;
  }
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
  $data = Get-Content -LiteralPath $DataFile -Raw -Encoding utf8 | ConvertFrom-Json
  [DW]::SetPosition([int]$data.position)
  foreach ($it in $data.items) { [DW]::SetWallpaper([string]$it.id, [string]$it.path) }
} elseif ($Mode -eq 'check-fullscreen') {
  [DW]::IsUserBusy()
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

// Живой PowerShell-хост: компилирует COM один раз, дальше применяет обои мгновенно
// (~1 мс вместо ~400 мс на spawn+Add-Type). Быстрый путь; при сбое — фоллбек на runCom.
const COM_HOST_SCRIPT_PATH = path.join(app.getPath('userData'), 'wallpaper-host.ps1');
function ensureComHostScript() {
  try {
    fs.mkdirSync(path.dirname(COM_HOST_SCRIPT_PATH), { recursive: true });
    fs.writeFileSync(COM_HOST_SCRIPT_PATH, HOST_SCRIPT, 'utf8');
  } catch (err) {
    console.error('Не удалось записать COM-host-скрипт:', err);
  }
}
const wpHost = new WallpaperHost(COM_HOST_SCRIPT_PATH);

async function isGameOrFullscreenRunning() {
  if (!config.gameModeBlock) return false;
  try {
    const isBusy = await wpHost.checkFullscreen();
    return !!isBusy;
  } catch (err) {
    console.error('[GameMode] Error checking fullscreen via host:', err);
    try {
      const out = await runCom(['-Mode', 'check-fullscreen']);
      return out.trim() === 'True';
    } catch (fallbackErr) {
      console.error('[GameMode] Error checking fullscreen via fallback:', fallbackErr);
    }
  }
  return false;
}

let monitorsCache = [];

async function getMonitors() {
  let list = null;
  try {
    list = await wpHost.enumMonitors(); // быстрый путь: живой COM-хост
  } catch (e1) {
    try {
      const out = await runCom(['-Mode', 'enum']); // фоллбек: spawn-per-call
      const parsed = JSON.parse((out || '').trim() || '[]');
      list = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e2) {
      console.error('Не удалось перечислить мониторы (COM):', e2);
      list = [];
    }
  }
  monitorsCache = (list || []).map((m) => ({
    id: m.id,
    x: m.x, y: m.y, w: m.w, h: m.h,
    primary: m.x === 0 && m.y === 0,
  }));
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
let lastScheduledTheme = null;

// Schedule math (parse/sun/boundaries) lives in src/schedule.js — pure & unit-tested.
// This wrapper binds the Windows-theme schedule from the live config.
function themeScheduleBoundaries(date) {
  return schedule.boundaries(config.themeSchedule, date);
}

function clearThemeTimer() {
  if (themeTimer) { clearTimeout(themeTimer); themeTimer = null; }
}

// Apply the scheduled theme now (modes: time / sun) and schedule the next flip.
async function applyThemeSchedule() {
  clearThemeTimer();
  const sch = config.themeSchedule || {};
  if (sch.mode !== 'time' && sch.mode !== 'sun') return; // 'off' — Lumina does not drive the theme
  const now = new Date();
  const b = themeScheduleBoundaries(now);
  if (!b) { themeTimer = setTimeout(applyThemeSchedule, 60 * 60000); return; } // no coords / polar — retry in 1h
  const wantDark = schedule.saysDark(b, now);
  const scheduledTheme = wantDark ? 'dark' : 'light';

  // Smart reset: crossing a schedule boundary (e.g. sunrise→sunset) clears a manual override.
  if (lastScheduledTheme && lastScheduledTheme !== scheduledTheme && config.themeOverride != null) {
    console.log('[Theme] Scheduled boundary crossed — dropping manual override.');
    config.themeOverride = null;
    saveConfig();
  }
  lastScheduledTheme = scheduledTheme;

  // If there's an active override, we skip applying the scheduled theme to Windows, but keep the timer running to detect the next boundary.
  if (config.themeOverride != null) {
    themeTimer = setTimeout(applyThemeSchedule, schedule.minutesUntilNextBoundary(b, now) * 60000 + 3000);
    return;
  }

  if (wantDark !== nativeTheme.shouldUseDarkColors) {
    if (config.gameModeBlock && await isGameOrFullscreenRunning()) {
      console.log('[GameMode] Theme schedule flip blocked. Will retry in 1 minute.');
      themeTimer = setTimeout(applyThemeSchedule, 60000);
      return;
    }
    setWindowsTheme(wantDark).catch((e) => console.error('Не удалось сменить тему Windows:', e));
  }
  themeTimer = setTimeout(applyThemeSchedule, schedule.minutesUntilNextBoundary(b, now) * 60000 + 3000);
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

// Тема ОС (для UI: титулбар, трей, тема окна). НЕ для выбора обоев — см. wallpaperThemeName().
function currentThemeName() {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

// Shared coordinates live in themeSchedule for backward compatibility, while the
// wallpaper schedule owns its independent mode and clock times.
function wallpaperScheduleConfig() {
  const location = config.themeSchedule || {};
  return {
    ...(config.wallpaperSchedule || {}),
    lat: location.lat || '',
    lng: location.lng || '',
  };
}

// The single source of truth for choosing the wallpaper slot. Unified mode always
// uses 'light'; system/off keep the current Windows slot; time/sun use a virtual
// day/night state independent from Windows.
function wallpaperThemeName(date = new Date()) {
  if (config.separateThemes === false) return 'light';
  return schedule.resolveTheme(wallpaperScheduleConfig(), date, currentThemeName());
}

let wallpaperTimer = null;
function clearWallpaperTimer() {
  if (wallpaperTimer) { clearTimeout(wallpaperTimer); wallpaperTimer = null; }
}

// Apply the independent wallpaper schedule now and arm its next boundary. `applyNow`
// is false when another scheduler (the slideshow) already applied the current frame.
async function applyWallpaperSchedule(isManual = false, applyNow = true) {
  clearWallpaperTimer();
  const sch = wallpaperScheduleConfig();
  if (config.separateThemes === false || (sch.mode !== 'time' && sch.mode !== 'sun')) return;

  const now = new Date();
  const b = schedule.boundaries(sch, now);
  if (!b) {
    wallpaperTimer = setTimeout(() => applyWallpaperSchedule(false, true), 60 * 60000);
    return;
  }

  const theme = schedule.saysDark(b, now) ? 'dark' : 'light';
  broadcastWallpaperTheme(theme);
  if (applyNow) {
    const result = await applyForTheme(theme, isManual);
    if (result && result.reason === 'gamemode-blocked') {
      wallpaperTimer = setTimeout(() => applyWallpaperSchedule(false, true), 60000);
      return;
    }
  }
  wallpaperTimer = setTimeout(
    () => applyWallpaperSchedule(false, true),
    schedule.minutesUntilNextBoundary(b, now) * 60000 + 3000
  );
}

// id основного монитора (для режима «одни обои на все мониторы»)
function primaryMonitorId() {
  const p = monitorsCache.find((m) => m.primary) || monitorsCache[0];
  return p ? p.id : null;
}

// ---- Слайдшоу: слот = плейлист; чистая логика — в ./src/playlist.js ----
function slotFor(monitorId, theme) {
  const m = config.monitors && config.monitors[monitorId];
  const slot = m && m[theme];
  return slot && Array.isArray(slot.itemIds) ? slot : { itemIds: [] };
}

// Текущая картинка плейлиста монитора (по сохранённому индексу слайдшоу).
function currentImageFor(monitorId, theme) {
  const list = playlist.resolveSlot(slotFor(monitorId, theme), config.library);
  const si = config.slideshowIndex[monitorId];
  const idx = si && Number.isFinite(si[theme]) ? si[theme] : 0;
  return playlist.pickCurrent(list, idx);
}

// Все файлы, на которые ссылается БИБЛИОТЕКА (+ легаси-глобалы) — keep-набор для GC.
// Сама логика — в src/library.js (referencedFiles), под unit-тестами: это страховка от
// повторения инцидента 2026-06-03 (неполный keep-набор → файлы пользователя в корзину).
function referencedFiles() {
  return library.referencedFiles(config);
}

// Подчищает осиротевшие файлы из wallpapers/ — но БЕЗОПАСНО: НЕ удаляет навсегда, а
// ПЕРЕМЕЩАЕТ в подпапку .trash (восстановимо). Раньше тут был fs.rmSync + запуск на каждом
// СТАРТЕ → если keep-набор хоть на миг оказывался неполным (миграция/смена состояния), файлы
// пользователя удалялись безвозвратно. Теперь: только move-в-корзину, и НЕ на старте.
const TRASH_DIR = path.join(WALLPAPERS_DIR, '.trash');
function gcWallpapers() {
  try {
    // Предохранитель: если пул пуст (переходное/битое состояние) — НЕ трогаем ничего,
    // иначе keep свёлся бы к одним глобалам и всё остальное уехало бы в корзину.
    if (!config.library || Object.keys(config.library).length === 0) return;
    const keep = referencedFiles();
    fs.mkdirSync(TRASH_DIR, { recursive: true });
    for (const f of fs.readdirSync(WALLPAPERS_DIR)) {
      if (f === '.trash') continue;
      const full = path.join(WALLPAPERS_DIR, f);
      try { if (!fs.statSync(full).isFile()) continue; } catch { continue; }
      if (!keep.has(path.normalize(full).toLowerCase())) {
        try { fs.renameSync(full, path.join(TRASH_DIR, f)); } catch { /* оставляем как есть, не удаляем */ }
      }
    }
  } catch {}
}

function wallpaperFor(monitorId, theme) {
  if (config.singleWallpaper) {
    // одни обои на все мониторы = текущая картинка плейлиста ОСНОВНОГО монитора
    return currentImageFor(primaryMonitorId(), theme);
  }
  const p = currentImageFor(monitorId, theme);
  if (p) return p;
  // легаси-fallback только если у монитора пустой плейлист (старые конфиги / COM-сбой)
  return (theme === 'dark' ? config.darkWallpaper : config.lightWallpaper) || '';
}

async function applyForTheme(themeName, isManual = false, targetMonitors = null) {
  const theme = config.separateThemes === false ? 'light' : (themeName || wallpaperThemeName());
  broadcastWallpaperTheme(theme);
  if (!isManual && config.gameModeBlock && await isGameOrFullscreenRunning()) {
    console.log('[GameMode] Wallpaper change blocked due to active game / fullscreen app');
    return { ok: false, reason: 'gamemode-blocked' };
  }
  const monitors = monitorsCache.length ? monitorsCache : await getMonitors();

  // Preferred path: per-monitor via COM
  if (monitors.length) {
    const items = [];
    for (const m of monitors) {
      if (targetMonitors && !targetMonitors.includes(m.id)) continue;
      const p = wallpaperFor(m.id, theme);
      if (p && fs.existsSync(p)) items.push({ id: m.id, path: p });
    }
    if (!items.length) return { ok: false, reason: 'no-wallpaper', theme };
    const pos = COM_POS[config.style] != null ? COM_POS[config.style] : 4;
    try {
      await wpHost.apply(pos, items); // быстрый путь: живой COM-хост (без перекомпиляции)
      return { ok: true, theme };
    } catch (eHost) {
      try {
        fs.writeFileSync(APPLY_DATA_PATH, JSON.stringify({ position: pos, items }), 'utf8');
        await runCom(['-Mode', 'apply', '-DataFile', APPLY_DATA_PATH]); // фоллбек: spawn-per-call
        return { ok: true, theme };
      } catch (err) {
        console.error('Ошибка применения per-monitor (COM), пробую legacy single:', err);
        // fall through to legacy single
      }
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
// Slideshow scheduler — rotate each monitor's playlist on an interval.
// Mirrors applyThemeSchedule(): timer → advance indices → applyForTheme → reschedule.
// ---------------------------------------------------------------------------
let slideshowTimer = null;
function clearSlideshowTimer() { if (slideshowTimer) { clearTimeout(slideshowTimer); slideshowTimer = null; } }

// Сдвинуть текущий кадр каждого монитора (в рамках темы); пропускаем плейлисты < 2 картинок.
function advanceIndices(theme, targetMonitors = null) {
  const shuffle = config.slideshow.order === 'shuffle';
  for (const m of monitorsCache) {
    if (targetMonitors && !targetMonitors.includes(m.id)) continue;
    const len = playlist.resolveSlot(slotFor(m.id, theme), config.library).length;
    if (len < 2) continue;
    if (!config.slideshowIndex[m.id]) config.slideshowIndex[m.id] = { light: 0, dark: 0 };
    const cur = Number.isFinite(config.slideshowIndex[m.id][theme]) ? config.slideshowIndex[m.id][theme] : 0;
    config.slideshowIndex[m.id][theme] = playlist.nextIndex(cur, len, shuffle);
  }
}

// advance=true сдвигает кадр; false — просто применить текущее и (пере)запланировать.
async function tickSlideshow(advance, isManual = false) {
  clearSlideshowTimer();
  if (!config.slideshow || !config.slideshow.enabled) return;

  if (!isManual && config.gameModeBlock && await isGameOrFullscreenRunning()) {
    console.log('[GameMode] Slideshow rotation blocked. Will retry in 1 minute.');
    slideshowTimer = setTimeout(() => tickSlideshow(advance, false), 60000);
    return;
  }

  const theme = wallpaperThemeName();
  if (advance) { advanceIndices(theme); saveConfig(); }
  await applyForTheme(theme, isManual);
  const mins = Math.max(1, Math.floor(Number(config.slideshow.intervalMin) || 30));
  slideshowTimer = setTimeout(() => tickSlideshow(true, false), mins * 60000);
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

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] ${message} (${sourceId}:${line})`);
  });

  mainWindow.once('ready-to-show', () => {
    if (!STARTED_HIDDEN) mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Если окно всё-таки разрушено — сбрасываем ссылку, чтобы showWindow() пересоздал
  // его, а не звал методы на «мёртвом» объекте (это бросает исключение → открывается
  // трей, но окно не появляется — тот самый баг «только трей»).
  mainWindow.on('closed', () => { mainWindow = null; });
}

function bringToFront(win) {
  if (!win || win.isDestroyed()) return;
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
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    mainWindow.once('ready-to-show', () => bringToFront(mainWindow));
    return;
  }
  bringToFront(mainWindow);
}

// ---------------------------------------------------------------------------
// Slideshow Helpers
// ---------------------------------------------------------------------------
function hasSlideshowItems() {
  const theme = wallpaperThemeName();
  if (config.singleWallpaper) {
    return playlist.resolveSlot(slotFor(primaryMonitorId(), theme), config.library).length >= 2;
  }
  for (const m of monitorsCache) {
    if (playlist.resolveSlot(slotFor(m.id, theme), config.library).length >= 2) {
      return true;
    }
  }
  return false;
}

function triggerNextWallpaper() {
  const theme = wallpaperThemeName();
  if (config.slideshow && config.slideshow.enabled) {
    tickSlideshow(true, true);
  } else {
    advanceIndices(theme);
    saveConfig();
    applyForTheme(theme, true);
  }
}

let activeShortcut = '';
function registerShortcut() {
  if (activeShortcut) {
    try {
      globalShortcut.unregister(activeShortcut);
      activeShortcut = '';
    } catch (err) {
      console.error('[Hotkey] Unregister failed:', err);
    }
  }
  if (config.hotkeys && config.hotkeys.nextWallpaper) {
    const { enabled, shortcut } = config.hotkeys.nextWallpaper;
    if (enabled && shortcut) {
      try {
        const ok = globalShortcut.register(shortcut, () => {
          console.log(`[Hotkey] Triggered: ${shortcut}`);
          triggerNextWallpaper();
        });
        if (!ok) {
          console.error(`[Hotkey] Registration failed for: ${shortcut}`);
        } else {
          activeShortcut = shortcut;
          console.log(`[Hotkey] Registered successfully: ${shortcut}`);
        }
      } catch (err) {
        console.error(`[Hotkey] Invalid format or registration error for ${shortcut}:`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
// Системный трей вынесен в ./src/tray.js (Electron-объекты и действия инжектятся).
const trayCtl = createTrayController({
  Tray, Menu, nativeImage,
  assetsDir: path.join(__dirname, 'assets'),
  t: tMain,
  getState: () => ({
    theme: currentThemeName(),
    updateState,
    slideshowEnabled: !!(config.slideshow && config.slideshow.enabled),
    hasSlideshowItems: hasSlideshowItems(),
  }),
  onOpen: () => showWindow(),
  onApplyCurrent: () => applyForTheme(null, true),
  onNextWallpaper: () => triggerNextWallpaper(),
  onInstallUpdate: () => quitAndInstallUpdate(),
  onQuit: () => { app.isQuitting = true; app.quit(); },
});

// ---------------------------------------------------------------------------
// Autostart
// ---------------------------------------------------------------------------
function applyLoginItem() {
  // Автозапуском Windows управляет ТОЛЬКО установленная (Squirrel) сборка. Dev и портативная
  // НЕ трогают реестр: иначе каждая сборка регистрируется под СВОИМ ключом (electron.app.<name>,
  // имя/путь различаются), записи в HKCU\…\Run накапливаются, и при входе в Windows стартует сразу
  // НЕСКОЛЬКО разных версий (баг 2026-06-05: поднималась портативная/dev вместо установленной,
  // а из-за дубль-экземпляра second-instance вылезало окно даже при --hidden).
  if (!updatesSupported()) return;
  // Point the Run entry at the STABLE Squirrel Update.exe (one level above app-<ver>), NOT at
  // process.execPath. execPath is the versioned `…\app-<ver>\Lumina.exe`, and Squirrel removes the
  // old app-<ver> folder on update — so a versioned Run entry goes stale after every update and the
  // app silently stops auto-starting (bug 2026-06-07). `Update.exe --processStart Lumina.exe` always
  // launches the current version and survives updates.
  const exeName = path.basename(process.execPath); // Lumina.exe
  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const args = ['--processStart', exeName];
  if (config.startMinimized) args.push('--process-start-args', '--hidden');
  app.setLoginItemSettings({
    openAtLogin: config.autostart,
    path: updateExe,
    args,
  });
}

// Подчистить ОСИРОТЕВШИЕ записи автозапуска от dev/portable сборок (`electron.app.*`): право на
// автозапуск Windows есть только у установленной версии. Записи могут жить не только в `…\Run`, но и в
// `…\Explorer\StartupApproved\Run` (ветка статусов) — её Диспетчер задач показывает как автозапуск, и
// обычным `reg query …\Run` её не видно. Тихо, fire-and-forget; трогаем ТОЛЬКО наши ключи.
function cleanStrayAutostartEntries() {
  if (!updatesSupported()) return; // только установленная (Squirrel) сборка чистит
  const keys = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
  ];
  const names = ['electron.app.Lumina', 'electron.app.Electron', 'electron.app.Adwaita Wallpaper'];
  for (const k of keys) for (const n of names) execFile('reg', ['delete', k, '/v', n, '/f'], () => {});
}

function setAutostart(enabled) {
  config.autostart = enabled;
  applyLoginItem();
  saveConfig();
}

function setStartMinimized(enabled) {
  config.startMinimized = enabled;
  applyLoginItem(); // переписываем аргументы автозапуска (--hidden) под новое значение
  saveConfig();
}

// ---------------------------------------------------------------------------
// Auto-update (Electron autoUpdater → Squirrel.Windows).
// Works ONLY in the installed (Squirrel) build, where Update.exe sits next to
// the app-<ver> folder. In dev / portable we fall back to the Releases page.
// Feed = update.electronjs.org (Electron's hosted service for public GitHub
// repos). NB: the GitHub release must include RELEASES + the *.nupkg, not just
// Setup.exe — otherwise there is nothing for Squirrel to read.
// ---------------------------------------------------------------------------
const RELEASES_PAGE = 'https://github.com/alexvlass01/lumina/releases/latest';

let updateState = 'idle'; // idle | checking | downloading | ready | none | error
let updaterWired = false;

function updatesSupported() {
  try {
    // Squirrel installs Update.exe one level above the app-<ver> folder
    return fs.existsSync(path.join(path.dirname(process.execPath), '..', 'Update.exe'));
  } catch { return false; }
}

function setUpdateState(s) {
  updateState = s;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { state: updateState, supported: updatesSupported() });
  }
  trayCtl.refresh(); // показать/убрать пункт «перезапустить и обновить»
}

function wireAutoUpdater() {
  if (updaterWired || !updatesSupported()) return;
  updaterWired = true;
  try {
    autoUpdater.setFeedURL({ url: `https://update.electronjs.org/alexvlass01/lumina/${process.platform}/${app.getVersion()}` });
  } catch (e) { console.error('setFeedURL:', e); }
  autoUpdater.on('checking-for-update', () => setUpdateState('checking'));
  autoUpdater.on('update-available', () => setUpdateState('downloading')); // Squirrel качает сам
  autoUpdater.on('update-not-available', () => setUpdateState('none'));
  autoUpdater.on('update-downloaded', () => setUpdateState('ready'));
  autoUpdater.on('error', (err) => { console.error('autoUpdater:', err); setUpdateState('error'); });
}

// Returns false if updates aren't supported here (caller falls back to the page).
function checkForUpdates() {
  if (!updatesSupported()) return false;
  wireAutoUpdater();
  try { autoUpdater.checkForUpdates(); setUpdateState('checking'); }
  catch (e) { console.error(e); setUpdateState('error'); }
  return true;
}

function quitAndInstallUpdate() {
  if (updateState !== 'ready') return;
  app.isQuitting = true;
  try { autoUpdater.quitAndInstall(); } catch (e) { console.error('quitAndInstall:', e); }
}

// ---------------------------------------------------------------------------
// Renderer communication
// ---------------------------------------------------------------------------
function broadcastConfig() {
  trayCtl.refresh();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('config-changed', config);
  }
}

function broadcastTheme() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('theme-changed', currentThemeName());
  }
}

function broadcastWallpaperTheme(theme = wallpaperThemeName()) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('wallpaper-theme-changed', theme);
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

ipcMain.handle('get-wallpaper-theme', () => wallpaperThemeName());

ipcMain.handle('set-config', async (e, patch) => {
  const next = { ...config, ...(patch || {}) };
  if (patch && patch.themeSchedule && typeof patch.themeSchedule === 'object') {
    next.themeSchedule = { ...config.themeSchedule, ...patch.themeSchedule };
  }
  if (patch && patch.wallpaperSchedule && typeof patch.wallpaperSchedule === 'object') {
    next.wallpaperSchedule = { ...config.wallpaperSchedule, ...patch.wallpaperSchedule };
  }
  config = next;
  if (patch && 'wallpaperSchedule' in patch) {
    const sch = config.wallpaperSchedule && typeof config.wallpaperSchedule === 'object'
      ? config.wallpaperSchedule
      : {};
    config.wallpaperSchedule = {
      mode: 'system',
      lightStart: '07:00',
      darkStart: '20:00',
      ...sch,
    };
    if (!['off', 'system', 'time', 'sun'].includes(config.wallpaperSchedule.mode)) {
      config.wallpaperSchedule.mode = 'system';
    }
    if (typeof config.wallpaperSchedule.lightStart !== 'string') config.wallpaperSchedule.lightStart = '07:00';
    if (typeof config.wallpaperSchedule.darkStart !== 'string') config.wallpaperSchedule.darkStart = '20:00';
    config.autoSwitch = config.wallpaperSchedule.mode === 'system';
  }
  saveConfig();
  trayCtl.refresh();
  if (patch && 'themeSchedule' in patch) applyThemeSchedule();
  if (patch && 'hotkeys' in patch) registerShortcut();
  if (patch && 'separateThemes' in patch) {
    // переключили парадигму слотов → сразу применить обои из актуального слота (GNOME: без «Сохранить»)
    clearWallpaperTimer();
    if (config.slideshow.enabled) await tickSlideshow(false, true);
    else await applyForTheme(null, true);
    if (config.separateThemes !== false) await applyWallpaperSchedule(true, false);
  } else if (patch && 'wallpaperSchedule' in patch) {
    const mode = config.wallpaperSchedule.mode;
    if (mode === 'time' || mode === 'sun') {
      await applyWallpaperSchedule(true, true);
    } else {
      clearWallpaperTimer();
      if (mode === 'system') {
        if (config.slideshow.enabled) await tickSlideshow(false, true);
        else await applyForTheme(currentThemeName(), true);
      } else {
        broadcastWallpaperTheme(wallpaperThemeName());
      }
    }
  } else if (patch && 'themeSchedule' in patch && config.wallpaperSchedule && config.wallpaperSchedule.mode === 'sun') {
    // Coordinates are shared by both schedules; changing them re-evaluates sun mode.
    await applyWallpaperSchedule(true, true);
  }
  return config;
});

const IMG_FILTERS = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'gif'] }];

function ensureSlot(monitorId, which) {
  const theme = which === 'dark' ? 'dark' : 'light';
  if (!config.monitors[monitorId]) config.monitors[monitorId] = { light: { itemIds: [] }, dark: { itemIds: [] } };
  const m = config.monitors[monitorId];
  if (!m.light || !Array.isArray(m.light.itemIds)) m.light = { itemIds: [] };
  if (!m.dark || !Array.isArray(m.dark.itemIds)) m.dark = { itemIds: [] };
  return m[theme];
}

// Импорт картинки/папки в пул + назначение её в слот (вернёт true, если реально добавили).
function assignToSlot(slot, type, srcPath) {
  const id = library.addPath(config.library, type, srcPath);
  if (!id) return false;
  if (slot.itemIds.includes(id)) return false; // уже в этом слоте
  slot.itemIds.push(id);
  return true;
}

// Удалить элемент из пула И из всех слотов, которые на него ссылаются (без висячих id).
function removeFromLibrary(id) {
  if (!library.removeItem(config.library, id)) return false;
  for (const m of Object.values(config.monitors || {})) {
    for (const th of ['light', 'dark']) {
      if (m[th] && Array.isArray(m[th].itemIds)) {
        m[th].itemIds = m[th].itemIds.filter((x) => x !== id);
      }
    }
  }
  return true;
}

// add one or more local photos to a monitor's playlist (multi-select dialog)
ipcMain.handle('add-slot-images', async (e, monitorId, which) => {
  if (!monitorId) return { config, added: 0 };
  const res = await dialog.showOpenDialog(mainWindow, {
    title: tMain('design.addPhotos'),
    properties: ['openFile', 'multiSelections'],
    filters: IMG_FILTERS,
  });
  if (res.canceled || !res.filePaths.length) return { config, added: 0 };
  const slot = ensureSlot(monitorId, which);
  let added = 0;
  for (const src of res.filePaths) {
    try {
      const stored = await importWallpaper(src);
      if (assignToSlot(slot, 'image', stored)) added++;
    } catch (err) { console.error('Не удалось импортировать обои:', err); }
  }
  saveConfig();
  trayCtl.refresh();
  return { config, added };
});

// add a local folder as a source (scanned live, not copied)
ipcMain.handle('add-slot-folder', async (e, monitorId, which) => {
  if (!monitorId) return { config, added: 0 };
  const res = await dialog.showOpenDialog(mainWindow, {
    title: tMain('design.addFolder'),
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return { config, added: 0 };
  const dir = res.filePaths[0];
  const slot = ensureSlot(monitorId, which);
  assignToSlot(slot, 'folder', dir);
  saveConfig();
  return { config, added: 1 };
});

// add multiple dropped file paths (files or folders) to a monitor's playlist
ipcMain.handle('add-slot-paths', async (e, monitorId, which, paths) => {
  if (!monitorId || !Array.isArray(paths)) return { config, added: 0 };
  const slot = ensureSlot(monitorId, which);
  let added = 0;
  for (const src of paths) {
    try {
      const stats = fs.statSync(src);
      if (stats.isDirectory()) {
        if (assignToSlot(slot, 'folder', src)) added++;
      } else if (stats.isFile()) {
        const ext = path.extname(src).toLowerCase();
        if (playlist.IMG_EXTS.has(ext)) {
          const stored = await importWallpaper(src);
          if (assignToSlot(slot, 'image', stored)) added++;
        }
      }
    } catch (err) {
      console.error('Failed to import drag-dropped path:', src, err);
    }
  }
  if (added > 0) {
    saveConfig();
    trayCtl.refresh();
  }
  return { config, added };
});

ipcMain.handle('remove-slot-item', (e, monitorId, which, index) => {
  if (!monitorId) return config;
  const slot = ensureSlot(monitorId, which);
  if (index >= 0 && index < slot.itemIds.length) slot.itemIds.splice(index, 1);
  saveConfig();
  gcWallpapers();
  trayCtl.refresh();
  return config;
});

ipcMain.handle('clear-slot', (e, monitorId, which) => {
  if (!monitorId) return config;
  ensureSlot(monitorId, which).itemIds = [];
  saveConfig();
  gcWallpapers();
  return config;
});

// ---- Библиотека (пул контента, независимый от назначения на мониторы) ----

// Добавить выбранные фото в пул (диалог мультивыбора), БЕЗ привязки к слоту.
ipcMain.handle('library-add-images', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: tMain('library.addPhotos'),
    properties: ['openFile', 'multiSelections'],
    filters: IMG_FILTERS,
  });
  if (res.canceled || !res.filePaths.length) return { config, added: 0 };
  const before = Object.keys(config.library).length;
  for (const src of res.filePaths) {
    try { library.addPath(config.library, 'image', await importWallpaper(src)); }
    catch (err) { console.error('library: не удалось импортировать', src, err); }
  }
  const added = Object.keys(config.library).length - before;
  if (added) saveConfig();
  return { config, added };
});

// Добавить папку-источник в пул (живое сканирование, файлы не копируем).
ipcMain.handle('library-add-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: tMain('library.addFolder'),
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return { config, added: 0 };
  const before = Object.keys(config.library).length;
  library.addPath(config.library, 'folder', res.filePaths[0]);
  const added = Object.keys(config.library).length - before;
  if (added) saveConfig();
  return { config, added };
});

// Добавить перетащенные пути (файлы/папки) в пул.
ipcMain.handle('library-add-paths', async (e, paths) => {
  if (!Array.isArray(paths)) return { config, added: 0 };
  const before = Object.keys(config.library).length;
  for (const src of paths) {
    try {
      const stats = fs.statSync(src);
      if (stats.isDirectory()) {
        library.addPath(config.library, 'folder', src);
      } else if (stats.isFile() && playlist.IMG_EXTS.has(path.extname(src).toLowerCase())) {
        library.addPath(config.library, 'image', await importWallpaper(src));
      }
    } catch (err) { console.error('library: drop import failed', src, err); }
  }
  const added = Object.keys(config.library).length - before;
  if (added) saveConfig();
  return { config, added };
});

// Удалить элемент из пула (и из всех слотов) + подчистить файл-сироту.
ipcMain.handle('library-remove', (e, id) => {
  if (removeFromLibrary(id)) {
    saveConfig();
    gcWallpapers();
    trayCtl.refresh();
    applyForTheme(null, true); // вдруг удалили текущие обои — переприменим
  }
  return config;
});

ipcMain.handle('library-toggle-favorite', (e, id) => {
  library.toggleFavorite(config.library, id);
  saveConfig();
  return config;
});

// Refresh / sanity check: drop pool ENTRIES whose backing file/folder no longer exists on
// disk (user deleted/moved/renamed it in Windows). Never touches files — only the config.
// Returns the count so the renderer can decide whether to re-apply.
ipcMain.handle('library-refresh', () => {
  const dead = library.findMissingIds(config.library, (p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });
  let removed = 0;
  for (const id of dead) { if (removeFromLibrary(id)) removed++; }
  if (removed) {
    saveConfig();
    trayCtl.refresh();
    applyForTheme(null, true); // a removed item may have been the current wallpaper
  }
  return { config, removed };
});

// Заполнить размеры файлов (байты) для сортировки «по размеру» — лениво, по запросу.
// Считаем только для image-элементов без size; folder/недоступные → 0.
ipcMain.handle('library-ensure-sizes', () => {
  let changed = false;
  for (const it of Object.values(config.library || {})) {
    if (it && it.type === 'image' && it.path && typeof it.size !== 'number') {
      try { it.size = fs.statSync(it.path).size; } catch { it.size = 0; }
      changed = true;
    }
  }
  if (changed) saveConfig();
  return config;
});

ipcMain.handle('library-add-tag', (e, id, tag) => {
  if (library.addTag(config.library, id, tag)) saveConfig();
  return config;
});

ipcMain.handle('library-remove-tag', (e, id, tag) => {
  if (library.removeTag(config.library, id, tag)) saveConfig();
  return config;
});

// Назначить элемент пула на монитор×тему (добавляет в плейлист слота) + применить, если тема активна.
ipcMain.handle('library-assign', (e, id, monitorId, which) => {
  const theme = which === 'dark' ? 'dark' : 'light';
  if (!monitorId || !id || !config.library[id]) return config;
  const slot = ensureSlot(monitorId, theme);
  if (!slot.itemIds.includes(id)) slot.itemIds.push(id);
  saveConfig();
  trayCtl.refresh();
  if (theme === wallpaperThemeName()) applyForTheme(theme, true);
  return config;
});

// ---- Wallhaven (онлайн-обои) ----

// Состояние ключа для UI: есть ли вообще ключ (свой или зашитый) → доступен ли NSFW.
ipcMain.handle('wallhaven-status', () => ({ hasKey: !!wallhavenKey(), bundled: !!BUNDLED_WALLHAVEN_KEY }));

// Поиск. Без NSFW — keyless (purity sfw+sketchy, IP пользователя). NSFW — только если
// есть ключ; и ключ шлём ТОЛЬКО ради NSFW (keyless-путь не нагружает общий ключ).
ipcMain.handle('wallhaven-search', async (e, opts) => {
  const o = opts || {};
  const key = wallhavenKey();
  const p = o.purity || { sfw: true, sketchy: true, nsfw: false };
  const wantNsfw = !!p.nsfw && !!key;
  const purity = wallhaven.purityMask({ sfw: !!p.sfw, sketchy: !!p.sketchy, nsfw: wantNsfw });
  const url = wallhaven.buildSearchUrl({
    q: o.q || '',
    purity,
    categories: o.categories || '111',
    sorting: o.sorting || 'date_added',
    page: o.page || 1,
    apikey: wantNsfw ? key : '',
  });
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Lumina' } });
    if (!res.ok) return { items: [], meta: {}, error: String(res.status), hasKey: !!key };
    const json = await res.json();
    return { ...wallhaven.parseSearch(json), error: null, hasKey: !!key };
  } catch (err) {
    console.error('wallhaven search:', err);
    return { items: [], meta: {}, error: 'network', hasKey: !!key };
  }
});

// Скачать полное изображение в пул (как обычный image-элемент) + метаданные (источник, авто-теги по запросу).
ipcMain.handle('wallhaven-add', async (e, item, query) => {
  if (!item || !item.full) return { config, error: 'badItem' };
  try {
    const stored = await downloadWallpaperFromUrl(item.full);
    const id = library.addPath(config.library, 'image', stored);
    const it = config.library[id];
    if (it) {
      it.source = item.page || item.source || '';
      String(query || '').split(/[\s,]+/).filter(Boolean).forEach((tg) => library.addTag(config.library, id, tg));
    }
    saveConfig();
    return { config, id, error: null };
  } catch (err) {
    console.error('wallhaven add:', err);
    return { config, error: 'download' };
  }
});

// resolved current image for a slot (renderer can't scan folders itself)
ipcMain.handle('current-image', (e, monitorId, which) => {
  const theme = which === 'dark' ? 'dark' : 'light';
  const id = config.singleWallpaper ? primaryMonitorId() : monitorId;
  return currentImageFor(id, theme);
});

// Превью папки для библиотеки: число картинок внутри + N подпапок + первые превью
// (renderer сам сканировать ФС не может). Папки не копируем — живое сканирование.
ipcMain.handle('folder-info', (e, dir) => {
  try {
    const { folders, images } = playlist.scanFolderEntries(dir);
    return { count: images.length, subfolders: folders.length, previews: images.slice(0, 4) };
  } catch { return { count: 0, subfolders: 0, previews: [] }; }
});

// Маленький тамбнейл для библиотечных превью (через Windows shell) → data-URL. Без него
// карточки грузили бы полноразмерные (до 4K) файлы → тормоза декодирования + «лесенка»
// при даунскейле. LRU-кэш по "путь|WxH" (хранит и промахи как '' — не пересоздаём впустую).
const thumbCache = new Map();
const THUMB_CAP = 800;
ipcMain.handle('thumb', async (e, p, w, h) => {
  if (!p || typeof p !== 'string') return '';
  const W = w || 320; const H = h || 200;
  const key = `${p}|${W}x${H}`;
  const hit = thumbCache.get(key);
  if (hit !== undefined) { thumbCache.delete(key); thumbCache.set(key, hit); return hit; } // LRU bump
  let url = '';
  try {
    const img = await nativeImage.createThumbnailFromPath(p, { width: W, height: H });
    if (img && !img.isEmpty()) url = img.toDataURL();
  } catch { url = ''; }
  thumbCache.set(key, url);
  if (thumbCache.size > THUMB_CAP) { const k0 = thumbCache.keys().next().value; thumbCache.delete(k0); }
  return url;
});

// Содержимое папки для навигации ВНУТРЬ библиотеки: подпапки + картинки (один уровень).
ipcMain.handle('folder-entries', (e, dir) => {
  try {
    const { folders, images } = playlist.scanFolderEntries(dir);
    return {
      folders: folders.map((p) => ({ path: p, name: path.basename(p) })),
      images,
      count: images.length,
    };
  } catch { return { folders: [], images: [], count: 0 }; }
});

// Плоский разворот всех папок-источников в картинки (рекурсивно, с лимитами) для вкладки «Все».
// Возвращает ТОЛЬКО эфемерные (не в пуле) — pool-картинки у renderer уже есть в config.library.
ipcMain.handle('expand-folders', () => {
  try {
    const flat = library.flattenImages(config.library, (d) => playlist.scanFolderImagesDeep(d));
    return { images: flat.filter((x) => !x.inPool).map((x) => ({ path: x.path, id: x.id })) };
  } catch (err) { console.error('expand-folders:', err); return { images: [] }; }
});

// «Материализация» картинки/папки из живого источника в пул — БЕЗ копирования (по ссылке на
// оригинальный путь, как и сама папка-источник живёт по оригиналу). Нужно, чтобы назначить/★
// картинку из открытой папки: получаем настоящий id, дальше работают обычные library-assign/
// toggle-favorite/assign-меню. id = idFor(origPath) → совпадает с pool-item ⇒ нет дублей в «Все».
ipcMain.handle('library-materialize', (e, p, type) => {
  if (!p || typeof p !== 'string') return { config, id: null };
  const id = library.addPath(config.library, type === 'folder' ? 'folder' : 'image', p);
  if (id) saveConfig();
  return { config, id };
});

ipcMain.handle('set-slideshow', (e, patch) => {
  config.slideshow = { ...config.slideshow, ...(patch || {}) };
  config.slideshow.enabled = !!config.slideshow.enabled;
  if (!Number.isFinite(+config.slideshow.intervalMin) || +config.slideshow.intervalMin < 1) config.slideshow.intervalMin = 30;
  config.slideshow.intervalMin = Math.floor(+config.slideshow.intervalMin);
  if (config.slideshow.order !== 'shuffle') config.slideshow.order = 'sequential';
  saveConfig();
  if (config.slideshow.enabled) tickSlideshow(false, true);
  else { clearSlideshowTimer(); applyForTheme(null, true); }
  return config;
});

ipcMain.handle('apply-now', (e, which) => applyForTheme(which, true));

// Theme indicator on Home is a 3-step toggle: Auto → force opposite of the current
// auto theme → force the auto theme → back to Auto. _lastAutoTheme remembers what
// "auto" was when we left it, so the cycle is deterministic.
ipcMain.handle('cycle-theme-override', async () => {
  const isDark = nativeTheme.shouldUseDarkColors;
  let next;
  if (config.themeOverride == null) {
    config._lastAutoTheme = isDark ? 'dark' : 'light';
    next = isDark ? 'light' : 'dark';            // force the opposite first
  } else {
    const opposite = config._lastAutoTheme === 'dark' ? 'light' : 'dark';
    next = config.themeOverride === opposite ? config._lastAutoTheme : null;
  }

  config.themeOverride = next;
  saveConfig();
  if (next) await setWindowsTheme(next === 'dark');
  applyThemeSchedule(); // re-arm the boundary timer (no-op flip if schedule is off)
  return next;
});

// Ручная смена обоев на следующий кадр (кнопка на Главной / хоткей). Крутит слайдшоу,
// если включено, иначе просто сдвигает индекс плейлиста и применяет.
ipcMain.handle('next-wallpaper', () => { triggerNextWallpaper(); return config; });

// Jump to a specific playlist item for a monitor+theme and apply immediately.
ipcMain.handle('set-slideshow-index', async (e, monitorId, theme, index) => {
  if (!monitorId) return config;
  const t = theme === 'dark' ? 'dark' : 'light';
  if (!config.slideshowIndex[monitorId]) config.slideshowIndex[monitorId] = { light: 0, dark: 0 };
  config.slideshowIndex[monitorId][t] = index;
  saveConfig();
  if (t === wallpaperThemeName()) await applyForTheme(t, true);
  return config;
});

// «Установить именно эту картинку» по клику на миниатюру. Индекс слайдшоу адресует
// РАЗВЁРНУТЫЙ плейлист (папка = много файлов), поэтому ищем индекс по ПУТИ, а не по
// позиции в стрипе (иначе при папке в плейлисте ставится не то фото).
ipcMain.handle('set-slideshow-to-path', async (e, monitorId, theme, p) => {
  if (!monitorId || !p) return config;
  const t = theme === 'dark' ? 'dark' : 'light';
  const idx = playlist.resolvedIndexOf(slotFor(monitorId, t), config.library, p);
  if (idx < 0) return config; // путь не в развёрнутом плейлисте (исключён/файла нет)
  if (!config.slideshowIndex[monitorId]) config.slideshowIndex[monitorId] = { light: 0, dark: 0 };
  config.slideshowIndex[monitorId][t] = idx;
  saveConfig();
  if (t === wallpaperThemeName()) await applyForTheme(t, true);
  return config;
});

ipcMain.handle('detect-location', async () => {
  const providers = [
    {
      url: 'https://ipapi.co/json/',
      parse: (data) => {
        if (data.latitude != null && data.longitude != null) {
          return { lat: String(data.latitude), lng: String(data.longitude), city: data.city || '' };
        }
      }
    },
    {
      url: 'http://ip-api.com/json/',
      parse: (data) => {
        if (data.lat != null && data.lon != null) {
          return { lat: String(data.lat), lng: String(data.lon), city: data.city || '' };
        }
      }
    },
    {
      url: 'https://freeipapi.com/api/json',
      parse: (data) => {
        if (data.latitude != null && data.longitude != null) {
          return { lat: String(data.latitude), lng: String(data.longitude), city: data.cityName || '' };
        }
      }
    }
  ];

  const TIMEOUT_MS = 6000; // не зависать на «висящем» провайдере — отвалимся к следующему
  let lastError = null;
  for (const provider of providers) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      console.log(`Attempting location detection via ${provider.url}...`);
      const res = await fetch(provider.url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      const result = provider.parse(data);
      if (result) {
        console.log(`Location successfully detected using ${provider.url}: ${result.city} (${result.lat}, ${result.lng})`);
        return { ok: true, ...result };
      }
      throw new Error('Invalid format returned by provider');
    } catch (err) {
      console.warn(`Location provider ${provider.url} failed:`, err.message);
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }

  console.error('All location providers failed.');
  return { ok: false, reason: lastError ? lastError.message : 'Unknown error' };
});

ipcMain.handle('set-autostart', (e, v) => {
  setAutostart(v);
  return config.autostart;
});

ipcMain.handle('set-start-minimized', (e, v) => {
  setStartMinimized(v);
  return config.startMinimized;
});

ipcMain.handle('check-for-updates', () => ({ started: checkForUpdates(), supported: updatesSupported() }));
ipcMain.handle('install-update', () => quitAndInstallUpdate());
ipcMain.handle('open-releases', () => shell.openExternal(RELEASES_PAGE));
ipcMain.handle('open-website', () => shell.openExternal('https://github.com/alexvlass01/lumina'));
ipcMain.handle('get-update-state', () => ({ state: updateState, supported: updatesSupported() }));

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
app.on('second-instance', () => {
  // Защита от ДУБЛЯ автозапуска: если в реестре осталось несколько устаревших записей (от dev/
  // портативной сборок), при входе в Windows поднимается несколько экземпляров — второй НЕ должен
  // «будить» окно, раз мы стартовали скрыто (--hidden). Ручной повторный запуск (позже) показывает окно.
  if (STARTED_HIDDEN && Date.now() - START_TS < 10000) return;
  showWindow();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); // убираем стандартное меню File/Edit/View
  loadConfig();
  registerShortcut();
  ensurePsScript();
  ensureComScript();
  ensureComHostScript();
  ensureThemeScript();

  // keep the OS login item in sync with config (openAtLogin + the --hidden arg)
  applyLoginItem();
  cleanStrayAutostartEntries(); // убрать осиротевшие dev/portable записи автозапуска (см. функцию)

  createWindow();
  trayCtl.create();

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
    const isDark = nativeTheme.shouldUseDarkColors;
    if ((config.themeOverride === 'light' && isDark) || (config.themeOverride === 'dark' && !isDark)) {
      config.themeOverride = null;
      saveConfig();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.setTitleBarOverlay(titleBarOverlayColors()); } catch {}
    }
    broadcastTheme();
    trayCtl.refreshIcon();
    // Wallpaper mode='system' follows Windows. Independent time/sun schedules ignore
    // nativeTheme events completely; unified mode always stays on the shared light slot.
    if (config.separateThemes !== false && config.wallpaperSchedule && config.wallpaperSchedule.mode === 'system') {
      if (config.slideshow.enabled) tickSlideshow(false); // применить кадр новой темы + перепланировать
      else applyForTheme();
    }
  });

  // enumerate monitors, then apply correct wallpaper on launch
  await getMonitors();
  // NB: GC намеренно НЕ запускаем на старте — слишком опасно (см. gcWallpapers).
  // Осиротевшие файлы подчищаются только при явном удалении из библиотеки/слота, и то в .trash.
  const wallpaperMode = config.wallpaperSchedule && config.wallpaperSchedule.mode;
  if (config.slideshow.enabled) tickSlideshow(false); // применить текущее + запустить ротацию
  else if (wallpaperMode === 'system') applyForTheme();
  else if (wallpaperMode === 'time' || wallpaperMode === 'sun') await applyWallpaperSchedule(false, true);
  else broadcastWallpaperTheme();
  if (config.slideshow.enabled && (wallpaperMode === 'time' || wallpaperMode === 'sun')) {
    await applyWallpaperSchedule(false, false);
  }

  // start theme schedule (if enabled): set the right theme now + schedule flips
  applyThemeSchedule();

  // ── Wallpaper triggers ───────────────────────────────────────────────
  function triggerWithStealth(reason) {
    if (config.triggers && config.triggers.stealth) {
      console.log(`[StealthTrigger] Waiting for maximized window for ${reason}...`);
      let attempts = 0;
      const maxAttempts = 40; // 40 * 3s = 120s
      
      const tryStealth = async () => {
        attempts++;
        try {
          const monitors = monitorsCache.length ? monitorsCache : await getMonitors();
          if (!tryStealth.pending) tryStealth.pending = monitors.map(m => m.id);
          
          let covered = [];
          try { covered = await wpHost.checkMaximized(2000); } catch (e) {}
          
          const toApply = [];
          if (attempts >= maxAttempts) {
            toApply.push(...tryStealth.pending);
            tryStealth.pending = [];
            console.log(`[StealthTrigger] Timeout reached. Triggering ${reason} for remaining monitors.`);
          } else {
            for (const id of covered) {
              if (tryStealth.pending.includes(id)) {
                toApply.push(id);
                tryStealth.pending = tryStealth.pending.filter(x => x !== id);
              }
            }
          }
          
          if (toApply.length > 0) {
            console.log(`[StealthTrigger] Desktop covered for:`, toApply, `Triggering ${reason}.`);
            const theme = wallpaperThemeName();
            advanceIndices(theme, toApply);
            saveConfig();
            applyForTheme(theme, true, toApply);
          }
          
          if (tryStealth.pending.length > 0) {
            setTimeout(tryStealth, 3000);
          } else {
            console.log(`[StealthTrigger] Finished for all monitors.`);
          }
        } catch (err) {
          console.error(`[StealthTrigger] error:`, err);
          triggerNextWallpaper(); // fallback
        }
      };
      
      // Initial delay so we don't start polling instantly on boot, give it 5s
      setTimeout(tryStealth, 5000);
    } else {
      // Normal delay
      setTimeout(() => {
        console.log(`[Trigger] Triggering next wallpaper for ${reason}`);
        triggerNextWallpaper();
      }, 5000);
    }
  }

  if (config.triggers && config.triggers.onStartup) {
    triggerWithStealth('startup');
  }

  // Switch wallpaper when the computer wakes from sleep/hibernate
  powerMonitor.on('resume', () => {
    if (config.wallpaperSchedule && (config.wallpaperSchedule.mode === 'time' || config.wallpaperSchedule.mode === 'sun')) {
      applyWallpaperSchedule(false, true);
    }
    if (config.triggers && config.triggers.onWakeup) {
      triggerWithStealth('wakeup');
    }
  });

  // background update check (installed build only); silent until an update is ready
  if (updatesSupported()) setTimeout(() => checkForUpdates(), 8000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// dispose the persistent PowerShell host on quit (don't leave an orphan process)
app.on('before-quit', () => wpHost.dispose());

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Keep running in tray after all windows are closed
app.on('window-all-closed', () => {
  // do nothing — app lives in the tray
});
