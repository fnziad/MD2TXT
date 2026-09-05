import { AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, LevelFormat, Packer, PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType, type ISectionOptions } from 'docx';
import type { Nodes } from 'mdast';
import { convertDocument, isMathNode, mathKey } from '../src/core/convert';
import { paperDimensions, type ConvertedDocument, type DocumentSettings, type MathResult } from '../src/core/types';
import { withPage } from './browser';

async function renderEquationImages(math: Record<string, MathResult>): Promise<Map<string, Buffer>> {
  const images = new Map<string, Buffer>();
  const toRender = Object.values(math).filter((m) => m.svg && !m.exactText && !m.error);
  if (toRender.length === 0) return images;

  try {
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1200, height: 4000 });
      const divs = toRender.map((m, i) => `<div id="eq-wrap-${i}" style="display:inline-block;padding:1px;background:white;margin:4px">${m.svg}</div>`).join('\n');
      await page.setContent(`<style>body{margin:0;padding:0;background:white}svg{display:inline-block;height:auto;max-height:400px}</style><div>${divs}</div>`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      for (let i = 0; i < toRender.length; i++) {
        const m = toRender[i];
        const buf = await page.locator(`#eq-wrap-${i}`).screenshot({ type: 'png', timeout: 5000 });
        images.set(m.tex, buf as Buffer);
      }
    });
  } catch (err) {
    console.warn('[export:docx] Equation image rendering fallback to text:', err);
  }
  return images;
}

function runs(
  node: any,
  converted: ConvertedDocument,
  images: Map<string, Buffer>,
  style: { bold?: boolean; italics?: boolean } = {},
  isDisplayMath = false
): (TextRun | ImageRun)[] {
  if (isMathNode(node)) {
    const result = converted.math[mathKey(node)];
    const data = result ? images.get(result.tex) : undefined;
    if (!data || !result || result.error || result.exactText) {
      return [new TextRun({ text: result?.text ?? node.value, ...style })];
    }
    const isDisplay = isDisplayMath || node.type === 'math';
    const scale = isDisplay ? 11 : 8;
    const height = Math.round(Math.max(16, Math.min(260, (result.heightEx ?? 2) * scale)));
    const width = Math.round(Math.max(14, Math.min(560, (result.widthEx ?? 3) * scale)));
    return [
      new ImageRun({
        data,
        type: 'png',
        transformation: { width, height },
        altText: { name: 'Equation', title: node.value, description: `LaTeX: ${node.value}` },
      }),
    ];
  }
  if (node.type === 'text') return [new TextRun({ text: node.value, ...style })];
  if (node.type === 'inlineCode') return [new TextRun({ text: node.value, font: 'Courier New', shading: { type: ShadingType.CLEAR, fill: 'EEF1F5' }, ...style })];
  if (node.type === 'break') return [new TextRun({ break: 1 })];
  if (node.type === 'link') return [new TextRun({ text: `${node.children.map((x: any) => x.value ?? '').join('')} (${node.url})`, ...style })];
  if (node.type === 'image') return [new TextRun({ text: `[Image: ${node.alt || 'Untitled'} — ${node.url}]`, italics: true })];
  const next = node.type === 'strong' ? { ...style, bold: true } : node.type === 'emphasis' ? { ...style, italics: true } : style;
  const out: (TextRun | ImageRun)[] = [];
  for (const child of node.children ?? []) out.push(...runs(child, converted, images, next, isDisplayMath));
  return out;
}

function extractCellText(cell: any): string {
  if (!cell) return '';
  if (cell.type === 'text') return cell.value || '';
  if (isMathNode(cell)) return cell.value || '';
  if (cell.children) return cell.children.map(extractCellText).join('');
  return '';
}

function blocks(
  nodes: Nodes[],
  converted: ConvertedDocument,
  images: Map<string, Buffer>,
  listLevel = 0,
  availableWidthDxa = 9638
): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const node of nodes as any[]) {
    if (node.type === 'heading') out.push(new Paragraph({ heading: ({ 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 } as any)[node.depth] ?? HeadingLevel.HEADING_5, children: runs(node, converted, images), keepNext: true }));
    else if (node.type === 'paragraph') out.push(new Paragraph({ children: runs(node, converted, images), spacing: { after: 120 } }));
    else if (node.type === 'blockquote') {
      for (const block of blocks(node.children, converted, images, listLevel, availableWidthDxa)) {
        out.push(block);
      }
    } else if (node.type === 'list') {
      for (let i = 0; i < node.children.length; i++) {
        const item = node.children[i];
        const first = item.children[0];
        const text = first?.type === 'paragraph' ? runs(first, converted, images) : [];
        if (item.checked !== null && item.checked !== undefined) text.unshift(new TextRun(item.checked ? '☑ ' : '☐ '));
        out.push(new Paragraph(node.ordered ? { children: text, numbering: { reference: 'numbered', level: Math.min(listLevel, 8) } } : { children: text, bullet: { level: Math.min(listLevel, 8) } }));
        if (first) out.push(...blocks(item.children.slice(1), converted, images, listLevel + 1, availableWidthDxa));
      }
    } else if (node.type === 'table') {
      const numCols = Math.max(...node.children.map((r: any) => r.children.length), 1);
      const colMaxChars = Array(numCols).fill(1);
      for (const row of node.children) {
        for (let c = 0; c < row.children.length; c++) {
          const text = extractCellText(row.children[c]);
          colMaxChars[c] = Math.max(colMaxChars[c], text.length);
        }
      }

      const minColFraction = numCols === 2 ? 0.28 : Math.min(0.20, 1 / (numCols * 2));
      const totalChars = colMaxChars.reduce((sum: number, len: number) => sum + Math.max(len, 6), 0);
      const rawWeights = colMaxChars.map((len: number) => Math.max(len, 6) / totalChars);
      const clampedWeights = rawWeights.map((w: number) => Math.max(w, minColFraction));
      const totalClamped = clampedWeights.reduce((sum: number, w: number) => sum + w, 0);
      const normalizedWeights = clampedWeights.map((w: number) => w / totalClamped);

      const colWidths = normalizedWeights.map((w: number) => Math.round(availableWidthDxa * w));
      const currentSum = colWidths.reduce((a: number, b: number) => a + b, 0);
      colWidths[colWidths.length - 1] += availableWidthDxa - currentSum;

      const alignments = (node.align ?? []).map((a: string | null) =>
        a === 'center' ? AlignmentType.CENTER : a === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT
      );

      const rows: TableRow[] = [];
      for (let ri = 0; ri < node.children.length; ri++) {
        const row = node.children[ri];
        const cells: TableCell[] = [];
        for (let ci = 0; ci < row.children.length; ci++) {
          const cell = row.children[ci];
          const align = alignments[ci] ?? AlignmentType.LEFT;
          cells.push(
            new TableCell({
              width: { size: colWidths[ci] ?? Math.round(availableWidthDxa / numCols), type: WidthType.DXA },
              margins: { top: 120, bottom: 120, left: 160, right: 160 },
              children: [new Paragraph({ children: runs(cell, converted, images), alignment: align })],
              shading: ri === 0 ? { type: ShadingType.CLEAR, fill: 'F1F4F8' } : undefined,
            })
          );
        }
        rows.push(new TableRow({ tableHeader: ri === 0, children: cells }));
      }

      out.push(
        new Table({
          rows,
          width: { size: availableWidthDxa, type: WidthType.DXA },
          columnWidths: colWidths,
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: 'D9DEE8' },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D9DEE8' },
            left: { style: BorderStyle.SINGLE, size: 4, color: 'D9DEE8' },
            right: { style: BorderStyle.SINGLE, size: 4, color: 'D9DEE8' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E2E6EE' },
            insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'E2E6EE' },
          },
        })
      );
    } else if (node.type === 'code') out.push(new Paragraph({ children: isMathNode(node) ? runs(node, converted, images) : [new TextRun({ text: node.value, font: 'Courier New' })], shading: { type: ShadingType.CLEAR, fill: 'F3F5F7' } }));
    else if (node.type === 'math') {
      out.push(
        new Paragraph({
          children: runs(node, converted, images, {}, true),
          alignment: AlignmentType.CENTER,
          spacing: { before: 180, after: 180 },
        })
      );
    }
    else if (node.type === 'thematicBreak') out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, color: 'D9DEE8', size: 2 } } }));
    else if (node.type === 'footnoteDefinition') out.push(new Paragraph({ children: [new TextRun({ text: `[${node.identifier}] `, bold: true }), ...runs(node, converted, images)] }));
  }
  return out;
}

export async function exportDocx(source: string, settings: DocumentSettings) {
  const converted = await convertDocument(source, settings);
  const images = await renderEquationImages(converted.math);
  const [width, height] = paperDimensions(settings);
  const marginDxa = Math.round(settings.margin * 56.6929);
  const availableWidthDxa = Math.round((width - settings.margin * 2) * 56.6929);

  const children = [
    new Paragraph({
      children: [new TextRun({ text: settings.title, bold: true, color: '667085', size: 18 })],
      border: { bottom: { style: BorderStyle.SINGLE, color: 'DFE3EB', size: 2 } },
      spacing: { after: 280 },
    }),
    ...blocks(converted.tree.children, converted, images, 0, availableWidthDxa),
  ];
  const section: ISectionOptions = {
    properties: {
      page: {
        size: {
          width: Math.round(width * 56.6929),
          height: Math.round(height * 56.6929),
          orientation: settings.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
        },
        margin: { top: marginDxa, right: marginDxa, bottom: marginDxa, left: marginDxa },
      },
    },
    children,
  };
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'numbered',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
          })),
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: settings.fontSize * 2, color: '172033' },
          paragraph: { spacing: { line: 330 } },
        },
      },
    },
    sections: [section],
  });
  return { buffer: await Packer.toBuffer(doc), diagnostics: converted.diagnostics };
}
