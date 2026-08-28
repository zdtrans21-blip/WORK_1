const CHEM_ELEMENTS = ['C', 'Si', 'Mn', 'S', 'P', 'Cr', 'Ni', 'Cu'];

function toNumber(str) {
  return parseFloat(String(str).replace(',', '.'));
}

/**
 * Parses a chemistry norm string (as printed in the protocol) into a
 * numeric [min, max] range. Returns null when the string doesn't match any
 * known pattern — deviation cannot be computed for such an element.
 *
 *   "2,6–3,5"        -> { min: 2.6, max: 3.5 }
 *   "не более 0,22"  -> { min: null, max: 0.22 }
 *   "≤0,22"          -> { min: null, max: 0.22 }
 *   "не менее 0,05"  -> { min: 0.05, max: null }
 *   "≥0,05"          -> { min: 0.05, max: null }
 */
function parseNormRange(normRaw) {
  if (normRaw === null || normRaw === undefined) return null;
  const norm = String(normRaw).trim();
  const NUM = '(\\d+(?:[.,]\\d+)?)';

  let m = norm.match(new RegExp(`(?:не\\s*более|≤|<=)\\s*${NUM}`, 'i'));
  if (m) return { min: null, max: toNumber(m[1]) };

  m = norm.match(new RegExp(`(?:не\\s*менее|≥|>=)\\s*${NUM}`, 'i'));
  if (m) return { min: toNumber(m[1]), max: null };

  m = norm.match(new RegExp(`^${NUM}\\s*[-–—]\\s*${NUM}$`));
  if (m) return { min: toNumber(m[1]), max: toNumber(m[2]) };

  return null;
}

/**
 * Compares a fact value against a {min,max} range (either bound may be
 * null for one-sided norms) and returns the Bitrix deviation string.
 */
function computeDeviation(range, fact) {
  if (!range || fact === null || fact === undefined || Number.isNaN(fact)) return null;
  const { min, max } = range;
  if (max !== null && fact > max) {
    return `+${(((fact - max) / max) * 100).toFixed(1)}%`;
  }
  if (min !== null && fact < min) {
    return `-${(((min - fact) / min) * 100).toFixed(1)}%`;
  }
  return 'в норме';
}

function isLowConfidence(confidence) {
  return confidence === null || confidence === undefined || confidence === 'low' || confidence === 'medium';
}

/**
 * Enriches each chemistry element with a computed `dev` deviation string
 * and returns the list of elements whose confidence warrants a warning.
 */
function validateChemistry(chemistry = {}) {
  const enriched = {};
  const warnings = [];

  for (const el of CHEM_ELEMENTS) {
    const entry = chemistry[el] || { norm: null, fact: null, confidence: null };
    const range = parseNormRange(entry.norm);
    const dev = entry.norm === null ? null : computeDeviation(range, entry.fact);
    enriched[el] = { ...entry, dev };
    if (entry.norm !== null && isLowConfidence(entry.confidence)) {
      warnings.push(`chemistry.${el}`);
    }
  }
  return { chemistry: enriched, warnings };
}

/**
 * Checks that every fact code is a member of the norm code set.
 * Returns null when there is no norm to validate against.
 */
function validateCodeSet(normCodes, factCodes) {
  if (!Array.isArray(normCodes) || normCodes.length === 0) return null;
  const normSet = new Set(normCodes);
  const outOfNorm = (factCodes || []).filter((code) => !normSet.has(code));
  if (outOfNorm.length === 0) return 'в норме';
  return `отклонение: код ${outOfNorm.join(', ')} не в норме`;
}

/**
 * Checks one or many fact values against a [min,max] norm range.
 * Accepts a single number or an array of numbers as `factValues`.
 */
function validateRange(normRange, factValues) {
  if (!Array.isArray(normRange) || (normRange[0] === null && normRange[1] === null)) return null;
  const [min, max] = normRange;
  const values = Array.isArray(factValues) ? factValues : [factValues];
  const relevant = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  if (relevant.length === 0) return null;

  const deviations = relevant
    .map((v) => computeDeviation({ min, max }, v))
    .filter((dev) => dev !== 'в норме');

  return deviations.length === 0 ? 'в норме' : deviations.join('; ');
}

const MICRO_CODE_PARAMS = [
  'graphite_form', 'graphite_distribution', 'perlite_type',
  'phoseut_form', 'phoseut_area', 'phoseut_distribution',
  'cementite_content', 'cementite_area',
];
const MICRO_RANGE_PARAMS = {
  graphite_length: 'fact_values',
  graphite_quantity: 'fact_values',
  perlite_content: 'fact_value',
  perlite_dispersion: 'fact_value',
};

/**
 * Computes a status string per microstructure parameter (for logging only —
 * no Bitrix field stores microstructure deviation) and collects warnings
 * for low/missing confidence.
 */
function validateMicrostructure(microstructure = {}) {
  const status = {};
  const warnings = [];

  for (const param of MICRO_CODE_PARAMS) {
    const entry = microstructure[param] || {};
    status[param] = validateCodeSet(entry.norm_codes, entry.fact_codes);
    if (Array.isArray(entry.norm_codes) && entry.norm_codes.length > 0 && isLowConfidence(entry.confidence)) {
      warnings.push(`microstructure.${param}`);
    }
  }

  for (const [param, factKey] of Object.entries(MICRO_RANGE_PARAMS)) {
    const entry = microstructure[param] || {};
    status[param] = validateRange(entry.norm_range, entry[factKey]);
    const hasNorm = Array.isArray(entry.norm_range) && (entry.norm_range[0] !== null || entry.norm_range[1] !== null);
    if (hasNorm && isLowConfidence(entry.confidence)) {
      warnings.push(`microstructure.${param}`);
    }
  }

  return { status, warnings };
}

/**
 * Runs full validation over a parsed LLM recognition result.
 * Returns the chemistry (enriched with `dev`), a status map for
 * microstructure parameters, and the combined list of warning field names.
 */
function validate(recognition) {
  const chemResult = validateChemistry(recognition.chemistry);
  const microResult = validateMicrostructure(recognition.microstructure);

  return {
    chemistry: chemResult.chemistry,
    microstructureStatus: microResult.status,
    warnings: [...chemResult.warnings, ...microResult.warnings],
  };
}

module.exports = {
  validate,
  parseNormRange,
  computeDeviation,
  validateCodeSet,
  validateRange,
};
