import Handlebars from 'handlebars';
import { readFile, readdir, access, stat } from 'fs/promises';
import { join, resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '../../templates');

// Register built-in Handlebars helpers
registerHelpers();

function registerHelpers() {
  // Conditional equality
  Handlebars.registerHelper('eq', (a, b) => a === b);
  Handlebars.registerHelper('neq', (a, b) => a !== b);
  Handlebars.registerHelper('gt', (a, b) => a > b);
  Handlebars.registerHelper('lt', (a, b) => a < b);
  Handlebars.registerHelper('gte', (a, b) => a >= b);
  Handlebars.registerHelper('lte', (a, b) => a <= b);

  // Logical operators
  Handlebars.registerHelper('and', (...args) => {
    args.pop(); // remove options hash
    return args.every(Boolean);
  });
  Handlebars.registerHelper('or', (...args) => {
    args.pop();
    return args.some(Boolean);
  });
  Handlebars.registerHelper('not', (val) => !val);

  // Math
  Handlebars.registerHelper('add', (a, b) => a + b);
  Handlebars.registerHelper('subtract', (a, b) => a - b);
  Handlebars.registerHelper('multiply', (a, b) => a * b);

  // String helpers
  Handlebars.registerHelper('uppercase', (str) => String(str).toUpperCase());
  Handlebars.registerHelper('lowercase', (str) => String(str).toLowerCase());
  Handlebars.registerHelper('capitalize', (str) => {
    const s = String(str);
    return s.charAt(0).toUpperCase() + s.slice(1);
  });

  // Array/iteration helpers
  Handlebars.registerHelper('times', function (n, options) {
    let result = '';
    for (let i = 0; i < n; i++) {
      result += options.fn({ index: i, num: i + 1 });
    }
    return result;
  });

  Handlebars.registerHelper('first', (arr) => arr?.[0]);
  Handlebars.registerHelper('last', (arr) => arr?.[arr.length - 1]);

  // Index-based class helper for alternating rows
  Handlebars.registerHelper('rowClass', function (index) {
    return index % 2 === 0 ? 'row-even' : 'row-odd';
  });

  // JSON output for debugging
  Handlebars.registerHelper('json', (context) => JSON.stringify(context, null, 2));

  // Date formatting
  Handlebars.registerHelper('formatDate', (dateStr, format) => {
    const date = new Date(dateStr);
    if (typeof format !== 'string') {
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: '2-digit' });
    }
    return date.toLocaleDateString('en-US');
  });

  // Image embedding helper - converts file path to data URI
  Handlebars.registerHelper('dataUri', (filePath) => {
    // This is a placeholder - actual data URI conversion happens in processTemplate
    return filePath;
  });

  // Conditional CSS class
  Handlebars.registerHelper('classIf', (condition, className) => {
    return condition ? className : '';
  });

  // Repeat helper - iterate n times
  Handlebars.registerHelper('repeat', function (n, options) {
    let out = '';
    for (let i = 0; i < n; i++) {
      out += options.fn(this);
    }
    return out;
  });

  // Section break helper
  Handlebars.registerHelper('pageBreak', () => {
    return new Handlebars.SafeString('<div style="page-break-after: always;"></div>');
  });

  // Safe HTML output
  Handlebars.registerHelper('raw', (content) => {
    return new Handlebars.SafeString(content);
  });
}

/**
 * Load a template and its associated styles from the templates directory.
 *
 * Template directory structure:
 *   templates/{name}/
 *     template.hbs   - Main Handlebars template
 *     styles.css     - Template-specific styles
 *     partials/      - Optional partial templates
 *     assets/        - Optional template-specific assets
 *
 * @param {string} templateName - Name of the template directory
 * @returns {Promise<{html: string, css: string, partials: object}>}
 */
export async function loadTemplate(templateName) {
  const templateDir = join(TEMPLATES_DIR, templateName);

  // Verify template exists
  try {
    await access(templateDir);
  } catch {
    throw new Error(`Template "${templateName}" not found in ${TEMPLATES_DIR}`);
  }

  // Load main template
  const templatePath = join(templateDir, 'template.hbs');
  const templateHtml = await readFile(templatePath, 'utf-8');

  // Load styles (optional)
  let css = '';
  const stylesPath = join(templateDir, 'styles.css');
  try {
    css = await readFile(stylesPath, 'utf-8');
  } catch {
    // No styles file - that's fine
  }

  // Load partials (optional)
  const partialsDir = join(templateDir, 'partials');
  const partials = {};
  try {
    const partialFiles = await readdir(partialsDir);
    for (const file of partialFiles) {
      if (extname(file) === '.hbs') {
        const name = file.replace('.hbs', '');
        partials[name] = await readFile(join(partialsDir, file), 'utf-8');
      }
    }
  } catch {
    // No partials directory - that's fine
  }

  return { html: templateHtml, css, partials };
}

/**
 * List all available templates.
 * @returns {Promise<string[]>} Array of template names
 */
export async function listTemplates() {
  try {
    const entries = await readdir(TEMPLATES_DIR, { withFileTypes: true });
    const templates = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const templatePath = join(TEMPLATES_DIR, entry.name, 'template.hbs');
        try {
          await access(templatePath);
          templates.push(entry.name);
        } catch {
          // Not a valid template directory
        }
      }
    }
    return templates;
  } catch {
    return [];
  }
}

/**
 * Get template metadata including available data fields.
 * @param {string} templateName
 * @returns {Promise<object>} Template metadata
 */
export async function getTemplateInfo(templateName) {
  const templateDir = join(TEMPLATES_DIR, templateName);
  const metaPath = join(templateDir, 'meta.json');

  let meta = { name: templateName };
  try {
    const metaContent = await readFile(metaPath, 'utf-8');
    meta = { ...meta, ...JSON.parse(metaContent) };
  } catch {
    // No meta.json - return basic info
  }

  const { html, css, partials } = await loadTemplate(templateName);

  // Extract Handlebars variables from template
  const variablePattern = /\{\{(?:#(?:if|each|unless|with)\s+)?([a-zA-Z_][\w.]*)/g;
  const variables = new Set();
  let match;
  while ((match = variablePattern.exec(html)) !== null) {
    variables.add(match[1]);
  }

  return {
    ...meta,
    variables: [...variables],
    hasStyles: css.length > 0,
    partials: Object.keys(partials),
  };
}

/**
 * Process a template with data and return complete HTML ready for PDF rendering.
 *
 * @param {string} templateName - Template directory name
 * @param {object} data - Data to inject into the template
 * @returns {Promise<string>} Complete HTML document
 */
export async function processTemplate(templateName, data = {}) {
  const { html, css, partials } = await loadTemplate(templateName);

  // Register partials for this compilation
  for (const [name, content] of Object.entries(partials)) {
    Handlebars.registerPartial(name, content);
  }

  // Compile and render the template
  const compiled = Handlebars.compile(html, { strict: false });
  let renderedBody = compiled(data);

  // If template doesn't include full HTML document wrapper, add one
  if (!renderedBody.includes('<!DOCTYPE') && !renderedBody.includes('<html')) {
    renderedBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${css}</style>
</head>
<body>
${renderedBody}
</body>
</html>`;
  } else if (css && !renderedBody.includes(css)) {
    // Template has full HTML but styles need injection
    renderedBody = renderedBody.replace('</head>', `<style>${css}</style></head>`);
  }

  // Unregister partials to avoid leaking between renders
  for (const name of Object.keys(partials)) {
    Handlebars.unregisterPartial(name);
  }

  return renderedBody;
}

/**
 * Process raw HTML/Handlebars template string with data.
 * Used for custom templates not stored on disk.
 *
 * @param {string} templateHtml - Raw HTML/Handlebars template string
 * @param {object} data - Data to inject
 * @param {string} css - Optional CSS styles
 * @returns {string} Complete HTML document
 */
export function processRawTemplate(templateHtml, data = {}, css = '') {
  const compiled = Handlebars.compile(templateHtml, { strict: false });
  let rendered = compiled(data);

  if (!rendered.includes('<!DOCTYPE') && !rendered.includes('<html')) {
    rendered = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>${css}</style>
</head>
<body>
${rendered}
</body>
</html>`;
  }

  return rendered;
}
