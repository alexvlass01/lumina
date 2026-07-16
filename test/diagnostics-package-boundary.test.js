'use strict';

const assert = require('assert');
const fs = require('fs');
const pkg = require('../package.json');

let passed = 0;
const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log('  OK ' + name);
  passed++;
};

function packageIgnorePatterns() {
  return (pkg.scripts.package.match(/--ignore=(?:"[^"]+"|\S+)/g) || [])
    .map((entry) => entry.replace(/^--ignore=/, ''))
    .map((entry) => entry.replace(/^"|"$/g, ''))
    .map((entry) => new RegExp(entry));
}

const ignorePatterns = packageIgnorePatterns();

ok('package command excludes dev-only diagnostics directory',
  ignorePatterns.some((pattern) => pattern.test('/diagnostics/core/session.js')));
ok('package command keeps production-safe diagnostics gate',
  !ignorePatterns.some((pattern) => pattern.test('/src/diagnostics-gate.js')));
// Privacy boundary: internal agent handoff docs and scratch dirs must never ship
// inside the public installer (they used to leak into app.asar until v1.4.6).
for (const leak of ['/plans/knowledge_index.md', '/STATUS.md', '/ROADMAP.md', '/CLAUDE.md', '/AGENTS.md', '/.tmp/x', '/.agents', '/.codex', '/test/config.test.js', '/Lumina-DEV.bat', '/Lumina-DIAG.bat']) {
  ok(`package command excludes ${leak}`,
    ignorePatterns.some((pattern) => pattern.test(leak)));
}
ok('package command excludes thumbnail helper sources, build scripts and intermediate tree',
  ignorePatterns.some((pattern) => pattern.test('/native/thumbnail-helper/Program.cs'))
  && ignorePatterns.some((pattern) => pattern.test('/scripts/build-thumbnail-helper.js'))
  && ignorePatterns.some((pattern) => pattern.test('/.build/thumbnail-helper/build.json')));
ok('package command ships the compiled thumbnail helper as an extra resource',
  /--extra-resource="?\.build\/thumbnail-helper"?/.test(pkg.scripts.package));
ok('package lifecycle verifies the compiled helper after packing',
  pkg.scripts.postpackage === 'node scripts/verify-thumbnail-package.js');
ok('package command still ships runtime dirs',
  !ignorePatterns.some((pattern) => pattern.test('/src/library.js'))
  && !ignorePatterns.some((pattern) => pattern.test('/renderer/renderer.js'))
  && !ignorePatterns.some((pattern) => pattern.test('/locales/en.json'))
  && !ignorePatterns.some((pattern) => pattern.test('/src/thumbnail-host.js')));
ok('diagnostics launcher does not enable Cloud staging',
  !/LUMINA_CLOUD=staging/.test(pkg.scripts['dev:diagnostics']));
ok('diagnostics launcher requires env and CLI opt-in',
  /LUMINA_DIAGNOSTICS=1/.test(pkg.scripts['dev:diagnostics']) &&
  /--diagnostics/.test(pkg.scripts['dev:diagnostics']));

const controlHtml = fs.readFileSync(require.resolve('../diagnostics/ui/control.html'), 'utf8');
const controlJs = fs.readFileSync(require.resolve('../diagnostics/ui/control.js'), 'utf8');
const controlPreload = fs.readFileSync(require.resolve('../diagnostics/ui/control-preload.js'), 'utf8');
const mainJs = fs.readFileSync(require.resolve('../main.js'), 'utf8');
const installerJs = fs.readFileSync(require.resolve('../scripts/build-installer.js'), 'utf8');
ok('diagnostics control exposes a dedicated force-delivery notification test',
  /id="btnTestNotification"/.test(controlHtml)
  && /api\.testNotification\(\)/.test(controlJs)
  && /diagnostics-test-notification/.test(controlPreload));
ok('force-delivery copy explains that it does not create a fake journal failure',
  /без записи ложного сбоя в журнал/.test(controlHtml));
ok('Windows notification identity matches the Squirrel shortcut identity',
  /WINDOWS_APP_USER_MODEL_ID\s*=\s*['"]com\.squirrel\.Lumina\.Lumina['"]/.test(mainJs)
  && /app\.whenReady\(\)\.then\(async \(\) => \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*if \(process\.platform === 'win32'\) app\.setAppUserModelId\(WINDOWS_APP_USER_MODEL_ID\)/.test(mainJs)
  && /name:\s*['"]Lumina['"]/.test(installerJs)
  && /exe:\s*['"]Lumina\.exe['"]/.test(installerJs));

console.log('\nAll ' + passed + ' diagnostics package-boundary tests passed.');
