/**
 * render.js — Canvas rendering engine for Akash Star Chart
 *
 * Single entry point: renderChart(ctx, state, size, data)
 * Reused for on-screen display AND off-screen export.
 *
 * state = {
 *   date, hour, minute, lat, lon, bortle, nelm, lang, proj, mode,
 *   dir, fov, conId, layers, bnNums, compareMode, ...
 * }
 * data  = { stars, constellations, milkyway, messier, planets, sun, moon, boundaries }
 * size  = { w, h }   canvas dimensions in px
 */

import { raDecToAltAz, bstToUtc, dateToJD, jdToGMST, gmstToLST,
         sunPosition, moonPhase, twilightType, toBanglaNum, precess } from './astro.js';
import { projectAllSky, projectDirectional, fitConstellationView,
         gridLines, eclipticPath, equatorPath } from './projection.js';
import { effectiveLimit, starRadius, bvToColor,
         isVisible, milkyWayOpacity, horizonGlowColor,
         moonPenalty as calcMoonPenalty, nelm as bortleNelm } from './visibility.js';
import { getLabel } from './names.js';
import { getPalette, pick } from './theme.js';

// ─── Sky background gradients ─────────────────────────────────────────────────

function skyBg(ctx, cx, cy, R, twilight, bortle, size) {
  // Sky colour by twilight (deep black shades for night)
  const pal = getPalette();
  const sky = {
    night:         [pal.bg, pal.skyOuter],
    astronomical:  [pal.bg, pal.skyOuter],
    nautical:      ['#0d101c', '#1a2034'],
    civil:         ['#1b2442', '#354268'],
    day:           ['#2e5c94', '#6ba3d6'],
  };
  const [inner, outer] = pal.mono ? [pal.bg, pal.bg] : (sky[twilight] || sky.night);

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.05);
  grad.addColorStop(0,   inner);
  grad.addColorStop(0.9, outer);
  grad.addColorStop(1,   pal.bg);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  // Light-pollution horizon glow
  const glowColor = pal.mono ? null : horizonGlowColor(bortle);
  if (glowColor) {
    const hGrad = ctx.createRadialGradient(cx, cy + R * 0.6, 0, cx, cy, R);
    hGrad.addColorStop(0, 'rgba(0,0,0,0)');
    hGrad.addColorStop(0.6, 'rgba(0,0,0,0)');
    hGrad.addColorStop(1, glowColor);
    ctx.fillStyle = hGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function px(size, base) { return base * (size.w / 800); }   // scale relative to 800px reference

function project(alt, az, cx, cy, R, proj, mode, state, size) {
  if (mode === 'allsky') return projectAllSky(alt, az, cx, cy, R, proj);
  if (mode === 'directional') {
    const centreAz = { N: 0, E: 90, S: 180, W: 270 }[state.dir] ?? 0;
    return projectDirectional(alt, az, centreAz, 0, state.fov, size.w, size.h);
  }
  return projectAllSky(alt, az, cx, cy, R, proj);
}

function datePartsFromState(state) {
  const [y, m, d] = state.date.split('-').map(Number);
  return { year: y, month: m, day: d };
}

// ─── Main render function ─────────────────────────────────────────────────────

/**
 * Render the complete star chart onto ctx.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state
 * @param {{ w: number, h: number }} size
 * @param {object} data   { stars, faintStars, constellations, milkyway, messier, locations, boundaries }
 * @param {object} [opts] { showBelowHorizon, footerText, exportMode, compareBortle }
 */
export async function renderChart(ctx, state, size, data, opts = {}) {
  ctx.clearRect(0, 0, size.w, size.h);
  const pal = getPalette();
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, size.w, size.h);

  const { w, h } = size;
  const mode     = state.mode || 'allsky';
  const isAllSky = mode === 'allsky' || mode === 'constellation';
  const layers   = new Set(state.layers || []);
  const zoom     = opts.zoom || 1;
  const panX     = opts.panX || 0;
  const panY     = opts.panY || 0;

  // ── Layout (44px margin so N/E/S/W compass labels are always clearly visible)
  const cx = w / 2;
  const cy = h / 2;
  const R  = Math.min(w, h) / 2 - px(size, 44);

  // Apply zoom & pan transform to the chart
  ctx.save();
  ctx.translate(cx + panX, cy + panY);
  ctx.scale(zoom, zoom);
  ctx.translate(-cx, -cy);

  // ── Time / JD
  const { year, month, day } = datePartsFromState(state);
  const utcDate = bstToUtc(year, month, day, state.hour, state.minute, 0);
  const jd      = dateToJD(utcDate);
  const lat     = state.lat;
  const lon     = state.lon;

  // ── NELM
  const baseNelm = state.bortle === 'custom' && state.nelm != null
    ? state.nelm
    : bortleNelm(state.bortle);
  const k = state.k ?? 0.3;

  // ── Sun position & twilight
  const sunPos    = sunPosition(jd);
  const sunAltAz  = raDecToAltAz(sunPos.ra, sunPos.dec, jd, lat, lon);
  const twilight  = twilightType(sunAltAz.alt);

  // ── Moon
  const moonPhaseData = moonPhase(jd);
  // Simple Moon position (use Sun opposition approximate)
  const moonRa  = (sunPos.ra + 12) % 24;    // very approximate: near opposition at full moon
  const moonDec = -sunPos.dec * 0.9;         // approximate
  const moonAltAz = raDecToAltAz(moonRa, moonDec, jd, lat, lon);
  const moonPen   = state.moonPenaltyEnabled
    ? calcMoonPenalty(moonPhaseData.fraction, moonAltAz.alt, 0, 45, moonAltAz.az, true)
    : 0;

  // ── Draw sky background
  if (isAllSky) {
    skyBg(ctx, cx, cy, R, twilight, state.bortle, size);
  } else {
    // Directional: rectangular
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, pal.bg);
    grad.addColorStop(1, pal.skyOuter);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // ── Clip to circle for all-sky
  if (isAllSky) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
  }

  // ── Milky Way
  if (layers.has('milkyway') && data.milkyway) {
    const opacity = milkyWayOpacity(state.bortle);
    if (opacity > 0.01) {
      ctx.globalAlpha = opacity * 0.35;
      drawMilkyWay(ctx, data.milkyway, cx, cy, R, state.proj, mode, state, size, jd, lat, lon);
      ctx.globalAlpha = 1;
    }
  }

  // ── Grid
  if (layers.has('grid')) {
    drawGrid(ctx, cx, cy, R, state.proj, mode, state, size, px(size, 1));
  }

  // ── Ecliptic
  if (layers.has('ecliptic')) {
    drawEcliptic(ctx, cx, cy, R, state.proj, mode, state, size, jd, lat, lon, px(size, 1));
  }

  // ── Equator
  if (layers.has('equator')) {
    drawEquator(ctx, cx, cy, R, state.proj, mode, state, size, jd, lat, lon, px(size, 1));
  }

  // ── Constellation boundaries
  if (layers.has('boundaries') && data.boundaries) {
    drawBoundaries(ctx, data.boundaries, cx, cy, R, state.proj, mode, state, size, jd, lat, lon);
  }

  // ── Constellation lines
  if (layers.has('constellLines') && data.constellations) {
    drawConstellLines(ctx, data, cx, cy, R, state.proj, mode, state, size,
                      jd, lat, lon, baseNelm, k, moonPen, px(size, 1));
  }

  // ── Stars
  if (layers.has('stars')) {
    const allStars = [...(data.stars || []), ...(data.faintStars || [])];
    drawStars(ctx, allStars, cx, cy, R, state.proj, mode, state, size,
              jd, lat, lon, baseNelm, k, moonPen, layers, opts);
  }

  // ── Deep-sky objects (Messier)
  if (layers.has('dso') && data.messier) {
    drawDSO(ctx, data.messier, cx, cy, R, state.proj, mode, state, size,
            jd, lat, lon, baseNelm, k, moonPen, px(size, 2));
  }

  // ── Planets
  if (layers.has('planets')) {
    drawPlanets(ctx, data.planets, cx, cy, R, state.proj, mode, state, size,
                jd, lat, lon, baseNelm, k, moonPen, layers, px(size, 1));
  }

  // ── Moon
  if (layers.has('moon')) {
    drawMoon(ctx, moonAltAz, moonPhaseData, cx, cy, R, state.proj, mode, state, size,
             jd, lat, lon, layers, px(size, 1), opts);
  }

  // ── Sun
  if (layers.has('sun')) {
    drawSun(ctx, sunAltAz, twilight, cx, cy, R, state.proj, mode, state, size, layers, px(size, 1));
  }

  // ── Constellation names
  if (layers.has('constellNames') && data.constellations) {
    drawConstellationNames(ctx, data.constellations, cx, cy, R, state.proj, mode, state, size,
                           jd, lat, lon, baseNelm, k, moonPen, px(size, 1));
  }

  if (isAllSky) {
    ctx.restore(); // end clip
  }

  // ── Horizon ring & compass labels (outside clip)
  if (isAllSky) {
    drawHorizon(ctx, cx, cy, R, state, size, layers, px(size, 1));
  } else if (layers.has('compass')) {
    // Directional mode compass badge at top-center
    const dirObj = COMPASS.find(c => c.en === state.dir) || COMPASS[0];
    const dirTxt = state.lang === 'en' ? dirObj.en
                 : state.lang === 'bn' ? dirObj.bn
                 : `${dirObj.bn} · ${dirObj.en}`;
    const fs = px(size, 15);
    ctx.font = `bold ${fs}px "Noto Sans Bengali", "Inter", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = getPalette().mono ? getPalette().bg : 'rgba(0,0,0,0.75)';
    const tw = ctx.measureText(dirTxt).width + px(size, 20);
    ctx.fillRect(cx - tw / 2, px(size, 10), tw, fs + px(size, 10));
    ctx.fillStyle = pick('#6ee7b7');
    ctx.fillText(dirTxt, cx, px(size, 10) + (fs + px(size, 10)) / 2);
  }

  ctx.restore(); // end zoom & pan transform

  // ── Export footer (always fixed at bottom, unzoomed)
  if (opts.footerText) {
    drawFooter(ctx, opts.footerText, size, px(size, 1));
  }
}

// ─── Star drawing ─────────────────────────────────────────────────────────────

function drawStars(ctx, stars, cx, cy, R, proj, mode, state, size,
                   jd, lat, lon, baseNelm, k, moonPen, layers, opts) {
  if (!stars) return;
  const useColors   = layers.has('starColors');
  const showLabels  = layers.has('starNames');
  const showBelow   = opts.showBelowHorizon;
  const scaleFactor = px(size, 4);
  const labeled     = [];

  for (const star of stars) {
    // star format: [id, ra, dec, mag, bv, name, bayer, con]
    const [id, ra, dec, mag, bv, name] = star;

    // Precess to current epoch (small effect but correct)
    const ep = precess(ra, dec, jd);
    const { alt, az } = raDecToAltAz(ep.ra, ep.dec, jd, lat, lon);

    if (alt < -1 && !showBelow) continue;

    const effLim = effectiveLimit(baseNelm, alt, k, moonPen);
    if (mag > effLim) continue;

    const { x, y, visible } = project(alt, az, cx, cy, R, proj, mode, state, size);
    if (!visible && !showBelow) continue;

    const r = starRadius(mag, scaleFactor, 0.5, px(size, 10));

    // Draw star glow for bright stars
    if (mag < 2.5) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
      const pal = getPalette();
      const col  = (useColors && !pal.mono) ? bvToColor(bv) : pal.star;
      glow.addColorStop(0, pal.print ? 'rgba(0,0,0,0.12)' : (col.startsWith('rgb(') ? col.replace('rgb', 'rgba').replace(')', ',0.6)') : col + '99'));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = (useColors && !getPalette().mono) ? bvToColor(bv) : getPalette().star;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    if (showLabels && name && r > px(size, 1.2)) {
      labeled.push({ x, y, r, name, mag, bv });
    }
  }

  // Draw labels (simple, in brightness order)
  if (showLabels) {
    labeled.sort((a, b) => a.mag - b.mag);
    const placed = [];
    for (const s of labeled) {
      const labels = getLabel(state.lang, s.name, 'stars');
      const fontSize = Math.max(px(size, 9), s.r * 1.8);
      ctx.font = `${fontSize}px "Noto Sans Bengali", "Inter", sans-serif`;
      ctx.fillStyle = getPalette().text;
      ctx.textAlign  = 'left';
      ctx.textBaseline = 'middle';

      const lx = s.x + s.r + px(size, 3);
      const ly = s.y;

      // Simple collision avoidance
      const tw = ctx.measureText(labels[0]).width;
      const overlaps = placed.some(p => Math.abs(p.x - lx) < tw + 4 && Math.abs(p.y - ly) < fontSize + 2);
      if (overlaps) continue;

      ctx.fillText(labels[0], lx, ly);
      if (labels[1]) {
        ctx.font = `${fontSize * 0.8}px "Noto Sans Bengali", "Inter", sans-serif`;
        ctx.fillStyle = getPalette().textMuted;
        ctx.fillText(labels[1], lx, ly + fontSize);
      }
      placed.push({ x: lx, y: ly });
    }
  }
}

// ─── Constellation lines ──────────────────────────────────────────────────────

function drawConstellLines(ctx, data, cx, cy, R, proj, mode, state, size,
                            jd, lat, lon, baseNelm, k, moonPen, lw) {
  if (!data.constellations) return;
  const starMap = buildStarMap(data.stars);

  for (const con of data.constellations) {
    if (!con.lines) continue;
    if (state.mode === 'constellation' && con.id !== state.conId) continue;

    // Check visibility of this constellation's figure stars
    const figureStars = con.lines.flat()
      .map(id => starMap.get(id))
      .filter(Boolean)
      .map(s => {
        const ep = precess(s[1], s[2], jd);
        const { alt } = raDecToAltAz(ep.ra, ep.dec, jd, lat, lon);
        return { alt, mag: s[3] };
      });

    let opacity = 1;
    let status  = 'full';
    let visCount = figureStars.filter(s => isVisible(s.mag, s.alt, baseNelm, k, moonPen)).length;
    const ratio = figureStars.length ? visCount / figureStars.length : 0;
    if (ratio < 0.8)      { status = 'partial'; opacity = 0.4; }
    if (ratio < 0.5)      { status = 'hidden';  opacity = 0.0; }
    if (status === 'hidden' && !state.showHiddenConst) continue;

    ctx.globalAlpha = opacity;
    ctx.strokeStyle = getPalette().line;
    ctx.lineWidth   = lw * (mode === 'constellation' ? 2 : 1);

    for (const seg of con.lines) {
      const [aId, bId] = seg;
      const sA = starMap.get(aId);
      const sB = starMap.get(bId);
      if (!sA || !sB) continue;

      const epA = precess(sA[1], sA[2], jd);
      const epB = precess(sB[1], sB[2], jd);
      const aaA = raDecToAltAz(epA.ra, epA.dec, jd, lat, lon);
      const aaB = raDecToAltAz(epB.ra, epB.dec, jd, lat, lon);

      if (aaA.alt < -5 || aaB.alt < -5) continue;

      const pA = project(aaA.alt, aaA.az, cx, cy, R, proj, mode, state, size);
      const pB = project(aaB.alt, aaB.az, cx, cy, R, proj, mode, state, size);

      if (!pA.visible || !pB.visible) continue;

      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }
}

function buildStarMap(stars) {
  const m = new Map();
  if (!stars) return m;
  for (const s of stars) m.set(s[0], s);
  return m;
}

// ─── Constellation names ──────────────────────────────────────────────────────

function drawConstellationNames(ctx, constellations, cx, cy, R, proj, mode, state, size,
                                 jd, lat, lon, baseNelm, k, moonPen, lw) {
  for (const con of constellations) {
    if (!con.ra || !con.dec) continue;
    const ep = precess(con.ra, con.dec, jd);
    const { alt, az } = raDecToAltAz(ep.ra, ep.dec, jd, lat, lon);
    if (alt < 5) continue;

    const { x, y, visible } = project(alt, az, cx, cy, R, proj, mode, state, size);
    if (!visible) continue;

    const labels = getLabel(state.lang, con.name, 'constellations');
    const fs = px(size, 11);
    ctx.font = `${fs}px "Noto Sans Bengali", "Inter", sans-serif`;
    ctx.fillStyle = pick('rgba(100,150,255,0.85)', 0.85);
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labels[0], x, y);
    if (labels[1]) {
      ctx.font = `${fs * 0.78}px "Noto Sans Bengali", "Inter", sans-serif`;
      ctx.fillStyle = pick('rgba(80,120,200,0.7)', 0.7);
      ctx.fillText(labels[1], x, y + fs + 2);
    }
  }
}

// ─── Milky Way ────────────────────────────────────────────────────────────────

function drawMilkyWay(ctx, milkyway, cx, cy, R, proj, mode, state, size, jd, lat, lon) {
  if (!milkyway || !milkyway.features) return;

  for (const feature of milkyway.features) {
    if (!feature.geometry) continue;
    const coords = feature.geometry.coordinates;
    if (!coords || !coords.length) continue;

    // coords is array of rings (polygon or multipolygon)
    const rings = Array.isArray(coords[0][0]) ? coords : [coords];
    for (const ring of rings) {
      const pts = ring[0] || ring;
      if (pts.length < 3) continue;

      ctx.beginPath();
      let first = true;
      for (const [raHrs, decDeg] of pts) {
        const ep = precess(raHrs, decDeg, jd);
        const { alt, az } = raDecToAltAz(ep.ra, ep.dec, jd, lat, lon);
        if (alt < -5) { first = true; continue; }
        const { x, y } = project(alt, az, cx, cy, R, proj, mode, state, size);
        if (first) { ctx.moveTo(x, y); first = false; }
        else       { ctx.lineTo(x, y); }
      }

      ctx.fillStyle = pick('rgba(180,200,255,0.12)', 0.12);
      ctx.fill();
      ctx.strokeStyle = pick('rgba(180,200,255,0.06)', 0.06);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

// ─── Planets ──────────────────────────────────────────────────────────────────

function drawPlanets(ctx, planets, cx, cy, R, proj, mode, state, size,
                     jd, lat, lon, baseNelm, k, moonPen, layers, lw) {
  if (!planets || !planets.length) return;
  const showLabels = layers.has('starNames');

  for (const planet of planets) {
    // planet = { name, ra, dec, mag, bv }  (computed by astronomy-engine caller)
    const ep = precess(planet.ra, planet.dec, jd);
    const { alt, az } = raDecToAltAz(ep.ra, ep.dec, jd, lat, lon);
    if (alt < 3) continue;

    const effLim = effectiveLimit(baseNelm, alt, k, moonPen);
    if (planet.mag > effLim) continue;

    const { x, y, visible } = project(alt, az, cx, cy, R, proj, mode, state, size);
    if (!visible) continue;

    const r = starRadius(planet.mag, px(size, 4), px(size, 2), px(size, 12));

    // Planet disc colour
    const colours = {
      Mercury: '#b0b0b0', Venus:   '#ffeecc', Mars:    '#ff5533',
      Jupiter: '#ffcc88', Saturn:  '#ffe0aa', Uranus:  '#99ddff',
      Neptune: '#4488ff',
    };
    ctx.fillStyle = getPalette().mono ? getPalette().star : (colours[planet.name] || '#ffffff');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Ring for Saturn
    if (planet.name === 'Saturn') {
      ctx.strokeStyle = pick('rgba(255,220,160,0.6)', 0.6);
      ctx.lineWidth   = lw * 1.5;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 2.5, r * 0.6, Math.PI / 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (showLabels) {
      const labels = getLabel(state.lang, planet.name, 'planets');
      const fs = px(size, 10);
      ctx.font      = `${fs}px "Noto Sans Bengali", "Inter", sans-serif`;
      ctx.fillStyle = pick(colours[planet.name] || '#ccddff', 0.9);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[0], x + r + px(size, 3), y);
    }
  }
}

// ─── Moon ─────────────────────────────────────────────────────────────────────

function drawMoon(ctx, moonAltAz, phaseData, cx, cy, R, proj, mode, state, size,
                  jd, lat, lon, layers, lw, opts) {
  const { alt, az } = moonAltAz;
  if (alt < 1) return;

  const { x, y, visible } = project(alt, az, cx, cy, R, proj, mode, state, size);
  if (!visible) return;

  const r = px(size, 10);

  // Terminator via clip
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();

  // Draw moon disc
  ctx.fillStyle = pick('#cccccc');
  ctx.fillRect(x - r, y - r, r * 2, r * 2);

  // Dark side
  ctx.fillStyle = getPalette().mono ? getPalette().bg : '#222244';
  const a = phaseData.age;
  const waxing = a < 14.77;
  const fraction = phaseData.fraction;
  if (fraction < 0.98) {
    ctx.beginPath();
    // Approximate terminator with an ellipse
    const limb = r;
    const term = r * Math.abs(1 - 2 * fraction);
    ctx.ellipse(x, y, term, limb, 0, -Math.PI / 2, Math.PI / 2, !waxing);
    ctx.arc(x, y, r, Math.PI / 2, -Math.PI / 2, waxing);
    ctx.fill();
  }

  ctx.restore();

  // Moon outline
  ctx.strokeStyle = pick('rgba(200,200,200,0.5)', 0.8);
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();

  if (layers.has('starNames')) {
    const labels = getLabel(state.lang, 'Moon', 'misc');
    const fs = px(size, 9);
    ctx.font = `${fs}px "Noto Sans Bengali", "Inter", sans-serif`;
    ctx.fillStyle = pick('rgba(200,200,255,0.9)', 0.9);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(labels[0], x + r + px(size, 3), y);
  }
}

// ─── Sun ─────────────────────────────────────────────────────────────────────

function drawSun(ctx, sunAltAz, twilight, cx, cy, R, proj, mode, state, size, layers, lw) {
  const { alt, az } = sunAltAz;
  if (alt < -18) return;   // deep night — don't draw

  if (alt > 0) {
    const { x, y, visible } = project(alt, az, cx, cy, R, proj, mode, state, size);
    if (!visible) return;

    const r = px(size, 12);
    // Glow
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    glow.addColorStop(0, pick('rgba(255,255,180,0.9)', 0.45));
    glow.addColorStop(1, pick('rgba(255,200,0,0)', 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = pick('#ffffcc');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    if (layers.has('starNames')) {
      const labels = getLabel(state.lang, 'Sun', 'misc');
      const fs = px(size, 10);
      ctx.font = `${fs}px "Noto Sans Bengali", "Inter", sans-serif`;
      ctx.fillStyle = pick('#ffdd44');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[0], x + r + px(size, 3), y);
    }
  }
  // If below horizon, twilight colour is handled in skyBg
}

// ─── Deep Sky Objects (Messier) ───────────────────────────────────────────────

function drawDSO(ctx, messier, cx, cy, R, proj, mode, state, size,
                 jd, lat, lon, baseNelm, k, moonPen, lw) {
  for (const obj of messier) {
    // obj = [id, ra, dec, mag, type, name]
    const [id, ra, dec, mag, type, name] = obj;
    const ep = precess(ra, dec, jd);
    const { alt, az } = raDecToAltAz(ep.ra, ep.dec, jd, lat, lon);
    if (alt < 5) continue;
    if (mag > effectiveLimit(baseNelm, alt, k, moonPen)) continue;

    const { x, y, visible } = project(alt, az, cx, cy, R, proj, mode, state, size);
    if (!visible) continue;

    const r = Math.max(lw * 2, px(size, 4));
    ctx.strokeStyle = pick('rgba(100,200,150,0.7)', 0.7);
    ctx.lineWidth   = lw;

    // Type-specific icon
    if (type === 'Gc' || type === 'Oc') {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      if (type === 'Gc') {
        ctx.beginPath();
        ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
        ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
        ctx.stroke();
      }
    } else if (type === 'Nb' || type === 'SNR') {
      ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    } else {
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.5, r * 0.7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

// ─── Boundaries ───────────────────────────────────────────────────────────────

function drawBoundaries(ctx, boundaries, cx, cy, R, proj, mode, state, size, jd, lat, lon) {
  if (!boundaries || !boundaries.length) return;
  ctx.strokeStyle = pick('rgba(60,60,120,0.4)', 0.35);
  ctx.lineWidth   = 1;
  ctx.setLineDash([4, 6]);

  for (const seg of boundaries) {
    // seg = [[ra1,dec1],[ra2,dec2]]
    if (seg.length < 2) continue;
    const [a, b] = seg;
    const epA = precess(a[0], a[1], jd);
    const epB = precess(b[0], b[1], jd);
    const aaA = raDecToAltAz(epA.ra, epA.dec, jd, lat, lon);
    const aaB = raDecToAltAz(epB.ra, epB.dec, jd, lat, lon);
    if (aaA.alt < -5 || aaB.alt < -5) continue;
    const pA = project(aaA.alt, aaA.az, cx, cy, R, proj, mode, state, size);
    const pB = project(aaB.alt, aaB.az, cx, cy, R, proj, mode, state, size);
    if (!pA.visible || !pB.visible) continue;
    ctx.beginPath();
    ctx.moveTo(pA.x, pA.y);
    ctx.lineTo(pB.x, pB.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// ─── Grid ────────────────────────────────────────────────────────────────────

function drawGrid(ctx, cx, cy, R, proj, mode, state, size, lw) {
  const { altLines, azLines } = gridLines(15, 30);
  ctx.strokeStyle = getPalette().grid;
  ctx.lineWidth   = lw;
  ctx.setLineDash([2, 4]);

  const drawPoly = (pts) => {
    ctx.beginPath();
    let first = true;
    for (const { alt, az } of pts) {
      const { x, y, visible } = project(alt, az, cx, cy, R, proj, mode, state, size);
      if (!visible) { first = true; continue; }
      if (first) { ctx.moveTo(x, y); first = false; }
      else        ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  for (const pts of altLines) drawPoly(pts);
  for (const pts of azLines)  drawPoly(pts);
  ctx.setLineDash([]);
}

// ─── Ecliptic ────────────────────────────────────────────────────────────────

function drawEcliptic(ctx, cx, cy, R, proj, mode, state, size, jd, lat, lon, lw) {
  const pts = eclipticPath();
  ctx.strokeStyle = pick('rgba(255,200,0,0.4)', 0.45);
  ctx.lineWidth   = lw;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  let first = true;
  for (const { ra, dec } of pts) {
    const ep = precess(ra, dec, jd);
    const { alt, az } = raDecToAltAz(ep.ra, ep.dec, jd, lat, lon);
    if (alt < -5) { first = true; continue; }
    const { x, y } = project(alt, az, cx, cy, R, proj, mode, state, size);
    if (first) { ctx.moveTo(x, y); first = false; }
    else        ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

// ─── Equator ─────────────────────────────────────────────────────────────────

function drawEquator(ctx, cx, cy, R, proj, mode, state, size, jd, lat, lon, lw) {
  const pts = equatorPath();
  ctx.strokeStyle = pick('rgba(0,180,255,0.3)', 0.3);
  ctx.lineWidth   = lw;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  let first = true;
  for (const { ra, dec } of pts) {
    const ep = precess(ra, dec, jd);
    const { alt, az } = raDecToAltAz(ep.ra, ep.dec, jd, lat, lon);
    if (alt < -5) { first = true; continue; }
    const { x, y } = project(alt, az, cx, cy, R, proj, mode, state, size);
    if (first) { ctx.moveTo(x, y); first = false; }
    else        ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

// ─── Horizon & Compass ───────────────────────────────────────────────────────

const COMPASS = [
  { az: 0,   en: 'N',   bn: 'উত্তর' },
  { az: 90,  en: 'E',   bn: 'পূর্ব'  },
  { az: 180, en: 'S',   bn: 'দক্ষিণ' },
  { az: 270, en: 'W',   bn: 'পশ্চিম' },
  { az: 45,  en: 'NE',  bn: 'ঈশান'   },
  { az: 135, en: 'SE',  bn: 'আগ্নেয়' },
  { az: 225, en: 'SW',  bn: 'নৈর্ঋত' },
  { az: 315, en: 'NW',  bn: 'বায়ু'   },
];

function drawHorizon(ctx, cx, cy, R, state, size, layers, lw) {
  // Horizon circle
  ctx.strokeStyle = pick('rgba(110,231,183,0.65)', 0.65);
  ctx.lineWidth   = lw * 2;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();

  if (!layers.has('compass')) return;

  // Cardinal directions (N, E, S, W) — high contrast outside horizon ring
  const fs = px(size, 14);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  const main = COMPASS.slice(0, 4);
  for (const { az, en, bn } of main) {
    const azR = az * Math.PI / 180;
    const lx  = cx - Math.sin(azR) * (R + px(size, 22));   // E is left
    const ly  = cy - Math.cos(azR) * (R + px(size, 22));

    const label = state.lang === 'en' ? en
                : state.lang === 'bn' ? bn
                : `${bn} (${en})`;

    ctx.font = `bold ${fs}px "Noto Sans Bengali", "Inter", sans-serif`;
    const tw = ctx.measureText(label).width;
    const padX = px(size, 7);
    const boxH = fs + px(size, 6);

    // Dark pill background for crisp legibility
    ctx.fillStyle = getPalette().mono ? getPalette().bg : 'rgba(0,0,0,0.85)';
    ctx.beginPath();
    ctx.roundRect(lx - tw / 2 - padX, ly - boxH / 2, tw + padX * 2, boxH, px(size, 6));
    ctx.fill();
    ctx.strokeStyle = pick('rgba(110,231,183,0.45)', 0.45);
    ctx.lineWidth = lw;
    ctx.stroke();

    ctx.fillStyle = pick('#a7f3d0');
    ctx.fillText(label, lx, ly);
  }

  // Intercardinal directions (NE, SE, SW, NW)
  const subFs = px(size, 10);
  ctx.font = `600 ${subFs}px "Noto Sans Bengali", "Inter", sans-serif`;
  for (const { az, en, bn } of COMPASS.slice(4)) {
    const azR = az * Math.PI / 180;
    const lx  = cx - Math.sin(azR) * (R + px(size, 16));
    const ly  = cy - Math.cos(azR) * (R + px(size, 16));
    const label = state.lang === 'bn' ? bn : en;
    ctx.fillStyle = pick('rgba(167,243,208,0.65)', 0.65);
    ctx.fillText(label, lx, ly);
  }
}

// ─── Export footer ───────────────────────────────────────────────────────────

function drawFooter(ctx, text, size, lw) {
  const fs   = px(size, 11);
  const padH = px(size, 8);
  const padV = px(size, 6);
  const th   = fs + padV * 2;

  ctx.fillStyle = getPalette().footerBg;
  ctx.fillRect(0, size.h - th, size.w, th);

  ctx.font      = `${fs}px "Noto Sans Bengali", "Inter", sans-serif`;
  ctx.fillStyle = getPalette().footerText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padH, size.h - th / 2);
}
