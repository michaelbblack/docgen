import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  processTemplate,
  processRawTemplate,
  listTemplates,
  getTemplateInfo,
  loadTemplate,
} from '../engine/template.js';
import { renderPdf, closeBrowser } from '../engine/renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../fixtures');

describe('Template Engine', () => {
  it('should list available templates', async () => {
    const templates = await listTemplates();
    assert.ok(Array.isArray(templates));
    assert.ok(templates.length >= 3, `Expected at least 3 templates, got ${templates.length}`);
    assert.ok(templates.includes('insurance-coverage'));
    assert.ok(templates.includes('breach-control'));
    assert.ok(templates.includes('vendor-directory'));
  });

  it('should load a template with styles', async () => {
    const { html, css, partials } = await loadTemplate('insurance-coverage');
    assert.ok(html.length > 0, 'Template HTML should not be empty');
    assert.ok(css.length > 0, 'Template CSS should not be empty');
    assert.ok(typeof partials === 'object');
  });

  it('should get template info with variables', async () => {
    const info = await getTemplateInfo('insurance-coverage');
    assert.ok(info.name === 'insurance-coverage');
    assert.ok(info.displayName);
    assert.ok(Array.isArray(info.variables));
    assert.ok(info.variables.length > 0, 'Should detect template variables');
  });

  it('should throw for non-existent template', async () => {
    await assert.rejects(
      () => loadTemplate('non-existent-template'),
      { message: /not found/ }
    );
  });

  it('should process a template with data', async () => {
    const data = JSON.parse(
      await readFile(resolve(fixturesDir, 'insurance-coverage.json'), 'utf-8')
    );
    const html = await processTemplate('insurance-coverage', data);
    assert.ok(html.includes('<!DOCTYPE html'));
    assert.ok(html.includes('NetGuard'));
    assert.ok(html.includes('$500K'));
    assert.ok(html.includes('Multimedia Liability'));
  });

  it('should process a template with empty data', async () => {
    const html = await processTemplate('insurance-coverage', {});
    assert.ok(html.includes('<!DOCTYPE html'));
    // Should not throw even with missing data
  });

  it('should process a raw template string', () => {
    const html = processRawTemplate(
      '<h1>Hello {{name}}</h1>',
      { name: 'World' },
      'h1 { color: blue; }'
    );
    assert.ok(html.includes('Hello World'));
    assert.ok(html.includes('color: blue'));
    assert.ok(html.includes('<!DOCTYPE html'));
  });

  it('should handle conditional blocks', () => {
    const html = processRawTemplate(
      '{{#if show}}<p>Visible</p>{{/if}}{{#unless show}}<p>Hidden</p>{{/unless}}',
      { show: true }
    );
    assert.ok(html.includes('Visible'));
    assert.ok(!html.includes('Hidden'));
  });

  it('should handle each loops', () => {
    const html = processRawTemplate(
      '{{#each items}}<li>{{this}}</li>{{/each}}',
      { items: ['a', 'b', 'c'] }
    );
    assert.ok(html.includes('<li>a</li>'));
    assert.ok(html.includes('<li>b</li>'));
    assert.ok(html.includes('<li>c</li>'));
  });

  it('should handle nested data', () => {
    const html = processRawTemplate(
      '<p>{{person.name}} - {{person.title}}</p>',
      { person: { name: 'Jane', title: 'VP' } }
    );
    assert.ok(html.includes('Jane - VP'));
  });

  it('should handle helper functions', () => {
    const html = processRawTemplate(
      '<p>{{uppercase text}}</p>',
      { text: 'hello world' }
    );
    assert.ok(html.includes('HELLO WORLD'));
  });
});

describe('PDF Renderer', () => {
  after(async () => {
    await closeBrowser();
  });

  it('should render simple HTML to PDF', async () => {
    const html = `<!DOCTYPE html><html><body><h1>Test</h1></body></html>`;
    const pdf = await renderPdf(html);
    assert.ok(Buffer.isBuffer(pdf));
    assert.ok(pdf.length > 0);
    // PDF files start with %PDF
    assert.ok(pdf.toString('ascii', 0, 5).startsWith('%PDF'));
  });

  it('should render a full template to PDF', async () => {
    const data = JSON.parse(
      await readFile(resolve(fixturesDir, 'insurance-coverage.json'), 'utf-8')
    );
    const html = await processTemplate('insurance-coverage', data);
    const pdf = await renderPdf(html);
    assert.ok(Buffer.isBuffer(pdf));
    assert.ok(pdf.length > 1000, 'PDF should be substantial');
    assert.ok(pdf.toString('ascii', 0, 5).startsWith('%PDF'));
  });

  it('should respect page format options', async () => {
    const html = `<!DOCTYPE html><html><body><h1>Letter Test</h1></body></html>`;
    const pdf = await renderPdf(html, { format: 'Letter' });
    assert.ok(Buffer.isBuffer(pdf));
    assert.ok(pdf.length > 0);
  });

  it('should render all three example templates', async () => {
    const templates = ['insurance-coverage', 'breach-control', 'vendor-directory'];

    for (const name of templates) {
      const fixture = JSON.parse(
        await readFile(resolve(fixturesDir, `${name}.json`), 'utf-8')
      );
      const html = await processTemplate(name, fixture);
      const pdf = await renderPdf(html);
      assert.ok(pdf.length > 500, `${name} PDF should be substantial (got ${pdf.length} bytes)`);
    }
  });
});
