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
  ExternalLink,
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
type ExportKind = 'pdf' | 'docx' | 'gdocs';

type DownloadModalState = {
  kind: ExportKind;
  title: string;
  paper: 'A4' | 'Letter';
  orientation: 'portrait' | 'landscape';
} | null;

function extractTitleFromMarkdown(text: string): string {
  const match = text.match(/^#\s+(.+)$/m);
  if (match && match[1]) {
    return match[1].trim().replace(/[^\p{L}\p{N}\s._-]+/gu, '').slice(0, 80);
  }
  return '';
}

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
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [exporting, setExporting] = useState<ExportKind>();
  const [showFallback, setShowFallback] = useState(false);
  const [copiedMode, setCopiedMode] = useState<string | null>(null);
  const [downloadModal, setDownloadModal] = useState<DownloadModalState>(null);
  const [gdocsHelpOpen, setGDocsHelpOpen] = useState(false);

  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const issuesRef = useRef<HTMLElement>(null);
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
      const text = await navigator.clipboard.readText();
      setSource(text);
      const titleFromMarkdown = extractTitleFromMarkdown(text);
      if (titleFromMarkdown && settings.title === DEFAULT_SETTINGS.title) {
        setSettings((s) => ({ ...s, title: titleFromMarkdown }));
      }
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

  function startDownloadPrompt(kind: ExportKind) {
    if (kind === 'pdf' && errors.length) {
      setShowFallback(true);
      return;
    }
    const currentTitle = settings.title.trim() || extractTitleFromMarkdown(source) || 'Notes';
    setDownloadModal({
      kind,
      title: currentTitle,
      paper: settings.paper,
      orientation: settings.orientation,
    });
  }

  async function performExport(
    kind: ExportKind,
    customSettings: DocumentSettings,
    allowFallback = false
  ) {
    if (kind === 'gdocs') {
      setExporting('gdocs');
      try {
        if (result && navigator.clipboard.write && window.ClipboardItem) {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html': new Blob([result.clipboardHtml], { type: 'text/html' }),
              'text/plain': new Blob([result.plainText], { type: 'text/plain' }),
            }),
          ]);
        }
        const response = await fetch('/api/export/docx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source, settings: customSettings, allowFallback }),
        });
        if (response.ok) {
          const blob = await response.blob();
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = `${safeName(customSettings.title)}.docx`;
          link.click();
          URL.revokeObjectURL(link.href);
        }
        window.open('https://docs.new', '_blank', 'noopener,noreferrer');
        setGDocsHelpOpen(true);
        notify('Google Docs opened in a new tab!');
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Could not prepare Google Docs export.', 'error');
      } finally {
        setExporting(undefined);
      }
      return;
    }

    setExporting(kind);
    try {
      const response = await fetch(`/api/export/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, settings: customSettings, allowFallback }),
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
      link.download = `${safeName(customSettings.title)}.${kind}`;
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

  function handleConfirmDownloadModal() {
    if (!downloadModal) return;
    const finalTitle = downloadModal.title.trim() || 'My-Notes';
    const updatedSettings: DocumentSettings = {
      ...settings,
      title: finalTitle,
      paper: downloadModal.paper,
      orientation: downloadModal.orientation,
    };
    setSettings(updatedSettings);
    const kind = downloadModal.kind;
    setDownloadModal(null);
    performExport(kind, updatedSettings);
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
        notify('Markdown code fences cleaned up');
      }
    }
  }

  const wordCount = result?.stats.words ?? 0;
  const charCount = [...source].length;
  const readTime = Math.max(1, Math.ceil(wordCount / 200));

  const hasIssues = errors.length > 0 || warnings.length > 0;
  const statusLabel = useMemo(() => {
    if (busy) return 'Formatting notes…';
    if (error) return 'Render error';
    if (errors.length > 0) return `${errors.length} issue${errors.length === 1 ? '' : 's'} (click to view)`;
    if (warnings.length > 0) return `${warnings.length} formatting tip${warnings.length === 1 ? '' : 's'} (view)`;
    return 'Ready to download';
  }, [busy, error, errors.length, warnings.length]);

  function handleStatusClick() {
    if (hasIssues) {
      issuesRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }

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

        <button
          type="button"
          className={`status-pill ${errors.length || error ? 'has-errors' : busy ? 'is-busy' : 'is-ready'} ${hasIssues ? 'is-interactive' : ''}`}
          onClick={handleStatusClick}
          title={hasIssues ? 'Click to jump to formatting notes' : 'Notes are valid and ready to export'}
        >
          <span className="status-dot"></span>
          {busy ? <LoaderCircle className="spin" /> : errors.length || error ? <AlertCircle /> : <Check />}
          <span>{statusLabel}</span>
        </button>

        <div className="header-actions">
          <button
            type="button"
            className="ghost-button quick-action"
            onClick={() => startDownloadPrompt('pdf')}
            disabled={!source || busy}
          >
            <FileDown /> <span>Download PDF</span>
          </button>
        </div>
      </header>

      <main id="top" className="workspace">
        <section className="hero">
          <div className="hero-content">
            <div className="eyebrow">
              <Sparkles /> Designed for students, researchers &amp; learners
            </div>
            <h1>
              Your notes,
              <br />
              <em>beautifully translated.</em>
            </h1>
            <p>
              Paste Markdown from Gemini, ChatGPT, Claude, or any AI tool. Keep every math formula, chemistry equation,
              table, and formatted detail clean and readable.
            </p>

            <div className="sample-chips" aria-label="Load sample documents">
              <span className="sample-label">Try sample:</span>
              <button
                type="button"
                className="sample-chip"
                onClick={() => {
                  setSource(SCIENCE_SAMPLE);
                  setSettings((s) => ({ ...s, title: 'Science & Chemistry Notes' }));
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
                  setSettings((s) => ({ ...s, title: 'Cell Biology - RasGAP Pathway' }));
                  notify('Loaded Biology sample');
                }}
              >
                🧬 Biology &amp; Pathways
              </button>
              <button
                type="button"
                className="sample-chip"
                onClick={() => {
                  setSource(EDGE_CASE_SAMPLE);
                  setSettings((s) => ({ ...s, title: 'Math & Equations Sheet' }));
                  notify('Loaded Math sample');
                }}
              >
                <Sigma /> Math &amp; Equations
              </button>
            </div>
          </div>

          <div className="flow-card">
            <div className="flow-step">
              <span className="flow-tag">INPUT</span>
              <strong>Paste AI Notes</strong>
              <small>Math, chemistry, lists &amp; tables</small>
            </div>
            <div className="flow-arrow">
              <ArrowDown />
            </div>
            <div className="flow-step">
              <span className="flow-tag engine">ENGINE</span>
              <strong>Smart Formatter</strong>
              <small>Renders formulas &amp; typography cleanly</small>
            </div>
            <div className="flow-arrow">
              <ArrowDown />
            </div>
            <div className="flow-step highlight">
              <span className="flow-tag ready">OUTPUT</span>
              <strong>PDF &bull; Word &bull; Google Docs</strong>
              <small>Clean downloads ready to submit or share</small>
            </div>
          </div>
        </section>

        {/* Convenient Document Bar right above the workspace */}
        <section className="document-bar" aria-label="Document settings and title">
          <div className="doc-title-wrapper">
            <FileText className="doc-icon" />
            <div className="doc-title-input-container">
              <label htmlFor="doc-title-input" className="sr-only">
                Document Title
              </label>
              <input
                id="doc-title-input"
                type="text"
                className="doc-title-input"
                value={settings.title}
                onChange={(e) => setSettings({ ...settings, title: e.target.value })}
                placeholder="Give your document a title (e.g. Biology Notes)..."
                title="Click to rename document"
              />
            </div>
          </div>

          <div className="doc-settings-pills">
            <div className="pill-group" title="Page size for PDF">
              <button
                type="button"
                className={`pill-btn ${settings.paper === 'A4' ? 'active' : ''}`}
                onClick={() => setSettings({ ...settings, paper: 'A4' })}
              >
                A4
              </button>
              <button
                type="button"
                className={`pill-btn ${settings.paper === 'Letter' ? 'active' : ''}`}
                onClick={() => setSettings({ ...settings, paper: 'Letter' })}
              >
                Letter
              </button>
            </div>

            <div className="pill-group" title="Page orientation">
              <button
                type="button"
                className={`pill-btn ${settings.orientation === 'portrait' ? 'active' : ''}`}
                onClick={() => setSettings({ ...settings, orientation: 'portrait' })}
              >
                Portrait
              </button>
              <button
                type="button"
                className={`pill-btn ${settings.orientation === 'landscape' ? 'active' : ''}`}
                onClick={() => setSettings({ ...settings, orientation: 'landscape' })}
              >
                Landscape
              </button>
            </div>

            <button
              type="button"
              className={`pill-btn toggle-pill ${settings.singleDollarMath ? 'active' : ''}`}
              onClick={() => setSettings({ ...settings, singleDollarMath: !settings.singleDollarMath })}
              title="Recognize $...$ single-dollar inline math formulas"
            >
              <Sigma className="pill-icon" />
              <span>$ Math: {settings.singleDollarMath ? 'On' : 'Off'}</span>
            </button>

            <button
              type="button"
              className={`pill-btn more-settings ${showAdvancedSettings ? 'active' : ''}`}
              onClick={() => setShowAdvancedSettings((v) => !v)}
              title="Adjust text size and margins"
            >
              <Settings2 className="pill-icon" />
              <span>{showAdvancedSettings ? 'Close' : 'Margins & Size'}</span>
            </button>
          </div>
        </section>

        {showAdvancedSettings && (
          <section className="settings-drawer" aria-label="Page margins and text size">
            <div className="drawer-row">
              <label>
                <span>Text size</span>
                <input
                  type="number"
                  min="8"
                  max="18"
                  value={settings.fontSize}
                  onChange={(e) => setSettings({ ...settings, fontSize: Number(e.target.value) })}
                />
              </label>
              <label>
                <span>Page Margins (mm)</span>
                <input
                  type="number"
                  min="8"
                  max="35"
                  value={settings.margin}
                  onChange={(e) => setSettings({ ...settings, margin: Number(e.target.value) })}
                />
              </label>
              <button
                type="button"
                className="close-drawer-btn"
                onClick={() => setShowAdvancedSettings(false)}
                aria-label="Close settings"
              >
                <X />
              </button>
            </div>
          </section>
        )}

        <section className="converter-card">
          <div className="panel editor-panel">
            <div className="panel-header">
              <div className="panel-title-group">
                <span className="step">01</span>
                <h2>Markdown Notes</h2>
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
                    onClick={() => insertFormatting('> ', '', 'quoted text')}
                    title="Quote (>)"
                  >
                    <Quote />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      insertFormatting('| Column 1 | Column 2 |\n| :--- | :--- |\n| Item A | Value 1 |\n', '', '')
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
              placeholder={'Paste your AI notes here…\n\nFormulas like $E=mc^2$ or chemical equations render instantly.'}
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
                <h2>Live Preview</h2>
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
                  <strong>{result?.stats.equations ?? 0}</strong> formulas
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

        {hasIssues && (
          <section ref={issuesRef} className="issues-card">
            <div className="issues-heading">
              <div className="issues-title">
                <Info />
                <div>
                  <h2>Document formatting check</h2>
                  <p>Your notes are safe. Review these suggestions before exporting.</p>
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
              <span className="step">03</span> Download or Share
            </div>
            <h2>Export in Your Preferred Format</h2>
            <p>
              Save clean PDF files for submission and printing, Word documents for offline editing, or send directly
              to Google Docs.
            </p>
          </div>

          <div className="export-actions">
            <button
              type="button"
              className="export-btn primary-export"
              disabled={!source || busy || !!error || !!exporting}
              onClick={() => startDownloadPrompt('pdf')}
            >
              <div className="export-icon-box">
                {exporting === 'pdf' ? <LoaderCircle className="spin" /> : <FileDown />}
              </div>
              <div className="export-label">
                <div className="export-top">
                  <b>Download PDF</b>
                  <span className="format-tag prime">Print Ready</span>
                </div>
                <small>Clean formulas, equations &amp; page layout</small>
              </div>
            </button>

            <button
              type="button"
              className="export-btn secondary-export"
              disabled={!source || busy || !!exporting}
              onClick={() => startDownloadPrompt('docx')}
            >
              <div className="export-icon-box">
                {exporting === 'docx' ? <LoaderCircle className="spin" /> : <Download />}
              </div>
              <div className="export-label">
                <div className="export-top">
                  <b>Download Word (.docx)</b>
                  <span className="format-tag">Word</span>
                </div>
                <small>Editable document with tables &amp; text</small>
              </div>
            </button>

            <button
              type="button"
              className="export-btn secondary-export gdocs-btn"
              disabled={!source || busy || !!exporting}
              onClick={() => startDownloadPrompt('gdocs')}
              title="Open directly in Google Docs"
            >
              <div className="export-icon-box gdocs-icon">
                {exporting === 'gdocs' ? <LoaderCircle className="spin" /> : <ExternalLink />}
              </div>
              <div className="export-label">
                <div className="export-top">
                  <b>Export to Google Docs</b>
                  <span className="format-tag gdocs-badge">Online</span>
                </div>
                <small>Copies formatted notes &amp; opens docs.new</small>
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
                  <span className="format-tag">Text</span>
                </div>
                <small>Clean text notes without markdown</small>
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
              Built for students and educators to turn messy AI study notes into clean, publication-ready documents with
              accurate math and science formulas.
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
          <span className="footer-stats-note">Fast serverless export &bull; Works completely offline in your browser</span>
        </div>
      </footer>

      {notice && (
        <div className={`toast ${notice.type}`}>
          {notice.type === 'success' ? <Check /> : <AlertCircle />}
          <span>{notice.message}</span>
        </div>
      )}

      {/* Download Name Prompt Modal */}
      {downloadModal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDownloadModal(null)}>
          <div
            className="modal download-prompt-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="download-modal-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setDownloadModal(null)}
              aria-label="Close download window"
            >
              <X />
            </button>
            <div className="modal-header-icon">
              {downloadModal.kind === 'pdf' ? (
                <FileDown className="modal-icon-pdf" />
              ) : downloadModal.kind === 'docx' ? (
                <Download className="modal-icon-docx" />
              ) : (
                <ExternalLink className="modal-icon-gdocs" />
              )}
            </div>

            <h2 id="download-modal-title">
              {downloadModal.kind === 'pdf'
                ? 'Save as PDF'
                : downloadModal.kind === 'docx'
                  ? 'Save as Word Document'
                  : 'Export to Google Docs'}
            </h2>
            <p className="modal-subtitle">
              {downloadModal.kind === 'gdocs'
                ? 'Give your document a title. It will be copied to your clipboard and opened in Google Docs.'
                : 'Choose a filename for your download.'}
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleConfirmDownloadModal();
              }}
            >
              <div className="form-group">
                <label htmlFor="file-name-input">Document Name</label>
                <div className="filename-input-box">
                  <input
                    id="file-name-input"
                    type="text"
                    autoFocus
                    value={downloadModal.title}
                    onChange={(e) => setDownloadModal({ ...downloadModal, title: e.target.value })}
                    placeholder="Enter file name..."
                  />
                  <span className="filename-ext">
                    .{downloadModal.kind === 'pdf' ? 'pdf' : 'docx'}
                  </span>
                </div>
              </div>

              {downloadModal.kind === 'pdf' && (
                <div className="modal-options-row">
                  <div className="form-group half">
                    <label>Paper Size</label>
                    <select
                      value={downloadModal.paper}
                      onChange={(e) =>
                        setDownloadModal({ ...downloadModal, paper: e.target.value as any })
                      }
                    >
                      <option value="A4">A4 Standard</option>
                      <option value="Letter">US Letter</option>
                    </select>
                  </div>
                  <div className="form-group half">
                    <label>Orientation</label>
                    <select
                      value={downloadModal.orientation}
                      onChange={(e) =>
                        setDownloadModal({ ...downloadModal, orientation: e.target.value as any })
                      }
                    >
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="modal-actions">
                <button type="button" onClick={() => setDownloadModal(null)}>
                  Cancel
                </button>
                <button type="submit" className="primary-modal-btn">
                  {downloadModal.kind === 'pdf' ? (
                    <>
                      <FileDown className="btn-icon" /> Download PDF
                    </>
                  ) : downloadModal.kind === 'docx' ? (
                    <>
                      <Download className="btn-icon" /> Download Word Doc
                    </>
                  ) : (
                    <>
                      <ExternalLink className="btn-icon" /> Open Google Docs
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Google Docs Guide Modal */}
      {gdocsHelpOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setGDocsHelpOpen(false)}>
          <div
            className="modal gdocs-help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gdocs-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setGDocsHelpOpen(false)} aria-label="Close">
              <X />
            </button>
            <div className="gdocs-celebrate">
              <ExternalLink className="gdocs-big-icon" />
            </div>
            <h2 id="gdocs-title">Google Docs is ready!</h2>
            <p>A new tab has opened with a blank Google Doc.</p>

            <div className="gdocs-instructions">
              <div className="gdoc-instruction-step">
                <span className="step-number">1</span>
                <div>
                  <strong>Paste directly (Fastest)</strong>
                  <p>
                    Click inside the new Google Doc tab and press <kbd>Ctrl</kbd>+<kbd>V</kbd> (or <kbd>⌘</kbd>+<kbd>V</kbd> on Mac). Your formatted notes, tables, and formulas are already copied!
                  </p>
                </div>
              </div>

              <div className="gdoc-instruction-step">
                <span className="step-number">2</span>
                <div>
                  <strong>Or open the downloaded .docx</strong>
                  <p>
                    We also saved <code>{safeName(settings.title)}.docx</code> to your downloads. You can upload it to Google Drive to open as a document anytime.
                  </p>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="primary-modal-btn"
                onClick={() => setGDocsHelpOpen(false)}
              >
                Got it, thanks!
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fallback Warning Modal */}
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
            <h2 id="fallback-title">Review formula formatting</h2>
            <p>Some symbols or equations need attention so they don&apos;t disappear in the final PDF.</p>
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
                Review notes
              </button>
              <button
                type="button"
                className="danger-secondary"
                onClick={() => {
                  setShowFallback(false);
                  performExport('pdf', settings, true);
                }}
              >
                Download anyway
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
