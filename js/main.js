/**
 * main.js — Application entry point for Akash Star Chart
 *
 * Orchestrates: data loading, state init from URL hash, rendering loop,
 * user interaction (controls, search, zoom/pan, touch), live updates.
 */

import { renderChart } from './render.js';
import { initTheme, applyTheme, getTheme } from './theme.js';
import { parseHash, pushHash, getBase, parseDate, todayUTC, DEFAULT_LAYERS } from './urlstate.js';
import { loadNames } from './names.js';
import { loadI18n, setUiLang, t, updateInfoPanel, updateVisibleTonightPanel,
         showInfoCard, openNamesEditor, setupSearch, setupLayerToggles,
         setupExportPanel, populateBortleSelect, setLocations, showToast } from './ui.js';
import { bstToUtc, dateToJD, jdToGMST, gmstToLST, raDecToAltAz,
         sunPosition, moonPhase, riseTransitSet, precess, toBanglaDate, toBanglaNum } from './astro.js';
import { nelm as bortleNelm, constellationStatus, effectiveLimit, moonPenalty as calcMoonPenalty } from './visibility.js';
import { projectAllSky, unprojectAllSky } from './projection.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const BASE = getBase();
let _faintLoaded = false;
let _liveTimer   = null;
let _state       = null;
let _data        = { stars: [], faintStars: [], constellations: [], milkyway: null, messier: [], locations: [], boundaries: [] };
let _planets     = [];
let _highlighted = null;

// ─── Canvas setup ─────────────────────────────────────────────────────────────
const canvas  = document.getElementById('star-canvas');
const ctx     = canvas.getContext('2d');

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dim  = Math.min(rect.width, rect.height, window.innerWidth, window.innerHeight);
  canvas.width  = Math.round(dim * window.devicePixelRatio);
  canvas.height = Math.round(dim * window.devicePixelRatio);
  canvas.style.width  = dim + 'px';
  canvas.style.height = dim + 'px';
  scheduleRender();
}

// ─── Render scheduler ─────────────────────────────────────────────────────────
let _renderPending = false;
function scheduleRender() {
  if (_renderPending) return;
  _renderPending = true;
  requestAnimationFrame(async () => {
    _renderPending = false;
    if (!_state) return;
    const size = { w: canvas.width, h: canvas.height };
    // Compute planets from astronomy-engine if available
    _planets = computePlanets(_state);
    const dataWithPlanets = { ..._data, planets: _planets };
    await renderChart(ctx, _state, size, dataWithPlanets, {
      highlighted: _highlighted,
      zoom: _zoom,
      panX: _panX,
      panY: _panY,
    });
    _updateComputedInfo();
  });
}

// ─── Computed info update ─────────────────────────────────────────────────────
function _updateComputedInfo() {
  if (!_state) return;
  const { year, month, day } = parseDate(_state.date);
  const utcDate  = bstToUtc(year, month, day, _state.hour, _state.minute, 0);
  const jd       = dateToJD(utcDate);
  const lat      = _state.lat;
  const lon      = _state.lon;

  const sunPos   = sunPosition(jd);
  const sunAltAz = raDecToAltAz(sunPos.ra, sunPos.dec, jd, lat, lon);
  const moon     = moonPhase(jd);
  const moonRa   = (_state.hour < 6 ? sunPos.ra + 10 : sunPos.ra + 12) % 24;
  const moonDec  = -sunPos.dec * 0.85;
  const moonAltAz = raDecToAltAz(moonRa, moonDec, jd, lat, lon);
  const baseNelm = bortleNelm(_state.bortle);

  const polarisAltAz = raDecToAltAz(2.5303, 89.264, jd, lat, lon); // Polaris RA/Dec approx.

  const sunRTS  = riseTransitSet(sunPos.ra,  sunPos.dec,  jd, lat, lon);
  const moonRTS = riseTransitSet(moonRa, moonDec, jd, lat, lon);

  updateInfoPanel(_state, {
    sunAlt: sunAltAz.alt, moonAlt: moonAltAz.alt,
    moonPhaseData: moon,
    twilight: (() => {
      const a = sunAltAz.alt;
      if (a > 0) return 'day';
      if (a > -6) return 'civil';
      if (a > -12) return 'nautical';
      if (a > -18) return 'astronomical';
      return 'night';
    })(),
    bortlePreset: _state.bortle,
    polarisMult: polarisAltAz.alt,
    sunRise: sunRTS.rise, sunSet: sunRTS.set,
    moonRise: moonRTS.rise, moonSet: moonRTS.set,
  });

  // Update Bangla date if enabled
  if (_state.bnCal) {
    const bd = toBanglaDate(year, month, day);
    const el = document.getElementById('bn-date-display');
    if (el) el.textContent = `${bd.monthName} ${_state.bnNums ? toBanglaNum(bd.day) : bd.day}, ${_state.bnNums ? toBanglaNum(bd.year) : bd.year}`;
  }
}

// ─── Planet computation ───────────────────────────────────────────────────────
function computePlanets(state) {
  // If astronomy-engine is loaded, use it; else return precomputed approximate positions
  if (window.Astronomy) {
    const { year, month, day } = parseDate(state.date);
    const utcDate = bstToUtc(year, month, day, state.hour, state.minute, 0);
    const astro   = window.Astronomy;
    const bodies  = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
    return bodies.map(name => {
      try {
        const eq  = astro.Equator(name, utcDate, null, true, true);
        return { name, ra: eq.ra, dec: eq.dec, mag: 0, bv: 0 };
      } catch { return null; }
    }).filter(Boolean);
  }
  return [];
}

// ─── Faint star lazy loading ──────────────────────────────────────────────────
async function maybeLoadFaintStars(state) {
  const baseNelm = bortleNelm(state.bortle);
  if (!_faintLoaded && baseNelm > 6.5) {
    try {
      const url = new URL('data/stars_faint.json', BASE);
      const res = await fetch(url.href);
      if (res.ok) {
        _data.faintStars = await res.json();
        _faintLoaded = true;
      }
    } catch (e) {
      console.warn('Could not load faint stars:', e.message);
    }
  }
}

// ─── Data loading ─────────────────────────────────────────────────────────────
async function loadData() {
  const files = ['stars_bright.json', 'constellations.json', 'milkyway.json',
                 'messier.json', 'names_bn.json', 'locations.json', 'boundaries.json'];

  const urls = files.map(f => new URL(`data/${f}`, BASE).href);

  const [stars, constellations, milkyway, messier, _names, locations, boundaries] =
    await Promise.all(urls.map(u => fetch(u).then(r => r.json()).catch(() => null)));

  _data.stars          = stars           || [];
  _data.constellations = constellations  || [];
  _data.milkyway       = milkyway;
  _data.messier        = messier         || [];
  _data.locations      = locations       || [];
  _data.boundaries     = boundaries      || [];

  setLocations(_data.locations);
}

// ─── State mutations ──────────────────────────────────────────────────────────
function applyState(newState) {
  _state = { ..._state, ...newState };
  pushHash(_state);
  maybeLoadFaintStars(_state);
  scheduleRender();
}

// ─── Control wiring ───────────────────────────────────────────────────────────
function wireControls() {
  // Location select
  const locSel = document.getElementById('location-select');
  locSel?.addEventListener('change', () => {
    const loc = _data.locations.find(l => l.id === locSel.value);
    if (loc) {
      applyState({ loc: loc.id, lat: loc.lat, lon: loc.lon });
    } else if (locSel.value === 'custom') {
      applyState({ loc: 'custom' });
    }
  });

  // Manual lat/lon
  document.getElementById('input-lat')?.addEventListener('change', e => applyState({ lat: parseFloat(e.target.value), loc: 'custom' }));
  document.getElementById('input-lon')?.addEventListener('change', e => applyState({ lon: parseFloat(e.target.value), loc: 'custom' }));

  // GPS button
  document.getElementById('btn-gps')?.addEventListener('click', () => {
    if (!navigator.geolocation) { showToast(t('gpsNotSupported')); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      applyState({ lat: pos.coords.latitude, lon: pos.coords.longitude, loc: 'custom' });
      showToast(t('gpsLocated'));
    }, () => showToast(t('gpsError')));
  });

  // Date input
  document.getElementById('input-date')?.addEventListener('change', e => applyState({ date: e.target.value }));

  // Time input
  document.getElementById('input-time')?.addEventListener('change', e => {
    const [h, m] = e.target.value.split(':').map(Number);
    applyState({ hour: h, minute: m });
  });

  // Now button (live updates)
  document.getElementById('btn-now')?.addEventListener('click', () => {
    clearInterval(_liveTimer);
    const tick = () => {
      const now = new Date();
      // Convert UTC to BST (UTC+6)
      const bst = new Date(now.getTime() + 6 * 3600000);
      const h   = bst.getUTCHours();
      const m   = bst.getUTCMinutes();
      const d   = `${bst.getUTCFullYear()}-${String(bst.getUTCMonth()+1).padStart(2,'0')}-${String(bst.getUTCDate()).padStart(2,'0')}`;
      applyState({ date: d, hour: h, minute: m });
      _syncFormValues();
    };
    tick();
    _liveTimer = setInterval(tick, 30000);
    showToast(t('liveMode'));
  });

  // Time slider
  const slider = document.getElementById('time-slider');
  slider?.addEventListener('input', () => {
    const totalMin = parseInt(slider.value, 10);
    const h = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    applyState({ hour: h, minute: m });
  });

  // Bortle select
  const bortleSel = document.getElementById('bortle-select');
  bortleSel?.addEventListener('change', () => {
    const v = bortleSel.value;
    applyState({ bortle: v === 'custom' ? 'custom' : parseInt(v, 10) });
  });

  // Custom NELM slider
  document.getElementById('nelm-slider')?.addEventListener('input', e =>
    applyState({ nelm: parseFloat(e.target.value) }));

  // K (extinction) slider
  document.getElementById('k-slider')?.addEventListener('input', e =>
    applyState({ k: parseFloat(e.target.value) }));

  // Moon penalty toggle
  document.getElementById('moon-penalty')?.addEventListener('change', e =>
    applyState({ moonPenaltyEnabled: e.target.checked }));

  // Language toggle (sidebar select + toolbar quick toggle)
  document.getElementById('lang-select')?.addEventListener('change', e => {
    applyState({ lang: e.target.value });
    _syncFormValues();
  });
  document.querySelectorAll('[name="label-lang"]').forEach(r =>
    r.addEventListener('change', () => {
      if (r.checked) {
        applyState({ lang: r.value });
        _syncFormValues();
      }
    }));

  // UI language
  document.getElementById('ui-lang')?.addEventListener('change', e => {
    setUiLang(e.target.value);
  });

  // Bangla numerals
  document.getElementById('bn-nums')?.addEventListener('change', e =>
    applyState({ bnNums: e.target.checked }));

  // Bangla calendar
  document.getElementById('bn-cal')?.addEventListener('change', e =>
    applyState({ bnCal: e.target.checked }));

  // Chart mode
  document.querySelectorAll('[name="chart-mode"]').forEach(r =>
    r.addEventListener('change', () => applyState({ mode: r.value })));

  // Projection
  document.querySelectorAll('[name="projection"]').forEach(r =>
    r.addEventListener('change', () => applyState({ proj: r.value })));

  // Direction
  document.querySelectorAll('[name="direction"]').forEach(r =>
    r.addEventListener('change', () => applyState({ dir: r.value })));

  // FOV slider
  document.getElementById('fov-slider')?.addEventListener('input', e =>
    applyState({ fov: parseInt(e.target.value, 10) }));

  // Show below horizon
  document.getElementById('show-below')?.addEventListener('change', e =>
    applyState({ showBelowHorizon: e.target.checked }));

  // Names editor
  document.getElementById('btn-names-editor')?.addEventListener('click', () => openNamesEditor(_state));

  // Share link
  const nightBtn = document.getElementById('btn-night');
  initTheme();
  nightBtn?.setAttribute('aria-pressed', String(getTheme() === 'red'));
  nightBtn?.addEventListener('click', () => {
    const on = getTheme() !== 'red';
    applyTheme(on ? 'red' : 'dark');
    nightBtn.setAttribute('aria-pressed', String(on));
    scheduleRender();
  });

  document.getElementById('btn-share')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(window.location.href)
      .then(() => showToast(t('linkCopied')))
      .catch(() => {});
  });

  // Compare mode
  document.getElementById('btn-compare')?.addEventListener('click', () =>
    applyState({ compareMode: !_state.compareMode }));

  // Sidebar toggle
  document.getElementById('btn-sidebar')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('open');
  });

  // Panel section toggles (accordion)
  document.querySelectorAll('.panel-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      target?.classList.toggle('collapsed');
      btn.setAttribute('aria-expanded', !target?.classList.contains('collapsed'));
    });
  });
}

// ─── Zoom / Pan (canvas interaction) ─────────────────────────────────────────
let _zoom = 1, _panX = 0, _panY = 0;
let _dragStart = null, _touchDist = null, _didDrag = false;

function setZoom(newZoom) {
  _zoom = Math.max(0.5, Math.min(10, newZoom));
  if (_zoom === 1 && Math.abs(_panX) < 1 && Math.abs(_panY) < 1) {
    _panX = 0; _panY = 0;
  }
  const el = document.getElementById('zoom-level');
  if (el) el.textContent = `${Math.round(_zoom * 100)}%`;
  scheduleRender();
}

function resetZoom() {
  _panX = 0;
  _panY = 0;
  setZoom(1);
}

function wireCanvasInteraction() {
  // Zoom buttons
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => setZoom(_zoom * 1.25));
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => setZoom(_zoom / 1.25));
  document.getElementById('btn-zoom-reset')?.addEventListener('click', resetZoom);

  // Mouse wheel zoom
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setZoom(_zoom * factor);
  }, { passive: false });

  // Click / tap for info card (ignore if user dragged)
  canvas.addEventListener('click', e => {
    if (_didDrag) { _didDrag = false; return; }
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top)  * scaleY;
    _handleCanvasTap(x, y);
  });

  // Drag to pan
  canvas.addEventListener('mousedown', e => {
    _didDrag = false;
    _dragStart = { x: e.clientX - _panX, y: e.clientY - _panY, sx: e.clientX, sy: e.clientY };
  });
  window.addEventListener('mousemove', e => {
    if (!_dragStart) return;
    if (Math.hypot(e.clientX - _dragStart.sx, e.clientY - _dragStart.sy) > 4) _didDrag = true;
    const dpr = window.devicePixelRatio || 1;
    _panX = (e.clientX - _dragStart.x) * dpr;
    _panY = (e.clientY - _dragStart.y) * dpr;
    scheduleRender();
  });
  window.addEventListener('mouseup', () => { _dragStart = null; });

  // Pinch zoom (touch)
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      _touchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && _touchDist) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      setZoom(_zoom * (dist / _touchDist));
      _touchDist = dist;
    }
  }, { passive: true });
  canvas.addEventListener('touchend', () => { _touchDist = null; }, { passive: true });
}

function _handleCanvasTap(rawX, rawY) {
  if (!_state || _state.mode !== 'allsky') return;
  const size = { w: canvas.width, h: canvas.height };
  const cx = size.w / 2, cy = size.h / 2;
  // Invert zoom & pan
  const x = (rawX - cx - _panX) / _zoom + cx;
  const y = (rawY - cy - _panY) / _zoom + cy;

  const R = Math.min(size.w, size.h) / 2 - 44 * (size.w / 800);
  const { year, month, day } = parseDate(_state.date);
  const jd = dateToJD(bstToUtc(year, month, day, _state.hour, _state.minute, 0));

  // Find nearest star within tolerance
  let best = null, bestDist = 18 / _zoom; // px
  for (const star of [...(_data.stars || []), ...(_data.faintStars || [])]) {
    const ep = precess(star[1], star[2], jd);
    const aa = raDecToAltAz(ep.ra, ep.dec, jd, _state.lat, _state.lon);
    if (aa.alt < 3) continue;
    const p  = projectAllSky(aa.alt, aa.az, cx, cy, R, _state.proj);
    const d  = Math.hypot(p.x - x, p.y - y);
    if (d < bestDist && star[3] <= bortleNelm(_state.bortle)) {
      bestDist = d; best = { star, aa };
    }
  }

  if (best) {
    showInfoCard({
      name: best.star[5] || best.star[6] || `HIP ${best.star[0]}`,
      category: 'stars',
      mag: best.star[3],
      alt: best.aa.alt,
      az:  best.aa.az,
      con: best.star[7],
    }, _state, {});
  } else {
    document.getElementById('info-card')?.style.setProperty('display', 'none');
  }
}

function _syncFormValues() {
  const s = _state;
  if (!s) return;
  const d = document.getElementById('input-date');
  const tm = document.getElementById('input-time');
  const ls = document.getElementById('lang-select');
  if (d) d.value = s.date;
  if (tm) tm.value = `${String(s.hour).padStart(2,'0')}:${String(s.minute).padStart(2,'0')}`;
  if (ls) ls.value = s.lang;
  document.querySelectorAll('[name="label-lang"]').forEach(r => {
    r.checked = r.value === s.lang;
  });
}

// ─── Service Worker update toast ──────────────────────────────────────────────
function listenForSWUpdates() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(reg => {
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          showToast(t('newVersionAvailable'), 10000, {
            label: t('reload'),
            fn: () => window.location.reload(),
          });
        }
      });
    });
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  // 1. Parse URL state
  _state = parseHash(window.location.hash);

  // 2. Load i18n and names in parallel
  await Promise.all([
    loadI18n(BASE),
    loadNames(BASE),
  ]);

  // 3. Set initial UI language
  setUiLang('en');  // default; user can change via toggle

  // 4. Load data
  await loadData();

  // 5. Populate selects
  populateBortleSelect();

  // 6. Wire up controls
  wireControls();
  wireCanvasInteraction();

  // 7. Layer toggles
  setupLayerToggles(_state, (newState) => { _state = newState; pushHash(_state); scheduleRender(); });

  // 8. Search
  setupSearch(_data, _state, (hit) => { _highlighted = hit; scheduleRender(); });

  // 9. Export panel
  setupExportPanel(_state, _data, _data.locations);

  // 10. Sync form values from state
  _syncFormValues();

  // 11. Resize and first render
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // 12. SW update listener
  listenForSWUpdates();

  // 13. Register service worker (relative path for sub-path hosting)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .catch(e => console.warn('SW registration failed:', e));
  }

  // 14. Hash change listener
  window.addEventListener('hashchange', () => {
    _state = parseHash(window.location.hash);
    _syncFormValues();
    scheduleRender();
  });

  scheduleRender();
}

boot().catch(console.error);
