#!/usr/bin/env node

import { program } from 'commander';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { processTemplate, processRawTemplate, listTemplates, getTemplateInfo } from './engine/template.js';
import { renderPdf, closeBrowser } from './engine/renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = '1.0.0';

program
  .name('docgen')
  .description('Generate dynamic, high-design PDF documents from templates')
  .version(VERSION);

/**
 * List available templates
 */
program
  .command('list')
  .alias('ls')
  .description('List all available templates')
  .action(async () => {
    try {
      const templates = await listTemplates();
      if (templates.length === 0) {
        console.log(chalk.yellow('No templates found.'));
        return;
      }
      console.log(chalk.bold('\nAvailable Templates:\n'));
      for (const name of templates) {
        try {
          const info = await getTemplateInfo(name);
          console.log(`  ${chalk.cyan(name)}`);
          if (info.displayName) console.log(`    ${info.displayName}`);
          if (info.description) console.log(`    ${chalk.dim(info.description)}`);
          if (info.variables?.length > 0) {
            console.log(`    Variables: ${chalk.dim(info.variables.join(', '))}`);
          }
          console.log();
        } catch {
          console.log(`  ${chalk.cyan(name)}\n`);
        }
      }
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

/**
 * Inspect a template - show its variables and metadata
 */
program
  .command('inspect <template>')
  .description('Show detailed information about a template')
  .action(async (templateName) => {
    try {
      const info = await getTemplateInfo(templateName);
      console.log(chalk.bold(`\nTemplate: ${chalk.cyan(templateName)}\n`));
      if (info.displayName) console.log(`  Display Name: ${info.displayName}`);
      if (info.description) console.log(`  Description:  ${info.description}`);
      if (info.category) console.log(`  Category:     ${info.category}`);
      if (info.pageSize) console.log(`  Page Size:    ${info.pageSize}`);
      console.log(`  Has Styles:   ${info.hasStyles ? 'Yes' : 'No'}`);
      if (info.partials?.length > 0) {
        console.log(`  Partials:     ${info.partials.join(', ')}`);
      }
      if (info.variables?.length > 0) {
        console.log(`\n  ${chalk.bold('Template Variables:')}`);
        for (const v of info.variables) {
          console.log(`    - ${chalk.green(v)}`);
        }
      }
      console.log();
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

/**
 * Generate a PDF
 */
program
  .command('generate <template>')
  .alias('gen')
  .description('Generate a PDF from a template')
  .option('-d, --data <file>', 'JSON data file path')
  .option('-j, --json <json>', 'Inline JSON data string')
  .option('-o, --output <file>', 'Output PDF file path', './output/document.pdf')
  .option('-f, --format <size>', 'Page format (A4, Letter, Legal, etc.)', 'A4')
  .option('-l, --landscape', 'Landscape orientation', false)
  .option('--margin <margins>', 'Page margins as JSON, e.g. {"top":"10mm","bottom":"10mm"}')
  .option('--html-only', 'Output rendered HTML instead of PDF', false)
  .option('--open', 'Open the PDF after generation (requires xdg-open)', false)
  .action(async (templateName, opts) => {
    try {
      // Load data
      let data = {};
      if (opts.data) {
        const dataPath = resolve(opts.data);
        const raw = await readFile(dataPath, 'utf-8');
        data = JSON.parse(raw);
        console.log(chalk.dim(`Loaded data from ${opts.data}`));
      } else if (opts.json) {
        data = JSON.parse(opts.json);
      }

      console.log(chalk.dim(`Processing template: ${templateName}`));
      const html = await processTemplate(templateName, data);

      if (opts.htmlOnly) {
        const htmlPath = opts.output.replace(/\.pdf$/i, '.html');
        await ensureDir(dirname(resolve(htmlPath)));
        await writeFile(resolve(htmlPath), html, 'utf-8');
        console.log(chalk.green(`HTML saved to ${htmlPath}`));
        await closeBrowser();
        return;
      }

      // Parse margin option
      let margin;
      if (opts.margin) {
        try {
          margin = JSON.parse(opts.margin);
        } catch {
          console.error(chalk.red('Invalid margin JSON'));
          process.exit(1);
        }
      }

      console.log(chalk.dim('Rendering PDF...'));
      const pdfBuffer = await renderPdf(html, {
        format: opts.format,
        landscape: opts.landscape,
        margin,
      });

      const outputPath = resolve(opts.output);
      await ensureDir(dirname(outputPath));
      await writeFile(outputPath, pdfBuffer);

      console.log(chalk.green(`\nPDF generated: ${outputPath}`));
      console.log(chalk.dim(`  Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`));
      console.log(chalk.dim(`  Format: ${opts.format}${opts.landscape ? ' (landscape)' : ''}`));

      await closeBrowser();
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      await closeBrowser();
      process.exit(1);
    }
  });

/**
 * Generate from raw HTML template
 */
program
  .command('render <htmlFile>')
  .description('Generate a PDF from a raw HTML/Handlebars file')
  .option('-d, --data <file>', 'JSON data file path')
  .option('-c, --css <file>', 'CSS file path')
  .option('-o, --output <file>', 'Output PDF file path', './output/document.pdf')
  .option('-f, --format <size>', 'Page format', 'A4')
  .option('-l, --landscape', 'Landscape orientation', false)
  .action(async (htmlFile, opts) => {
    try {
      const templateHtml = await readFile(resolve(htmlFile), 'utf-8');

      let data = {};
      if (opts.data) {
        data = JSON.parse(await readFile(resolve(opts.data), 'utf-8'));
      }

      let css = '';
      if (opts.css) {
        css = await readFile(resolve(opts.css), 'utf-8');
      }

      console.log(chalk.dim(`Processing ${htmlFile}...`));
      const html = processRawTemplate(templateHtml, data, css);

      console.log(chalk.dim('Rendering PDF...'));
      const pdfBuffer = await renderPdf(html, {
        format: opts.format,
        landscape: opts.landscape,
      });

      const outputPath = resolve(opts.output);
      await ensureDir(dirname(outputPath));
      await writeFile(outputPath, pdfBuffer);

      console.log(chalk.green(`\nPDF generated: ${outputPath}`));
      console.log(chalk.dim(`  Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`));

      await closeBrowser();
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      await closeBrowser();
      process.exit(1);
    }
  });

/**
 * Generate a multi-page document
 */
program
  .command('multi')
  .description('Generate a multi-page PDF from multiple templates')
  .requiredOption('-p, --pages <json>', 'JSON array of {template, dataFile} objects')
  .option('-o, --output <file>', 'Output PDF file path', './output/multi-page.pdf')
  .option('-f, --format <size>', 'Page format', 'A4')
  .action(async (opts) => {
    try {
      const pages = JSON.parse(opts.pages);

      const htmlParts = [];
      for (const page of pages) {
        let data = {};
        if (page.dataFile) {
          data = JSON.parse(await readFile(resolve(page.dataFile), 'utf-8'));
        } else if (page.data) {
          data = page.data;
        }

        console.log(chalk.dim(`Processing page: ${page.template}`));
        const html = await processTemplate(page.template, data);
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/gi);
        htmlParts.push({
          body: bodyMatch ? bodyMatch[1] : html,
          styles: styleMatch ? styleMatch.join('\n') : '',
        });
      }

      const combinedStyles = htmlParts.map(p => p.styles).join('\n');
      const combinedBody = htmlParts
        .map((p, i) => {
          const pb = i < htmlParts.length - 1
            ? '<div style="page-break-after: always;"></div>'
            : '';
          return `<div class="page page-${i}">${p.body}</div>${pb}`;
        })
        .join('\n');

      const combinedHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">${combinedStyles}</head>
<body>${combinedBody}</body>
</html>`;

      console.log(chalk.dim('Rendering multi-page PDF...'));
      const pdfBuffer = await renderPdf(combinedHtml, { format: opts.format });

      const outputPath = resolve(opts.output);
      await ensureDir(dirname(outputPath));
      await writeFile(outputPath, pdfBuffer);

      console.log(chalk.green(`\nMulti-page PDF generated: ${outputPath}`));
      console.log(chalk.dim(`  Pages: ${pages.length}`));
      console.log(chalk.dim(`  Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`));

      await closeBrowser();
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      await closeBrowser();
      process.exit(1);
    }
  });

/**
 * Quick-generate all example templates with sample fixtures
 */
program
  .command('demo')
  .description('Generate PDFs for all templates using sample fixture data')
  .option('-o, --output-dir <dir>', 'Output directory', './output')
  .action(async (opts) => {
    try {
      const templates = await listTemplates();
      if (templates.length === 0) {
        console.log(chalk.yellow('No templates found.'));
        return;
      }

      console.log(chalk.bold(`\nGenerating demo PDFs for ${templates.length} templates...\n`));
      const fixturesDir = resolve(__dirname, '../fixtures');

      for (const templateName of templates) {
        try {
          const info = await getTemplateInfo(templateName);
          const fixtureName = info.sampleFixture || `${templateName}.json`;
          const fixturePath = resolve(fixturesDir, fixtureName);

          let data = {};
          try {
            data = JSON.parse(await readFile(fixturePath, 'utf-8'));
          } catch {
            console.log(chalk.yellow(`  No fixture found for ${templateName}, using empty data`));
          }

          console.log(chalk.dim(`  Processing ${templateName}...`));
          const html = await processTemplate(templateName, data);
          const pdfBuffer = await renderPdf(html, { format: info.pageSize || 'A4' });

          const outputPath = resolve(opts.outputDir, `${templateName}.pdf`);
          await ensureDir(dirname(outputPath));
          await writeFile(outputPath, pdfBuffer);

          console.log(chalk.green(`  ${templateName}.pdf (${(pdfBuffer.length / 1024).toFixed(1)} KB)`));
        } catch (err) {
          console.error(chalk.red(`  Failed: ${templateName} - ${err.message}`));
        }
      }

      console.log(chalk.bold(`\nDone! PDFs saved to ${resolve(opts.outputDir)}\n`));
      await closeBrowser();
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      await closeBrowser();
      process.exit(1);
    }
  });

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

program.parse();
