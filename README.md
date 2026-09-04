# MD2TXT

Faithful Markdown-to-document conversion for AI-generated study notes.

Maintained by **Fahad Nadim Ziad** · [f.n.ziad@gmail.com](mailto:f.n.ziad@gmail.com)

MD2TXT turns Markdown copied from Gemini and other AI tools into faithful study documents. It renders TeX math and `mhchem` chemistry notation instead of leaving commands such as `$\\rightarrow$` in the exported file.

## What it supports

- GFM headings, emphasis, links, nested lists, tasks, tables, footnotes, quotes, and code
- Inline math with `$…$` and `\\(…\\)`
- Display math with `$$…$$`, `\\[…\\]`, and fenced `math` blocks
- AMS equations, matrices, cases, arrows, symbols, and `mhchem` chemistry
- Formatted clipboard output and Unicode plain text
- A4 or Letter PDF with selectable prose and vector equations
- DOCX with editable prose and high-resolution equation images
- English, Bangla, Greek, and common scientific symbols

Raw HTML and remote images are intentionally not fetched or executed. Unsupported material is preserved visibly and reported in the source-notes panel. The normal PDF action stops on errors; **Export with source fallbacks** remains available as an explicit choice.

## Why MD2TXT exists

AI Studio responses commonly contain Markdown mixed with TeX. A sequence such as `Ras $\\rightarrow$ p120RasGAP` is math notation, not ordinary text; treating it as plain Markdown leaves the literal command in a PDF. MD2TXT parses the document structure and mathematics separately, then uses the same document model for preview, clipboard output, PDF, and DOCX. This keeps arrows, equations, chemistry, nesting, and emphasis consistent across formats.

## Quick start

Paste a response into the editor or load a `.md`/`.txt` file. Choose the formatted preview or plain-text view, adjust paper and typography settings if needed, then use Copy, TXT, PDF, or DOCX. The sample button loads a RasGAP study note so the complete math path can be checked immediately.

For ambiguous documents containing prices, turn off **single-dollar math** in settings. Escaped dollars and code blocks are always treated literally. The issues panel links warnings to their source text; resolve those warnings before a normal export, or explicitly choose source fallbacks.

## Architecture

The browser parses source in a worker with `unified`, `remark-parse`, `remark-gfm`, and `remark-math`. A shared MathJax 4 adapter renders TeX and `mhchem` notation in the preview and export templates. The Node service reparses submitted source, renders a print document in Playwright Chromium, and returns PDF or DOCX bytes. No document body is logged or stored.

```
Markdown source → parsed document tree + diagnostics
             ├→ formatted preview / formatted clipboard
             ├→ Unicode plain text / TXT
             ├→ Playwright Chromium → PDF
             └→ docx + equation images → DOCX
```

## Run locally

Requirements: Node.js 24+ and Google Chrome. The export service uses Chrome at the standard macOS path. On other systems, install Playwright Chromium with `npm run browser:install` or set `CHROME_PATH` to a Chromium executable.

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:4173>.

Production:

```bash
npm run build
npm start
```

Docker:

```bash
docker build -t md2txt .
docker run --rm -p 4173:4173 md2txt
```

## Verification

```bash
npm run check
npm run test:e2e
RUN_EXPORT_TESTS=1 npm test
```

The regular test command skips tests that launch Chromium. Set `RUN_EXPORT_TESTS=1` to exercise real PDF and DOCX generation.

## Export API

`POST /api/export/pdf` and `POST /api/export/docx` accept:

```json
{
  "source": "# Notes\n\nRas $\\rightarrow$ p120RasGAP",
  "settings": {
    "title": "Pathway notes",
    "paper": "A4",
    "orientation": "portrait",
    "fontSize": 11,
    "margin": 20,
    "singleDollarMath": true
  },
  "allowFallback": false
}
```

PDF returns HTTP `422` with structured diagnostics if a default export would conceal an error or overflow. The server reparses the source, blocks raw HTML and resource-fetching commands, processes exports in isolated browser contexts, and does not persist document bodies.

## Development notes

Use Node.js 24 or newer. Run `npm run check` before submitting changes. Browser-backed export tests are opt-in because they launch Chromium. Keep parser changes covered by `tests/conversion.test.ts`; use `tests/exports.test.ts` for PDF/DOCX behavior and `tests/e2e/app.spec.ts` for the browser flow.

Please report a reproducible input, expected rendering, actual rendering, and the output format when filing an issue. Do not include private AI Studio conversations.

## License

MD2TXT is released under the [MIT License](LICENSE).
