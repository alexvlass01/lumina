'use strict';

const THUMBNAIL_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function canonicalUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    let host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'twitter.com') host = 'x.com';
    return `${host}${url.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch {
    return String(value).trim().toLowerCase();
  }
}

function itemKeys(item) {
  const keys = [];
  if (item && item.md5) keys.push(`md5:${String(item.md5).toLowerCase()}`);
  const source = canonicalUrl(item && item.source);
  if (source) keys.push(`source:${source}`);
  const full = canonicalUrl(item && item.full);
  if (full) keys.push(`full:${full}`);
  return keys;
}

function allowedDownloadUrl(item) {
  if (!item || !item.full || !item.provider) return false;
  try {
    const url = new URL(item.full);
    if (url.protocol !== 'https:') return false;
    if (item.provider === 'wallhaven') return url.hostname === 'w.wallhaven.cc';
    if (item.provider === 'danbooru') return url.hostname === 'cdn.donmai.us';
    return false;
  } catch {
    return false;
  }
}

function allowedThumbnailUrl(item) {
  if (!item || item.provider !== 'danbooru' || !item.thumb) return false;
  try {
    const url = new URL(item.thumb);
    return url.protocol === 'https:'
      && url.hostname === 'cdn.donmai.us'
      && !url.port
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

function thumbnailMime(value) {
  const mime = String(value || '').split(';', 1)[0].trim().toLowerCase();
  return THUMBNAIL_MIME_TYPES.has(mime) ? mime : '';
}

function thumbnailDataUrl(bytes, mime) {
  const safeMime = thumbnailMime(mime);
  if (!safeMime || !bytes) return '';
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return buffer.length ? `data:${safeMime};base64,${buffer.toString('base64')}` : '';
}

function allowedPageUrl(item) {
  if (!item || !item.page || !item.provider) return false;
  try {
    const url = new URL(item.page);
    if (url.protocol !== 'https:') return false;
    if (item.provider === 'wallhaven') return url.hostname === 'wallhaven.cc';
    if (item.provider === 'danbooru') return url.hostname === 'danbooru.donmai.us';
    return false;
  } catch {
    return false;
  }
}

function interleave(lists) {
  const sources = (lists || []).map((items) => Array.isArray(items) ? items : []);
  const positions = sources.map(() => 0);
  const seen = new Set();
  const merged = [];
  let advanced = true;
  while (advanced) {
    advanced = false;
    for (let i = 0; i < sources.length; i++) {
      while (positions[i] < sources[i].length) {
        advanced = true;
        const item = sources[i][positions[i]++];
        if (!item) continue;
        const keys = itemKeys(item);
        if (keys.some((key) => seen.has(key))) continue;
        keys.forEach((key) => seen.add(key));
        merged.push(item);
        break;
      }
    }
  }
  return merged;
}

function resultHasMore(result, page) {
  const meta = result && result.meta || {};
  if (meta.hasMore === true) return true;
  return Number(meta.lastPage) > page;
}

function mergeSearchResults(results, page = 1) {
  const list = Array.isArray(results) ? results : [];
  const successful = list.filter((result) => result && !result.error);
  const providerErrors = {};
  for (const result of list) {
    if (result && result.error) providerErrors[result.provider || 'unknown'] = result.error;
  }
  const hasMore = successful.some((result) => resultHasMore(result, page));
  const error = successful.length ? null : Object.values(providerErrors).join(', ') || 'network';
  return {
    items: interleave(successful.map((result) => result.items)),
    meta: {
      currentPage: page,
      lastPage: hasMore ? page + 1 : page,
      hasMore,
    },
    error,
    providerErrors,
  };
}

function combineProviderPages(pages) {
  const providers = new Map();
  for (const page of Array.isArray(pages) ? pages : []) {
    for (const result of Array.isArray(page) ? page : []) {
      if (!result || !result.provider) continue;
      let combined = providers.get(result.provider);
      if (!combined) {
        combined = { provider: result.provider, items: [], meta: {}, error: null, _succeeded: false };
        providers.set(result.provider, combined);
      }
      if (!result.error) {
        combined.items.push(...(Array.isArray(result.items) ? result.items : []));
        combined.meta = result.meta || {};
        combined.error = null;
        combined._succeeded = true;
      } else if (!combined._succeeded) {
        combined.error = result.error;
      }
    }
  }
  return [...providers.values()].map(({ _succeeded, ...result }) => result);
}

function shouldFillInitialSearch(result, startPage, currentPage, target = 40, maxPages = 3) {
  if (!result || result.error) return false;
  const count = Array.isArray(result.items) ? result.items.length : 0;
  const consumed = Math.max(1, Number(currentPage) - Number(startPage) + 1);
  return count < target && result.meta && result.meta.hasMore === true && consumed < maxPages;
}

module.exports = {
  canonicalUrl,
  itemKeys,
  allowedDownloadUrl,
  allowedThumbnailUrl,
  allowedPageUrl,
  thumbnailMime,
  thumbnailDataUrl,
  interleave,
  resultHasMore,
  mergeSearchResults,
  combineProviderPages,
  shouldFillInitialSearch,
};
