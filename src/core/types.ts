import type { Root } from 'mdast';

export type SourceRange = { start: number; end: number; line: number; column: number };
export type Diagnostic = {
  id: string;
  severity: 'warning' | 'error';
  code: string;
  message: string;
  range?: SourceRange;
  repair?: 'unwrap';
};
export type DocumentSettings = {
  title: string;
  paper: 'A4' | 'Letter';
  orientation: 'portrait' | 'landscape';
  fontSize: number;
  margin: number;
  singleDollarMath: boolean;
};
export const DEFAULT_SETTINGS: DocumentSettings = {
  title: 'Untitled notes', paper: 'A4', orientation: 'portrait',
  fontSize: 11, margin: 20, singleDollarMath: true,
};
export const LIMITS = { sourceBytes: 512 * 1024, equations: 500, equationChars: 10000, timeoutMs: 60000 };
export type MathResult = {
  tex: string;
  display: boolean;
  html: string;
  svg?: string;
  text: string;
  exactText: boolean;
  linearized: boolean;
  widthEx?: number;
  heightEx?: number;
  error?: string;
};
export type ConvertedDocument = {
  source: string;
  tree: Root;
  html: string;
  clipboardHtml: string;
  plainText: string;
  diagnostics: Diagnostic[];
  math: Record<string, MathResult>;
  stats: { words: number; equations: number; characters: number };
};
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function paperDimensions(settings: DocumentSettings) {
  const size = settings.paper === 'A4' ? [210, 297] : [215.9, 279.4];
  return settings.orientation === 'landscape' ? size.reverse() : size;
}
