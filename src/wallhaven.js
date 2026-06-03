'use strict';

// Wallhaven API client — PURE parts only (URL building + response parsing), so they
// can be unit-tested without network (see test/wallhaven.test.js). The actual fetch +
// file download live in main.js (Node global fetch), kept thin on purpose.
//
// API facts (wallhaven.cc/help/api): search is open to guests for SFW+Sketchy; NSFW
// needs a valid API key (else 401). Rate limit 45 req/min per key/IP → 429. The key is
// only sent when NSFW is requested (keeps the shared/bundled key off the common path).
//
//   purity     = 3-bit "sfw sketchy nsfw", e.g. 100=sfw, 110=sfw+sketchy, 111=all
//   categories = 3-bit "general anime people", default 111
//   sorting    = date_added | relevance | random | views | favorites | toplist
//   thumbs.small/large = preview URLs; path = full-resolution image URL

const API_BASE = 'https://wallhaven.cc/api/v1/search';

// Build a 3-bit mask string from three booleans.
function mask(a, b, c) {
  return `${a ? 1 : 0}${b ? 1 : 0}${c ? 1 : 0}`;
}
function purityMask({ sfw = true, sketchy = true, nsfw = false } = {}) {
  return mask(sfw, sketchy, nsfw);
}
function categoryMask({ general = true, anime = true, people = true } = {}) {
  return mask(general, anime, people);
}

// Build the search URL. apikey is appended ONLY when provided (truthy).
function buildSearchUrl(opts = {}) {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', String(opts.q));
  p.set('categories', opts.categories || '111');
  p.set('purity', opts.purity || '100');
  p.set('sorting', opts.sorting || 'date_added');
  p.set('order', opts.order || 'desc');
  p.set('page', String(opts.page && opts.page > 0 ? opts.page : 1));
  if (opts.apikey) p.set('apikey', String(opts.apikey));
  return `${API_BASE}?${p.toString()}`;
}

// Map one raw Wallhaven item → a compact shape Lumina uses.
function mapItem(w) {
  if (!w || !w.path) return null;
  const thumbs = w.thumbs || {};
  return {
    id: w.id,
    page: w.url || '',                       // wallhaven.cc page (attribution)
    full: w.path,                            // full-resolution image URL (download this)
    thumb: thumbs.small || thumbs.large || w.path,
    resolution: w.resolution || '',
    fileType: w.file_type || '',
    purity: w.purity || '',
    category: w.category || '',
    source: w.source || '',                  // original source if provided
  };
}

// Parse a search response body → { items:[…], meta:{…} }. Tolerant of junk.
function parseSearch(json) {
  const data = json && Array.isArray(json.data) ? json.data : [];
  const items = data.map(mapItem).filter(Boolean);
  const m = (json && json.meta) || {};
  const meta = {
    currentPage: Number(m.current_page) || 1,
    lastPage: Number(m.last_page) || 1,
    perPage: Number(m.per_page) || items.length,
    total: Number(m.total) || items.length,
  };
  return { items, meta };
}

module.exports = { API_BASE, mask, purityMask, categoryMask, buildSearchUrl, mapItem, parseSearch };
