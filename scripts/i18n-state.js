#!/usr/bin/env node
'use strict';

/**
 * I18N-SEM step 1 — translation freshness.  План: plans/i18n_semantic_system.md
 *
 *   node scripts/i18n-state.js report            состояние всех языков
 *   node scripts/i18n-state.js report de fr      только указанные
 *   node scripts/i18n-state.js keys de           что именно нужно перевести/пересмотреть
 *   node scripts/i18n-state.js baseline de       зафиксировать текущий перевод как сверенный
 *
 * Отпечаток берётся с ПАРЫ en+ru: английский — технический базис, русский — эталон
 * смысла и тона, поэтому изменение любого из них требует пересмотра перевода.
 *
 * Состояние живёт в locales/state/<lang>.json — это sidecar, приложение его не читает
 * и в сборку он не попадает (см. ignore-список `npm run package`).
 */

const fs = require('fs');
const path = require('path');
const state = require('../src/i18n-state');

const ROOT = path.join(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'locales');
const STATE_DIR = path.join(LOCALES_DIR, 'state');

// Уровни языков (plans/i18n_semantic_system.md). Уровень 0 — эталон, правится руками;
// 1 — популярные, обновляются каждый релиз; 2 — остальные, реже.
const TIERS = {
  0: ['en', 'ru'],
  1: ['uk', 'de', 'fr', 'es', 'pt', 'pl', 'zh', 'ja', 'it', 'tr'],
};
const tierOf = (lang) => (TIERS[0].includes(lang) ? 0 : TIERS[1].includes(lang) ? 1 : 2);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function localeCodes() {
  return fs.readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.basename(f, '.json'))
    .sort();
}

function loadSources() {
  const enDict = readJson(path.join(LOCALES_DIR, 'en.json'));
  const ruDict = readJson(path.join(LOCALES_DIR, 'ru.json'));
  if (!enDict) { console.error('locales/en.json не читается — без него состояние не посчитать.'); process.exit(1); }
  if (!ruDict) console.warn('⚠ locales/ru.json не читается: отпечаток считается только по английскому.\n');
  return { enDict, ruDict: ruDict || {} };
}

function statePath(lang) { return path.join(STATE_DIR, `${lang}.json`); }

function auditOne(lang, sources) {
  const langDict = readJson(path.join(LOCALES_DIR, `${lang}.json`));
  if (!langDict) return null;
  return state.auditLanguage({ ...sources, langDict, state: readJson(statePath(lang)) });
}

function pad(s, n) { return String(s).padEnd(n); }
function padL(s, n) { return String(s).padStart(n); }

function cmdReport(langs) {
  const sources = loadSources();
  const codes = (langs.length ? langs : localeCodes());
  const rows = [];
  for (const lang of codes) {
    const audit = auditOne(lang, sources);
    if (!audit) { console.error(`⚠ locales/${lang}.json не читается — пропущен`); continue; }
    rows.push({ lang, tier: tierOf(lang), ...audit });
  }
  rows.sort((a, b) => a.tier - b.tier || b.needsWork - a.needsWork || a.lang.localeCompare(b.lang));

  const total = rows.length ? rows[0].total : 0;
  console.log(`\nСостояние переводов — ${total} ключей, ${rows.length} языков`);
  console.log('Эталон: en (технический базис) + ru (смысл и тон)\n');
  console.log(`  ${pad('язык', 6)}${pad('ур.', 5)}${padL('свежих', 8)}${padL('устар.', 8)}${padL('не свер.', 10)}${padL('нет', 6)}${padL('лишних', 8)}   ${padL('к работе', 9)}`);
  console.log(`  ${'-'.repeat(60)}`);

  let lastTier = -1;
  for (const r of rows) {
    if (r.tier !== lastTier) { lastTier = r.tier; }
    const c = r.counts;
    console.log(
      `  ${pad(r.lang, 6)}${pad(r.tier, 5)}${padL(c.fresh, 8)}${padL(c.stale, 8)}${padL(c.unverified, 10)}${padL(c.missing, 6)}${padL(c.orphan, 8)}   ${padL(r.needsWork, 9)}`,
    );
  }

  const byTier = (t) => rows.filter((r) => r.tier === t);
  console.log('');
  for (const t of [0, 1, 2]) {
    const group = byTier(t);
    if (!group.length) continue;
    const work = group.reduce((n, r) => n + r.needsWork, 0);
    const fresh = group.reduce((n, r) => n + r.counts.fresh, 0);
    const label = t === 0 ? 'эталон' : t === 1 ? 'популярные' : 'остальные';
    console.log(`  Уровень ${t} (${label}): ${group.length} яз., подтверждённо свежих ключей ${fresh}, к работе ${work}`);
  }
  const unverified = rows.reduce((n, r) => n + r.counts.unverified, 0);
  if (unverified > 0) {
    console.log(`\n  «не сверено» = перевод есть, но нет доказательства, что он сделан с текущего текста.`);
    console.log(`  Это честное «неизвестно», а не «плохо». После реального прохода: node scripts/i18n-state.js baseline <lang>`);
  }
  console.log('');
}

function cmdKeys(langs) {
  if (!langs.length) { console.error('Укажи язык: node scripts/i18n-state.js keys de'); process.exit(1); }
  const sources = loadSources();
  for (const lang of langs) {
    const audit = auditOne(lang, sources);
    if (!audit) { console.error(`⚠ locales/${lang}.json не читается`); continue; }
    const keys = state.keysNeedingWork(audit);
    console.log(`\n${lang}: к работе ${keys.length} из ${audit.total}`);
    for (const key of keys) console.log(`  ${pad(audit.byKey[key], 12)}${key}`);
  }
  console.log('');
}

function cmdBaseline(langs) {
  if (!langs.length) { console.error('Укажи язык: node scripts/i18n-state.js baseline de'); process.exit(1); }
  const sources = loadSources();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  for (const lang of langs) {
    const langDict = readJson(path.join(LOCALES_DIR, `${lang}.json`));
    if (!langDict) { console.error(`⚠ locales/${lang}.json не читается — пропущен`); continue; }
    const next = state.buildState({ ...sources, langDict, lang });
    fs.writeFileSync(statePath(lang), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    console.log(`✓ ${lang}: зафиксировано ${Object.keys(next.keys).length} ключей (${next.verifiedAt})`);
  }
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'report': case undefined: cmdReport(args); break;
  case 'keys': cmdKeys(args); break;
  case 'baseline': cmdBaseline(args); break;
  default:
    console.error(`Неизвестная команда: ${command}\n  report [langs…] | keys <lang> | baseline <lang>`);
    process.exit(1);
}
