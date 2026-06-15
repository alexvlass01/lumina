'use strict';

// Pure Gelbooru adapter. Network requests and credentials stay in main.js;
// this module only builds API URLs and maps posts to Lumina's online-card shape.

const API_BASE = 'https://gelbooru.com/index.php';
const POST_BASE = 'https://gelbooru.com/index.php?page=post&s=view&id=';
const SUPPORTED_EXTS = new Set(['jpg', 'jpeg', 'png']);
const RATINGS = ['general', 'sensitive', 'questionable', 'explicit'];

function queryTags(query, max = 2) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const parts = raw.includes(',') ? raw.split(',') : raw.split(/\s+/);
  return parts
    .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, '_'))
    .filter((tag) => tag && !tag.includes(':'))
    .slice(0, max);
}

function selectedRatings({ sfw = true, sketchy = true, nsfw = false } = {}) {
  const selected = [];
  if (sfw) selected.push('general');
  if (sketchy) selected.push('sensitive', 'questionable');
  if (nsfw) selected.push('explicit');
  return selected.length ? selected : ['general'];
}

// Gelbooru supports negative rating metatags, which lets us express every
// combination of Lumina's three groups without fetching and filtering locally.
function ratingTags(purity) {
  const selected = selectedRatings(purity);
  if (selected.length === RATINGS.length) return [];
  if (selected.length === 1) return [`rating:${selected[0]}`];
  return RATINGS.filter((rating) => !selected.includes(rating)).map((rating) => `-rating:${rating}`);
}

function orderTag(sort) {
  if (sort === 'toplist' || sort === 'views') return 'sort:score:desc';
  if (sort === 'random') return 'sort:random';
  return '';
}

function buildSearchTags(opts = {}) {
  return [
    ...queryTags(opts.q),
    ...ratingTags(opts.purity),
    orderTag(opts.sorting),
  ].filter(Boolean).join(' ');
}

function buildSearchUrl(opts = {}) {
  const page = Number(opts.page) > 0 ? Math.floor(Number(opts.page)) : 1;
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 100));
  const p = new URLSearchParams({
    page: 'dapi',
    s: 'post',
    q: 'index',
    json: '1',
    limit: String(limit),
    pid: String(page - 1),
    tags: buildSearchTags(opts),
  });
  if (opts.apiKey) p.set('api_key', String(opts.apiKey));
  if (opts.userId) p.set('user_id', String(opts.userId));
  return `${API_BASE}?${p.toString()}`;
}

function fileExtension(post) {
  const candidates = [post && post.image, post && post.file_url];
  for (const value of candidates) {
    const match = String(value || '').match(/\.([a-z0-9]+)(?:$|[?#])/i);
    if (match) return match[1].toLowerCase();
  }
  return '';
}

function compactTags(post, max = 24) {
  const values = [];
  const seen = new Set();
  for (const raw of String(post && post.tags || '').split(/\s+/)) {
    const tag = raw.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    values.push(tag);
    if (values.length >= max) break;
  }
  return values;
}

function purityName(rating) {
  const value = String(rating || '').toLowerCase();
  if (value === 'explicit') return 'nsfw';
  if (value === 'sensitive' || value === 'questionable') return 'sketchy';
  return 'sfw';
}

function mapItem(post) {
  if (!post || post.id == null) return null;
  const ext = fileExtension(post);
  if (!SUPPORTED_EXTS.has(ext)) return null;
  const full = String(post.file_url || '');
  if (!full) return null;
  const width = Number(post.width) || 0;
  const height = Number(post.height) || 0;
  return {
    id: `gelbooru:${post.id}`,
    provider: 'gelbooru',
    page: `${POST_BASE}${post.id}`,
    full,
    thumb: post.preview_url || post.sample_url || full,
    resolution: width > 0 && height > 0 ? `${width}x${height}` : '',
    width,
    height,
    fileType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
    purity: purityName(post.rating),
    category: 'anime',
    source: post.source || '',
    artist: '',
    tags: compactTags(post),
    md5: post.md5 || '',
  };
}

function postsFromResponse(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.post)) return json.post;
  if (json && json.post && typeof json.post === 'object') return [json.post];
  return [];
}

function responseError(json) {
  if (!json || typeof json !== 'object') return '';
  if (json.success === false || json.success === 'false') return String(json.message || 'search');
  return '';
}

function parseSearch(json, opts = {}) {
  const data = postsFromResponse(json);
  const items = data.map(mapItem).filter(Boolean);
  const page = Number(opts.page) > 0 ? Math.floor(Number(opts.page)) : 1;
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 100));
  const attrs = json && json['@attributes'] || {};
  const total = Number(attrs.count);
  const offset = Number(attrs.offset);
  const hasTotal = Number.isFinite(total) && total >= 0;
  const hasOffset = Number.isFinite(offset) && offset >= 0;
  const hasMore = hasTotal && hasOffset ? offset + data.length < total : data.length >= limit;
  return {
    items,
    meta: {
      currentPage: page,
      lastPage: hasMore ? page + 1 : page,
      perPage: limit,
      total: hasTotal ? total : null,
      hasMore,
    },
  };
}

module.exports = {
  API_BASE,
  POST_BASE,
  queryTags,
  selectedRatings,
  ratingTags,
  orderTag,
  buildSearchTags,
  buildSearchUrl,
  fileExtension,
  compactTags,
  purityName,
  mapItem,
  postsFromResponse,
  responseError,
  parseSearch,
};
