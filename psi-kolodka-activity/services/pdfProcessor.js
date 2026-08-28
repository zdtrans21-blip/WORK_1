const pdfParse = require('pdf-parse');
const { pdfPageToHighResPng, preprocessForOCR, resizeIfNeeded } = require('./imagePreprocessor');

const MAX_PAGES = 5;

/**
 * Downloads and converts a PSI protocol PDF into an array of
 * { pageNumber, base64Png } ready to embed as image_url content blocks.
 */
async function pdfToProcessedPages(pdfBuffer) {
  const { numpages } = await pdfParse(pdfBuffer);
  const pageCount = Math.min(numpages || 1, MAX_PAGES);

  const pages = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const rawPng = await pdfPageToHighResPng(pdfBuffer, pageNumber);
    const preprocessed = await preprocessForOCR(rawPng);
    const sized = await resizeIfNeeded(preprocessed);
    pages.push({
      pageNumber,
      base64Png: sized.toString('base64'),
    });
  }
  return pages;
}

module.exports = { pdfToProcessedPages, MAX_PAGES };
