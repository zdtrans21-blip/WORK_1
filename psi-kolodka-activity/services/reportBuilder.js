const CHEM_LABELS = {
  C: 'Химсостав, C',
  Si: 'Химсостав, Si',
  Mn: 'Химсостав, Mn',
  S: 'Химсостав, S',
  P: 'Химсостав, P',
  Cr: 'Химсостав, Cr',
  Ni: 'Химсостав, Ni',
  Cu: 'Химсостав, Cu',
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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

/** Renders one row as "Label: норма X, факт Y, отклонение: <b>...</b>". */
function renderRow(row) {
  const devText = row.dev === null || row.dev === undefined ? '—' : escapeHtml(row.dev);
  const devHtml = isDeviation(row.dev)
    ? `<b style="color:red">${devText}</b>`
    : `<b>${devText}</b>`;
  return `${escapeHtml(row.label)}: норма ${escapeHtml(String(row.norm))}, факт ${escapeHtml(String(row.fact))}, отклонение: ${devHtml}`;
}

/** Full report — every parameter that has a norm, one per line (HTML, <br> separated). */
function buildFullReport(rows) {
  if (rows.length === 0) return '';
  return rows.map(renderRow).join('<br>\n');
}

/** Deviations-only report — just the parameters that are out of norm. */
function buildDeviationsReport(rows) {
  const deviated = rows.filter((row) => isDeviation(row.dev));
  if (deviated.length === 0) return 'Отклонений не выявлено';
  return deviated.map(renderRow).join('<br>\n');
}

module.exports = { buildRows, buildFullReport, buildDeviationsReport };
