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

module.exports = { itemIdFromDocumentId };
