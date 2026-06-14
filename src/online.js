'use strict';

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

module.exports = { canonicalUrl, itemKeys, allowedDownloadUrl, allowedPageUrl, interleave, resultHasMore, mergeSearchResults };
