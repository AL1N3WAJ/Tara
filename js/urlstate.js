/**
 * urlstate.js — Hash-based URL state serialisation
 *
 * Hash format:  #loc=dhaka&lat=23.81&lon=90.41&date=2026-11-27&t=2100&bortle=8&lang=both&proj=equidistant
 *
 * - `loc` is a preset key (see locations.json) or 'custom'
 * - When loc=custom, lat= and lon= are used
 * - `date` is YYYY-MM-DD
 * - `t` is HHMM (local BST)
 * - `lang` is 'en', 'bn', or 'both'
 * - `proj` is 'equidistant' or 'stereographic'
 * - `bortle` is 1–9 or 'custom'
 * - `nelm` (only when bortle=custom) is the custom NELM value
 * - `layers` is a comma-separated list of active layer names
 */

export const DEFAULTS = {
  loc:    'dhaka',
  lat:    23.81,
  lon:    90.41,
  date:   null,         // set to today on load
  hour:   21,
  minute: 0,
  bortle: 8,
  nelm:   null,         // null = derived from bortle
  lang:   'both',
  proj:   'equidistant',
  mode:   'allsky',     // 'allsky' | 'directional' | 'constellation'
  dir:    'N',          // direction for directional mode
  fov:    90,           // degrees for directional mode
  conId:  'ORI',        // constellation for constellation mode
  layers: null,         // null = all defaults on
  bnNums: false,        // Bangla numerals
  bnCal:  false,        // Bangla calendar
  bortle2: 3,           // compare mode second Bortle
  compareMode: false,
};

const DEFAULT_LAYERS = [
  'stars', 'starColors', 'constellLines', 'constellNames', 'starNames',
  'milkyway', 'planets', 'moon', 'sun', 'compass', 'horizon',
];

/**
 * Parse the current URL hash into a state object.
 * Unknown keys are ignored; missing keys fall back to DEFAULTS.
 */
export function parseHash(hash = window.location.hash) {
  const str    = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(str);
  const state  = { ...DEFAULTS };

  if (params.has('loc'))    state.loc    = params.get('loc');
  if (params.has('lat'))    state.lat    = parseFloat(params.get('lat'));
  if (params.has('lon'))    state.lon    = parseFloat(params.get('lon'));
  if (params.has('date'))   state.date   = params.get('date');
  if (params.has('bortle')) {
    const b = params.get('bortle');
    state.bortle = b === 'custom' ? 'custom' : parseInt(b, 10);
  }
  if (params.has('nelm'))   state.nelm   = parseFloat(params.get('nelm'));
  if (params.has('lang'))   state.lang   = params.get('lang');
  if (params.has('proj'))   state.proj   = params.get('proj');
  if (params.has('mode'))   state.mode   = params.get('mode');
  if (params.has('dir'))    state.dir    = params.get('dir');
  if (params.has('fov'))    state.fov    = parseInt(params.get('fov'), 10);
  if (params.has('conId'))  state.conId  = params.get('conId');
  if (params.has('bnNums')) state.bnNums = params.get('bnNums') === '1';
  if (params.has('bnCal'))  state.bnCal  = params.get('bnCal')  === '1';
  if (params.has('compare')) state.compareMode = params.get('compare') === '1';
  if (params.has('bortle2')) state.bortle2 = parseInt(params.get('bortle2'), 10);

  if (params.has('t')) {
    const t = params.get('t').padStart(4, '0');
    state.hour   = parseInt(t.slice(0, 2), 10);
    state.minute = parseInt(t.slice(2, 4), 10);
  }

  if (params.has('layers')) {
    state.layers = params.get('layers').split(',').filter(Boolean);
  } else {
    state.layers = [...DEFAULT_LAYERS];
  }

  // Set today as default date if missing
  if (!state.date) {
    const now = new Date();
    state.date = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  }

  return state;
}

/**
 * Serialise a state object to a URL hash string.
 */
export function stateToHash(state) {
  const p = new URLSearchParams();

  p.set('loc',    state.loc);
  if (state.loc === 'custom') {
    p.set('lat', state.lat.toFixed(4));
    p.set('lon', state.lon.toFixed(4));
  }
  p.set('date',   state.date);
  p.set('t',      String(state.hour).padStart(2, '0') + String(state.minute).padStart(2, '0'));
  p.set('bortle', String(state.bortle));
  if (state.bortle === 'custom' && state.nelm !== null) p.set('nelm', state.nelm.toFixed(1));
  p.set('lang',   state.lang);
  p.set('proj',   state.proj);
  p.set('mode',   state.mode);
  if (state.mode === 'directional') {
    p.set('dir', state.dir);
    p.set('fov', String(state.fov));
  }
  if (state.mode === 'constellation') p.set('conId', state.conId);
  if (state.bnNums) p.set('bnNums', '1');
  if (state.bnCal)  p.set('bnCal',  '1');
  if (state.compareMode) {
    p.set('compare', '1');
    p.set('bortle2', String(state.bortle2));
  }

  // Only write layers if they differ from default
  const layerStr = state.layers.sort().join(',');
  const defStr   = [...DEFAULT_LAYERS].sort().join(',');
  if (layerStr !== defStr) p.set('layers', state.layers.join(','));

  return '#' + p.toString();
}

/**
 * Update window.location.hash without triggering a page reload.
 */
export function pushHash(state) {
  const h = stateToHash(state);
  if (window.location.hash !== h) {
    history.replaceState(null, '', h);
  }
}

/**
 * Returns the base URL that resolves relative assets correctly,
 * whether served from / or from /akash/ etc.
 */
export function getBase() {
  // Find the directory of the current script / page
  const loc = window.location;
  const path = loc.pathname.endsWith('/') ? loc.pathname : loc.pathname.slice(0, loc.pathname.lastIndexOf('/') + 1);
  return loc.origin + path;
}

/** Parse a date string "YYYY-MM-DD" into { year, month, day } */
export function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/** Today's date string in UTC */
export function todayUTC() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

export { DEFAULT_LAYERS };
