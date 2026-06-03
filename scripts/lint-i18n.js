'use strict';

/**
 * i18n Linter — проверка синхронности файлов переводов с en.json.
 *
 * Языки делятся на два уровня:
 *
 *   CORE_LANGS  — обязательные языки (en, ru, uk).
 *                 ИИ-ассистент ОБЯЗАН переводить новые ключи на них сразу.
 *                 Линтер СТРОГО проверяет их: несовпадение ломает `npm test`.
 *
 *   Всё остальное — дополнительные языки (de, fr, es, zh, ja, …).
 *                 ИИ-ассистент НЕ переводит на них автоматически.
 *                 Переводы добавляются ТОЛЬКО по явному запросу пользователя.
 *                 Линтер выводит мягкие предупреждения (WARN), но НЕ ломает сборку.
 *
 * Чтобы добавить язык в обязательные — добавь код в CORE_LANGS ниже.
 */

const fs = require('fs');
const path = require('path');

// ── Обязательные языки (AI переводит сразу) ────────────────────────
const CORE_LANGS = ['en', 'ru', 'uk'];
// ───────────────────────────────────────────────────────────────────

const localesDir = path.join(__dirname, '..', 'locales');
const refFile = path.join(localesDir, 'en.json');

if (!fs.existsSync(refFile)) {
  console.error('Error: Reference file en.json not found!');
  process.exit(1);
}

let refData;
try {
  refData = JSON.parse(fs.readFileSync(refFile, 'utf8'));
} catch (e) {
  console.error('Error parsing en.json:', e.message);
  process.exit(1);
}

const targetFiles = fs.readdirSync(localesDir)
  .filter(f => f.endsWith('.json') && f !== 'en.json');

let hasErrors = false;

function getParams(str) {
  const matches = str.match(/\{[^}]+\}/g) || [];
  return new Set(matches.map(m => m.slice(1, -1)));
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

function lintObject(ref, target, filePath, currentPath = '') {
  let errors = 0;

  // 1. Check for missing keys in target, type mismatches, and parameter mismatches
  for (const key of Object.keys(ref)) {
    const keyPath = currentPath ? `${currentPath}.${key}` : key;
    if (!(key in target)) {
      console.error(`[FAIL] ${filePath}: Missing key "${keyPath}"`);
      errors++;
      continue;
    }

    const refType = typeof ref[key];
    const targetType = typeof target[key];

    if (refType !== targetType) {
      console.error(`[FAIL] ${filePath}: Type mismatch for "${keyPath}" (expected ${refType}, got ${targetType})`);
      errors++;
      continue;
    }

    if (refType === 'object' && ref[key] !== null && target[key] !== null) {
      errors += lintObject(ref[key], target[key], filePath, keyPath);
    } else if (refType === 'string') {
      const refParams = getParams(ref[key]);
      const targetParams = getParams(target[key]);
      if (!setsEqual(refParams, targetParams)) {
        const expected = Array.from(refParams).join(', ');
        const got = Array.from(targetParams).join(', ');
        console.error(`[FAIL] ${filePath}: Parameter mismatch for "${keyPath}" (expected params: {${expected}}, got: {${got}})`);
        errors++;
      }
    }
  }

  // 2. Check for extra/orphaned keys in target
  for (const key of Object.keys(target)) {
    const keyPath = currentPath ? `${currentPath}.${key}` : key;
    if (!(key in ref)) {
      console.error(`[FAIL] ${filePath}: Orphaned key "${keyPath}" (not present in en.json)`);
      errors++;
    }
  }

  return errors;
}

/** Count missing keys (flat, recursive) for summary */
function countMissing(ref, target, currentPath = '') {
  let missing = 0;
  for (const key of Object.keys(ref)) {
    const keyPath = currentPath ? `${currentPath}.${key}` : key;
    if (!(key in target)) {
      missing++;
    } else if (typeof ref[key] === 'object' && ref[key] !== null &&
               typeof target[key] === 'object' && target[key] !== null) {
      missing += countMissing(ref[key], target[key], keyPath);
    }
  }
  return missing;
}

/** Count total leaf keys in ref */
function countKeys(obj) {
  let n = 0;
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      n += countKeys(obj[key]);
    } else {
      n++;
    }
  }
  return n;
}

console.log('Running i18n keys and parameters linter...');
console.log(`Reference file: ${refFile}`);
console.log(`Core languages: ${CORE_LANGS.join(', ')}\n`);

const totalKeys = countKeys(refData);
let extraWarnings = 0;

for (const file of targetFiles) {
  const lang = file.replace('.json', '');
  const isCore = CORE_LANGS.includes(lang);
  const fullPath = path.join(localesDir, file);
  const relativePath = path.relative(path.join(__dirname, '..'), fullPath);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (e) {
    console.error(`[ERROR] Failed to parse JSON file ${relativePath}: ${e.message}`);
    if (isCore) hasErrors = true;
    continue;
  }

  if (isCore) {
    // ── Обязательный язык: строгая проверка ──
    console.log(`Linting ${relativePath} (core)...`);
    const errorsCount = lintObject(refData, data, relativePath);
    if (errorsCount > 0) {
      console.error(`Linting FAILED for ${relativePath} with ${errorsCount} errors.\n`);
      hasErrors = true;
    } else {
      console.log(`✓ ${relativePath} is in sync with en.json.\n`);
    }
  } else {
    // ── Дополнительный язык: мягкие предупреждения ──
    const missing = countMissing(refData, data);
    if (missing > 0) {
      const pct = Math.round(((totalKeys - missing) / totalKeys) * 100);
      console.log(`⚠ ${relativePath} (extra): ${missing} missing keys (${pct}% translated) — OK, not blocking build.\n`);
      extraWarnings++;
    } else {
      console.log(`✓ ${relativePath} (extra) is fully in sync with en.json.\n`);
    }
  }
}

if (hasErrors) {
  console.error('i18n Linting failed (core languages have errors).');
  process.exit(1);
} else {
  let msg = 'All core i18n translation files are in sync with en.json!';
  if (extraWarnings > 0) {
    msg += ` (${extraWarnings} extra language(s) have missing keys — translate when ready)`;
  }
  console.log(msg);
}
