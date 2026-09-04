import express from 'express';
import { createServer as createViteServer } from 'vite';
import { DEFAULT_SETTINGS, LIMITS, type DocumentSettings } from '../src/core/types';
import { exportPdf, ExportBlocked } from './pdf';
import { exportDocx } from './docx';
import { closeBrowser } from './browser';
import { resolve } from 'node:path';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: LIMITS.sourceBytes + 8192, type: 'application/json' }));

function body(req: express.Request): { source: string; settings: DocumentSettings; allowFallback: boolean } {
  if (!req.body || typeof req.body.source !== 'string') throw new Error('A Markdown source string is required.');
  const raw = req.body.settings ?? {};
  const settings: DocumentSettings = {
    title: typeof raw.title === 'string' ? raw.title.trim().slice(0, 120) || DEFAULT_SETTINGS.title : DEFAULT_SETTINGS.title,
    paper: raw.paper === 'Letter' ? 'Letter' : 'A4',
    orientation: raw.orientation === 'landscape' ? 'landscape' : 'portrait',
    fontSize: Number.isFinite(raw.fontSize) ? Math.max(8, Math.min(18, raw.fontSize)) : DEFAULT_SETTINGS.fontSize,
    margin: Number.isFinite(raw.margin) ? Math.max(8, Math.min(35, raw.margin)) : DEFAULT_SETTINGS.margin,
    singleDollarMath: raw.singleDollarMath !== false,
  };
  return { source: req.body.source, settings, allowFallback: req.body.allowFallback === true };
}

const filename = (title: string, ext: string) => `${title.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80) || 'notes'}.${ext}`;

app.post('/api/export/pdf', async (req, res) => {
  try {
    const { source, settings, allowFallback } = body(req);
    const buffer = await exportPdf(source, settings, allowFallback);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${encodeURIComponent(filename(settings.title, 'pdf'))}"`, 'Cache-Control': 'no-store' }).send(buffer);
  } catch (error) { exportError(error, res); }
});

app.post('/api/export/docx', async (req, res) => {
  try {
    const { source, settings } = body(req);
    const { buffer, diagnostics } = await exportDocx(source, settings);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename="${encodeURIComponent(filename(settings.title, 'docx'))}"`, 'X-MD2TXT-Diagnostics': String(diagnostics.length), 'Cache-Control': 'no-store' }).send(buffer);
  } catch (error) { exportError(error, res); }
});

function exportError(error: unknown, res: express.Response) {
  if (error instanceof ExportBlocked) return res.status(422).json({ message: error.message, diagnostics: error.diagnostics });
  const message = error instanceof Error ? error.message : 'Export failed unexpectedly.';
  const status = /smaller|limit|required/.test(message) ? 400 : 500;
  res.status(status).json({ message });
}

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist'), { index: false }));
  app.get('*path', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa' });
  app.use(vite.middlewares);
}

const port = Number(process.env.PORT) || 4173;
const server = app.listen(port, '127.0.0.1', () => console.log(`MD2TXT ready at http://127.0.0.1:${port}`));
const shutdown = async () => { server.close(); await closeBrowser(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
