import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { escapeHtml, paperDimensions, type ConvertedDocument, type DocumentSettings } from '../src/core/types';

const require = createRequire(import.meta.url);
const FONT_DEFS = [
  { family: 'NotoSans', path: '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
  { family: 'NotoSans', path: '@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff2', weight: '700', style: 'normal' },
  { family: 'NotoSans', path: '@fontsource/noto-sans/files/noto-sans-latin-400-italic.woff2', weight: '400', style: 'italic' },
  { family: 'NotoBengali', path: '@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-400-normal.woff2', weight: '400', style: 'normal' },
  { family: 'NotoSymbols', path: '@fontsource/noto-sans-symbols-2/files/noto-sans-symbols-2-symbols-400-normal.woff2', weight: '400', style: 'normal' },
] as const;

let fontsPromise: Promise<string> | undefined;
async function fonts(): Promise<string> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const rules: string[] = [];
    for (const def of FONT_DEFS) {
      try {
        const resolved = require.resolve(def.path);
        const data = await readFile(resolved);
        rules.push(`@font-face{font-family:${def.family};src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2');font-weight:${def.weight};font-style:${def.style}}`);
      } catch (err) {
        console.warn(`[fonts] Could not load embedded font ${def.path}:`, err instanceof Error ? err.message : err);
      }
    }
    return rules.join('\n');
  })().catch(() => '');
  return fontsPromise;
}

export async function documentHtml(converted: ConvertedDocument, settings: DocumentSettings, includeHeader = true) {
  const [width] = paperDimensions(settings);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${await fonts()}
@page{size:${settings.paper} ${settings.orientation};margin:${settings.margin}mm}
*{box-sizing:border-box}html{background:white}body{margin:0;color:#172033;font-family:NotoSans,NotoBengali,NotoSymbols,sans-serif;font-size:${settings.fontSize}pt;line-height:1.62;overflow-wrap:anywhere}
main{width:100%}.document-header{border-bottom:1px solid #dfe3eb;margin-bottom:9mm;padding-bottom:3mm;color:#667085;font-size:8pt;letter-spacing:.05em;text-transform:uppercase}.document-header strong{color:#172033}
h1,h2,h3,h4,h5,h6{color:#121a2a;line-height:1.2;break-after:avoid-page;margin:1.3em 0 .55em}h1{font-size:2em}h2{font-size:1.55em}h3{font-size:1.25em}p{margin:.65em 0}ul,ol{padding-left:1.65em}li{padding-left:.18em;margin:.42em 0}li::marker{color:#566279}blockquote{margin:1.1em 0;padding:.25em 1em;border-left:3px solid #5c6ee8;background:#f7f8ff;color:#364152;break-inside:avoid-page}
strong{font-weight:700;color:#101827}em{font-style:italic}a{color:#394db9;text-decoration:none;border-bottom:1px solid #aeb8ef}hr{border:0;border-top:1px solid #dfe3eb;margin:1.6em 0}
table{width:100%;border-collapse:collapse;margin:1.1em 0;font-size:.93em}thead{display:table-header-group}tr{break-inside:avoid-page}th,td{border:1px solid #d9dee8;padding:.55em .7em;vertical-align:top}th{background:#f4f6f9;text-align:left;color:#283449}
pre{white-space:pre-wrap;break-inside:auto;background:#f4f6f8;border:1px solid #dfe3e8;border-radius:6px;padding:1em;font:8.8pt/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f0f2f5;border-radius:3px;padding:.08em .28em}pre code{background:none;padding:0}
.equation{display:inline-flex;max-width:100%;vertical-align:-.2em;align-items:center;margin:0 .08em}.equation svg{height:auto;max-width:100%;overflow:visible}.equation.math-display{display:flex;justify-content:center;overflow:hidden;margin:1.2em auto;break-inside:avoid-page}.math-display svg{max-height:75mm}.math-symbol{font-family:NotoSymbols,NotoSans,sans-serif}.math-error{color:#9b1c1c;background:#fff0f0;border:1px solid #ffc9c9}.image-placeholder{display:block;border:1px dashed #b8c0cf;background:#f8f9fb;color:#596579;padding:.8em;margin:.8em 0}.footnotes{border-top:1px solid #dfe3eb;margin-top:2em;font-size:.87em}
@media print{.equation,.equation *{print-color-adjust:exact}body{width:${width - 2 * settings.margin}mm}}
</style></head><body><main>${includeHeader ? `<div class="document-header"><strong>${escapeHtml(settings.title)}</strong> · Exported with MD2TXT</div>` : ''}${converted.html}</main></body></html>`;
}
