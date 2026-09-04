import { exportPdf, ExportBlocked } from '../pdf';
import { DEFAULT_SETTINGS, type DocumentSettings } from '../../src/core/types';

function filename(title: string, ext: string) {
  return `${title.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80) || 'notes'}.${ext}`;
}

export default async function handler(req: any, res: any) {
  try {
    const input = req.body ?? {};
    const raw = input.settings ?? {};
    const settings: DocumentSettings = {
      ...DEFAULT_SETTINGS,
      ...raw,
      title: typeof raw.title === 'string' ? raw.title.trim().slice(0, 120) || DEFAULT_SETTINGS.title : DEFAULT_SETTINGS.title,
      paper: raw.paper === 'Letter' ? 'Letter' : 'A4',
      orientation: raw.orientation === 'landscape' ? 'landscape' : 'portrait',
      fontSize: Number.isFinite(raw.fontSize) ? Math.max(8, Math.min(18, raw.fontSize)) : DEFAULT_SETTINGS.fontSize,
      margin: Number.isFinite(raw.margin) ? Math.max(8, Math.min(35, raw.margin)) : DEFAULT_SETTINGS.margin,
      singleDollarMath: raw.singleDollarMath !== false,
    };
    if (typeof input.source !== 'string') return res.status(400).json({ message: 'A Markdown source string is required.' });
    const buffer = await exportPdf(input.source, settings, input.allowFallback === true);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename(settings.title, 'pdf'))}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buffer);
  } catch (error) {
    console.error('[export:pdf] Export failed:', error);
    if (error instanceof ExportBlocked) return res.status(422).json({ message: error.message, diagnostics: error.diagnostics });
    return res.status(500).json({ message: error instanceof Error ? error.message : 'Export failed.' });
  }
}
