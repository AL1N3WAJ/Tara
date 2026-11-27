/**
 * theme.js — single source of truth for canvas colours.
 * Reads CSS custom properties (so Default / Night Vision / Print share one
 * render path) and exposes a print-mode override used by exports.
 */
const root = document.documentElement;
let _print = false;
let _cache = null;

export function setPrintMode(on) { _print = !!on; _cache = null; }
export function isPrintMode()    { return _print; }
export function invalidatePalette() { _cache = null; }

export function getTheme() { return root.dataset.theme || 'dark'; }

export function applyTheme(name) {
  root.dataset.theme = name;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = name === 'red' ? '#000000' : '#18222F';
  try { localStorage.setItem('akash-theme', name); } catch { /* private mode */ }
  _cache = null;
}

export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('akash-theme'); } catch { /* ignore */ }
  applyTheme(saved === 'red' ? 'red' : 'dark');
}

function cssVar(cs, name, fallback) {
  const v = cs.getPropertyValue(name).trim();
  return v || fallback;
}

export function getPalette() {
  if (_cache) return _cache;
  if (_print) {
    _cache = {
      mono: true, print: true,
      bg: '#ffffff', skyOuter: '#ffffff', star: '#000000', line: '#000000',
      grid: 'rgba(0,0,0,0.28)', text: '#000000', textMuted: 'rgba(0,0,0,0.65)',
      accent: '#000000', footerBg: 'rgba(255,255,255,0.92)', footerText: '#000000',
    };
    return _cache;
  }
  const cs = getComputedStyle(root);
  const night = getTheme() === 'red';
  const star = cssVar(cs, '--star', '#F3EFE6');
  _cache = {
    mono: night, print: false,
    bg: cssVar(cs, '--sky', '#101720'),
    skyOuter: cssVar(cs, '--sky-outer', '#0b1119'),
    star,
    line: cssVar(cs, '--line', '#5C6F82'),
    grid: cssVar(cs, '--grid', 'rgba(92,111,130,0.35)'),
    text: star,
    textMuted: cssVar(cs, '--text-muted', 'rgba(243,239,230,0.72)'),
    accent: cssVar(cs, '--accent', '#D4A359'),
    footerBg: night ? 'rgba(0,0,0,0.85)' : 'rgba(16,23,32,0.85)',
    footerText: star,
  };
  return _cache;
}

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Colour for decorative elements: the given colour normally, the
 *  single theme ink (red / black) at the given alpha in Night Vision & Print. */
export function pick(normal, alpha = 1) {
  const pal = getPalette();
  return pal.mono ? hexToRgba(pal.star, alpha) : normal;
}
