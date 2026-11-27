/**
 * projection.js — Map celestial Alt/Az coordinates to canvas pixels
 *
 * Supported projections:
 *   - Azimuthal Equidistant (default all-sky): r ∝ zenith distance
 *   - Stereographic all-sky: r ∝ tan(zd/2)
 *   - Gnomonic (directional rectangular view): tan-based, limited FOV
 *
 * Canvas conventions:
 *   - All-sky: zenith at centre, N at top, E at LEFT (mirror), horizon at edge
 *   - Directional: horizon at centre-bottom, FOV configurable
 *
 * All coordinate params in degrees.
 */

export const PROJECTIONS = {
  EQUIDISTANT:   'equidistant',
  STEREOGRAPHIC: 'stereographic',
  GNOMONIC:      'gnomonic',
};

// ─── All-sky projections ──────────────────────────────────────────────────────

/**
 * Project (alt, az) → canvas (x, y) for all-sky charts.
 *
 * @param {number} altDeg  Altitude (degrees, −90 to +90)
 * @param {number} azDeg   Azimuth (degrees, 0=N, 90=E, 180=S, 270=W)
 * @param {number} cx      Canvas centre x (px)
 * @param {number} cy      Canvas centre y (px)
 * @param {number} R       Horizon radius (px)
 * @param {string} proj    'equidistant' | 'stereographic'
 * @returns {{ x: number, y: number, visible: boolean }}
 */
export function projectAllSky(altDeg, azDeg, cx, cy, R, proj = PROJECTIONS.EQUIDISTANT) {
  const zd = 90 - altDeg;   // zenith distance (0 at zenith, 90 at horizon)

  if (zd > 90) {
    // Below horizon — still compute position (caller decides to hide)
    // Map using equidistant beyond the horizon edge
  }

  let r;
  if (proj === PROJECTIONS.STEREOGRAPHIC) {
    // Stereographic: r = R * tan(zd/2) / tan(45°)  → R at zd=90
    const zdRad = (zd / 2) * (Math.PI / 180);
    r = R * Math.tan(zdRad) / Math.tan(Math.PI / 4);
  } else {
    // Azimuthal equidistant: r linear in zenith distance
    r = R * zd / 90;
  }

  // Az 0=N at top; East on the LEFT (mirror image of compass: standard sky chart)
  // Az → angle from +Y axis, clockwise, but we flip X for the mirror
  const azRad = azDeg * (Math.PI / 180);
  const x = cx - r * Math.sin(azRad);   // East is left → subtract
  const y = cy - r * Math.cos(azRad);   // North is up

  return { x, y, visible: altDeg > -1 }; // slightly below horizon allowed for lines
}

/**
 * Inverse: canvas (x, y) → (alt, az) for all-sky charts.
 */
export function unprojectAllSky(px, py, cx, cy, R, proj = PROJECTIONS.EQUIDISTANT) {
  const dx = -(px - cx);   // East is left → negate X
  const dy = -(py - cy);   // North is up → negate Y

  const r = Math.hypot(dx, dy);
  if (r === 0) return { altDeg: 90, azDeg: 0 };

  let zd;
  if (proj === PROJECTIONS.STEREOGRAPHIC) {
    // Inverse stereographic: zd = 2 * atan(r / R * tan(45°))
    zd = 2 * Math.atan2(r * Math.tan(Math.PI / 4), R) * (180 / Math.PI);
  } else {
    zd = r / R * 90;
  }

  const azRad = Math.atan2(dx, dy);   // atan2(East, North)
  let azDeg = azRad * (180 / Math.PI);
  if (azDeg < 0) azDeg += 360;

  return { altDeg: 90 - zd, azDeg };
}

// ─── Directional / rectangular projection (Gnomonic) ─────────────────────────

/**
 * Project (alt, az) → canvas (x, y) for a directional view.
 *
 * @param {number} altDeg     Object altitude
 * @param {number} azDeg      Object azimuth
 * @param {number} centreAzDeg  Azimuth pointing to screen centre
 * @param {number} centreAltDeg Altitude pointing to screen centre (default 0 for horizon)
 * @param {number} fovDeg     Horizontal FOV in degrees
 * @param {number} width      Canvas width in px
 * @param {number} height     Canvas height in px
 * @returns {{ x, y, visible }}
 */
export function projectDirectional(altDeg, azDeg, centreAzDeg, centreAltDeg, fovDeg, width, height) {
  // Convert to Cartesian unit vector on the celestial sphere
  const toXYZ = (az, alt) => {
    const azR  = az  * Math.PI / 180;
    const altR = alt * Math.PI / 180;
    return [
      Math.cos(altR) * Math.sin(azR),   // X: East
      Math.sin(altR),                    // Y: Up
      Math.cos(altR) * Math.cos(azR),   // Z: North
    ];
  };

  const [ox, oy, oz] = toXYZ(centreAzDeg, centreAltDeg);
  const [sx, sy, sz] = toXYZ(azDeg, altDeg);

  // Dot product with the central direction (cos of angular distance from centre)
  const dot = ox * sx + oy * sy + oz * sz;
  if (dot <= 0) return { x: -9999, y: -9999, visible: false }; // Behind

  // Gnomonic projection tangent plane
  const scale = width / (2 * Math.tan((fovDeg / 2) * Math.PI / 180));

  // Project onto tangent plane aligned to az/alt axes
  // Right vector (East in the viewing direction)
  const rx = Math.cos(centreAzDeg * Math.PI / 180);
  const ry = 0;
  const rz = -Math.sin(centreAzDeg * Math.PI / 180);

  // Up vector
  const ux = -Math.sin(centreAltDeg * Math.PI / 180) * Math.sin(centreAzDeg * Math.PI / 180);
  const uy =  Math.cos(centreAltDeg * Math.PI / 180);
  const uz = -Math.sin(centreAltDeg * Math.PI / 180) * Math.cos(centreAzDeg * Math.PI / 180);

  const xComp = (sx * rx + sy * ry + sz * rz) / dot;
  const yComp = (sx * ux + sy * uy + sz * uz) / dot;

  const x = width  / 2 - xComp * scale;  // East left
  const y = height / 2 - yComp * scale;  // Up

  const margin = Math.max(width, height);
  const visible = x > -margin && x < width + margin && y > -margin && y < height + margin;

  return { x, y, visible };
}

// ─── Constellation chart: fit a single constellation ─────────────────────────

/**
 * Compute a scale and offset so a list of (alt, az) points fills the canvas
 * with padding, using equidistant all-sky math.
 *
 * Returns { scale, cx, cy } where the final map is:
 *   x = cx + scale * (R * zd / 90) * -sin(az)
 *   y = cy + scale * (R * zd / 90) * -cos(az)
 * but we just reuse projectAllSky with a padded radius.
 */
export function fitConstellationView(altAzPoints, canvasW, canvasH, padding = 60) {
  if (!altAzPoints.length) return { cx: canvasW / 2, cy: canvasH / 2, R: Math.min(canvasW, canvasH) / 2 - padding };

  // Find bounding box in equidistant xy space
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const tempR = 1000, tempCx = 0, tempCy = 0;
  for (const { alt, az } of altAzPoints) {
    const { x, y } = projectAllSky(alt, az, tempCx, tempCy, tempR);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const drawW = canvasW - 2 * padding;
  const drawH = canvasH - 2 * padding;

  const scale = Math.min(drawW / spanX, drawH / spanY);
  const midX  = (minX + maxX) / 2;
  const midY  = (minY + maxY) / 2;

  // Real R and centre such that the scaled result centres in the canvas
  const R  = tempR * scale;
  const cx = canvasW / 2 - midX * scale;
  const cy = canvasH / 2 - midY * scale;

  return { cx, cy, R };
}

// ─── Grid helpers ─────────────────────────────────────────────────────────────

/**
 * Generate alt/az grid lines as arrays of (altDeg, azDeg) polyline points.
 * Returns { altLines: Array<Array<{alt,az}>>, azLines: Array<Array<{alt,az}>> }
 */
export function gridLines(altStep = 15, azStep = 30) {
  const altLines = [];
  for (let alt = 0; alt <= 90; alt += altStep) {
    const pts = [];
    for (let az = 0; az <= 360; az += 2) pts.push({ alt, az });
    altLines.push(pts);
  }

  const azLines = [];
  for (let az = 0; az < 360; az += azStep) {
    const pts = [];
    for (let alt = 0; alt <= 90; alt += 2) pts.push({ alt, az });
    azLines.push(pts);
  }

  return { altLines, azLines };
}

/**
 * Ecliptic path as a series of (RA, Dec) points (J2000).
 * Returns 360 points, one per degree of ecliptic longitude.
 */
export function eclipticPath() {
  const eps = 23.4393 * Math.PI / 180;   // obliquity
  const pts = [];
  for (let lam = 0; lam <= 360; lam += 2) {
    const lamR = lam * Math.PI / 180;
    const raDeg  = Math.atan2(Math.sin(lamR) * Math.cos(eps), Math.cos(lamR)) * 180 / Math.PI;
    const decDeg = Math.asin(Math.sin(eps) * Math.sin(lamR)) * 180 / Math.PI;
    pts.push({ ra: ((raDeg % 360) + 360) % 360 / 15, dec: decDeg });
  }
  return pts;
}

/**
 * Celestial equator as (RA, Dec=0) points.
 */
export function equatorPath() {
  const pts = [];
  for (let ra = 0; ra <= 24; ra += 0.1) pts.push({ ra, dec: 0 });
  return pts;
}
