'use strict';

const fs = require('fs');
const path = require('path');

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

console.log('Running i18n keys and parameters linter...');
console.log(`Reference file: ${refFile}`);

for (const file of targetFiles) {
  const fullPath = path.join(localesDir, file);
  const relativePath = path.relative(path.join(__dirname, '..'), fullPath);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (e) {
    console.error(`[ERROR] Failed to parse JSON file ${relativePath}: ${e.message}`);
    hasErrors = true;
    continue;
  }

  console.log(`Linting ${relativePath}...`);
  const errorsCount = lintObject(refData, data, relativePath);
  if (errorsCount > 0) {
    console.error(`Linting failed for ${relativePath} with ${errorsCount} errors.\n`);
    hasErrors = true;
  } else {
    console.log(`✓ ${relativePath} is in sync with en.json.\n`);
  }
}

if (hasErrors) {
  console.error('i18n Linting failed.');
  process.exit(1);
} else {
  console.log('All i18n translation files are successfully synced with en.json!');
}
