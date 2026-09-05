import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertCircle,
  Check,
  Columns,
  Download,
  ExternalLink,
  Eye,
  FileDown,
  FileText,
  FlaskConical,
  LoaderCircle,
  PenLine,
  RotateCcw,
  Sigma,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import { DEFAULT_SETTINGS, type ConvertedDocument, type Diagnostic, type DocumentSettings } from './core/types';
import { EDGE_CASE_SAMPLE, RASGAP_SAMPLE, SCIENCE_SAMPLE } from './core/samples';
import './styles.css';

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
  const [busy, setBusy] = useState(false);

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
    if (!source.trim()) {
      setBusy(false);
      setError('');
      setResult(undefined);
      return;
    }
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
  const [source, setSource] = useState('');
  const [settings, setSettings] = useState<DocumentSettings>({ ...DEFAULT_SETTINGS, title: '' });
  const [outputMode, setOutputMode] = useState<'formatted' | 'plain'>('formatted');
  const [mobileTab, setMobileTab] = useState<'editor' | 'preview' | 'both'>('editor');
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
      if (titleFromMarkdown && (!settings.title || settings.title === DEFAULT_SETTINGS.title)) {
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
      // Open Google Drive synchronously in direct user click turn to avoid browser popup blockers
      window.open('https://drive.google.com', '_blank');
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
        setGDocsHelpOpen(true);
        notify('Google Drive opened! Document downloaded with all equations ready.');
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
    setSettings((s) => ({ ...s, title: '' }));
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
        notify('Markdown code block formatting removed');
      }
    }
  }

  const wordCount = result?.stats.words ?? 0;
  const charCount = [...source].length;
  const readTime = Math.max(1, Math.ceil(wordCount / 200));

  const hasIssues = errors.length > 0 || warnings.length > 0;
  const statusLabel = useMemo(() => {
    if (!source.trim()) return 'Waiting for notes…';
    if (busy) return 'Formatting notes…';
    if (error) return 'Render error';
    if (errors.length > 0) return `${errors.length} issue${errors.length === 1 ? '' : 's'} (view)`;
    if (warnings.length > 0) return `${warnings.length} formatting tip${warnings.length === 1 ? '' : 's'} (view)`;
    return 'All clear · Ready to download';
  }, [source, busy, error, errors.length, warnings.length]);

  function handleStatusClick() {
    if (hasIssues) {
      issuesRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  return (
    <div className="bg-[#f5f7fb] text-slate-800 antialiased font-sans min-h-[100dvh] flex flex-col flex-1 overflow-x-hidden">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200/80 px-4 sm:px-6 lg:px-10 py-2.5">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between">
          {/* Logo and App Title */}
          <div className="flex items-center gap-3">
            <a href="#top" className="flex items-center gap-2.5 sm:gap-3 group">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-tr from-indigo-900 via-indigo-700 to-indigo-500 flex items-center justify-center shadow-sm text-white overflow-hidden p-0.5 shrink-0">
                <img src="/logo.png" alt="MD2TXT" className="w-full h-full object-cover rounded-[10px]" />
              </div>
              <div>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span className="font-bold text-slate-900 tracking-tight text-sm sm:text-base leading-none">MD2TXT</span>
                  <span className="text-[9px] sm:text-[10px] font-semibold bg-indigo-50 text-brand-600 px-1.5 py-0.5 rounded tracking-wide border border-indigo-100">
                    BETA
                  </span>
                </div>
                <p className="hidden sm:block text-[11px] text-slate-500 leading-tight mt-0.5 font-normal">AI Notes to Beautiful Docs</p>
              </div>
            </a>
          </div>

          {/* Center Status Pill */}
          <button
            type="button"
            onClick={handleStatusClick}
            className={`hidden md:flex items-center gap-2 text-xs font-medium px-3.5 py-1.5 rounded-full border transition-colors ${
              errors.length || error
                ? 'bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100'
                : busy
                  ? 'bg-slate-100 border-slate-200 text-slate-700'
                  : !source.trim()
                    ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-default'
                    : hasIssues
                      ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100 cursor-pointer'
                      : 'bg-emerald-50/70 border-emerald-200/80 text-emerald-800 hover:bg-emerald-100/70 cursor-pointer'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                errors.length || error
                  ? 'bg-rose-500'
                  : busy
                    ? 'bg-slate-400'
                    : !source.trim()
                      ? 'bg-slate-300'
                      : 'bg-emerald-500 animate-pulse'
              }`}
            />
            {busy ? (
              <LoaderCircle className="w-3.5 h-3.5 spin" />
            ) : errors.length || error ? (
              <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
            ) : !source.trim() ? (
              <FileText className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[2.5]" />
            )}
            <span>{statusLabel}</span>
          </button>

          {/* Right Action Button */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => startDownloadPrompt('pdf')}
              disabled={!source.trim() || busy}
              className="inline-flex items-center gap-1.5 sm:gap-2 bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white text-xs font-semibold px-3 sm:px-4 py-2 rounded-lg shadow-sm shadow-brand-500/20 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0"
            >
              <FileDown className="w-4 h-4" />
              <span><span className="hidden sm:inline">Download </span>PDF</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main id="top" className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-10 py-8 lg:py-10 space-y-8">
        {/* Hero Section */}
        <section className="grid grid-cols-1 lg:grid-cols-[1fr_360px] xl:grid-cols-[1fr_380px] gap-10 lg:gap-14 items-center pt-2 pb-4">
          {/* Left Column: Copy & Samples */}
          <div className="space-y-4 sm:space-y-5">
            <div className="inline-flex items-center gap-2 text-xs font-bold tracking-[0.14em] text-brand-600 uppercase">
              <Sparkles className="w-3.5 h-3.5" />
              <span>DESIGNED FOR STUDENTS, RESEARCHERS &amp; LEARNERS</span>
            </div>

            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-[56px] tracking-tight font-extrabold text-slate-900 leading-[1.08]">
              Your notes, <br />
              <span className="italic-serif text-brand-500 font-normal tracking-normal text-[1.12em]">
                beautifully translated.
              </span>
            </h1>

            <p className="text-slate-600 text-sm sm:text-base md:text-lg leading-relaxed max-w-2xl font-normal">
              Paste Markdown from Gemini, ChatGPT, Claude, or any AI tool. Keep every math formula, chemistry equation,
              table, and formatted detail clean and readable.
            </p>

            {/* Quick Sample Buttons & Clear Option */}
            <div className="pt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500 font-semibold mr-1">Try sample:</span>
              <button
                type="button"
                onClick={() => {
                  setSource(SCIENCE_SAMPLE);
                  setSettings((s) => ({ ...s, title: 'Science & Chemistry Notes' }));
                  notify('Loaded Science sample');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white text-slate-700 border border-slate-200 hover:border-indigo-300 hover:text-brand-600 shadow-xs transition-colors cursor-pointer"
              >
                <FlaskConical className="w-3.5 h-3.5 text-indigo-500" />
                <span>Science &amp; Chem</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSource(RASGAP_SAMPLE);
                  setSettings((s) => ({ ...s, title: 'Cell Biology - RasGAP Pathway' }));
                  notify('Loaded Biology sample');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white text-slate-700 border border-slate-200 hover:border-indigo-300 hover:text-brand-600 shadow-xs transition-colors cursor-pointer"
              >
                <span>🧬</span>
                <span>Biology &amp; Pathways</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSource(EDGE_CASE_SAMPLE);
                  setSettings((s) => ({ ...s, title: 'Math & Equations Sheet' }));
                  notify('Loaded Math sample');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white text-slate-700 border border-slate-200 hover:border-indigo-300 hover:text-brand-600 shadow-xs transition-colors cursor-pointer"
              >
                <Sigma className="w-3.5 h-3.5 text-indigo-500 stroke-[2.5]" />
                <span>Math &amp; Equations</span>
              </button>

              {/* Clear / Start Fresh Option */}
              {source.trim() ? (
                <button
                  type="button"
                  onClick={() => {
                    clear();
                    notify('Notes cleared · Ready for your notes');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 shadow-xs transition-colors cursor-pointer"
                  title="Clear notes and start with a blank editor"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Clear sample</span>
                </button>
              ) : lastCleared ? (
                <button
                  type="button"
                  onClick={() => {
                    setSource(lastCleared);
                    notify('Restored previous notes');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-indigo-50 text-brand-600 border border-indigo-200 hover:bg-indigo-100 shadow-xs transition-colors cursor-pointer"
                  title="Restore cleared notes"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restore notes</span>
                </button>
              ) : null}
            </div>

            {/* Mobile Compact Stepper (< lg) */}
            <div className="lg:hidden grid grid-cols-3 gap-1.5 p-2 rounded-xl bg-white border border-slate-200/90 shadow-xs text-center mt-3">
              <div className="flex flex-col items-center py-1 min-w-0">
                <span className="w-4 h-4 rounded-full bg-slate-100 text-[10px] font-mono flex items-center justify-center font-bold text-slate-600 mb-0.5">1</span>
                <span className="text-[11px] font-bold text-slate-800 truncate w-full">Paste Notes</span>
                <span className="text-[9px] text-slate-400 truncate w-full">AI / Markdown</span>
              </div>
              <div className="flex flex-col items-center py-1 border-x border-slate-100 px-1 min-w-0">
                <span className="w-4 h-4 rounded-full bg-indigo-50 text-[10px] font-mono flex items-center justify-center font-bold text-brand-600 mb-0.5">2</span>
                <span className="text-[11px] font-bold text-slate-800 truncate w-full">Smart Format</span>
                <span className="text-[9px] text-slate-400 truncate w-full">Math &amp; Tables</span>
              </div>
              <div className="flex flex-col items-center py-1 min-w-0">
                <span className="w-4 h-4 rounded-full bg-indigo-600 text-[10px] font-mono flex items-center justify-center font-bold text-white mb-0.5">3</span>
                <span className="text-[11px] font-bold text-brand-700 truncate w-full">Export Ready</span>
                <span className="text-[9px] text-slate-400 truncate w-full">PDF / Word / Docs</span>
              </div>
            </div>
          </div>

          {/* Right Column: Workflow Pipeline Stepper Card (Desktop Only) */}
          <div className="hidden lg:block">
            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-sm space-y-2">
              {/* Step 1: Input */}
              <div className="bg-slate-50/70 rounded-xl p-3.5 border border-slate-100">
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 block mb-0.5">Input</span>
                <div className="text-xs font-bold text-slate-800">Paste AI Notes</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Math, chemistry, lists &amp; tables</div>
              </div>

              {/* Down Arrow 1 */}
              <div className="flex justify-center text-slate-300">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M19 14l-7 7m0 0l-7-7m7 7V3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              {/* Step 2: Engine */}
              <div className="bg-slate-50/70 rounded-xl p-3.5 border border-slate-100">
                <span className="text-[10px] uppercase tracking-wider font-bold text-brand-600 block mb-0.5">Engine</span>
                <div className="text-xs font-bold text-slate-800">Smart Formatter</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Renders formulas &amp; typography cleanly</div>
              </div>

              {/* Down Arrow 2 */}
              <div className="flex justify-center text-slate-300">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M19 14l-7 7m0 0l-7-7m7 7V3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              {/* Step 3: Output */}
              <div className="bg-indigo-50/60 rounded-xl p-3.5 border border-indigo-100">
                <span className="text-[10px] uppercase tracking-wider font-bold text-brand-600 block mb-0.5">Output</span>
                <div className="text-xs font-bold text-brand-700">PDF &bull; Word &bull; Google Docs</div>
                <div className="text-[11px] text-slate-600 mt-0.5">Clean downloads ready to submit or share</div>
              </div>
            </div>
          </div>
        </section>

        {/* Document Settings Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-2.5 sm:px-4 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 text-xs">
          {/* Document Title Input */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <FileText className="w-4 h-4 text-brand-500 shrink-0" />
            <input
              aria-label="Document Title"
              className="font-semibold text-slate-800 bg-transparent border-0 focus:ring-0 p-0 text-xs sm:text-sm w-full focus:outline-none placeholder-slate-400 min-w-0"
              type="text"
              value={settings.title}
              onChange={(e) => setSettings({ ...settings, title: e.target.value })}
              placeholder="Enter document title..."
            />
          </div>

          {/* Controls & Format Toggles */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 sm:py-0">
            {/* Paper Size Toggle */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-[11px] font-medium text-slate-600 shrink-0">
              <button
                type="button"
                onClick={() => setSettings({ ...settings, paper: 'A4' })}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  settings.paper === 'A4' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'hover:text-slate-900'
                }`}
              >
                A4
              </button>
              <button
                type="button"
                onClick={() => setSettings({ ...settings, paper: 'Letter' })}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  settings.paper === 'Letter' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'hover:text-slate-900'
                }`}
              >
                Letter
              </button>
            </div>

            {/* Orientation Toggle */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-[11px] font-medium text-slate-600 shrink-0">
              <button
                type="button"
                onClick={() => setSettings({ ...settings, orientation: 'portrait' })}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  settings.orientation === 'portrait' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'hover:text-slate-900'
                }`}
              >
                Portrait
              </button>
              <button
                type="button"
                onClick={() => setSettings({ ...settings, orientation: 'landscape' })}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  settings.orientation === 'landscape' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'hover:text-slate-900'
                }`}
              >
                Landscape
              </button>
            </div>

            {/* Math Toggle Active Pill */}
            <button
              type="button"
              onClick={() => setSettings({ ...settings, singleDollarMath: !settings.singleDollarMath })}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors shrink-0 cursor-pointer ${
                settings.singleDollarMath
                  ? 'bg-indigo-50 border border-indigo-200/80 text-brand-600 hover:bg-indigo-100'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span>∑</span>
              <span>$ Math: {settings.singleDollarMath ? 'On' : 'Off'}</span>
            </button>

            {/* Margins & Size Button */}
            <button
              type="button"
              onClick={() => setShowAdvancedSettings((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-medium border transition-colors shrink-0 cursor-pointer ${
                showAdvancedSettings
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{showAdvancedSettings ? 'Close' : 'Margins'}</span>
            </button>
          </div>
        </div>

        {/* Expandable Margins & Size Drawer */}
        {showAdvancedSettings && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 -mt-4 shadow-sm flex flex-wrap items-center gap-6 text-xs text-slate-700">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-600">Base Font Size:</span>
              <input
                type="number"
                min="8"
                max="18"
                value={settings.fontSize}
                onChange={(e) => setSettings({ ...settings, fontSize: Number(e.target.value) })}
                className="w-16 h-8 text-center rounded-lg border border-slate-200 text-xs font-semibold"
              />
              <span className="text-slate-400">pt</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-600">Page Margins:</span>
              <input
                type="number"
                min="8"
                max="35"
                value={settings.margin}
                onChange={(e) => setSettings({ ...settings, margin: Number(e.target.value) })}
                className="w-16 h-8 text-center rounded-lg border border-slate-200 text-xs font-semibold"
              />
              <span className="text-slate-400">mm</span>
            </div>

            <button
              type="button"
              onClick={() => setShowAdvancedSettings(false)}
              className="ml-auto p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 cursor-pointer"
              aria-label="Close drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Mobile View Switcher (< lg) */}
        <div className="lg:hidden flex items-center justify-between p-1 bg-slate-200/80 rounded-xl text-xs font-medium gap-1">
          <button
            type="button"
            onClick={() => setMobileTab('editor')}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all cursor-pointer ${
              mobileTab === 'editor'
                ? 'bg-editor-bg text-white shadow-xs font-semibold'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            <PenLine className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Editor</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileTab('preview')}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all cursor-pointer ${
              mobileTab === 'preview'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            <Eye className="w-3.5 h-3.5 text-brand-600 shrink-0" />
            <span className="truncate">Live Preview</span>
            {result?.stats.equations ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-brand-600 font-bold shrink-0">
                {result.stats.equations}∑
              </span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => setMobileTab('both')}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all cursor-pointer ${
              mobileTab === 'both'
                ? 'bg-indigo-600 text-white shadow-xs font-semibold'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            <Columns className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Split Both</span>
          </button>
        </div>

        {/* Dual Pane Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-2 rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
          {/* LEFT PANE: Editor (Dark Canvas) */}
          <div
            className={`${
              mobileTab === 'preview' ? 'hidden lg:flex' : 'flex'
            } bg-editor-bg flex-col border-b lg:border-b-0 lg:border-r border-slate-800`}
          >
            {/* Left Pane Header & Toolbar */}
            <div className="bg-editor-toolbar px-3 sm:px-4 py-2 sm:py-2.5 border-b border-editor-border flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-mono font-bold bg-slate-700/60 text-slate-300 px-1.5 py-0.5 rounded">
                  01
                </span>
                <span className="text-xs font-semibold text-slate-200">Markdown Notes</span>
              </div>

              {/* Markdown Actions Toolbar */}
              <div className="flex items-center gap-1 text-slate-400 shrink-0">
                <div className="flex items-center bg-slate-800/80 rounded-lg p-0.5 border border-slate-700/60 text-xs">
                  <button
                    type="button"
                    onClick={() => insertFormatting('**', '**', 'bold text')}
                    className="w-6 h-6 flex items-center justify-center hover:text-white font-bold cursor-pointer"
                    title="Bold (**text**)"
                  >
                    B
                  </button>
                  <button
                    type="button"
                    onClick={() => insertFormatting('*', '*', 'italic text')}
                    className="w-6 h-6 flex items-center justify-center hover:text-white italic font-serif cursor-pointer"
                    title="Italic (*text*)"
                  >
                    I
                  </button>
                  <button
                    type="button"
                    onClick={() => insertFormatting('`', '`', 'code')}
                    className="w-6 h-6 flex items-center justify-center hover:text-white font-mono text-[10px] cursor-pointer"
                    title="Code (`code`)"
                  >
                    &lt;&gt;
                  </button>
                  <button
                    type="button"
                    onClick={() => insertFormatting('$', '$', '\\alpha + \\beta')}
                    className="w-6 h-6 flex items-center justify-center hover:text-white text-xs font-serif cursor-pointer"
                    title="Math Formula ($...$)"
                  >
                    ∑
                  </button>
                  <button
                    type="button"
                    onClick={() => insertFormatting('> ', '', 'quoted thought')}
                    className="w-6 h-6 flex items-center justify-center hover:text-white font-serif text-sm leading-none cursor-pointer"
                    title="Quote (>)"
                  >
                    &rdquo;
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      insertFormatting('| Column 1 | Column 2 |\n| :--- | :--- |\n| Item A | Value 1 |\n', '', '')
                    }
                    className="w-6 h-6 flex items-center justify-center hover:text-white cursor-pointer"
                    title="Table"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <rect height="18" rx="2" width="18" x="3" y="3" />
                      <line x1="3" x2="21" y1="9" y2="9" />
                      <line x1="9" x2="9" y1="21" y2="21" />
                    </svg>
                  </button>
                </div>

                <div className="h-4 w-px bg-slate-700 mx-1" />

                {/* Utility Buttons */}
                <button
                  type="button"
                  onClick={paste}
                  className="flex items-center gap-1 text-[11px] font-medium text-slate-300 hover:text-white px-2 py-1 rounded hover:bg-slate-800 cursor-pointer"
                >
                  <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>Paste</span>
                </button>

                <input
                  ref={fileInput}
                  hidden
                  type="file"
                  accept=".md,.markdown,.txt,text/plain,text/markdown"
                  onChange={(e) => loadFile(e.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="flex items-center gap-1 text-[11px] font-medium text-slate-300 hover:text-white px-2 py-1 rounded hover:bg-slate-800 cursor-pointer"
                >
                  <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>Upload</span>
                </button>

                <button
                  type="button"
                  onClick={clear}
                  className="p-1 text-slate-400 hover:text-rose-400 rounded cursor-pointer"
                  title="Clear Editor"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Left Pane Textarea */}
            <div className="flex-1 flex flex-col">
              <textarea
                ref={textarea}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                spellCheck={false}
                placeholder={'Paste your AI notes here…\n\nFormulas like $E=mc^2$ or chemical equations render instantly.'}
                aria-label="Markdown input"
                className="w-full flex-1 p-4 sm:p-5 font-mono text-[13px] leading-relaxed text-editor-text bg-editor-bg border-0 outline-none resize-none min-h-[380px] sm:min-h-[420px] focus:ring-0"
              />
            </div>

            {/* Left Pane Footer Bar */}
            <div className="px-3 sm:px-4 py-2 bg-[#121721] border-t border-editor-border text-[11px] text-slate-400 flex items-center justify-between">
              <div className="flex items-center gap-2 sm:gap-3">
                <span>{charCount.toLocaleString()} chars</span>
                <span>&bull;</span>
                <span>{wordCount.toLocaleString()} words</span>
                <span className="hidden sm:inline">&bull;</span>
                <span className="hidden sm:inline">~{readTime} min read</span>
              </div>
              <div className="flex items-center gap-2">
                {lastCleared && !source && (
                  <button
                    type="button"
                    onClick={() => {
                      setSource(lastCleared);
                      setLastCleared('');
                    }}
                    className="inline-flex items-center gap-1 text-indigo-300 hover:text-white cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" /> Undo clear
                  </button>
                )}
                {mobileTab === 'editor' && (
                  <button
                    type="button"
                    onClick={() => setMobileTab('preview')}
                    className="lg:hidden inline-flex items-center gap-1 text-indigo-400 font-semibold hover:text-indigo-300 cursor-pointer"
                  >
                    <span>Preview</span> &rarr;
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT PANE: Live Preview (Crisp White Canvas) */}
          <div
            className={`${
              mobileTab === 'editor' ? 'hidden lg:flex' : 'flex'
            } bg-white flex-col`}
          >
            {/* Right Pane Header & Actions */}
            <div className="bg-slate-50/90 px-3 sm:px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-bold bg-indigo-100 text-brand-600 px-1.5 py-0.5 rounded">
                  02
                </span>
                <span className="text-xs font-semibold text-slate-800">Live Preview</span>
              </div>

              {/* View Mode Toggle */}
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-slate-200/80 p-0.5 rounded-lg text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setOutputMode('formatted')}
                    className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-md transition-all cursor-pointer ${
                      outputMode === 'formatted'
                        ? 'bg-white text-slate-800 shadow-xs font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5 text-brand-500" />
                    <span>Formatted</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setOutputMode('plain')}
                    className={`inline-flex items-center gap-1 px-2.5 sm:px-3 py-1 rounded-md transition-all cursor-pointer ${
                      outputMode === 'plain'
                        ? 'bg-white text-slate-800 shadow-xs font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <line x1="4" x2="20" y1="6" y2="6" />
                      <line x1="4" x2="14" y1="12" y2="12" />
                      <line x1="4" x2="18" y1="18" y2="18" />
                    </svg>
                    <span>Clean Text</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Right Pane Content */}
            <div className={`p-4 sm:p-6 md:p-8 overflow-y-auto max-h-[600px] min-h-[380px] sm:min-h-[420px] bg-white ${busy ? 'opacity-65' : ''}`}>
              {error ? (
                <div className="flex flex-col items-center justify-center text-center p-8 text-slate-500 space-y-2">
                  <AlertCircle className="w-8 h-8 text-rose-500" />
                  <h3 className="font-bold text-slate-800 text-sm">Couldn’t render these notes</h3>
                  <p className="text-xs max-w-sm">{error}</p>
                </div>
              ) : !source ? (
                <div className="flex flex-col items-center justify-center text-center p-8 text-slate-400 space-y-2">
                  <FileText className="w-8 h-8 text-slate-300" />
                  <h3 className="font-bold text-slate-700 text-sm">Your document appears here</h3>
                  <p className="text-xs max-w-sm">Paste Markdown on the left or select a sample above to begin.</p>
                </div>
              ) : outputMode === 'formatted' ? (
                <article className="document-preview" dangerouslySetInnerHTML={{ __html: result?.html ?? '' }} />
              ) : (
                <pre className="font-mono text-[13px] leading-relaxed text-slate-800 whitespace-pre-wrap">
                  {result?.plainText}
                </pre>
              )}
            </div>

            {/* Right Pane Footer Bar */}
            <div className="px-3 sm:px-4 py-2 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 flex items-center justify-between">
              <div className="flex items-center gap-2 sm:gap-3">
                {mobileTab === 'preview' && (
                  <button
                    type="button"
                    onClick={() => setMobileTab('editor')}
                    className="lg:hidden inline-flex items-center gap-1 text-slate-700 font-semibold hover:text-slate-900 cursor-pointer mr-1"
                  >
                    &larr; <span>Edit</span>
                  </button>
                )}
                <span>
                  <strong>{wordCount.toLocaleString()}</strong> words
                </span>
                <span>&bull;</span>
                <span>
                  <strong>{result?.stats.equations ?? 0}</strong> formulas
                </span>
              </div>
              <button
                type="button"
                onClick={() => copy(outputMode === 'formatted')}
                className="inline-flex items-center gap-1 text-slate-700 hover:text-brand-600 font-medium px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-[11px] transition-colors cursor-pointer"
              >
                {copiedMode === (outputMode === 'formatted' ? 'rich' : 'plain') ? (
                  <Check className="w-3 h-3 text-emerald-600" />
                ) : (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <rect height="13" rx="2" ry="2" width="13" x="9" y="9" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
                <span>{copiedMode === (outputMode === 'formatted' ? 'rich' : 'plain') ? 'Copied!' : 'Copy formatted'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Document Formatting Check */}
        {hasIssues && (
          <section ref={issuesRef} className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 text-blue-500">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" x2="12" y1="16" y2="12" />
                    <line x1="12" x2="12.01" y1="8" y2="8" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Document formatting check</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Your notes are safe. Review these suggestions before exporting.</p>
                </div>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full">
                {(result?.diagnostics ?? []).length} {(result?.diagnostics ?? []).length === 1 ? 'item' : 'items'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              {(result?.diagnostics ?? []).map((issue) => (
                <div
                  key={issue.id}
                  className={`rounded-xl p-4 space-y-1.5 flex gap-3 items-start border ${
                    issue.severity === 'error'
                      ? 'bg-rose-50/50 border-rose-200 text-rose-900'
                      : 'bg-amber-50/40 border-amber-200/70 text-slate-800'
                  }`}
                >
                  <div className={`mt-0.5 shrink-0 ${issue.severity === 'error' ? 'text-rose-500' : 'text-amber-500'}`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" x2="12" y1="16" y2="12" />
                      <line x1="12" x2="12.01" y1="8" y2="8" />
                    </svg>
                  </div>
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-900 capitalize">{issue.code.replace(/-/g, ' ')}</h4>
                      {issue.repair && (
                        <button
                          type="button"
                          onClick={() => repair(issue)}
                          className="text-[10px] font-bold text-brand-600 hover:text-brand-700 bg-white border border-brand-200 px-2 py-0.5 rounded cursor-pointer"
                        >
                          Fix
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-600 leading-normal">{issue.message}</p>
                    {issue.range && (
                      <button
                        type="button"
                        onClick={() => selectIssue(issue)}
                        className="text-[10px] text-slate-400 font-mono pt-1 hover:text-slate-600 block text-left cursor-pointer"
                      >
                        Line {issue.range.line}, column {issue.range.column} (click to jump)
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Export Section */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column Info */}
            <div className="lg:col-span-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-bold bg-indigo-50 text-brand-600 px-1.5 py-0.5 rounded border border-indigo-100">
                  03
                </span>
                <span className="text-[10px] tracking-wider uppercase font-bold text-slate-400">Download or Share</span>
              </div>
              <h3 className="text-2xl font-bold text-slate-900 leading-tight">Export in Your Preferred Format</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Save clean PDF files for submission and printing, Word documents for offline editing, or send directly to
                Google Docs.
              </p>
            </div>

            {/* Right Column Export Tiles */}
            <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Tile 1: PDF */}
              <button
                type="button"
                disabled={!source || busy || !!error || !!exporting}
                onClick={() => startDownloadPrompt('pdf')}
                className="group text-left p-4 rounded-xl bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white shadow-md shadow-brand-500/20 transition-all duration-150 flex items-start gap-3.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center shrink-0 mt-0.5">
                  {exporting === 'pdf' ? (
                    <LoaderCircle className="w-5 h-5 text-white spin" />
                  ) : (
                    <FileDown className="w-5 h-5 text-white" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm tracking-tight">Download PDF</span>
                    <span className="text-[9px] font-semibold bg-white/25 text-white px-1.5 py-0.5 rounded uppercase tracking-wider">
                      Print Ready
                    </span>
                  </div>
                  <p className="text-[11px] text-indigo-100 mt-1 leading-snug">Clean formulas, equations &amp; page layout</p>
                </div>
              </button>

              {/* Tile 2: Word (.docx) */}
              <button
                type="button"
                disabled={!source || busy || !!exporting}
                onClick={() => startDownloadPrompt('docx')}
                className="group text-left p-4 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 shadow-xs transition-all duration-150 flex items-start gap-3.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <div className="w-10 h-10 rounded-lg bg-slate-100 group-hover:bg-slate-200 flex items-center justify-center shrink-0 mt-0.5 transition-colors">
                  {exporting === 'docx' ? (
                    <LoaderCircle className="w-5 h-5 text-slate-600 spin" />
                  ) : (
                    <Download className="w-5 h-5 text-slate-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-800 tracking-tight">Download Word (.docx)</span>
                    <span className="text-[9px] font-semibold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase tracking-wider">
                      Word
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 leading-snug">Editable document with tables &amp; text</p>
                </div>
              </button>

              {/* Tile 3: Google Docs */}
              <button
                type="button"
                disabled={!source || busy || !!exporting}
                onClick={() => startDownloadPrompt('gdocs')}
                className="group text-left p-4 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 shadow-xs transition-all duration-150 flex items-start gap-3.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <div className="w-10 h-10 rounded-lg bg-sky-50 group-hover:bg-sky-100 flex items-center justify-center shrink-0 mt-0.5 transition-colors">
                  {exporting === 'gdocs' ? (
                    <LoaderCircle className="w-5 h-5 text-sky-600 spin" />
                  ) : (
                    <ExternalLink className="w-5 h-5 text-sky-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-800 tracking-tight">Export to Google Docs</span>
                    <span className="text-[9px] font-semibold bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded uppercase tracking-wider border border-sky-100">
                      Online
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 leading-snug">Opens Google Drive with all equations ready — zero manual paste</p>
                </div>
              </button>

              {/* Tile 4: Plain Text (.txt) */}
              <button
                type="button"
                disabled={!source || busy}
                onClick={downloadText}
                className="group text-left p-4 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 shadow-xs transition-all duration-150 flex items-start gap-3.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <div className="w-10 h-10 rounded-lg bg-slate-100 group-hover:bg-slate-200 flex items-center justify-center shrink-0 mt-0.5 transition-colors">
                  <Download className="w-5 h-5 text-slate-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-800 tracking-tight">Plain Text (.txt)</span>
                    <span className="text-[9px] font-semibold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase tracking-wider">
                      Text
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 leading-snug">Clean text notes without markdown</p>
                </div>
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-auto pt-8 pb-[max(2rem,calc(2rem+env(safe-area-inset-bottom,0px)))] border-t border-slate-200 bg-white text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 space-y-2">
          <p className="font-semibold text-slate-700">MD2TXT — AI Notes to Beautiful Documents</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 text-[11px] text-slate-400">
            <span>
              Crafted &amp; Developed by <strong className="text-slate-600 font-semibold">Ziad</strong>
            </span>
            <span className="hidden sm:inline">&bull;</span>
            <span>100% Client-side preview privacy &bull; Zero data retention</span>
          </div>
        </div>
      </footer>

      {notice && (
        <div className={`toast ${notice.type}`}>
          {notice.type === 'success' ? <Check className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
          <span>{notice.message}</span>
        </div>
      )}

      {/* Download Name Prompt Modal */}
      {downloadModal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDownloadModal(null)}>
          <div
            className="modal"
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
              <X className="w-4 h-4" />
            </button>
            <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center mb-3.5">
              {downloadModal.kind === 'pdf' ? (
                <FileDown className="w-5 h-5 text-brand-600" />
              ) : downloadModal.kind === 'docx' ? (
                <Download className="w-5 h-5 text-blue-600" />
              ) : (
                <ExternalLink className="w-5 h-5 text-sky-600" />
              )}
            </div>

            <h2 id="download-modal-title" className="text-lg font-bold text-slate-900">
              {downloadModal.kind === 'pdf'
                ? 'Save as PDF'
                : downloadModal.kind === 'docx'
                  ? 'Save as Word Document'
                  : 'Export to Google Docs'}
            </h2>
            <p className="text-xs text-slate-500 mt-1 mb-5">
              {downloadModal.kind === 'gdocs'
                ? 'Give your document a title. It will be copied to your clipboard and opened in Google Docs.'
                : 'Choose a filename for your download.'}
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleConfirmDownloadModal();
              }}
              className="space-y-4"
            >
              <div>
                <label htmlFor="file-name-input" className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Document Name
                </label>
                <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-brand-500">
                  <input
                    id="file-name-input"
                    type="text"
                    autoFocus
                    value={downloadModal.title}
                    onChange={(e) => setDownloadModal({ ...downloadModal, title: e.target.value })}
                    placeholder="Enter file name..."
                    className="flex-1 h-10 px-3 text-sm font-semibold text-slate-800 border-0 outline-none focus:ring-0"
                  />
                  <span className="px-3 text-xs font-bold text-slate-400 bg-slate-100 h-10 flex items-center border-l border-slate-200">
                    {downloadModal.kind === 'pdf' ? '.pdf' : downloadModal.kind === 'docx' ? '.docx' : 'Docs'}
                  </span>
                </div>
              </div>

              {downloadModal.kind === 'pdf' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Paper Size</label>
                    <select
                      value={downloadModal.paper}
                      onChange={(e) =>
                        setDownloadModal({ ...downloadModal, paper: e.target.value as any })
                      }
                      className="w-full h-9 rounded-lg border border-slate-300 text-xs px-2.5 bg-white"
                    >
                      <option value="A4">A4 Standard</option>
                      <option value="Letter">US Letter</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Orientation</label>
                    <select
                      value={downloadModal.orientation}
                      onChange={(e) =>
                        setDownloadModal({ ...downloadModal, orientation: e.target.value as any })
                      }
                      className="w-full h-9 rounded-lg border border-slate-300 text-xs px-2.5 bg-white"
                    >
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setDownloadModal(null)}
                  className="w-full sm:w-auto px-4 py-2.5 sm:py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer text-center"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-full sm:w-auto justify-center inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold px-4 py-2.5 sm:py-2 rounded-lg shadow-sm shadow-brand-500/20 transition-all cursor-pointer"
                >
                  {downloadModal.kind === 'pdf' ? (
                    <>
                      <FileDown className="w-3.5 h-3.5" /> Download PDF
                    </>
                  ) : downloadModal.kind === 'docx' ? (
                    <>
                      <Download className="w-3.5 h-3.5" /> Download Word Doc
                    </>
                  ) : (
                    <>
                      <ExternalLink className="w-3.5 h-3.5" /> Open Google Docs
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
            className="modal max-w-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gdocs-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setGDocsHelpOpen(false)} aria-label="Close">
              <X className="w-4 h-4" />
            </button>
            <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-3">
              <Check className="w-6 h-6 text-emerald-600 stroke-[2.5]" />
            </div>
            <h2 id="gdocs-title" className="text-lg font-bold text-slate-900">Ready for Google Docs</h2>
            <p className="text-xs text-slate-500 mt-1">
              Your document <span className="font-semibold text-slate-800">{safeName(settings.title || 'notes')}.docx</span> is downloaded with every math equation and chemistry formula fully rendered.
            </p>

            <div className="space-y-3.5 my-5 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  1
                </span>
                <div>
                  <strong className="text-xs text-slate-900 block font-semibold">Drop into Google Drive (Already Done — No Manual Paste!)</strong>
                  <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                    Simply drag the downloaded <code className="text-brand-600 font-mono text-[10px] bg-white px-1 py-0.5 rounded border border-slate-200">{safeName(settings.title || 'notes')}.docx</code> into your open <strong>Google Drive</strong> tab. Google Docs opens it natively with all formulas, tables, and notes already done — no manual pasting or broken LaTeX!
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-slate-400 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  2
                </span>
                <div>
                  <strong className="text-xs text-slate-900 block font-semibold">Or paste into a blank document</strong>
                  <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                    Formatted text is also copied to your clipboard. If you prefer a blank document, open a new doc and press <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded text-[10px] font-mono">⌘</kbd>+<kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded text-[10px] font-mono">V</kbd>.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 mt-4">
              <div className="flex items-center gap-2">
                <a
                  href="https://drive.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 sm:flex-initial justify-center inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg transition-colors cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                  <span>Google Drive</span>
                </a>
                <a
                  href="https://docs.new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 sm:flex-initial justify-center inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg transition-colors cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                  <span>docs.new</span>
                </a>
              </div>
              <button
                type="button"
                className="w-full sm:w-auto bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold px-4 py-2.5 sm:py-2 rounded-lg shadow-sm transition-colors cursor-pointer text-center"
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
            <button className="modal-close" onClick={() => setShowFallback(false)} aria-label="Close">
              <X className="w-4 h-4" />
            </button>
            <AlertCircle className="w-7 h-7 text-rose-600 mb-2" />
            <h2 id="fallback-title" className="text-lg font-bold text-slate-900">Review formula formatting</h2>
            <p className="text-xs text-slate-500 mt-1 mb-3">Some symbols or equations need attention so they don&apos;t disappear in the final PDF.</p>
            <ul className="text-xs text-slate-600 space-y-1 list-disc pl-5 max-h-36 overflow-auto mb-4">
              {errors.slice(0, 4).map((item) => (
                <li key={item.id}>{item.message}</li>
              ))}
            </ul>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                onClick={() => {
                  setShowFallback(false);
                  textarea.current?.focus();
                }}
              >
                Review notes
              </button>
              <button
                type="button"
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg cursor-pointer"
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
