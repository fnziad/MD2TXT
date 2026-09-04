import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertCircle,
  ArrowDown,
  Bold,
  Check,
  ChevronDown,
  Clipboard,
  Code,
  Copy,
  Download,
  FileCheck,
  FileDown,
  FileText,
  FlaskConical,
  Info,
  Italic,
  LoaderCircle,
  Quote,
  RotateCcw,
  Settings2,
  Sigma,
  Sparkles,
  Table,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { DEFAULT_SETTINGS, type ConvertedDocument, type Diagnostic, type DocumentSettings } from './core/types';
import { EDGE_CASE_SAMPLE, RASGAP_SAMPLE, SCIENCE_SAMPLE } from './core/samples';
import './styles.css';
import '@fontsource/noto-sans/400.css';
import '@fontsource/noto-sans/500.css';
import '@fontsource/noto-sans/600.css';
import '@fontsource/noto-sans/700.css';
import '@fontsource/noto-sans-bengali/400.css';
import '@fontsource/noto-sans-symbols-2/400.css';

type Notice = { message: string; type: 'success' | 'error' };
type ExportKind = 'pdf' | 'docx';

function useConversion(source: string, settings: DocumentSettings) {
  const worker = useRef<Worker | undefined>(undefined);
  const counter = useRef(0);
  const [result, setResult] = useState<ConvertedDocument>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    worker.current = new Worker(new URL('./converter.worker.ts', import.meta.url), { type: 'module' });
    worker.current.onmessage = ({ data }) => {
      if (data.id !== counter.current) return;
      setBusy(false);
      setError(data.error ?? '');
      if (data.result) setResult(data.result);
    };
    worker.current.onerror = (event) => {
      setBusy(false);
      setError(`The document worker stopped: ${event.message || 'unknown browser error'}`);
    };
    const current = worker.current;
    return () => {
      current.onmessage = null;
      current.onerror = null;
      current.terminate();
      if (worker.current === current) worker.current = undefined;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBusy(true);
      setError('');
      const id = ++counter.current;
      worker.current?.postMessage({ id, source, settings: { singleDollarMath: settings.singleDollarMath } });
    }, 180);
    return () => clearTimeout(timer);
  }, [source, settings.singleDollarMath]);

  return { result, error, busy };
}

function App() {
  const [source, setSource] = useState(SCIENCE_SAMPLE);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [outputMode, setOutputMode] = useState<'formatted' | 'plain'>('formatted');
  const [lastCleared, setLastCleared] = useState('');
  const [notice, setNotice] = useState<Notice>();
  const [showSettings, setShowSettings] = useState(false);
  const [exporting, setExporting] = useState<ExportKind>();
  const [showFallback, setShowFallback] = useState(false);
  const [copiedMode, setCopiedMode] = useState<string | null>(null);

  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { result, error, busy } = useConversion(source, settings);
  const errors = result?.diagnostics.filter((d) => d.severity === 'error') ?? [];
  const warnings = result?.diagnostics.filter((d) => d.severity === 'warning') ?? [];

  const notify = useCallback((message: string, type: Notice['type'] = 'success') => {
    setNotice({ message, type });
    window.setTimeout(() => setNotice(undefined), 3200);
  }, []);

  function insertFormatting(before: string, after = '', placeholder = '') {
    if (!textarea.current) return;
    const el = textarea.current;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = source.slice(start, end);
    const textToInsert = selected || placeholder;
    const newText = source.slice(0, start) + before + textToInsert + after + source.slice(end);
    setSource(newText);
    setTimeout(() => {
      el.focus();
      const newCursorStart = start + before.length;
      const newCursorEnd = newCursorStart + textToInsert.length;
      el.setSelectionRange(newCursorStart, newCursorEnd);
    }, 0);
  }

  async function paste() {
    try {
      setSource(await navigator.clipboard.readText());
      notify('Pasted from clipboard');
    } catch {
      notify('Clipboard access was denied. Paste with your keyboard instead.', 'error');
      textarea.current?.focus();
    }
  }

  async function copy(rich: boolean) {
    if (!result) return;
    try {
      if (rich && navigator.clipboard.write && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([result.clipboardHtml], { type: 'text/html' }),
            'text/plain': new Blob([result.plainText], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(result.plainText);
      }
      setCopiedMode(rich ? 'rich' : 'plain');
      setTimeout(() => setCopiedMode(null), 2000);
      notify(rich ? 'Formatted notes copied to clipboard' : 'Plain text copied to clipboard');
    } catch {
      notify('Copy was blocked by your browser. Select the preview and copy manually.', 'error');
    }
  }

  function downloadText() {
    if (!result) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([result.plainText], { type: 'text/plain;charset=utf-8' }));
    link.download = `${safeName(settings.title)}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
    notify('Text file downloaded');
  }

  async function exportFile(kind: ExportKind, allowFallback = false) {
    if (kind === 'pdf' && errors.length && !allowFallback) {
      setShowFallback(true);
      return;
    }
    setExporting(kind);
    try {
      const response = await fetch(`/api/export/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, settings, allowFallback }),
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => ({ message: `Export failed (HTTP ${response.status}).` }));
        if (response.status === 422) {
          setShowFallback(true);
          notify('Resolve the highlighted issues or use source fallbacks.', 'error');
          return;
        }
        throw new Error(problem.message || `Export failed (HTTP ${response.status}).`);
      }
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${safeName(settings.title)}.${kind}`;
      link.click();
      URL.revokeObjectURL(link.href);
      setShowFallback(false);
      notify(`${kind.toUpperCase()} document downloaded`);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Export failed. Check the deployment logs.', 'error');
    } finally {
      setExporting(undefined);
    }
  }

  function selectIssue(issue: Diagnostic) {
    if (!issue.range) return;
    textarea.current?.focus();
    textarea.current?.setSelectionRange(issue.range.start, issue.range.end);
    textarea.current?.scrollTo({ top: Math.max(0, (issue.range.line - 3) * 24), behavior: 'smooth' });
  }

  function clear() {
    if (!source) return;
    setLastCleared(source);
    setSource('');
    textarea.current?.focus();
  }

  function loadFile(file?: File) {
    if (!file) return;
    if (!/\.(md|markdown|txt)$/i.test(file.name)) return notify('Choose a .md, .markdown, or .txt file.', 'error');
    if (file.size > 512 * 1024) return notify('The file is larger than 512 KB.', 'error');
    file.text().then((text) => {
      setSource(text);
      setSettings((s) => ({ ...s, title: file.name.replace(/\.[^.]+$/, '') }));
    });
  }

  function repair(issue: Diagnostic) {
    if (issue.repair === 'unwrap') {
      const unwrapped = unwrapDocumentSource(source);
      if (unwrapped !== null) {
        setSource(unwrapped);
        notify('Document fence unwrapped');
      }
    }
  }

  const wordCount = result?.stats.words ?? 0;
  const charCount = [...source].length;
  const readTime = Math.max(1, Math.ceil(wordCount / 200));

  const issueSummary = useMemo(
    () =>
      errors.length
        ? `${errors.length} issue${errors.length === 1 ? '' : 's'} to review`
        : warnings.length
          ? `${warnings.length} note${warnings.length === 1 ? '' : 's'}`
          : 'Ready to export',
    [errors.length, warnings.length]
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="MD2TXT home">
          <img src="/logo.png" alt="MD2TXT icon" className="brand-logo" />
          <div className="brand-info">
            <span className="brand-title">
              MD2TXT <span className="beta-badge">BETA</span>
            </span>
            <span className="brand-subtitle">AI Notes to Beautiful Docs</span>
          </div>
        </a>

        <div className={`status-pill ${errors.length || error ? 'has-errors' : busy ? 'is-busy' : 'is-ready'}`}>
          <span className="status-dot"></span>
          {busy ? <LoaderCircle className="spin" /> : errors.length || error ? <AlertCircle /> : <Check />}
          <span>{busy ? 'Rendering notes…' : error ? 'Render error' : issueSummary}</span>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className={`ghost-button ${showSettings ? 'is-active' : ''}`}
            onClick={() => setShowSettings((v) => !v)}
            aria-expanded={showSettings}
          >
            <Settings2 /> <span>Document Settings</span>
          </button>
        </div>
      </header>

      <main id="top" className="workspace">
        <section className="hero">
          <div className="hero-content">
            <div className="eyebrow">
              <Sparkles /> Built for AI study notes &amp; papers
            </div>
            <h1>
              Your notes,
              <br />
              <em>beautifully translated.</em>
            </h1>
            <p>
              Paste Markdown from Gemini, ChatGPT, Claude, or any LLM. Keep every equation, scientific symbol, chemical
              formula, and detailed list faithfully rendered.
            </p>

            <div className="sample-chips" aria-label="Load sample documents">
              <span className="sample-label">Try sample:</span>
              <button
                type="button"
                className="sample-chip"
                onClick={() => {
                  setSource(SCIENCE_SAMPLE);
                  notify('Loaded Science sample');
                }}
              >
                <FlaskConical /> Science &amp; Chem
              </button>
              <button
                type="button"
                className="sample-chip"
                onClick={() => {
                  setSource(RASGAP_SAMPLE);
                  notify('Loaded Biology sample');
                }}
              >
                🧬 Biology / Pathways
              </button>
              <button
                type="button"
                className="sample-chip"
                onClick={() => {
                  setSource(EDGE_CASE_SAMPLE);
                  notify('Loaded Math & Notation sample');
                }}
              >
                <Sigma /> Math &amp; Equations
              </button>
            </div>
          </div>

          <div className="flow-card">
            <div className="flow-step">
              <span className="flow-tag">INPUT</span>
              <strong>Raw AI Markdown</strong>
              <small>Math, chemistry, markdown tables</small>
            </div>
            <div className="flow-arrow">
              <ArrowDown />
            </div>
            <div className="flow-step">
              <span className="flow-tag engine">ENGINE</span>
              <strong>Faithful Typesetting</strong>
              <small>KaTeX math &amp; Noto Sans typography</small>
            </div>
            <div className="flow-arrow">
              <ArrowDown />
            </div>
            <div className="flow-step highlight">
              <span className="flow-tag ready">OUTPUT</span>
              <strong>PDF &bull; DOCX &bull; TXT</strong>
              <small>Vector precision &amp; editable prose</small>
            </div>
          </div>
        </section>

        {showSettings && (
          <section className="settings-card" aria-label="Document settings">
            <label className="wide">
              <span>Document title</span>
              <input value={settings.title} onChange={(e) => setSettings({ ...settings, title: e.target.value })} />
            </label>
            <label>
              <span>Paper Size</span>
              <select
                value={settings.paper}
                onChange={(e) => setSettings({ ...settings, paper: e.target.value as any })}
              >
                <option>A4</option>
                <option>Letter</option>
              </select>
              <ChevronDown />
            </label>
            <label>
              <span>Orientation</span>
              <select
                value={settings.orientation}
                onChange={(e) => setSettings({ ...settings, orientation: e.target.value as any })}
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
              <ChevronDown />
            </label>
            <label>
              <span>Base Font Size</span>
              <input
                type="number"
                min="8"
                max="18"
                value={settings.fontSize}
                onChange={(e) => setSettings({ ...settings, fontSize: Number(e.target.value) })}
              />
            </label>
            <label>
              <span>Margins (mm)</span>
              <input
                type="number"
                min="8"
                max="35"
                value={settings.margin}
                onChange={(e) => setSettings({ ...settings, margin: Number(e.target.value) })}
              />
            </label>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={settings.singleDollarMath}
                onChange={(e) => setSettings({ ...settings, singleDollarMath: e.target.checked })}
              />
              <span className="toggle" />
              <span>Recognize $…$ single-dollar inline math</span>
            </label>
            <button className="close-settings" onClick={() => setShowSettings(false)} aria-label="Close settings">
              <X />
            </button>
          </section>
        )}

        <section className="converter-card">
          <div className="panel editor-panel">
            <div className="panel-header">
              <div className="panel-title-group">
                <span className="step">01</span>
                <h2>Markdown Source</h2>
              </div>
              <div className="panel-tools">
                <div className="format-bar" aria-label="Formatting helpers">
                  <button
                    type="button"
                    onClick={() => insertFormatting('**', '**', 'bold text')}
                    title="Bold (**text**)"
                  >
                    <Bold />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertFormatting('*', '*', 'italic text')}
                    title="Italic (*text*)"
                  >
                    <Italic />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertFormatting('`', '`', 'code')}
                    title="Inline code (`code`)"
                  >
                    <Code />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertFormatting('$', '$', '\\alpha + \\beta')}
                    title="Inline math ($formula$)"
                  >
                    <Sigma />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertFormatting('> ', '', 'quoted thought')}
                    title="Blockquote (>)"
                  >
                    <Quote />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      insertFormatting('| Parameter | Value |\n| :--- | :--- |\n| Setting A | 100 |\n', '', '')
                    }
                    title="Insert Table"
                  >
                    <Table />
                  </button>
                </div>
                <div className="tools-separator" />
                <button type="button" className="tool-btn" onClick={paste} title="Paste from clipboard">
                  <Clipboard /> <span>Paste</span>
                </button>
                <button
                  type="button"
                  className="tool-btn"
                  onClick={() => fileInput.current?.click()}
                  title="Upload Markdown file"
                >
                  <Upload /> <span>Upload</span>
                </button>
                <button
                  type="button"
                  className="tool-btn danger"
                  onClick={clear}
                  aria-label="Clear input"
                  title="Clear all"
                >
                  <Trash2 />
                </button>
              </div>
            </div>

            <input
              ref={fileInput}
              hidden
              type="file"
              accept=".md,.markdown,.txt,text/plain,text/markdown"
              onChange={(e) => loadFile(e.target.files?.[0])}
            />

            <textarea
              ref={textarea}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              spellCheck={false}
              placeholder={'Paste your Markdown here…\n\nInline math like $E=mc^2$ or equations render automatically.'}
              aria-label="Markdown input"
            />

            <div className="panel-footer">
              <div className="editor-stats">
                <span>{charCount.toLocaleString()} chars</span>
                <span className="dot-sep">&bull;</span>
                <span>{wordCount.toLocaleString()} words</span>
                <span className="dot-sep">&bull;</span>
                <span>~{readTime} min read</span>
              </div>
              {lastCleared && !source && (
                <button
                  type="button"
                  className="undo-btn"
                  onClick={() => {
                    setSource(lastCleared);
                    setLastCleared('');
                  }}
                >
                  <RotateCcw /> Undo clear
                </button>
              )}
            </div>
          </div>

          <div className="panel preview-panel">
            <div className="panel-header">
              <div className="panel-title-group">
                <span className="step">02</span>
                <h2>Live Document Preview</h2>
              </div>
              <div className="segmented">
                <button
                  type="button"
                  className={outputMode === 'formatted' ? 'active' : ''}
                  onClick={() => setOutputMode('formatted')}
                >
                  <FileCheck className="seg-icon" /> Formatted
                </button>
                <button
                  type="button"
                  className={outputMode === 'plain' ? 'active' : ''}
                  onClick={() => setOutputMode('plain')}
                >
                  <FileText className="seg-icon" /> Clean Text
                </button>
              </div>
            </div>

            <div className={`preview-scroll ${busy ? 'updating' : ''}`}>
              {error ? (
                <div className="empty-state error">
                  <AlertCircle />
                  <h3>Couldn’t render these notes</h3>
                  <p>{error}</p>
                </div>
              ) : !source ? (
                <div className="empty-state">
                  <FileText />
                  <h3>Your document appears here</h3>
                  <p>Paste Markdown on the left or choose a sample to see instant live rendering.</p>
                </div>
              ) : outputMode === 'formatted' ? (
                <article className="document-preview" dangerouslySetInnerHTML={{ __html: result?.html ?? '' }} />
              ) : (
                <pre className="plain-preview">{result?.plainText}</pre>
              )}
            </div>

            <div className="panel-footer preview-meta">
              <div className="preview-metrics">
                <span>
                  <strong>{wordCount.toLocaleString()}</strong> words
                </span>
                <span className="dot-sep">&bull;</span>
                <span>
                  <strong>{result?.stats.equations ?? 0}</strong> equations
                </span>
              </div>
              <div className="preview-actions">
                <button
                  type="button"
                  className={`copy-btn ${copiedMode === (outputMode === 'formatted' ? 'rich' : 'plain') ? 'copied' : ''}`}
                  onClick={() => copy(outputMode === 'formatted')}
                >
                  {copiedMode === (outputMode === 'formatted' ? 'rich' : 'plain') ? <Check /> : <Copy />}
                  <span>
                    {copiedMode === (outputMode === 'formatted' ? 'rich' : 'plain')
                      ? 'Copied!'
                      : outputMode === 'formatted'
                        ? 'Copy formatted'
                        : 'Copy text'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {(result?.diagnostics.length ?? 0) > 0 && (
          <section className="issues-card">
            <div className="issues-heading">
              <div className="issues-title">
                <Info />
                <div>
                  <h2>Source notes &amp; notation checklist</h2>
                  <p>Your content remains untouched. Review these notes before generating downloads.</p>
                </div>
              </div>
              <span className="issues-count">{result!.diagnostics.length} items</span>
            </div>
            <div className="issue-list">
              {result!.diagnostics.map((issue) => (
                <div key={issue.id} className={`issue ${issue.severity}`}>
                  {issue.severity === 'error' ? <AlertCircle /> : <Info />}
                  <button type="button" className="issue-copy" onClick={() => selectIssue(issue)}>
                    <strong>{issue.code.replace(/-/g, ' ')}</strong>
                    <span>{issue.message}</span>
                    {issue.range && (
                      <small>
                        Line {issue.range.line}, column {issue.range.column}
                      </small>
                    )}
                  </button>
                  {issue.repair && (
                    <button type="button" className="repair" onClick={() => repair(issue)}>
                      Fix
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="export-card">
          <div className="export-intro">
            <div className="export-badge">
              <span className="step">03</span> Ready for Distribution
            </div>
            <h2>Export in Any Format</h2>
            <p>
              PDF preserves full visual fidelity and LaTeX equations. DOCX provides editable Word prose. TXT gives you a
              clean, universal Unicode document.
            </p>
          </div>

          <div className="export-actions">
            <button
              type="button"
              className="export-btn primary-export"
              disabled={!source || busy || !!error || !!exporting}
              onClick={() => exportFile('pdf')}
            >
              <div className="export-icon-box">
                {exporting === 'pdf' ? <LoaderCircle className="spin" /> : <FileDown />}
              </div>
              <div className="export-label">
                <div className="export-top">
                  <b>Download PDF</b>
                  <span className="format-tag prime">Vector &bull; Print Ready</span>
                </div>
                <small>Full KaTeX math, chemistry &amp; typography</small>
              </div>
            </button>

            <button
              type="button"
              className="export-btn secondary-export"
              disabled={!source || busy || !!exporting}
              onClick={() => exportFile('docx')}
            >
              <div className="export-icon-box">
                {exporting === 'docx' ? <LoaderCircle className="spin" /> : <Download />}
              </div>
              <div className="export-label">
                <div className="export-top">
                  <b>Download DOCX</b>
                  <span className="format-tag">Word 2007+</span>
                </div>
                <small>Editable document with tables &amp; prose</small>
              </div>
            </button>

            <button
              type="button"
              className="export-btn secondary-export"
              disabled={!source || busy}
              onClick={downloadText}
            >
              <div className="export-icon-box">
                <Download />
              </div>
              <div className="export-label">
                <div className="export-top">
                  <b>Plain Text (.txt)</b>
                  <span className="format-tag">Unicode</span>
                </div>
                <small>Clean unicode text without markup</small>
              </div>
            </button>
          </div>
        </section>
      </main>

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="footer-logo-row">
              <img src="/logo.png" alt="MD2TXT Logo" className="footer-logo" />
              <div>
                <strong className="footer-brand-name">MD2TXT</strong>
                <span className="footer-tagline">Notes, beautifully translated.</span>
              </div>
            </div>
            <p className="footer-desc">
              A high-precision document synthesizer for AI study notes, mathematical notation, chemical formulas, and
              clean technical writing.
            </p>
          </div>

          <div className="footer-meta">
            <div className="privacy-pill">
              <span className="privacy-dot"></span>
              <span>100% Client-side preview privacy &bull; Zero data retention</span>
            </div>
            <div className="developer-credit">
              <span>Crafted &amp; Developed by</span>
              <span className="credit-name">Ziad</span>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <span>&copy; {new Date().getFullYear()} MD2TXT. Designed for clarity &amp; focus.</span>
          <span className="footer-stats-note">Fast serverless export &bull; Instant local rendering</span>
        </div>
      </footer>

      {notice && (
        <div className={`toast ${notice.type}`}>
          {notice.type === 'success' ? <Check /> : <AlertCircle />}
          <span>{notice.message}</span>
        </div>
      )}

      {showFallback && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowFallback(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fallback-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setShowFallback(false)} aria-label="Close settings">
              <X />
            </button>
            <AlertCircle className="modal-icon" />
            <h2 id="fallback-title">Some notation needs attention</h2>
            <p>The standard PDF export is paused so unsupported notation cannot disappear silently.</p>
            <ul>
              {errors.slice(0, 4).map((item) => (
                <li key={item.id}>{item.message}</li>
              ))}
            </ul>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => {
                  setShowFallback(false);
                  textarea.current?.focus();
                }}
              >
                Review source
              </button>
              <button type="button" className="danger-secondary" onClick={() => exportFile('pdf', true)}>
                Export with source fallbacks
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function safeName(title: string) {
  return (
    title
      .trim()
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'notes'
  );
}

function unwrapDocumentSource(source: string) {
  return source.trim().match(/^(`{3,}|~{3,})(?:markdown|md)\s*\n([\s\S]*?)\n\1$/i)?.[2] ?? null;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
