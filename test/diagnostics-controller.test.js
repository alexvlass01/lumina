'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDiagnosticsController } = require('../diagnostics/main/controller');

let passed = 0;
const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log('  OK ' + name);
  passed++;
};

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-diagnostics-controller-'));
}

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(name, fn) {
      handlers.set(name, fn);
    },
  };
}

(async () => {
  const root = tmpRoot();
  const ipcMain = fakeIpcMain();
  let nowMs = Date.parse('2026-07-09T12:00:00.000Z');
  const controller = createDiagnosticsController({
    userDataPath: root,
    ipcMain,
    appInfo: { name: 'Lumina', version: 'test', isPackaged: false },
    source: { role: 'main', pid: 42 },
    now: () => nowMs,
    env: { LUMINA_DIAGNOSTICS_RETENTION: '2' },
  });

  controller.registerIpc();
  ok('registerIpc exposes diagnostics channels', ipcMain.handlers.has('diagnostics-start') && ipcMain.handlers.has('diagnostics-mark'));

  const started = await controller.startIfNeeded('startup');
  ok('startIfNeeded creates a recording session', started.ok && controller.status().state === 'recording');
  ok('start creates session files', fs.existsSync(controller.status().eventsPath) && fs.existsSync(controller.status().metaPath));

  nowMs += 100;
  const recorded = controller.record({ kind: 'span', category: 'library', name: 'render', timestampMs: nowMs });
  ok('record normalizes and queues main events', recorded.ok && recorded.accepted === 1);

  nowMs += 100;
  const marked = controller.mark('lag');
  ok('mark queues a reserved manual event', marked.ok && marked.accepted === 1);

  nowMs += 100;
  const stopped = await controller.stopRecording({ reason: 'test' });
  ok('stop flushes and completes session', stopped.ok && stopped.status.state === 'complete');

  const events = fs.readFileSync(controller.status().eventsPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  ok('events include lifecycle, recorded event and manual mark',
    events.some((event) => event.name === 'session-started') &&
    events.some((event) => event.category === 'library') &&
    events.some((event) => event.kind === 'mark'));

  const meta = JSON.parse(fs.readFileSync(controller.status().metaPath, 'utf8'));
  ok('final meta includes writer stats and app info', meta.writer.enqueued >= 3 && meta.app.name === 'Lumina');

  const opened = await createDiagnosticsController({
    userDataPath: tmpRoot(),
    shell: { openPath: async () => '' },
    autoStart: false,
  }).openSessionFolder();
  ok('openSessionFolder returns unavailable without a session', !opened.ok && opened.error === 'unavailable');

  const retentionRoot = path.join(tmpRoot(), 'diagnostics', 'sessions');
  const retentionController = createDiagnosticsController({
    sessionsRoot: retentionRoot,
    autoStart: false,
    now: () => Date.parse('2026-07-09T13:00:00.000Z'),
    env: { LUMINA_DIAGNOSTICS_RETENTION: '1' },
  });
  await retentionController.startRecording({ reason: 'first' });
  await retentionController.stopRecording({ reason: 'first' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await retentionController.startRecording({ reason: 'second' });
  await retentionController.stopRecording({ reason: 'second' });
  const sessionDirs = fs.readdirSync(retentionRoot).filter((name) => name.startsWith('session-'));
  ok('controller applies retention before new sessions', sessionDirs.length === 1);

  console.log('\nAll ' + passed + ' diagnostics controller tests passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
