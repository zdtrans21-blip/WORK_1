const { CHEM_ELEMENTS, MICRO_FIELD_MAP } = require('./fieldMapper');

const CHEM_LABELS = {
  C: 'Химсостав, C',
  Si: 'Химсостав, Si',
  Mn: 'Химсостав, Mn',
  S: 'Химсостав, S',
  P: 'Химсостав, P',
  Cr: 'Химсостав, Cr',
  Ni: 'Химсостав, Ni',
  Cu: 'Химсостав, Cu',
  Ca: 'Химсостав, Ca',
};

const MICRO_CODE_LABELS = {
  graphite_form: 'Графит, форма (ПГф)',
  graphite_distribution: 'Графит, распределение (ПГр)',
  perlite_type: 'Перлит, вид (ПТ)',
  phoseut_form: 'Фосфидная эвтектика, форма',
  phoseut_area: 'Фосфидная эвтектика, площадь',
  phoseut_distribution: 'Фосфидная эвтектика, распределение',
  cementite_content: 'Цементит, содержание',
  cementite_area: 'Цементит, площадь',
};

// param -> [label, factKey] — the microstructure entry's fact value can be a
// single number (perlite_content/perlite_dispersion) or an array (the rest).
const MICRO_RANGE_LABELS = {
  graphite_length: ['Графит, длина включений (мкм)', 'fact_values'],
  graphite_quantity: ['Графит, количество (%)', 'fact_values'],
  perlite_content: ['Перлит, содержание (%)', 'fact_value'],
  perlite_dispersion: ['Перлит, дисперсность (мкм)', 'fact_value'],
};

function isDeviation(dev) {
  return dev !== null && dev !== undefined && dev !== 'в норме';
}

function formatCodes(codes) {
  return Array.isArray(codes) && codes.length > 0 ? codes.join(', ') : '—';
}

function formatRange([min, max]) {
  if (min === null && max === null) return '—';
  if (min === null) return `не более ${max}`;
  if (max === null) return `не менее ${min}`;
  return `${min}–${max}`;
}

function formatValues(values) {
  const arr = Array.isArray(values) ? values : [values];
  const clean = arr.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  return clean.length > 0 ? clean.join(', ') : '—';
}

/**
 * Flattens the validated chemistry + microstructure result into one list of
 * { label, norm, fact, dev } rows — skipping any parameter whose norm is
 * absent from the protocol (nothing to compare against).
 */
function buildRows({ chemistry, microstructure, microstructureStatus }) {
  const rows = [];

  for (const [el, label] of Object.entries(CHEM_LABELS)) {
    const entry = chemistry?.[el];
    if (!entry || entry.norm === null || entry.norm === undefined) continue;
    rows.push({
      label,
      norm: entry.norm,
      fact: entry.fact !== null && entry.fact !== undefined ? entry.fact : '—',
      dev: entry.dev,
    });
  }

  for (const [param, label] of Object.entries(MICRO_CODE_LABELS)) {
    const entry = microstructure?.[param];
    if (!entry || !Array.isArray(entry.norm_codes) || entry.norm_codes.length === 0) continue;
    rows.push({
      label,
      norm: formatCodes(entry.norm_codes),
      fact: formatCodes(entry.fact_codes),
      dev: microstructureStatus?.[param] ?? null,
    });
  }

  for (const [param, [label, factKey]] of Object.entries(MICRO_RANGE_LABELS)) {
    const entry = microstructure?.[param];
    if (!entry || !Array.isArray(entry.norm_range) || (entry.norm_range[0] === null && entry.norm_range[1] === null)) continue;
    rows.push({
      label,
      norm: formatRange(entry.norm_range),
      fact: formatValues(entry[factKey]),
      dev: microstructureStatus?.[param] ?? null,
    });
  }

  return rows;
}

/** Renders one row as plain text: "✅/⚠️ Label: норма X, факт Y, отклонение: ...". */
function renderRow(row) {
  const devText = row.dev === null || row.dev === undefined ? '—' : row.dev;
  const icon = row.dev === null || row.dev === undefined ? 'ℹ️' : isDeviation(row.dev) ? '⚠️' : '✅';
  return `${icon} ${row.label}: норма ${row.norm}, факт ${row.fact}, отклонение: ${devText}`;
}

/** Full report — every parameter that has a norm, one per line (plain text). */
function buildFullReport(rows) {
  if (rows.length === 0) return '';
  return rows.map(renderRow).join('\n');
}

/** Deviations-only report — just the parameters that are out of norm. */
function buildDeviationsReport(rows) {
  const deviated = rows.filter((row) => isDeviation(row.dev));
  if (deviated.length === 0) return '✅ Отклонений не выявлено';
  return deviated.map(renderRow).join('\n');
}

function formatFactValue(v) {
  if (v === null || v === undefined) return '—';
  return formatValues(v);
}

function sameValue(a, b) {
  const norm = (v) => {
    if (v === null || v === undefined || v === '') return '';
    if (Array.isArray(v)) return v.map(Number).join(',');
    return String(v);
  };
  return norm(a) === norm(b);
}

/**
 * Compares the item's state BEFORE this run (`oldItem`, fetched at the
 * start of recognizeAndFillItem, before any writes) against the freshly
 * recognized fact + recomputed deviation — one line per parameter whose
 * fact or deviation actually changed. Only covers parameters that have a
 * real Bitrix `_DEV` field to compare against: the 8 chemistry elements and
 * the 5 phosphide-eutectic/cementite microstructure params.
 */
function buildChangesReport({ oldItem, chemistry, microstructure, microstructureStatus }) {
  const lines = [];

  for (const el of CHEM_ELEMENTS) {
    const entry = chemistry?.[el];
    if (!entry || entry.norm === null || entry.norm === undefined) continue;
    const upper = el.toUpperCase();
    const oldFact = oldItem[`UF_CRM_66_CHEM_${upper}_FACT`];
    const oldDev = oldItem[`UF_CRM_66_CHEM_${upper}_DEV`];
    const newFact = entry.fact;
    const newDev = entry.dev;
    if (sameValue(oldFact, newFact) && sameValue(oldDev, newDev)) continue;
    lines.push(
      `${CHEM_LABELS[el]}: факт было ${formatFactValue(oldFact)} → занесено ${formatFactValue(newFact)}; `
      + `отклонение было ${oldDev ?? '—'} → стало ${newDev ?? '—'}`,
    );
  }

  for (const { param, factKey, factField, devField } of MICRO_FIELD_MAP) {
    if (!devField) continue; // no stored deviation for this param — nothing to compare
    const entry = microstructure?.[param];
    const newFact = entry?.[factKey];
    const newDev = microstructureStatus?.[param] ?? null;
    const oldFact = oldItem[factField];
    const oldDev = oldItem[devField];
    if (sameValue(oldFact, newFact) && sameValue(oldDev, newDev)) continue;
    lines.push(
      `${MICRO_CODE_LABELS[param]}: факт было ${formatFactValue(oldFact)} → занесено ${formatFactValue(newFact)}; `
      + `отклонение было ${oldDev ?? '—'} → стало ${newDev ?? '—'}`,
    );
  }

  if (lines.length === 0) return 'Изменений нет';
  return lines.join('\n');
}

module.exports = { buildRows, buildFullReport, buildDeviationsReport, buildChangesReport };
