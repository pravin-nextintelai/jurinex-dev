import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTemplateBuilderStore } from './templateBuilderStore';
import { templateBuilderApi } from './api';
import { customTemplateApi } from '@/features/template-drafting/user_custom_template/api';
import { AGENT_DRAFT_TEMPLATE_API, DRAFTING_SERVICE_URL } from '@/config/apiConfig.js';

interface GoogleDocsSession {
  draftId?: string;
  googleFileId?: string;
  editUrl?: string;
  iframeUrl?: string;
  iframeKey?: number;
}

function normalizeToGoogleEditUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    url.searchParams.delete('embedded');
    url.searchParams.delete('cb');
    return url.toString();
  } catch {
    return rawUrl
      .replace(/[?&]embedded=true/g, '')
      .replace(/[?&]cb=\d+/g, '');
  }
}

async function createDraftFromTemplate(templateId: string, title: string): Promise<string> {
  const { AGENT_DRAFT_TEMPLATE_API } = await import('@/config/apiConfig.js');
  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('auth_token') ||
    '';
  const res = await fetch(`${AGENT_DRAFT_TEMPLATE_API}/api/drafts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ template_id: templateId, title }),
  });
  if (!res.ok) throw new Error(`Failed to create draft (${res.status})`);
  const data = await res.json();
  const draftId = data?.draft?.draft_id ?? data?.draft_id;
  if (!draftId) throw new Error('Draft created but no draft ID returned');
  return draftId;
}

function decodeHtmlEntities(text: string): string {
  try {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    return doc.documentElement.textContent ?? text;
  } catch {
    return text;
  }
}

interface RenderedLine {
  type: 'heading' | 'text' | 'blank';
  content: string;
  level: number;
}

function parseLinesForRender(text: string): RenderedLine[] {
  return decodeHtmlEntities(text).split('\n').map((line) => {
    const stripped = line.trim();
    if (!stripped) return { type: 'blank', content: '', level: 0 };

    const mdMatch = stripped.match(/^(#{1,3})\s+(.+)$/);
    if (mdMatch) {
      const level = mdMatch[1].length === 1 ? 1 : 2;
      return { type: 'heading', content: mdMatch[2].replace(/\*\*/g, '').trim(), level };
    }

    const boldMatch = stripped.match(/^\*\*([^*]{4,})\*\*:?$/);
    if (boldMatch && !/__/.test(stripped)) {
      return { type: 'heading', content: boldMatch[1].trim(), level: 1 };
    }

    const numberedMain = stripped.match(/^(\d+)\.\s+([A-Z][A-Z0-9\s\/&,\-\(\)]{3,})$/);
    if (numberedMain) {
      return { type: 'heading', content: `${numberedMain[1]}. ${numberedMain[2]}`, level: 1 };
    }

    if (/^\d+\.\d+\.?\s+[A-Z]/.test(stripped)) {
      return { type: 'heading', content: stripped, level: 2 };
    }

    if (
      stripped.length >= 5 &&
      !/[a-z]/.test(stripped) &&
      !/__/.test(stripped) &&
      /^[A-Z][A-Z0-9\s\/&,\-\.\(\)]{4,}$/.test(stripped)
    ) {
      return { type: 'heading', content: stripped.replace(/:$/, ''), level: 1 };
    }

    return { type: 'text', content: line, level: 0 };
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function preservePlaceholderTokens(markdown: string): string {
  // Keep placeholders literal in markdown without rendering them as bold/code.
  return markdown.replace(/__([a-zA-Z][a-zA-Z0-9_]*)__/g, '\\_\\_$1\\_\\_');
}

function paginateMarkdownForPreview(markdown: string): string[] {
  const text = (markdown || '').trim();
  if (!text) return [''];

  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const estimateBlockCost = (block: string): number => {
    const lines = block.split('\n').filter(Boolean);
    const isTable = lines.some((l) => /^\s*\|.*\|\s*$/.test(l));
    if (isTable) return Math.max(4, Math.ceil(lines.length * 1.6));
    const chars = block.length;
    const softLines = Math.ceil(chars / 90);
    return Math.max(2, softLines);
  };

  const pageBudget = 34;
  const pages: string[] = [];
  let currentBlocks: string[] = [];
  let currentCost = 0;

  for (const block of blocks) {
    const cost = estimateBlockCost(block);
    if (currentBlocks.length > 0 && currentCost + cost > pageBudget) {
      pages.push(currentBlocks.join('\n\n'));
      currentBlocks = [];
      currentCost = 0;
    }
    currentBlocks.push(block);
    currentCost += cost;
  }

  if (currentBlocks.length > 0) {
    pages.push(currentBlocks.join('\n\n'));
  }

  return pages.length > 0 ? pages : [text];
}

function extractTextFromNode(node: any): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractTextFromNode).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return extractTextFromNode((node as any).props?.children);
  }
  return '';
}

function normalizeGoogleDocsSession(raw: Record<string, any> | null | undefined): GoogleDocsSession {
  const info = { ...(raw || {}) };
  const draftId = info?.draft?.id || info?.draft?.draftId || info?.draftId || info?.draft_id;
  const googleFileId = info?.google_file_id || info?.googleFileId || info?.draft?.googleFileId || info?.draft?.google_file_id;
  const baseUrl =
    info?.iframeUrl ||
    info?.iframe_url ||
    info?.draft?.iframeUrl ||
    info?.draft?.iframe_url ||
    info?.webViewLink ||
    info?.web_view_link ||
    (googleFileId ? `https://docs.google.com/document/d/${googleFileId}/edit` : undefined);

  let iframeUrl = baseUrl;
  if (iframeUrl) {
    iframeUrl = iframeUrl.includes('embedded=true')
      ? iframeUrl
      : `${iframeUrl}${iframeUrl.includes('?') ? '&' : '?'}embedded=true`;
    iframeUrl = `${iframeUrl}${iframeUrl.includes('?') ? '&' : '?'}cb=${Date.now()}`;
  }

  const editUrlFromBase = normalizeToGoogleEditUrl(baseUrl);
  const resolvedEditUrl = googleFileId
    ? `https://docs.google.com/document/d/${googleFileId}/edit`
    : editUrlFromBase;

  return {
    draftId: draftId ? String(draftId) : undefined,
    googleFileId: googleFileId ? String(googleFileId) : undefined,
    editUrl: resolvedEditUrl,
    iframeUrl,
    iframeKey: Date.now(),
  };
}

async function openGeneratedTemplateInGoogleDocs(fileName: string, html: string): Promise<GoogleDocsSession> {
  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('auth_token') ||
    '';

  const formData = new FormData();
  const htmlBlob = new Blob([html], { type: 'text/html' });
  formData.append('file', htmlBlob, `${fileName}.html`);
  formData.append('title', fileName);

  const res = await fetch(`${DRAFTING_SERVICE_URL}/api/drafts/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Failed to open in Google Docs (${res.status})`);
  }

  const session = normalizeGoogleDocsSession(data);

  if (!session.draftId && !session.googleFileId) {
    throw new Error('Google Docs file was created but no draft or file ID was returned.');
  }

  return session;
}

function renderInlineHtml(raw: string): string {
  return escapeHtml(raw).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function estimateLineCost(line: RenderedLine): number {
  if (line.type === 'blank') return 0.5;
  if (line.type === 'heading' && line.level === 1) return 3;
  if (line.type === 'heading' && line.level === 2) return 2;
  return Math.max(1, Math.ceil(line.content.trim().length / 95));
}

function renderedLineToHtml(line: RenderedLine): string {
  if (line.type === 'blank') return '<div style="height:8px"></div>';
  if (line.type === 'heading' && line.level === 1) {
    return `<div style="font-weight:bold;text-align:center;text-transform:uppercase;font-size:12pt;margin-top:14pt;margin-bottom:4pt;letter-spacing:0.02em">${renderInlineHtml(line.content)}</div>`;
  }
  if (line.type === 'heading' && line.level === 2) {
    return `<div style="font-weight:bold;font-size:12pt;margin-top:8pt;margin-bottom:2pt">${renderInlineHtml(line.content)}</div>`;
  }
  return `<div style="font-size:12pt;line-height:1.6;margin-bottom:3pt;text-align:justify">${renderInlineHtml(line.content)}</div>`;
}

const HighlightedLine: React.FC<{ text: string }> = ({ text }) => {
  const TOKEN_RE = /\*\*([^*]+)\*\*|__([A-Za-z][A-Za-z0-9_]*)__/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) parts.push(<strong key={match.index}>{match[1]}</strong>);
    else parts.push(<span key={match.index}>{match[0]}</span>);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
};

const SavedScreen: React.FC<{
  templateId: string;
  templateName: string;
  onReset: () => void;
}> = ({ templateId, templateName, onReset }) => {
  const navigate = useNavigate();
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const handleStartDraft = async () => {
    setDraftLoading(true);
    setDraftError(null);
    try {
      const draftId = await createDraftFromTemplate(templateId, `${templateName} - Draft`);
      navigate(`/draft-form/${draftId}`);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Failed to create draft');
      setDraftLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] py-16 px-8 text-center">
      <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
        <span className="text-4xl">✓</span>
      </div>
      <h2 className="text-2xl font-bold text-gray-800 mb-2">Template Saved!</h2>
      <p className="text-gray-600 mb-1">
        <strong>"{templateName}"</strong> has been sent through the template analyzer and saved to your library.
      </p>
      <p className="text-xs text-gray-400 mb-6 font-mono">ID: {templateId}</p>
      {draftError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{draftError}</p>}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleStartDraft}
          disabled={draftLoading}
          className={`px-8 py-3 rounded-xl font-bold text-base transition-all shadow-md ${draftLoading ? 'bg-gray-200 text-gray-400 cursor-wait' : 'text-white hover:shadow-lg'}`}
          style={draftLoading ? {} : { background: 'linear-gradient(135deg, #21C1B6 0%, #1AA49B 100%)' }}
        >
          {draftLoading ? 'Opening draft...' : 'Start Drafting with This Template'}
        </button>
        <button
          onClick={() => navigate('/draft-selection/templates')}
          className="px-5 py-2.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 rounded-xl font-semibold text-sm transition-all"
        >
          My Templates
        </button>
        <button
          onClick={onReset}
          className="px-5 py-2.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 rounded-xl font-semibold text-sm transition-all"
        >
          Build Another Template
        </button>
      </div>
    </div>
  );
};

export const GeneratedTemplateView: React.FC = () => {
  const navigate = useNavigate();
  const {
    generatedTemplateText,
    generationMetadata,
    requirements,
    phase,
    extractedFields,
    parsedSections,
    savedTemplateId,
    savedTemplateName,
    setSaveResult,
    reset,
  } = useTemplateBuilderStore();

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isOpeningGoogleDocs, setIsOpeningGoogleDocs] = useState(false);
  const [googleDocsOpenError, setGoogleDocsOpenError] = useState<string | null>(null);
  const [googleDocsSession, setGoogleDocsSession] = useState<GoogleDocsSession | null>(null);

  const lines = useMemo(() => parseLinesForRender(generatedTemplateText), [generatedTemplateText]);
  const renderedMarkdown = useMemo(
    () => preservePlaceholderTokens(generatedTemplateText || ''),
    [generatedTemplateText],
  );
  const markdownPages = useMemo(
    () => paginateMarkdownForPreview(renderedMarkdown),
    [renderedMarkdown],
  );
  const pages = useMemo(() => {
    const result: RenderedLine[][] = [];
    const pageBudget = 24; // Fewer lines per page after court margins increase
    let currentPage: RenderedLine[] = [];
    let currentBudget = 0;

    for (const line of lines) {
      const cost = estimateLineCost(line);
      if (currentBudget + cost > pageBudget && currentPage.length > 0) {
        result.push(currentPage);
        currentPage = [];
        currentBudget = 0;
      }
      currentPage.push(line);
      currentBudget += cost;
    }

    if (currentPage.length > 0) result.push(currentPage);
    return result;
  }, [lines]);

  const markdownComponents: any = {
    h1: ({ children }: any) => <h1 style={{ textAlign: 'center', textTransform: 'uppercase', fontSize: '18pt', margin: '10pt 0 12pt', fontWeight: 700 }}>{children}</h1>,
    h2: ({ children }: any) => <h2 style={{ fontSize: '14pt', margin: '14pt 0 8pt', fontWeight: 700 }}>{children}</h2>,
    h3: ({ children }: any) => <h3 style={{ fontSize: '12pt', margin: '10pt 0 6pt', fontWeight: 700 }}>{children}</h3>,
    p: ({ children }: any) => {
      const text = extractTextFromNode(children);
      const hasPlaceholder = /__[\w]+__/.test(text);
      return (
        <p
          style={{
            margin: '0 0 8pt',
            textAlign: hasPlaceholder ? 'left' : 'justify',
            lineHeight: 1.78,
            wordSpacing: 'normal',
          }}
        >
          {children}
        </p>
      );
    },
    hr: () => <hr style={{ border: 0, borderTop: '1px solid #d1d5db', margin: '12pt 0' }} />,
    table: ({ children }: any) => (
      <div style={{ overflowX: 'auto', margin: '10pt 0 14pt' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11pt' }}>{children}</table>
      </div>
    ),
    thead: ({ children }: any) => <thead style={{ background: '#f3f4f6' }}>{children}</thead>,
    th: ({ children, style }: any) => <th style={{ border: '1px solid #9ca3af', padding: '8px 10px', textAlign: style?.textAlign || 'left', verticalAlign: 'top', fontWeight: 700 }}>{children}</th>,
    td: ({ children, style }: any) => <td style={{ border: '1px solid #9ca3af', padding: '8px 10px', textAlign: style?.textAlign || 'left', verticalAlign: 'top' }}>{children}</td>,
    ul: ({ children }: any) => <ul style={{ listStyle: 'disc', paddingLeft: '1.6em', margin: '0.45em 0' }}>{children}</ul>,
    ol: ({ children }: any) => <ol style={{ listStyle: 'decimal', paddingLeft: '1.6em', margin: '0.45em 0' }}>{children}</ol>,
    li: ({ children }: any) => <li style={{ margin: '0.25em 0', lineHeight: 1.72 }}>{children}</li>,
    code: ({ inline, children }: any) =>
      inline ? (
        <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '1px 4px', color: '#111827' }}>
          {children}
        </code>
      ) : (
        <pre style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '10px 12px', overflowX: 'auto' }}>
          <code>{children}</code>
        </pre>
      ),
  };

  // Export as a single flowing document — Google Docs handles its own pagination.
  // Never inject "Page X of Y" as body text; never use CSS page-break hacks with flex containers.
  const exportHtml = useMemo(() => {
    const name = generationMetadata?.templateName || 'template';
    const bodyHtml = lines.map((line) => renderedLineToHtml(line)).join('\n');

    return `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(name)}</title>
  <!--[if gte mso 9]><xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml><![endif]-->
  <style>
    @page { margin: 1in 1in 1in 1.5in; size: A4; }
    body {
      font-family: "Times New Roman", Times, serif;
      font-size: 12pt;
      color: #000000;
      line-height: 1.6;
      margin: 0;
      padding: 0;
      background: #ffffff;
    }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`.trim();
  }, [generationMetadata, lines]);

  const handleSaveToLibrary = useCallback(async () => {
    if (!generatedTemplateText || isSaving) return;
    setIsSaving(true);
    setSaveError(null);

    try {
      const templateName = generationMetadata?.templateName || generationMetadata?.documentType || 'Generated Template';
      const result = await templateBuilderApi.saveGeneratedTemplate({
        templateText: generatedTemplateText,
        fields: extractedFields,
        sections: parsedSections,
        metadata: generationMetadata || {
          generatedAt: new Date().toISOString(),
          documentType: templateName,
          templateName,
          category: 'General',
          jurisdiction: 'India',
          language: 'English',
          totalFields: extractedFields.length,
          totalSections: parsedSections.length,
          model: 'unknown',
        },
        requirements: {
          ...requirements,
          exportHtml,
        },
      });
      const templateId = result.templateId;
      if (!templateId) {
        throw new Error('Template was saved but no template ID was returned.');
      }
      if (requirements.referenceDocuments.length > 0) {
        await customTemplateApi.uploadReferenceDocuments(templateId, requirements.referenceDocuments);
      }
      const ready = await customTemplateApi.waitForTemplateReady(templateId, 8000, 45);
      if (ready.status === 'error') {
        throw new Error('Template analysis failed while saving to library. Please retry.');
      }
      setSaveResult(templateId, templateName);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
      setIsSaving(false);
    }
  }, [exportHtml, extractedFields, generatedTemplateText, generationMetadata, isSaving, parsedSections, requirements, setSaveResult]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(generatedTemplateText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [generatedTemplateText]);

  const handleDownload = useCallback(async () => {
    const name = generationMetadata?.templateName || 'template';
    const token =
      localStorage.getItem('token') ||
      localStorage.getItem('access_token') ||
      localStorage.getItem('auth_token') ||
      '';

    try {
      // Prefer backend DOCX export for a real Word-compatible .docx file.
      const exportDraftId = savedTemplateId || 'generated_template_preview';
      const res = await fetch(`${AGENT_DRAFT_TEMPLATE_API}/api/drafts/${encodeURIComponent(exportDraftId)}/export/docx`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ html_content: exportHtml }),
      });

      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${name}.docx`;
          a.click();
          URL.revokeObjectURL(url);
          return;
        }
      }
    } catch {
      // fall through to HTML fallback
    }

    // Fallback: download as .html (safer than fake .doc for Word)
    const blob = new Blob([exportHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportHtml, generationMetadata, savedTemplateId]);

  const handleOpenInGoogleDocs = useCallback(async () => {
    const name = generationMetadata?.templateName || 'Generated Template';
    if (isOpeningGoogleDocs) return;
    setIsOpeningGoogleDocs(true);
    setGoogleDocsOpenError(null);
    try {
      const result = await openGeneratedTemplateInGoogleDocs(name, exportHtml);
      setGoogleDocsSession(result);
      if (!result.iframeUrl) {
        throw new Error('Google Docs URL not returned by server');
      }
    } catch (err) {
      setGoogleDocsOpenError(err instanceof Error ? err.message : 'Failed to open in Google Docs');
    } finally {
      setIsOpeningGoogleDocs(false);
    }
  }, [exportHtml, generationMetadata, isOpeningGoogleDocs]);

  if (phase === 'saved' && savedTemplateId) {
    return (
      <SavedScreen
        templateId={savedTemplateId}
        templateName={savedTemplateName || generationMetadata?.templateName || 'Template'}
        onReset={reset}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-100">
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div>
          <button
            onClick={() => navigate(-1)}
            className="mb-2 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all"
          >
            ← Back
          </button>
          <h2 className="text-base font-bold text-gray-800">{generationMetadata?.templateName || 'Generated Template'}</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">✓ AI Generated</span>
            {generationMetadata?.category && <span className="text-xs text-gray-400">· {generationMetadata.category}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isOpeningGoogleDocs && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: '#21C1B6' }} />
              Preparing Google Docs...
            </span>
          )}
          <button
            onClick={handleOpenInGoogleDocs}
            disabled={isOpeningGoogleDocs}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all disabled:opacity-50"
          >
            {googleDocsSession?.iframeUrl ? 'Open Google Docs Again' : 'Open in Google Docs'}
          </button>
          <button onClick={handleCopy} className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all">
            {copied ? '✓ Copied!' : 'Copy'}
          </button>
          <button onClick={handleDownload} className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all">
            Download .docx
          </button>
          <button onClick={reset} className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all">
            Start Over
          </button>
          <button
            onClick={handleSaveToLibrary}
            disabled={isSaving}
            className={`px-4 py-1.5 text-sm font-bold rounded-lg transition-all shadow-sm ${isSaving ? 'bg-gray-200 text-gray-400 cursor-wait' : 'text-white'}`}
            style={isSaving ? {} : { backgroundColor: '#21C1B6' }}
          >
            {isSaving ? 'Saving...' : 'Add to Library'}
          </button>
        </div>
      </div>

      {saveError && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2 text-xs text-red-700">
          {saveError}
        </div>
      )}
      {googleDocsOpenError && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs text-amber-700 flex items-center justify-between">
          <span>{googleDocsOpenError}</span>
          <button
            onClick={handleOpenInGoogleDocs}
            disabled={isOpeningGoogleDocs}
            className="ml-4 px-3 py-1 text-xs font-medium bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg transition-all disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      <div className="bg-white border-b border-gray-200 px-6 py-2.5 shrink-0">
        <span className="text-sm font-medium text-[#21C1B6]">Document Preview</span>
      </div>

      <div className="flex-1 overflow-auto" style={{ background: '#525659', padding: '32px 0' }}>
        {googleDocsSession?.iframeUrl ? (
          <div className="w-full px-6">
            <div className="bg-white rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.35)] overflow-hidden border border-gray-200">
              <iframe
                key={googleDocsSession.iframeKey || googleDocsSession.iframeUrl}
                src={googleDocsSession.iframeUrl}
                title="Google Docs Editor"
                className="w-full"
                style={{ height: 'calc(100vh - 240px)', minHeight: '640px', border: 0 }}
                allow="clipboard-read; clipboard-write"
              />
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
            {markdownPages.map((pageContent, pageIdx) => (
              <div key={pageIdx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ color: '#ccc', fontSize: '11px', marginBottom: '6px', userSelect: 'none' }}>
                  Page {pageIdx + 1} of {markdownPages.length}
                </div>
                <div
                  style={{
                    width: '794px',
                    minHeight: '1123px',
                    background: '#ffffff',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                    boxSizing: 'border-box',
                    fontFamily: '"Times New Roman", Times, serif',
                    fontSize: '12pt',
                    lineHeight: '1.6',
                    color: '#000',
                    // Court-standard: 1.5in left (binding), 1in top/right/bottom
                    padding: '96px 96px 96px 144px',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div style={{ flex: 1 }} className="doc-paper">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {pageContent}
                    </ReactMarkdown>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '9pt',
                      color: '#444',
                      borderTop: '1px solid #cfcfcf',
                      paddingTop: '8pt',
                      marginTop: '14pt',
                    }}
                  >
                    <div>Page {pageIdx + 1} of {markdownPages.length}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between sticky bottom-0 z-10 shadow-[0_-2px_8px_rgba(0,0,0,0.05)]">
        <p className="text-xs text-gray-500">
           {'Preview is document-only here. When you save, the generated template is uploaded directly to the Template Analyzer Agent from this page.'}
        </p>
        <button
          onClick={handleSaveToLibrary}
          disabled={isSaving}
          className={`px-5 py-2 text-sm font-bold rounded-lg transition-all ${isSaving ? 'bg-gray-200 text-gray-400 cursor-wait' : 'text-white shadow-sm'}`}
          style={isSaving ? {} : { backgroundColor: '#21C1B6' }}
        >
          {isSaving ? 'Saving...' : 'Add to Library'}
        </button>
      </div>
    </div>
  );
};
