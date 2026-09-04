import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import { MathJaxTexFont } from '@mathjax/mathjax-tex-font/js/svg.js';
import { MathJaxMhchemFontExtension } from '@mathjax/mathjax-mhchem-font-extension/js/svg.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import type { MmlNode } from '@mathjax/src/js/core/MmlTree/MmlNode.js';
import { escapeHtml, LIMITS, type MathResult } from './types';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
MathJaxTexFont.addExtension(MathJaxMhchemFontExtension as any);
// Only installed font data can be loaded. TeX cannot choose resources or packages.
mathjax.asyncLoad = async () => { throw new Error('Dynamic math resources are disabled'); };

function linearMath(node: MmlNode): string {
  const n = node as any;
  const children: MmlNode[] = n.childNodes ?? [];
  const values = () => children.map(linearMath);
  switch (node.kind) {
    case 'text': return n.getText();
    case 'mi': case 'mn': case 'mtext': return values().join('');
    case 'mo': {
      const text = values().join('');
      return /^[=+−<>≤≥→⇌±×÷↔⇒∈∉]$/.test(text) ? ` ${text} ` : text;
    }
    case 'mspace': return ' ';
    case 'math': case 'inferredMrow': case 'mrow': case 'TeXAtom': return values().join('');
    case 'mstyle': {
      const variant = n.attributes?.getExplicit('mathvariant');
      if (variant && !['normal', 'italic'].includes(variant)) throw new Error('Styled mathematical alphabet');
      return values().join('');
    }
    case 'mfrac': { const [a, b] = values(); return `(${a.trim()})/(${b.trim()})`; }
    case 'msqrt': return `sqrt(${values().join('').trim()})`;
    case 'mroot': { const [a, b] = values(); return `root(${b.trim()}, ${a.trim()})`; }
    case 'msub': { const [a, b] = values(); return `${a.trim()}_(${b.trim()})`; }
    case 'msup': { const [a, b] = values(); return `(${a.trim()})^(${b.trim()})`; }
    case 'msubsup': { const [a, b, c] = values(); return `(${a.trim()}_(${b.trim()}))^(${c.trim()})`; }
    case 'munder': case 'mover': case 'munderover': {
      if (n.attributes?.get('accent') || n.attributes?.get('accentunder')) throw new Error('Accented expression');
      const [a, b, c] = values();
      return `${a.trim()}${node.kind === 'mover' ? '^' : '_'}(${b.trim()})${c ? `^(${c.trim()})` : ''}`;
    }
    case 'mtable': return `[${values().join('; ')}]`;
    case 'mtr': return `[${values().join(', ')}]`;
    case 'mtd': return values().join('').trim();
    case 'mphantom': return '';
    default: throw new Error(`No unambiguous text representation for ${node.kind}`);
  }
}

export async function renderMath(tex: string, display: boolean): Promise<MathResult> {
  const failure = (message: string): MathResult => ({
    tex, display, html: `<code class="math-error">${escapeHtml(tex)}</code>`,
    text: tex, exactText: false, linearized: false, error: message,
  });
  if (tex.length > LIMITS.equationChars) return failure('This equation exceeds the 10,000-character limit. Split it into smaller equations.');
  if (/\\(?:require|href|url|html\w*|style|class|cssId|includegraphics|input|include|write|openout|catcode|def|gdef|edef|xdef|let|newcommand|renewcommand)\b/.test(tex)) {
    return failure('This expression contains a package, HTML, file, or custom macro command that is not supported.');
  }
  try {
    // Each expression has a fresh parser: labels/macros cannot leak between notes.
    const input = new TeX({
      packages: ['base', 'ams', 'newcommand', 'mhchem'],
      maxBuffer: LIMITS.equationChars, maxMacros: 1000, tags: 'none',
      formatError: (_: unknown, error: Error) => { throw error; },
    });
    const output = new SVG({ fontCache: 'none', fontData: MathJaxTexFont });
    const document = mathjax.document('', { InputJax: input, OutputJax: output });
    const rendered = await document.convertPromise(tex, { display, em: 16, ex: 8, containerWidth: 640 });
    const html = adaptor.outerHTML(rendered);
    if (html.includes('data-mml-node="merror"')) return failure('The equation could not be rendered. Check its commands and braces.');
    let text = tex;
    let linearized = true;
    try { text = linearMath(input.parseOptions.root).replace(/[ \t]+/g, ' ').trim(); }
    catch { linearized = false; }
    const exactText = linearized && /^[\p{L}\p{N}\p{S}\p{P}]$/u.test(text) && !/[{}\\]/.test(text);
    const svg = html.match(/<svg\b[\s\S]*<\/svg>/)?.[0];
    if (!svg) return failure('The math renderer returned no image.');
    return {
      tex, display, html: exactText ? `<span class="math-symbol">${escapeHtml(text)}</span>` : html,
      svg, text, exactText, linearized,
      widthEx: Number(svg.match(/width="([\d.]+)ex"/)?.[1] ?? 1),
      heightEx: Number(svg.match(/height="([\d.]+)ex"/)?.[1] ?? 2),
    };
  } catch (error) {
    return failure(error instanceof Error ? error.message : 'The math renderer failed.');
  }
}
