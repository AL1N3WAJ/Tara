/**
 * tests/visibility.test.js — Unit tests for visibility.js
 */

import {
  BORTLE_PRESETS, nelm, effectiveLimit, isVisible,
  constellationStatus, milkyWayOpacity, horizonGlowColor,
  starRadius, bvToColor,
} from '../js/visibility.js';

function approx(a, b, tol, label) {
  const diff = Math.abs(a - b);
  if (diff > tol) {
    throw new Error(`${label}: expected ${b.toFixed(4)} ± ${tol}, got ${a.toFixed(4)}`);
  }
}

// ─── 1. BORTLE_PRESETS sanity ─────────────────────────────────────────────────
function testBortlePresets() {
  if (BORTLE_PRESETS.length !== 9) throw new Error(`Expected 9 presets, got ${BORTLE_PRESETS.length}`);
  for (const p of BORTLE_PRESETS) {
    if (p.nelm < 3 || p.nelm > 8.5) throw new Error(`NELM out of range: ${p.nelm}`);
    if (!p.labelBn) throw new Error(`Missing Bangla label for Bortle ${p.bortle}`);
  }
  console.log('  ✓ BORTLE_PRESETS sanity');
}

// ─── 2. nelm() lookup ────────────────────────────────────────────────────────
function testNelm() {
  approx(nelm(1), 7.8, 0.01, 'nelm(1)');
  approx(nelm(8), 4.3, 0.01, 'nelm(8)');
  approx(nelm(9), 3.8, 0.01, 'nelm(9)');
  console.log('  ✓ nelm() lookup');
}

// ─── 3. effectiveLimit basic formula ─────────────────────────────────────────
function testEffectiveLimit() {
  // At zenith (alt=90°), airmass=1, no moon penalty, k=0.3
  // effLim = nelm - 0.3 * (1-1) - 0 = nelm
  const lim = effectiveLimit(5.8, 90, 0.3, 0);
  approx(lim, 5.8, 0.01, 'effectiveLimit at zenith');

  // At alt=30°, airmass=1/sin(30°)=2, effLim = 5.8 - 0.3*(2-1) = 5.5
  const lim2 = effectiveLimit(5.8, 30, 0.3, 0);
  approx(lim2, 5.5, 0.01, 'effectiveLimit at alt=30°');

  // Below 3° → -Infinity
  const limLow = effectiveLimit(5.8, 2, 0.3, 0);
  if (limLow !== -Infinity) throw new Error(`Expected -Infinity for alt<3°, got ${limLow}`);

  // With moon penalty 0.5
  const limMoon = effectiveLimit(5.8, 90, 0.3, 0.5);
  approx(limMoon, 5.3, 0.01, 'effectiveLimit with moonPenalty=0.5');

  console.log('  ✓ effectiveLimit formula');
}

// ─── 4. isVisible ─────────────────────────────────────────────────────────────
function testIsVisible() {
  // Bortle 8 (NELM 4.3): a mag 4.0 star at zenith should be visible
  if (!isVisible(4.0, 90, 4.3, 0.3, 0)) throw new Error('mag 4.0 should be visible at Bortle 8 zenith');
  // mag 5.0 at zenith: 5.0 > 4.3 → NOT visible at Bortle 8
  if (isVisible(5.0, 90, 4.3, 0.3, 0)) throw new Error('mag 5.0 should NOT be visible at Bortle 8 zenith');
  // mag 5.0 at zenith with Bortle 5 (NELM 5.8): visible
  if (!isVisible(5.0, 90, 5.8, 0.3, 0)) throw new Error('mag 5.0 should be visible at Bortle 5 zenith');
  console.log('  ✓ isVisible');
}

// ─── 5. constellationStatus ───────────────────────────────────────────────────
function testConstellationStatus() {
  // All stars bright and well above horizon → full
  const full = constellationStatus(
    Array(10).fill({ alt: 45, mag: 2.0 }), 5.8, 0.3, 0);
  if (full.status !== 'full') throw new Error(`Expected full, got ${full.status}`);

  // All stars too faint → hidden
  const hidden = constellationStatus(
    Array(10).fill({ alt: 45, mag: 7.0 }), 4.3, 0.3, 0);
  if (hidden.status !== 'hidden') throw new Error(`Expected hidden, got ${hidden.status}`);

  // 6/10 visible → partial
  const mixed = constellationStatus([
    ...Array(6).fill({ alt: 45, mag: 2.0 }),
    ...Array(4).fill({ alt: 45, mag: 7.0 }),
  ], 4.3, 0.3, 0);
  if (mixed.status !== 'partial') throw new Error(`Expected partial, got ${mixed.status}`);

  // Orion figure: ~8 bright stars, Bortle 5 → full; Bortle 8 test
  const orionStars = [
    { alt: 30, mag: 0.42 }, // Rigel
    { alt: 28, mag: 0.50 }, // Betelgeuse
    { alt: 35, mag: 1.64 }, // Bellatrix
    { alt: 25, mag: 1.70 }, // Saiph
    { alt: 32, mag: 1.74 }, // Alnitak
    { alt: 33, mag: 1.69 }, // Alnilam
    { alt: 31, mag: 2.23 }, // Mintaka
    { alt: 29, mag: 3.19 }, // Hatysa
  ];
  const orionB5 = constellationStatus(orionStars, 5.8, 0.3, 0);
  if (orionB5.status !== 'full') throw new Error(`Orion at Bortle 5: expected full, got ${orionB5.status}`);

  const orionB8 = constellationStatus(orionStars, 4.3, 0.3, 0);
  if (orionB8.status === 'hidden') throw new Error(`Orion at Bortle 8: should not be hidden (all core stars < 3.2)`);
  console.log(`  ✓ Orion: Bortle 5=${orionB5.status}, Bortle 8=${orionB8.status}`);

  console.log('  ✓ constellationStatus');
}

// ─── 6. milkyWayOpacity ──────────────────────────────────────────────────────
function testMilkyWayOpacity() {
  approx(milkyWayOpacity(1), 1.0, 0.001, 'opacity Bortle 1');
  approx(milkyWayOpacity(5), 0.0, 0.001, 'opacity Bortle 5');
  approx(milkyWayOpacity(9), 0.0, 0.001, 'opacity Bortle 9');
  approx(milkyWayOpacity(3), 0.5, 0.001, 'opacity Bortle 3');
  console.log('  ✓ milkyWayOpacity');
}

// ─── 7. bvToColor ────────────────────────────────────────────────────────────
function testBvToColor() {
  const white = bvToColor(0.0);
  const blue  = bvToColor(-0.4);
  const red   = bvToColor(2.0);
  if (!white.startsWith('rgb')) throw new Error('bvToColor(0) should return rgb');
  if (blue === white) throw new Error('Blue star should differ from white');
  if (red  === white) throw new Error('Red star should differ from white');
  if (bvToColor(null) !== '#ffffff') throw new Error('null B-V should give white');
  console.log('  ✓ bvToColor');
}

// ─── 8. starRadius ───────────────────────────────────────────────────────────
function testStarRadius() {
  const r1 = starRadius(1.0);
  const r3 = starRadius(3.0);
  const r6 = starRadius(6.0);
  if (r1 <= r3) throw new Error('Brighter star should have larger radius');
  if (r3 <= r6) throw new Error('Brighter star should have larger radius');
  if (r6 < 0.5) throw new Error('Minimum radius should be 0.5');
  console.log(`  ✓ starRadius: mag1=${r1.toFixed(2)} mag3=${r3.toFixed(2)} mag6=${r6.toFixed(2)}`);
}

// ─── Runner ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function run(name, fn) {
  try { fn(); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\n=== Akash visibility.js unit tests ===');
run('BORTLE_PRESETS sanity',   testBortlePresets);
run('nelm() lookup',           testNelm);
run('effectiveLimit formula',  testEffectiveLimit);
run('isVisible',               testIsVisible);
run('constellationStatus',     testConstellationStatus);
run('milkyWayOpacity',         testMilkyWayOpacity);
run('bvToColor',               testBvToColor);
run('starRadius',              testStarRadius);

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
