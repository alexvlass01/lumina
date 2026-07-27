#!/usr/bin/env node
'use strict';

/**
 * I18N-SEM step 3 helper — objective consistency review.  План: plans/i18n_semantic_system.md
 *
 *   node scripts/i18n-review.js terms [lang…]   один английский термин → разные переводы
 *   node scripts/i18n-review.js style [lang…]   отклонения от соглашений по типу элемента
 *   node scripts/i18n-review.js                 всё сразу (ru, uk)
 *
 * Цель этапа — естественность речи. Субъективное («звучит коряво») решает человек, но
 * часть проблем измерима: один и тот же термин переведён по-разному, кнопки написаны в
 * разной грамматической форме, многоточия и регистр гуляют. Скрипт находит именно это,
 * а глоссарий и стиль-гайд пишутся уже по итогам разбора.
 */

const fs = require('fs');
const path = require('path');
const state = require('../src/i18n-state');

const ROOT = path.join(__dirname, '..');
const LOCALES = path.join(ROOT, 'locales');
const CONTEXT = path.join(LOCALES, 'context', 'generated.json');
const DEFAULT_LANGS = ['ru', 'uk'];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Продуктовые термины, ради которых и заводится глоссарий: разнобой в них читается
// как «переводили разные люди», даже когда каждый вариант сам по себе допустим.
const TERMS = [
  'library', 'folder', 'wallpaper', 'monitor', 'slot', 'tag', 'source', 'favorite',
  'assign', 'apply', 'remove', 'delete', 'add', 'open', 'close', 'search', 'select',
];

function wordsOf(value) {
  return String(value || '').toLowerCase().match(/[a-z]+/g) || [];
}

function typeOf(entry) {
  const contexts = (entry && entry.contexts) || [];
  if (!contexts.length) return 'unknown';
  const priority = ['button', 'menu-item', 'toast', 'tooltip', 'placeholder', 'label'];
  for (const kind of priority) {
    if (contexts.some((c) => c.type === kind)) return kind;
  }
  return contexts[0].type || 'unknown';
}

function load() {
  const en = state.flatten(readJson(path.join(LOCALES, 'en.json')) || {});
  const context = readJson(CONTEXT);
  if (!context) {
    console.error('Нет locales/context/generated.json — сначала: node scripts/i18n-context.js write');
    process.exit(1);
  }
  return { en, entries: context.entries || {} };
}

function langDict(lang) {
  const dict = readJson(path.join(LOCALES, `${lang}.json`));
  if (!dict) { console.error(`locales/${lang}.json не читается`); process.exit(1); }
  return state.flatten(dict);
}

// Славянские языки склоняют термин, поэтому сравнивать строки целиком бессмысленно:
// «Библиотека» и «Удалить из библиотеки» — один термин. Сравниваем ОСНОВЫ: у каждой
// строки берём значимые слова, режем до основы и ищем доминирующую. Строка без неё —
// кандидат на разнобой («папка» против «тека»), то есть ровно то, ради чего глоссарий.
const STEM_LEN = 5;
const stemOf = (word) => word.slice(0, STEM_LEN);

function targetWords(value) {
  return (String(value || '').toLowerCase().match(/[a-zа-яёіїєґ']+/g) || [])
    .filter((w) => w.length >= 4);
}

/** Один английский термин, переданный в языке разными словами. */
function reportTerms(langs, { en }) {
  for (const lang of langs) {
    const target = langDict(lang);
    console.log(`\n=== ${lang}: разнобой в терминах ===`);
    let found = 0;
    for (const term of TERMS) {
      const rows = [];
      for (const [key, value] of Object.entries(en)) {
        if (typeof value !== 'string' || typeof target[key] !== 'string' || !target[key]) continue;
        // Короткие строки: в длинной фразе термин может законно уйти в другую форму.
        const words = wordsOf(value);
        if (words.length > 4 || !words.includes(term)) continue;
        rows.push({ key, en: value, value: target[key], stems: new Set(targetWords(target[key]).map(stemOf)) });
      }
      if (rows.length < 3) continue;

      const freq = new Map();
      for (const row of rows) for (const stem of row.stems) freq.set(stem, (freq.get(stem) || 0) + 1);
      const [dominant, hits] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0] || [];
      // Основа должна встречаться в большинстве строк, иначе это просто разные фразы.
      if (!dominant || hits < Math.ceil(rows.length * 0.6)) continue;
      const outliers = rows.filter((row) => !row.stems.has(dominant));
      if (!outliers.length) continue;

      found++;
      console.log(`\n  «${term}» обычно как «${dominant}…» (${hits} из ${rows.length}), но:`);
      for (const row of outliers.slice(0, 6)) {
        console.log(`     ${row.key.padEnd(26)} ${JSON.stringify(row.value)}  ← en: ${JSON.stringify(row.en)}`);
      }
      if (outliers.length > 6) console.log(`     … ещё ${outliers.length - 6}`);
    }
    if (!found) console.log('  расхождений не найдено');
  }
}

/** Отклонения от соглашений внутри одного типа элемента. */
function reportStyle(langs, { en, entries }) {
  const byType = {};
  for (const key of Object.keys(en)) {
    const type = typeOf(entries[key]);
    (byType[type] = byType[type] || []).push(key);
  }

  for (const lang of langs) {
    const target = langDict(lang);
    console.log(`\n=== ${lang}: соглашения по типу элемента ===`);
    for (const [type, keys] of Object.entries(byType).sort((a, b) => b[1].length - a[1].length)) {
      if (type === 'unknown' || keys.length < 4) continue;
      const rows = keys
        .filter((k) => typeof target[k] === 'string' && target[k])
        .map((k) => ({ key: k, en: en[k], value: target[k] }));
      if (rows.length < 4) continue;

      // Многоточие: в английском «…» означает «действие откроет диалог».
      const enEllipsis = rows.filter((r) => /[…]|\.\.\.$/.test(r.en));
      const lost = enEllipsis.filter((r) => !/[…]|\.\.\.$/.test(r.value));
      // Заглавная в начале ожидаема только там, где она есть в английском: строчные
      // фрагменты вроде «основной» намеренно склеиваются в «Монитор 1 · основной».
      const lowerStart = rows.filter((r) => /^[a-zа-яёіїєґ]/.test(r.value) && /^[A-Z]/.test(r.en));
      // Точка в конце короткой кнопки/пункта меню читается неестественно.
      const trailingDot = ['button', 'menu-item'].includes(type)
        ? rows.filter((r) => /[^.]\.$/.test(r.value) && r.value.length < 40) : [];

      const issues = [];
      if (lost.length) issues.push(['потеряно многоточие (в en оно есть)', lost]);
      if (lowerStart.length) issues.push(['начинается со строчной', lowerStart]);
      if (trailingDot.length) issues.push(['точка в конце короткой надписи', trailingDot]);
      if (!issues.length) continue;

      console.log(`\n  ${type} (${rows.length} строк):`);
      for (const [label, list] of issues) {
        console.log(`    ${label}: ${list.length}`);
        for (const r of list.slice(0, 5)) {
          console.log(`       ${r.key.padEnd(26)} ${JSON.stringify(r.value)}  ← en: ${JSON.stringify(r.en)}`);
        }
        if (list.length > 5) console.log(`       … ещё ${list.length - 5}`);
      }
    }
  }
}

const [command, ...args] = process.argv.slice(2);
const langs = args.filter((a) => !a.startsWith('--'));
const data = load();
const targets = langs.length ? langs : DEFAULT_LANGS;

if (command === 'terms') reportTerms(targets, data);
else if (command === 'style') reportStyle(targets, data);
else if (!command) { reportTerms(targets, data); reportStyle(targets, data); }
else { console.error(`Неизвестная команда: ${command}\n  terms [lang…] | style [lang…]`); process.exit(1); }
console.log('');
