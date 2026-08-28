require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pdfToProcessedPages } = require('../services/pdfProcessor');
const { recognizeProtocol } = require('../services/llm');
const { parseLlmResponse } = require('../services/parser');
const { validate } = require('../services/validator');

const TEST_DATA_DIR = path.join(__dirname, '..', 'test-data');
const PDF_PATH = path.join(TEST_DATA_DIR, 'test-protocol.pdf');

async function main() {
  if (!fs.existsSync(PDF_PATH)) {
    throw new Error(`Test PDF not found: ${PDF_PATH}`);
  }

  const apiUrl = requireEnv('TEST_LLM_URL');
  const model = requireEnv('TEST_LLM_MODEL');
  const apiKey = requireEnv('TEST_LLM_KEY');

  console.log('Converting PDF pages...');
  const pdfBuffer = fs.readFileSync(PDF_PATH);
  const pages = await pdfToProcessedPages(pdfBuffer);
  console.log(`Converted ${pages.length} page(s)`);

  for (const page of pages) {
    const outPath = path.join(TEST_DATA_DIR, `output-page-${page.pageNumber}.png`);
    fs.writeFileSync(outPath, Buffer.from(page.base64Png, 'base64'));
    console.log(`Saved ${outPath}`);
  }

  console.log('\nSending to LLM...');
  const rawResponse = await recognizeProtocol({ apiUrl, apiKey, model, pages });

  const parsed = parseLlmResponse(rawResponse);
  if (!parsed.ok) {
    console.error('\nFailed to parse LLM response as JSON:');
    console.error(parsed.error);
    console.error('\nRaw response:');
    console.error(parsed.raw);
    process.exitCode = 1;
    return;
  }

  console.log('\n=== Recognized JSON ===');
  console.log(JSON.stringify(parsed.data, null, 2));

  const { chemistry, microstructureStatus, warnings } = validate(parsed.data);
  console.log('\n=== Validation: chemistry (with deviation) ===');
  console.log(JSON.stringify(chemistry, null, 2));
  console.log('\n=== Validation: microstructure status ===');
  console.log(JSON.stringify(microstructureStatus, null, 2));
  console.log('\n=== Warnings (low/missing confidence) ===');
  console.log(warnings.length > 0 ? warnings.join(', ') : '(none)');
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

main().catch((err) => {
  console.error('testRecognition.js failed:', err.response?.data || err.message);
  process.exitCode = 1;
});
