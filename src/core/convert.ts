import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import type { Root, Nodes } from 'mdast';
import type { Root as HtmlRoot, Element } from 'hast';
import { renderMath } from './math';
import { escapeHtml, LIMITS, type ConvertedDocument, type Diagnostic, type DocumentSettings, type MathResult, type SourceRange } from './types';

export function nodeRange(node: { position?: Nodes['position'] }): SourceRange | undefined {
  const p = node.position;
  return p ? { start: p.start.offset ?? 0, end: p.end.offset ?? 0, line: p.start.line, column: p.start.column } : undefined;
}
export function mathKey(node: { position?: Nodes['position'] }) { return `math-${node.position?.start.offset ?? 0}`; }
export const isMathNode = (node: any) => node.type === 'math' || node.type === 'inlineMath' || (node.type === 'code' && node.lang === 'math');

export function unwrapDocument(source: string): string | null {
  const match = source.trim().match(/^(`{3,}|~{3,})(?:markdown|md)\s*\n([\s\S]*?)\n\1$/i);
  return match ? match[2] : null;
}

export function parseDocument(source: string, singleDollarMath = true): Root {
  return unified().use(remarkParse).use(remarkGfm)
    .use(remarkMath, { singleDollarTextMath: singleDollarMath })
    .parse(canonicalizeMathDelimiters(source)) as Root;
}

// Canonicalize only matched TeX delimiters in Markdown text. Replacements are
// exactly two characters, preserving every source offset for diagnostics.
// Code spans, indented code, and fenced code are excluded before parsing.
function canonicalizeMathDelimiters(source: string) {
  const chars = [...source];
  const pairs: Record<'round' | 'square', number[]> = { round: [], square: [] };
  let fence = '';
  let inlineTicks = 0;
  let lineStart = true;
  for (let i = 0; i < source.length - 1; i++) {
    if (lineStart) {
      const rest = source.slice(i);
      const marker = rest.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
      if (marker) {
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = '';
      }
      if (/^ {4}/.test(rest)) {
        const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; lineStart = true; continue;
      }
    }
    const ch = source[i];
    if (ch === '\n') { lineStart = true; inlineTicks = 0; continue; }
    lineStart = false;
    if (fence) continue;
    if (ch === '`') {
      let run = 1; while (source[i + run] === '`') run++;
      if (!inlineTicks) inlineTicks = run; else if (inlineTicks === run) inlineTicks = 0;
      i += run - 1; continue;
    }
    if (inlineTicks || ch !== '\\' || (i > 0 && source[i - 1] === '\\')) continue;
    const next = source[i + 1];
    const type = next === '(' || next === ')' ? 'round' : next === '[' || next === ']' ? 'square' : null;
    if (!type) continue;
    if (next === '(' || next === '[') pairs[type].push(i);
    else {
      const start = pairs[type].pop();
      if (start !== undefined) {
        chars[start] = chars[start + 1] = '$';
        chars[i] = chars[i + 1] = '$';
      }
    }
    i++;
  }
  return chars.join('');
}

export function toPlain(node: any, math: Record<string, MathResult>, depth = 0): string {
  const children = () => (node.children ?? []).map((n: any) => toPlain(n, math, depth)).join('');
  if (isMathNode(node)) return math[mathKey(node)]?.text ?? node.value;
  switch (node.type) {
    case 'root': return node.children.map((n: any) => toPlain(n, math, depth)).join('\n\n');
    case 'text': case 'inlineCode': case 'code': case 'html': return node.value;
    case 'paragraph': case 'heading': case 'strong': case 'emphasis': case 'delete': return children();
    case 'break': return '\n';
    case 'thematicBreak': return '────────';
    case 'link': return `${children()} (${node.url})`;
    case 'linkReference': return `${children()} [${node.identifier}]`;
    case 'image': return `[Image: ${node.alt || 'Untitled'}] (${node.url})`;
    case 'imageReference': return `[Image: ${node.alt || node.identifier}]`;
    case 'definition': return `[${node.identifier}]: ${node.url}`;
    case 'blockquote': return children();
    case 'list': return node.children.map((item: any, i: number) => {
      const prefix = node.ordered ? `${(node.start ?? 1) + i}. ` : '• ';
      const check = item.checked === null || item.checked === undefined ? '' : item.checked ? '[x] ' : '[ ] ';
      return '  '.repeat(depth) + prefix + check + item.children.map((child: any, j: number) => {
        const text = toPlain(child, math, depth + 1);
        return (j ? '\n' : '') + text;
      }).join('');
    }).join('\n');
    case 'table': return node.children.map((row: any) => row.children.map((c: any) => toPlain(c, math, depth)).join('\t')).join('\n');
    case 'footnoteReference': return `[${node.identifier}]`;
    case 'footnoteDefinition': return `[${node.identifier}]: ${children()}`;
    default: return children();
  }
}

async function toHtml(tree: Root, math: Record<string, MathResult>, forClipboard: boolean) {
  const mathHandler = (_state: any, node: any): Element => ({
    type: 'element', tagName: 'span', properties: { id: mathKey(node) }, children: [],
  });
  const pipeline = unified().use(remarkRehype, {
    handlers: {
      inlineMath: mathHandler, math: mathHandler,
      code(state: any, node: any) {
        if (node.lang === 'math') return mathHandler(state, node);
        return { type: 'element', tagName: 'pre', properties: {}, children: [{ type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value: node.value }] }] };
      },
      html(_state: any, node: any) { return { type: 'text', value: node.value }; },
      image(_state: any, node: any) { return { type: 'element', tagName: 'span', properties: { className: ['image-placeholder'] }, children: [{ type: 'text', value: `[Image: ${node.alt || 'Untitled'} — ${node.url}]` }] }; },
    },
  }).use(rehypeSanitize);
  const hast = await pipeline.run(tree) as HtmlRoot;
  // Sanitize user-derived HTML first. Only then insert SVG from our restricted
  // renderer, never SVG, CSS, or HTML provided by the source document.
  visit(hast, 'element', (node, index, parent) => {
    const id = String(node.properties.id ?? '').replace(/^user-content-/, '');
    const equation = math[id];
    if (equation && parent && index !== undefined) {
      const body = forClipboard ? (equation.clipboardHtml ?? escapeHtml(equation.text)) : equation.html;
      const display = equation.display ? ' math-display' : '';
      const title = equation.error ? ` title="${escapeHtml(equation.error)}"` : '';
      const html = `<span class="equation${display}" data-math-id="${id}"${title}>${body}</span>`;
      (parent.children as any[])[index] = { type: 'raw', value: html };
    }
    // Restrict clipboard styling to simple styles that survive common editors.
    if (forClipboard) {
      const style: Record<string, string> = { table: 'border-collapse:collapse', th: 'border:1px solid #d4d8df;padding:8px;text-align:left;background:#f3f5f8', td: 'border:1px solid #d4d8df;padding:8px', blockquote: 'border-left:3px solid #8793ab;padding-left:12px;color:#475569', pre: 'white-space:pre-wrap;font-family:monospace', h1: 'font-size:24pt', h2: 'font-size:18pt', h3: 'font-size:14pt' };
      if (style[node.tagName]) node.properties.style = style[node.tagName];
    }
  });
  return unified().use(rehypeStringify, { allowDangerousHtml: true }).stringify(hast);
}

export async function convertDocument(input: string, settings: Pick<DocumentSettings, 'singleDollarMath'>): Promise<ConvertedDocument> {
  if (new TextEncoder().encode(input).length > LIMITS.sourceBytes) throw new Error('Notes must be smaller than 512 KB. Split this document into smaller parts.');
  const source = input.replace(/\r\n?/g, '\n');
  const tree = parseDocument(source, settings.singleDollarMath);
  // remark-math deliberately accepts single-dollar syntax broadly. Restore
  // the common "$5 and $10" pattern as literal prose when a parsed span is
  // word-like and its closing dollar is immediately followed by a digit.
  if (settings.singleDollarMath) visit(tree, 'inlineMath', (node: any) => {
    const end = node.position?.end.offset ?? 0;
    if (/^\d[\d.,]*(?:\s+[\p{L}]+)*\s*$/u.test(node.value) && /\d/.test(source[end] ?? '')) {
      node.type = 'text';
      node.value = source.slice(node.position.start.offset, end);
      node.data = { currencyLiteral: true };
    }
  });
  const diagnostics: Diagnostic[] = [];
  const math: Record<string, MathResult> = {};
  const equations: any[] = [];
  function add(node: any, code: string, message: string, severity: Diagnostic['severity'] = 'warning') {
    diagnostics.push({ id: `${code}-${node.position?.start.offset ?? diagnostics.length}`, code, message, severity, range: nodeRange(node) });
  }
  visit(tree, (node: any) => {
    if (isMathNode(node)) equations.push(node);
    if (node.type === 'image' || node.type === 'imageReference') add(node, 'image', 'Images are preserved as labeled placeholders. Remote images are not downloaded.');
    if (node.type === 'html') add(node, 'html', 'Raw HTML is shown as source text. Use Markdown for document formatting.');
    if (node.type === 'code' && node.lang === 'mermaid') add(node, 'mermaid', 'Mermaid is preserved as code. Diagram rendering is not supported in this version.');
    if (node.type === 'text') {
      const raw = source.slice(node.position?.start.offset, node.position?.end.offset);
      if (node.data?.currencyLiteral) return;
      if (/\$\\[A-Za-z]|(?<!\\)\\[([]/.test(raw)) add(node, 'unclosed-math', 'Possible incomplete or escaped math delimiter. Check the source; this text has been preserved.', 'error');
      else if (settings.singleDollarMath && /(?<!\\)\$(?![\d\s])[^$\n]*$/.test(raw)) add(node, 'unclosed-dollar', 'Possible unmatched dollar delimiter. Close the equation or escape a literal dollar as \\$.', 'error');
      if (/\\(?:documentclass|begin\{document\}|usepackage)/.test(raw)) add(node, 'latex-document', 'Full LaTeX documents are not supported. Paste Markdown with math expressions instead.', 'error');
      else if (/\\(?:rightarrow|frac|sqrt|alpha|beta|ce|pu)\b/.test(raw) && !raw.includes('$')) add(node, 'bare-tex', 'Possible LaTeX outside math delimiters. Wrap an intended equation in \\( … \\).');
    }
  });
  if (equations.length > LIMITS.equations) throw new Error('This document has more than 500 equations. Split it into smaller parts.');
  if (unwrapDocument(source) !== null) diagnostics.push({ id: 'wrapped', code: 'wrapped', severity: 'warning', message: 'This entire document is wrapped in a Markdown code fence. Unwrap it to render its contents.', repair: 'unwrap', range: nodeRange(tree) });
  const cache = new Map<string, MathResult>();
  for (const node of equations) {
    const display = node.type !== 'inlineMath';
    const key = `${display}:${node.value}`;
    const result = cache.get(key) ?? await renderMath(node.value, display);
    cache.set(key, result);
    math[mathKey(node)] = result;
    if (result.error) add(node, 'math-error', result.error, 'error');
    else if (!result.linearized) add(node, 'text-fallback', 'This equation renders visually. Plain text and formatted copy preserve its original LaTeX because a faithful linear representation is unavailable.');
  }
  const [html, clipboardHtml] = await Promise.all([toHtml(tree, math, false), toHtml(tree, math, true)]);
  const plainText = toPlain(tree, math);
  return {
    source, tree, html, clipboardHtml, plainText, diagnostics, math,
    stats: { words: plainText.trim() ? plainText.trim().split(/\s+/u).length : 0, equations: equations.length, characters: [...source].length },
  };
}
