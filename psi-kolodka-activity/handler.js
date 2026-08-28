const bitrix = require('./services/bitrix');
const { pdfToProcessedPages, MAX_PAGES } = require('./services/pdfProcessor');
const { recognizeProtocol } = require('./services/llm');
const { parseLlmResponse } = require('./services/parser');
const { validate } = require('./services/validator');
const { mapToBitrixFields } = require('./services/fieldMapper');

const ENTITY_TYPE_ID = 1068;
const SOURCE_PDF_FIELD_DEFAULT = 'UF_CRM_66_SOURCE_PDF';

/**
 * Bitrix24 sends the bound document's own id in `document_id` (independent of
 * `properties`), typically as ["crm", "...Dynamic", "DYNAMIC_<entityTypeId>_<id>"].
 * Used as a fallback so the designer's "item_id" property becomes optional.
 */
function itemIdFromDocumentId(documentId) {
  if (!Array.isArray(documentId) || documentId.length === 0) return null;
  const last = documentId[documentId.length - 1];
  const match = typeof last === 'string' && last.match(/_(\d+)$/);
  return match ? match[1] : null;
}

async function handleActivityRequest(req, res) {
  // Acknowledge immediately — Bitrix24 (and the Black Hole reliable-delivery
  // layer) expect a 2xx within seconds; the real work runs in the background
  // and reports its outcome via bizproc.event.send.
  res.status(200).json({ success: true });

  const body = req.body || {};
  const properties = body.properties || {};
  const auth = body.auth || {};
  const eventToken = body.event_token;
  const domain = auth.domain;
  const accessToken = auth.access_token;
  const itemId = properties.item_id || itemIdFromDocumentId(body.document_id);
  const sourceField = properties.source_field_code || SOURCE_PDF_FIELD_DEFAULT;

  console.log('[psi_kolodka_recognizer] incoming:', JSON.stringify({
    document_id: body.document_id,
    document_type: body.document_type,
    properties: { ...properties, llm_api_key: properties.llm_api_key ? '[REDACTED]' : undefined },
    resolved_item_id: itemId,
  }));

  let ocrStatus = 'error';
  let warnings = [];
  let errorMessage = '';

  try {
    if (!domain || !accessToken || !eventToken) {
      throw new Error('Missing auth.domain, auth.access_token or event_token in the activity payload');
    }
    if (!itemId) {
      throw new Error('Missing properties.item_id and no document_id to fall back to');
    }

    const result = await recognizeAndFillItem({
      domain,
      accessToken,
      itemId,
      sourceField,
      llmApiUrl: properties.llm_api_url,
      llmModel: properties.llm_model,
      llmApiKey: properties.llm_api_key,
    });

    ocrStatus = result.ocrStatus;
    warnings = result.warnings;
    errorMessage = result.errorMessage || '';
  } catch (err) {
    ocrStatus = 'error';
    errorMessage = err.message;
    console.error('[psi_kolodka_recognizer] failed:', err);
  }

  try {
    await bitrix.sendBizprocEvent(
      domain || process.env.BITRIX_DOMAIN,
      accessToken,
      eventToken,
      `ПСИ распознан. Статус: ${ocrStatus}`,
      {
        ocr_status: ocrStatus,
        ocr_warnings: warnings.join(', '),
        error_message: errorMessage,
      },
    );
  } catch (sendErr) {
    console.error('[psi_kolodka_recognizer] bizproc.event.send failed:', sendErr);
  }
}

async function recognizeAndFillItem({ domain, accessToken, itemId, sourceField, llmApiUrl, llmModel, llmApiKey }) {
  const item = await bitrix.getSmartProcessItem(domain, accessToken, ENTITY_TYPE_ID, itemId);
  const fileRef = Array.isArray(item[sourceField]) ? item[sourceField][0] : item[sourceField];
  // CRM-item file fields hand back { id, url, urlMachine } — urlMachine is a
  // ready-to-use REST download link (crm.controller.item.getFile) with its
  // own auth/token baked in. This is NOT a classic Disk file id, so
  // disk.file.get can't resolve it — download urlMachine directly instead.
  const downloadUrl = fileRef?.urlMachine || fileRef?.url;
  if (!downloadUrl) {
    throw new Error(`Smart-process item ${itemId} has no file in ${sourceField}`);
  }
  const pdfBuffer = await bitrix.downloadFile(downloadUrl);

  const pages = await pdfToProcessedPages(pdfBuffer);
  if (pages.length === 0) {
    throw new Error('PDF conversion produced no pages');
  }

  const rawResponse = await recognizeProtocol({
    apiUrl: llmApiUrl,
    apiKey: llmApiKey,
    model: llmModel,
    pages,
  });

  const parsed = parseLlmResponse(rawResponse);
  if (!parsed.ok) {
    return { ocrStatus: 'error', warnings: [], errorMessage: parsed.error };
  }

  const { chemistry, microstructureStatus, warnings } = validate(parsed.data);
  const fields = mapToBitrixFields({
    general: parsed.data.general,
    chemistry,
    microstructure: parsed.data.microstructure,
    microstructureStatus,
    ocrStatus: warnings.length > 0 ? 'partial' : 'success',
    warnings,
  });

  try {
    await bitrix.updateSmartProcessItem(domain, accessToken, ENTITY_TYPE_ID, itemId, fields);
  } catch (updateErr) {
    console.error('[psi_kolodka_recognizer] crm.item.update failed:', updateErr);
    return {
      ocrStatus: 'partial',
      warnings,
      errorMessage: `Recognition succeeded but crm.item.update failed: ${updateErr.message}`,
    };
  }

  console.log(`[psi_kolodka_recognizer] item ${itemId} microstructure status:`, microstructureStatus);
  return {
    ocrStatus: warnings.length > 0 ? 'partial' : 'success',
    warnings,
    errorMessage: '',
  };
}

module.exports = { handleActivityRequest, MAX_PAGES };
