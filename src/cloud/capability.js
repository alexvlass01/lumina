'use strict';

// Lumina Cloud capability resolution — C2 (pure, testable).
//
// Decides which cloud environment the app is allowed to talk to and exposes a
// SAFE state to the renderer. The renderer never sees the API URL or tokens — it
// only receives { environment, available, authAvailable, reason }. main.js keeps
// the resolved apiBase privately (used from C3 onward to build the real client).
//
// Environments (see plans/cloud_client_integration.md):
//   unavailable — default for public GitHub builds before production. The cloud UI
//                 is visible but disabled; NO request ever leaves for staging.
//   staging     — local dev + manual testing ONLY: requires (a) an unpackaged build
//                 AND (b) an explicit opt-in (env LUMINA_CLOUD=staging). It can never
//                 be activated by accident in an installed build.
//   production  — future public operation over a stable URL; turned on by a separate
//                 conscious change once prod infra + OAuth exist (C6).

const { STAGING_BASE } = require('./client');

// Production is OFF until the backend prod infra + OAuth are live (C6). There is no
// production URL yet, so production cannot be reached even if this were flipped.
const PRODUCTION_ENABLED = false;
const PRODUCTION_BASE = '';

// Pure resolver. All inputs are injected so this is unit-testable without Electron.
//   isPackaged       — app.isPackaged (installed build = true).
//   stagingOptIn     — explicit dev opt-in (main passes LUMINA_CLOUD === 'staging').
//   productionEnabled / productionBase — wired for C6; injectable for tests.
function resolveCapability({
  isPackaged = true,
  stagingOptIn = false,
  productionEnabled = PRODUCTION_ENABLED,
  productionBase = PRODUCTION_BASE,
  stagingBase = STAGING_BASE,
} = {}) {
  if (productionEnabled && productionBase) {
    return { environment: 'production', available: true, authAvailable: true, reason: null, apiBase: productionBase };
  }
  if (!isPackaged && stagingOptIn) {
    return { environment: 'staging', available: true, authAvailable: true, reason: null, apiBase: stagingBase };
  }
  // Default safe state: visible UI, disabled actions, no network.
  return { environment: 'unavailable', available: false, authAvailable: false, reason: 'coming_soon', apiBase: null };
}

// Strip the private apiBase before sending capability to the renderer over IPC.
function publicCapability(cap) {
  const c = cap || {};
  return {
    environment: c.environment || 'unavailable',
    available: !!c.available,
    authAvailable: !!c.authAvailable,
    reason: c.reason || null,
  };
}

module.exports = { resolveCapability, publicCapability, PRODUCTION_ENABLED };
