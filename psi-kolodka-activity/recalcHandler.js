const bitrix = require('./services/bitrix');
const { validate } = require('./services/validator');
const { readStoredRecognition } = require('./services/storedRecognition');
const { buildRows, buildFullReport } = require('./services/reportBuilder');
const { CHEM_ELEMENTS, MICRO_FIELD_MAP } = require('./services/fieldMapper');
const { itemIdFromDocumentId } = require('./services/documentId');

const ENTITY_TYPE_ID = 1068;

// Only microstructure parameters that actually have a Bitrix _DEV field
// (graphite_form/graphite_distribution/perlite_type don't — see fieldMapper.js).
const DEV_MICRO_PARAMS = MICRO_FIELD_MAP.filter((p) => p.devField);

/** Builds the crm.item.update payload — just the _DEV fields that changed. */
function buildDevFields(chemistry, microstructureStatus) {
  const fields = {};
  const recalculated = [];

  for (const el of CHEM_ELEMENTS) {
    const entry = chemistry[el];
    if (!entry || entry.norm === null || entry.dev === null || entry.dev === undefined) continue;
    const upper = el.toUpperCase();
    fields[`UF_CRM_66_CHEM_${upper}_DEV`] = entry.dev;
    recalculated.push(`chemistry.${el}`);
  }

  for (const { param, devField } of DEV_MICRO_PARAMS) {
    const dev = microstructureStatus[param];
    if (dev === null || dev === undefined) continue;
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
  let report = '';

  try {
    if (!domain || !accessToken || !eventToken) {
      throw new Error('Missing auth.domain, auth.access_token or event_token in the activity payload');
    }
    if (!itemId) {
      throw new Error('Missing properties.item_id and no document_id to fall back to');
    }

    const item = await bitrix.getSmartProcessItem(domain, accessToken, ENTITY_TYPE_ID, itemId);
    const stored = readStoredRecognition(item);
    const { chemistry, microstructureStatus } = validate(stored);

    // Same formatting as the main activity's report_full — human-readable
    // labels, ✅/⚠️ per row — not raw field codes.
    const rows = buildRows({ chemistry, microstructure: stored.microstructure, microstructureStatus });
    report = buildFullReport(rows);

    const { fields, recalculated: changed } = buildDevFields(chemistry, microstructureStatus);
    recalculated = changed;
    if (Object.keys(fields).length > 0) {
      await bitrix.updateSmartProcessItem(domain, accessToken, ENTITY_TYPE_ID, itemId, fields);
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
        report,
      },
    );
  } catch (sendErr) {
    console.error('[psi_kolodka_recalc_deviation] bizproc.event.send failed:', sendErr);
  }
}

module.exports = { handleRecalcRequest };
