'use strict';

const $ = (sel) => document.querySelector(sel);

const I18N = { dict: {}, fallback: {} };
const VIEWER = { items: [], index: 0, token: 0 };
const POINTER = { x: 0, y: 0, t: 0, button: -1, blocked: false };

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
    return String(item.full || '') || fallback;
  }
  return fallback || entry.previewUrl || '';
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (!src) { reject(new Error('empty')); return; }
    const probe = new Image();
    probe.onload = () => resolve(src);
    probe.onerror = () => reject(new Error('load'));
    probe.src = src;
  });
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
  const img = $('#viewerImage');
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

  if (!img) return;
  img.alt = (entry && entry.title) || '';
  img.removeAttribute('src');
  setState(t('viewer.loading'));

  let preview = '';
  try {
    preview = await previewSource(entry);
  } catch {
    preview = '';
  }
  if (token !== VIEWER.token) return;
  if (!preview) {
    setState(t('viewer.loadError'));
    return;
  }

  try {
    img.src = await loadImage(preview);
    setState('', true);
  } catch {
    if (token !== VIEWER.token) return;
    setState(t('viewer.loadError'));
    return;
  }
  if (token !== VIEWER.token) return;

  let full = '';
  try {
    full = await fullSource(entry, preview);
  } catch {
    full = preview;
  }
  if (!full || full === preview || token !== VIEWER.token) return;

  try {
    img.src = await loadImage(full);
  } catch {
    // Keep the already visible preview if the provider blocks direct full-size loading.
  }
}

function initEvents() {
  const close = $('#viewerClose');
  if (close) close.addEventListener('click', () => window.viewerApi.close());
  const root = $('#viewerRoot');
  const fullscreen = $('#viewerFullscreen');
  if (fullscreen) fullscreen.addEventListener('click', () => window.viewerApi.toggleFullscreen());
  const prev = $('#viewerPrev');
  if (prev) prev.addEventListener('click', () => step(-1));
  const next = $('#viewerNext');
  if (next) next.addEventListener('click', () => step(1));
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
}

async function init() {
  await loadI18n();
  initEvents();
  setPayload(await window.viewerApi.getPayload());
}

init();
