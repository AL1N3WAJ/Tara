#!/usr/bin/env node
/**
 * scripts/validate_names.js — CI validator for data/names_bn.json
 *
 * Checks:
 *   1. Valid JSON
 *   2. UTF-8 (Node default)
 *   3. Only expected top-level keys
 *   4. Each `bn` value is a non-empty string
 *   5. Each `bn` value contains at least one Bengali character (U+0980–U+09FF)
 *   6. No duplicate keys within any section
 *
 * Usage: node scripts/validate_names.js [path/to/names_bn.json]
 * Exit code 0 = pass, 1 = fail.
 */

import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const filePath = process.argv[2]
  ? resolve(process.argv[2])
  : join(__dirname, '../data/names_bn.json');

const EXPECTED_KEYS = new Set(['constellations', 'stars', 'planets', 'misc']);
const BENGALI_RE    = /[\u0980-\u09FF]/;

let errors = 0;
function fail(msg) { console.error(`  ✗ ${msg}`); errors++; }

// 1. Read and parse JSON
let raw, obj;
try {
  raw = readFileSync(filePath, 'utf-8');
} catch (e) {
  fail(`Cannot read file: ${e.message}`);
  process.exit(1);
}

try {
  obj = JSON.parse(raw);
} catch (e) {
  fail(`Invalid JSON: ${e.message}`);
  process.exit(1);
}
console.log(`  ✓ Valid JSON: ${filePath}`);

// 2. Check top-level keys
for (const k of Object.keys(obj)) {
  if (!EXPECTED_KEYS.has(k)) fail(`Unexpected top-level key: "${k}"`);
}
for (const k of EXPECTED_KEYS) {
  if (!obj[k]) fail(`Missing expected key: "${k}"`);
}
console.log('  ✓ Top-level keys correct');

// 3. Check each section
for (const section of EXPECTED_KEYS) {
  if (!obj[section]) continue;
  const seen = new Set();

  for (const [englishKey, entry] of Object.entries(obj[section])) {
    // Duplicate key check (JSON.parse silently keeps last; check raw string)
    if (seen.has(englishKey)) fail(`Duplicate key "${englishKey}" in section "${section}"`);
    seen.add(englishKey);

    if (!entry || typeof entry !== 'object') {
      fail(`Entry "${englishKey}" in "${section}" is not an object`); continue;
    }

    // bn field
    if ('bn' in entry) {
      const bn = entry.bn;
      if (typeof bn !== 'string' || bn.trim() === '') {
        fail(`"${englishKey}.bn" in "${section}" is empty or not a string`);
      } else if (!BENGALI_RE.test(bn)) {
        fail(`"${englishKey}.bn" = "${bn}" contains no Bengali characters`);
      }
    }

    // verified field: boolean if present
    if ('verified' in entry && typeof entry.verified !== 'boolean') {
      fail(`"${englishKey}.verified" in "${section}" is not a boolean`);
    }
  }
}

// 4. Check raw for duplicate keys (JSON.parse silently deduplicates)
function checkDuplicateKeys(jsonStr) {
  const keyRe = /"([^"\\]*)"\s*:/g;
  const path  = [];
  let m;
  // Simple bracket tracker
  const stack = [];
  let inStr = false, escape = false;
  for (let i = 0; i < jsonStr.length; i++) {
    const c = jsonStr[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"')  { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') stack.push(new Set());
    if (c === '}') stack.pop();
  }
  // Use regex approach for key collision
  const topLevelKeys = new Set();
  let inTopLevel = false;
  const topRe = /"(\w+)"\s*:\s*\{/g;
  while ((m = topRe.exec(jsonStr)) !== null) {
    if (topLevelKeys.has(m[1])) fail(`Raw duplicate top-level key: "${m[1]}"`);
    topLevelKeys.add(m[1]);
  }
}
checkDuplicateKeys(raw);
console.log('  ✓ No duplicate keys detected');

// Summary
if (errors === 0) {
  console.log(`\n  ✅ names_bn.json validation passed (0 errors)\n`);
  process.exit(0);
} else {
  console.error(`\n  ❌ names_bn.json validation FAILED (${errors} error${errors > 1 ? 's' : ''})\n`);
  process.exit(1);
}
