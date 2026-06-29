'use strict';

// One cancelable "invisible wallpaper change" (stealth) session.
//
// A stealth change waits for each monitor to be covered by a fullscreen window before
// swapping its wallpaper, so the change is never seen. This module owns the wait/retry/
// timeout/cancel state machine. It is PURE and unit-testable: timers, monitor enumeration,
// the coverage check and the actual apply are all injected (real ones in main.js, fakes in
// the tests).
//
// Design rules (see plans/stealth_triggers.md):
//   * At most ONE active session. A new request RETARGETS the existing session instead of
//     starting a parallel one, so two automatic events (e.g. wake + a theme flip) can never
//     double-advance the playlist.
//   * A Windows theme change while a session is pending folds in as a retarget with
//     advance=false (apply the new theme's CURRENT frame): covered monitors update at once
//     (invisible), the rest keep waiting. Nothing flashes on an uncovered monitor.
//   * singleWallpaper advances the playlist exactly once per session, then re-applies the
//     same frame to each monitor as it gets covered.
//   * After the timeout the remaining monitors are switched anyway (the change stops being
//     strictly invisible, but it is bounded).
//   * cancel() invalidates the in-flight session (a manual wallpaper change supersedes it).

function createStealthController(deps = {}) {
  const {
    now = () => Date.now(),
    setTimer,            // (fn, ms) => handle
    clearTimer,          // (handle) => void
    getMonitors,         // async () => [monitorId]
    checkCovered,        // async () => [coveredMonitorId]
    apply,               // async ({ theme, monitors, advance, single }) => void
    pollMs = 3000,
    log = () => {},
  } = deps;

  if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
    throw new Error('createStealthController: setTimer/clearTimer are required');
  }

  let gen = 0;        // bumped on cancel/retarget-mismatch to invalidate stale async work
  let session = null; // the single active session, or null
  let handle = null;  // the currently-scheduled tick timer

  function clearHandle() {
    if (handle != null) { clearTimer(handle); handle = null; }
  }

  // Invalidate the active session. A manual wallpaper change calls this so a pending
  // stealth advance cannot overwrite the user's choice moments later.
  function cancel() {
    gen++;
    session = null;
    clearHandle();
  }

  // Start a new session, or retarget the existing one to `theme`. Re-pends ALL monitors so
  // every screen converges to the requested theme; covered ones apply on the next tick.
  async function request(opts = {}) {
    const {
      theme,
      advance = true,
      single = false,
      timeoutMs = 300000,
      initialDelayMs = 0,
    } = opts;
    const myGen = gen;
    let monitorIds;
    try { monitorIds = await getMonitors(); }
    catch (e) { log('getMonitors failed', e); monitorIds = []; }
    if (myGen !== gen) return;                 // canceled while enumerating
    const ids = (Array.isArray(monitorIds) ? monitorIds : []).filter(Boolean);
    if (!ids.length) return;

    const deadline = now() + Math.max(0, Number(timeoutMs) || 0);
    if (session) {
      session.theme = theme;
      session.advance = !!advance;
      session.single = !!single;
      session.didAdvance = false;              // a new target may advance once again
      session.pending = new Set(ids);
      session.deadline = deadline;
    } else {
      session = {
        theme,
        advance: !!advance,
        single: !!single,
        didAdvance: false,
        pending: new Set(ids),
        deadline,
      };
    }
    clearHandle();
    handle = setTimer(runTick, Math.max(0, Number(initialDelayMs) || 0));
  }

  function runTick() { tick().catch((e) => log('tick error', e)); }

  async function tick() {
    if (!session) return;
    const myGen = gen;
    let covered;
    try { covered = new Set(await checkCovered()); }
    catch (e) { log('checkCovered failed', e); covered = new Set(); }
    if (myGen !== gen || !session) return;     // canceled/retargeted while checking

    const timedOut = now() >= session.deadline;
    const toApply = [];
    for (const id of session.pending) {
      if (timedOut || covered.has(id)) toApply.push(id);
    }
    for (const id of toApply) session.pending.delete(id);

    if (toApply.length) {
      // singleWallpaper: advance the shared playlist ONCE per session, then just re-apply
      // the same frame to each monitor as it is covered.
      const doAdvance = session.advance && (!session.single || !session.didAdvance);
      try {
        await apply({ theme: session.theme, monitors: toApply, advance: doAdvance, single: session.single });
      } catch (e) { log('apply failed', e); }
      if (session.advance && session.single) session.didAdvance = true;
      if (myGen !== gen || !session) return;   // canceled/retargeted during apply
    }

    if (session.pending.size > 0) {
      handle = setTimer(runTick, pollMs);
    } else {
      session = null;
      clearHandle();
    }
  }

  return {
    request,
    cancel,
    isActive: () => !!session,
    // test-only introspection
    _snapshot: () => session && {
      theme: session.theme,
      advance: session.advance,
      single: session.single,
      didAdvance: session.didAdvance,
      pending: Array.from(session.pending),
      deadline: session.deadline,
    },
  };
}

module.exports = { createStealthController };
