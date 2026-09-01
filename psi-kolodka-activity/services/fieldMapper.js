const CHEM_ELEMENTS = ['C', 'Si', 'Mn', 'S', 'P', 'Cr', 'Ni', 'Cu', 'Ca'];

/** "16.12.2025" -> "2025-12-16" (Bitrix date field format). Returns null if unparseable. */
function toBitrixDate(ddmmyyyy) {
  if (!ddmmyyyy) return null;
  const m = String(ddmmyyyy).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function setIfPresent(fields, code, value) {
  if (value === null || value === undefined) return;
  fields[code] = value;
}

function setNumberIfPresent(fields, code, value) {
  if (value === null || value === undefined) return;
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  if (!Number.isNaN(num)) fields[code] = num;
}

function mapGeneral(general, fields) {
  if (!general) return;
  setIfPresent(fields, 'UF_CRM_66_PRODUCT_NAME', general.product_name);
  setIfPresent(fields, 'UF_CRM_66_PROTOCOL_NUMBER', general.protocol_number);
  setIfPresent(fields, 'UF_CRM_66_PROTOCOL_DATE', toBitrixDate(general.protocol_date));
  setIfPresent(fields, 'UF_CRM_66_DRAWING_NUMBER', general.drawing_number);
  setIfPresent(fields, 'UF_CRM_66_BATCH_NUMBER', general.batch_number);
  setIfPresent(fields, 'UF_CRM_66_MELT_NUMBER', general.melt_number);
  setIfPresent(fields, 'UF_CRM_66_MATERIAL', general.material);
  setNumberIfPresent(fields, 'UF_CRM_66_QUANTITY', general.quantity);
}

function mapChemistry(chemistry, fields, normLocked) {
  if (!chemistry) return;
  for (const el of CHEM_ELEMENTS) {
    const entry = chemistry[el];
    if (!entry || entry.norm === null || entry.norm === undefined) continue;
    const upper = el.toUpperCase();
    // Norm is protected once the item already has one — see normMerge.js.
    // Fact and deviation are always refreshed from this recognition run.
    if (!normLocked?.has(el)) {
      setIfPresent(fields, `UF_CRM_66_CHEM_${upper}_NORM`, entry.norm);
    }
    setNumberIfPresent(fields, `UF_CRM_66_CHEM_${upper}_FACT`, entry.fact);
    setIfPresent(fields, `UF_CRM_66_CHEM_${upper}_DEV`, entry.dev);
  }
}

const MICRO_FIELD_MAP = [
  { param: 'graphite_form', normKey: 'norm_codes', normField: 'UF_CRM_66_MICRO_GRAPH_FORM_NORM', factKey: 'fact_codes', factField: 'UF_CRM_66_MICRO_GRAPH_FORM_FACT' },
  { param: 'graphite_length', normKey: 'norm_range', normField: 'UF_CRM_66_MICRO_GRAPH_LEN_NORM', factKey: 'fact_values', factField: 'UF_CRM_66_MICRO_GRAPH_LEN_FACT' },
  { param: 'graphite_distribution', normKey: 'norm_codes', normField: 'UF_CRM_66_MICRO_GRAPH_DIST_NORM', factKey: 'fact_codes', factField: 'UF_CRM_66_MICRO_GRAPH_DIST_FACT' },
  { param: 'graphite_quantity', normKey: 'norm_range', normField: 'UF_CRM_66_MICRO_GRAPH_QTY_NORM', factKey: 'fact_values', factField: 'UF_CRM_66_MICRO_GRAPH_QTY_FACT' },
  { param: 'perlite_type', normKey: 'norm_codes', normField: 'UF_CRM_66_MICRO_PERL_TYPE_NORM', factKey: 'fact_codes', factField: 'UF_CRM_66_MICRO_PERL_TYPE_FACT' },
  { param: 'perlite_content', normKey: 'norm_range', normField: 'UF_CRM_66_MICRO_PERL_PCT_NORM', factKey: 'fact_value', factField: 'UF_CRM_66_MICRO_PERL_PCT_FACT' },
  { param: 'perlite_dispersion', normKey: 'norm_range', normField: 'UF_CRM_66_MICRO_PERL_DISPER_NORM', factKey: 'fact_value', factField: 'UF_CRM_66_MICRO_PERL_DISPER_FACT' },
  // Below: code-set params with a Bitrix deviation field (unlike the three
  // code-set params above, which have no _DEV field in the smart-process).
  { param: 'phoseut_form', normKey: 'norm_codes', normField: 'UF_CRM_66_MICRO_PHOSEUT_FORM_NORM', factKey: 'fact_codes', factField: 'UF_CRM_66_MICRO_PHOSEUT_FORM_FACT', devField: 'UF_CRM_66_MICRO_PHOSEUT_FORM_DEV' },
  { param: 'phoseut_area', normKey: 'norm_codes', normField: 'UF_CRM_66_MICRO_PHOSEUT_AREA_NORM', factKey: 'fact_codes', factField: 'UF_CRM_66_MICRO_PHOSEUT_AREA_FACT', devField: 'UF_CRM_66_MICRO_PHOSEUT_AREA_DEV' },
  { param: 'phoseut_distribution', normKey: 'norm_codes', normField: 'UF_CRM_66_MICRO_PHOSEUT_DIST_NORM', factKey: 'fact_codes', factField: 'UF_CRM_66_MICRO_PHOSEUT_DIST_FACT', devField: 'UF_CRM_66_MICRO_PHOSEUT_DIST_DEV' },
  { param: 'cementite_content', normKey: 'norm_codes', normField: 'UF_CRM_66_MICRO_CEMENT_PCT_NORM', factKey: 'fact_codes', factField: 'UF_CRM_66_MICRO_CEMENT_PCT_FACT', devField: 'UF_CRM_66_MICRO_CEMENT_PCT_DEV' },
  { param: 'cementite_area', normKey: 'norm_codes', normField: 'UF_CRM_66_MICRO_CEMENT_AREA_NORM', factKey: 'fact_codes', factField: 'UF_CRM_66_MICRO_CEMENT_AREA_FACT', devField: 'UF_CRM_66_MICRO_CEMENT_AREA_DEV' },
];

function setArrayIfPresent(fields, code, value) {
  if (value === null || value === undefined) return;
  const arr = Array.isArray(value) ? value : [value];
  const cleaned = arr.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  if (cleaned.length > 0) fields[code] = cleaned;
}

function mapMicrostructure(microstructure, microstructureStatus, fields, normLocked) {
  if (!microstructure) return;
  for (const { param, normKey, normField, factKey, factField, devField } of MICRO_FIELD_MAP) {
    const entry = microstructure[param];
    if (entry) {
      // Norm is protected once the item already has one — see normMerge.js.
      // Fact and deviation are always refreshed from this recognition run.
      if (!normLocked?.has(param)) {
        setArrayIfPresent(fields, normField, entry[normKey]);
      }
      setArrayIfPresent(fields, factField, entry[factKey]);
    }
    if (devField) {
      setIfPresent(fields, devField, microstructureStatus?.[param] ?? null);
    }
  }
}

/**
 * Builds the `fields` payload for crm.item.update from a validated
 * recognition result. Only fields with a non-null value are included.
 * `chemNormLocked`/`microNormLocked` (Sets, from normMerge.js) name the
 * elements/params whose `_NORM` field already had a value and must not be
 * overwritten by this run.
 */
function mapToBitrixFields({ general, chemistry, microstructure, microstructureStatus, ocrStatus, warnings, chemNormLocked, microNormLocked }) {
  const fields = {};
  mapGeneral(general, fields);
  mapChemistry(chemistry, fields, chemNormLocked);
  mapMicrostructure(microstructure, microstructureStatus, fields, microNormLocked);
  setIfPresent(fields, 'UF_CRM_66_OCR_STATUS', ocrStatus ? [ocrStatus] : null);
  setIfPresent(fields, 'UF_CRM_66_OCR_WARNINGS', warnings && warnings.length > 0 ? warnings : null);
  return fields;
}

module.exports = { mapToBitrixFields, toBitrixDate, CHEM_ELEMENTS, MICRO_FIELD_MAP };
