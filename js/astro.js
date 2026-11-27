/**
 * astro.js — Core astronomical calculations for Akash Star Chart
 *
 * Pipeline:
 *   Local time (Asia/Dhaka, UTC+6) → UTC → Julian Date → GMST → LST → Hour Angle → Alt/Az
 *
 * References:
 *   - Meeus, "Astronomical Algorithms", 2nd ed.
 *   - IAU SOFA library (algorithms)
 *   - astronomy-engine (for Sun, Moon, planets)
 *
 * All angles in degrees unless noted. All exported functions are pure (no side effects).
 */

// ─── Constants ────────────────────────────────────────────────────────────────
export const J2000 = 2451545.0;       // Julian Date of J2000.0
export const DEG  = Math.PI / 180;
export const RAD  = 180 / Math.PI;
export const BST_OFFSET_H = 6;        // Asia/Dhaka = UTC+6 (no DST)

// ─── Date / Time helpers ──────────────────────────────────────────────────────

/**
 * Convert a local BST Date (or year/month/day/hour/min) to a UTC Date.
 * BST = UTC + 6 h. No DST ever in Bangladesh.
 */
export function bstToUtc(year, month, day, hour = 21, minute = 0, second = 0) {
  // month is 1-based here
  const utcMs = Date.UTC(year, month - 1, day, hour - BST_OFFSET_H, minute, second);
  return new Date(utcMs);
}

/**
 * Convert a UTC Date to Julian Date.
 * Meeus ch. 7, valid for dates after −4713 Nov 24.
 */
export function dateToJD(utcDate) {
  const Y = utcDate.getUTCFullYear();
  const M = utcDate.getUTCMonth() + 1;
  const D = utcDate.getUTCDate()
    + utcDate.getUTCHours() / 24
    + utcDate.getUTCMinutes() / 1440
    + utcDate.getUTCSeconds() / 86400;

  let Ym = Y, Mm = M;
  if (M <= 2) { Ym -= 1; Mm += 12; }

  const A = Math.floor(Ym / 100);
  const B = 2 - A + Math.floor(A / 4);   // Gregorian correction

  return Math.floor(365.25 * (Ym + 4716))
       + Math.floor(30.6001 * (Mm + 1))
       + D + B - 1524.5;
}

/**
 * Greenwich Mean Sidereal Time in degrees for a given Julian Date.
 * Meeus ch. 12 (IAU 1982 expression, accurate to 0.1 s over ±50 y from J2000).
 */
export function jdToGMST(jd) {
  const T = (jd - J2000) / 36525;         // Julian centuries from J2000
  // GMST at 0h UT (degrees)
  let gmst = 280.46061837
    + 360.98564736629 * (jd - J2000)
    + 0.000387933 * T * T
    - (T * T * T) / 38710000;
  return mod360(gmst);
}

/**
 * Local Sidereal Time in degrees.
 */
export function gmstToLST(gmstDeg, lonDeg) {
  return mod360(gmstDeg + lonDeg);
}

/**
 * Hour Angle (degrees) from LST and RA.
 * RA must be in degrees (convert hours × 15 before calling).
 */
export function hourAngle(lstDeg, raDeg) {
  return mod360(lstDeg - raDeg);
}

// ─── Coordinate transforms ─────────────────────────────────────────────────

/**
 * Convert equatorial (RA, Dec) to horizontal (Alt, Az) coordinates.
 *
 * @param {number} haDeg   Hour angle in degrees
 * @param {number} decDeg  Declination in degrees
 * @param {number} latDeg  Observer latitude in degrees
 * @returns {{ alt: number, az: number }}  Altitude and azimuth in degrees
 *
 * Az convention: 0 = N, 90 = E, 180 = S, 270 = W (astronomical, N through E)
 */
export function equToHor(haDeg, decDeg, latDeg) {
  const ha  = haDeg  * DEG;
  const dec = decDeg * DEG;
  const lat = latDeg * DEG;

  const sinAlt = Math.sin(dec) * Math.sin(lat)
               + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
  const alt = Math.asin(clamp(sinAlt, -1, 1)) * RAD;

  // Azimuth: measure from North, through East
  const cosAz = (Math.sin(dec) - Math.sin(alt * DEG) * Math.sin(lat))
              / (Math.cos(alt * DEG) * Math.cos(lat));
  let az = Math.acos(clamp(cosAz, -1, 1)) * RAD;
  if (Math.sin(ha) > 0) az = 360 - az;   // West half

  return { alt, az };
}

/**
 * Full pipeline: given a star's (RA hours, Dec degrees), date, and observer,
 * return { alt, az } in degrees.
 */
export function raDecToAltAz(raHours, decDeg, jd, latDeg, lonDeg) {
  const gmst = jdToGMST(jd);
  const lst  = gmstToLST(gmst, lonDeg);
  const raDeg = raHours * 15;
  const ha   = hourAngle(lst, raDeg);
  return equToHor(ha, decDeg, latDeg);
}

// ─── Precession (FK5 / IAU 1976, simplified) ──────────────────────────────

/**
 * Apply approximate precession from J2000.0 to epoch of JD.
 * Accurate to ~1 arcmin over 50 years. Meeus ch. 24.
 *
 * @param {number} ra0   RA in hours at J2000
 * @param {number} dec0  Dec in degrees at J2000
 * @param {number} jd    Target epoch as Julian Date
 * @returns {{ ra: number, dec: number }}  Precessed RA (hours) and Dec (degrees)
 */
export function precess(ra0, dec0, jd) {
  const T = (jd - J2000) / 36525;   // centuries from J2000

  // Precession constants in arcsec
  const zeta  = (2306.2181 + 1.39656 * T) * T / 3600;
  const z     = zeta + (0.79280 * T * T) / 3600;
  const theta = (2004.3109 - 0.85330 * T) * T / 3600;

  const ra0Deg = ra0 * 15;

  // Rotation (Meeus eq. 24.2)
  const A = Math.cos(dec0 * DEG) * Math.sin((ra0Deg + zeta) * DEG);
  const B = Math.cos(theta * DEG) * Math.cos(dec0 * DEG) * Math.cos((ra0Deg + zeta) * DEG)
          - Math.sin(theta * DEG) * Math.sin(dec0 * DEG);
  const C = Math.sin(theta * DEG) * Math.cos(dec0 * DEG) * Math.cos((ra0Deg + zeta) * DEG)
          + Math.cos(theta * DEG) * Math.sin(dec0 * DEG);

  const raDeg  = Math.atan2(A, B) * RAD + z;
  const decDeg = Math.asin(clamp(C, -1, 1)) * RAD;

  return { ra: mod24(raDeg / 15), dec: decDeg };
}

// ─── Airmass ──────────────────────────────────────────────────────────────

/**
 * Plane-parallel airmass. For alt > 3 degrees.
 * Returns Infinity for alt <= 3.
 */
export function airmass(altDeg) {
  if (altDeg <= 3) return Infinity;
  return 1 / Math.sin(altDeg * DEG);
}

// ─── Sun & Twilight (low-precision, Meeus ch. 25) ─────────────────────────

/**
 * Approximate Sun position (RA hours, Dec degrees) for a given JD.
 * Accurate to ~0.01° for dates within a few centuries of J2000.
 */
export function sunPosition(jd) {
  const T = (jd - J2000) / 36525;
  const L0 = mod360(280.46646 + 36000.76983 * T);     // geometric mean longitude
  const M  = mod360(357.52911 + 35999.05029 * T);     // mean anomaly
  const e  = 0.016708634 - 0.000042037 * T;           // eccentricity

  // Equation of centre
  const C = (1.914602 - 0.004817 * T) * Math.sin(M * DEG)
          + 0.019993 * Math.sin(2 * M * DEG)
          + 0.000289 * Math.sin(3 * M * DEG);

  const sunLon = L0 + C;    // Sun's true longitude
  // Apparent longitude (aberration + nutation, simplified)
  const omega = 125.04 - 1934.136 * T;
  const lam   = sunLon - 0.00569 - 0.00478 * Math.sin(omega * DEG);

  // Obliquity of the ecliptic (simplified)
  const eps = 23.439291 - 0.013004 * T;

  const raDeg  = Math.atan2(Math.cos(eps * DEG) * Math.sin(lam * DEG), Math.cos(lam * DEG)) * RAD;
  const decDeg = Math.asin(Math.sin(eps * DEG) * Math.sin(lam * DEG)) * RAD;

  return { ra: mod24(raDeg / 15), dec: decDeg };
}

/**
 * Twilight type for a given Sun altitude:
 *   'day' (> 0°), 'civil' (-6° to 0°), 'nautical' (-12° to -6°),
 *   'astronomical' (-18° to -12°), 'night' (< -18°).
 */
export function twilightType(sunAltDeg) {
  if (sunAltDeg >   0) return 'day';
  if (sunAltDeg >  -6) return 'civil';
  if (sunAltDeg > -12) return 'nautical';
  if (sunAltDeg > -18) return 'astronomical';
  return 'night';
}

// ─── Moon phase ───────────────────────────────────────────────────────────

/**
 * Moon illuminated fraction and phase angle (degrees) for a given JD.
 * Meeus ch. 48 (simplified).
 * Returns { fraction: 0–1, phaseName: string, phaseBn: string }
 */
export function moonPhase(jd) {
  const T = (jd - J2000) / 36525;

  // Mean elongation, mean anomaly, Sun's mean anomaly
  const D  = mod360(297.85036 + 445267.111480 * T);
  const M  = mod360(357.52772 + 35999.050340 * T);
  const Mp = mod360(134.96298 + 477198.867398 * T);

  // Phase angle (illuminated fraction from cos)
  const i = 180 - D - 6.289 * Math.sin(Mp * DEG)
                     + 2.100 * Math.sin(M  * DEG)
                     - 1.274 * Math.sin((2*D - Mp) * DEG)
                     - 0.658 * Math.sin(2 * D * DEG)
                     - 0.214 * Math.sin(2 * Mp * DEG)
                     - 0.110 * Math.sin(D  * DEG);
  const fraction = (1 + Math.cos(i * DEG)) / 2;

  // Approximate age in days (synodic month ≈ 29.53059)
  const age = mod(D, 360) / 360 * 29.53059;
  const phaseName = moonPhaseName(age);
  const phaseBn   = moonPhaseNameBn(age);

  return { fraction, age, phaseName, phaseBn, angle: mod360(i) };
}

function moonPhaseName(age) {
  if (age < 1.85)  return 'New Moon';
  if (age < 7.38)  return 'Waxing Crescent';
  if (age < 9.22)  return 'First Quarter';
  if (age < 14.77) return 'Waxing Gibbous';
  if (age < 16.61) return 'Full Moon';
  if (age < 22.15) return 'Waning Gibbous';
  if (age < 24.00) return 'Last Quarter';
  if (age < 29.53) return 'Waning Crescent';
  return 'New Moon';
}

function moonPhaseNameBn(age) {
  if (age < 1.85)  return 'অমাবস্যা';
  if (age < 7.38)  return 'শুক্লপক্ষ (কৃষ্ণচাঁদ)';
  if (age < 9.22)  return 'প্রথমা তিথি';
  if (age < 14.77) return 'শুক্লপক্ষ';
  if (age < 16.61) return 'পূর্ণিমা';
  if (age < 22.15) return 'কৃষ্ণপক্ষ';
  if (age < 24.00) return 'শেষ প্রহর';
  if (age < 29.53) return 'কৃষ্ণচাঁদ';
  return 'অমাবস্যা';
}

// ─── Rise / Set / Transit ─────────────────────────────────────────────────

/**
 * Compute approximate rise, transit, set times (UTC hours, 0–24)
 * for an object with RA (hours) and Dec (degrees) on the given date at the given location.
 * Returns { rise, transit, set } in UTC hours, or null if circumpolar / never rises.
 */
export function riseTransitSet(raHours, decDeg, jd0, latDeg, lonDeg) {
  // JD at 0h UT on the date
  const jd0UT = Math.floor(jd0 - 0.5) + 0.5;
  const gmst0 = jdToGMST(jd0UT);  // GMST at 0h UT

  const lat = latDeg * DEG;
  const dec = decDeg * DEG;

  const cosH0 = -Math.tan(lat) * Math.tan(dec);
  if (cosH0 < -1) return { rise: null, transit: null, set: null, type: 'circumpolar' };
  if (cosH0 >  1) return { rise: null, transit: null, set: null, type: 'never' };

  const H0 = Math.acos(cosH0) * RAD;  // degrees

  // Approximate transit, rise, set in sidereal hours (then convert to UT hours)
  const transit = mod24((raHours * 15 - lonDeg - gmst0) / 15);
  const rise    = mod24(transit - H0 / 15);
  const set     = mod24(transit + H0 / 15);

  return { rise, transit, set, type: 'normal' };
}

// ─── Bangla Calendar (Bangabda) ─────────────────────────────────────────────

const BANGLA_MONTHS = ['বৈশাখ','জ্যৈষ্ঠ','আষাঢ়','শ্রাবণ','ভাদ্র','আশ্বিন','কার্তিক','অগ্রহায়ণ','পৌষ','মাঘ','ফাল্গুন','চৈত্র'];
const BANGLA_MONTHS_EN = ['Boishakh','Jyoishtho','Asharh','Shraban','Bhadro','Ashwin','Kartik','Ogrohayon','Poush','Magh','Falgun','Choitro'];
const BANGLA_EPOCH_YEAR = 594;   // Bangabda = Gregorian − 593 or 594 depending on month

/**
 * Convert a Gregorian date to Bangabda (approximate, based on astronomical start).
 * Returns { year, month, day, monthName, monthNameEn }
 */
export function toBanglaDate(year, month, day) {
  // Approximate: Boishakh 1 ≈ April 14 (Gregorian)
  const bengaliNewYear = new Date(year, 3, 14); // April 14
  const current        = new Date(year, month - 1, day);
  const msPerDay       = 86400000;

  const dayOfYear = Math.floor((current - bengaliNewYear) / msPerDay);

  // Month lengths in Bangla calendar (approximate solar)
  const mLengths = [31,31,31,31,31,30,30,30,30,30,30,30]; // Boishakh..Choitro

  let m = 0, rem = dayOfYear;
  if (rem < 0) {
    // Before Boishakh — in Choitro of previous year
    m = 11;
    rem += 365;
  }
  for (let i = 0; i < 12; i++) {
    if (rem < mLengths[i]) { m = i; break; }
    rem -= mLengths[i];
  }

  const bYear = dayOfYear >= 0 ? year - BANGLA_EPOCH_YEAR : year - BANGLA_EPOCH_YEAR - 1;

  return {
    year:        bYear,
    month:       m + 1,
    day:         rem + 1,
    monthName:   BANGLA_MONTHS[m],
    monthNameEn: BANGLA_MONTHS_EN[m],
  };
}

// ─── Bangla numerals ──────────────────────────────────────────────────────

const BN_DIGITS = ['০','১','২','৩','৪','৫','৬','৭','৮','৯'];

export function toBanglaNum(n) {
  return String(n).replace(/\d/g, d => BN_DIGITS[+d]);
}

// ─── Angular separation ───────────────────────────────────────────────────

/**
 * Angular separation (degrees) between two alt/az points.
 */
export function angularSep(az1, alt1, az2, alt2) {
  const a1 = alt1 * DEG, a2 = alt2 * DEG;
  const daz = (az2 - az1) * DEG;
  const cos = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(daz);
  return Math.acos(clamp(cos, -1, 1)) * RAD;
}

// ─── Utility helpers ──────────────────────────────────────────────────────

export function mod360(x) { return ((x % 360) + 360) % 360; }
export function mod24(x)  { return ((x % 24)  + 24)  % 24;  }
export function mod(x, m) { return ((x % m)   + m)   % m;   }
export function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

/** Convert HMS string "HH MM SS.s" to decimal hours */
export function hmsToH(h, m, s) { return h + m / 60 + s / 3600; }

/** Convert DMS string to decimal degrees */
export function dmsToD(d, m, s) {
  const sign = d < 0 ? -1 : 1;
  return sign * (Math.abs(d) + m / 60 + s / 3600);
}
