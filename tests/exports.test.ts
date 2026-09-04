import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { exportPdf, ExportBlocked } from '../server/pdf';
import { exportDocx } from '../server/docx';
import { DEFAULT_SETTINGS } from '../src/core/types';
import { RASGAP_SAMPLE } from '../src/core/samples';
import { closeBrowser } from '../server/browser';

const settings = { ...DEFAULT_SETTINGS, title: 'RasGAP proof' };
after(closeBrowser);

test('PDF has a valid signature and no raw arrow command', { skip: process.env.RUN_EXPORT_TESTS !== '1' }, async () => {
  const pdf = await exportPdf(RASGAP_SAMPLE, settings);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 10_000);
});

test('DOCX keeps arrow symbols and embeds complex equations', { skip: process.env.RUN_EXPORT_TESTS !== '1' }, async () => {
  const source = `${RASGAP_SAMPLE}\n\n$$\\frac{a+b}{c+d}$$\n\n$$\\ce{6CO2 + 6H2O ->[light] C6H12O6 + 6O2}$$`;
  const { buffer } = await exportDocx(source, settings);
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')!.async('string');
  assert.match(xml, /→/);
  assert.ok(Object.keys(zip.files).some((name) => /^word\/media\//.test(name)));
});

test('PDF blocks invalid math unless source fallbacks are explicit', { skip: process.env.RUN_EXPORT_TESTS !== '1' }, async () => {
  await assert.rejects(() => exportPdf(String.raw`$\href{x}{y}$`, settings), ExportBlocked);
});
