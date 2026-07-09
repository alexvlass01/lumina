'use strict';

// Optional observability hooks (used by dev-only diagnostics; production callers pass
// nothing and take the single `if (hooks)` branch per event):
//   onEnqueue({ pending, active })
//   onStart({ startedAt, waitMs, pending, active })
//   onSettle({ ok, startedAt, waitMs, runMs, pending, active })  // active still counts this job
// Hook errors are swallowed — a broken observer must never break or reorder the queue.
// `hooks.now` overrides the clock for deterministic tests.
function createTaskQueue(limit, hooks = null) {
  const max = Math.max(1, Math.floor(Number(limit) || 1));
  const queue = [];
  let active = 0;
  const now = hooks && typeof hooks.now === 'function' ? hooks.now : Date.now;

  const emit = (name, info) => {
    if (!hooks || typeof hooks[name] !== 'function') return;
    try { hooks[name](info); } catch {}
  };

  const pump = () => {
    while (active < max && queue.length) {
      const job = queue.shift();
      active += 1;
      const startedAt = now();
      const waitMs = Math.max(0, startedAt - job.enqueuedAt);
      emit('onStart', { startedAt, waitMs, pending: queue.length, active });
      const settle = (ok) => emit('onSettle', {
        ok,
        startedAt,
        waitMs,
        runMs: Math.max(0, now() - startedAt),
        pending: queue.length,
        active,
      });
      Promise.resolve()
        .then(job.fn)
        .then(
          (value) => { settle(true); job.resolve(value); },
          (error) => { settle(false); job.reject(error); },
        )
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  return function enqueue(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject, enqueuedAt: now() });
      emit('onEnqueue', { pending: queue.length, active });
      pump();
    });
  };
}

module.exports = { createTaskQueue };
