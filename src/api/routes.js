import { Router } from 'express';
import { processTemplate, processRawTemplate, listTemplates, getTemplateInfo } from '../engine/template.js';
import { renderPdf } from '../engine/renderer.js';

const router = Router();

/**
 * GET /api/templates
 * List all available templates.
 */
router.get('/templates', async (req, res) => {
  try {
    const templates = await listTemplates();
    const details = await Promise.all(
      templates.map(name => getTemplateInfo(name).catch(() => ({ name })))
    );
    res.json({ templates: details });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/templates/:name
 * Get detailed info about a specific template.
 */
router.get('/templates/:name', async (req, res) => {
  try {
    const info = await getTemplateInfo(req.params.name);
    res.json(info);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/**
 * POST /api/generate
 * Generate a PDF from a named template with data.
 *
 * Request body:
 * {
 *   "template": "insurance-coverage",
 *   "data": { ... },
 *   "options": {
 *     "format": "A4",
 *     "landscape": false,
 *     "margin": { "top": "0", "right": "0", "bottom": "0", "left": "0" }
 *   }
 * }
 *
 * Response: PDF binary (application/pdf) or base64 JSON
 */
router.post('/generate', async (req, res) => {
  try {
    const { template, data, options = {}, output } = req.body;

    if (!template) {
      return res.status(400).json({ error: 'Missing required field: template' });
    }

    const html = await processTemplate(template, data || {});
    const pdfBuffer = await renderPdf(html, options);

    if (output === 'base64') {
      return res.json({
        pdf: pdfBuffer.toString('base64'),
        size: pdfBuffer.length,
        contentType: 'application/pdf',
      });
    }

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
      'Content-Disposition': `inline; filename="${template}.pdf"`,
    });
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/generate/raw
 * Generate a PDF from raw HTML/Handlebars template with data.
 *
 * Request body:
 * {
 *   "html": "<div>{{name}}</div>",
 *   "css": "body { font-family: sans-serif; }",
 *   "data": { "name": "World" },
 *   "options": { "format": "A4" }
 * }
 */
router.post('/generate/raw', async (req, res) => {
  try {
    const { html: templateHtml, css, data, options = {}, output } = req.body;

    if (!templateHtml) {
      return res.status(400).json({ error: 'Missing required field: html' });
    }

    const html = processRawTemplate(templateHtml, data || {}, css || '');
    const pdfBuffer = await renderPdf(html, options);

    if (output === 'base64') {
      return res.json({
        pdf: pdfBuffer.toString('base64'),
        size: pdfBuffer.length,
        contentType: 'application/pdf',
      });
    }

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
      'Content-Disposition': 'inline; filename="document.pdf"',
    });
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/preview
 * Preview the rendered HTML (before PDF conversion) for debugging.
 */
router.post('/preview', async (req, res) => {
  try {
    const { template, data } = req.body;

    if (!template) {
      return res.status(400).json({ error: 'Missing required field: template' });
    }

    const html = await processTemplate(template, data || {});
    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/generate/multi
 * Generate a multi-page PDF from multiple templates/data pairs.
 *
 * Request body:
 * {
 *   "pages": [
 *     { "template": "insurance-coverage", "data": { ... } },
 *     { "template": "breach-control", "data": { ... } },
 *     { "template": "vendor-directory", "data": { ... } }
 *   ],
 *   "options": { "format": "A4" }
 * }
 */
router.post('/generate/multi', async (req, res) => {
  try {
    const { pages, options = {}, output } = req.body;

    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'Missing or empty pages array' });
    }

    // Render each page's HTML
    const htmlParts = [];
    for (const page of pages) {
      const html = await processTemplate(page.template, page.data || {});
      // Extract body content for combining
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/gi);
      htmlParts.push({
        body: bodyMatch ? bodyMatch[1] : html,
        styles: styleMatch ? styleMatch.join('\n') : '',
      });
    }

    // Combine into single document with page breaks
    const combinedStyles = htmlParts.map(p => p.styles).join('\n');
    const combinedBody = htmlParts
      .map((p, i) => {
        const pageBreak = i < htmlParts.length - 1
          ? '<div style="page-break-after: always;"></div>'
          : '';
        return `<div class="page page-${i}">${p.body}</div>${pageBreak}`;
      })
      .join('\n');

    const combinedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  ${combinedStyles}
  <style>
    .page { position: relative; }
    @media print { .page { page-break-inside: avoid; } }
  </style>
</head>
<body>${combinedBody}</body>
</html>`;

    const pdfBuffer = await renderPdf(combinedHtml, options);

    if (output === 'base64') {
      return res.json({
        pdf: pdfBuffer.toString('base64'),
        size: pdfBuffer.length,
        pages: pages.length,
        contentType: 'application/pdf',
      });
    }

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
      'Content-Disposition': 'inline; filename="document.pdf"',
    });
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
