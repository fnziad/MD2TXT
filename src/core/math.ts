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

const SUB_MAP: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '(': '₍', ')': '₎',
  'a': 'ₐ', 'e': 'ₑ', 'o': 'ₒ', 'x': 'ₓ', 'h': 'ₕ', 'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ', 'n': 'ₙ', 'p': 'ₚ', 's': 'ₛ', 't': 'ₜ',
};
const SUP_MAP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ', 'x': 'ˣ', 'y': 'ʸ',
};

function toSubscript(s: string): string | null {
  if (!s || !/^[0-9+\-()aeoxhklmnpst]+$/.test(s)) return null;
  return [...s].map((c) => SUB_MAP[c] ?? c).join('');
}

function toSuperscript(s: string): string | null {
  if (!s || !/^[0-9+\-()nixy]+$/.test(s)) return null;
  return [...s].map((c) => SUP_MAP[c] ?? c).join('');
}

export function formatChemistry(tex: string): { text: string; html: string } | null {
  const match = tex.trim().match(/^\\ce\{([\s\S]*)\}$/);
  if (!match) return null;
  const inner = match[1].trim();

  const arrowRegex = /->\s*\[([^\]]*)\](?:\[([^\]]*)\])?/g;

  let html = inner.replace(arrowRegex, (_, above, below) => {
    const parts = [above, below].filter(Boolean).join(', ');
    return parts ? ` ─[${parts}]&rarr; ` : ' &rarr; ';
  });
  html = html.replace(/<->|<=>/g, ' &harr; ');
  html = html.replace(/->/g, ' &rarr; ');
  html = html.replace(/<-/g, ' &larr; ');
  html = html.replace(/\^{([^}]+)}|\^([0-9+-]+)/g, (_, a, b) => `<sup>${a || b}</sup>`);
  html = html.replace(/([A-Za-z)\]])(\d+)/g, '$1<sub>$2</sub>');

  let text = inner.replace(arrowRegex, (_, above, below) => {
    const parts = [above, below].filter(Boolean).join(', ');
    return parts ? ` ─[${parts}]→ ` : ' → ';
  });
  text = text.replace(/<->|<=>/g, ' ⇌ ');
  text = text.replace(/->/g, ' → ');
  text = text.replace(/<-/g, ' ← ');
  text = text.replace(/\^{([^}]+)}|\^([0-9+-]+)/g, (_, a, b) => {
    const val = a || b;
    return [...val].map((c) => SUP_MAP[c] ?? c).join('');
  });
  text = text.replace(/([A-Za-z)\]])(\d+)/g, (_, letter, digits) => {
    const subs = [...digits].map((d) => SUB_MAP[d] ?? d).join('');
    return letter + subs;
  });

  return { text: text.replace(/\s+/g, ' ').trim(), html: html.replace(/\s+/g, ' ').trim() };
}

function linearMath(node: MmlNode): string {
  const n = node as any;
  const children: MmlNode[] = n.childNodes ?? [];
  const values = () => children.map(linearMath);
  switch (node.kind) {
    case 'text': {
      const t = n.getText();
      if (t.length === 1) {
        const code = t.charCodeAt(0);
        if (code >= 0xe000 && code <= 0xf8ff) return '→';
      }
      return t;
    }
    case 'mi': case 'mn': case 'mtext': return values().join('');
    case 'mo': {
      const text = values().join('');
      if (text.length === 1) {
        const code = text.charCodeAt(0);
        if (code >= 0xe000 && code <= 0xf8ff) return ' → ';
      }
      return /^[=+−<>≤≥→⇌±×÷↔⇒∈∉]$/.test(text) ? ` ${text} ` : text;
    }
    case 'mspace': return ' ';
    case 'math': case 'inferredMrow': case 'mrow': case 'TeXAtom': case 'mpadded': case 'mstyle':
      return values().join('');
    case 'mphantom': return '';
    case 'mfrac': {
      const [a, b] = values();
      return `(${a.trim()})/(${b.trim()})`;
    }
    case 'msqrt': return `sqrt(${values().join('').trim()})`;
    case 'mroot': {
      const [a, b] = values();
      return `root(${b.trim()}, ${a.trim()})`;
    }
    case 'msub': {
      const [a, b] = values();
      const sub = toSubscript(b.trim());
      if (!a.trim()) return sub ?? b.trim();
      return sub ? `${a.trim()}${sub}` : `${a.trim()}_(${b.trim()})`;
    }
    case 'msup': {
      const [a, b] = values();
      const sup = toSuperscript(b.trim());
      if (!a.trim()) return sup ?? b.trim();
      return sup ? `${a.trim()}${sup}` : `(${a.trim()})^(${b.trim()})`;
    }
    case 'msubsup': {
      const [a, b, c] = values();
      const sub = toSubscript(b.trim());
      const sup = toSuperscript(c.trim());
      if (sub && sup) return `${a.trim()}${sub}${sup}`;
      return `(${a.trim()}_(${b.trim()}))^(${c.trim()})`;
    }
    case 'munder': case 'mover': case 'munderover': {
      const [a, b, c] = values();
      const base = a.trim();
      if (base === '→' || base === '⇌' || base === '←') {
        const label = [b, c].map((x) => x?.trim()).filter(Boolean).join(', ');
        return label ? ` ─[${label}]→ ` : ` ${base} `;
      }
      return `${base}${node.kind === 'mover' ? '^' : '_'}(${b.trim()})${c ? `^(${c.trim()})` : ''}`;
    }
    case 'mtable': return values().join('; ');
    case 'mtr': return values().join(', ');
    case 'mtd': return values().join('').trim();
    default: return values().join('');
  }
}

function mmlToClipboardHtml(node: MmlNode): string {
  const n = node as any;
  const children: MmlNode[] = n.childNodes ?? [];
  const values = () => children.map(mmlToClipboardHtml);
  switch (node.kind) {
    case 'text': {
      const t = n.getText();
      if (t.length === 1) {
        const code = t.charCodeAt(0);
        if (code >= 0xe000 && code <= 0xf8ff) return '&rarr;';
      }
      return escapeHtml(t);
    }
    case 'mi': {
      const t = values().join('');
      return /^[a-zA-Z]$/.test(t) ? `<i>${t}</i>` : t;
    }
    case 'mn': case 'mtext': return values().join('');
    case 'mo': {
      const text = values().join('');
      if (text.length === 1) {
        const code = text.charCodeAt(0);
        if (code >= 0xe000 && code <= 0xf8ff) return ' &rarr; ';
      }
      return /^[=+−<>≤≥→⇌±×÷↔⇒∈∉]$/.test(text) ? ` ${text} ` : text;
    }
    case 'mspace': return ' ';
    case 'math': case 'inferredMrow': case 'mrow': case 'TeXAtom': case 'mpadded': case 'mstyle':
      return values().join('');
    case 'mphantom': return '';
    case 'mfrac': {
      const [a, b] = values();
      return `(${a.trim()})/(${b.trim()})`;
    }
    case 'msqrt': return `&radic;(${values().join('').trim()})`;
    case 'mroot': {
      const [a, b] = values();
      return `<sup>${b.trim()}</sup>&radic;(${a.trim()})`;
    }
    case 'msub': {
      const [a, b] = values();
      return `${a.trim()}<sub>${b.trim()}</sub>`;
    }
    case 'msup': {
      const [a, b] = values();
      return `${a.trim()}<sup>${b.trim()}</sup>`;
    }
    case 'msubsup': {
      const [a, b, c] = values();
      return `${a.trim()}<sub>${b.trim()}</sub><sup>${c.trim()}</sup>`;
    }
    case 'munder': case 'mover': case 'munderover': {
      const [a, b, c] = values();
      const base = a.trim();
      if (base === '→' || base === '&rarr;' || base === '⇌' || base === '←') {
        const label = [b, c].map((x) => x?.trim()).filter(Boolean).join(', ');
        return label ? ` ─[${label}]&rarr; ` : ` ${base} `;
      }
      return `${base}${node.kind === 'mover' ? `<sup>${b.trim()}</sup>` : `<sub>${b.trim()}</sub>`}${c ? `<sup>${c.trim()}</sup>` : ''}`;
    }
    case 'mtable': return values().join('; ');
    case 'mtr': return values().join(', ');
    case 'mtd': return values().join('').trim();
    default: return values().join('');
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
    
    const chem = formatChemistry(tex);
    let text = chem?.text ?? tex;
    let clipboardHtml = chem?.html;
    let linearized = !!chem;
    if (!chem) {
      try {
        text = linearMath(input.parseOptions.root).replace(/[ \t]+/g, ' ').trim();
        clipboardHtml = mmlToClipboardHtml(input.parseOptions.root).replace(/[ \t]+/g, ' ').trim();
        linearized = true;
      } catch {
        linearized = false;
      }
    }
    const exactText = linearized && /^[\p{L}\p{N}\p{S}\p{P}]$/u.test(text) && !/[{}\\]/.test(text);
    const svg = html.match(/<svg\b[\s\S]*<\/svg>/)?.[0];
    if (!svg) return failure('The math renderer returned no image.');
    return {
      tex, display, html: exactText ? `<span class="math-symbol">${escapeHtml(text)}</span>` : html,
      svg, text, clipboardHtml, exactText, linearized,
      widthEx: Number(svg.match(/width="([\d.]+)ex"/)?.[1] ?? 1),
      heightEx: Number(svg.match(/height="([\d.]+)ex"/)?.[1] ?? 2),
    };
  } catch (error) {
    return failure(error instanceof Error ? error.message : 'The math renderer failed.');
  }
}
