import test from 'node:test';
import assert from 'node:assert/strict';
import { convertDocument, parseDocument, unwrapDocument } from '../src/core/convert';
import { EDGE_CASE_SAMPLE, RASGAP_SAMPLE } from '../src/core/samples';

test('RasGAP arrows render without leaking LaTeX', async () => {
  const result = await convertDocument(RASGAP_SAMPLE, { singleDollarMath: true });
  assert.equal(result.stats.equations, 4);
  assert.equal(result.diagnostics.length, 0);
  assert.match(result.html, /RasGAP[\s\S]*→[\s\S]*dramatically/);
  assert.equal(result.html.includes('\\rightarrow'), false);
  assert.equal((result.plainText.match(/→/g) ?? []).length, 4);
  assert.match(result.html, /<strong>Knockdown:<\/strong>/);
});

test('supports dollar, bracket, display, matrix, chemistry, and GFM table math', async () => {
  const result = await convertDocument(EDGE_CASE_SAMPLE, { singleDollarMath: true });
  assert.equal(result.stats.equations, 12);
  assert.match(result.html, /<table>/);
  assert.match(result.html, /<svg/);
  assert.match(result.plainText, /α \+ β ≤ γ/);
  assert.match(result.plainText, /বাংলা/);
  assert.equal(result.diagnostics.some((d) => d.code === 'math-error'), false);
  assert.equal(result.diagnostics.some((d) => d.severity === 'error'), false);
});

test('currency, escaped delimiters, and code remain literal', async () => {
  const source = String.raw`Costs are $5 and $10; escaped \$25. Code: ` + '`$\\rightarrow$` and `\\(x\\)`.';
  const result = await convertDocument(source, { singleDollarMath: true });
  assert.equal(result.stats.equations, 0);
  assert.match(result.plainText, /\$5 and \$10/);
  assert.match(result.html, /<code>\$\\rightarrow\$<\/code>/);
});

test('single-dollar math can be disabled without disabling bracket math', async () => {
  const result = await convertDocument(String.raw`$x^2$ and \(y^2\)`, { singleDollarMath: false });
  assert.equal(result.stats.equations, 1);
  assert.match(result.plainText, /^\$x\^2\$ and/);
});

test('malformed and unsafe TeX is retained with an export-blocking diagnostic', async () => {
  const result = await convertDocument(String.raw`Safe prose $\href{https://bad.test}{click}$ after.`, { singleDollarMath: true });
  assert.equal(result.diagnostics.some((d) => d.code === 'math-error' && d.severity === 'error'), true);
  assert.match(result.html, /math-error/);
  assert.match(result.html, /\\href/);
});

test('full-document fences are offered as an explicit repair only', async () => {
  const source = '```markdown\n# Title\n\n$\\alpha$\n```';
  const result = await convertDocument(source, { singleDollarMath: true });
  assert.equal(result.stats.equations, 0);
  assert.equal(result.diagnostics.some((d) => d.repair === 'unwrap'), true);
  assert.equal(unwrapDocument(source), '# Title\n\n$\\alpha$');
});

test('parser preserves original source offsets after bracket delimiter adaptation', () => {
  const source = String.raw`Before \(\alpha\) after`;
  const tree = parseDocument(source, true) as any;
  const math = tree.children[0].children[1];
  assert.equal(math.type, 'inlineMath');
  assert.equal(math.position.start.offset, source.indexOf('\\('));
  assert.equal(math.position.end.offset, source.indexOf('\\)') + 2);
});
