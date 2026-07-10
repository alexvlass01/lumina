'use strict';

const assert = require('assert');
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
ok('package command still ships runtime dirs',
  !ignorePatterns.some((pattern) => pattern.test('/src/library.js'))
  && !ignorePatterns.some((pattern) => pattern.test('/renderer/renderer.js'))
  && !ignorePatterns.some((pattern) => pattern.test('/locales/en.json')));
ok('diagnostics launcher does not enable Cloud staging',
  !/LUMINA_CLOUD=staging/.test(pkg.scripts['dev:diagnostics']));
ok('diagnostics launcher requires env and CLI opt-in',
  /LUMINA_DIAGNOSTICS=1/.test(pkg.scripts['dev:diagnostics']) &&
  /--diagnostics/.test(pkg.scripts['dev:diagnostics']));

console.log('\nAll ' + passed + ' diagnostics package-boundary tests passed.');
