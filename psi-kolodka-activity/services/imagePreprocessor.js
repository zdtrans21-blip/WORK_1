const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

function hasPdftoppm() {
  const probe = process.platform === 'win32'
    ? spawnSync('where', ['pdftoppm'])
    : spawnSync('which', ['pdftoppm']);
  return probe.status === 0;
}

/**
 * Renders one page of a PDF to a high-resolution PNG buffer at 300 DPI.
 * Prefers the system `pdftoppm` (poppler-utils); falls back to pdf2pic.
 */
async function pdfPageToHighResPng(pdfBuffer, pageNumber) {
  if (hasPdftoppm()) {
    return pdfPageViaPdftoppm(pdfBuffer, pageNumber);
  }
  return pdfPageViaPdf2pic(pdfBuffer, pageNumber);
}

function pdfPageViaPdftoppm(pdfBuffer, pageNumber) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psi-pdf-'));
  const pdfPath = path.join(workDir, 'source.pdf');
  const outPrefix = path.join(workDir, 'page');
  try {
    fs.writeFileSync(pdfPath, pdfBuffer);
    const result = spawnSync('pdftoppm', [
      '-r', '300',
      '-png',
      '-aa', 'yes',
      '-f', String(pageNumber),
      '-l', String(pageNumber),
      pdfPath,
      outPrefix,
    ]);
    if (result.status !== 0) {
      throw new Error(`pdftoppm exited with code ${result.status}: ${result.stderr?.toString()}`);
    }
    const produced = fs.readdirSync(workDir).find((f) => f.startsWith('page') && f.endsWith('.png'));
    if (!produced) {
      throw new Error(`pdftoppm produced no output for page ${pageNumber}`);
    }
    return fs.readFileSync(path.join(workDir, produced));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function pdfPageViaPdf2pic(pdfBuffer, pageNumber) {
  const { fromBuffer } = require('pdf2pic');
  const convert = fromBuffer(pdfBuffer, {
    density: 300,
    format: 'png',
    saveFilename: `page-${crypto.randomUUID()}`,
    savePath: os.tmpdir(),
    width: 2480,
    height: 3508,
  });
  const result = await convert(pageNumber, { responseType: 'buffer' });
  if (!result?.buffer) {
    throw new Error(`pdf2pic produced no output for page ${pageNumber}`);
  }
  return result.buffer;
}

/**
 * Grayscale + normalize + sharpen + linear contrast, tuned for scanned
 * protocol tables so faint digits and thin table rules stay legible.
 */
async function preprocessForOCR(buffer) {
  return sharp(buffer)
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.5, m1: 1.0, m2: 2.0 })
    .linear(1.3, -20)
    .png({ compressionLevel: 1 })
    .toBuffer();
}

/**
 * Keeps the image under the LLM provider's per-image size limit without
 * touching aspect ratio; only downsizes, never upscales.
 */
async function resizeIfNeeded(pngBuffer, maxSizeMb = 4, maxWidthPx = 2800) {
  const maxBytes = maxSizeMb * 1024 * 1024;
  if (pngBuffer.length <= maxBytes) {
    return pngBuffer;
  }
  return sharp(pngBuffer)
    .resize({ width: maxWidthPx, withoutEnlargement: true })
    .png({ compressionLevel: 1 })
    .toBuffer();
}

module.exports = {
  pdfPageToHighResPng,
  preprocessForOCR,
  resizeIfNeeded,
};
