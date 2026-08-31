const bitrix = require('./services/bitrix');
const { parseNormRange, computeDeviation, validateCodeSet } = require('./services/validator');
const { itemIdFromDocumentId } = require('./services/documentId');

const ENTITY_TYPE_ID = 1068;
const CHEM_ELEMENTS = ['C', 'Si', 'Mn', 'S', 'P', 'Cr', 'Ni', 'Cu'];

// Only microstructure parameters that actually have a Bitrix _DEV field
// (graphite_form/graphite_distribution/perlite_type don't — see fieldMapper.js).
const CODE_DEV_PARAMS = [
  { normField: 'UF_CRM_66_MICRO_PHOSEUT_FORM_NORM', factField: 'UF_CRM_66_MICRO_PHOSEUT_FORM_FACT', devField: 'UF_CRM_66_MICRO_PHOSEUT_FORM_DEV' },
  { normField: 'UF_CRM_66_MICRO_PHOSEUT_AREA_NORM', factField: 'UF_CRM_66_MICRO_PHOSEUT_AREA_FACT', devField: 'UF_CRM_66_MICRO_PHOSEUT_AREA_DEV' },
  { normField: 'UF_CRM_66_MICRO_PHOSEUT_DIST_NORM', factField: 'UF_CRM_66_MICRO_PHOSEUT_DIST_FACT', devField: 'UF_CRM_66_MICRO_PHOSEUT_DIST_DEV' },
  { normField: 'UF_CRM_66_MICRO_CEMENT_PCT_NORM', factField: 'UF_CRM_66_MICRO_CEMENT_PCT_FACT', devField: 'UF_CRM_66_MICRO_CEMENT_PCT_DEV' },
  { normField: 'UF_CRM_66_MICRO_CEMENT_AREA_NORM', factField: 'UF_CRM_66_MICRO_CEMENT_AREA_FACT', devField: 'UF_CRM_66_MICRO_CEMENT_AREA_DEV' },
];

function toNumberArray(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((v) => Number(v))
    .filter((n) => !Number.isNaN(n));
}

/**
 * Re-derives every chemistry/microstructure `_DEV` field from whatever is
 * currently stored in `_NORM`/`_FACT` — for when someone hand-corrects a
 * misread OCR value and needs the deviation/status recomputed without
 * re-running the whole LLM recognition.
 */
function recalcFields(item) {
  const fields = {};
  const recalculated = [];

  for (const el of CHEM_ELEMENTS) {
    const upper = el.toUpperCase();
    const normRaw = item[`UF_CRM_66_CHEM_${upper}_NORM`];
    if (normRaw === null || normRaw === undefined || normRaw === '') continue;
    const factRaw = item[`UF_CRM_66_CHEM_${upper}_FACT`];
    const fact = factRaw === null || factRaw === undefined ? null : parseFloat(factRaw);
    const dev = computeDeviation(parseNormRange(normRaw), fact);
    if (dev === null) continue;
    fields[`UF_CRM_66_CHEM_${upper}_DEV`] = dev;
    recalculated.push(`chemistry.${el}`);
  }

  for (const { normField, factField, devField } of CODE_DEV_PARAMS) {
    const normCodes = toNumberArray(item[normField]);
    if (normCodes.length === 0) continue;
    const factCodes = toNumberArray(item[factField]);
    const dev = validateCodeSet(normCodes, factCodes);
    if (dev === null) continue;
    fields[devField] = dev;
    recalculated.push(devField);
  }

  return { fields, recalculated };
}

async function handleRecalcRequest(req, res) {
  res.status(200).json({ success: true });

  const body = req.body || {};
  const properties = body.properties || {};
  const auth = body.auth || {};
  const eventToken = body.event_token;
  const domain = auth.domain;
  const accessToken = auth.access_token;
  const itemId = properties.item_id || itemIdFromDocumentId(body.document_id);

  let status = 'error';
  let errorMessage = '';
  let recalculated = [];

  try {
    if (!domain || !accessToken || !eventToken) {
      throw new Error('Missing auth.domain, auth.access_token or event_token in the activity payload');
    }
    if (!itemId) {
      throw new Error('Missing properties.item_id and no document_id to fall back to');
    }

    const item = await bitrix.getSmartProcessItem(domain, accessToken, ENTITY_TYPE_ID, itemId);
    const result = recalcFields(item);
    recalculated = result.recalculated;

    if (Object.keys(result.fields).length > 0) {
      await bitrix.updateSmartProcessItem(domain, accessToken, ENTITY_TYPE_ID, itemId, result.fields);
    }
    status = 'success';
  } catch (err) {
    status = 'error';
    errorMessage = err.message;
    console.error('[psi_kolodka_recalc_deviation] failed:', err);
  }

  try {
    await bitrix.sendBizprocEvent(
      domain || process.env.BITRIX_DOMAIN,
      accessToken,
      eventToken,
      `Пересчёт отклонений: ${status}`,
      {
        status,
        error_message: errorMessage,
        recalculated: recalculated.join(', '),
      },
    );
  } catch (sendErr) {
    console.error('[psi_kolodka_recalc_deviation] bizproc.event.send failed:', sendErr);
  }
}

module.exports = { handleRecalcRequest };
