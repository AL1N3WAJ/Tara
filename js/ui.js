/**
 * ui.js — UI construction, event wiring, info panel, names-editor modal
 *
 * This module reads/writes the DOM; keep astronomy logic in astro.js etc.
 */

import { setPrintMode } from './theme.js';
import { BORTLE_PRESETS, nelm as bortleNelm } from './visibility.js';
import { getLabel, allNamesForEditor, setUserBn, clearUserBn, exportMergedNames, importNames } from './names.js';
import { toBanglaNum, toBanglaDate } from './astro.js';
import { pushHash, DEFAULT_LAYERS } from './urlstate.js';
import { exportSingle, exportMonth, exportYear, shareChart } from './export.js';

// ─── i18n ─────────────────────────────────────────────────────────────────────
let _i18n = { en: {}, bn: {} };
let _uiLang = 'en';

export async function loadI18n(base = './') {
  const [en, bn] = await Promise.all([
    fetch(new URL('js/i18n/en.json', base).href).then(r => r.json()),
    fetch(new URL('js/i18n/bn.json', base).href).then(r => r.json()),
  ]);
  _i18n = { en, bn };
}

export function t(key) {
  return (_i18n[_uiLang]?.[key]) || (_i18n['en']?.[key]) || key;
}

export function setUiLang(lang) {
  _uiLang = lang;
  document.documentElement.lang = lang === 'bn' ? 'bn' : 'en';
  _applyI18n();
}

function _applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
}

// ─── Location presets ─────────────────────────────────────────────────────────
let _locations = [];

export function setLocations(locs) {
  _locations = locs;
  _populateLocationSelect();
}

function _populateLocationSelect() {
  const sel = document.getElementById('location-select');
  if (!sel) return;
  sel.innerHTML = '';
  for (const loc of _locations) {
    const opt = document.createElement('option');
    opt.value       = loc.id;
    opt.textContent = `${loc.nameBn || loc.name} (${loc.name})`;
    sel.appendChild(opt);
  }
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = t('locationCustom');
  sel.appendChild(custom);
}

// ─── Bortle select ────────────────────────────────────────────────────────────

export function populateBortleSelect() {
  const sel = document.getElementById('bortle-select');
  if (!sel) return;
  sel.innerHTML = '';
  for (const p of BORTLE_PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.bortle;
    opt.textContent = `${p.bortle}: ${p.label} (NELM ${p.nelm})`;
    sel.appendChild(opt);
  }
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = t('bortleCustom');
  sel.appendChild(custom);
}

// ─── Info panel ───────────────────────────────────────────────────────────────

export function updateInfoPanel(state, computed) {
  const { sunAlt, moonAlt, moonPhaseData, twilight, bortlePreset, polarisMult } = computed;

  _setText('info-sun-rise',     _fmtTime(computed.sunRise, state));
  _setText('info-sun-set',      _fmtTime(computed.sunSet, state));
  _setText('info-twilight',     t('twilight_' + twilight));
  _setText('info-moon-rise',    _fmtTime(computed.moonRise, state));
  _setText('info-moon-set',     _fmtTime(computed.moonSet, state));
  _setText('info-moon-phase',   state.lang === 'bn' ? moonPhaseData.phaseBn : moonPhaseData.phaseName);
  _setText('info-moon-pct',     `${Math.round(moonPhaseData.fraction * 100)}%`);
  _setText('info-polaris-alt',  `${polarisMult.toFixed(1)}°`);
  _setText('info-nelm',         bortleNelm(state.bortle).toFixed(1));
  _setText('info-bortle',       `${state.bortle}`);
}

function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _fmtTime(utcHours, state) {
  if (utcHours === null || utcHours === undefined) return '—';
  const bst = (utcHours + 6) % 24;
  const h = Math.floor(bst);
  const m = Math.round((bst - h) * 60);
  if (state.bnNums) return `${toBanglaNum(h)}:${toBanglaNum(String(m).padStart(2, '0'))}`;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ─── Visible tonight panel ────────────────────────────────────────────────────

export function updateVisibleTonightPanel(constellations, starMap, state, computed) {
  const container = document.getElementById('visible-tonight');
  if (!container) return;

  const { jd, lat, lon, baseNelm, k, moonPen } = computed;
  container.innerHTML = '';

  const rows = [];
  for (const con of (constellations || [])) {
    if (!con.lines || !con.ra) continue;
    // Check if above horizon
    const { alt } = { alt: 10 }; // simplified: use centre point
    if (alt < 5) continue;

    const rts   = computed.conRTS?.[con.id] || {};
    const stat  = computed.conStatus?.[con.id] || { status: 'hidden', ratio: 0 };
    if (stat.status === 'hidden') continue;

    rows.push({ con, stat, rts });
  }

  rows.sort((a, b) => (b.stat.ratio - a.stat.ratio));

  for (const { con, stat, rts } of rows) {
    const div = document.createElement('div');
    div.className = `vt-row vt-${stat.status}`;

    const labels = getLabel(state.lang, con.name, 'constellations');
    const badge  = stat.status === 'full'
      ? `<span class="badge badge-full">${t('full')}</span>`
      : `<span class="badge badge-partial">${t('partial')}</span>`;

    div.innerHTML = `
      <span class="vt-name">${labels[0]}<small>${labels[1] || ''}</small></span>
      ${badge}
      <span class="vt-time">${rts.rise != null ? _fmtTime(rts.rise, state) : ''} – ${rts.set != null ? _fmtTime(rts.set, state) : ''}</span>
    `;
    container.appendChild(div);
  }

  if (!rows.length) {
    container.innerHTML = `<p class="vt-empty">${t('noVisibleConstellations')}</p>`;
  }
}

// ─── Object info card (tap/click) ─────────────────────────────────────────────

export function showInfoCard(obj, state, computed) {
  const card = document.getElementById('info-card');
  if (!card) return;

  const labels = getLabel(state.lang, obj.name, obj.category);
  const baseNelm = bortleNelm(state.bortle);

  card.innerHTML = `
    <button class="info-card-close" aria-label="Close">×</button>
    <h3>${labels[0]}</h3>
    ${labels[1] ? `<p class="info-card-en">${labels[1]}</p>` : ''}
    <dl>
      <dt>${t('magnitude')}</dt>  <dd>${obj.mag?.toFixed(2) ?? '—'}</dd>
      <dt>${t('altitude')}</dt>   <dd>${obj.alt?.toFixed(1) ?? '—'}°</dd>
      <dt>${t('azimuth')}</dt>    <dd>${obj.az?.toFixed(1) ?? '—'}°</dd>
      ${obj.con ? `<dt>${t('constellation')}</dt><dd>${obj.con}</dd>` : ''}
      <dt>${t('visible')}</dt>
      <dd>${obj.mag <= baseNelm ? t('yes') : t('no')} (${t('atBortle')} ${state.bortle})</dd>
    </dl>
  `;
  card.style.display = 'block';
  card.querySelector('.info-card-close').onclick = () => { card.style.display = 'none'; };
}

// ─── Names editor modal ───────────────────────────────────────────────────────

export function openNamesEditor(state) {
  let modal = document.getElementById('names-editor-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'names-editor-modal';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
  }

  const entries = allNamesForEditor();
  const renderList = (filter) => {
    const rows = entries.filter(e =>
      !filter || (!e.shippedBn && !e.userBn)
    );
    return rows.map(e => `
      <tr data-cat="${e.category}" data-key="${e.englishKey}">
        <td>${e.category}</td>
        <td>${e.englishKey}</td>
        <td>${e.shippedBn || '<em>—</em>'}</td>
        <td><input type="text" class="bn-input" value="${e.userBn}" placeholder="Bangla name…"/></td>
        <td><input type="checkbox" class="verified-check" ${e.verified ? 'checked' : ''}/></td>
        <td><button class="btn-clear-bn" title="Revert">↩</button></td>
      </tr>
    `).join('');
  };

  modal.innerHTML = `
    <div class="modal-box modal-wide">
      <div class="modal-header">
        <h2 data-i18n="namesEditorTitle">Names Editor</h2>
        <button class="modal-close" aria-label="Close">×</button>
      </div>
      <div class="modal-toolbar">
        <label><input type="checkbox" id="ne-missing-filter"/> ${t('showMissingOnly')}</label>
        <button id="ne-import" class="btn btn-sm">${t('importJSON')}</button>
        <button id="ne-export" class="btn btn-sm">${t('exportJSON')}</button>
        <button id="ne-export-pr" class="btn btn-primary btn-sm">${t('exportForPR')}</button>
      </div>
      <div class="modal-body">
        <table class="names-table">
          <thead><tr>
            <th>${t('category')}</th>
            <th>${t('english')}</th>
            <th>${t('shipped')}</th>
            <th>${t('bangla')}</th>
            <th>${t('verified')}</th>
            <th></th>
          </tr></thead>
          <tbody id="ne-tbody">${renderList(false)}</tbody>
        </table>
      </div>
    </div>
  `;

  _applyI18n();

  modal.querySelector('.modal-close').onclick   = () => { modal.style.display = 'none'; };
  modal.querySelector('#ne-missing-filter').onchange = (e) => {
    modal.querySelector('#ne-tbody').innerHTML = renderList(e.target.checked);
    _bindNameEditorRows(modal);
  };

  modal.querySelector('#ne-export').onclick = () => {
    const json = JSON.stringify(exportMergedNames(), null, 2);
    _download(new Blob([json], { type: 'application/json' }), 'names_bn.json');
  };
  modal.querySelector('#ne-export-pr').onclick = () => {
    const json = JSON.stringify(exportMergedNames(), null, 2);
    _download(new Blob([json], { type: 'application/json' }), 'names_bn.json');
  };
  modal.querySelector('#ne-import').onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json';
    inp.onchange = async () => {
      const text = await inp.files[0].text();
      importNames(JSON.parse(text));
      openNamesEditor(state);  // re-render
    };
    inp.click();
  };

  _bindNameEditorRows(modal);
  modal.style.display = 'flex';
}

function _bindNameEditorRows(modal) {
  modal.querySelectorAll('#ne-tbody tr').forEach(row => {
    const cat = row.dataset.cat;
    const key = row.dataset.key;
    const inp = row.querySelector('.bn-input');
    const chk = row.querySelector('.verified-check');
    const clr = row.querySelector('.btn-clear-bn');

    if (inp) inp.addEventListener('change', () => {
      setUserBn(cat, key, inp.value.trim(), chk?.checked || false);
    });
    if (chk) chk.addEventListener('change', () => {
      setUserBn(cat, key, inp?.value.trim() || '', chk.checked);
    });
    if (clr) clr.addEventListener('click', () => {
      clearUserBn(cat, key);
      inp && (inp.value = '');
    });
  });
}

// ─── Search ───────────────────────────────────────────────────────────────────

export function setupSearch(data, state, onHighlight) {
  const inp = document.getElementById('search-input');
  if (!inp) return;

  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { onHighlight(null); return; }

    // Search stars
    const star = (data.stars || []).find(s =>
      s[5]?.toLowerCase().includes(q)
    );
    if (star) { onHighlight({ type: 'star', obj: star }); return; }

    // Search constellations
    const con = (data.constellations || []).find(c =>
      c.name?.toLowerCase().includes(q) || c.id?.toLowerCase().includes(q)
    );
    if (con) { onHighlight({ type: 'constellation', obj: con }); return; }

    onHighlight(null);
  });
}

// ─── Layer toggles ────────────────────────────────────────────────────────────

export function setupLayerToggles(state, onChange) {
  const container = document.getElementById('layer-toggles');
  if (!container) return;

  const layerDefs = [
    { id: 'stars',         label: 'Stars',               labelKey: 'layerStars' },
    { id: 'starColors',    label: 'Star Colors',          labelKey: 'layerStarColors' },
    { id: 'constellLines', label: 'Constellation Lines',  labelKey: 'layerConstLines' },
    { id: 'constellNames', label: 'Constellation Names',  labelKey: 'layerConstNames' },
    { id: 'starNames',     label: 'Star Names',           labelKey: 'layerStarNames' },
    { id: 'boundaries',   label: 'Boundaries',            labelKey: 'layerBoundaries' },
    { id: 'grid',          label: 'Alt/Az Grid',          labelKey: 'layerGrid' },
    { id: 'ecliptic',      label: 'Ecliptic',             labelKey: 'layerEcliptic' },
    { id: 'equator',       label: 'Equator',              labelKey: 'layerEquator' },
    { id: 'milkyway',      label: 'Milky Way',            labelKey: 'layerMilkyWay' },
    { id: 'planets',       label: 'Planets',              labelKey: 'layerPlanets' },
    { id: 'moon',          label: 'Moon',                 labelKey: 'layerMoon' },
    { id: 'sun',           label: 'Sun',                  labelKey: 'layerSun' },
    { id: 'dso',           label: 'Deep Sky Objects',     labelKey: 'layerDSO' },
    { id: 'compass',       label: 'Compass',              labelKey: 'layerCompass' },
    { id: 'horizon',       label: 'Horizon',              labelKey: 'layerHorizon' },
  ];

  container.innerHTML = '';
  for (const { id, labelKey } of layerDefs) {
    const label  = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type    = 'checkbox';
    checkbox.id      = `layer-${id}`;
    checkbox.checked = (state.layers || DEFAULT_LAYERS).includes(id);
    checkbox.addEventListener('change', () => {
      const active = Array.from(container.querySelectorAll('input[type=checkbox]'))
        .filter(c => c.checked).map(c => c.id.replace('layer-', ''));
      state.layers = active;
      onChange(state);
    });
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(' '));
    const span = document.createElement('span');
    span.dataset.i18n = labelKey;
    span.textContent = t(labelKey) || labelKey;
    label.appendChild(span);
    container.appendChild(label);
  }
}

// ─── Export panel ─────────────────────────────────────────────────────────────

export function setupExportPanel(state, data, locations) {
  const form = document.getElementById('export-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd    = new FormData(form);
    const scope = fd.get('export-scope');
    const fmt   = fd.get('export-format') || 'png';
    const res   = parseInt(fd.get('export-res') || '2048', 10);
    const size  = { w: res, h: res };
    const locName = locations.find(l => l.id === state.loc)?.name || '';

    const printMode = fd.get('export-print') === 'on';
    const bar    = document.getElementById('export-progress');
    const prog   = document.getElementById('export-progress-bar');
    const cancel = { cancel: false };
    bar && (bar.style.display = 'block');

    const onProgress = (p) => {
      if (prog) prog.style.width = `${Math.round(p * 100)}%`;
    };

    setPrintMode(printMode);
    try {
      if (scope === 'single') {
        await exportSingle(state, data, { size, format: fmt, locationName: locName });
      } else if (scope === 'month') {
        const yr   = parseInt(fd.get('export-year'), 10);
        const mo   = parseInt(fd.get('export-month'), 10);
        const freq = fd.get('export-freq') || 'everynight';
        await exportMonth(state, yr, mo, freq, data, { size, format: fmt, locationName: locName, onProgress, cancelRef: cancel });
      } else if (scope === 'year') {
        const yr = parseInt(fd.get('export-year'), 10);
        await exportYear(state, yr, data, { size, format: fmt, locationName: locName, onProgress });
      }
    } finally {
      setPrintMode(false);
      bar && (bar.style.display = 'none');
    }
  });
}

// ─── Toast notifications ──────────────────────────────────────────────────────

export function showToast(message, duration = 3000, action = null) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.onclick     = action.fn;
    toast.appendChild(btn);
  }
  toast.className = 'toast toast-show';
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.className = 'toast'; }, duration);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}
