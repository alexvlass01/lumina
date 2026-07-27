'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { flatten } = require('../src/i18n-state');

const ROOT = path.join(__dirname, '..');
const en = flatten(JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', 'en.json'), 'utf8')));
const de = flatten(JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', 'de.json'), 'utf8')));
const expectedMissing = Object.keys(en).filter((key) => typeof de[key] !== 'string' || de[key] === '').length;
const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lint-i18n.js')], {
  cwd: ROOT,
  encoding: 'utf8',
  windowsHide: true,
});

assert.strictEqual(result.status, 0, result.stderr || result.stdout);
assert.match(
  result.stdout,
  new RegExp(`locales[\\\\/]de\\.json \\(extra\\): ${expectedMissing} missing keys`),
  'extra-language summary must count missing leaf strings, not a whole absent subtree as one key',
);

console.log(`  OK i18n lint reports the accurate ${expectedMissing}-leaf gap for de`);
console.log('\nAll 1 i18n-lint report tests passed.');
