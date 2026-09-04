import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertCircle, ArrowDown, Check, ChevronDown, Clipboard, Copy, Download, FileDown, FileText, FlaskConical, Info, LoaderCircle, RotateCcw, Settings2, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { DEFAULT_SETTINGS, type ConvertedDocument, type Diagnostic, type DocumentSettings } from './core/types';
import { SCIENCE_SAMPLE } from './core/samples';
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
      setBusy(false); setError(data.error ?? '');
      if (data.result) setResult(data.result);
    };
    worker.current.onerror = (event) => {
      setBusy(false); setError(`The document worker stopped: ${event.message || 'unknown browser error'}`);
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
      setBusy(true); setError('');
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
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { result, error, busy } = useConversion(source, settings);
  const errors = result?.diagnostics.filter((d) => d.severity === 'error') ?? [];
  const warnings = result?.diagnostics.filter((d) => d.severity === 'warning') ?? [];

  const notify = useCallback((message: string, type: Notice['type'] = 'success') => {
    setNotice({ message, type }); window.setTimeout(() => setNotice(undefined), 3200);
  }, []);

  async function paste() {
    try { setSource(await navigator.clipboard.readText()); notify('Pasted from clipboard'); }
    catch { notify('Clipboard access was denied. Paste with your keyboard instead.', 'error'); textarea.current?.focus(); }
  }
  async function copy(rich: boolean) {
    if (!result) return;
    try {
      if (rich && navigator.clipboard.write && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([result.clipboardHtml], { type: 'text/html' }),
          'text/plain': new Blob([result.plainText], { type: 'text/plain' }),
        })]);
      } else await navigator.clipboard.writeText(result.plainText);
      notify(rich ? 'Formatted notes copied' : 'Plain text copied');
    } catch { notify('Copy was blocked by your browser. Select the preview and copy manually.', 'error'); }
  }
  function downloadText() {
    if (!result) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([result.plainText], { type: 'text/plain;charset=utf-8' }));
    link.download = `${safeName(settings.title)}.txt`; link.click(); URL.revokeObjectURL(link.href); notify('Text file downloaded');
  }
  async function exportFile(kind: ExportKind, allowFallback = false) {
    if (kind === 'pdf' && errors.length && !allowFallback) { setShowFallback(true); return; }
    setExporting(kind);
    try {
      const response = await fetch(`/api/export/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, settings, allowFallback }) });
      if (!response.ok) {
        const problem = await response.json().catch(() => ({ message: 'Export failed.' }));
        if (response.status === 422) { setShowFallback(true); notify('Resolve the highlighted issues or use source fallbacks.', 'error'); return; }
        throw new Error(problem.message);
      }
      const blob = await response.blob();
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${safeName(settings.title)}.${kind}`; link.click(); URL.revokeObjectURL(link.href);
      setShowFallback(false); notify(`${kind.toUpperCase()} downloaded`);
    } catch (e) { notify(e instanceof Error ? e.message : 'Export failed.', 'error'); }
    finally { setExporting(undefined); }
  }
  function selectIssue(issue: Diagnostic) {
    if (!issue.range) return;
    textarea.current?.focus(); textarea.current?.setSelectionRange(issue.range.start, issue.range.end);
    textarea.current?.scrollTo({ top: Math.max(0, (issue.range.line - 3) * 24), behavior: 'smooth' });
  }
  function clear() { if (!source) return; setLastCleared(source); setSource(''); textarea.current?.focus(); }
  function loadFile(file?: File) {
    if (!file) return;
    if (!/\.(md|markdown|txt)$/i.test(file.name)) return notify('Choose a .md, .markdown, or .txt file.', 'error');
    if (file.size > 512 * 1024) return notify('The file is larger than 512 KB.', 'error');
    file.text().then((text) => { setSource(text); setSettings((s) => ({ ...s, title: file.name.replace(/\.[^.]+$/, '') })); });
  }
  function repair(issue: Diagnostic) {
    if (issue.repair === 'unwrap') { const unwrapped = unwrapDocumentSource(source); if (unwrapped !== null) { setSource(unwrapped); notify('Document fence unwrapped'); } }
  }

  const issueSummary = useMemo(() => errors.length ? `${errors.length} issue${errors.length === 1 ? '' : 's'} need attention` : warnings.length ? `${warnings.length} note${warnings.length === 1 ? '' : 's'}` : 'Ready to export', [errors.length, warnings.length]);

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#top" aria-label="MD2TXT home"><span className="brand-mark">M<span>↓</span>T</span><strong>MD2TXT</strong><span className="beta">BETA</span></a>
      <div className={`status-pill ${errors.length || error ? 'has-errors' : busy ? 'is-busy' : ''}`}>{busy ? <LoaderCircle className="spin"/> : errors.length || error ? <AlertCircle/> : <Check/>}<span>{busy ? 'Rendering…' : error ? 'Render error' : issueSummary}</span></div>
      <div className="header-actions"><button className="ghost-button" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}><Settings2/> Document</button></div>
    </header>

    <main id="top" className="workspace">
      <section className="hero">
        <div><div className="eyebrow"><Sparkles/> Built for AI study notes</div><h1>Your notes,<br/><em>beautifully translated.</em></h1><p>Paste Markdown from Gemini or any AI tool. Keep every equation, scientific symbol, list, and detail intact.</p></div>
        <div className="flow"><span>Markdown</span><ArrowDown/><span>Faithful document</span><ArrowDown/><strong>PDF · DOCX · TXT</strong></div>
      </section>

      {showSettings && <section className="settings-card" aria-label="Document settings">
        <label className="wide"><span>Document title</span><input value={settings.title} onChange={(e) => setSettings({ ...settings, title: e.target.value })}/></label>
        <label><span>Paper</span><select value={settings.paper} onChange={(e) => setSettings({ ...settings, paper: e.target.value as any })}><option>A4</option><option>Letter</option></select><ChevronDown/></label>
        <label><span>Orientation</span><select value={settings.orientation} onChange={(e) => setSettings({ ...settings, orientation: e.target.value as any })}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select><ChevronDown/></label>
        <label><span>Text size</span><input type="number" min="8" max="18" value={settings.fontSize} onChange={(e) => setSettings({ ...settings, fontSize: Number(e.target.value) })}/></label>
        <label><span>Margins (mm)</span><input type="number" min="8" max="35" value={settings.margin} onChange={(e) => setSettings({ ...settings, margin: Number(e.target.value) })}/></label>
        <label className="toggle-label"><input type="checkbox" checked={settings.singleDollarMath} onChange={(e) => setSettings({ ...settings, singleDollarMath: e.target.checked })}/><span className="toggle"/><span>Recognize $…$ math</span></label>
        <button className="close-settings" onClick={() => setShowSettings(false)} aria-label="Close settings"><X/></button>
      </section>}

      <section className="converter-card">
        <div className="panel editor-panel">
          <div className="panel-header"><div><span className="step">01</span><h2>Markdown</h2></div><div className="panel-tools"><button onClick={paste}><Clipboard/>Paste</button><button onClick={() => fileInput.current?.click()}><Upload/>Upload</button><button onClick={clear} aria-label="Clear input"><Trash2/></button></div></div>
          <input ref={fileInput} hidden type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" onChange={(e) => loadFile(e.target.files?.[0])}/>
          <textarea ref={textarea} value={source} onChange={(e) => setSource(e.target.value)} spellCheck={false} placeholder={'Paste your Markdown here…\n\nMath like $\\rightarrow$ will render as →'} aria-label="Markdown input"/>
          <div className="panel-footer"><span>{[...source].length.toLocaleString()} characters</span>{lastCleared && !source && <button onClick={() => { setSource(lastCleared); setLastCleared(''); }}><RotateCcw/>Undo clear</button>}<button className="sample-link" onClick={() => setSource(SCIENCE_SAMPLE)}><FlaskConical/>Load science sample</button></div>
        </div>

        <div className="panel preview-panel">
          <div className="panel-header"><div><span className="step">02</span><h2>Preview</h2></div><div className="segmented"><button className={outputMode === 'formatted' ? 'active' : ''} onClick={() => setOutputMode('formatted')}>Formatted</button><button className={outputMode === 'plain' ? 'active' : ''} onClick={() => setOutputMode('plain')}>Plain text</button></div></div>
          <div className={`preview-scroll ${busy ? 'updating' : ''}`}>
            {error ? <div className="empty-state error"><AlertCircle/><h3>Couldn’t render these notes</h3><p>{error}</p></div> : !source ? <div className="empty-state"><FileText/><h3>Your document appears here</h3><p>Paste Markdown or open the science sample to begin.</p></div> : outputMode === 'formatted' ? <article className="document-preview" dangerouslySetInnerHTML={{ __html: result?.html ?? '' }}/> : <pre className="plain-preview">{result?.plainText}</pre>}
          </div>
          <div className="panel-footer preview-meta"><span>{result?.stats.words.toLocaleString() ?? 0} words</span><span>{result?.stats.equations ?? 0} equations</span><button onClick={() => copy(outputMode === 'formatted')}><Copy/>{outputMode === 'formatted' ? 'Copy formatted' : 'Copy text'}</button></div>
        </div>
      </section>

      {(result?.diagnostics.length ?? 0) > 0 && <section className="issues-card">
        <div className="issues-heading"><div><Info/><div><h2>Source notes</h2><p>Your content remains untouched. Review these items before export.</p></div></div><span>{result!.diagnostics.length}</span></div>
        <div className="issue-list">{result!.diagnostics.map((issue) => <div key={issue.id} className={`issue ${issue.severity}`}>
          {issue.severity === 'error' ? <AlertCircle/> : <Info/>}<button className="issue-copy" onClick={() => selectIssue(issue)}><strong>{issue.code.replace(/-/g, ' ')}</strong><span>{issue.message}</span>{issue.range && <small>Line {issue.range.line}, column {issue.range.column}</small>}</button>{issue.repair && <button className="repair" onClick={() => repair(issue)}>Fix</button>}
        </div>)}</div>
      </section>}

      <section className="export-card">
        <div><span className="step">03</span><h2>Take it with you</h2><p>PDF keeps visual fidelity. DOCX keeps prose editable. TXT keeps a clean, portable copy.</p></div>
        <div className="export-actions"><button className="primary-export" disabled={!source || busy || !!error || !!exporting} onClick={() => exportFile('pdf')}><span>{exporting === 'pdf' ? <LoaderCircle className="spin"/> : <FileDown/>}<b>Download PDF</b><small>Best visual match</small></span></button><button disabled={!source || busy || !!exporting} onClick={() => exportFile('docx')}><Download/><span><b>DOCX</b><small>Editable prose</small></span></button><button disabled={!source || busy} onClick={downloadText}><Download/><span><b>Plain text</b><small>Unicode · .txt</small></span></button></div>
      </section>
    </main>

    <footer><strong>MD2TXT</strong><span>Private by design. Preview and copying stay in your browser; exports are processed temporarily.</span></footer>
    {notice && <div className={`toast ${notice.type}`}>{notice.type === 'success' ? <Check/> : <AlertCircle/>}{notice.message}</div>}
    {showFallback && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowFallback(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="fallback-title" onMouseDown={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setShowFallback(false)}><X/></button><AlertCircle className="modal-icon"/><h2 id="fallback-title">Some notation needs attention</h2><p>The normal PDF export is paused so unsupported notation cannot disappear silently.</p><ul>{errors.slice(0, 4).map((item) => <li key={item.id}>{item.message}</li>)}</ul><div className="modal-actions"><button onClick={() => { setShowFallback(false); textarea.current?.focus(); }}>Review source</button><button className="danger-secondary" onClick={() => exportFile('pdf', true)}>Export with source fallbacks</button></div></div></div>}
  </div>;
}

function safeName(title: string) { return title.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80) || 'notes'; }
function unwrapDocumentSource(source: string) { return source.trim().match(/^(`{3,}|~{3,})(?:markdown|md)\s*\n([\s\S]*?)\n\1$/i)?.[2] ?? null; }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
