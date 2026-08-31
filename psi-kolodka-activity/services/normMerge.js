const { CHEM_ELEMENTS, MICRO_FIELD_MAP } = require('./fieldMapper');

function hasValue(v) {
  if (v === null || v === undefined || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function toNumberArray(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((v) => Number(v))
    .filter((n) => !Number.isNaN(n));
}

/**
 * Reconciles this run's freshly recognized chemistry/microstructure with
 * whatever the smart-process item already has stored, protecting `_NORM`
 * from being overwritten once it's already set — a norm typed in from the
 * protocol (or hand-corrected after a bad OCR read) shouldn't flip back to
 * whatever the LLM reads this time. `_FACT` always takes the fresh value.
 *
 * Returns data shaped for validate()/buildRows() (deviation is computed
 * against whichever norm will actually end up stored) plus the sets of
 * locked element/param names, so fieldMapper knows which `_NORM` fields to
 * leave out of the crm.item.update payload.
 */
function mergeWithExistingNorms(item, recognized) {
  const chemistry = {};
  const chemNormLocked = new Set();

  for (const el of CHEM_ELEMENTS) {
    const upper = el.toUpperCase();
    const existingNorm = item[`UF_CRM_66_CHEM_${upper}_NORM`];
    const rec = recognized.chemistry?.[el] || {};
    const locked = hasValue(existingNorm);
    if (locked) chemNormLocked.add(el);
    chemistry[el] = {
      norm: locked ? existingNorm : (rec.norm ?? null),
      fact: rec.fact ?? null,
      confidence: rec.confidence ?? null,
    };
  }

  const microstructure = {};
  const microNormLocked = new Set();

  for (const { param, normKey, normField, factKey } of MICRO_FIELD_MAP) {
    const existingNormRaw = item[normField];
    const rec = recognized.microstructure?.[param] || {};
    let locked = false;
    let norm;

    if (normKey === 'norm_codes') {
      const existingCodes = toNumberArray(existingNormRaw);
      locked = existingCodes.length > 0;
      norm = locked ? existingCodes : (rec.norm_codes ?? []);
    } else {
      // norm_range — only lock on a fully-stored two-sided range. A
      // one-sided range ("не более X") loses its null bound when written
      // (fieldMapper's setArrayIfPresent drops nulls), so a single stored
      // number can't be told apart as min or max — don't guess, just let
      // this run's recognition refresh it like before.
      const existingRange = Array.isArray(existingNormRaw) ? existingNormRaw.map(Number) : [];
      locked = existingRange.length === 2 && existingRange.every((n) => !Number.isNaN(n));
      norm = locked ? existingRange : (rec.norm_range ?? [null, null]);
    }

    if (locked) microNormLocked.add(param);
    microstructure[param] = {
      [normKey]: norm,
      [factKey]: rec[factKey],
      confidence: rec.confidence ?? null,
    };
  }

  return { chemistry, microstructure, chemNormLocked, microNormLocked };
}

module.exports = { mergeWithExistingNorms };
