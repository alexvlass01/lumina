'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const packageRoot = path.resolve(process.argv[2] || path.join(root, 'dist', 'Lumina-win32-x64'));
const resources = path.join(packageRoot, 'resources');
const helper = path.join(resources, 'thumbnail-helper', 'Lumina.ThumbnailHelper.exe');
const appAsar = path.join(resources, 'app.asar');

function fail(message) {
  throw new Error('thumbnail package verification failed: ' + message);
}

if (!fs.existsSync(helper)) fail('compiled helper is missing from resources');
if (!fs.existsSync(appAsar)) fail('app.asar is missing');

const version = spawnSync(helper, ['--version'], {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 5000,
});
if (version.error) throw version.error;
if (version.status !== 0 || !/Lumina\.ThumbnailHelper\s+\S+\s+protocol=1/.test(version.stdout || '')) {
  fail('packaged helper did not pass its version handshake');
}

const separator = String.fromCharCode(92);
const files = asar.listPackage(appAsar).map((entry) => entry.split(separator).join('/'));
const forbiddenRoots = ['/native', '/.build', '/scripts', '/plans', '/test'];
for (const forbidden of forbiddenRoots) {
  if (files.some((entry) => entry === forbidden || entry.startsWith(forbidden + '/'))) {
    fail('development-only path leaked into app.asar: ' + forbidden);
  }
}

for (const required of ['/main.js', '/src/thumbnail-host.js', '/renderer/renderer.js', '/locales/en.json']) {
  if (!files.includes(required)) fail('required runtime file is missing: ' + required);
}

console.log('Packaged thumbnail helper verified: ' + path.relative(root, helper));
