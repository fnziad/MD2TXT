import { AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, LevelFormat, Packer, PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType, type ISectionOptions } from 'docx';
import type { Nodes } from 'mdast';
import { convertDocument, isMathNode, mathKey } from '../src/core/convert';
import { paperDimensions, type ConvertedDocument, type DocumentSettings, type MathResult } from '../src/core/types';
import { withPage } from './browser';

async function equationPng(result: MathResult) {
  return withPage(async (page) => {
    await page.setViewportSize({ width: 1200, height: 500 });
    await page.setContent(`<style>body{margin:12px;background:white;display:inline-block}svg{display:block;height:auto;max-height:400px}</style>${result.svg}`);
    const box = await page.locator('body > svg').boundingBox();
    if (!box) throw new Error('Equation image was unavailable.');
    return page.screenshot({ type: 'png', clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(1176, Math.ceil(box.width)), height: Math.min(476, Math.ceil(box.height)) } });
  });
}

async function runs(node: any, converted: ConvertedDocument, style: { bold?: boolean; italics?: boolean } = {}): Promise<(TextRun | ImageRun)[]> {
  if (isMathNode(node)) {
    const result = converted.math[mathKey(node)];
    if (!result || result.error || result.exactText || !result.svg) return [new TextRun({ text: result?.text ?? node.value, ...style })];
    const data = await equationPng(result);
    const height = Math.max(15, Math.min(80, (result.heightEx ?? 2) * 5));
    const width = Math.max(12, Math.min(560, (result.widthEx ?? 3) * 5));
    return [new ImageRun({ data, type: 'png', transformation: { width, height }, altText: { name: 'Equation', title: node.value, description: `LaTeX: ${node.value}` } })];
  }
  if (node.type === 'text') return [new TextRun({ text: node.value, ...style })];
  if (node.type === 'inlineCode') return [new TextRun({ text: node.value, font: 'Courier New', shading: { type: ShadingType.CLEAR, fill: 'EEF1F5' }, ...style })];
  if (node.type === 'break') return [new TextRun({ break: 1 })];
  if (node.type === 'link') return [new TextRun({ text: `${node.children.map((x: any) => x.value ?? '').join('')} (${node.url})`, ...style })];
  if (node.type === 'image') return [new TextRun({ text: `[Image: ${node.alt || 'Untitled'} — ${node.url}]`, italics: true })];
  const next = node.type === 'strong' ? { ...style, bold: true } : node.type === 'emphasis' ? { ...style, italics: true } : style;
  const out: (TextRun | ImageRun)[] = [];
  for (const child of node.children ?? []) out.push(...await runs(child, converted, next));
  return out;
}

async function blocks(nodes: Nodes[], converted: ConvertedDocument, listLevel = 0): Promise<(Paragraph | Table)[]> {
  const out: (Paragraph | Table)[] = [];
  for (const node of nodes as any[]) {
    if (node.type === 'heading') out.push(new Paragraph({ heading: ({ 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 } as any)[node.depth] ?? HeadingLevel.HEADING_5, children: await runs(node, converted), keepNext: true }));
    else if (node.type === 'paragraph') out.push(new Paragraph({ children: await runs(node, converted), spacing: { after: 120 } }));
    else if (node.type === 'blockquote') {
      for (const block of await blocks(node.children, converted, listLevel)) {
        if (block instanceof Paragraph) (block as any).options = (block as any).options;
        out.push(block);
      }
    } else if (node.type === 'list') {
      for (let i = 0; i < node.children.length; i++) {
        const item = node.children[i];
        const first = item.children[0];
        const text = first?.type === 'paragraph' ? await runs(first, converted) : [];
        if (item.checked !== null && item.checked !== undefined) text.unshift(new TextRun(item.checked ? '☑ ' : '☐ '));
        out.push(new Paragraph(node.ordered ? { children: text, numbering: { reference: 'numbered', level: Math.min(listLevel, 8) } } : { children: text, bullet: { level: Math.min(listLevel, 8) } }));
        if (first) out.push(...await blocks(item.children.slice(1), converted, listLevel + 1));
      }
    } else if (node.type === 'table') {
      const rows: TableRow[] = [];
      for (let ri = 0; ri < node.children.length; ri++) rows.push(new TableRow({ tableHeader: ri === 0, children: await Promise.all(node.children[ri].children.map(async (cell: any) => new TableCell({ children: [new Paragraph({ children: await runs(cell, converted) })], shading: ri === 0 ? { type: ShadingType.CLEAR, fill: 'F1F4F8' } : undefined }))) }));
      out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: { style: BorderStyle.SINGLE, size: 1, color: 'D9DEE8' }, bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D9DEE8' }, left: { style: BorderStyle.SINGLE, size: 1, color: 'D9DEE8' }, right: { style: BorderStyle.SINGLE, size: 1, color: 'D9DEE8' }, insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'D9DEE8' }, insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'D9DEE8' } } }));
    } else if (node.type === 'code') out.push(new Paragraph({ children: isMathNode(node) ? await runs(node, converted) : [new TextRun({ text: node.value, font: 'Courier New' })], shading: { type: ShadingType.CLEAR, fill: 'F3F5F7' } }));
    else if (node.type === 'math') out.push(new Paragraph({ children: await runs(node, converted), alignment: AlignmentType.CENTER }));
    else if (node.type === 'thematicBreak') out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, color: 'D9DEE8', size: 2 } } }));
    else if (node.type === 'footnoteDefinition') out.push(new Paragraph({ children: [new TextRun({ text: `[${node.identifier}] `, bold: true }), ...await runs(node, converted)] }));
  }
  return out;
}

export async function exportDocx(source: string, settings: DocumentSettings) {
  const converted = await convertDocument(source, settings);
  const children = [new Paragraph({ children: [new TextRun({ text: settings.title, bold: true, color: '667085', size: 18 })], border: { bottom: { style: BorderStyle.SINGLE, color: 'DFE3EB', size: 2 } }, spacing: { after: 280 } }), ...await blocks(converted.tree.children, converted)];
  const [width, height] = paperDimensions(settings);
  const section: ISectionOptions = { properties: { page: { size: { width: Math.round(width * 56.6929), height: Math.round(height * 56.6929), orientation: settings.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: Math.round(settings.margin * 56.6929), right: Math.round(settings.margin * 56.6929), bottom: Math.round(settings.margin * 56.6929), left: Math.round(settings.margin * 56.6929) } } }, children };
  const doc = new Document({ numbering: { config: [{ reference: 'numbered', levels: Array.from({ length: 9 }, (_, level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } } })) }] }, styles: { default: { document: { run: { font: 'Arial', size: settings.fontSize * 2, color: '172033' }, paragraph: { spacing: { line: 330 } } } } }, sections: [section] });
  return { buffer: await Packer.toBuffer(doc), diagnostics: converted.diagnostics };
}
