'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'i18n-context.js');
let passed = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`  OK ${name}`);
  passed++;
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
}

{
  const res = run(['report']);
  ok('report validates the generated/manual context inputs',
    res.status === 0 && /345\/388/.test(res.stdout) && /Ручной sidecar/.test(res.stdout));
}

{
  const res = run(['report', 'unexpected']);
  ok('report rejects irrelevant trailing arguments', res.status !== 0 && /Неверные аргументы/.test(res.stderr));
}

{
  const res = run(['show', 'library.addPhotos']);
  ok('show returns both automatic and manual context channels',
    res.status === 0 && /autoContexts/.test(res.stdout) && /"manual": null/.test(res.stdout));
}

for (const inherited of ['__proto__', 'constructor', 'toString']) {
  const res = run(['show', inherited]);
  ok(`show rejects inherited object property ${inherited}`,
    res.status !== 0 && /Неизвестный ключ/.test(res.stderr));
}

{
  const res = run(['show', 'library.addPhotos', 'unexpected']);
  ok('show requires exactly one key', res.status !== 0 && /Неверные аргументы/.test(res.stderr));
}

console.log(`\nAll ${passed} i18n-context CLI tests passed.`);
