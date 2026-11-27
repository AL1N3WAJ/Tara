#!/usr/bin/env node
/**
 * scripts/build_data.js — Generate compact star catalog JSON files
 *
 * Sources:
 *   HYG Database v3 (CC BY-SA 4.0): https://github.com/astronexus/HYG-Database
 *   Input CSV columns (hygdata_v3.csv):
 *     id, hip, hd, hr, gl, bf, proper, ra, dec, dist, pmra, pmdec,
 *     rv, mag, absmag, spect, ci, x, y, z, vx, vy, vz,
 *     rarad, decrad, pmrarad, pmdecrad, bayer, flam, con,
 *     comp, comp_primary, base, lum, var, var_min, var_max
 *
 * Columns used: id(0), hip(1), proper(6), ra(7), dec(8), mag(13), ci(16), bayer(27), con(29)
 *
 * Output format (compact columnar array):
 *   Each star: [id, ra, dec, mag, bv, name, bayer, con]
 *   - id:    HYG id (integer)
 *   - ra:    RA in hours, 4 decimal places
 *   - dec:   Dec in degrees, 3 decimal places
 *   - mag:   magnitude, 2 decimal places
 *   - bv:    B-V color index, 2 decimal places (null if missing)
 *   - name:  proper name or null
 *   - bayer: Bayer designation or null
 *   - con:   IAU 3-letter constellation code or null
 *
 * Usage:
 *   # Download HYG CSV first:
 *   curl -L https://raw.githubusercontent.com/astronexus/HYG-Database/master/hygdata_v3.csv -o scripts/hygdata_v3.csv
 *   node scripts/build_data.js
 *
 * Output files: data/stars_bright.json (mag <= 6.5), data/stars_faint.json (6.5 < mag <= 8.0)
 */

import { createReadStream } from 'fs';
import { createInterface }  from 'readline';
import { writeFileSync }     from 'fs';
import { join }              from 'path';

const INPUT  = join(new URL('.', import.meta.url).pathname, 'hygdata_v3.csv');
const OUT_B  = join(new URL('.', import.meta.url).pathname, '../data/stars_bright.json');
const OUT_F  = join(new URL('.', import.meta.url).pathname, '../data/stars_faint.json');

const MAG_BRIGHT = 6.5;
const MAG_FAINT  = 8.0;

const bright = [], faint = [];
let header = true;

const rl = createInterface({ input: createReadStream(INPUT), crlfDelay: Infinity });

rl.on('line', (line) => {
  if (header) { header = false; return; }
  const cols = line.split(',');

  const id    = parseInt(cols[0], 10);
  const hip   = cols[1] ? parseInt(cols[1], 10) : null;
  const name  = cols[6]?.trim() || null;
  const ra    = parseFloat(cols[7]);
  const dec   = parseFloat(cols[8]);
  const mag   = parseFloat(cols[13]);
  const bv    = cols[16]?.trim() ? parseFloat(cols[16]) : null;
  const bayer = cols[27]?.trim() || null;
  const con   = cols[29]?.trim() || null;

  if (isNaN(mag) || isNaN(ra) || isNaN(dec)) return;
  if (mag > MAG_FAINT) return;

  // Round to compact representation
  const star = [
    id,
    Math.round(ra  * 10000) / 10000,
    Math.round(dec * 1000)  / 1000,
    Math.round(mag * 100)   / 100,
    bv !== null ? Math.round(bv * 100) / 100 : null,
    name  || null,
    bayer || null,
    con   || null,
  ];

  if (mag <= MAG_BRIGHT) bright.push(star);
  else                   faint.push(star);
});

rl.on('close', () => {
  // Sort by magnitude (brightest first)
  bright.sort((a, b) => a[3] - b[3]);
  faint.sort((a, b)  => a[3] - b[3]);

  writeFileSync(OUT_B, JSON.stringify(bright));
  writeFileSync(OUT_F, JSON.stringify(faint));

  console.log(`✓ stars_bright.json: ${bright.length} stars (mag ≤ ${MAG_BRIGHT})`);
  console.log(`✓ stars_faint.json:  ${faint.length} stars (${MAG_BRIGHT} < mag ≤ ${MAG_FAINT})`);
  console.log(`  Total: ${bright.length + faint.length} stars`);

  // File size check
  const sizeB = Buffer.byteLength(JSON.stringify(bright), 'utf-8') / 1e6;
  const sizeF = Buffer.byteLength(JSON.stringify(faint),  'utf-8') / 1e6;
  console.log(`  stars_bright.json: ${sizeB.toFixed(2)} MB`);
  console.log(`  stars_faint.json:  ${sizeF.toFixed(2)} MB`);
  if (sizeB > 3) console.warn('⚠ stars_bright.json > 3 MB — consider trimming fields');
  if (sizeF > 3) console.warn('⚠ stars_faint.json > 3 MB — consider trimming fields');
});
