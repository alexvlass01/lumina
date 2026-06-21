'use strict';

const $ = (sel) => document.querySelector(sel);

const I18N = { dict: {}, fallback: {} };
const VIEWER = { items: [], index: 0, token: 0 };
const POINTER = { x: 0, y: 0, t: 0, button: -1, blocked: false };

// Resolved full-image sources keyed by item index, so prefetched neighbours show
// instantly on navigation. For booru this holds a (large) data: URL, so we keep a
// small radius and cap the cache, evicting the entries farthest from the current.
const FULL_CACHE = new Map();
const PREFETCHING = new Set();
const PREFETCH_RADIUS = 2;
const FULL_CACHE_MAX = 7;

function setHd(on) {
  const hd = $('#viewerHd');
  if (hd) hd.hidden = !on;
}

const LOADING_PILL_DELAY = 350;
let loadingTimer = null;

function clearLoadingTimer() {
  if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
}

// Show the "Loading…" pill only if the load is actually slow, so quick swaps
// (and prefetched neighbours) never flash the text. delay <= 0 shows it at once
// (used on first open, where there is no previous frame to keep on screen).
function scheduleLoadingPill(token, delay) {
  clearLoadingTimer();
  if (delay <= 0) {
    if (token === VIEWER.token) setState(t('viewer.loading'));
    return;
  }
  loadingTimer = setTimeout(() => {
    loadingTimer = null;
    if (token === VIEWER.token) setState(t('viewer.loading'));
  }, delay);
}

// Two crossfading <img> layers. We only ever set src on the hidden (back) layer,
// then fade it in over the visible (front) one, so frames dissolve smoothly
// instead of popping — both between photos and on the preview->full upgrade.
const STAGE = { front: null, back: null };
// The ambient backdrop uses its own pair of crossfading layers (slower, calmer).
const BG = { front: null, back: null };

function initStage() {
  STAGE.front = $('#viewerImageA');
  STAGE.back = $('#viewerImageB');
  BG.front = $('#viewerBgImgA');
  BG.back = $('#viewerBgImgB');
}

function stageHasImage() {
  return !!(STAGE.front && STAGE.front.getAttribute('src'));
}

function setStageAlt(text) {
  if (STAGE.front) STAGE.front.alt = text || '';
  if (STAGE.back) STAGE.back.alt = text || '';
}

function showImage(src) {
  const incoming = STAGE.back;
  const outgoing = STAGE.front;
  if (!incoming) return;
  incoming.src = src;
  incoming.classList.add('is-visible');
  if (outgoing) outgoing.classList.remove('is-visible');
  STAGE.front = incoming;
  STAGE.back = outgoing;
  updateBackgroundFromSrc(src);
}

function clearStage() {
  for (const layer of [STAGE.front, STAGE.back]) {
    if (!layer) continue;
    layer.classList.remove('is-visible');
    layer.removeAttribute('src');
  }
}

// Backdrop behind the photo. 'ambient'/'color' derive from the current image;
// 'charcoal'/'aurora' are pure CSS (set by the bg-* class on the viewer root).
const BG_MODES = ['ambient', 'charcoal', 'aurora', 'color'];
let bgMode = 'ambient';

function applyBackgroundMode(mode) {
  bgMode = BG_MODES.includes(mode) ? mode : 'ambient';
  const root = $('#viewerRoot');
  if (root) for (const m of BG_MODES) root.classList.toggle('bg-' + m, m === bgMode);
  const bg = $('#viewerBg');
  if (bg) bg.style.background = '';            // drop any inline color-mode gradient
  if (bgMode !== 'ambient') {
    for (const layer of [BG.front, BG.back]) {
      if (!layer) continue;
      layer.classList.remove('is-visible');
      layer.removeAttribute('src');
    }
  }
  const current = STAGE.front && STAGE.front.getAttribute('src');
  if (current) updateBackgroundFromSrc(current); // live switch while a photo is shown
}

function updateBackgroundFromSrc(src) {
  if (!src) return;
  if (bgMode === 'ambient') {
    const incoming = BG.back;
    const outgoing = BG.front;
    if (!incoming) return;
    incoming.src = src;
    incoming.classList.add('is-visible');
    if (outgoing) outgoing.classList.remove('is-visible');
    BG.front = incoming;
    BG.back = outgoing;
  } else if (bgMode === 'color') {
    applyDominantColor(src);
  }
}

function applyDominantColor(src) {
  const bg = $('#viewerBg');
  if (!bg) return;
  const probe = new Image();
  probe.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(probe, 0, 0, 16, 16);
      const { data } = ctx.getImageData(0, 0, 16, 16);
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 16) continue;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
      if (!n) return;
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      bg.style.background = `radial-gradient(circle at 50% 38%, rgba(${r}, ${g}, ${b}, 0.55), #060608 72%)`;
    } catch {
      // Tainted canvas (cross-origin direct image, e.g. Wallhaven) — neutral dark fallback.
      bg.style.background = 'radial-gradient(circle at 50% 42%, #16161c 0%, #0b0b0e 56%, #050506 100%)';
    }
  };
  probe.src = src;
}

function setFullscreenUi(on) {
  const root = $('#viewerRoot');
  if (root) root.classList.toggle('is-fullscreen', !!on);
  const btn = $('#viewerFullscreen');
  if (btn) {
    const label = t(on ? 'viewer.windowed' : 'viewer.fullscreen');
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }
}

function tPath(obj, key) {
  return key.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj);
}

function t(key, params) {
  let value = tPath(I18N.dict, key);
  if (value == null) value = tPath(I18N.fallback, key);
  if (value == null) value = key;
  if (params) for (const k in params) value = value.split('{' + k + '}').join(params[k]);
  return value;
}

async function loadI18n() {
  const info = await window.viewerApi.getI18n();
  I18N.dict = info.dict || {};
  I18N.fallback = info.fallback || {};
  if (info.locale) document.documentElement.lang = info.locale;
  const close = $('#viewerClose');
  if (close) {
    close.title = t('viewer.close');
    close.setAttribute('aria-label', t('viewer.close'));
  }
  const prev = $('#viewerPrev');
  if (prev) {
    prev.title = t('viewer.previous');
    prev.setAttribute('aria-label', t('viewer.previous'));
  }
  const next = $('#viewerNext');
  if (next) {
    next.title = t('viewer.next');
    next.setAttribute('aria-label', t('viewer.next'));
  }
  const hdText = $('#viewerHdText');
  if (hdText) hdText.textContent = t('viewer.loadingFull');
  setFullscreenUi(false);
}

function normalizePayload(payload) {
  const items = payload && Array.isArray(payload.items) ? payload.items.filter(Boolean) : [];
  const rawIndex = Number(payload && payload.index);
  return {
    items,
    index: items.length ? Math.max(0, Math.min(items.length - 1, Number.isFinite(rawIndex) ? Math.floor(rawIndex) : 0)) : 0,
  };
}

function setPayload(payload) {
  const next = normalizePayload(payload);
  VIEWER.items = next.items;
  VIEWER.index = next.index;
  FULL_CACHE.clear();
  PREFETCHING.clear();
  if (payload && payload.background) applyBackgroundMode(payload.background);
  render();
}

function currentEntry() {
  return VIEWER.items[VIEWER.index] || null;
}

function setState(message, hidden = false) {
  const state = $('#viewerState');
  if (!state) return;
  state.textContent = message || '';
  state.hidden = hidden || !message;
}

async function previewSource(entry) {
  if (!entry) return '';
  if ((entry.kind === 'library' || entry.kind === 'path') && entry.path) {
    return window.viewerApi.fileUrl(entry.path);
  }
  if (entry.kind === 'cloud') {
    return entry.previewUrl || '';
  }
  if (entry.kind === 'internet') {
    const item = entry.raw || {};
    const thumb = String(item.thumb || entry.previewUrl || '');
    if (thumb.startsWith('data:image/')) return thumb;
    try {
      const result = await window.viewerApi.internetThumbnail(item);
      if (result && result.dataUrl) return result.dataUrl;
    } catch {}
    return thumb || '';
  }
  return entry.previewUrl || '';
}

async function fullSource(entry, fallback = '') {
  if (!entry) return fallback;
  if ((entry.kind === 'library' || entry.kind === 'path') && entry.path) {
    return window.viewerApi.fileUrl(entry.path);
  }
  if (entry.kind === 'internet') {
    const item = entry.raw || {};
    const direct = String(item.full || '');
    // Wallhaven loads directly; booru hosts (e.g. Gelbooru hotlink.php) need a Referer
    // the renderer can't send, so fetch the full image through main as a data URL.
    if (item.provider && item.provider !== 'wallhaven') {
      try {
        const r = await window.viewerApi.internetFull(item);
        if (r && r.dataUrl) return r.dataUrl;
      } catch {}
    }
    return direct || fallback;
  }
  return fallback || entry.previewUrl || '';
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (!src) { reject(new Error('empty')); return; }
    const probe = new Image();
    probe.onload = () => resolve({ src, width: probe.naturalWidth, height: probe.naturalHeight });
    probe.onerror = () => reject(new Error('load'));
    probe.src = src;
  });
}

function cacheFull(index, src) {
  if (!src) return;
  FULL_CACHE.set(index, src);
  if (FULL_CACHE.size <= FULL_CACHE_MAX) return;
  const n = VIEWER.items.length || 1;
  const dist = (i) => { const d = Math.abs(i - index); return Math.min(d, n - d); };
  // Drop the entries farthest (cyclically) from the current index first.
  const order = [...FULL_CACHE.keys()].sort((a, b) => dist(b) - dist(a));
  for (const key of order) {
    if (FULL_CACHE.size <= FULL_CACHE_MAX) break;
    if (key !== index) FULL_CACHE.delete(key);
  }
}

async function prefetchIndex(index) {
  if (FULL_CACHE.has(index) || PREFETCHING.has(index)) return;
  const entry = VIEWER.items[index];
  if (!entry) return;
  PREFETCHING.add(index);
  try {
    const src = await fullSource(entry, '');
    if (!src) return;
    cacheFull(index, src);
    const warm = new Image();
    warm.src = src;
    if (warm.decode) { try { await warm.decode(); } catch {} }
  } catch {
    // Prefetch is best-effort; failures just mean a normal load on navigation.
  } finally {
    PREFETCHING.delete(index);
  }
}

function prefetchNeighbors(center) {
  const n = VIEWER.items.length;
  if (n <= 1) return;
  for (let d = 1; d <= PREFETCH_RADIUS && d * 2 < n + 1; d++) {
    prefetchIndex((center + d) % n);
    prefetchIndex((center - d + n) % n);
  }
}

function markAdded(entry) {
  if (!entry) return;
  entry.added = true;
  const actions = $('#viewerActions');
  const add = actions && actions.querySelector('[data-action="add"]');
  if (add) {
    add.textContent = t('online.added');
    add.disabled = true;
  }
}

function renderActions(entry) {
  const actions = $('#viewerActions');
  if (!actions) return;
  actions.innerHTML = '';
  if (!entry || (entry.kind !== 'cloud' && entry.kind !== 'internet')) return;

  const add = document.createElement('button');
  add.className = 'media-action suggested';
  add.dataset.action = 'add';
  add.textContent = entry.added ? t('online.added') : t('online.add');
  add.disabled = !!entry.added;
  add.addEventListener('click', async () => {
    if (add.disabled) return;
    add.disabled = true;
    let res;
    try {
      res = entry.kind === 'cloud'
        ? await window.viewerApi.cloudAdd(entry.raw)
        : await window.viewerApi.internetAdd(entry.raw, entry.query || '');
    } catch {
      res = { error: 'download' };
    }
    if (res && !res.error) {
      markAdded(entry);
    } else {
      add.disabled = false;
      add.textContent = t('online.add');
      setState(t('online.error', { e: (res && res.error) || '?' }));
    }
  });
  actions.appendChild(add);
}

function updateResolutionInSubtitle(width, height, entry) {
  if (!width || !height || !entry) return;

  const resStr = `${width}x${height}`;
  const titleText = (entry.title || '').trim();
  const baseSubtitle = (entry.subtitle || '').trim();

  // If the title or the original base subtitle already contains a resolution pattern,
  // we do not need to append any temporary or loaded resolutions.
  const hasOriginalRes = /\d+x\d+/.test(titleText) || /\d+x\d+/.test(baseSubtitle);

  const subtitle = $('#viewerSubtitle');
  if (subtitle) {
    if (hasOriginalRes) {
      subtitle.textContent = baseSubtitle;
    } else {
      const separator = baseSubtitle ? ' - ' : '';
      subtitle.textContent = `${baseSubtitle}${separator}${resStr}`;
    }
  }
}

function step(delta) {
  if (VIEWER.items.length <= 1) return;
  VIEWER.index = (VIEWER.index + delta + VIEWER.items.length) % VIEWER.items.length;
  render();
}

async function render() {
  const entry = currentEntry();
  const token = ++VIEWER.token;
  const title = $('#viewerTitle');
  const subtitle = $('#viewerSubtitle');
  const footer = $('#viewerFooter');
  const prev = $('#viewerPrev');
  const next = $('#viewerNext');

  if (title) title.textContent = (entry && entry.title) || t('viewer.title');
  if (subtitle) subtitle.textContent = (entry && entry.subtitle) || '';
  if (footer) footer.textContent = VIEWER.items.length
    ? t('viewer.counter', { current: VIEWER.index + 1, total: VIEWER.items.length })
    : '';
  if (prev) prev.disabled = VIEWER.items.length <= 1;
  if (next) next.disabled = VIEWER.items.length <= 1;
  renderActions(entry);

  if (!STAGE.front) return;
  const idx = VIEWER.index;
  const hadImage = stageHasImage();
  setStageAlt(entry && entry.title);
  setHd(false);
  // Keep the previous frame on screen while the next one decodes (no black flash),
  // and only surface the "Loading…" pill if the load is actually slow. On first
  // open there is nothing to keep, so show it immediately.
  scheduleLoadingPill(token, hadImage ? LOADING_PILL_DELAY : 0);

  // Fast path: a prefetched full image is already cached for this slot. Show it
  // directly (no preview flicker) and warm the neighbours again.
  const cachedFull = FULL_CACHE.get(idx);
  if (cachedFull) {
    try {
      const loaded = await loadImage(cachedFull);
      if (token !== VIEWER.token) return;
      showImage(loaded.src);
      clearLoadingTimer();
      setState('', true);
      updateResolutionInSubtitle(loaded.width, loaded.height, entry);
      prefetchNeighbors(idx);
      return;
    } catch {
      FULL_CACHE.delete(idx); // stale/broken cache entry — fall back to the normal load
    }
  }

  let preview = '';
  try {
    preview = await previewSource(entry);
  } catch {
    preview = '';
  }
  if (token !== VIEWER.token) return;
  if (!preview) {
    clearLoadingTimer();
    clearStage();
    setState(t('viewer.loadError'));
    return;
  }

  try {
    const loadedPreview = await loadImage(preview);
    if (token !== VIEWER.token) return;
    showImage(loadedPreview.src);
    clearLoadingTimer();
    setState('', true);
    updateResolutionInSubtitle(loadedPreview.width, loadedPreview.height, entry);
  } catch {
    if (token !== VIEWER.token) return;
    clearLoadingTimer();
    clearStage();
    setState(t('viewer.loadError'));
    return;
  }
  if (token !== VIEWER.token) return;

  // Internet/cloud cards upgrade the preview to a full image; flag that it's pending.
  const expectsFull = entry.kind === 'internet' || entry.kind === 'cloud';
  if (expectsFull) setHd(true);

  let full = '';
  try {
    full = await fullSource(entry, preview);
  } catch {
    full = preview;
  }
  if (token !== VIEWER.token) return;
  if (!full || full === preview) {
    setHd(false);
    prefetchNeighbors(idx);
    return;
  }

  try {
    const loadedFull = await loadImage(full);
    if (token !== VIEWER.token) return;
    showImage(loadedFull.src);
    updateResolutionInSubtitle(loadedFull.width, loadedFull.height, entry);
    cacheFull(idx, full);
  } catch {
    // Keep the already visible preview if the provider blocks direct full-size loading.
  } finally {
    if (token === VIEWER.token) setHd(false);
  }
  prefetchNeighbors(idx);
}

function initEvents() {
  const close = $('#viewerClose');
  if (close) close.addEventListener('click', () => window.viewerApi.close());
  const root = $('#viewerRoot');
  const fullscreen = $('#viewerFullscreen');
  if (fullscreen) fullscreen.addEventListener('click', async () => {
    // Drop focus so the next arrow-key press doesn't paint a focus ring on the button.
    fullscreen.blur();
    const r = await window.viewerApi.toggleFullscreen();
    if (r && typeof r.fullscreen === 'boolean') setFullscreenUi(r.fullscreen);
  });
  const prev = $('#viewerPrev');
  if (prev) prev.addEventListener('click', () => { step(-1); prev.blur(); });
  const next = $('#viewerNext');
  if (next) next.addEventListener('click', () => { step(1); next.blur(); });
  if (root) {
    root.addEventListener('pointerdown', (e) => {
      POINTER.x = e.clientX;
      POINTER.y = e.clientY;
      POINTER.t = Date.now();
      POINTER.button = e.button;
      POINTER.blocked = !!e.target.closest('button');
    });
    root.addEventListener('pointerup', (e) => {
      if (POINTER.button !== 0 || POINTER.blocked || e.button !== 0 || e.target.closest('button')) return;
      const dx = Math.abs(e.clientX - POINTER.x);
      const dy = Math.abs(e.clientY - POINTER.y);
      const dt = Date.now() - POINTER.t;
      if (dx <= 4 && dy <= 4 && dt < 350) window.viewerApi.close();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      window.viewerApi.close();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      step(1);
    }
  });
  window.viewerApi.onPayload((payload) => setPayload(payload));
  window.viewerApi.onFullscreenChanged(setFullscreenUi);
  window.viewerApi.onBackgroundChanged(applyBackgroundMode);
}

async function init() {
  initStage();
  await loadI18n();
  initEvents();
  setPayload(await window.viewerApi.getPayload());
}

init();
