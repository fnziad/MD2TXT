import { exportDocx } from '../../server/docx';
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
    const { buffer, diagnostics } = await exportDocx(input.source, settings);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename(settings.title, 'docx'))}"`);
    res.setHeader('X-MD2TXT-Diagnostics', String(diagnostics.length));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buffer);
  } catch (error) {
    console.error('[export:docx] Export failed:', error);
    return res.status(500).json({ message: error instanceof Error ? error.message : 'DOCX export failed.' });
  }
}
