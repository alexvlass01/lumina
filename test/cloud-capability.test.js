'use strict';

// Plain Node test: `node test/cloud-capability.test.js`. Covers the pure cloud
// capability resolver — environment gating + the renderer-safe public subset.

const assert = require('assert');
const CAP = require('../src/cloud/capability');
const { STAGING_BASE } = require('../src/cloud/client');

let passed = 0;
const ok = (n, c) => { assert.ok(c, n); console.log('  ✓ ' + n); passed++; };

// installed build, no opt-in → unavailable, no apiBase
ok('packaged + no opt-in → unavailable', (() => {
  const c = CAP.resolveCapability({ isPackaged: true, stagingOptIn: false });
  return c.environment === 'unavailable' && c.available === false && c.authAvailable === false
    && c.reason === 'coming_soon' && c.apiBase === null;
})());

// installed build can NEVER reach staging, even if opt-in is somehow set
ok('packaged + opt-in → still unavailable (no accidental staging)', (() => {
  const c = CAP.resolveCapability({ isPackaged: true, stagingOptIn: true });
  return c.environment === 'unavailable' && c.apiBase === null;
})());

// dev build without opt-in stays unavailable (devs see what users see by default)
ok('dev + no opt-in → unavailable', (() => {
  return CAP.resolveCapability({ isPackaged: false, stagingOptIn: false }).environment === 'unavailable';
})());

// dev build with explicit opt-in → staging + the staging base URL
ok('dev + opt-in → staging w/ staging base', (() => {
  const c = CAP.resolveCapability({ isPackaged: false, stagingOptIn: true });
  return c.environment === 'staging' && c.available === true && c.authAvailable === true
    && c.reason === null && c.apiBase === STAGING_BASE;
})());

// production only when enabled AND a base exists (C6); base wins over staging
ok('production enabled + base → production', (() => {
  const c = CAP.resolveCapability({ isPackaged: true, productionEnabled: true, productionBase: 'https://api.example.com' });
  return c.environment === 'production' && c.available === true && c.apiBase === 'https://api.example.com';
})());
ok('production enabled but no base → falls back (not production)', (() => {
  return CAP.resolveCapability({ isPackaged: false, stagingOptIn: true, productionEnabled: true, productionBase: '' }).environment === 'staging';
})());

// the shipped default constant keeps production off
ok('PRODUCTION_ENABLED is off by default', CAP.PRODUCTION_ENABLED === false);

// publicCapability hides apiBase and normalizes the shape
ok('publicCapability: strips apiBase', (() => {
  const full = CAP.resolveCapability({ isPackaged: false, stagingOptIn: true });
  const pub = CAP.publicCapability(full);
  return !('apiBase' in pub) && pub.environment === 'staging' && pub.available === true;
})());
ok('publicCapability: safe defaults for junk', (() => {
  const pub = CAP.publicCapability(undefined);
  return pub.environment === 'unavailable' && pub.available === false && pub.authAvailable === false && pub.reason === null;
})());

console.log('\nAll ' + passed + ' cloud-capability tests passed.');
