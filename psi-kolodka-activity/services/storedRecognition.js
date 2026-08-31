const { CHEM_ELEMENTS, MICRO_FIELD_MAP } = require('./fieldMapper');

function toNumberArray(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((v) => Number(v))
    .filter((n) => !Number.isNaN(n));
}

/**
 * Reconstructs a { chemistry, microstructure } shape — the same one
 * validate()/buildRows() consume for a fresh LLM recognition — directly
 * from what's currently stored on the smart-process item. Used by the
 * recalc activity, which has no LLM output of its own to work from.
 *
 * Range params (graphite_length/quantity, perlite_content/dispersion) are
 * only reconstructed when both bounds are stored — a one-sided norm loses
 * its null bound on write (see fieldMapper's setArrayIfPresent), so a
 * single leftover number can't be told apart as min or max.
 */
function readStoredRecognition(item) {
  const chemistry = {};
  for (const el of CHEM_ELEMENTS) {
    const upper = el.toUpperCase();
    const norm = item[`UF_CRM_66_CHEM_${upper}_NORM`];
    const factRaw = item[`UF_CRM_66_CHEM_${upper}_FACT`];
    chemistry[el] = {
      norm: norm === null || norm === undefined || norm === '' ? null : norm,
      fact: factRaw === null || factRaw === undefined ? null : parseFloat(factRaw),
      confidence: 'high',
    };
  }

  const microstructure = {};
  for (const { param, normKey, normField, factKey, factField } of MICRO_FIELD_MAP) {
    let norm;
    if (normKey === 'norm_codes') {
      norm = toNumberArray(item[normField]);
    } else {
      const range = toNumberArray(item[normField]);
      norm = range.length === 2 ? range : [null, null];
    }

    let fact;
    if (factKey === 'fact_value') {
      const values = toNumberArray(item[factField]);
      fact = values.length > 0 ? values[0] : null;
    } else {
      fact = toNumberArray(item[factField]);
    }

    microstructure[param] = { [normKey]: norm, [factKey]: fact, confidence: 'high' };
  }

  return { chemistry, microstructure };
}

module.exports = { readStoredRecognition };
