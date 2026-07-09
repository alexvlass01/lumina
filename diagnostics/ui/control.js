'use strict';

// Logic for the dev-only diagnostics control window. Polls status once a second (elapsed
// time + state only — deliberately no live FPS/charts, per the agreed design) and wires
// the buttons to the diagnostics IPC exposed on window.diag by control-preload.js.

const $ = (sel) => document.querySelector(sel);
const diag = window.diag || null;

const el = {
  dot: $('#dot'), stateText: $('#stateText'), timer: $('#timer'),
  mark: $('#btnMark'), stop: $('#btnStop'), start: $('#btnStart'),
  after: $('#after'), report: $('#btnReport'), folder: $('#btnFolder'),
  export: $('#btnExport'), clear: $('#btnClear'), warn: $('#warn'),
};

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function show(node, on) { node.classList.toggle('hidden', !on); }

let last = null;

function render(status) {
  last = status;
  const recording = status.state === 'recording';
  const degraded = status.state === 'degraded' || (status.writer && status.writer.degraded);

  el.dot.className = recording ? 'rec' : (degraded ? 'bad' : 'done');
  el.stateText.textContent = recording ? 'Идёт запись'
    : degraded ? 'Запись остановлена (неполная)'
    : status.state === 'complete' ? 'Запись остановлена' : 'Готово к записи';

  if (recording && Number.isFinite(status.startedAtMs)) {
    el.timer.textContent = fmtElapsed(Date.now() - status.startedAtMs);
  } else if (Number.isFinite(status.startedAtMs) && Number.isFinite(status.stoppedAtMs) && status.stoppedAtMs > 0) {
    el.timer.textContent = `длительность ${fmtElapsed(status.stoppedAtMs - status.startedAtMs)}`;
  } else {
    el.timer.textContent = '—';
  }

  show(el.mark, recording);
  show(el.stop, recording);
  show(el.start, !recording);
  show(el.after, !recording && !!status.sessionId);
  el.mark.disabled = !recording;

  const drops = status.writer && status.writer.dropped;
  if (degraded) {
    el.warn.textContent = `⚠ Запись неполная${status.degradedReason ? ' (' + status.degradedReason + ')' : ''}. Часть данных могла быть отброшена.`;
    show(el.warn, true);
  } else if (drops) {
    el.warn.textContent = `⚠ Отброшено событий: ${drops} (буфер был переполнен).`;
    show(el.warn, true);
  } else {
    show(el.warn, false);
  }
}

async function refresh() {
  if (!diag) { el.stateText.textContent = 'Недоступно вне Electron'; return; }
  try { render(await diag.status()); } catch { /* transient */ }
}

function bind(node, fn) {
  if (!node) return;
  node.addEventListener('click', async () => {
    if (!diag) return;
    node.disabled = true;
    try { await fn(); } catch {}
    node.disabled = false;
    refresh();
  });
}

// Marking must feel instant and give a flash of confirmation.
if (el.mark && diag) {
  el.mark.addEventListener('click', async () => {
    try { await diag.mark('lag'); } catch {}
    const original = el.mark.textContent;
    el.mark.textContent = '✓ Помечено';
    setTimeout(() => { el.mark.textContent = original; }, 900);
  });
}
bind(el.stop, () => diag.stop());
bind(el.start, () => diag.start());
bind(el.report, () => diag.openReport());
bind(el.folder, () => diag.openFolder());
bind(el.export, () => diag.exportSanitized());
bind(el.clear, async () => { await diag.clearSessions(); });

refresh();
setInterval(refresh, 1000);
