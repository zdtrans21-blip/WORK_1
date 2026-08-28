/**
 * Extracts a JSON object from the raw LLM response text, stripping any
 * ```json ... ``` markdown fence the model may have added despite
 * instructions not to.
 */
function parseLlmResponse(rawText) {
  const stripped = stripMarkdownFence(rawText.trim());
  try {
    return { ok: true, data: JSON.parse(stripped) };
  } catch (err) {
    return { ok: false, error: `Invalid JSON from LLM: ${err.message}`, raw: rawText };
  }
}

function stripMarkdownFence(text) {
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text;
}

module.exports = { parseLlmResponse };
