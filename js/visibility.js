/**
 * visibility.js — Bortle-scale filtering and effective limiting magnitude
 *
 * Core formula:
 *   effective_limit = NELM - k * (airmass - 1) - moonPenalty
 *
 * Where:
 *   NELM        = Naked Eye Limiting Magnitude for the Bortle class
 *   k           = atmospheric extinction coefficient (default 0.3)
 *   airmass     = 1 / sin(altitude),  for altitude > 3°
 *   moonPenalty = 0 to 1.0 mag, based on illuminated fraction + angular separation
 */

import { airmass as calcAirmass, angularSep } from './astro.js';

// ─── Bortle presets ──────────────────────────────────────────────────────────

export const BORTLE_PRESETS = [
  { bortle: 1, nelm: 7.8, label: 'Excellent dark sky',          labelBn: 'অত্যন্ত অন্ধকার আকাশ' },
  { bortle: 2, nelm: 7.3, label: 'Truly dark sky',              labelBn: 'সত্যিকার অন্ধকার আকাশ' },
  { bortle: 3, nelm: 6.8, label: 'Rural sky',                   labelBn: 'গ্রামীণ আকাশ' },
  { bortle: 4, nelm: 6.3, label: 'Rural / suburban transition', labelBn: 'গ্রাম-শহর মিশ্র আকাশ' },
  { bortle: 5, nelm: 5.8, label: 'Suburban sky',                labelBn: 'শহরতলির আকাশ' },
  { bortle: 6, nelm: 5.3, label: 'Bright suburban sky',         labelBn: 'উজ্জ্বল শহরতলির আকাশ' },
  { bortle: 7, nelm: 4.8, label: 'Suburban / urban transition', labelBn: 'শহুরে আকাশ' },
  { bortle: 8, nelm: 4.3, label: 'City sky',                    labelBn: 'শহরের আকাশ' },
  { bortle: 9, nelm: 3.8, label: 'Inner-city sky',              labelBn: 'শহরের কেন্দ্রের আকাশ' },
];

/** Look up NELM from Bortle class (1–9). */
export function nelm(bortle) {
  const p = BORTLE_PRESETS.find(p => p.bortle === bortle);
  return p ? p.nelm : 5.8;
}

// ─── Moon penalty ────────────────────────────────────────────────────────────

/**
 * Compute lunar sky-glow penalty (magnitudes of extinction added to threshold).
 *
 * @param {number} moonFraction   Illuminated fraction 0–1
 * @param {number} moonAlt        Moon altitude in degrees
 * @param {number} targetAz       Target azimuth in degrees
 * @param {number} targetAlt      Target altitude in degrees
 * @param {number} moonAz         Moon azimuth in degrees
 * @param {boolean} enabled       Whether to apply the penalty
 * @returns {number} magnitude penalty (positive = harder to see)
 */
export function moonPenalty(moonFraction, moonAlt, targetAz, targetAlt, moonAz, enabled) {
  if (!enabled || moonAlt <= 0) return 0;

  // Base penalty from illuminated fraction (0 at new moon, 1.0 at full)
  let base = moonFraction;

  // Angular separation factor: within 30° the penalty increases up to 2×
  const sep = angularSep(moonAz, moonAlt, targetAz, targetAlt);
  const sepFactor = sep < 30 ? 1 + (30 - sep) / 30 : 1;

  return Math.min(1.0, base * sepFactor);
}

// ─── Effective limiting magnitude ─────────────────────────────────────────────

/**
 * Compute effective limiting magnitude for a specific sky position.
 *
 * @param {number} baseNelm     NELM for the Bortle class (from nelm())
 * @param {number} altDeg       Altitude of the target in degrees
 * @param {number} k            Extinction coefficient (default 0.3)
 * @param {number} moonPen      Moon penalty from moonPenalty()
 * @returns {number}            Effective limiting magnitude (may be < 0)
 */
export function effectiveLimit(baseNelm, altDeg, k = 0.3, moonPen = 0) {
  if (altDeg <= 3) return -Infinity;
  const X = calcAirmass(altDeg);
  return baseNelm - k * (X - 1) - moonPen;
}

// ─── Star visibility ─────────────────────────────────────────────────────────

/**
 * Determine if a star with the given magnitude is visible.
 *
 * @param {number} mag          Star magnitude
 * @param {number} altDeg       Altitude in degrees
 * @param {number} baseNelm     NELM for Bortle class
 * @param {number} k            Extinction coefficient
 * @param {number} moonPen      Moon penalty
 * @returns {boolean}
 */
export function isVisible(mag, altDeg, baseNelm, k, moonPen) {
  return mag <= effectiveLimit(baseNelm, altDeg, k, moonPen);
}

// ─── Constellation visibility ─────────────────────────────────────────────────

/**
 * Rate a constellation's visibility based on what fraction of its line-figure
 * stars are visible.
 *
 * @param {Array} lineStars  Array of { alt, mag } for stars in the constellation's figure
 * @param {number} baseNelm
 * @param {number} k
 * @param {number} moonPen   (use representative star location for penalty)
 * @returns {{ status: 'full'|'partial'|'hidden', ratio: number }}
 */
export function constellationStatus(lineStars, baseNelm, k, moonPen = 0) {
  if (!lineStars || lineStars.length === 0) return { status: 'hidden', ratio: 0 };

  let visible = 0;
  for (const s of lineStars) {
    if (isVisible(s.mag, s.alt, baseNelm, k, moonPen)) visible++;
  }
  const ratio = visible / lineStars.length;

  let status;
  if (ratio >= 0.8)      status = 'full';
  else if (ratio >= 0.5) status = 'partial';
  else                   status = 'hidden';

  return { status, ratio };
}

// ─── Milky Way opacity ───────────────────────────────────────────────────────

/**
 * Milky Way visibility opacity 0–1 based on Bortle class.
 * Fades linearly from 1.0 at Bortle 1 to 0 at Bortle 5+.
 */
export function milkyWayOpacity(bortle) {
  if (bortle <= 1) return 1.0;
  if (bortle >= 5) return 0.0;
  return 1 - (bortle - 1) / 4;
}

// ─── Light-pollution horizon glow ─────────────────────────────────────────────

/**
 * Returns a CSS-style rgba string for the horizon glow at a given Bortle class.
 * Returns null for Bortle <= 3 (no glow).
 */
export function horizonGlowColor(bortle) {
  if (bortle <= 3) return null;
  // intensity ramps from 0 at Bortle 3 to 0.45 at Bortle 9
  const alpha = Math.min(0.45, ((bortle - 3) / 6) * 0.45);
  // colour shifts from orange-grey to grey-white as Bortle increases
  const r = Math.round(80 + (bortle - 3) * 10);
  const g = Math.round(60 + (bortle - 3) * 8);
  const b = Math.round(40 + (bortle - 3) * 10);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

// ─── Star display radius ──────────────────────────────────────────────────────

/**
 * Compute display radius for a star.
 * r = scaleFactor × 1.6^(-mag), clamped to [minR, maxR].
 *
 * @param {number} mag
 * @param {number} scaleFactor  base scale (depends on canvas size)
 * @param {number} minR         minimum radius in px
 * @param {number} maxR         maximum radius in px
 */
export function starRadius(mag, scaleFactor = 4, minR = 0.5, maxR = 12) {
  const r = scaleFactor * Math.pow(1.6, -mag);
  return Math.max(minR, Math.min(maxR, r));
}

// ─── B-V to colour ───────────────────────────────────────────────────────────

/**
 * Convert B-V colour index to an approximate RGB CSS colour.
 * B-V: -0.4 (hot blue) to +2.0 (cool red-orange).
 */
export function bvToColor(bv) {
  // Piecewise linear approximation
  if (bv === null || bv === undefined || isNaN(bv)) return '#ffffff';

  const t = Math.max(-0.4, Math.min(2.0, bv));

  // Colour stops keyed by B-V value
  const stops = [
    { bv: -0.40, r: 155, g: 176, b: 255 }, // O-type, blue
    { bv:  0.00, r: 255, g: 255, b: 255 }, // A-type, white
    { bv:  0.30, r: 255, g: 255, b: 220 }, // F-type, pale yellow-white
    { bv:  0.58, r: 255, g: 255, b: 160 }, // G-type, yellow (like Sun)
    { bv:  0.81, r: 255, g: 230, b: 100 }, // K-type, orange-yellow
    { bv:  1.40, r: 255, g: 180, b: 50  }, // K late / M early, orange
    { bv:  2.00, r: 255, g: 100, b: 30  }, // M-type, red-orange
  ];

  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].bv) {
      const lo = stops[i - 1], hi = stops[i];
      const f = (t - lo.bv) / (hi.bv - lo.bv);
      const r = Math.round(lo.r + f * (hi.r - lo.r));
      const g = Math.round(lo.g + f * (hi.g - lo.g));
      const b = Math.round(lo.b + f * (hi.b - lo.b));
      return `rgb(${r},${g},${b})`;
    }
  }
  return '#ff6418';
}
