/**
 * names.js — Bangla and English name management
 *
 * Priority: user localStorage edits → shipped names_bn.json
 * Missing Bangla name → show English only (never error or placeholder)
 */

const LS_KEY = 'akash_names_overrides';

/** Loaded from data/names_bn.json */
let _shipped = { constellations: {}, stars: {}, planets: {}, misc: {} };
/** User overrides from localStorage */
let _user = { constellations: {}, stars: {}, planets: {}, misc: {} };

/**
 * Load the shipped names_bn.json file (call once at startup).
 * @param {string} base  Base URL for data files
 */
export async function loadNames(base = './') {
  try {
    const url = new URL('data/names_bn.json', base.endsWith('/') ? base : base + '/');
    const res = await fetch(url.href);
    if (!res.ok) throw new Error(res.statusText);
    _shipped = await res.json();
  } catch (e) {
    console.warn('names_bn.json not loaded:', e.message);
  }
  _loadUserOverrides();
}

function _loadUserOverrides() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) _user = JSON.parse(raw);
  } catch { /* ignore */ }
}

function _saveUserOverrides() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(_user));
  } catch { /* quota exceeded — ignore */ }
}

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * Get Bangla name for an object.
 * @param {'constellations'|'stars'|'planets'|'misc'} category
 * @param {string} englishKey  English name as key (e.g. 'Orion', 'Sirius')
 * @returns {string|null}  Bangla string or null if not found
 */
export function getBn(category, englishKey) {
  const userEntry     = (_user[category]    || {})[englishKey];
  const shippedEntry  = (_shipped[category] || {})[englishKey];

  const bn = userEntry?.bn || shippedEntry?.bn || null;
  return bn && bn.trim() !== '' ? bn : null;
}

/**
 * Returns the display label for an object according to the current language mode.
 *
 * @param {'en'|'bn'|'both'} lang
 * @param {string} englishName
 * @param {'constellations'|'stars'|'planets'|'misc'} category
 * @returns {string[]}  Array of lines to draw (index 0 = main, 1 = secondary if both)
 */
export function getLabel(lang, englishName, category) {
  const bn = getBn(category, englishName);

  if (lang === 'en') return [englishName];
  if (lang === 'bn') return bn ? [bn] : [englishName];
  // 'both': Bangla first (larger), English second (smaller)
  if (bn) return [bn, englishName];
  return [englishName];
}

/**
 * Convenience: get label as a single string (first line only).
 */
export function getLabelMain(lang, englishName, category) {
  return getLabel(lang, englishName, category)[0];
}

// ─── User editor API ─────────────────────────────────────────────────────────

/**
 * Set a user override for a Bangla name.
 */
export function setUserBn(category, englishKey, bn, verified = false) {
  if (!_user[category]) _user[category] = {};
  _user[category][englishKey] = { bn, verified };
  _saveUserOverrides();
}

/**
 * Remove a user override (revert to shipped).
 */
export function clearUserBn(category, englishKey) {
  if (_user[category]) delete _user[category][englishKey];
  _saveUserOverrides();
}

/**
 * Export the merged names as a names_bn.json-compatible object.
 * User overrides win. Used for the "Export as pull-request-ready JSON" button.
 */
export function exportMergedNames() {
  const merged = { constellations: {}, stars: {}, planets: {}, misc: {} };
  for (const cat of Object.keys(merged)) {
    merged[cat] = { ...(_shipped[cat] || {}), ...(_user[cat] || {}) };
  }
  return merged;
}

/**
 * Import a names_bn.json object into user overrides (additive / replace).
 */
export function importNames(obj) {
  for (const cat of ['constellations', 'stars', 'planets', 'misc']) {
    if (!obj[cat]) continue;
    if (!_user[cat]) _user[cat] = {};
    Object.assign(_user[cat], obj[cat]);
  }
  _saveUserOverrides();
}

/**
 * Returns all entries suitable for the Names Editor modal.
 * Each item: { category, englishKey, shippedBn, userBn, verified, hasUserOverride }
 */
export function allNamesForEditor() {
  const result = [];

  const categories = ['constellations', 'stars', 'planets', 'misc'];
  for (const cat of categories) {
    const keys = new Set([
      ...Object.keys(_shipped[cat] || {}),
      ...Object.keys(_user[cat]    || {}),
    ]);
    for (const k of keys) {
      const s = (_shipped[cat] || {})[k] || {};
      const u = (_user[cat]    || {})[k] || {};
      result.push({
        category:       cat,
        englishKey:     k,
        shippedBn:      s.bn  || '',
        userBn:         u.bn  || '',
        verified:       u.verified ?? s.verified ?? false,
        hasUserOverride: !!u.bn,
      });
    }
  }

  return result;
}
