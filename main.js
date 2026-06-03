'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeTheme, dialog, shell, nativeImage, screen, autoUpdater } = require('electron');
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
// the app simply stays keyless (SFW+sketchy still work, NSFW needs the user's own key).
function loadBundledWallhavenKey() {
  try {
    const k = require('./wallhaven-key.json');
    return k && typeof k.apikey === 'string' ? k.apikey.trim() : '';
  } catch { return ''; }
}
const BUNDLED_WALLHAVEN_KEY = loadBundledWallhavenKey();
// Effective key: the user's own (⚙) wins; otherwise the bundled one (if any).
function wallhavenKey() {
  return (config.wallhavenKey && config.wallhavenKey.trim()) || BUNDLED_WALLHAVEN_KEY || '';
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
  $data = Get-Content -LiteralPath $DataFile -Raw -Encoding utf8 | ConvertFrom-Json
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

// Все файлы, на которые ссылается БИБЛИОТЕКА (+ легаси-глобалы) — для сборки мусора.
// Пул контента самодостаточен: картинка остаётся, даже если не назначена ни на один
// монитор (в этом смысл библиотеки), поэтому держим все image-пути из config.library.
function referencedFiles() {
  const set = new Set();
  const add = (p) => { if (p) set.add(path.normalize(p).toLowerCase()); };
  for (const it of Object.values(config.library || {})) {
    if (it && it.type === 'image' && it.path) add(it.path);
  }
  add(config.lightWallpaper); add(config.darkWallpaper);
  return set;
}

// Удаляет из wallpapers/ файлы, не упомянутые в библиотеке (папки-источники не трогаем).
function gcWallpapers() {
  try {
    const keep = referencedFiles();
    for (const f of fs.readdirSync(WALLPAPERS_DIR)) {
      const full = path.join(WALLPAPERS_DIR, f);
      if (!keep.has(path.normalize(full).toLowerCase())) {
        try { fs.rmSync(full, { force: true }); } catch {}
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
function advanceIndices(theme) {
  const shuffle = config.slideshow.order === 'shuffle';
  for (const m of monitorsCache) {
    const len = playlist.resolveSlot(slotFor(m.id, theme), config.library).length;
    if (len < 2) continue;
    if (!config.slideshowIndex[m.id]) config.slideshowIndex[m.id] = { light: 0, dark: 0 };
    const cur = Number.isFinite(config.slideshowIndex[m.id][theme]) ? config.slideshowIndex[m.id][theme] : 0;
    config.slideshowIndex[m.id][theme] = playlist.nextIndex(cur, len, shuffle);
  }
}

// advance=true сдвигает кадр; false — просто применить текущее и (пере)запланировать.
function tickSlideshow(advance) {
  clearSlideshowTimer();
  if (!config.slideshow || !config.slideshow.enabled) return;
  const theme = currentThemeName();
  if (advance) { advanceIndices(theme); saveConfig(); }
  applyForTheme(theme);
  const mins = Math.max(1, Math.floor(Number(config.slideshow.intervalMin) || 30));
  slideshowTimer = setTimeout(() => tickSlideshow(true), mins * 60000);
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
  const theme = currentThemeName();
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
  const theme = currentThemeName();
  if (config.slideshow && config.slideshow.enabled) {
    tickSlideshow(true);
  } else {
    advanceIndices(theme);
    saveConfig();
    applyForTheme(theme);
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
  onApplyCurrent: () => applyForTheme(),
  onNextWallpaper: () => triggerNextWallpaper(),
  onInstallUpdate: () => quitAndInstallUpdate(),
  onQuit: () => { app.isQuitting = true; app.quit(); },
});

// ---------------------------------------------------------------------------
// Autostart
// ---------------------------------------------------------------------------
function applyLoginItem() {
  app.setLoginItemSettings({
    openAtLogin: config.autostart,
    path: process.execPath,
    // --hidden = стартовать свёрнутым в трей; управляется отдельным тумблером startMinimized
    args: config.startMinimized ? ['--hidden'] : [],
  });
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
  trayCtl.refresh();
  if (patch && 'themeSchedule' in patch) applyThemeSchedule();
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
    applyForTheme(); // вдруг удалили текущие обои — переприменим
  }
  return config;
});

ipcMain.handle('library-toggle-favorite', (e, id) => {
  library.toggleFavorite(config.library, id);
  saveConfig();
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
  if (theme === currentThemeName()) applyForTheme(theme);
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
  const wantNsfw = !!o.nsfw && !!key;
  const purity = wallhaven.purityMask({ sfw: true, sketchy: o.sketchy !== false, nsfw: wantNsfw });
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

ipcMain.handle('set-slideshow', (e, patch) => {
  config.slideshow = { ...config.slideshow, ...(patch || {}) };
  config.slideshow.enabled = !!config.slideshow.enabled;
  if (!Number.isFinite(+config.slideshow.intervalMin) || +config.slideshow.intervalMin < 1) config.slideshow.intervalMin = 30;
  config.slideshow.intervalMin = Math.floor(+config.slideshow.intervalMin);
  if (config.slideshow.order !== 'shuffle') config.slideshow.order = 'sequential';
  saveConfig();
  if (config.slideshow.enabled) tickSlideshow(false);
  else { clearSlideshowTimer(); applyForTheme(); }
  return config;
});

ipcMain.handle('apply-now', (e, which) => applyForTheme(which));

// Jump to a specific playlist item for a monitor+theme and apply immediately.
ipcMain.handle('set-slideshow-index', async (e, monitorId, theme, index) => {
  if (!monitorId) return config;
  const t = theme === 'dark' ? 'dark' : 'light';
  if (!config.slideshowIndex[monitorId]) config.slideshowIndex[monitorId] = { light: 0, dark: 0 };
  config.slideshowIndex[monitorId][t] = index;
  saveConfig();
  if (t === currentThemeName()) await applyForTheme(t);
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
app.on('second-instance', () => showWindow());

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); // убираем стандартное меню File/Edit/View
  loadConfig();
  ensurePsScript();
  ensureComScript();
  ensureComHostScript();
  ensureThemeScript();

  // keep the OS login item in sync with config (openAtLogin + the --hidden arg)
  applyLoginItem();

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
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.setTitleBarOverlay(titleBarOverlayColors()); } catch {}
    }
    broadcastTheme();
    trayCtl.refreshIcon();
    if (config.slideshow.enabled) tickSlideshow(false); // применить кадр новой темы + перепланировать
    else if (config.autoSwitch) applyForTheme();
  });

  // enumerate monitors, then apply correct wallpaper on launch
  await getMonitors();
  gcWallpapers(); // подчистить осиротевшие файлы обоев
  if (config.slideshow.enabled) tickSlideshow(false); // применить текущее + запустить ротацию
  else if (config.autoSwitch) applyForTheme();

  // start theme schedule (if enabled): set the right theme now + schedule flips
  applyThemeSchedule();

  // background update check (installed build only); silent until an update is ready
  if (updatesSupported()) setTimeout(() => checkForUpdates(), 8000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// dispose the persistent PowerShell host on quit (don't leave an orphan process)
app.on('before-quit', () => wpHost.dispose());

// Keep running in tray after all windows are closed
app.on('window-all-closed', () => {
  // do nothing — app lives in the tray
});
