/**
 * export.js — Client-side PNG/JPG export (single, month batch, year batch)
 *
 * Uses JSZip + FileSaver (vendored). All rendering is done via renderChart()
 * on an offscreen canvas.
 */

import { renderChart } from './render.js';
import { getPalette } from './theme.js';
import { bstToUtc, dateToJD, toBanglaDate, toBanglaNum } from './astro.js';
import { nelm as bortleNelm } from './visibility.js';
import { getLabel } from './names.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Clamp canvas dimension to browser limits (Chrome: 16384, iOS: 4096). */
function clampPx(px, maxPx = 4096) { return Math.min(px, maxPx); }

/** Create an offscreen canvas of the given size. */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width  = clampPx(w);
  c.height = clampPx(h);
  return c;
}

/** Pad a number to 2 digits. */
const pad2 = n => String(n).padStart(2, '0');

/**
 * Build a human-readable footer string.
 */
function footerText(state, locationName, data) {
  const baseNelm = state.bortle === 'custom' && state.nelm != null
    ? state.nelm
    : bortleNelm(state.bortle);

  const loc   = locationName || `${state.lat.toFixed(2)}N, ${state.lon.toFixed(2)}E`;
  const dateS = state.date;
  const timeS = `${pad2(state.hour)}:${pad2(state.minute)} BST`;
  const bortleS = `Bortle ${state.bortle} · NELM ${baseNelm.toFixed(1)}`;

  if (state.bnCal) {
    const { year, month, day } = (() => {
      const [y, m, d] = state.date.split('-').map(Number);
      return toBanglaDate(y, m, d);
    })();
    const bnDate = state.bnNums
      ? `${toBanglaNum(year)} ${toBanglaNum(month)} ${toBanglaNum(day)}`
      : `${year} ${month} ${day}`;
    return `${loc}  ·  ${bnDate}  ·  ${timeS}  ·  ${bortleS}  ·  Akash Star Chart`;
  }

  return `${loc}  ·  ${dateS}  ·  ${timeS}  ·  ${bortleS}  ·  Akash Star Chart`;
}

/**
 * Render a chart to a canvas blob URL.
 * @param {object} state
 * @param {object} data
 * @param {{ w, h }} size
 * @param {'png'|'jpg'} format
 * @param {number} quality  0.7 to 1.0
 * @param {string} locationName
 * @param {boolean} footer
 * @returns {Promise<Blob>}
 */
export async function renderToBlob(state, data, size, format = 'png', quality = 0.92, locationName = '', footer = true) {
  const canvas = makeCanvas(size.w, size.h);
  const ctx = canvas.getContext('2d');

  // For JPG fill background (no alpha)
  if (format === 'jpg' || format === 'jpeg') {
    ctx.fillStyle = getPalette().bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Await font loading before drawing
  try {
    await document.fonts.load(`14px "Noto Sans Bengali"`);
    await document.fonts.load(`14px "Inter"`);
  } catch { /* non-fatal */ }

  const footerTxt = footer ? footerText(state, locationName, data) : null;

  await renderChart(ctx, state, { w: canvas.width, h: canvas.height }, data, {
    footerText:   footerTxt,
    exportMode:   true,
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob failed')),
                  format === 'jpg' ? 'image/jpeg' : 'image/png', quality);
  });
}

/** Build a filename like akash_2026-12-15_2100_dhaka_bortle8.png */
function buildFilename(state, locationKey, format = 'png') {
  const t = `${pad2(state.hour)}${pad2(state.minute)}`;
  const loc = locationKey || 'custom';
  const b   = state.bortle === 'custom' ? `nelm${state.nelm}` : `bortle${state.bortle}`;
  return `akash_${state.date}_${t}_${loc}_${b}.${format}`;
}

// ─── Single export ────────────────────────────────────────────────────────────

/**
 * Export the current chart as a single image and trigger download.
 *
 * @param {object} state
 * @param {object} data
 * @param {object} opts  { size, format, quality, footer, locationName, locationKey }
 */
export async function exportSingle(state, data, opts = {}) {
  const size     = opts.size     || { w: 2048, h: 2048 };
  const format   = opts.format   || 'png';
  const quality  = opts.quality  ?? 0.92;
  const footer   = opts.footer   ?? true;
  const locName  = opts.locationName || '';
  const locKey   = opts.locationKey  || state.loc;

  const blob     = await renderToBlob(state, data, size, format, quality, locName, footer);
  const filename = buildFilename(state, locKey, format);

  _download(blob, filename);
}

/** Trigger a browser download. */
function _download(blob, filename) {
  if (window.saveAs) {
    window.saveAs(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href    = url; a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}

// ─── Month batch export ───────────────────────────────────────────────────────

/**
 * Export multiple charts for a given month as a ZIP.
 *
 * @param {object} baseState   Current state (lat, lon, hour, minute, bortle, etc.)
 * @param {number} year
 * @param {number} month       1-based
 * @param {'everynight'|'weekly'|'bimonthly'} frequency
 * @param {object} data
 * @param {object} opts        { size, format, quality, footer, locationName, onProgress, onCancel }
 */
export async function exportMonth(baseState, year, month, frequency, data, opts = {}) {
  const size       = opts.size     || { w: 1080, h: 1080 };
  const format     = opts.format   || 'png';
  const quality    = opts.quality  ?? 0.92;
  const footer     = opts.footer   ?? true;
  const locName    = opts.locationName || '';
  const locKey     = baseState.loc;
  const onProgress = opts.onProgress || (() => {});
  let   cancelled  = false;
  if (opts.cancelRef) opts.cancelRef.cancel = () => { cancelled = true; };

  // Determine which days to render
  const daysInMonth = new Date(year, month, 0).getDate();
  let days = [];

  if (frequency === 'everynight') {
    days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  } else if (frequency === 'weekly') {
    for (let d = 1; d <= daysInMonth; d += 7) days.push(d);
  } else { // bimonthly
    days = [1, 15].filter(d => d <= daysInMonth);
  }

  const zip = new window.JSZip();
  for (let i = 0; i < days.length; i++) {
    if (cancelled) break;

    const day  = days[i];
    const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;
    const state   = { ...baseState, date: dateStr };
    const blob    = await renderToBlob(state, data, size, format, quality, locName, footer);
    const fname   = buildFilename(state, locKey, format);
    zip.file(fname, blob);

    onProgress((i + 1) / days.length);
    // Yield to allow UI updates
    await new Promise(r => requestAnimationFrame(r));
  }

  if (cancelled) return;

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const mn      = String(month).padStart(2, '0');
  _download(zipBlob, `akash_${year}-${mn}_${locKey}.zip`);
}

// ─── Year batch export ────────────────────────────────────────────────────────

/**
 * Export 12 charts (15th of each month) for a given year as a ZIP.
 *
 * @param {object} baseState
 * @param {number} year
 * @param {object} data
 * @param {object} opts  { size, format, quality, footer, locationName, onProgress, poster }
 */
export async function exportYear(baseState, year, data, opts = {}) {
  const size       = opts.size     || { w: 1080, h: 1080 };
  const format     = opts.format   || 'png';
  const quality    = opts.quality  ?? 0.92;
  const footer     = opts.footer   ?? true;
  const locName    = opts.locationName || '';
  const locKey     = baseState.loc;
  const onProgress = opts.onProgress || (() => {});

  const zip    = new window.JSZip();
  const blobs  = [];

  for (let m = 1; m <= 12; m++) {
    const dateStr = `${year}-${pad2(m)}-15`;
    const state   = { ...baseState, date: dateStr };
    const blob    = await renderToBlob(state, data, size, format, quality, locName, footer);
    const fname   = buildFilename(state, locKey, format);
    zip.file(fname, blob);
    blobs.push(blob);
    onProgress(m / 12);
    await new Promise(r => requestAnimationFrame(r));
  }

  if (opts.poster) {
    const posterBlob = await _buildPoster(blobs, year, baseState, data, opts);
    zip.file(`akash_${year}_${locKey}_poster.${format}`, posterBlob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  _download(zipBlob, `akash_${year}_${locKey}.zip`);
}

/** Build a 4×3 poster image from 12 month thumbnails. */
async function _buildPoster(blobs, year, state, data, opts) {
  const cols = 4, rows = 3;
  const tw   = clampPx(opts.size?.w || 1080, 1080);
  const th   = clampPx(opts.size?.h || 1080, 1080);
  const poster = makeCanvas(tw * cols, th * rows);
  const ctx    = poster.getContext('2d');
  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, 0, poster.width, poster.height);

  for (let i = 0; i < blobs.length; i++) {
    const img  = await _blobToImage(blobs[i]);
    const col  = i % cols;
    const row  = Math.floor(i / cols);
    ctx.drawImage(img, col * tw, row * th, tw, th);
  }

  return new Promise(resolve =>
    poster.toBlob(resolve, 'image/jpeg', 0.88));
}

function _blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = reject;
    img.src     = url;
  });
}

// ─── Compare mode export ─────────────────────────────────────────────────────

/**
 * Export a side-by-side comparison of two Bortle levels.
 */
export async function exportCompare(state, data, bortle1, bortle2, opts = {}) {
  const size    = opts.size   || { w: 2048, h: 1080 };
  const format  = opts.format || 'png';
  const quality = opts.quality ?? 0.92;
  const half    = { w: size.w / 2, h: size.h };

  const s1 = { ...state, bortle: bortle1 };
  const s2 = { ...state, bortle: bortle2 };

  const [b1, b2] = await Promise.all([
    renderToBlob(s1, data, half, format, quality, opts.locationName, true),
    renderToBlob(s2, data, half, format, quality, opts.locationName, true),
  ]);

  const canvas = makeCanvas(size.w, size.h);
  const ctx    = canvas.getContext('2d');
  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, 0, size.w, size.h);

  const [img1, img2] = await Promise.all([_blobToImage(b1), _blobToImage(b2)]);
  ctx.drawImage(img1, 0, 0, half.w, half.h);
  ctx.drawImage(img2, half.w, 0, half.w, half.h);

  // Divider line
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(half.w, 0); ctx.lineTo(half.w, size.h);
  ctx.stroke();

  return new Promise(resolve =>
    canvas.toBlob(resolve, format === 'jpg' ? 'image/jpeg' : 'image/png', quality));
}

// ─── Web Share API ────────────────────────────────────────────────────────────

/**
 * Share the current chart image via the Web Share API (mobile).
 * Falls back to clipboard copy.
 */
export async function shareChart(state, data, opts = {}) {
  const size = opts.size || { w: 1080, h: 1080 };
  const blob = await renderToBlob(state, data, size, 'png', 0.92, opts.locationName, true);

  if (navigator.share && navigator.canShare?.({ files: [new File([blob], 'akash.png', { type: 'image/png' })] })) {
    await navigator.share({
      title:  'Akash Star Chart',
      text:   `Sky chart for ${state.date} from ${opts.locationName || 'Bangladesh'}`,
      files:  [new File([blob], 'akash.png', { type: 'image/png' })],
    });
    return;
  }

  // Fallback: copy to clipboard
  if (navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    opts.onCopied?.();
  }
}
