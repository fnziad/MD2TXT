import { exportPdf, ExportBlocked } from '../../server/pdf';
import { DEFAULT_SETTINGS, type DocumentSettings } from '../../src/core/types';

export default async function handler(req: any, res: any) {
  try {
    const input = req.body ?? {};
    const raw = input.settings ?? {};
    const settings: DocumentSettings = { ...DEFAULT_SETTINGS, ...raw, paper: raw.paper === 'Letter' ? 'Letter' : 'A4', orientation: raw.orientation === 'landscape' ? 'landscape' : 'portrait', fontSize: Number.isFinite(raw.fontSize) ? Math.max(8, Math.min(18, raw.fontSize)) : DEFAULT_SETTINGS.fontSize, margin: Number.isFinite(raw.margin) ? Math.max(8, Math.min(35, raw.margin)) : DEFAULT_SETTINGS.margin, singleDollarMath: raw.singleDollarMath !== false };
    if (typeof input.source !== 'string') return res.status(400).json({ message: 'A Markdown source string is required.' });
    const buffer = await exportPdf(input.source, settings, input.allowFallback === true);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="notes.pdf"');
    return res.status(200).send(buffer);
  } catch (error) {
    if (error instanceof ExportBlocked) return res.status(422).json({ message: error.message, diagnostics: error.diagnostics });
    return res.status(500).json({ message: error instanceof Error ? error.message : 'Export failed.' });
  }
}
