import express from 'express';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import apiRoutes from './api/routes.js';
import { closeBrowser } from './engine/renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();

// Parse JSON bodies up to 50MB (for embedded images/data URIs)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS for designer and external clients
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// API routes
app.use('/api', apiRoutes);

// Serve the visual designer
app.use('/designer', express.static(resolve(__dirname, 'designer')));

// Serve template assets and fixture data
app.use('/assets', express.static(resolve(__dirname, '../assets')));
app.use('/templates', express.static(resolve(__dirname, '../templates')));
app.use('/fixtures', express.static(resolve(__dirname, '../fixtures')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// Root - API documentation
app.get('/', (req, res) => {
  res.json({
    name: 'DocGen PDF Generation API',
    version: '1.0.0',
    endpoints: {
      'GET /api/templates': 'List all available templates',
      'GET /api/templates/:name': 'Get template details and available variables',
      'POST /api/generate': 'Generate PDF from named template + data',
      'POST /api/generate/raw': 'Generate PDF from raw HTML/Handlebars + data',
      'POST /api/generate/multi': 'Generate multi-page PDF from multiple templates',
      'POST /api/preview': 'Preview rendered HTML before PDF conversion',
      'PUT /api/templates/:name': 'Save or overwrite a template on the server',
      'GET /designer/': 'Visual template designer',
      'GET /health': 'Health check',
    },
    examples: {
      generate: {
        method: 'POST',
        url: '/api/generate',
        body: {
          template: 'insurance-coverage',
          data: '{ ... template data ... }',
          options: { format: 'A4', landscape: false },
        },
      },
    },
  });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`DocGen server running at http://${HOST}:${PORT}`);
  console.log(`  API:       http://${HOST}:${PORT}/api/templates`);
  console.log(`  Designer:  http://${HOST}:${PORT}/designer/`);
  console.log(`  Health:    http://${HOST}:${PORT}/health`);
});

// Graceful shutdown
async function shutdown() {
  console.log('\nShutting down...');
  await closeBrowser();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default app;
