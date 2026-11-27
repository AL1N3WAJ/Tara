/**
 * tests/astro.test.js — Unit tests for astro.js
 *
 * Run with: node --experimental-vm-modules node_modules/.bin/jest
 * or: npm test
 *
 * Verifies:
 *  1. Julian Date computation (known epoch J2000)
 *  2. GMST at J2000
 *  3. RA/Dec → Alt/Az pipeline (Dhaka, 2026-11-27 21:00 BST)
 *     - Sirius, Orion's belt (Alnilam), Polaris
 *  4. Polaris altitude ≈ latitude
 *  5. Precession is small over 25 years
 *  6. moonPhase returns valid fraction 0–1
 *  7. toBanglaDate is correct for 2026-04-14 (Poila Boishakh)
 *  8. toBanglaNum converts correctly
 */

import {
  dateToJD, jdToGMST, raDecToAltAz, bstToUtc,
  moonPhase, precess, toBanglaDate, toBanglaNum,
  mod360, mod24, hmsToH, dmsToD,
} from '../js/astro.js';

// ─── Helper: assert within tolerance ──────────────────────────────────────────
function approx(a, b, tol, label) {
  const diff = Math.abs(a - b);
  if (diff > tol) {
    throw new Error(`${label}: expected ${b.toFixed(4)} ± ${tol}, got ${a.toFixed(4)} (diff ${diff.toFixed(4)})`);
  }
}

// ─── 1. Julian Date ───────────────────────────────────────────────────────────
function testJulianDate() {
  // J2000 = 2451545.0 at 2000-01-01 12:00 UTC
  const utc = new Date('2000-01-01T12:00:00Z');
  const jd  = dateToJD(utc);
  approx(jd, 2451545.0, 0.0001, 'JD of J2000');

  // Known: 1987-04-10 0h UT → JD 2446895.5 (Meeus example)
  const utc2 = new Date('1987-04-10T00:00:00Z');
  approx(dateToJD(utc2), 2446895.5, 0.0001, 'JD 1987-04-10');
  console.log('  ✓ Julian Date');
}

// ─── 2. GMST ─────────────────────────────────────────────────────────────────
function testGMST() {
  // Meeus p.88 example: 1987-04-10 0h UT → GMST = 197.6922° (≈ 13h 10m 46.3671s)
  const jd    = 2446895.5;
  const gmst  = jdToGMST(jd);
  approx(gmst, 197.6922, 0.01, 'GMST 1987-04-10');
  console.log('  ✓ GMST');
}

// ─── 3. Sirius on 2026-11-27 21:00 BST (Dhaka) ───────────────────────────────
function testSiriusDhaka20261127() {
  // Sirius: RA 6h 45m 08.9s, Dec −16° 42′ 58″ (J2000)
  const siriusRa  = hmsToH(6, 45, 8.9);
  const siriusDec = dmsToD(-16, 42, 58);

  // 2026-11-27 21:00 BST = 15:00 UTC
  const utc = bstToUtc(2026, 11, 27, 21, 0, 0);
  const jd  = dateToJD(utc);

  const lat = 23.81, lon = 90.41;  // Dhaka
  const { alt, az } = raDecToAltAz(siriusRa, siriusDec, jd, lat, lon);

  // Reference (astronomy-engine, unrefracted): alt ≈ 2.64°, az ≈ 109.58°
  approx(alt,   2.64, 0.5, 'Sirius alt (Dhaka 2026-11-27 21:00)');
  approx(az,  109.58, 0.5, 'Sirius az  (Dhaka 2026-11-27 21:00)');
  console.log(`  ✓ Sirius: alt=${alt.toFixed(2)}° az=${az.toFixed(2)}° (ref: alt=2.64° az=109.58°)`);
}

// ─── 4. Orion's belt (Alnilam) on same date ──────────────────────────────────
function testAlnilamDhaka20261127() {
  // Alnilam (ε Ori): RA 5h 36m 12.8s, Dec −1° 12′ 06.9″ (J2000)
  const ra  = hmsToH(5, 36, 12.8);
  const dec = dmsToD(-1, 12, 6.9);

  const utc = bstToUtc(2026, 11, 27, 21, 0, 0);
  const jd  = dateToJD(utc);
  const { alt, az } = raDecToAltAz(ra, dec, jd, 23.81, 90.41);

  // Stellarium reference: alt ≈ 24°, az ≈ 102° (east, slightly above horizon)
  approx(alt, 24.0, 2.0, 'Alnilam alt');
  approx(az,  102.0, 5.0, 'Alnilam az');
  console.log(`  ✓ Alnilam: alt=${alt.toFixed(2)}° az=${az.toFixed(2)}° (ref: alt≈24° az≈102°)`);
}

// ─── 5. Polaris altitude ≈ latitude ──────────────────────────────────────────
function testPolarisAltitude() {
  // Polaris: RA 2h 31m 48.7s, Dec +89° 15′ 50.8″ (J2000)
  const ra  = hmsToH(2, 31, 48.7);
  const dec = dmsToD(89, 15, 50.8);

  const utc = bstToUtc(2026, 11, 27, 21, 0, 0);
  const jd  = dateToJD(utc);

  // Test for several Bangladesh latitudes (Polaris is ~0.74° from NCP)
  const lats = [20.63, 22.82, 23.81, 24.90, 25.74];
  for (const lat of lats) {
    const { alt } = raDecToAltAz(ra, dec, jd, lat, 90.41);
    approx(alt, lat, 0.8, `Polaris alt at lat ${lat}`);
  }
  console.log('  ✓ Polaris altitude ≈ latitude (within 0.8°, polar distance 0.74°)');
}

// ─── 6. Precession is small ───────────────────────────────────────────────────
function testPrecession() {
  const ra0 = 6.75, dec0 = -16.72;  // Sirius approx
  const jd  = dateToJD(new Date('2025-01-01T00:00:00Z'));
  const ep  = precess(ra0, dec0, jd);

  // Over 25 years, RA should shift < 0.05 h, Dec < 0.5°
  approx(ep.ra,  ra0,  0.05, 'Precession RA shift 25y');
  approx(ep.dec, dec0, 0.5,  'Precession Dec shift 25y');
  console.log('  ✓ Precession small over 25 years');
}

// ─── 7. Moon phase ────────────────────────────────────────────────────────────
function testMoonPhase() {
  const jd = dateToJD(new Date('2026-11-27T15:00:00Z'));
  const mp = moonPhase(jd);
  if (mp.fraction < 0 || mp.fraction > 1) throw new Error(`Moon fraction out of range: ${mp.fraction}`);
  if (!mp.phaseName) throw new Error('Missing phaseName');
  if (!mp.phaseBn)   throw new Error('Missing phaseBn');
  console.log(`  ✓ Moon phase: ${mp.phaseName} / ${mp.phaseBn}, fraction=${mp.fraction.toFixed(3)}`);
}

// ─── 8. Bangla date ──────────────────────────────────────────────────────────
function testBanglaDate() {
  // 2026-04-14 is Poila Boishakh (1 Boishakh 1433 Bangabda)
  const bd = toBanglaDate(2026, 4, 14);
  if (bd.monthName !== 'বৈশাখ') throw new Error(`Expected বৈশাখ, got ${bd.monthName}`);
  if (bd.day !== 1) throw new Error(`Expected day 1, got ${bd.day}`);
  console.log(`  ✓ Bangla date 2026-04-14 = ১ বৈশাখ ${bd.year}`);
}

// ─── 9. Bangla numerals ───────────────────────────────────────────────────────
function testBanglaNum() {
  const r = toBanglaNum(1234567890);
  if (r !== '১২৩৪৫৬৭৮৯০') throw new Error(`toBanglaNum failed: ${r}`);
  console.log('  ✓ Bangla numerals');
}

// ─── 10. mod helpers ──────────────────────────────────────────────────────────
function testModHelpers() {
  approx(mod360(-10), 350, 0.001, 'mod360(-10)');
  approx(mod360(370),  10, 0.001, 'mod360(370)');
  approx(mod24(-1),   23,  0.001, 'mod24(-1)');
  approx(mod24(25),    1,  0.001, 'mod24(25)');
  console.log('  ✓ mod360 / mod24');
}

// ─── Runner ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function run(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

console.log('\n=== Akash astro.js unit tests ===');
run('Julian Date',           testJulianDate);
run('GMST',                  testGMST);
run('Sirius Dhaka 2026',     testSiriusDhaka20261127);
run('Alnilam Dhaka 2026',    testAlnilamDhaka20261127);
run('Polaris altitude',      testPolarisAltitude);
run('Precession',            testPrecession);
run('Moon phase',            testMoonPhase);
run('Bangla date',           testBanglaDate);
run('Bangla numerals',       testBanglaNum);
run('mod helpers',           testModHelpers);

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
