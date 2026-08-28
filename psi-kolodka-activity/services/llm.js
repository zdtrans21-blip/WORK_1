const axios = require('axios');
const { PSI_KOLODKA_SYSTEM_PROMPT } = require('../prompts/psi_kolodka');

const MAX_TOKENS = 4096;
const TEMPERATURE = 0;

function isAnthropic(apiUrl) {
  return apiUrl.includes('anthropic.com');
}

function buildUserContentBlocks(pages, format) {
  const blocks = [];
  for (const page of pages) {
    blocks.push({ type: 'text', text: `=== Страница ${page.pageNumber} ===` });
    if (format === 'anthropic') {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: page.base64Png,
        },
      });
    } else {
      blocks.push({
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${page.base64Png}`,
          detail: 'high',
        },
      });
    }
  }
  return blocks;
}

async function recognizeProtocol({ apiUrl, apiKey, model, pages }) {
  if (isAnthropic(apiUrl)) {
    return callAnthropic({ apiUrl, apiKey, model, pages });
  }
  return callOpenAiCompatible({ apiUrl, apiKey, model, pages });
}

async function callOpenAiCompatible({ apiUrl, apiKey, model, pages }) {
  const response = await axios.post(
    apiUrl,
    {
      model,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      messages: [
        { role: 'system', content: PSI_KOLODKA_SYSTEM_PROMPT },
        { role: 'user', content: buildUserContentBlocks(pages, 'openai') },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    },
  );

  const text = response.data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('LLM response contained no message content');
  }
  return text;
}

async function callAnthropic({ apiUrl, apiKey, model, pages }) {
  const response = await axios.post(
    apiUrl,
    {
      model,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: PSI_KOLODKA_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: buildUserContentBlocks(pages, 'anthropic') },
      ],
    },
    {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    },
  );

  const text = response.data?.content?.find((block) => block.type === 'text')?.text;
  if (!text) {
    throw new Error('Anthropic response contained no text content');
  }
  return text;
}

module.exports = { recognizeProtocol };
