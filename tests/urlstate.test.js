/**
 * tests/urlstate.test.js — Unit tests for urlstate.js
 */

import { parseHash, stateToHash, parseDate, todayUTC, DEFAULT_LAYERS } from '../js/urlstate.js';

function assertEqual(a, b, label) {
  if (a !== b) throw new Error(`${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function approx(a, b, tol, label) {
  if (Math.abs(a - b) > tol) throw new Error(`${label}: expected ${b} ± ${tol}, got ${a}`);
}

// ─── 1. parseHash with all parameters ────────────────────────────────────────
function testParseHashFull() {
  const h = '#loc=dhaka&date=2026-11-27&t=2100&bortle=8&lang=both&proj=equidistant&mode=allsky';
  const s = parseHash(h);
  assertEqual(s.loc,    'dhaka',        'loc');
  assertEqual(s.date,   '2026-11-27',   'date');
  assertEqual(s.hour,   21,             'hour');
  assertEqual(s.minute, 0,              'minute');
  assertEqual(s.bortle, 8,              'bortle');
  assertEqual(s.lang,   'both',         'lang');
  assertEqual(s.proj,   'equidistant',  'proj');
  assertEqual(s.mode,   'allsky',       'mode');
  console.log('  ✓ parseHash full');
}

// ─── 2. parseHash with custom location ───────────────────────────────────────
function testParseHashCustom() {
  const h = '#loc=custom&lat=22.3&lon=91.8&date=2026-06-15&t=2200&bortle=5&lang=bn&proj=stereographic';
  const s = parseHash(h);
  assertEqual(s.loc,  'custom', 'loc custom');
  approx(s.lat, 22.3, 0.001, 'lat');
  approx(s.lon, 91.8, 0.001, 'lon');
  assertEqual(s.hour, 22, 'hour');
  assertEqual(s.minute, 0, 'minute');
  assertEqual(s.lang, 'bn', 'lang bn');
  console.log('  ✓ parseHash custom location');
}

// ─── 3. parseHash defaults ────────────────────────────────────────────────────
function testParseHashDefaults() {
  const s = parseHash('#');
  assertEqual(s.loc,    'dhaka',       'default loc');
  approx(s.lat, 23.81, 0.01, 'default lat');
  approx(s.lon, 90.41, 0.01, 'default lon');
  assertEqual(s.bortle, 8,            'default bortle');
  assertEqual(s.lang,   'both',       'default lang');
  assertEqual(s.proj,   'equidistant','default proj');
  assertEqual(s.mode,   'allsky',     'default mode');
  if (!Array.isArray(s.layers) || s.layers.length === 0) throw new Error('Default layers should be non-empty');
  console.log('  ✓ parseHash defaults');
}

// ─── 4. stateToHash → parseHash round-trip ────────────────────────────────────
function testRoundTrip() {
  const original = {
    loc: 'chattogram', lat: 22.36, lon: 91.78,
    date: '2026-07-04', hour: 22, minute: 30,
    bortle: 7, nelm: null, lang: 'bn', proj: 'stereographic',
    mode: 'directional', dir: 'S', fov: 70,
    conId: 'ORI', bnNums: true, bnCal: false,
    compareMode: false, bortle2: 3,
    layers: ['stars', 'constellLines', 'milkyway'],
    k: 0.3, moonPenaltyEnabled: false, showBelowHorizon: false,
  };
  const hash    = stateToHash(original);
  const parsed  = parseHash(hash);

  assertEqual(parsed.loc,    original.loc,    'round-trip loc');
  assertEqual(parsed.date,   original.date,   'round-trip date');
  assertEqual(parsed.hour,   original.hour,   'round-trip hour');
  assertEqual(parsed.minute, original.minute, 'round-trip minute');
  assertEqual(parsed.bortle, original.bortle, 'round-trip bortle');
  assertEqual(parsed.lang,   original.lang,   'round-trip lang');
  assertEqual(parsed.proj,   original.proj,   'round-trip proj');
  assertEqual(parsed.mode,   original.mode,   'round-trip mode');
  assertEqual(parsed.bnNums, original.bnNums, 'round-trip bnNums');
  console.log('  ✓ stateToHash → parseHash round-trip');
}

// ─── 5. parseDate ────────────────────────────────────────────────────────────
function testParseDate() {
  const { year, month, day } = parseDate('2026-11-27');
  assertEqual(year,  2026, 'year');
  assertEqual(month, 11,   'month');
  assertEqual(day,   27,   'day');
  console.log('  ✓ parseDate');
}

// ─── 6. DEFAULT_LAYERS is non-empty ──────────────────────────────────────────
function testDefaultLayers() {
  if (!Array.isArray(DEFAULT_LAYERS) || DEFAULT_LAYERS.length === 0) {
    throw new Error('DEFAULT_LAYERS should be a non-empty array');
  }
  if (!DEFAULT_LAYERS.includes('stars')) throw new Error('DEFAULT_LAYERS must include "stars"');
  if (!DEFAULT_LAYERS.includes('constellLines')) throw new Error('DEFAULT_LAYERS must include "constellLines"');
  console.log(`  ✓ DEFAULT_LAYERS (${DEFAULT_LAYERS.length} items)`);
}

// ─── Runner ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function run(name, fn) {
  try { fn(); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\n=== Akash urlstate.js unit tests ===');
run('parseHash full',       testParseHashFull);
run('parseHash custom loc', testParseHashCustom);
run('parseHash defaults',   testParseHashDefaults);
run('round-trip',           testRoundTrip);
run('parseDate',            testParseDate);
run('DEFAULT_LAYERS',       testDefaultLayers);

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
