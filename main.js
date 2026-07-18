'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeTheme, dialog, shell, nativeImage, screen, autoUpdater, globalShortcut, powerMonitor, safeStorage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const playlist = require('./src/playlist'); // чистая логика плейлистов (тестируется отдельно)
const library = require('./src/library'); // пул контента { [id]: Item }; слоты ссылаются по id
const libraryAssignment = require('./src/library-assignment');
const folderState = require('./src/folder-state'); // persistent firstSeenAt для файлов живых папок
const liveFolderWatch = require('./src/live-folder-watch'); // lightweight fs.watch lifecycle + debounce
const wallhaven = require('./src/wallhaven'); // клиент Wallhaven (онлайн-обои): URL + разбор
const gelbooru = require('./src/gelbooru'); // Gelbooru: основной booru-провайдер
const danbooru = require('./src/danbooru'); // Danbooru: URL + нормализация в общую онлайн-карточку
const online = require('./src/online'); // смешивание и дедуп результатов внешних провайдеров
const tagSuggest = require('./src/tag-suggest'); // anonymous Gelbooru tag autocomplete
const { WallpaperHost, HOST_SCRIPT } = require('./src/wallpaper-host'); // живой PowerShell-COM-хост
const configMod = require('./src/config'); // дефолты + load/migrate/save (тестируется отдельно)
const { createTrayController } = require('./src/tray'); // системный трей (меню + иконка)
const schedule = require('./src/schedule'); // чистая математика расписаний день/ночь (время/солнце)
const { createStealthController } = require('./src/stealth-session'); // отменяемая «невидимая смена» (под тестами)
const { createTaskQueue } = require('./src/task-queue'); // small async queue for expensive OS thumbnail jobs
const { ThumbnailHost, resolveThumbnailHelperPath } = require('./src/thumbnail-host');
const { createFailureNotifier } = require('./src/failure-notifier'); // edge-trigger «работало→сломалось» (T2)
const { createEventLog } = require('./src/event-log'); // bounded журнал сбоев/восстановлений (T3)
const { createNotificationDelivery } = require('./src/notification-delivery'); // отдельная проверка доставки Windows Notification
const cloudCapabilityMod = require('./src/cloud/capability'); // Lumina Cloud: какое окружение разрешено (C2)
const cloudClientMod = require('./src/cloud/client'); // Lumina Cloud: чистый API-клиент (C1); реальный fetch в main (C3)
const cloudOauth = require('./src/cloud/oauth'); // Lumina Cloud: чистый PKCE/loopback-разбор (C4)
const cloudDevProfile = require('./src/cloud/dev-profile'); // isolated userData for explicit staging launches
const diagnosticsGate = require('./src/diagnostics-gate'); // production-safe gate for dev-only diagnostics
const galleryPayloadMod = require('./src/gallery-payload'); // viewer payload sanitizing/windowing

// Match the AppUserModelID written into the Start Menu shortcut by our
// electron-winstaller/Squirrel package (`name: Lumina`, `exe: Lumina.exe`).
// Packaged Electron discovers this identity automatically, but source/dev runs
// otherwise surface as `electron.app.Electron` in Windows notification banners.
const WINDOWS_APP_USER_MODEL_ID = 'com.squirrel.Lumina.Lumina';

// Resolve dev-only userData overrides before the single-instance lock and before
// any paths are derived from app.getPath('userData'). Diagnostics intentionally
// has its own profile; Cloud staging remains independent and is used only when
// diagnostics is not explicitly enabled.
const DIAGNOSTICS_BOOTSTRAP = diagnosticsGate.resolveDiagnosticsBootstrap({
  isPackaged: app.isPackaged,
  env: process.env,
  argv: process.argv,
  localAppData: process.env.LOCALAPPDATA,
});
if (DIAGNOSTICS_BOOTSTRAP.enabled) app.setPath('userData', DIAGNOSTICS_BOOTSTRAP.userDataPath);

// Resolve staging userData after diagnostics. This keeps config, wallpapers,
// Chromium storage and safeStorage-encrypted Cloud sessions separate from prod.
const STAGING_USER_DATA = DIAGNOSTICS_BOOTSTRAP.enabled ? null : cloudDevProfile.resolveStagingUserData({
  isPackaged: app.isPackaged,
  cloudEnv: process.env.LUMINA_CLOUD,
  requestedPath: process.env.LUMINA_DEV_USER_DATA,
});
if (STAGING_USER_DATA) app.setPath('userData', STAGING_USER_DATA);

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
// Single instance (the lock follows the selected userData profile, so isolated
// staging and installed production can run at the same time).
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Squirrel's Update.exe forwards login-item args via a single `--process-start-args`
// string; depending on its version the app may receive "--autostart --hidden" as one argv
// entry OR as two. Normalize by re-splitting all args on whitespace so each flag is detected
// either way (a brittle exact-match once silently broke --hidden).
const LAUNCH_FLAGS = process.argv.slice(1).join(' ').split(/\s+/).filter(Boolean);
const STARTED_HIDDEN = LAUNCH_FLAGS.includes('--hidden');
// True only when Windows launched us from the login item (the Run entry passes --autostart),
// NOT on a manual/dev/portable launch. Gates the "on Windows startup" wallpaper trigger.
const STARTED_AUTOSTART = LAUNCH_FLAGS.includes('--autostart');
const START_TS = Date.now();
// During startup and just after resume, a theme catch-up flip (schedule/OS settling) must not
// pop a "Windows switched theme" toast — it's a background event, not a fresh user action.
// Genuine visible theme changes after this window still announce. See nativeTheme 'updated'.
let themeToastQuietUntil = START_TS + 10000;
// Last light/dark value we actually acted on. Windows fires nativeTheme 'updated' spuriously
// when a wallpaper is applied (same value) — we compare against this to ignore those.
let lastNativeDark = null;

let mainWindow = null;
let galleryWindow = null;
let galleryWindowNormalBounds = null;
let galleryWindowFullscreen = false; // tracked explicitly: enter/leave-full-screen events are unreliable for frameless windows on Windows
let galleryPayload = { items: [], index: 0 };
let diagnosticsController = null;
let diagnosticsControlWindow = null;
app.isQuitting = false;

// --- Diagnostics glue (dev-only). When the gated controller is absent these are
// no-op closures, so instrumented hot paths pay a single null-check in production.
const DIAG_NOOP_END = () => {};
function diagSpan(category, name, attributes) {
  if (!diagnosticsController) return DIAG_NOOP_END;
  return diagnosticsController.startSpan(category, name, attributes);
}
function diagEvent(raw) {
  if (diagnosticsController) diagnosticsController.recordEvent(raw);
}
function diagCountSend(channel) {
  if (diagnosticsController) diagnosticsController.countChannel(channel);
}

// ---------------------------------------------------------------------------
// Background-failure reporting (plan error_notifications, T2+T3).
// failureNotifier = pure edge detector («работало→сломалось» уведомляет один раз,
// успех сбрасывает и один раз отмечает восстановление). eventLog = bounded журнал
// в СВОЁМ файле (не в config: запись не должна дёргать config-changed broadcast).
// ---------------------------------------------------------------------------
const failureNotifier = createFailureNotifier();
const eventLog = createEventLog({ filePath: path.join(app.getPath('userData'), 'event-log.json') });
const deliverSystemNotification = createNotificationDelivery({
  NotificationClass: Notification,
  translate: (key) => tMain(key),
  onClick: () => showWindow(),
  logError: (err) => console.error('[Notify] failed to show notification:', err),
});

// Journal + (optionally) a Windows notification, once per working→broken edge.
// `notify:false` channels journal quietly (e.g. a live folder on an unplugged disk —
// tolerated per LF-QA1, worth a journal line, not worth a popup).
function reportChannelFailure(channel, messageKey, { titleKey, bodyKey, notify = true, params } = {}) {
  if (!failureNotifier.fail(channel)) return; // still broken — stay silent until it recovers
  eventLog.append({ channel, kind: 'failure', messageKey, params });
  if (!notify || config.notifyOnFailure === false) return;
  deliverSystemNotification({ titleKey: titleKey || messageKey, bodyKey: bodyKey || messageKey });
}

function reportChannelSuccess(channel, messageKey, { params } = {}) {
  if (failureNotifier.success(channel)) {
    eventLog.append({ channel, kind: 'recovered', messageKey, params });
  }
}

// Wallpaper-apply outcomes flow through here from the applyForTheme wrapper.
// 'no-wallpaper' (nothing configured / deliberately emptied slot) and
// 'gamemode-blocked' (deliberate postpone) are states, not breakages.
const APPLY_EXPECTED_REASONS = new Set(['no-wallpaper', 'gamemode-blocked']);
function reportApplyOutcome(result, isManual) {
  if (!result) return;
  if (result.ok) {
    // Any successful apply (manual or auto) proves the pipeline works again.
    reportChannelSuccess('wallpaper-auto', 'journal.wallpaperAuto');
    return;
  }
  if (APPLY_EXPECTED_REASONS.has(result.reason || '')) return;
  if (isManual) {
    // Manual failures already toast in the UI (T1); journal them for history.
    eventLog.append({ channel: 'wallpaper-manual', kind: 'failure', messageKey: 'journal.wallpaperManual' });
  } else {
    reportChannelFailure('wallpaper-auto', 'journal.wallpaperAuto', {
      titleKey: 'notify.wallpaperFailedTitle',
      bodyKey: 'notify.wallpaperFailedBody',
    });
  }
}

const thumbnailHost = new ThumbnailHost({
  executablePath: resolveThumbnailHelperPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  }),
  onEvent: (name, attributes) => {
    // Circuit open = thumbnails degraded to placeholders until the helper recovers —
    // exactly the kind of silent background breakage the journal/notifier exist for.
    if (name === 'circuit-open') {
      reportChannelFailure('thumbnail-helper', 'journal.thumbs', {
        titleKey: 'notify.thumbsFailedTitle',
        bodyKey: 'notify.thumbsFailedBody',
      });
    } else if (name === 'ready') {
      reportChannelSuccess('thumbnail-helper', 'journal.thumbs');
    }
    const totalMs = Number(attributes && attributes.totalMs);
    const isResponse = name === 'response' && Number.isFinite(totalMs);
    diagEvent({
      kind: isResponse ? 'span' : 'lifecycle',
      category: 'thumbnail-helper',
      name,
      timestampMs: isResponse ? Date.now() - Math.max(0, totalMs) : Date.now(),
      ...(isResponse ? { durationMs: Math.max(0, totalMs) } : {}),
      attributes,
    });
  },
});
// Renderer preloads only attach the diagnostics probe when they see this argument, and
// main only passes it under the dev-only gate — so a packaged build never activates it.
function diagRendererArgs(role) {
  return DIAGNOSTICS_BOOTSTRAP.enabled ? [`--lumina-diagnostics-renderer=${role}`] : [];
}

// Small dev-only control window (Start/Stop/mark/report). It is NOT instrumented — it
// uses its own control-preload (no probe), and its process is tagged 'renderer-
// diagnostics' so the report excludes it from the app's own smoothness verdict.
function openDiagnosticsControlWindow() {
  if (!DIAGNOSTICS_BOOTSTRAP.enabled) return;
  if (diagnosticsControlWindow && !diagnosticsControlWindow.isDestroyed()) { diagnosticsControlWindow.focus(); return; }
  diagnosticsControlWindow = new BrowserWindow({
    width: 300,
    height: 520,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    alwaysOnTop: true, // float above the app so the user keeps working in the main window
    title: 'Lumina Diagnostics',
    backgroundColor: '#1b1b1b',
    webPreferences: {
      preload: path.join(__dirname, 'diagnostics', 'ui', 'control-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  diagnosticsControlWindow.setMenuBarVisibility(false);
  diagnosticsControlWindow.webContents.on('console-message', (e, level, message, line, sourceId) => {
    console.log(`[Diag Control] ${message} (${sourceId}:${line})`);
  });
  diagnosticsControlWindow.webContents.on('preload-error', (e, p, err) => {
    console.error('[Diag Control] preload-error:', p, err);
  });
  diagnosticsControlWindow.webContents.on('did-fail-load', (e, code, desc) => {
    console.error('[Diag Control] did-fail-load:', code, desc);
  });
  diagnosticsControlWindow.loadFile(path.join(__dirname, 'diagnostics', 'ui', 'control.html'));
  // Show WITHOUT stealing focus, so the main window stays foreground and keeps rendering
  // (and thus keeps being sampled) while this panel floats beside it.
  diagnosticsControlWindow.once('ready-to-show', () => {
    if (diagnosticsControlWindow && !diagnosticsControlWindow.isDestroyed()) diagnosticsControlWindow.showInactive();
  });
  diagnosticsControlWindow.on('closed', () => { diagnosticsControlWindow = null; });
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const WALLPAPERS_DIR = path.join(app.getPath('userData'), 'wallpapers');
const FOLDER_STATE_PATH = path.join(app.getPath('userData'), 'folder-state.json');

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
async function downloadWallpaperFromUrl(url, fetchOptions = {}) {
  await fs.promises.mkdir(WALLPAPERS_DIR, { recursive: true });
  const res = await fetch(url, fetchOptions);
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

// Gelbooru credentials are bundled only with official/local builds and stay in
// a gitignored file. If absent or rejected, the search path falls back to the
// public Danbooru adapter instead of disabling the Internet source.
function loadBundledGelbooruCredentials() {
  try {
    const k = require('./gelbooru-key.json');
    const userId = String(k && (k.userId || k.user_id) || '').trim();
    const apiKey = String(k && (k.apiKey || k.api_key) || '').trim();
    return userId && apiKey ? { userId, apiKey } : null;
  } catch { return null; }
}
const BUNDLED_GELBOORU_CREDENTIALS = loadBundledGelbooruCredentials();

// Дефолты + load/migrate/save вынесены в ./src/config.js (тестируется: test/config.test.js).
let config = configMod.freshDefaults();
let slideshowPositionDirty = false;

function loadConfig() {
  config = configMod.load(CONFIG_PATH);
}

function saveConfig() {
  configMod.save(config, CONFIG_PATH);
  slideshowPositionDirty = false;
  broadcastConfig();
}

// Stable, anonymised install id for Lumina Cloud usage stats (anonymous users).
// Generated once (32 hex chars), persisted in config; never contains personal data.
// Written directly (no broadcast) — it is main-only and the renderer never reads it.
function ensureAnonId() {
  if (/^[A-Za-z0-9_-]{8,128}$/.test(config.anonId || '')) return;
  config.anonId = crypto.randomBytes(16).toString('hex');
  configMod.save(config, CONFIG_PATH);
}

function persistSlideshowPosition() {
  if (!slideshowPositionDirty) return;
  configMod.save(config, CONFIG_PATH);
  slideshowPositionDirty = false;
}

// Discovery history is intentionally separate from config.json: a folder may
// contain thousands of paths, while config remains small user-facing settings.
let liveFolderState = folderState.emptyState();
let folderStateDirty = false;
let folderStateSaveTimer = null;
let liveFolderAspectTimer = null;
const pendingLiveFolderAspects = new Map();
let folderRefreshQueue = Promise.resolve();
const folderScanFreshAt = new Map();
const FOLDER_SCAN_FRESH_MS = 5000;
const FOLDER_STATE_SAVE_DEBOUNCE_MS = 5000;
const LIVE_FOLDER_ASPECT_FLUSH_MS = 750;
let liveFolderWatcher = null;
const liveFolderWatcherRetryTimers = new Map();
let liveFolderFullScanTimer = null;
let liveFolderLastFullScanAt = 0;
const LIVE_FOLDER_FULL_SCAN_MS = 60 * 60 * 1000;

function loadLiveFolderState() {
  try {
    const loaded = folderState.loadState(FOLDER_STATE_PATH);
    liveFolderState = loaded.state;
    if (loaded.recovered) {
      console.warn('folder-state.json повреждён; создан безопасный новый индекс.', loaded.brokenPath || '');
    }
  } catch (err) {
    liveFolderState = folderState.emptyState();
    console.error('Не удалось загрузить folder-state.json:', err);
  }
}

function flushLiveFolderState() {
  if (folderStateSaveTimer) { clearTimeout(folderStateSaveTimer); folderStateSaveTimer = null; }
  if (!folderStateDirty) return;
  try {
    liveFolderState = folderState.saveState(FOLDER_STATE_PATH, liveFolderState);
    folderStateDirty = false;
  } catch (err) {
    console.error('Не удалось сохранить folder-state.json:', err);
  }
}

function scheduleLiveFolderStateSave() {
  folderStateDirty = true;
  if (folderStateSaveTimer) clearTimeout(folderStateSaveTimer);
  folderStateSaveTimer = setTimeout(flushLiveFolderState, FOLDER_STATE_SAVE_DEBOUNCE_MS);
  if (folderStateSaveTimer && typeof folderStateSaveTimer.unref === 'function') folderStateSaveTimer.unref();
}

function flushPendingLiveFolderAspects() {
  if (liveFolderAspectTimer) { clearTimeout(liveFolderAspectTimer); liveFolderAspectTimer = null; }
  if (!pendingLiveFolderAspects.size) return 0;
  const updates = Array.from(pendingLiveFolderAspects.values());
  pendingLiveFolderAspects.clear();
  const result = folderState.setAspects(liveFolderState, updates);
  liveFolderState = result.state;
  if (result.changed) scheduleLiveFolderStateSave();
  // A live-folder image may already be materialized in the pool (favorite/assigned).
  // Keep that additive metadata in sync too, otherwise "All" would omit the
  // folder-backed record and fall back to an unstable default aspect after restart.
  let configChanged = false;
  for (const update of updates) {
    const id = library.idFor(update.path);
    if (library.setAspect(config.library, id, update.path, update.aspect)) configChanged = true;
  }
  // Metadata backfill must not broadcast config: rebuilding the visible grid here
  // would reintroduce the very movement this batch is intended to remove.
  if (configChanged) configMod.save(config, CONFIG_PATH);
  return result.updated;
}

function queueLiveFolderAspect(p, aspect) {
  const value = Number(aspect);
  if (!p || typeof p !== 'string' || !Number.isFinite(value) || value <= 0 || !isPathUnderLiveFolder(p)) return;
  let key;
  try { key = path.resolve(p).toLowerCase(); } catch { return; }
  pendingLiveFolderAspects.set(key, { path: p, aspect: value });
  if (liveFolderAspectTimer) return;
  liveFolderAspectTimer = setTimeout(flushPendingLiveFolderAspects, LIVE_FOLDER_ASPECT_FLUSH_MS);
  if (liveFolderAspectTimer && typeof liveFolderAspectTimer.unref === 'function') liveFolderAspectTimer.unref();
}

function forgetLiveFolders(ids) {
  const state = folderState.normalizeState(liveFolderState);
  let removed = false;
  for (const id of (ids || [])) {
    if (id && state.folders[id]) { delete state.folders[id]; removed = true; }
    folderScanFreshAt.delete(id);
  }
  liveFolderState = state;
  if (removed) scheduleLiveFolderStateSave();
}

function forgetLiveFolder(id) {
  forgetLiveFolders([id]);
}

function liveFolderItems() {
  return Object.values(config.library || {}).filter((item) => item && item.type === 'folder' && item.id && item.path);
}

function pathExists(p) {
  try { return !!(p && fs.existsSync(p)); } catch { return false; }
}

function dirExists(p) {
  try { return !!(p && fs.statSync(p).isDirectory()); } catch { return false; }
}

function isPathUnderLiveFolder(p) {
  return liveFolderItems().some((folder) => library.isPathInsideRoot(p, folder.path));
}

function pruneConfirmedMissingLiveFolderImages() {
  let ids = [];
  try {
    ids = library.findConfirmedMissingLiveFolderImageIds(
      config.library,
      folderState.listImages(liveFolderState),
      pathExists,
      dirExists
    );
  } catch (err) {
    console.error('Не удалось проверить missing-файлы живых папок:', err);
    return 0;
  }
  let removed = 0;
  for (const id of ids) {
    if (removeFromLibrary(id)) removed++;
  }
  if (removed) {
    // Do not call applyForTheme here: removing a vanished live-folder source should
    // clean the UI/playlist, but the currently displayed desktop may stay until the
    // next manual or scheduled wallpaper change.
    saveConfig();
    trayCtl.refresh();
  }
  return removed;
}

function syncLiveFolderWatchers() {
  if (!liveFolderWatcher) return { watched: 0, failed: 0 };
  return liveFolderWatcher.sync(liveFolderItems());
}

function broadcastLiveFolderChanges(summaries) {
  const changed = (Array.isArray(summaries) ? summaries : []).filter((summary) => summary && summary.changed);
  if (!changed.length || !mainWindow || mainWindow.isDestroyed()) return;
  diagCountSend('live-folders-changed');
  mainWindow.webContents.send('live-folders-changed', {
    folderIds: changed.map((summary) => summary.id),
  });
}

// Serialize scans globally. Besides avoiding duplicate disk work, this prevents
// two async scans from reconciling against stale copies of the same state object.
function refreshLiveFolders(folderIds = null, force = false) {
  const requested = Array.isArray(folderIds) ? new Set(folderIds) : null;
  const run = async () => {
    const items = Object.values(config.library || {}).filter((it) => it && it.type === 'folder'
      && (!requested || requested.has(it.id)));
    const summaries = [];
    for (const item of items) {
      if (!force && Date.now() - (folderScanFreshAt.get(item.id) || 0) < FOLDER_SCAN_FRESH_MS) continue;
      const scanNow = Date.now();
      let changed = false;
      let added = 0;
      let removed = 0;
      let batchNotified = false;

      const reconcile = (status, entries, notify = false) => {
        const current = library.getItem(config.library, item.id);
        if (!current || current.type !== 'folder' || current.path !== item.path) return null;
        const result = folderState.reconcileFolder(liveFolderState, {
          folderId: item.id,
          rootPath: item.path,
          folderAddedAt: item.addedAt,
          now: scanNow,
          status,
          entries,
        });
        liveFolderState = result.state;
        if (result.changed) scheduleLiveFolderStateSave();
        changed = changed || result.contentChanged;
        added += result.added;
        removed += result.removed;
        if (notify && result.contentChanged) {
          broadcastLiveFolderChanges([{ id: item.id, changed: true }]);
          batchNotified = true;
        }
        return result;
      };

      const scan = await folderState.scanFolderTree(item.path, {
        imageExts: playlist.IMG_EXTS,
        batchSize: 10000,
        knownPaths: folderState.knownPathKeys(liveFolderState, item.id),
        onBatch: async (entries) => { reconcile('partial', entries, true); },
      });
      folderScanFreshAt.set(item.id, Date.now());
      // Journal-only (no popup): an unplugged disk is tolerated per LF-QA1, but the
      // journal should explain why a live folder stopped updating. Per-folder channel
      // so one broken folder does not mask another.
      if (scan.status === 'unavailable') {
        reportChannelFailure(`live-folder:${item.id}`, 'journal.liveFolder', {
          notify: false,
          params: { name: path.basename(item.path) },
        });
      } else {
        reportChannelSuccess(`live-folder:${item.id}`, 'journal.liveFolder', {
          params: { name: path.basename(item.path) },
        });
      }
      if (scan.status === 'unavailable' && liveFolderWatcher) liveFolderWatcher.restart(item.id);
      const finalResult = reconcile(scan.status, scan.entries);
      if (!finalResult) continue;
      summaries.push({
        id: item.id,
        status: scan.status,
        changed,
        added,
        removed,
        // Full batches have already notified the renderer. A final remainder or
        // deletion still needs one notification after the completed scan.
        notified: batchNotified && !finalResult.contentChanged,
      });
    }
    const pruned = pruneConfirmedMissingLiveFolderImages();
    if (pruned) {
      summaries.push({ id: 'library', status: 'pruned', changed: true, added: 0, removed: pruned });
    }
    broadcastLiveFolderChanges(summaries.filter((summary) => !summary.notified));
    return summaries;
  };
  folderRefreshQueue = folderRefreshQueue.then(run, run);
  return folderRefreshQueue;
}

function requestLiveFolderRefresh(folderIds = null) {
  refreshLiveFolders(folderIds).catch((err) => console.error('Не удалось обновить индекс живых папок:', err));
}

function startLiveFolderWatchers() {
  if (liveFolderWatcher) liveFolderWatcher.closeAll();
  liveFolderWatcher = liveFolderWatch.createController({
    debounceMs: 1500,
    onChange: async (folderId) => {
      await refreshLiveFolders([folderId], true);
    },
    onError: (folderId, err) => {
      console.warn(`[LiveFolders] watcher unavailable for ${folderId}:`, err && (err.message || err));
      if (liveFolderWatcherRetryTimers.has(folderId)) return;
      const retry = setTimeout(() => {
        liveFolderWatcherRetryTimers.delete(folderId);
        syncLiveFolderWatchers();
        refreshLiveFolders([folderId], true)
          .catch((scanErr) => console.error(`[LiveFolders] retry scan failed for ${folderId}:`, scanErr));
      }, 15000);
      liveFolderWatcherRetryTimers.set(folderId, retry);
      if (retry && typeof retry.unref === 'function') retry.unref();
    },
  });
  return syncLiveFolderWatchers();
}

function liveFolderWindowVisible() {
  return !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized());
}

function scheduleLiveFolderFullScan(reason, delayMs) {
  if (liveFolderFullScanTimer) clearTimeout(liveFolderFullScanTimer);
  liveFolderFullScanTimer = setTimeout(async () => {
    liveFolderFullScanTimer = null;
    const visibleOnly = reason === 'hourly' || reason === 'window-visible';
    if (visibleOnly && !liveFolderWindowVisible()) {
      scheduleLiveFolderFullScan('hourly', LIVE_FOLDER_FULL_SCAN_MS);
      return;
    }
    syncLiveFolderWatchers();
    try {
      await refreshLiveFolders(null, true);
      liveFolderLastFullScanAt = Date.now();
    } catch (err) {
      console.error(`[LiveFolders] ${reason} reconciliation failed:`, err);
    } finally {
      scheduleLiveFolderFullScan('hourly', LIVE_FOLDER_FULL_SCAN_MS);
    }
  }, Math.max(0, Number(delayMs) || 0));
  if (liveFolderFullScanTimer && typeof liveFolderFullScanTimer.unref === 'function') {
    liveFolderFullScanTimer.unref();
  }
}

function reconcileLiveFoldersIfStale() {
  if (Date.now() - liveFolderLastFullScanAt < LIVE_FOLDER_FULL_SCAN_MS) return;
  scheduleLiveFolderFullScan('window-visible', 2000);
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
    setWindowsTheme(wantDark).then(
      () => reportChannelSuccess('theme-schedule', 'journal.themeSchedule'),
      (e) => {
        console.error('Не удалось сменить тему Windows:', e);
        reportChannelFailure('theme-schedule', 'journal.themeSchedule', {
          titleKey: 'notify.themeFailedTitle',
          bodyKey: 'notify.themeFailedBody',
        });
      }
    );
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

function ensureSlideshowPosition(monitorId) {
  if (!config.slideshowIndex[monitorId]) config.slideshowIndex[monitorId] = { light: 0, dark: 0 };
  if (!config.slideshowCurrentPath[monitorId]) config.slideshowCurrentPath[monitorId] = { light: '', dark: '' };
}

function storeSlideshowPosition(monitorId, theme, position) {
  ensureSlideshowPosition(monitorId);
  const index = Number.isFinite(position.index) ? position.index : 0;
  const p = typeof position.path === 'string' ? position.path : '';
  if (config.slideshowIndex[monitorId][theme] !== index || config.slideshowCurrentPath[monitorId][theme] !== p) {
    config.slideshowIndex[monitorId][theme] = index;
    config.slideshowCurrentPath[monitorId][theme] = p;
    slideshowPositionDirty = true;
  }
}

function resolveSlideshowPosition(monitorId, theme, options = {}) {
  const list = playlist.resolveSlot(slotFor(monitorId, theme), config.library, {
    forceFolderScan: !!options.forceFolderScan,
  });
  if (!list.length) return { list, index: 0, path: '' };
  ensureSlideshowPosition(monitorId);
  const position = playlist.reconcilePosition(
    list,
    config.slideshowCurrentPath[monitorId][theme],
    config.slideshowIndex[monitorId][theme],
    options
  );
  storeSlideshowPosition(monitorId, theme, position);
  return { list, ...position };
}

// Current path follows the saved path first and uses the legacy index only as fallback.
function currentImageFor(monitorId, theme) {
  return resolveSlideshowPosition(monitorId, theme).path;
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
  const m = config.monitors && config.monitors[monitorId];
  const slot = m && m[theme];
  if (!library.allowsLegacyFallback(slot)) return '';
  // Легаси-fallback нужен старым конфигам, но не после явной очистки слота пользователем.
  return (theme === 'dark' ? config.darkWallpaper : config.lightWallpaper) || '';
}

// Windows' IDesktopWallpaper renders a blank/solid desktop for a large PNG — it accepts the
// path without error but fails to decode/cache it past ~10-20 MB (a 21 MB PNG applies as a
// placeholder, though thumbnails are fine; small PNGs set fine). JPEG has no such limit. So a
// big NON-JPEG file is re-encoded to a FULL-RESOLUTION, maximum-quality JPEG (never downscaled)
// and that is applied; JPEGs and small files are used as-is, untouched. Cached in
// userData/wp-cache (key = path+size+mtime). Best-effort — any failure falls back to the original.
const WP_CACHE_DIR = path.join(app.getPath('userData'), 'wp-cache');
const WP_SAFE_BYTES = 10 * 1024 * 1024; // below this a PNG sets fine; above it we convert to JPEG
async function ensureWallpaperReady(srcPath) {
  const ext = path.extname(srcPath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return srcPath; // JPEG has no size limit — apply as-is
  let st;
  try { st = fs.statSync(srcPath); } catch { return srcPath; }
  if (st.size <= WP_SAFE_BYTES) return srcPath; // small enough — keep the ORIGINAL file, untouched
  try {
    const key = crypto.createHash('md5').update(`${srcPath}|${st.size}|${Math.floor(st.mtimeMs)}`).digest('hex').slice(0, 16);
    const dest = path.join(WP_CACHE_DIR, `wp-full-${key}.jpg`);
    if (fs.existsSync(dest)) return dest;
    const img = nativeImage.createFromPath(srcPath);
    if (img.isEmpty()) return srcPath;
    const jpeg = img.toJPEG(100); // FULL resolution, MAXIMUM quality — JPEG bypasses the PNG limit
    if (!jpeg || !jpeg.length) return srcPath;
    fs.mkdirSync(WP_CACHE_DIR, { recursive: true });
    fs.writeFileSync(dest, jpeg);
    const sz = img.getSize();
    console.log(`[Wallpaper] converted large ${ext} to full-res JPEG q100: ${(st.size / 1048576).toFixed(1)} MB → ${(jpeg.length / 1048576).toFixed(1)} MB at ${sz.width}x${sz.height}`);
    return dest;
  } catch (e) { console.error('ensureWallpaperReady:', e); return srcPath; }
}

// Thin diagnostics wrapper (span #6 of the MVP-A budget): every wallpaper apply is
// recorded with its duration and outcome; call sites keep using applyForTheme().
async function applyForTheme(themeName, isManual = false, targetMonitors = null) {
  const endSpan = diagSpan('wallpaper', 'apply');
  try {
    const result = await applyForThemeCore(themeName, isManual, targetMonitors);
    // Only known short reasons; a raw error message may carry a file path and
    // redaction does not exist until stage 4.
    const reason = result && result.ok ? 'ok' : ((result && result.reason) || 'error');
    endSpan({ status: ['ok', 'gamemode-blocked', 'no-wallpaper'].includes(reason) ? reason : 'error' });
    reportApplyOutcome(result, isManual); // journal + edge-triggered notification (T2/T3)
    return result;
  } catch (err) {
    endSpan({ status: 'error' });
    reportApplyOutcome({ ok: false, reason: 'exception' }, isManual);
    throw err;
  }
}

async function applyForThemeCore(themeName, isManual = false, targetMonitors = null) {
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
      if (p && fs.existsSync(p)) items.push({ id: m.id, path: await ensureWallpaperReady(p) });
    }
    persistSlideshowPosition();
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

// Advance from the saved path in a freshly scanned playlist. If the current file
// disappeared, reconcilePosition keeps its old index as the successor position.
function advanceIndices(theme, targetMonitors = null) {
  const shuffle = config.slideshow.order === 'shuffle';
  const primary = config.singleWallpaper ? primaryMonitorId() : null;
  const sources = primary ? monitorsCache.filter((m) => m.id === primary) : monitorsCache;
  for (const m of sources) {
    if (!config.singleWallpaper && targetMonitors && !targetMonitors.includes(m.id)) continue;
    resolveSlideshowPosition(m.id, theme, {
      advance: true,
      shuffle,
      forceFolderScan: true,
    });
  }
}

// advance=true сдвигает кадр; false — просто применить текущее и (пере)запланировать.
function slideshowIntervalEnabled() {
  return !!(config.slideshow && config.slideshow.enabled && playlist.usesInterval(config.slideshow));
}

function slideshowIntervalMs() {
  const mins = Math.max(1, Math.floor(Number(config.slideshow && config.slideshow.intervalMin) || 30));
  return mins * 60000;
}

function scheduleSlideshowTimer(delayMs = slideshowIntervalMs()) {
  clearSlideshowTimer();
  if (!slideshowIntervalEnabled()) return;
  slideshowTimer = setTimeout(runSlideshowInterval, Math.max(1, Math.floor(Number(delayMs) || slideshowIntervalMs())));
}

function retrySlideshowIntervalSoon() {
  clearSlideshowTimer();
  if (!config.slideshow || !config.slideshow.enabled) return;
  slideshowTimer = setTimeout(runSlideshowInterval, 60000);
}

async function runSlideshowInterval() {
  slideshowTimer = null;
  if (!slideshowIntervalEnabled()) return;
  if (config.gameModeBlock && await isGameOrFullscreenRunning()) {
    console.log('[GameMode] Slideshow rotation blocked. Will retry in 1 minute.');
    retrySlideshowIntervalSoon();
    return;
  }
  if (stealthScoped('interval')) {
    requestWallpaperAdvance('interval', { initialDelayMs: 0, rescheduleInterval: true });
    return;
  }
  await tickSlideshow(true, false);
}

// Returns the applyForTheme result on the paths that actually apply, so manual
// triggers (Home button, hotkey) can report an honest outcome to the user.
// Auto-only early exits keep returning undefined — their callers ignore it.
async function tickSlideshow(advance, isManual = false) {
  clearSlideshowTimer();
  if (!config.slideshow || !config.slideshow.enabled) return;
  const intervalEnabled = slideshowIntervalEnabled();
  // A timer may already be queued when the user disables the interval trigger.
  if (advance && !isManual && !intervalEnabled) return;

  if (!isManual && config.gameModeBlock && await isGameOrFullscreenRunning()) {
    console.log('[GameMode] Slideshow rotation blocked. Will retry in 1 minute.');
    retrySlideshowIntervalSoon();
    return { ok: false, reason: 'gamemode-blocked' };
  }

  const theme = wallpaperThemeName();
  if (advance) { advanceIndices(theme); saveConfig(); }
  const result = await applyForTheme(theme, isManual);
  if (intervalEnabled) scheduleSlideshowTimer();
  return result;
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
      additionalArguments: diagRendererArgs('renderer-main'),
      // In diagnostics mode keep rAF running while the window is merely unfocused (the
      // floating control window must not zero out smoothness sampling). The probe still
      // stops counting when the window is genuinely hidden/minimized.
      backgroundThrottling: !DIAGNOSTICS_BOOTSTRAP.enabled,
    },
  });

  if (diagnosticsController) diagnosticsController.attachWindowEvents(mainWindow, 'main');

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] ${message} (${sourceId}:${line})`);
  });

  mainWindow.once('ready-to-show', () => {
    if (!STARTED_HIDDEN) mainWindow.show();
  });

  mainWindow.on('show', reconcileLiveFoldersIfStale);

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

function sanitizeGalleryPayload(payload) {
  return galleryPayloadMod.sanitizeGalleryPayload(payload);
}

function createGalleryWindow() {
  // Span #5 of the MVP-A budget: viewer window creation → ready-to-show.
  const endOpenSpan = diagSpan('viewer', 'open-to-ready', { count: galleryPayload.items.length });
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = display.workArea || display.bounds;
  galleryWindowNormalBounds = { ...bounds };
  galleryWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 640,
    minHeight: 420,
    show: false,
    frame: false,
    thickFrame: false,
    autoHideMenuBar: true,
    title: 'Lumina Media Viewer',
    backgroundColor: '#050505',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'viewer-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      additionalArguments: diagRendererArgs('renderer-viewer'),
    },
  });

  if (diagnosticsController) diagnosticsController.attachWindowEvents(galleryWindow, 'viewer');

  galleryWindow.loadFile(path.join(__dirname, 'renderer', 'viewer.html'));

  galleryWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Viewer Console] ${message} (${sourceId}:${line})`);
  });

  galleryWindow.once('ready-to-show', () => {
    endOpenSpan();
    if (!galleryWindow || galleryWindow.isDestroyed()) return;
    galleryWindow.show();
    bringToFront(galleryWindow);
  });

  galleryWindow.on('enter-full-screen', () => {
    galleryWindowFullscreen = true;
    if (galleryWindow && !galleryWindow.isDestroyed()) galleryWindow.webContents.send('gallery-fullscreen-changed', true);
  });
  galleryWindow.on('leave-full-screen', () => {
    galleryWindowFullscreen = false;
    if (galleryWindow && !galleryWindow.isDestroyed()) galleryWindow.webContents.send('gallery-fullscreen-changed', false);
  });

  galleryWindow.on('closed', () => {
    galleryWindow = null;
    galleryWindowNormalBounds = null;
    galleryWindowFullscreen = false;
  });
}

function openGalleryWindow(payload) {
  galleryPayload = sanitizeGalleryPayload(payload);
  galleryPayload.background = config.viewerBackground || 'ambient';
  if (!galleryPayload.items.length) return { ok: false, error: 'empty' };
  if (!galleryWindow || galleryWindow.isDestroyed()) {
    createGalleryWindow();
  } else {
    diagCountSend('gallery-payload');
    galleryWindow.webContents.send('gallery-payload', galleryPayload);
    bringToFront(galleryWindow);
  }
  return { ok: true };
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

// "Invisible" (stealth) wallpaper changes wait for a fullscreen window over a monitor before
// swapping its wallpaper. The cancelable wait/retry/timeout state machine lives in the tested
// src/stealth-session.js; here we inject the real timers, monitor list, coverage check and the
// apply. A single session exists at a time, so two automatic events (e.g. wake + a theme flip)
// can't double-advance; a manual change calls cancelPendingStealth() to supersede a pending one.
const stealthCtl = createStealthController({
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h),
  getMonitors: async () => (monitorsCache.length ? monitorsCache : await getMonitors()).map((m) => m.id),
  checkCovered: async () => { try { return await wpHost.checkMaximized(2000); } catch { return []; } },
  apply: async ({ theme, monitors, advance }) => {
    console.log(`[Stealth] applying ${theme} ${advance ? '(new frame)' : '(current frame)'} on`, monitors);
    if (advance) { advanceIndices(theme, monitors); saveConfig(); }
    await applyForTheme(theme, true, monitors);
  },
  pollMs: 3000,
  log: (...a) => console.log('[Stealth]', ...a),
});

// The non-stealth path keeps a single delayed auto-advance (not the session controller).
let autoAdvanceTimer = null;
function cancelPendingStealth() {
  stealthCtl.cancel();
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
}

// Stealth config helpers (the field is an object since v1.4.3: enabled + per-reason scopes + timeout).
function stealthCfg() { return (config.triggers && config.triggers.stealth) || {}; }
function stealthScoped(reason) { const s = stealthCfg(); return !!s.enabled && !!s[reason]; }
function stealthTimeoutMs() {
  const m = Number(stealthCfg().timeoutMin);
  return (Number.isFinite(m) && m >= 1 ? Math.min(60, Math.floor(m)) : 5) * 60000;
}

function rescheduleSlideshowAfterManualWallpaperChange() {
  if (slideshowIntervalEnabled()) scheduleSlideshowTimer();
}

// Single entry point for every AUTOMATIC wallpaper advance (startup / wakeup / interval). With stealth on
// for that reason it routes through the one cancelable session; otherwise it advances after a
// short settle delay, as before.
function requestWallpaperAdvance(reason, options = {}) {
  if (!config.slideshow || !config.slideshow.enabled) return;
  const initialDelayMs = Number.isFinite(+options.initialDelayMs)
    ? Math.max(0, Math.floor(+options.initialDelayMs))
    : 5000;
  const rescheduleInterval = !!options.rescheduleInterval;
  if (rescheduleInterval) clearSlideshowTimer();
  const scoped = stealthScoped(reason);
  console.log(`[Stealth] advance requested: ${reason} (stealth ${scoped ? 'ON' : 'off'})`);
  if (scoped) {
    stealthCtl.request({
      theme: wallpaperThemeName(),
      advance: true,
      single: !!config.singleWallpaper,
      timeoutMs: stealthTimeoutMs(),
      initialDelayMs, // boot/resume settle for startup/wakeup; interval uses 0.
      onComplete: rescheduleInterval ? () => scheduleSlideshowTimer() : null,
    });
  } else {
    if (autoAdvanceTimer) clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = setTimeout(() => {
      autoAdvanceTimer = null;
      if (!config.slideshow || !config.slideshow.enabled) return;
      triggerNextWallpaper();
    }, initialDelayMs);
  }
}

async function triggerNextWallpaper(targetMonitors = null) {
  cancelPendingStealth(); // a manual "next" supersedes any pending stealth/auto advance
  if (config.singleWallpaper) targetMonitors = null;
  const theme = wallpaperThemeName();
  if (config.slideshow && config.slideshow.enabled && !targetMonitors) {
    return tickSlideshow(true, true);
  } else {
    advanceIndices(theme, targetMonitors);
    saveConfig();
    try {
      return await applyForTheme(theme, true, targetMonitors);
    } finally {
      rescheduleSlideshowAfterManualWallpaperChange();
    }
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
  // Always tag the login launch with --autostart so the "on Windows startup" trigger fires
  // ONLY for a real login (not a manual relaunch). --hidden stays tied to startMinimized and
  // controls window visibility only. Both ride a single --process-start-args string.
  const startArgs = ['--autostart'];
  if (config.startMinimized) startArgs.push('--hidden');
  const args = ['--processStart', exeName, '--process-start-args', startArgs.join(' ')];
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
    diagCountSend('config-changed');
    mainWindow.webContents.send('config-changed', config);
  }
}

function broadcastTheme(opts = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('theme-changed', currentThemeName(), { silent: !!opts.silent });
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

// Event journal (plan error_notifications T3): entries carry i18n KEYS + params —
// the renderer localizes them, so the stored history survives a language switch.
ipcMain.handle('event-log-get', () => ({ entries: eventLog.list() }));
ipcMain.handle('event-log-clear', async () => { await eventLog.clear(); return { entries: [] }; });

// Lumina Cloud capability (C2). Resolved once: staging is reachable ONLY from an
// unpackaged dev build with an explicit opt-in; all normal launches use production.
// The renderer receives only the safe subset — never the API URL or any token.
let _cloudCapability = null;
function cloudCapability() {
  if (!_cloudCapability) {
    _cloudCapability = cloudCapabilityMod.resolveCapability({
      isPackaged: app.isPackaged,
      // `npm run dev:cloud` sets this; trim guards the Windows `set VAR=x` trailing-space gotcha.
      stagingOptIn: (process.env.LUMINA_CLOUD || '').trim() === 'staging',
    });
  }
  return _cloudCapability;
}
ipcMain.handle('get-cloud-capability', () => cloudCapabilityMod.publicCapability(cloudCapability()));

// Lumina Cloud catalog client (C3). Created lazily with the REAL fetch and the
// capability-decided apiBase — only when the environment is staging/production.
// In 'unavailable' there is no apiBase, so no client and no network ever happens.
let _cloudClient = null;
function cloudClient() {
  const base = cloudCapability().apiBase;
  if (!base) return null; // unavailable → no client, no requests
  if (!_cloudClient) _cloudClient = cloudClientMod.createClient({ baseUrl: base, anonId: config.anonId });
  return _cloudClient;
}

// ---- Lumina Cloud session (C4) -------------------------------------------------
// The session token lives ONLY in main: encrypted at rest via safeStorage (DPAPI),
// never in config.json and never sent to the renderer. The renderer gets only the
// public profile + entitlements through cloudAuthState().
let _cloudToken = null;          // in-memory bearer token (never crosses IPC to renderer)
let _cloudUser = null;           // cached { user, entitlements } from /v1/me
const cloudSessionPath = () => path.join(app.getPath('userData'), 'cloud-session.bin');

function loadStoredToken() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const p = cloudSessionPath();
    if (!fs.existsSync(p)) return null;
    return safeStorage.decryptString(fs.readFileSync(p)) || null;
  } catch { return null; }
}
function saveStoredToken(token) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false; // no DPAPI → keep in memory only
    fs.writeFileSync(cloudSessionPath(), safeStorage.encryptString(token));
    return true;
  } catch (err) { console.error('cloud token save:', err); return false; }
}
function clearStoredToken() {
  try { fs.rmSync(cloudSessionPath(), { force: true }); } catch {}
}

// Renderer-safe auth state (no token).
function cloudAuthState() {
  return {
    available: !!cloudCapability().apiBase,
    signedIn: !!_cloudToken && !!_cloudUser,
    user: _cloudUser ? _cloudUser.user : null,
    entitlements: _cloudUser ? _cloudUser.entitlements : [],
  };
}
function broadcastCloudSession() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cloud-session-changed', cloudAuthState());
}

// A protected call returned a normalized result. If it's a 401, the session is dead:
// drop the token everywhere and tell the renderer. Returns true if it was an auth error.
function cloudHandleAuthError(result) {
  if (result && result.ok === false && result.error && result.error.status === 401) {
    _cloudToken = null; _cloudUser = null; clearStoredToken();
    broadcastCloudSession();
    return true;
  }
  return false;
}

// Bring up a one-shot loopback listener, open the system browser at the Google start
// URL, and resolve with the one-time exchange code from the redirect (RFC 8252).
function runLoopbackSignin(challenge) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const code = cloudOauth.parseLoopbackCode(req.url);
      res.writeHead(code ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(loopbackHtml(!!code));
      if (code) { cleanup(); resolve(code); }
    });
    let done = false;
    const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 5 * 60 * 1000);
    function cleanup() { if (done) return; done = true; clearTimeout(timer); try { server.close(); } catch {} }
    server.on('error', (err) => { cleanup(); reject(err); });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const url = cloudClientMod.buildGoogleStartUrl(cloudCapability().apiBase, { port, challenge });
      shell.openExternal(url).catch((err) => { cleanup(); reject(err); });
    });
  });
}

function loopbackHtml(okCode) {
  const msg = okCode ? 'Готово! Можете закрыть эту вкладку и вернуться в Lumina.' : 'Код авторизации не получен. Вернитесь в Lumina и попробуйте снова.';
  return `<!doctype html><meta charset="utf-8"><title>Lumina</title><body style="font-family:Segoe UI,system-ui,sans-serif;background:#fafafa;color:#2e3436;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="margin:0 0 8px">Lumina</h2><p>${msg}</p></div></body>`;
}

// Catalog page (renderer never calls the API directly — everything goes through here).
ipcMain.handle('cloud-catalog', async (e, opts) => {
  const client = cloudClient();
  if (!client) return { items: [], nextCursor: null, error: 'unavailable' };
  const o = opts || {};
  const rating = ['general', 'suggestive', 'explicit'].includes(o.rating) ? o.rating : 'general';
  const tag = typeof o.tag === 'string' && o.tag.trim() ? o.tag.trim() : undefined;
  const r = await client.getCatalog({ rating, tag, cursor: o.cursor || undefined, limit: 30, token: _cloudToken || undefined });
  if (!r.ok) {
    cloudHandleAuthError(r);
    return { items: [], nextCursor: null, error: r.error.code, kind: r.error.kind };
  }
  return { items: r.data.items, nextCursor: r.data.next_cursor, error: null };
});

// Download a catalog image into the local Library — fetches a FRESH signed URL at
// click time (never a stale catalog thumb URL), then reuses the existing safe import.
ipcMain.handle('cloud-add', async (e, item) => {
  const client = cloudClient();
  if (!client) return { config, error: 'unavailable' };
  if (!item || !item.id) return { config, error: 'badItem' };
  try {
    const dl = await client.getDownload(item.id, { token: _cloudToken || undefined });
    if (!dl.ok) { cloudHandleAuthError(dl); return { config, error: dl.error.code }; }
    const stored = await downloadWallpaperFromUrl(dl.data.url);
    const aspect = item.width > 0 && item.height > 0 ? item.width / item.height : 0;
    const id = library.addPath(config.library, 'image', stored, { aspect });
    const it = config.library[id];
    if (it) it.source = 'lumina:' + item.id; // stable marker for the "added ✓" indicator
    saveConfig();
    return { config, id, error: null };
  } catch (err) {
    console.error('cloud add:', err);
    return { config, error: 'download' };
  }
});

// Current auth state (renderer-safe). If a stored token exists but the profile isn't
// loaded yet, validate it against /v1/me (a dead/expired token is dropped silently).
ipcMain.handle('cloud-session', async () => {
  const client = cloudClient();
  if (_cloudToken && !_cloudUser && client) {
    const me = await client.getMe(_cloudToken);
    if (me.ok) _cloudUser = me.data;
    else if (cloudHandleAuthError(me)) { /* token cleared */ }
  }
  return cloudAuthState();
});

// Google sign-in: PKCE + loopback + system browser + exchange → store token, load /me.
ipcMain.handle('cloud-signin', async () => {
  const client = cloudClient();
  if (!client) return { ok: false, error: 'unavailable' };
  try {
    const { verifier, challenge } = cloudOauth.generatePkce();
    const code = await runLoopbackSignin(challenge);
    const ex = await client.exchangeAuth({ code, pkce_verifier: verifier, client_label: `Lumina on ${os.hostname()}` });
    if (!ex.ok) return { ok: false, error: ex.error.code };
    _cloudToken = ex.data.session_token;
    saveStoredToken(_cloudToken);
    const me = await client.getMe(_cloudToken);
    _cloudUser = me.ok ? me.data : { user: ex.data.user, entitlements: [] };
    broadcastCloudSession();
    return { ok: true, state: cloudAuthState() };
  } catch (err) {
    const msg = err && /timeout/.test(String(err.message)) ? 'timeout' : 'signin_failed';
    console.error('cloud signin:', err);
    return { ok: false, error: msg };
  }
});

// Sign out: revoke the session server-side (best effort) and drop the local token.
ipcMain.handle('cloud-signout', async () => {
  const client = cloudClient();
  const token = _cloudToken;
  _cloudToken = null; _cloudUser = null; clearStoredToken();
  if (client && token) { try { await client.logout(token); } catch {} }
  broadcastCloudSession();
  return { ok: true, state: cloudAuthState() };
});

// Cloud favorites (C5) — account-synced, distinct from the local Library favorites.
// All require a session; a 401 drops it. add/remove are idempotent on the backend.
ipcMain.handle('cloud-favorites', async () => {
  const client = cloudClient();
  if (!client) return { items: [], error: 'unavailable' };
  if (!_cloudToken) return { items: [], error: 'missing_token' };
  const r = await client.getFavorites(_cloudToken);
  if (!r.ok) { cloudHandleAuthError(r); return { items: [], error: r.error.code }; }
  return { items: r.data.items, error: null };
});

ipcMain.handle('cloud-favorite', async (e, id, on) => {
  const client = cloudClient();
  if (!client) return { ok: false, error: 'unavailable' };
  if (!_cloudToken) return { ok: false, error: 'missing_token' };
  if (!id) return { ok: false, error: 'badItem' };
  const r = on ? await client.addFavorite(id, _cloudToken) : await client.removeFavorite(id, _cloudToken);
  if (!r.ok) { cloudHandleAuthError(r); return { ok: false, error: r.error.code }; }
  return { ok: true, error: null };
});

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
  if (patch && patch.triggers && Object.prototype.hasOwnProperty.call(patch.triggers, 'stealth')) {
    const s = config.triggers && config.triggers.stealth;
    if (!s || s.enabled === false) cancelPendingStealth();
  }
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
  if (patch && 'viewerBackground' in patch && galleryWindow && !galleryWindow.isDestroyed()) {
    diagCountSend('gallery-background');
    galleryWindow.webContents.send('gallery-background', config.viewerBackground);
  }
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
  library.clearSlotExplicitEmpty(slot);
  return true;
}

// Удалить элемент из пула И из всех слотов, которые на него ссылаются (без висячих id).
function removeFromLibrary(id) {
  const item = library.getItem(config.library, id);
  if (!library.removeItem(config.library, id)) return false;
  for (const [monitorId, m] of Object.entries(config.monitors || {})) {
    for (const th of ['light', 'dark']) {
      if (m[th] && Array.isArray(m[th].itemIds)) {
        const before = m[th].itemIds.length;
        m[th].itemIds = m[th].itemIds.filter((x) => x !== id);
        if (before > 0 && m[th].itemIds.length === 0) {
          library.markSlotExplicitEmpty(m[th]);
          storeSlideshowPosition(monitorId, th, { index: 0, path: '' });
        }
      }
    }
  }
  if (item && item.type === 'folder') forgetLiveFolder(id);
  if (item && item.type === 'folder') syncLiveFolderWatchers();
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
  syncLiveFolderWatchers();
  requestLiveFolderRefresh([library.idFor(dir)]);
  return { config, added: 1 };
});

// add multiple dropped file paths (files or folders) to a monitor's playlist
ipcMain.handle('add-slot-paths', async (e, monitorId, which, paths) => {
  if (!monitorId || !Array.isArray(paths)) return { config, added: 0 };
  const slot = ensureSlot(monitorId, which);
  let added = 0;
  const folderIds = [];
  for (const src of paths) {
    try {
      const stats = fs.statSync(src);
      if (stats.isDirectory()) {
        if (assignToSlot(slot, 'folder', src)) added++;
        folderIds.push(library.idFor(src));
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
  if (folderIds.length) syncLiveFolderWatchers();
  if (folderIds.length) requestLiveFolderRefresh(folderIds);
  return { config, added };
});

ipcMain.handle('remove-slot-item', (e, monitorId, which, index) => {
  if (!monitorId) return config;
  const theme = which === 'dark' ? 'dark' : 'light';
  const slot = ensureSlot(monitorId, which);
  if (index >= 0 && index < slot.itemIds.length) {
    slot.itemIds.splice(index, 1);
    if (slot.itemIds.length === 0) {
      library.markSlotExplicitEmpty(slot);
      storeSlideshowPosition(monitorId, theme, { index: 0, path: '' });
    }
  }
  saveConfig();
  gcWallpapers();
  trayCtl.refresh();
  return config;
});

ipcMain.handle('clear-slot', (e, monitorId, which) => {
  if (!monitorId) return config;
  const theme = which === 'dark' ? 'dark' : 'light';
  const slot = ensureSlot(monitorId, which);
  slot.itemIds = [];
  library.markSlotExplicitEmpty(slot);
  storeSlideshowPosition(monitorId, theme, { index: 0, path: '' });
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
  const id = library.addPath(config.library, 'folder', res.filePaths[0]);
  const added = Object.keys(config.library).length - before;
  if (added) saveConfig();
  if (id) syncLiveFolderWatchers();
  if (id) requestLiveFolderRefresh([id]);
  return { config, added };
});

// Добавить перетащенные пути (файлы/папки) в пул.
ipcMain.handle('library-add-paths', async (e, paths) => {
  if (!Array.isArray(paths)) return { config, added: 0 };
  const before = Object.keys(config.library).length;
  const folderIds = [];
  for (const src of paths) {
    try {
      const stats = fs.statSync(src);
      if (stats.isDirectory()) {
        const id = library.addPath(config.library, 'folder', src);
        if (id) folderIds.push(id);
      } else if (stats.isFile() && playlist.IMG_EXTS.has(path.extname(src).toLowerCase())) {
        library.addPath(config.library, 'image', await importWallpaper(src));
      }
    } catch (err) { console.error('library: drop import failed', src, err); }
  }
  const added = Object.keys(config.library).length - before;
  if (added) saveConfig();
  if (folderIds.length) syncLiveFolderWatchers();
  if (folderIds.length) requestLiveFolderRefresh(folderIds);
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

ipcMain.handle('library-remove-many', async (e, rawIds) => {
  if (!Array.isArray(rawIds) || !rawIds.length || rawIds.length > 50000) {
    return { config, removed: 0, error: 'bad_request', warning: null };
  }
  const ids = Array.from(new Set(rawIds.filter((id) => typeof id === 'string' && id)));
  const items = ids.map((id) => library.getItem(config.library, id));
  // Destructive batches are all-or-nothing at the model boundary. Never silently
  // remove only a prefix or the subset that happened to remain valid.
  if (items.length !== ids.length || items.some((item) => !item)) {
    return { config, removed: 0, error: 'missing_item', warning: null };
  }
  const idSet = new Set(ids);
  for (const id of ids) library.removeItem(config.library, id);
  for (const [monitorId, monitor] of Object.entries(config.monitors || {})) {
    for (const theme of ['light', 'dark']) {
      const slot = monitor[theme];
      if (!slot || !Array.isArray(slot.itemIds)) continue;
      const before = slot.itemIds.length;
      slot.itemIds = slot.itemIds.filter((id) => !idSet.has(id));
      if (before > 0 && slot.itemIds.length === 0) {
        library.markSlotExplicitEmpty(slot);
        storeSlideshowPosition(monitorId, theme, { index: 0, path: '' });
      }
    }
  }
  const removedFolders = items.filter((item) => item.type === 'folder');
  if (removedFolders.length) forgetLiveFolders(removedFolders.map((item) => item.id));
  if (removedFolders.length) syncLiveFolderWatchers();
  saveConfig();
  gcWallpapers();
  trayCtl.refresh();
  let warning = null;
  try { await applyForTheme(null, true); }
  catch (err) {
    warning = 'apply_failed';
    console.error('bulk library removal apply failed:', err);
  }
  return { config, removed: ids.length, error: null, warning };
});

ipcMain.handle('library-toggle-favorite', (e, id) => {
  library.toggleFavorite(config.library, id);
  saveConfig();
  return config;
});

// Refresh discovery metadata and drop missing standalone images. Folder sources are
// never removed merely because a disk is currently offline or access is denied.
ipcMain.handle('library-refresh', async () => {
  await refreshLiveFolders(null, true);
  liveFolderLastFullScanAt = Date.now();
  scheduleLiveFolderFullScan('hourly', LIVE_FOLDER_FULL_SCAN_MS);
  const staleLive = pruneConfirmedMissingLiveFolderImages();
  const dead = library.findMissingIds(config.library, (p) => {
    try { return fs.existsSync(p); } catch { return false; }
  }).filter((id) => {
    const item = library.getItem(config.library, id);
    return item && item.type === 'image' && !isPathUnderLiveFolder(item.path);
  });
  let removed = 0;
  for (const id of dead) { if (removeFromLibrary(id)) removed++; }
  if (removed) {
    saveConfig();
    trayCtl.refresh();
    applyForTheme(null, true); // a removed item may have been the current wallpaper
  }
  return { config, removed: removed + staleLive };
});

// Заполнить размеры файлов (байты) для сортировки «по размеру» — лениво, по запросу.
// Считаем только для image-элементов без size; folder/недоступные → 0.
ipcMain.handle('library-ensure-sizes', async () => {
  // Async stat (NOT statSync): a synchronous loop here blocks the whole main process —
  // and a single pool image on a slow/disconnected drive would freeze the entire app
  // the first time the user sorts by size.
  let changed = false;
  for (const it of Object.values(config.library || {})) {
    if (it && it.type === 'image' && it.path && typeof it.size !== 'number') {
      try { it.size = (await fs.promises.stat(it.path)).size; } catch { it.size = 0; }
      changed = true;
    }
  }
  if (changed) saveConfig();
  return config;
});

// On-demand byte sizes for ephemeral folder images (files living in a watched folder
// that are NOT pool items, so they have no cached size). Used only by the renderer's
// "Largest first" sort. Async + cached so sorting a 1000+ folder never blocks the main
// loop and never re-stats a path twice in a session. Returns [{ path, size }].
const pathSizeCache = new Map(); // lowercased path -> size in bytes
const PATH_SIZE_CACHE_CAP = 50000;
ipcMain.handle('library-path-sizes', async (e, paths) => {
  const list = Array.isArray(paths) ? paths : [];
  const out = [];
  const pending = [];
  for (const p of list) {
    if (!p || typeof p !== 'string') continue;
    const key = p.toLowerCase();
    if (pathSizeCache.has(key)) out.push({ path: p, size: pathSizeCache.get(key) });
    else pending.push({ p, key });
  }
  const CONCURRENCY = 24; // bounded so a huge folder doesn't open thousands of FDs at once
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const slice = pending.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(async ({ p, key }) => {
      let size = 0;
      try { size = (await fs.promises.stat(p)).size; } catch { size = 0; }
      if (pathSizeCache.size > PATH_SIZE_CACHE_CAP) {
        const k0 = pathSizeCache.keys().next().value;
        pathSizeCache.delete(k0);
      }
      pathSizeCache.set(key, size);
      out.push({ path: p, size });
    }));
  }
  return out;
});

ipcMain.handle('library-add-tag', (e, id, tag) => {
  if (library.addTag(config.library, id, tag)) saveConfig();
  return config;
});

ipcMain.handle('library-remove-tag', (e, id, tag) => {
  if (library.removeTag(config.library, id, tag)) saveConfig();
  return config;
});

async function finalizeLibraryAssignment(result, theme) {
  saveConfig();
  const createdIds = new Set(result.createdIds || (result.created ? [result.id] : []));
  const createdFolders = (result.items || (result.item ? [result.item] : []))
    .filter((item) => item && item.type === 'folder' && createdIds.has(item.id))
    .map((item) => item.id);
  if (createdFolders.length) {
    syncLiveFolderWatchers();
    requestLiveFolderRefresh(createdFolders);
  }
  trayCtl.refresh();
  // Assigning a new image to the active monitor×theme changes the current frame → drop any
  // pending stealth advance so it can't overwrite this choice moments later.
  let warning = null;
  if (theme === wallpaperThemeName()) {
    cancelPendingStealth();
    try {
      await applyForTheme(theme, true);
    } catch (err) {
      // The pool + slot transaction is already durably saved. Surface application
      // trouble as a warning instead of lying to the renderer that assignment failed.
      warning = 'apply_failed';
      console.error('library assignment apply failed:', err);
    } finally {
      rescheduleSlideshowAfterManualWallpaperChange();
    }
  }
  return warning;
}

// Назначить элемент пула на монитор×тему (добавляет в плейлист слота) + применить, если тема активна.
async function commitLibraryAssignmentRecord(record, monitorId, which, options = {}) {
  const theme = which === 'dark' ? 'dark' : 'light';
  const known = record && (library.getItem(config.library, record.id)
    || library.getItem(config.library, library.idFor(record.path)));
  if (known && known.type === 'image' && !pathExists(known.path)) {
    return { config, ok: false, error: 'missing_file' };
  }
  const result = libraryAssignment.assignRecord(config, record, monitorId, theme, options);
  if (!result.ok) return result;
  const warning = await finalizeLibraryAssignment(result, theme);
  return { ...result, config, warning };
}

ipcMain.handle('library-assign', async (e, id, monitorId, which) => {
  return commitLibraryAssignmentRecord({ id }, monitorId, which);
});

// ---- Internet providers: Wallhaven + Gelbooru, with Danbooru fallback ----

const GELBOORU_PAGE_SIZE = 100;
const DANBOORU_PAGE_SIZE = 100;
const INTERNET_USER_AGENT = `Lumina/${app.getVersion()} (https://github.com/alexvlass01/lumina)`;
const INTERNET_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
const INTERNET_THUMBNAIL_CACHE_SIZE = 200;
const INTERNET_FULL_MAX_BYTES = 30 * 1024 * 1024; // viewer full image (wallpapers can be large)
const INTERNET_TAG_SUGGEST_CACHE_SIZE = 200;
const internetThumbnailCache = new Map();
const internetTagSuggestCache = new Map();

ipcMain.handle('internet-status', () => ({
  hasKey: !!wallhavenKey(),
  bundled: !!BUNDLED_WALLHAVEN_KEY,
  // Gelbooru and the Danbooru fallback cover Explicit even when Wallhaven has
  // no bundled API key.
  nsfwAvailable: true,
}));

async function fetchInternetTagSuggestions(opts) {
  const prefix = tagSuggest.normalizeTagPrefix(opts && opts.q);
  if (prefix.length < tagSuggest.MIN_PREFIX_LEN) return { items: [], error: null };

  const limit = tagSuggest.clampLimit(opts && opts.limit);
  const cacheKey = `${prefix}|${limit}`;
  if (internetTagSuggestCache.has(cacheKey)) {
    const cached = internetTagSuggestCache.get(cacheKey);
    internetTagSuggestCache.delete(cacheKey);
    internetTagSuggestCache.set(cacheKey, cached);
    return cached;
  }

  const url = tagSuggest.buildGelbooruTagSuggestUrl({ q: prefix, limit });
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': INTERNET_USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { items: [], error: String(res.status) };
    const json = await res.json();
    const result = {
      items: tagSuggest.parseGelbooruTagSuggestions(json, { prefix, limit }),
      error: null,
    };
    internetTagSuggestCache.set(cacheKey, result);
    while (internetTagSuggestCache.size > INTERNET_TAG_SUGGEST_CACHE_SIZE) {
      internetTagSuggestCache.delete(internetTagSuggestCache.keys().next().value);
    }
    return result;
  } catch (err) {
    console.error('gelbooru tag suggest:', err);
    return { items: [], error: err && err.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}

ipcMain.handle('internet-tag-suggest', (e, opts) => fetchInternetTagSuggestions(opts));

async function searchWallhavenProvider(opts) {
  const o = opts || {};
  const key = wallhavenKey();
  const p = o.purity || { sfw: true, sketchy: true, nsfw: false };
  const wantNsfw = !!p.nsfw && !!key;
  if (!p.sfw && !p.sketchy && !wantNsfw) {
    return { provider: 'wallhaven', items: [], meta: { currentPage: o.page || 1, lastPage: o.page || 1 }, error: null };
  }
  const purity = wallhaven.purityMask({ sfw: !!p.sfw, sketchy: !!p.sketchy, nsfw: wantNsfw });
  const url = wallhaven.buildSearchUrl({
    q: o.q || '',
    purity,
    categories: o.categories || '111',
    sorting: o.sort || o.sorting || 'date_added',
    page: o.page || 1,
    apikey: wantNsfw ? key : '',
  });
  try {
    const res = await fetch(url, { headers: { 'User-Agent': INTERNET_USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { provider: 'wallhaven', items: [], meta: {}, error: String(res.status) };
    const json = await res.json();
    return { provider: 'wallhaven', ...wallhaven.parseSearch(json), error: null };
  } catch (err) {
    console.error('wallhaven search:', err);
    return { provider: 'wallhaven', items: [], meta: {}, error: err && err.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}

async function searchDanbooruProvider(opts) {
  const o = opts || {};
  const page = Number(o.page) > 0 ? Number(o.page) : 1;
  const url = danbooru.buildSearchUrl({
    q: o.q || '',
    purity: o.purity,
    sorting: o.sort || o.sorting || 'date_added',
    page,
    limit: DANBOORU_PAGE_SIZE,
  });
  try {
    const res = await fetch(url, { headers: { 'User-Agent': INTERNET_USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { provider: 'danbooru', items: [], meta: {}, error: String(res.status) };
    const json = await res.json();
    return { provider: 'danbooru', ...danbooru.parseSearch(json, { page, limit: DANBOORU_PAGE_SIZE }), error: null };
  } catch (err) {
    console.error('danbooru search:', err);
    return { provider: 'danbooru', items: [], meta: {}, error: err && err.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}

async function searchGelbooruProvider(opts) {
  const o = opts || {};
  const page = Number(o.page) > 0 ? Number(o.page) : 1;
  const credentials = BUNDLED_GELBOORU_CREDENTIALS;
  if (!credentials) return { provider: 'gelbooru', items: [], meta: {}, error: 'unavailable' };
  const url = gelbooru.buildSearchUrl({
    q: o.q || '',
    purity: o.purity,
    sorting: o.sort || o.sorting || 'date_added',
    page,
    limit: GELBOORU_PAGE_SIZE,
    ...credentials,
  });
  try {
    const res = await fetch(url, { headers: { 'User-Agent': INTERNET_USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { provider: 'gelbooru', items: [], meta: {}, error: String(res.status) };
    const json = await res.json();
    const apiError = gelbooru.responseError(json);
    if (apiError) return { provider: 'gelbooru', items: [], meta: {}, error: apiError };
    return { provider: 'gelbooru', ...gelbooru.parseSearch(json, { page, limit: GELBOORU_PAGE_SIZE }), error: null };
  } catch (err) {
    console.error('gelbooru search:', err);
    return { provider: 'gelbooru', items: [], meta: {}, error: err && err.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}

async function searchBooruProvider(opts) {
  const primary = await searchGelbooruProvider(opts);
  if (!online.providerFailed(primary)) return primary;
  const fallback = await searchDanbooruProvider(opts);
  const resolved = online.resolveFallback(primary, fallback);
  if (!online.providerFailed(resolved)) {
    console.warn(`gelbooru unavailable (${primary.error}); using danbooru fallback`);
  }
  return resolved;
}

ipcMain.handle('internet-search', async (e, opts) => {
  const o = opts || {};
  const page = Number(o.page) > 0 ? Number(o.page) : 1;
  const results = await Promise.all([searchWallhavenProvider({ ...o, page }), searchBooruProvider({ ...o, page })]);
  const merged = online.mergeSearchResults(results, page);
  return {
    ...merged,
    hasKey: !!wallhavenKey(),
    nsfwAvailable: true,
  };
});

function internetRequestHeaders(item) {
  const headers = { 'User-Agent': INTERNET_USER_AGENT };
  if (item && item.provider === 'gelbooru') headers.Referer = 'https://gelbooru.com/';
  return headers;
}

async function fetchInternetThumbnail(item) {
  if (!online.allowedThumbnailUrl(item)) return { dataUrl: '', error: 'badItem' };
  const key = item.thumb;
  if (internetThumbnailCache.has(key)) {
    const cached = internetThumbnailCache.get(key);
    internetThumbnailCache.delete(key);
    internetThumbnailCache.set(key, cached);
    return cached;
  }

  const pending = (async () => {
    try {
      const res = await fetch(key, {
        headers: internetRequestHeaders(item),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return { dataUrl: '', error: String(res.status) };
      const mime = online.thumbnailMime(res.headers.get('content-type'));
      const declaredSize = Number(res.headers.get('content-length')) || 0;
      if (!mime || declaredSize > INTERNET_THUMBNAIL_MAX_BYTES) return { dataUrl: '', error: 'badImage' };
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > INTERNET_THUMBNAIL_MAX_BYTES) return { dataUrl: '', error: 'badImage' };
      const dataUrl = online.thumbnailDataUrl(bytes, mime);
      return dataUrl ? { dataUrl, error: null } : { dataUrl: '', error: 'badImage' };
    } catch (err) {
      return { dataUrl: '', error: err && err.name === 'TimeoutError' ? 'timeout' : 'network' };
    }
  })();

  internetThumbnailCache.set(key, pending);
  while (internetThumbnailCache.size > INTERNET_THUMBNAIL_CACHE_SIZE) {
    internetThumbnailCache.delete(internetThumbnailCache.keys().next().value);
  }
  const result = await pending;
  if (result.error) internetThumbnailCache.delete(key);
  return result;
}

// Booru CDNs may reject direct Chromium requests. Fetch only validated preview
// URLs in main and return a small data URL to renderer.
ipcMain.handle('internet-thumbnail', (e, item) => fetchInternetThumbnail(item));

// Full image for the viewer. Booru hosts (esp. Gelbooru's hotlink.php) need a Referer
// the renderer can't send, so main fetches the validated full URL and returns a data
// URL. Wallhaven loads directly in the viewer, so this is only used for booru items.
// Shared referer-gated, size-capped fetch → data URL. Used for both the sample
// (intermediate) and full (original) tiers; the viewer shows sample first and
// upgrades to full in the background to keep navigation fast and frugal.
async function fetchInternetImageUrl(item, url) {
  try {
    const res = await fetch(url, {
      headers: internetRequestHeaders(item),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return { dataUrl: '', error: String(res.status) };
    const mime = online.thumbnailMime(res.headers.get('content-type'));
    if (!mime) return { dataUrl: '', error: 'badImage' };
    if ((Number(res.headers.get('content-length')) || 0) > INTERNET_FULL_MAX_BYTES) return { dataUrl: '', error: 'tooBig' };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > INTERNET_FULL_MAX_BYTES) return { dataUrl: '', error: 'tooBig' };
    const dataUrl = online.thumbnailDataUrl(bytes, mime);
    return dataUrl ? { dataUrl, error: null } : { dataUrl: '', error: 'badImage' };
  } catch (err) {
    return { dataUrl: '', error: err && err.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}

async function fetchInternetFull(item) {
  if (!online.allowedFullFetchUrl(item)) return { dataUrl: '', error: 'badItem' };
  return fetchInternetImageUrl(item, item.full);
}
ipcMain.handle('internet-full', (e, item) => fetchInternetFull(item));

// Intermediate "sample" tier (booru downscale). Same host/referer rules as full.
async function fetchInternetSample(item) {
  if (!online.allowedSampleFetchUrl(item)) return { dataUrl: '', error: 'badItem' };
  return fetchInternetImageUrl(item, item.sample);
}
ipcMain.handle('internet-sample', (e, item) => fetchInternetSample(item));

// Download a normalized provider item into the local pool. The renderer cannot
// turn this into an arbitrary downloader: provider and CDN host must match.
ipcMain.handle('internet-add', async (e, item, query) => {
  if (!online.allowedDownloadUrl(item)) return { config, error: 'badItem' };
  try {
    const stored = await downloadWallpaperFromUrl(item.full, { headers: internetRequestHeaders(item) });
    const width = Number(item.width); const height = Number(item.height);
    const aspect = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : 0;
    const id = library.addPath(config.library, 'image', stored, { aspect });
    const it = config.library[id];
    if (it) {
      it.source = online.allowedPageUrl(item) ? item.page : '';
      if (typeof item.artist === 'string' && item.artist.trim()) it.author = item.artist.trim().slice(0, 120);
      (Array.isArray(item.tags) ? item.tags : []).slice(0, 24).forEach((tag) => {
        if (typeof tag === 'string') library.addTag(config.library, id, tag.slice(0, 80));
      });
      String(query || '').slice(0, 500).split(/[\s,]+/).filter(Boolean).slice(0, 20)
        .forEach((tag) => library.addTag(config.library, id, tag.slice(0, 80)));
    }
    saveConfig();
    return { config, id, error: null };
  } catch (err) {
    console.error('internet add:', err);
    return { config, error: 'download' };
  }
});

// resolved current image for a slot (renderer can't scan folders itself)
ipcMain.handle('current-image', (e, monitorId, which) => {
  const theme = which === 'dark' ? 'dark' : 'light';
  const id = config.singleWallpaper ? primaryMonitorId() : monitorId;
  const p = currentImageFor(id, theme);
  persistSlideshowPosition();
  return p;
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
// при даунскейле. Вместе с URL держим размер thumbnail: его пропорция совпадает с оригиналом
// и нужна justified-сетке. Windows cache принимает scalar width, поэтому LRU-key = "путь|W".
const thumbCache = new Map();
const thumbPending = new Map();
// Diagnostics observes every thumbnail job (queue wait + run + depth) through the
// optional task-queue hooks; with diagnostics off the hook body is a null-check.
const runThumbnailTask = createTaskQueue(2, {
  onSettle: ({ ok, startedAt, waitMs, runMs, pending, active }) => diagEvent({
    kind: 'span',
    category: 'task-queue',
    name: 'thumbnail-task',
    timestampMs: startedAt,
    durationMs: runMs,
    attributes: { status: ok ? 'ok' : 'error', waitMs, pending, active },
  }),
});
const THUMB_CAP = 800;
function cachedThumb(key) {
  const hit = thumbCache.get(key);
  if (hit === undefined) return undefined;
  thumbCache.delete(key);
  thumbCache.set(key, hit);
  return hit;
}
async function thumbnailData(p, w, h, priority = 0) {
  if (!p || typeof p !== 'string' || p.includes('\0') || !path.isAbsolute(p)) {
    return { url: '', width: 0, height: 0 };
  }
  const requestedWidth = Number(w);
  const requestedHeight = Number(h);
  const W = Number.isFinite(requestedWidth) ? Math.max(16, Math.min(1024, Math.round(requestedWidth))) : 320;
  const H = Number.isFinite(requestedHeight) ? Math.max(16, Math.min(1024, Math.round(requestedHeight))) : 200;
  const key = `${p}|${W}`;
  const hit = cachedThumb(key);
  if (hit !== undefined) {
    if (hit.width > 0 && hit.height > 0) queueLiveFolderAspect(p, hit.width / hit.height);
    return hit;
  }
  const pending = thumbPending.get(key);
  if (pending) return pending;
  const job = runThumbnailTask(async () => {
    const lateHit = cachedThumb(key);
    if (lateHit !== undefined) {
      if (lateHit.width > 0 && lateHit.height > 0) queueLiveFolderAspect(p, lateHit.width / lateHit.height);
      return lateHit;
    }
    let data = { url: '', width: 0, height: 0 };
    let cacheable = true;
    // Extraction and encoding run in the isolated Windows helper. Main keeps only
    // the lightweight JSONL round-trip and the bounded in-memory result cache.
    const endRequest = diagSpan('thumbnail', 'helper-roundtrip', { width: W, height: H });
    try {
      const result = await thumbnailHost.thumbnail(p, W, 82);
      const mime = result && result.mime === 'image/png' ? 'image/png' : 'image/jpeg';
      const body = result && typeof result.dataBase64 === 'string' ? result.dataBase64 : '';
      const width = Number(result && result.width) || 0;
      const height = Number(result && result.height) || 0;
      if (body && width > 0 && height > 0) {
        data = { url: 'data:' + mime + ';base64,' + body, width, height };
      }
      endRequest({
        status: data.url ? 'ok' : 'empty',
        bytes: Number(result && result.encodedBytes) || 0,
        width,
        height,
        windowsCache: String(result && result.windowsCache || ''),
      });
    } catch (error) {
      cacheable = !(error && error.retriable);
      endRequest({ status: 'error', errorCode: String(error && error.code || 'helper_failed') });
    }
    if (cacheable) {
      thumbCache.set(key, data);
      if (thumbCache.size > THUMB_CAP) {
        const k0 = thumbCache.keys().next().value;
        thumbCache.delete(k0);
      }
    }
    if (data.width > 0 && data.height > 0) queueLiveFolderAspect(p, data.width / data.height);
    return data;
  }, { priority }).finally(() => {
    thumbPending.delete(key);
  });
  thumbPending.set(key, job);
  return job;
}
function isTrustedThumbnailSender(event) {
  return !!(event && mainWindow && !mainWindow.isDestroyed()
    && event.sender === mainWindow.webContents);
}
ipcMain.handle('thumb', async (e, p, w, h) => {
  if (!isTrustedThumbnailSender(e)) return '';
  const data = await thumbnailData(p, w, h);
  return data.url;
});
ipcMain.handle('thumb-info', (e, p, w, h, priority) => (
  isTrustedThumbnailSender(e) ? thumbnailData(p, w, h, priority) : { url: '', width: 0, height: 0 }
));

// Resolve proportions before renderer inserts the next justified-grid chunk. A small
// worker pool avoids hammering Windows shell with dozens of simultaneous thumbnail jobs.
// Pool-item aspects are persisted as additive metadata; folder-expanded images are
// persisted separately in folder-state by thumbnailData's batched backfill.
ipcMain.handle('thumb-aspects', async (e, entries, w, h) => {
  if (!isTrustedThumbnailSender(e)) return [];
  const input = Array.isArray(entries) ? entries.slice(0, 100) : [];
  const result = new Array(input.length);
  let cursor = 0;
  let changed = false;
  const worker = async () => {
    while (cursor < input.length) {
      const index = cursor++;
      const entry = input[index] || {};
      const p = typeof entry.path === 'string' ? entry.path : '';
      const data = await thumbnailData(p, w, h);
      const aspect = data.width > 0 && data.height > 0 ? data.width / data.height : 0;
      result[index] = { path: p, aspect };
      if (aspect && entry.id && library.setAspect(config.library, entry.id, p, aspect)) changed = true;
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, input.length) }, () => worker()));
  // Internal metadata backfill must not broadcast config and restart the visible
  // library render that requested it.
  if (changed) configMod.save(config, CONFIG_PATH);
  return result;
});

// Look up one path's discovery metadata ({ firstSeenAt, modifiedAt, ... }) in the live
// folder index, or null if it isn't a watched-folder image. Used when materializing so
// the new pool item keeps the date Lumina first saw the file.
function liveFolderDiscovery(p) {
  if (!p || typeof p !== 'string') return null;
  const key = p.toLowerCase();
  try {
    for (const im of folderState.listImages(liveFolderState)) {
      if (im && im.path && String(im.path).toLowerCase() === key) return im;
    }
  } catch {}
  return null;
}

// Содержимое папки для навигации ВНУТРЬ библиотеки: подпапки + картинки (один уровень).
// Span #1 of the MVP-A diagnostics budget.
ipcMain.handle('folder-entries', (e, dir) => {
  const endSpan = diagSpan('library', 'folder-entries');
  try {
    const { folders, images } = playlist.scanFolderEntries(dir);
    // Attach discovery/modified dates from the live-folder index so the renderer can
    // sort the folder like "All" (newest first, etc.) instead of in readdir order.
    const meta = new Map();
    try {
      for (const im of folderState.listImages(liveFolderState)) {
        if (im && im.path) meta.set(String(im.path).toLowerCase(), im);
      }
    } catch {}
    const result = {
      folders: folders.map((p) => ({ path: p, name: path.basename(p) })),
      images: images.map((p) => {
        const m = meta.get(String(p).toLowerCase());
        return {
          path: p,
          addedAt: (m && m.addedAt) || 0,
          modifiedAt: (m && m.modifiedAt) || 0,
          aspect: (m && m.aspect) || 0,
        };
      }),
      count: images.length,
    };
    endSpan({ count: images.length, status: 'ok' });
    return result;
  } catch {
    endSpan({ status: 'error' });
    return { folders: [], images: [], count: 0 };
  }
});

// Metadata-rich flat expansion for the "All" view. Pool images are omitted because
// renderer already has their full records; live-folder entries carry discovery dates.
// Span #2 of the MVP-A diagnostics budget.
ipcMain.handle('expand-folders', async () => {
  const endSpan = diagSpan('library', 'expand-folders');
  try {
    const indexed = folderState.listImages(liveFolderState);
    const images = library.ephemeralFolderImages(config.library, indexed);
    endSpan({ count: images.length, status: 'ok' });
    return { images };
  } catch (err) {
    endSpan({ status: 'error' });
    console.error('expand-folders:', err);
    return { images: [] };
  }
});

ipcMain.handle('library-recent', async (e, limit) => {
  try {
    const indexed = folderState.listImages(liveFolderState);
    return { items: library.recentImages(config.library, indexed, limit) };
  } catch (err) {
    console.error('library-recent:', err);
    return { items: library.recentImages(config.library, [], limit) };
  }
});

function liveMaterializeExtra(p, itemType, discoveryByPath = null) {
  if (itemType !== 'image') return undefined;
  const disc = discoveryByPath
    ? discoveryByPath.get(String(p || '').toLowerCase())
    : liveFolderDiscovery(p);
  return disc ? {
    addedAt: disc.firstSeenAt || disc.modifiedAt || Date.now(),
    modifiedAt: disc.modifiedAt,
    aspect: disc.aspect,
  } : undefined;
}

async function validateMaterializePath(p, itemType) {
  if (!p || typeof p !== 'string') return 'bad_request';
  let stats;
  try { stats = await fs.promises.stat(p); }
  catch { return itemType === 'folder' ? 'missing_folder' : 'missing_file'; }
  if (itemType === 'folder') return stats.isDirectory() ? null : 'missing_folder';
  return stats.isFile() && playlist.IMG_EXTS.has(path.extname(p).toLowerCase()) ? null : 'missing_file';
}

// Atomic transient assignment: validation happens before the synchronous pool+slot
// transaction, so ok:false can never leave an orphan library record behind.
ipcMain.handle('library-assign-record', async (e, rawRecord, monitorId, which) => {
  const record = rawRecord && typeof rawRecord === 'object' ? rawRecord : null;
  if (!record || !monitorId) return { config, ok: false, error: 'bad_request', id: null, created: false };
  const known = library.getItem(config.library, record.id)
    || (record.path && library.getItem(config.library, library.idFor(record.path)));
  if (known) return commitLibraryAssignmentRecord({ id: known.id }, monitorId, which);

  const itemType = record.type === 'folder' ? 'folder' : 'image';
  const error = await validateMaterializePath(record.path, itemType);
  if (error) return { config, ok: false, error, id: null, created: false };
  return commitLibraryAssignmentRecord(
    { path: record.path, type: itemType }, monitorId, which,
    { allowCreate: true, extra: liveMaterializeExtra(record.path, itemType) },
  );
});

const LIBRARY_ASSIGN_BATCH_MAX = 50000;
const LIBRARY_ASSIGN_STAT_CONCURRENCY = 24;

async function prepareLibraryAssignmentRecord(rawRecord, discoveryByPath = null) {
  const record = rawRecord && typeof rawRecord === 'object' ? rawRecord : null;
  if (!record) return { error: 'bad_request' };
  const known = library.getItem(config.library, record.id)
    || (record.path && library.getItem(config.library, library.idFor(record.path)));
  if (known) {
    if (known.type === 'image') {
      const error = await validateMaterializePath(known.path, 'image');
      if (error) return { error };
    }
    return { record: { id: known.id }, options: {} };
  }
  const itemType = record.type === 'folder' ? 'folder' : 'image';
  const error = await validateMaterializePath(record.path, itemType);
  if (error) return { error };
  return {
    record: { path: record.path, type: itemType },
    options: { allowCreate: true, extra: liveMaterializeExtra(record.path, itemType, discoveryByPath) },
  };
}

// Bulk variant: bounded filesystem validation, one pool+slot transaction, one config
// write/broadcast and at most one wallpaper apply regardless of selection size.
ipcMain.handle('library-assign-records', async (e, rawRecords, monitorId, which) => {
  if (!Array.isArray(rawRecords) || !rawRecords.length || rawRecords.length > LIBRARY_ASSIGN_BATCH_MAX || !monitorId) {
    return { config, ok: false, error: 'bad_request', assigned: 0, failed: Array.isArray(rawRecords) ? rawRecords.length : 0 };
  }
  const unique = new Map();
  for (const record of rawRecords) {
    if (!record || typeof record !== 'object') continue;
    const key = record.id || (record.path && library.idFor(record.path));
    if (key && !unique.has(key)) unique.set(key, record);
  }
  const records = Array.from(unique.values());
  // Existing pool records already carry their metadata. Avoid cloning/scanning the
  // unlimited live-folder index for the common case of assigning existing cards;
  // discovery metadata is needed only when at least one transient image is created.
  const needsDiscovery = records.some((record) => {
    const known = library.getItem(config.library, record.id)
      || (record.path && library.getItem(config.library, library.idFor(record.path)));
    return !known && record.type !== 'folder' && typeof record.path === 'string';
  });
  let discoveryByPath = null;
  if (needsDiscovery) {
    discoveryByPath = new Map();
    try {
      for (const image of folderState.listImages(liveFolderState)) {
        if (image && image.path) discoveryByPath.set(String(image.path).toLowerCase(), image);
      }
    } catch {}
  }
  const prepared = new Array(records.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < records.length) {
      const index = cursor++;
      prepared[index] = await prepareLibraryAssignmentRecord(records[index], discoveryByPath);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(LIBRARY_ASSIGN_STAT_CONCURRENCY, records.length) },
    () => worker(),
  ));
  const valid = prepared.filter((entry) => entry && !entry.error);
  const validationFailed = prepared.length - valid.length;
  if (!valid.length) {
    return { config, ok: false, error: (prepared.find((entry) => entry && entry.error) || {}).error || 'missing_item', assigned: 0, failed: validationFailed };
  }
  const theme = which === 'dark' ? 'dark' : 'light';
  const result = libraryAssignment.assignRecords(config, valid, monitorId, theme);
  result.failed += validationFailed;
  if (!result.ok) {
    return { config, ok: false, error: result.error, assigned: 0, failed: result.failed, warning: null };
  }
  const warning = await finalizeLibraryAssignment(result, theme);
  // Keep the IPC response compact: config already contains authoritative items;
  // returning duplicate ids/items arrays would double serialization for huge batches.
  return {
    config,
    ok: true,
    error: null,
    assigned: result.assigned,
    failed: result.failed,
    warning,
  };
});

// «Материализация» картинки/папки из живого источника в пул — БЕЗ копирования (по ссылке на
// оригинальный путь, как и сама папка-источник живёт по оригиналу). Нужно, чтобы назначить/★
// картинку из открытой папки: получаем настоящий id, дальше работают обычные library-assign/
// toggle-favorite/assign-меню. id = idFor(origPath) → совпадает с pool-item ⇒ нет дублей в «Все».
ipcMain.handle('library-materialize', async (e, p, type) => {
  if (!p || typeof p !== 'string') return { config, id: null };
  const itemType = type === 'folder' ? 'folder' : 'image';
  if (await validateMaterializePath(p, itemType)) return { config, id: null };
  // Inherit the discovery date from the live-folder index so assigning/★-ing a file
  // out of a watched folder does NOT mark it "just added" and jump it to the top under
  // "Newest first". Only genuinely new standalone imports (no index entry) keep now().
  const extra = liveMaterializeExtra(p, itemType);
  const id = library.addPath(config.library, itemType, p, extra);
  if (id) saveConfig();
  if (id && itemType === 'folder') {
    syncLiveFolderWatchers();
    requestLiveFolderRefresh([id]);
  }
  return { config, id };
});

ipcMain.handle('set-slideshow', (e, patch) => {
  config.slideshow = { ...config.slideshow, ...(patch || {}) };
  config.slideshow.enabled = !!config.slideshow.enabled;
  config.slideshow.intervalEnabled = config.slideshow.intervalEnabled !== false;
  if (!Number.isFinite(+config.slideshow.intervalMin) || +config.slideshow.intervalMin < 1) config.slideshow.intervalMin = 30;
  config.slideshow.intervalMin = Math.floor(+config.slideshow.intervalMin);
  if (config.slideshow.order !== 'shuffle') config.slideshow.order = 'sequential';
  if (patch && (patch.enabled === false || patch.intervalEnabled === false)) cancelPendingStealth();
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
ipcMain.handle('next-wallpaper', async (e, monitorId) => {
  // apply carries the honest outcome ({ok, reason}) so the Home button can stop
  // showing a success toast when the wallpaper did not actually change.
  const apply = await triggerNextWallpaper(monitorId ? [monitorId] : null);
  return { config, apply: apply || { ok: true } };
});

// Jump to a specific playlist item for a monitor+theme and apply immediately.
ipcMain.handle('set-slideshow-index', async (e, monitorId, theme, index) => {
  if (!monitorId) return config;
  const t = theme === 'dark' ? 'dark' : 'light';
  const list = playlist.resolveSlot(slotFor(monitorId, t), config.library, { forceFolderScan: true });
  if (!list.length) return config;
  storeSlideshowPosition(monitorId, t, playlist.reconcilePosition(list, '', Number(index)));
  saveConfig();
  if (t === wallpaperThemeName()) {
    cancelPendingStealth();
    try {
      await applyForTheme(t, true);
    } finally {
      rescheduleSlideshowAfterManualWallpaperChange();
    }
  }
  return config;
});

// «Установить именно эту картинку» по клику на миниатюру. Индекс слайдшоу адресует
// РАЗВЁРНУТЫЙ плейлист (папка = много файлов), поэтому ищем индекс по ПУТИ, а не по
// позиции в стрипе (иначе при папке в плейлисте ставится не то фото).
// Returns { config, apply } — apply is the honest outcome of the pick, so the
// Design strip can stop toasting «Applied» when the file is gone from the playlist
// or Windows rejected the wallpaper (the old shape returned config alone and the
// renderer had no way to know the click silently did nothing).
ipcMain.handle('set-slideshow-to-path', async (e, monitorId, theme, p) => {
  if (!monitorId || !p) return { config, apply: { ok: false, reason: 'not-in-playlist' } };
  const t = theme === 'dark' ? 'dark' : 'light';
  const list = playlist.resolveSlot(slotFor(monitorId, t), config.library, { forceFolderScan: true });
  const idx = list.findIndex((candidate) => String(candidate).toLowerCase() === String(p).toLowerCase());
  // путь не в развёрнутом плейлисте (исключён/файла нет)
  if (idx < 0) return { config, apply: { ok: false, reason: 'not-in-playlist' } };
  storeSlideshowPosition(monitorId, t, { index: idx, path: list[idx] });
  saveConfig();
  // Picking a specific frame is a manual choice → cancel any pending stealth advance.
  if (t === wallpaperThemeName()) {
    cancelPendingStealth();
    try {
      const apply = await applyForTheme(t, true);
      return { config, apply: apply || { ok: true } };
    } finally {
      rescheduleSlideshowAfterManualWallpaperChange();
    }
  }
  // Frame stored for the inactive theme — it will show when that theme activates.
  return { config, apply: { ok: true } };
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

ipcMain.handle('gallery-open', (e, payload) => openGalleryWindow(payload));
ipcMain.handle('gallery-payload', () => galleryPayload);
ipcMain.handle('gallery-close', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && !win.isDestroyed()) win.close();
  return { ok: true };
});
ipcMain.handle('gallery-toggle-fullscreen', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed()) return { ok: false };
  // Toggle off our own tracked flag, not win.isFullScreen() — the latter (and the
  // enter/leave-full-screen events) are unreliable for frameless windows on Windows,
  // which left the "exit fullscreen" click stuck.
  const next = !galleryWindowFullscreen;
  if (next) {
    if (!win.isFullScreen()) galleryWindowNormalBounds = win.getBounds();
    win.setFullScreen(true);
  } else {
    win.setFullScreen(false);
    if (galleryWindowNormalBounds) win.setBounds(galleryWindowNormalBounds);
  }
  galleryWindowFullscreen = next;
  // Drive the renderer UI directly (the OS events may not fire on Windows).
  if (win.webContents && !win.webContents.isDestroyed()) win.webContents.send('gallery-fullscreen-changed', next);
  return { ok: true, fullscreen: next };
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
  // Electron finalizes its default dev identity during startup, so apply the
  // Squirrel-matching ID immediately after ready and before any window/toast.
  if (process.platform === 'win32') app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);

  Menu.setApplicationMenu(null); // убираем стандартное меню File/Edit/View
  if (DIAGNOSTICS_BOOTSTRAP.enabled) {
    console.log(`[Diagnostics] enabled; userData=${DIAGNOSTICS_BOOTSTRAP.userDataPath}`);
  }
  loadConfig();
  ensureAnonId(); // generate the anonymous install id once, before any cloud request
  loadLiveFolderState();
  _cloudToken = loadStoredToken(); // restore a previous Lumina Cloud session (validated on first use)
  registerShortcut();
  ensurePsScript();
  ensureComScript();
  ensureComHostScript();
  ensureThemeScript();
  if (DIAGNOSTICS_BOOTSTRAP.enabled) {
    try {
      const { createDiagnosticsController } = require('./diagnostics/main/controller');
      const { createProcessSampler, createNodeEventLoopProviders } = require('./diagnostics/main/process-sampler');
      // Distinguish renderer processes by their OS pid so per-process CPU/memory
      // samples say WHICH window they belong to. The future diagnostics control
      // window must get its own role here (excluded from the app verdict).
      const rendererRoleForPid = (pid) => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()
            && mainWindow.webContents.getOSProcessId() === pid) return 'renderer-main';
        } catch {}
        try {
          if (galleryWindow && !galleryWindow.isDestroyed()
            && galleryWindow.webContents.getOSProcessId() === pid) return 'renderer-viewer';
        } catch {}
        try {
          if (diagnosticsControlWindow && !diagnosticsControlWindow.isDestroyed()
            && diagnosticsControlWindow.webContents.getOSProcessId() === pid) return 'renderer-diagnostics';
        } catch {}
        return '';
      };
      diagnosticsController = createDiagnosticsController({
        userDataPath: app.getPath('userData'),
        appInfo: {
          name: app.getName(),
          version: app.getVersion(),
          isPackaged: app.isPackaged,
        },
        ipcMain,
        shell,
        source: { role: 'main', pid: process.pid },
        samplerFactory: ({ record }) => createProcessSampler({
          record,
          appMetrics: () => app.getAppMetrics(),
          classifyPid: rendererRoleForPid,
          ...createNodeEventLoopProviders(),
        }),
      });
      diagnosticsController.registerIpc();
      // Force-delivery test is deliberately separate from failure policy/journal.
      // It ignores notifyOnFailure and does not create a fake failure entry: the
      // Diagnostics button answers only whether Electron -> Windows delivery works.
      ipcMain.handle('diagnostics-test-notification', () => deliverSystemNotification({
        titleKey: 'notify.testTitle',
        bodyKey: 'notify.testBody',
      }));
      diagnosticsController.attachAppEvents(app);
      diagnosticsController.attachProcessEvents(process);
      const started = await diagnosticsController.startIfNeeded('startup');
      if (started && started.ok !== false) {
        console.log(`[Diagnostics] recording; sessionDir=${diagnosticsController.status().sessionDir}`);
      } else {
        console.warn('[Diagnostics] failed to start recording:', started && started.error);
      }
      openDiagnosticsControlWindow(); // small Start/Stop/report window
    } catch (err) {
      console.error('[Diagnostics] controller failed:', err);
    }
  }

  // keep the OS login item in sync with config (openAtLogin + the --autostart/--hidden args)
  applyLoginItem();
  cleanStrayAutostartEntries(); // убрать осиротевшие dev/portable записи автозапуска (см. функцию)

  createWindow();
  trayCtl.create();
  startLiveFolderWatchers();
  scheduleLiveFolderFullScan('startup', 3000);

  // refresh monitor list when displays change (added/removed/resolution/rotation)
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(ev, async () => {
      const mons = await getMonitors();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('monitors-changed', mons);
      }
    });
  }

  lastNativeDark = nativeTheme.shouldUseDarkColors; // baseline so the first real flip is detected
  nativeTheme.on('updated', () => {
    const isDark = nativeTheme.shouldUseDarkColors;
    // Windows fires this event spuriously when a wallpaper is applied (WM_SETTINGCHANGE) with
    // the SAME light/dark value. Only a real flip should toast or re-apply wallpapers — without
    // this guard every stealth/manual wallpaper change wrongly announced "Windows switched theme".
    const reallyChanged = lastNativeDark === null ? true : (isDark !== lastNativeDark);
    lastNativeDark = isDark;
    if ((config.themeOverride === 'light' && isDark) || (config.themeOverride === 'dark' && !isDark)) {
      config.themeOverride = null;
      saveConfig();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.setTitleBarOverlay(titleBarOverlayColors()); } catch {}
    }
    trayCtl.refreshIcon();
    if (!reallyChanged) { broadcastTheme({ silent: true }); return; } // spurious event: refresh UI quietly, nothing else
    // Suppress the "Windows switched theme" toast during the startup/resume catch-up window
    // (background flip), but keep announcing genuine theme changes the user makes later.
    broadcastTheme({ silent: Date.now() < themeToastQuietUntil });
    // Wallpaper mode='system' follows Windows. Independent time/sun schedules ignore
    // nativeTheme events completely; unified mode always stays on the shared light slot.
    if (config.separateThemes !== false && config.wallpaperSchedule && config.wallpaperSchedule.mode === 'system') {
      if (config.slideshow.enabled) {
        if (stealthCtl.isActive()) {
          // A theme flip during an invisible session folds in (Option A) WITHOUT discarding the
          // session's advance intent — a wake session still shows a new photo on the new theme.
          // changeTheme() no-ops if the theme didn't actually change, so a spurious WM_SETTINGCHANGE
          // (Windows fires one when a wallpaper is applied) can't loop or clobber the session.
          stealthCtl.changeTheme(wallpaperThemeName());
        } else {
          tickSlideshow(false); // применить кадр новой темы + перепланировать
        }
      } else applyForTheme();
    }
  });

  // enumerate monitors, then apply correct wallpaper on launch
  await getMonitors();
  // NB: GC намеренно НЕ запускаем на старте — слишком опасно (см. gcWallpapers).
  // Осиротевшие файлы подчищаются только при явном удалении из библиотеки/слота, и то в .trash.
  const wallpaperMode = config.wallpaperSchedule && config.wallpaperSchedule.mode;
  const startupAction = schedule.wallpaperStartupAction(config);
  if (startupAction === 'slideshow') tickSlideshow(false); // применить текущее + запустить ротацию
  else if (startupAction === 'apply') applyForTheme();
  else if (startupAction === 'schedule') await applyWallpaperSchedule(false, true);
  else broadcastWallpaperTheme();
  if (config.slideshow.enabled && (wallpaperMode === 'time' || wallpaperMode === 'sun')) {
    await applyWallpaperSchedule(false, false);
  }

  // start theme schedule (if enabled): set the right theme now + schedule flips
  applyThemeSchedule();

  // ── Wallpaper triggers (route through requestWallpaperAdvance / stealthCtl) ──────────
  // Only a real Windows login (login item passes --autostart) counts as "on startup".
  // A manual/dev/portable launch must NOT advance the wallpaper.
  if (STARTED_AUTOSTART && config.slideshow && config.slideshow.enabled && config.triggers && config.triggers.onStartup) {
    requestWallpaperAdvance('startup');
  }

  // Switch wallpaper when the computer wakes from sleep/hibernate
  powerMonitor.on('resume', () => {
    themeToastQuietUntil = Date.now() + 10000; // resume catch-up flip must not toast
    syncLiveFolderWatchers();
    scheduleLiveFolderFullScan('resume', 5000);
    if (config.wallpaperSchedule && (config.wallpaperSchedule.mode === 'time' || config.wallpaperSchedule.mode === 'sun')) {
      applyWallpaperSchedule(false, true);
    }
    if (config.slideshow && config.slideshow.enabled && config.triggers && config.triggers.onWakeup) {
      requestWallpaperAdvance('wakeup');
    }
  });

  // background update check (installed build only); silent until an update is ready
  if (updatesSupported()) setTimeout(() => checkForUpdates(), 8000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Flush discovery metadata and dispose persistent helper processes on quit.
app.on('before-quit', () => {
  if (diagnosticsController) {
    void diagnosticsController.shutdownBestEffort({ reason: 'before-quit' });
  }
  if (liveFolderFullScanTimer) clearTimeout(liveFolderFullScanTimer);
  liveFolderFullScanTimer = null;
  for (const retry of liveFolderWatcherRetryTimers.values()) clearTimeout(retry);
  liveFolderWatcherRetryTimers.clear();
  flushPendingLiveFolderAspects();
  flushLiveFolderState();
  if (liveFolderWatcher) liveFolderWatcher.closeAll();
  void thumbnailHost.dispose();
  wpHost.dispose();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Keep running in tray after all windows are closed
app.on('window-all-closed', () => {
  // do nothing — app lives in the tray
});
