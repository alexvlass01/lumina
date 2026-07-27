'use strict';

// Translation freshness accounting (I18N-SEM step 1; plan: plans/i18n_semantic_system.md).
//
// The i18n linter only knows whether a key EXISTS. It cannot see that a translation
// went stale: rewording an English string leaves every other language holding a
// translation of the old text while still reporting "100% translated". That makes
// "refresh the popular languages every release" impossible — nothing knows what
// changed, so every pass would have to redo the whole language.
//
// So we record, per language and key, a fingerprint of the SOURCE strings the
// translation was made from. Comparing it with today's sources yields an honest
// status. Русский — эталон смысла и тона, английский — технический базис, поэтому
// отпечаток берётся с ПАРЫ значений: изменение любого из них требует пересмотра.
//
// Pure module: no filesystem here. Callers load the dictionaries and pass them in.

const crypto = require('crypto');

const STATUS = {
  FRESH: 'fresh',             // fingerprint matches the current sources
  STALE: 'stale',             // sources changed after this translation was recorded
  UNVERIFIED: 'unverified',   // translated, but we have no record of the source it came from
  MISSING: 'missing',         // key absent in this language
  ORPHAN: 'orphan',           // language has a key the reference no longer defines
};

// Flatten a nested dictionary into "a.b.c" -> string. Arrays are descended into by
// index ("smart.tips.0"), because Lumina translates list content too (the Home tips)
// and each entry has to be trackable on its own. Non-string leaves are kept as their
// raw value so a type mismatch is still visible to the caller.
function flatten(obj, prefix = '', out = {}) {
  if (!obj || typeof obj !== 'object') return out;
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') flatten(value, path, out);
    else out[path] = value;
  }
  return out;
}

// Short, stable fingerprint of the source pair. Truncated to 12 hex chars: collisions
// are irrelevant here (we compare a known key against its own previous value) and a
// short string keeps the state files readable in a diff.
function fingerprint(enValue, ruValue) {
  const payload = JSON.stringify([
    typeof enValue === 'string' ? enValue : null,
    typeof ruValue === 'string' ? ruValue : null,
  ]);
  return crypto.createHash('sha1').update(payload, 'utf8').digest('hex').slice(0, 12);
}

// Build the fingerprint map for every key the reference defines.
function sourceFingerprints(enDict, ruDict) {
  const en = flatten(enDict);
  const ru = flatten(ruDict);
  const out = {};
  for (const key of Object.keys(en)) out[key] = fingerprint(en[key], ru[key]);
  return out;
}

/**
 * Compare one language against the current sources.
 * @param {object} opts.enDict   reference dictionary (defines the key set)
 * @param {object} opts.ruDict   meaning/tone reference
 * @param {object} opts.langDict the language being audited
 * @param {object} opts.state    previously recorded { key: fingerprint }
 * @returns {{ byKey: object, counts: object, total: number, translatedPct: number, freshPct: number }}
 */
function auditLanguage({ enDict, ruDict, langDict, state } = {}) {
  const sources = sourceFingerprints(enDict, ruDict);
  const lang = flatten(langDict);
  const recorded = (state && typeof state === 'object' && state.keys && typeof state.keys === 'object')
    ? state.keys
    : (state && typeof state === 'object' ? state : {});

  const byKey = {};
  const counts = {
    [STATUS.FRESH]: 0,
    [STATUS.STALE]: 0,
    [STATUS.UNVERIFIED]: 0,
    [STATUS.MISSING]: 0,
    [STATUS.ORPHAN]: 0,
  };

  for (const [key, sourceHash] of Object.entries(sources)) {
    let status;
    if (typeof lang[key] !== 'string' || lang[key] === '') status = STATUS.MISSING;
    else if (!recorded[key]) status = STATUS.UNVERIFIED;
    else if (recorded[key] === sourceHash) status = STATUS.FRESH;
    else status = STATUS.STALE;
    byKey[key] = status;
    counts[status]++;
  }

  // Keys the language still carries after the reference dropped them.
  for (const key of Object.keys(lang)) {
    if (key in sources) continue;
    byKey[key] = STATUS.ORPHAN;
    counts[STATUS.ORPHAN]++;
  }

  const total = Object.keys(sources).length;
  const translated = total - counts[STATUS.MISSING];
  const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 100);
  return {
    byKey,
    counts,
    total,
    translatedPct: pct(translated),
    freshPct: pct(counts[STATUS.FRESH]),
    // What an update pass actually has to touch.
    needsWork: counts[STATUS.STALE] + counts[STATUS.MISSING] + counts[STATUS.UNVERIFIED],
  };
}

// Record the language's current translations as verified against today's sources.
// Only keys that are actually translated are recorded — baselining a missing key
// would claim work that was never done.
function buildState({ enDict, ruDict, langDict, lang, at } = {}) {
  const sources = sourceFingerprints(enDict, ruDict);
  const translated = flatten(langDict);
  const keys = {};
  for (const [key, hash] of Object.entries(sources)) {
    if (typeof translated[key] === 'string' && translated[key] !== '') keys[key] = hash;
  }
  return {
    lang: lang || '',
    verifiedAt: at || new Date().toISOString(),
    keys,
  };
}

// Keys an update pass must send to the translator, in reference order.
function keysNeedingWork(audit) {
  if (!audit || !audit.byKey) return [];
  return Object.entries(audit.byKey)
    .filter(([, status]) => status === STATUS.STALE || status === STATUS.MISSING || status === STATUS.UNVERIFIED)
    .map(([key]) => key);
}

module.exports = {
  STATUS,
  flatten,
  fingerprint,
  sourceFingerprints,
  auditLanguage,
  buildState,
  keysNeedingWork,
};
