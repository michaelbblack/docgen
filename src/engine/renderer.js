import { chromium } from 'playwright-core';

const CHROME_PATH = process.env.CHROME_PATH ||
  '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome';

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--single-process',
  '--font-render-hinting=none',
];

/**
 * Launch a fresh browser instance.
 * We use a per-render browser because --single-process mode (required for
 * PDF generation in some environments) can become unstable after the first
 * page.pdf() call.
 */
async function launchBrowser() {
  return chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: LAUNCH_ARGS,
  });
}

/**
 * Render HTML content to a PDF buffer.
 *
 * @param {string} html - Full HTML string to render
 * @param {object} options - PDF options
 * @param {string} options.format - Page format (A4, Letter, etc.)
 * @param {boolean} options.landscape - Landscape orientation
 * @param {object} options.margin - Margin object {top, right, bottom, left}
 * @returns {Promise<Buffer>} PDF buffer
 */
export async function renderPdf(html, options = {}) {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Emulate print media for accurate PDF rendering
    await page.emulateMedia({ media: 'print' });

    // Wait for images and fonts to load
    await page.evaluate(() => {
      return Promise.all([
        ...Array.from(document.images)
          .filter(img => !img.complete)
          .map(img => new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          })),
        document.fonts?.ready,
      ]);
    });

    const pdfOptions = {
      format: options.format || 'A4',
      landscape: options.landscape || false,
      printBackground: true,
      preferCSSPageSize: true,
      margin: options.margin || { top: '0', right: '0', bottom: '0', left: '0' },
    };

    const pdf = await page.pdf(pdfOptions);
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Render multiple HTML pages into a single PDF.
 * Combines all pages with CSS page breaks into a single document.
 */
export async function renderMultiPagePdf(htmlPages, options = {}) {
  const combinedHtml = htmlPages.join('\n<div style="page-break-after: always;"></div>\n');
  return renderPdf(combinedHtml, options);
}

/**
 * No-op for API compatibility. Each render uses a fresh browser that
 * is closed automatically after use.
 */
export async function closeBrowser() {
  // No shared browser to close - each render manages its own
}
