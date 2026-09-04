import { convertDocument } from '../src/core/convert';
import { LIMITS, type DocumentSettings } from '../src/core/types';
import { withPage } from './browser';
import { documentHtml } from './template';

export class ExportBlocked extends Error {
  constructor(public diagnostics: unknown[], message = 'Export blocked because the document has unresolved issues.') { super(message); }
}

export async function exportPdf(source: string, settings: DocumentSettings, allowFallback = false) {
  const converted = await convertDocument(source, settings);
  const errors = converted.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length && !allowFallback) throw new ExportBlocked(errors);
  return withPage(async (page) => {
    await page.setContent(await documentHtml(converted, settings), { waitUntil: 'load', timeout: LIMITS.timeoutMs });
    await page.evaluate(() => (document as any).fonts.ready);
    const overflow = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('main *')).filter((el) => el.scrollWidth > el.clientWidth + 2).map((el) => ({ tag: el.tagName, text: (el.textContent || '').trim().slice(0, 80) })).slice(0, 5));
    if (overflow.length && !allowFallback) throw new ExportBlocked(overflow.map((item, i) => ({ id: `overflow-${i}`, severity: 'error', code: 'overflow', message: `${item.tag} is wider than the printed page${item.text ? `: ${item.text}` : ''}. Try landscape, smaller text, or export with fitted fallbacks.` })));
    await page.emulateMedia({ media: 'print' });
    return page.pdf({ format: settings.paper, landscape: settings.orientation === 'landscape', printBackground: true, margin: { top: `${settings.margin}mm`, right: `${settings.margin}mm`, bottom: `${settings.margin}mm`, left: `${settings.margin}mm` }, tagged: true, outline: true, preferCSSPageSize: true });
  });
}
