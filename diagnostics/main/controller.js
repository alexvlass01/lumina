'use strict';

const fs = require('fs');
const path = require('path');
const { DiagnosticsSession } = require('../core/session');
const { JsonlWriter } = require('../core/writer');
const retention = require('../core/retention');

function retentionLimitFromEnv(env = process.env) {
  const raw = Number.parseInt(String(env.LUMINA_DIAGNOSTICS_RETENTION || ''), 10);
  return Number.isFinite(raw) && raw >= 1 && raw <= 200 ? raw : 15;
}

function defaultSessionsRoot(userDataPath) {
  return path.join(userDataPath, 'diagnostics', 'sessions');
}

function createSessionMeta({ session, sessionDir, reason, appInfo = {}, startedAtIso }) {
  const snapshot = session.snapshot();
  return {
    schemaVersion: 1,
    sessionId: snapshot.sessionId,
    state: snapshot.state,
    reason,
    startedAtMs: snapshot.startedAtMs,
    startedAtIso,
    sessionDir,
    app: appInfo,
  };
}

class DiagnosticsController {
  constructor({
    userDataPath,
    appInfo = {},
    ipcMain = null,
    shell = null,
    fsModule = fs,
    now = () => Date.now(),
    env = process.env,
    source = { role: 'main', pid: process.pid },
    writerFactory = null,
    sessionsRoot = null,
    autoStart = true,
  } = {}) {
    if (!userDataPath && !sessionsRoot) throw new Error('userDataPath or sessionsRoot is required');
    this.userDataPath = userDataPath || path.dirname(path.dirname(sessionsRoot));
    this.sessionsRoot = sessionsRoot || defaultSessionsRoot(userDataPath);
    this.appInfo = appInfo;
    this.ipcMain = ipcMain;
    this.shell = shell;
    this.fs = fsModule;
    this.now = now;
    this.env = env;
    this.source = source;
    this.writerFactory = writerFactory;
    this.autoStart = autoStart;
    this.session = new DiagnosticsSession({ source, now });
    this.writer = null;
    this.sessionDir = '';
    this.eventsPath = '';
    this.metaPath = '';
    this.lastError = '';
    this.registered = false;
    this.shuttingDown = false;
    this.retentionKeep = retentionLimitFromEnv(env);
  }

  registerIpc() {
    if (!this.ipcMain || this.registered) return;
    this.registered = true;
    this.ipcMain.handle('diagnostics-status', () => this.status());
    this.ipcMain.handle('diagnostics-start', (_event, opts) => this.startRecording(opts || {}));
    this.ipcMain.handle('diagnostics-stop', (_event, opts) => this.stopRecording(opts || {}));
    this.ipcMain.handle('diagnostics-mark', (_event, label) => this.mark(label));
    this.ipcMain.handle('diagnostics-record', (_event, events) => this.record(events));
    this.ipcMain.handle('diagnostics-open-session-folder', () => this.openSessionFolder());
    this.ipcMain.handle('diagnostics-clear-sessions', () => this.clearSessions());
  }

  async startIfNeeded(reason = 'startup') {
    if (!this.autoStart) return this.status();
    return this.startRecording({ reason });
  }

  async startRecording({ reason = 'manual' } = {}) {
    if (this.session.snapshot().state === 'recording') {
      return { ok: true, status: this.status() };
    }
    try {
      const root = await retention.ensureRetentionRoot(this.sessionsRoot, { fsModule: this.fs });
      const startedAtMs = this.now();
      const startedAtIso = new Date(startedAtMs).toISOString();
      const snapshot = this.session.start({ nowMs: startedAtMs });
      this.sessionDir = path.join(root, snapshot.sessionId);
      this.eventsPath = path.join(this.sessionDir, 'events.jsonl');
      this.metaPath = path.join(this.sessionDir, 'meta.json');
      this.writer = this.createWriter(this.eventsPath);
      await this.writer.start();
      await retention.pruneSessions(root, { keep: this.retentionKeep, fsModule: this.fs });
      await this.writeMeta(createSessionMeta({
        session: this.session,
        sessionDir: this.sessionDir,
        reason,
        appInfo: this.appInfo,
        startedAtIso,
      }));
      await this.recordLifecycle('session-started', { reason });
      await this.writer.flush();
      return { ok: true, status: this.status() };
    } catch (err) {
      this.lastError = err && err.message ? err.message : String(err);
      this.session.degrade(this.lastError);
      return { ok: false, error: this.lastError, status: this.status() };
    }
  }

  createWriter(filePath) {
    if (this.writerFactory) return this.writerFactory({
      filePath,
      fsModule: this.fs,
      now: this.now,
      onDegraded: (reason) => this.session.degrade(reason),
    });
    return new JsonlWriter({
      filePath,
      fsModule: this.fs,
      now: this.now,
      onDegraded: (reason) => this.session.degrade(reason),
    });
  }

  async recordLifecycle(name, attributes = {}) {
    const event = this.session.record({
      kind: 'lifecycle',
      category: 'diagnostics',
      name,
      timestampMs: this.now(),
      attributes,
    });
    if (!event || !this.writer) return { accepted: 0, dropped: 0 };
    return this.writer.enqueue(event, { reserved: true });
  }

  record(events) {
    if (!this.writer) return { ok: false, error: 'not_recording', status: this.status() };
    const normalized = this.session.recordBatch(events, { generation: this.session.snapshot().generation, nowMs: this.now() });
    const result = normalized.length ? this.writer.enqueue(normalized) : { accepted: 0, dropped: 0 };
    return { ok: true, accepted: result.accepted, dropped: result.dropped, status: this.status() };
  }

  mark(label = 'lag') {
    if (!this.writer) return { ok: false, error: 'not_recording', status: this.status() };
    const event = this.session.mark(label, { generation: this.session.snapshot().generation, nowMs: this.now() });
    const result = event ? this.writer.enqueue(event, { reserved: true }) : { accepted: 0, dropped: 0 };
    return { ok: true, accepted: result.accepted, dropped: result.dropped, status: this.status() };
  }

  async stopRecording({ reason = 'manual' } = {}) {
    if (!this.writer) {
      this.session.complete();
      return { ok: true, status: this.status() };
    }
    try {
      await this.recordLifecycle('session-stopping', { reason });
      this.session.stop({ nowMs: this.now() });
      const writerStats = await this.writer.stop();
      if (writerStats.degraded) this.session.degrade(writerStats.degradedReason);
      else this.session.complete();
      await this.writeFinalMeta(writerStats, reason);
      const status = this.status();
      this.writer = null;
      return { ok: true, status };
    } catch (err) {
      this.lastError = err && err.message ? err.message : String(err);
      this.session.degrade(this.lastError);
      return { ok: false, error: this.lastError, status: this.status() };
    }
  }

  async shutdownBestEffort({ reason = 'shutdown' } = {}) {
    if (this.shuttingDown) return this.status();
    this.shuttingDown = true;
    try {
      if (this.writer && this.session.snapshot().state === 'recording') {
        await this.stopRecording({ reason });
      } else if (this.writer) {
        await this.writer.shutdownBestEffort();
      }
    } catch {
      // Best-effort shutdown must never block Lumina quit.
    }
    return this.status();
  }

  async openSessionFolder() {
    if (!this.sessionDir || !this.shell || typeof this.shell.openPath !== 'function') {
      return { ok: false, error: 'unavailable', status: this.status() };
    }
    const error = await this.shell.openPath(this.sessionDir);
    return { ok: !error, error: error || '', status: this.status() };
  }

  async clearSessions() {
    if (this.session.snapshot().state === 'recording') {
      return { ok: false, error: 'recording_active', status: this.status() };
    }
    try {
      const removed = await retention.clearSessions(this.sessionsRoot, { fsModule: this.fs });
      return { ok: true, removed: removed.removed, status: this.status() };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err), status: this.status() };
    }
  }

  async writeMeta(meta) {
    await this.fs.promises.mkdir(this.sessionDir, { recursive: true });
    await this.fs.promises.writeFile(this.metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  }

  async writeFinalMeta(writerStats, reason) {
    if (!this.metaPath) return;
    const snapshot = this.session.snapshot();
    const meta = {
      schemaVersion: 1,
      sessionId: snapshot.sessionId,
      state: snapshot.state,
      stopReason: reason,
      startedAtMs: snapshot.startedAtMs,
      stoppedAtMs: snapshot.stoppedAtMs,
      sessionDir: this.sessionDir,
      app: this.appInfo,
      protocolCounters: snapshot.protocolCounters,
      lateBatches: snapshot.lateBatches,
      writer: writerStats,
      degradedReason: snapshot.degradedReason,
    };
    await this.writeMeta(meta);
  }

  status() {
    const snapshot = this.session.snapshot();
    return {
      enabled: true,
      state: snapshot.state,
      sessionId: snapshot.sessionId,
      generation: snapshot.generation,
      sequence: snapshot.sequence,
      sessionsRoot: this.sessionsRoot,
      sessionDir: this.sessionDir,
      eventsPath: this.eventsPath,
      metaPath: this.metaPath,
      lastError: this.lastError,
      protocolCounters: snapshot.protocolCounters,
      lateBatches: snapshot.lateBatches,
      writer: this.writer ? this.writer.getStats() : null,
    };
  }
}

function createDiagnosticsController(options) {
  return new DiagnosticsController(options);
}

module.exports = {
  DiagnosticsController,
  createDiagnosticsController,
  defaultSessionsRoot,
  retentionLimitFromEnv,
};
