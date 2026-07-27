'use strict';

const assert = require('assert');
const S = require('../src/i18n-state');

let passed = 0;
const ok = (name, condition) => { assert.ok(condition, name); console.log('  OK ' + name); passed++; };

const en = { nav: { home: 'Home' }, library: { remove: 'Remove from library', assign: 'Assign…' } };
const ru = { nav: { home: 'Главная' }, library: { remove: 'Удалить из библиотеки', assign: 'Назначить…' } };

ok('flatten: nested keys become dotted paths', (() => {
  const flat = S.flatten(en);
  return flat['nav.home'] === 'Home' && flat['library.remove'] === 'Remove from library'
    && Object.keys(flat).length === 3;
})());
ok('flatten: absent/invalid input is safe', Object.keys(S.flatten(null)).length === 0 && Object.keys(S.flatten('x')).length === 0);
// Lumina translates list content (the Home tips), so an array must not be mistaken for
// an untranslated leaf — each entry is tracked on its own.
ok('flatten: arrays are descended into by index', (() => {
  const flat = S.flatten({ smart: { tips: ['first', 'second'] } });
  return flat['smart.tips.0'] === 'first' && flat['smart.tips.1'] === 'second'
    && Object.keys(flat).length === 2;
})());
ok('flatten: a translated list is not reported as missing', (() => {
  const ref = { smart: { tips: ['a', 'b'] } };
  const a = S.auditLanguage({ enDict: ref, ruDict: ref, langDict: { smart: { tips: ['А', 'Б'] } }, state: null });
  return a.counts.missing === 0 && a.total === 2;
})());
ok('flatten: a short translated list still reports the absent entries', (() => {
  const ref = { smart: { tips: ['a', 'b', 'c'] } };
  const a = S.auditLanguage({ enDict: ref, ruDict: ref, langDict: { smart: { tips: ['А'] } }, state: null });
  return a.counts.missing === 2 && a.counts.unverified === 1;
})());

ok('fingerprint: same sources give the same hash', S.fingerprint('Home', 'Главная') === S.fingerprint('Home', 'Главная'));
ok('fingerprint: changing the English wording changes the hash',
  S.fingerprint('Remove', 'Удалить') !== S.fingerprint('Remove from library', 'Удалить'));
ok('fingerprint: changing the Russian reference also changes the hash',
  S.fingerprint('Remove', 'Удалить') !== S.fingerprint('Remove', 'Прибрати'));
ok('fingerprint: missing Russian is not the same as an empty string',
  S.fingerprint('Home', undefined) !== S.fingerprint('Home', ''));
ok('fingerprint: short and stable', /^[0-9a-f]{12}$/.test(S.fingerprint('a', 'b')));
ok('translation fingerprint is bound to both language and value',
  S.translationFingerprint('de', 'Startseite') !== S.translationFingerprint('fr', 'Startseite')
  && S.translationFingerprint('de', 'Startseite') !== S.translationFingerprint('de', 'Accueil'));
ok('state record round-trips source and translation hashes', (() => {
  const encoded = S.encodeRecord('0123456789ab', 'abcdef012345');
  const decoded = S.decodeRecord(encoded);
  return decoded && decoded.sourceHash === '0123456789ab'
    && decoded.translationHash === 'abcdef012345' && decoded.legacy === false;
})());
ok('legacy source-only records are recognized but marked as legacy', (() => {
  const decoded = S.decodeRecord('0123456789ab');
  return decoded && decoded.sourceHash === '0123456789ab' && decoded.legacy === true;
})());

// --- audit ---------------------------------------------------------------
{
  const de = { nav: { home: 'Startseite' }, library: { remove: 'Aus Bibliothek entfernen', assign: 'Zuweisen…' } };
  const state = S.buildState({ enDict: en, ruDict: ru, langDict: de, lang: 'de', at: '2026-01-01T00:00:00Z' });
  const audit = S.auditLanguage({ enDict: en, ruDict: ru, langDict: de, state, lang: 'de' });
  ok('audit: a freshly baselined language is fully fresh',
    audit.counts.fresh === 3 && audit.counts.stale === 0 && audit.freshPct === 100);

  // The English wording changes → only that key goes stale.
  const en2 = JSON.parse(JSON.stringify(en));
  en2.library.remove = 'Remove from the library';
  const after = S.auditLanguage({ enDict: en2, ruDict: ru, langDict: de, state, lang: 'de' });
  ok('audit: rewording a source string marks exactly that key stale',
    after.counts.stale === 1 && after.byKey['library.remove'] === S.STATUS.STALE
    && after.byKey['nav.home'] === S.STATUS.FRESH);
  ok('audit: stale keys are what an update pass must touch',
    S.keysNeedingWork(after).join(',') === 'library.remove' && after.needsWork === 1);

  // A key added to the reference is missing until translated.
  const en3 = JSON.parse(JSON.stringify(en));
  en3.library.details = 'Details…';
  const withNew = S.auditLanguage({ enDict: en3, ruDict: ru, langDict: de, state, lang: 'de' });
  ok('audit: a new reference key is missing, not stale',
    withNew.byKey['library.details'] === S.STATUS.MISSING && withNew.counts.missing === 1);
  ok('audit: translated share ignores freshness', withNew.translatedPct === 75 && withNew.total === 4);
}

ok('audit: untracked translations are unverified, never assumed fresh', (() => {
  const fr = { nav: { home: 'Accueil' }, library: { remove: 'Retirer', assign: 'Assigner' } };
  const a = S.auditLanguage({ enDict: en, ruDict: ru, langDict: fr, state: null });
  return a.counts.unverified === 3 && a.counts.fresh === 0 && a.freshPct === 0 && a.translatedPct === 100;
})());

ok('audit: a key the reference dropped is reported as an orphan', (() => {
  const it = { nav: { home: 'Home' }, library: { remove: 'Rimuovi', assign: 'Assegna', gone: 'Vecchio' } };
  const a = S.auditLanguage({ enDict: en, ruDict: ru, langDict: it, state: null });
  return a.counts.orphan === 1 && a.byKey['library.gone'] === S.STATUS.ORPHAN && a.total === 3;
})());

ok('audit: an empty string counts as untranslated', (() => {
  const es = { nav: { home: '' }, library: { remove: 'Quitar', assign: 'Asignar' } };
  const a = S.auditLanguage({ enDict: en, ruDict: ru, langDict: es, state: null });
  return a.byKey['nav.home'] === S.STATUS.MISSING && a.counts.missing === 1;
})());

ok('audit: an empty language is fully missing, not fresh', (() => {
  const a = S.auditLanguage({ enDict: en, ruDict: ru, langDict: {}, state: null });
  return a.counts.missing === 3 && a.translatedPct === 0 && a.needsWork === 3;
})());

// --- baseline ------------------------------------------------------------
ok('buildState: only translated keys are recorded', (() => {
  const pl = { nav: { home: 'Strona główna' }, library: { assign: 'Przypisz' } };
  const st = S.buildState({ enDict: en, ruDict: ru, langDict: pl, lang: 'pl' });
  return Object.keys(st.keys).length === 2 && !('library.remove' in st.keys) && st.lang === 'pl';
})());
ok('buildState: records when the language was verified', (() => {
  const st = S.buildState({ enDict: en, ruDict: ru, langDict: en, lang: 'en', at: '2026-07-25T10:00:00Z' });
  return st.version === 2 && st.verifiedAt === '2026-07-25T10:00:00Z';
})());
ok('buildState: baselining then auditing leaves nothing to do', (() => {
  const uk = { nav: { home: 'Головна' }, library: { remove: 'Прибрати з бібліотеки', assign: 'Призначити…' } };
  const st = S.buildState({ enDict: en, ruDict: ru, langDict: uk, lang: 'uk' });
  const a = S.auditLanguage({ enDict: en, ruDict: ru, langDict: uk, state: st, lang: 'uk' });
  return a.needsWork === 0 && S.keysNeedingWork(a).length === 0;
})());
ok('audit: accepts a bare {key: hash} map as well as a full state file', (() => {
  const uk = { nav: { home: 'Головна' }, library: { remove: 'Прибрати', assign: 'Призначити' } };
  const full = S.buildState({ enDict: en, ruDict: ru, langDict: uk, lang: 'uk' });
  const bare = S.auditLanguage({ enDict: en, ruDict: ru, langDict: uk, state: full.keys, lang: 'uk' });
  return bare.counts.fresh === 3;
})());
ok('audit: editing a target translation after baseline makes it unverified', (() => {
  const de = { nav: { home: 'Startseite' }, library: { remove: 'Entfernen', assign: 'Zuweisen' } };
  const st = S.buildState({ enDict: en, ruDict: ru, langDict: de, lang: 'de' });
  de.nav.home = 'unrelated text';
  const a = S.auditLanguage({ enDict: en, ruDict: ru, langDict: de, state: st, lang: 'de' });
  return a.byKey['nav.home'] === S.STATUS.UNVERIFIED
    && a.byKey['library.remove'] === S.STATUS.FRESH;
})());
ok('audit: a state file copied from another language cannot report fresh', (() => {
  const de = { nav: { home: 'Home' }, library: { remove: 'Remove', assign: 'Assign' } };
  const fr = JSON.parse(JSON.stringify(de));
  const deState = S.buildState({ enDict: en, ruDict: ru, langDict: de, lang: 'de' });
  const a = S.auditLanguage({ enDict: en, ruDict: ru, langDict: fr, state: deState, lang: 'fr' });
  return a.counts.fresh === 0 && a.counts.unverified === 3;
})());
ok('audit: a wrapped state cannot prove freshness when the caller omits the language', (() => {
  const de = { nav: { home: 'Startseite' }, library: { remove: 'Entfernen', assign: 'Zuweisen' } };
  const st = S.buildState({ enDict: en, ruDict: ru, langDict: de, lang: 'de' });
  const a = S.auditLanguage({ enDict: en, ruDict: ru, langDict: de, state: st });
  return a.counts.fresh === 0 && a.counts.unverified === 3;
})());
ok('audit: legacy source-only state can detect stale but never prove fresh', (() => {
  const de = { nav: { home: 'Startseite' }, library: { remove: 'Entfernen', assign: 'Zuweisen' } };
  const legacy = { lang: 'de', keys: S.sourceFingerprints(en, ru) };
  const current = S.auditLanguage({ enDict: en, ruDict: ru, langDict: de, state: legacy, lang: 'de' });
  const en2 = JSON.parse(JSON.stringify(en));
  en2.nav.home = 'Homepage';
  const changed = S.auditLanguage({ enDict: en2, ruDict: ru, langDict: de, state: legacy, lang: 'de' });
  return current.counts.unverified === 3
    && changed.byKey['nav.home'] === S.STATUS.STALE;
})());

// --- leaf-accurate missing count -----------------------------------------
ok('countMissingLeaves: an absent subtree counts every reference leaf',
  S.countMissingLeaves({ group: { one: '1', two: '2' } }, {}) === 2);
ok('countMissingLeaves: a wrong-type subtree counts every reference leaf',
  S.countMissingLeaves({ group: { one: '1', two: '2' } }, { group: 'wrong type' }) === 2);
ok('countMissingLeaves: an empty string is missing but a translated sibling is not',
  S.countMissingLeaves(
    { group: { one: '1', two: '2' } },
    { group: { one: 'translated', two: '' } },
  ) === 1);

console.log('\nAll ' + passed + ' i18n-state tests passed.');
