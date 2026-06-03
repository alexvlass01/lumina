'use strict';

// Plain Node test: `node test/wallhaven.test.js`. Covers the pure parts of the
// Wallhaven client — URL building (incl. apikey gating) + response parsing.

const assert = require('assert');
const W = require('../src/wallhaven');

let passed = 0;
const ok = (n, c) => { assert.ok(c, n); console.log('  ✓ ' + n); passed++; };

// ---- masks ----
ok('purityMask: default = sfw+sketchy (110)', W.purityMask() === '110');
ok('purityMask: all', W.purityMask({ sfw: true, sketchy: true, nsfw: true }) === '111');
ok('purityMask: sfw only', W.purityMask({ sfw: true, sketchy: false, nsfw: false }) === '100');
ok('categoryMask: default all (111)', W.categoryMask() === '111');

// ---- buildSearchUrl ----
const u1 = W.buildSearchUrl({ q: 'nature space', purity: '110', categories: '111', page: 2 });
ok('buildSearchUrl: q encoded', u1.includes('q=nature+space') || u1.includes('q=nature%20space'));
ok('buildSearchUrl: purity + categories', u1.includes('purity=110') && u1.includes('categories=111'));
ok('buildSearchUrl: page', u1.includes('page=2'));
ok('buildSearchUrl: no apikey when absent', !u1.includes('apikey'));
ok('buildSearchUrl: apikey appended when present', W.buildSearchUrl({ q: 'x', apikey: 'SECRET' }).includes('apikey=SECRET'));
ok('buildSearchUrl: defaults (page>=1, sfw)', (() => {
  const u = W.buildSearchUrl({});
  return u.includes('page=1') && u.includes('purity=100') && u.includes('sorting=date_added');
})());

// ---- parseSearch ----
const sample = {
  data: [
    {
      id: 'abc123', url: 'https://wallhaven.cc/w/abc123', short_url: 'https://whvn.cc/abc123',
      purity: 'sfw', category: 'general', resolution: '1920x1080', file_type: 'image/jpeg',
      source: 'https://example.com/art', path: 'https://w.wallhaven.cc/full/ab/wallhaven-abc123.jpg',
      thumbs: { small: 'https://th.wallhaven.cc/small/ab/abc123.jpg', large: 'https://th.wallhaven.cc/lg/ab/abc123.jpg' },
    },
    { id: 'noPath' }, // missing path -> dropped
  ],
  meta: { current_page: 1, last_page: 5, per_page: 24, total: 120 },
};
const parsed = W.parseSearch(sample);
ok('parseSearch: drops items without path', parsed.items.length === 1);
ok('parseSearch: maps full + thumb + page', (() => {
  const it = parsed.items[0];
  return it.full === 'https://w.wallhaven.cc/full/ab/wallhaven-abc123.jpg'
    && it.thumb === 'https://th.wallhaven.cc/small/ab/abc123.jpg'
    && it.page === 'https://wallhaven.cc/w/abc123'
    && it.resolution === '1920x1080' && it.source === 'https://example.com/art';
})());
ok('parseSearch: meta parsed', parsed.meta.currentPage === 1 && parsed.meta.lastPage === 5 && parsed.meta.total === 120);
ok('parseSearch: junk -> empty', (() => {
  const r = W.parseSearch(null);
  return r.items.length === 0 && r.meta.currentPage === 1;
})());

console.log('\nAll ' + passed + ' wallhaven tests passed.');
