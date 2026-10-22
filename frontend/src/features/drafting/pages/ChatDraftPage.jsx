import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  createChatDraftSession,
  exportChatDraftDocx,
  saveChatDraftToGoogleDocs,
} from '../api/chatDraftApi';
import { AGENT_DRAFT_TEMPLATE_API, CHAT_DRAFT_BACKEND_URL, getUserIdForDrafting } from '@/config/apiConfig';
import { useTokenQuota } from '@/features/billing/context/TokenQuotaContext';
import { throwIfQuotaResponse } from '@/shared/utils/quotaError';

/* ─── Palette ───────────────────────────────────────────────────────────── */
const T = {
  bg:          '#ffffff',
  surface:     '#ffffff',
  border:      '#e5e7eb',
  borderTeal:  '#99f6e4',
  primary:     '#0d9488',
  primaryDark: '#0f766e',
  primaryLight:'#f0fdfa',
  text:        '#111827',
  textMid:     '#374151',
  textMuted:   '#9ca3af',
  shadow:      '0 2px 10px rgba(0,0,0,.07)',
  shadowMd:    '0 4px 24px rgba(0,0,0,.10)',
};

/* ─── Icons ─────────────────────────────────────────────────────────────── */
const SendIcon  = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>;
const PlusIcon  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const DownIcon  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const CopyIcon  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
const XIcon     = () => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const FileIcon  = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
const Spinner   = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation:'spin .7s linear infinite' }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>;

const TealStar = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={T.primary} strokeWidth="2.2" strokeLinecap="round">
    <line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/>
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/><line x1="19.07" y1="4.93" x2="4.93" y2="19.07"/>
  </svg>
);

/* ─── Small components ─────────────────────────────────────────────────── */
const FileChip = ({ name, accent, onRemove }) => (
  <span style={{
    display:'inline-flex', alignItems:'center', gap:4,
    background: accent ? T.primaryLight : '#f9fafb',
    border:`1px solid ${accent ? T.borderTeal : T.border}`,
    borderRadius:20, padding:'3px 8px 3px 6px',
    fontSize:11.5, color: accent ? T.primaryDark : T.textMid,
    maxWidth:210, flexShrink:0,
  }}>
    <span style={{ color: accent ? T.primary : T.textMuted, display:'flex' }}><FileIcon/></span>
    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:150 }}>{name}</span>
    {onRemove && (
      <button onClick={onRemove} style={{ background:'none', border:'none', padding:0, cursor:'pointer', color:T.textMuted, display:'flex', alignItems:'center', marginLeft:1 }}>
        <XIcon/>
      </button>
    )}
  </span>
);

const TypingDots = () => (
  <span style={{ display:'inline-flex', gap:4, alignItems:'center', padding:'2px 0' }}>
    {[0,1,2].map(i => (
      <span key={i} style={{ width:6, height:6, borderRadius:'50%', background:T.borderTeal, display:'inline-block', animation:`dot-bounce 1.1s ease-in-out ${i*0.18}s infinite` }}/>
    ))}
  </span>
);

const CHIPS = [
  { icon:'📄', label:'Generate full draft', prompt:'Generate the complete draft document using the uploaded template format and all reference documents.' },
  { icon:'⚖️', label:'Legal draft', prompt:'Draft a formal legal document based on the uploaded template structure, incorporating all relevant facts and information from the reference documents.' },
  { icon:'✍️', label:'Draft with structure', prompt:'Create a well-structured draft following the exact headings, numbering, and sections from the template, populated with all content from the reference documents.' },
  { icon:'🔄', label:'Refine last draft', prompt:'Review the previous draft and improve it — fix any gaps, strengthen legal language, and ensure it fully matches the template format.' },
];

/* ─── Global CSS ───────────────────────────────────────────────────────── */
const CSS = `
  @keyframes spin { to { transform:rotate(360deg) } }
  @keyframes dot-bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }
  @keyframes cursor-blink { 0%,100%{opacity:1} 50%{opacity:0} }
  .streaming-cursor::after { content:'▋'; display:inline-block; animation:cursor-blink .7s infinite; color:#0d9488; margin-left:2px; font-size:.85em; }

  .doc-paper { font-family:'Georgia','Times New Roman',serif; color:#111; }
  .doc-paper h1 { font-size:1.25em; font-weight:700; text-align:center; margin:0 0 .9em; text-transform:uppercase; letter-spacing:.05em; line-height:1.4 }
  .doc-paper h2 { font-size:1.05em; font-weight:700; margin:1.3em 0 .45em; text-transform:uppercase; letter-spacing:.03em }
  .doc-paper h3 { font-size:.98em; font-weight:700; margin:1em 0 .35em }
  .doc-paper h4 { font-size:.94em; font-weight:700; margin:.85em 0 .3em }
  .doc-paper p  { margin:.55em 0; line-height:1.88; text-align:justify }
  .doc-paper ul { list-style:disc; padding-left:1.6em; margin:.45em 0 }
  .doc-paper ol { list-style:decimal; padding-left:1.6em; margin:.45em 0 }
  .doc-paper li { margin:.25em 0; line-height:1.78 }
  .doc-paper table { width:100%; border-collapse:collapse; margin:1em 0; font-size:.92em }
  .doc-paper th { background:#f9fafb; font-weight:700; padding:.5em .7em; border:1px solid #e5e7eb; text-align:left }
  .doc-paper td { padding:.45em .7em; border:1px solid #e5e7eb; vertical-align:top }
  .doc-paper tr:nth-child(even) td { background:#f9fafb }
  .doc-paper strong { font-weight:700 }
  .doc-paper em { font-style:italic }
  .doc-paper blockquote { border-left:3px solid #5eead4; padding:.45em 1em; color:#374151; margin:.7em 0; background:#f0fdfa; border-radius:0 6px 6px 0; font-style:italic }
  .doc-paper hr { border:none; border-top:1.5px solid #e5e7eb; margin:1.4em 0 }
  .doc-paper pre { background:#1e293b; color:#e2e8f0; padding:.9em 1em; border-radius:6px; overflow-x:auto; font-size:.85em; margin:.6em 0 }
  .doc-paper code:not(pre code) { background:#f0fdfa; color:#0f766e; padding:.1em .32em; border-radius:.3em; font-size:.87em }
  .doc-paper::-webkit-scrollbar { width:5px }
  .doc-paper::-webkit-scrollbar-thumb { background:#99f6e4; border-radius:3px }
  .chat-scroll::-webkit-scrollbar { width:4px }
  .chat-scroll::-webkit-scrollbar-thumb { background:#e5e7eb; border-radius:2px }
`;

/* ─── Streaming fetch helper ────────────────────────────────────────────── */
async function streamMessage(sessionId, message, onChunk, signal) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token') || localStorage.getItem('authToken') ||
    localStorage.getItem('access_token') || localStorage.getItem('jwt') || localStorage.getItem('auth_token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const userId = getUserIdForDrafting();
  if (userId) headers['X-User-Id'] = userId;

  const res = await fetch(`${CHAT_DRAFT_BACKEND_URL}/api/chat-draft/session/${sessionId}/message-stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message }),
    signal,
  });

  if (!res.ok) {
    await throwIfQuotaResponse(res, `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          if (json.html_chunk) onChunk(json.html_chunk);
          if (json.html) onChunk(json.html, true); // final complete HTML
        } catch (_) {}
      }
    }
  }
}

/* ─── Extract template HTML from API response ───────────────────────── */
function extractTemplateHtml(template) {
  const c = template?.content;
  if (!c) return '';
  if (c.fallback_html?.pages?.length) {
    return c.fallback_html.pages.map(p => p.html || '').join('\n\n');
  }
  if (c.structured?.pages?.length) {
    return c.structured.pages
      .flatMap(p => (p.blocks || []).map(b => b.content?.value || b.content?.label || ''))
      .join('\n');
  }
  if (c.blocks?.length) {
    return c.blocks.map(b => b.content?.value || b.content?.label || '').join('\n');
  }
  return '';
}

/* ═══════════════════════════════════════════════════════════════════════ */
export default function ChatDraftPage() {
  const [searchParams] = useSearchParams();
  const urlTemplateId   = searchParams.get('templateId');
  const urlTemplateName = searchParams.get('templateName') || 'Template';

  const { showQuotaError } = useTokenQuota();

  const [phase,           setPhase]          = useState('home');
  const [templateText,    setTemplateText]    = useState('');
  const [templateFile,    setTemplateFile]    = useState(null);
  const [autoTemplateName,setAutoTemplateName]= useState('');   // name when auto-loaded
  const [templateLoading, setTemplateLoading] = useState(false);
  const [documents,       setDocuments]       = useState([]);
  const [sessionId,       setSessionId]       = useState('');
  const [messages,        setMessages]        = useState([]);
  const [streamingHtml,   setStreamingHtml]   = useState('');   // live streaming content
  const [latestHtml,      setLatestHtml]      = useState('');   // final confirmed draft
  const [input,           setInput]           = useState('');
  const [isCreating,      setIsCreating]      = useState(false);
  const [isSending,       setIsSending]       = useState(false);
  const [isExporting,     setIsExporting]     = useState(false);
  const [isSavingDraft,   setIsSavingDraft]   = useState(false);
  const [savedDraftUrl,   setSavedDraftUrl]   = useState('');
  const [error,           setError]           = useState('');
  const [attachOpen,      setAttachOpen]      = useState(false);
  const [docPanelOpen,    setDocPanelOpen]    = useState(false);
  const [copied,          setCopied]          = useState(false);
  const [citations,       setCitations]       = useState([]);
  const [warnings,        setWarnings]        = useState([]);   // per-file parse warnings

  // Auto-fetch template when templateId is in the URL
  useEffect(() => {
    if (!urlTemplateId) return;
    setTemplateLoading(true);
    setAutoTemplateName(decodeURIComponent(urlTemplateName));

    const headers = {};
    const token = localStorage.getItem('token') || localStorage.getItem('authToken') ||
      localStorage.getItem('access_token') || localStorage.getItem('jwt') || localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const userId = getUserIdForDrafting();
    if (userId) headers['X-User-Id'] = userId;

    fetch(`${AGENT_DRAFT_TEMPLATE_API}/api/templates/${urlTemplateId}/content`, { headers })
      .then(async (r) => {
        if (r.ok) return r.json();
        const detail = await fetch(`${AGENT_DRAFT_TEMPLATE_API}/api/templates/${urlTemplateId}?include_sections=true`, { headers });
        if (!detail.ok) throw new Error(`HTTP ${detail.status}`);
        return detail.json();
      })
      .then(data => {
        const html = typeof data?.html === 'string' && data.html.trim()
          ? data.html.trim()
          : extractTemplateHtml(data.template || data);
        if (html) {
          setTemplateText(html);
          setError('');
        } else {
          setError('Could not extract template content. Please paste the template manually.');
        }
      })
      .catch(err => {
        setError(`Failed to load template: ${err.message}. Please paste it manually.`);
      })
      .finally(() => setTemplateLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTemplateId]);

  const endRef   = useRef(null);
  const taRef    = useRef(null);
  const docRef   = useRef(null);
  const tmplRef  = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:'smooth' }); }, [messages, isSending, streamingHtml]);

  useEffect(() => {
    const ta = taRef.current; if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [input]);

  const addDocs = useCallback((files) => {
    const list = Array.from(files || []);
    setDocuments(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...list.filter(f => !names.has(f.name))];
    });
  }, []);
  const removeDoc = useCallback((i) => setDocuments(prev => prev.filter((_,j)=>j!==i)), []);

  const ensureSession = async () => {
    if (sessionId) return sessionId;
    if (!documents.length) throw new Error('Click + and attach at least one reference document.');
    if (!templateText.trim() && !templateFile && !urlTemplateId) throw new Error('Click + and attach or paste a template.');
    setIsCreating(true);
    try {
      const res = await createChatDraftSession({
        templateText: templateText.trim(),
        templateFile,
        documents,
        templateId: urlTemplateId || undefined,
      });
      setSessionId(res.sessionId);
      // Show per-file warnings (e.g. XRef errors) without blocking
      const warns = (res.documents || []).filter(d => d.warning).map(d => `"${d.name}": ${d.warning}`);
      if (warns.length) setWarnings(warns);
      return res.sessionId;
    } finally { setIsCreating(false); }
  };

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || isSending || isCreating) return;
    setInput('');
    setError('');
    setWarnings([]);
    setMessages(prev => [...prev, { role:'user', content: msg }]);
    if (phase === 'home') setPhase('chat');
    setDocPanelOpen(true);  // open doc panel immediately
    setStreamingHtml('');
    setIsSending(true);

    abortRef.current = new AbortController();

    try {
      const sid = await ensureSession();
      let accumulated = '';
      let gotFinal = false;

      await streamMessage(
        sid, msg,
        (chunk, isFinal) => {
          if (isFinal) {
            accumulated = chunk;
            gotFinal = true;
            setStreamingHtml('');
            setLatestHtml(chunk);
            setMessages(prev => [...prev, { role:'assistant', content: chunk }]);
          } else {
            accumulated += chunk;
            setStreamingHtml(accumulated);
          }
        },
        abortRef.current.signal
      );

      // Fallback: if streaming didn't produce a final event, use accumulated
      if (!gotFinal && accumulated) {
        setStreamingHtml('');
        setLatestHtml(accumulated);
        setMessages(prev => [...prev, { role:'assistant', content: accumulated }]);
      }

    } catch (err) {
      if (err.name === 'AbortError') return;
      if (showQuotaError(err)) {
        setMessages(prev => prev.slice(0, -1));
        return;
      }

      // Streaming not available — fall back to regular POST
      try {
        const { sendChatDraftMessage } = await import('../api/chatDraftApi');
        const sid2 = sessionId || (await ensureSession());
        const res = await sendChatDraftMessage(sid2, msg);
        setLatestHtml(res.html);
        setStreamingHtml('');
        setMessages(prev => [...prev, { role:'assistant', content: res.html }]);
        setCitations(res.citations || []);
      } catch (fallbackErr) {
        if (!showQuotaError(fallbackErr)) {
          setError(fallbackErr.message || 'Something went wrong.');
          setMessages(prev => prev.slice(0, -1));
        }
      }
    } finally {
      setIsSending(false);
      setStreamingHtml('');
    }
  };

  const onKeyDown = (e) => { if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();} };

  const copyDraft = () => {
    const html = latestHtml || streamingHtml;
    if (!html) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    navigator.clipboard.writeText(tmp.innerText || '').then(() => {
      setCopied(true); setTimeout(()=>setCopied(false),2000);
    });
  };

  const exportDocx = async () => {
    if (!sessionId || isExporting) return;
    setIsExporting(true);
    try {
      const blob = await exportChatDraftDocx(sessionId);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href=url; a.download=`draft-${sessionId}.docx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch(e){ setError(e.message||'Export failed.'); }
    finally { setIsExporting(false); }
  };

  const saveDraft = async () => {
    const html = latestHtml || streamingHtml;
    if (!html || isSavingDraft) return;
    setIsSavingDraft(true);
    setError('');
    try {
      const now = new Date();
      const labelDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const titleBase = (autoTemplateName || urlTemplateName || 'AI Chat Draft').trim();
      const result = await saveChatDraftToGoogleDocs({
        html,
        title: `${titleBase} - ${labelDate}`,
        draftId: sessionId || undefined,
      });
      const openUrl = result?.web_view_link || (result?.google_file_id ? `https://docs.google.com/document/d/${result.google_file_id}/edit` : '');
      if (openUrl) setSavedDraftUrl(openUrl);
    } catch (e) {
      setError(e.message || 'Save failed.');
    } finally {
      setIsSavingDraft(false);
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setPhase('home'); setSessionId(''); setMessages([]); setDocuments([]);
    setInput(''); setError('');
    setLatestHtml(''); setStreamingHtml(''); setAttachOpen(false);
    setCitations([]); setWarnings([]); setDocPanelOpen(false);
    setSavedDraftUrl('');
    // Keep auto-loaded template; only clear manual template
    if (!urlTemplateId) { setTemplateText(''); setTemplateFile(null); }
  };

  const isAutoMode  = !!urlTemplateId;
  const hasTemplate = !!(templateText.trim() || templateFile);
  const hasDocs     = documents.length > 0;
  const displayHtml = streamingHtml || latestHtml;
  const isStreaming  = isSending && !!streamingHtml;

  /* ── Input bar (inlined to prevent remount bug) ─────────────────────── */
  const inputBar = (
    <div style={{ width:'100%' }}>
      {(hasTemplate||hasDocs||templateLoading) && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:8 }}>
          {templateLoading
            ? <FileChip name="Loading template…" accent />
            : isAutoMode && hasTemplate
              ? <FileChip name={`Template: ${autoTemplateName} (auto)`} accent />
              : templateFile
                ? <FileChip name={`Template: ${templateFile.name}`} accent onRemove={()=>setTemplateFile(null)}/>
                : templateText.trim()
                  ? <FileChip name="Template: pasted text" accent onRemove={()=>setTemplateText('')}/>
                  : null
          }
          {documents.map((d,i)=><FileChip key={`${d.name}-${i}`} name={d.name} onRemove={()=>removeDoc(i)}/>)}
        </div>
      )}

      <div
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault();addDocs(e.dataTransfer.files);setAttachOpen(true);}}
        style={{
          background:T.surface, border:`1.5px solid ${attachOpen?T.primary:T.border}`,
          borderRadius:14, boxShadow:T.shadow, padding:'12px 12px 9px',
          display:'flex', flexDirection:'column', gap:9, transition:'border-color .2s',
        }}
      >
        <textarea ref={taRef} rows={1} value={input}
          onChange={e=>setInput(e.target.value)} onKeyDown={onKeyDown}
          disabled={isSending||isCreating}
          placeholder={
            templateLoading ? 'Loading template, please wait…' :
            !hasTemplate&&!hasDocs ? (isAutoMode ? 'Click + to attach your case documents…' : 'Click + to attach template & documents first…') :
            !hasTemplate ? 'Add a template (click +) then describe what to draft…' :
            !hasDocs ? 'Attach reference documents (click +) then describe what to draft…' :
            'Describe what to draft, or ask me to generate the full document…'
          }
          style={{ border:'none', outline:'none', resize:'none', background:'transparent', fontSize:14, color:T.text, lineHeight:1.6, fontFamily:'inherit', width:'100%', minHeight:24, caretColor:T.primary }}
        />
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:7 }}>
            <button type="button" onClick={()=>setAttachOpen(v=>!v)}
              style={{ width:30, height:30, borderRadius:'50%', border:`1.5px solid ${attachOpen?T.primary:T.border}`, background:attachOpen?T.primaryLight:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:attachOpen?T.primary:T.textMuted, transition:'all .2s' }}>
              <PlusIcon/>
            </button>
            {(hasDocs||hasTemplate)&&<span style={{ fontSize:11.5, color:T.primaryDark }}>
              {hasDocs?`${documents.length} doc${documents.length!==1?'s':''}`:''}
              {hasDocs&&hasTemplate?' · ':''}
              {hasTemplate?'template ✓':''}
            </span>}
          </div>
          <button type="button" onClick={()=>send()} disabled={!input.trim()||isSending||isCreating||templateLoading}
            style={{ width:32, height:32, borderRadius:'50%', background:input.trim()&&!isSending&&!isCreating?T.primary:T.border, border:'none', cursor:input.trim()&&!isSending&&!isCreating?'pointer':'default', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', transition:'background .2s', flexShrink:0 }}>
            {isSending||isCreating?<Spinner/>:<SendIcon/>}
          </button>
        </div>
      </div>

      {attachOpen && (
        <div style={{ marginTop:7, background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:'14px', boxShadow:T.shadow, display:'flex', gap:12, flexWrap:'wrap' }}>
          {!isAutoMode && (
            <div style={{ flex:'1 1 220px' }}>
              <p style={{ fontSize:10.5, fontWeight:700, color:T.primary, letterSpacing:'.07em', margin:'0 0 7px' }}>
                TEMPLATE <span style={{ color:'#ef4444' }}>*</span>
                <span style={{ fontWeight:400, color:T.textMid, marginLeft:4, fontSize:10 }}>(format reference)</span>
              </p>
              <textarea value={templateText} onChange={e=>setTemplateText(e.target.value)}
                placeholder="Paste your template — AI will follow its exact format, headings and clause structure." rows={5}
                style={{ width:'100%', border:`1px solid ${T.border}`, borderRadius:8, padding:'7px 9px', fontSize:12, color:T.text, background:'#fafafa', outline:'none', resize:'vertical', fontFamily:'inherit', boxSizing:'border-box', lineHeight:1.6 }}
              />
              <label style={{ display:'inline-flex', alignItems:'center', gap:5, marginTop:5, fontSize:11.5, color:T.textMid, cursor:'pointer', padding:'4px 9px', border:`1px solid ${T.border}`, borderRadius:6, background:'#fafafa' }}>
                <FileIcon/> {templateFile?templateFile.name:'Or upload (.docx / .pdf / .txt)'}
                <input type="file" accept=".docx,.pdf,.txt" ref={tmplRef} onChange={e=>{setTemplateFile(e.target.files?.[0]||null);e.target.value='';}} style={{ display:'none' }}/>
              </label>
            </div>
          )}
          {isAutoMode && (
            <div style={{ flex:'1 1 220px', display:'flex', flexDirection:'column', justifyContent:'center', padding:'8px 12px', background:T.primaryLight, border:`1px solid ${T.borderTeal}`, borderRadius:8 }}>
              <p style={{ fontSize:10.5, fontWeight:700, color:T.primary, letterSpacing:'.07em', margin:'0 0 4px' }}>TEMPLATE (AUTO-LOADED)</p>
              <p style={{ fontSize:12, color:T.primaryDark, margin:0 }}>
                {templateLoading ? '⏳ Fetching template…' : `✓ ${autoTemplateName}`}
              </p>
            </div>
          )}
          <div style={{ flex:'1 1 170px' }}>
            <p style={{ fontSize:10.5, fontWeight:700, color:T.primary, letterSpacing:'.07em', margin:'0 0 7px' }}>
              REFERENCE DOCUMENTS <span style={{ color:'#ef4444' }}>*</span>
              <span style={{ fontWeight:400, color:T.textMid, marginLeft:4, fontSize:10 }}>(source content)</span>
            </p>
            <label onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();addDocs(e.dataTransfer.files);}}
              style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', border:`2px dashed ${T.border}`, borderRadius:8, padding:'18px 10px', cursor:'pointer', background:'#fafafa', textAlign:'center' }}>
              <span style={{ fontSize:22 }}>📎</span>
              <span style={{ fontSize:12.5, color:T.text, marginTop:3 }}>Drop files or <strong>browse</strong></span>
              <span style={{ fontSize:10.5, color:T.textMuted, marginTop:2 }}>PDF · DOCX · TXT · multiple OK</span>
              <input type="file" multiple ref={docRef} onChange={e=>{addDocs(e.target.files);e.target.value='';}} style={{ display:'none' }}/>
            </label>
            {hasDocs&&<p style={{ fontSize:11, color:T.textMid, marginTop:6 }}>{documents.length} file{documents.length!==1?'s':''} attached</p>}
          </div>
        </div>
      )}
    </div>
  );

  /* ══════════════════════════════════════════════════════════════════
     HOME PHASE
     ══════════════════════════════════════════════════════════════════ */
  if (phase==='home') return (
    <div style={{ height:'100%', background:T.bg, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'32px 24px', boxSizing:'border-box', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif' }}>
      <style>{CSS}</style>
      <div style={{ textAlign:'center', marginBottom:36 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, marginBottom:6 }}>
          <TealStar size={30}/><h1 style={{ margin:0, fontSize:27, fontWeight:700, color:T.text, letterSpacing:'-.02em' }}>Chat Draft</h1>
        </div>
        {isAutoMode ? (
          <p style={{ margin:0, fontSize:13.5, color:T.textMid, maxWidth:480 }}>
            {templateLoading
              ? <span>⏳ Loading template <strong style={{ color:T.text }}>{autoTemplateName}</strong>…</span>
              : <span>Template <strong style={{ color:T.text }}>{autoTemplateName}</strong> loaded. Attach your <strong style={{ color:T.text }}>case documents</strong> and describe what to draft.</span>
            }
          </p>
        ) : (
          <p style={{ margin:0, fontSize:13.5, color:T.textMid, maxWidth:460 }}>
            Give me a <strong style={{ color:T.text }}>template</strong> (format) and your <strong style={{ color:T.text }}>reference documents</strong> (content) — I'll generate a complete formatted legal draft.
          </p>
        )}
      </div>
      <div style={{ width:'100%', maxWidth:660 }}>{inputBar}</div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:16, justifyContent:'center', maxWidth:660 }}>
        {CHIPS.map(c=>(
          <button key={c.label} type="button" onClick={()=>{setInput(c.prompt);setTimeout(()=>taRef.current?.focus(),0);}}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', borderRadius:20, border:`1px solid ${T.border}`, background:T.surface, fontSize:13, color:T.text, cursor:'pointer', fontFamily:'inherit', transition:'background .15s' }}
            onMouseEnter={e=>{e.currentTarget.style.background=T.primaryLight;e.currentTarget.style.borderColor=T.borderTeal;}}
            onMouseLeave={e=>{e.currentTarget.style.background=T.surface;e.currentTarget.style.borderColor=T.border;}}>
            <span>{c.icon}</span>{c.label}
          </button>
        ))}
      </div>
      {error&&<p style={{ marginTop:14, fontSize:13, color:'#dc2626', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'8px 16px', maxWidth:580, textAlign:'center' }}>{error}</p>}
    </div>
  );

  /* ══════════════════════════════════════════════════════════════════
     CHAT PHASE — SPLIT PANEL (left: chat, right: document)
     ══════════════════════════════════════════════════════════════════ */
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0, background:T.bg, fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif' }}>
      <style>{CSS}</style>

      {/* ── Top bar ── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 16px', flexShrink:0, background:T.primary, boxShadow:'0 2px 8px rgba(13,148,136,.25)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <TealStar size={20}/>
          <span style={{ fontSize:15, fontWeight:700, color:'#fff' }}>Chat Draft</span>
          {isAutoMode&&autoTemplateName&&<span style={{ fontSize:11, color:'#ccfbf1', background:'rgba(255,255,255,.15)', borderRadius:20, padding:'2px 9px' }}>📄 {autoTemplateName}</span>}
          {sessionId&&<span style={{ fontSize:11, color:'#ccfbf1', background:'rgba(255,255,255,.15)', borderRadius:20, padding:'2px 9px' }}>{documents.length} doc{documents.length!==1?'s':''} loaded</span>}
        </div>
        <div style={{ display:'flex', gap:7 }}>
          {displayHtml&&(
            <button type="button" onClick={()=>setDocPanelOpen(v=>!v)} style={{ padding:'4px 11px', borderRadius:7, border:'1.5px solid rgba(255,255,255,.35)', background:'rgba(255,255,255,.12)', color:'#fff', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
              {docPanelOpen?'Hide draft':'Show draft'}
            </button>
          )}
          {displayHtml&&(
            <button type="button" onClick={saveDraft} disabled={isSavingDraft} style={{ padding:'4px 11px', borderRadius:7, border:'1.5px solid rgba(255,255,255,.35)', background:'rgba(255,255,255,.12)', color:'#fff', fontSize:12, cursor:isSavingDraft?'default':'pointer', fontFamily:'inherit', opacity:isSavingDraft ? 0.7 : 1 }}>
              {isSavingDraft ? 'Saving…' : 'Save draft'}
            </button>
          )}
          {savedDraftUrl&&(
            <button type="button" onClick={()=>window.open(savedDraftUrl,'_blank','noopener,noreferrer')} style={{ padding:'4px 11px', borderRadius:7, border:'1.5px solid rgba(255,255,255,.35)', background:'rgba(255,255,255,.12)', color:'#fff', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
              Open saved
            </button>
          )}
          <button type="button" onClick={reset} style={{ padding:'4px 11px', borderRadius:7, border:'1.5px solid rgba(255,255,255,.35)', background:'rgba(255,255,255,.12)', color:'#fff', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>New session</button>
        </div>
      </div>

      {/* ── Split body ── */}
      <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>

        {/* ── LEFT: Chat ── */}
        <div style={{ width: docPanelOpen&&displayHtml ? '38%' : '100%', minWidth: docPanelOpen&&displayHtml ? 280 : 'unset', display:'flex', flexDirection:'column', borderRight: docPanelOpen&&displayHtml ? `1px solid ${T.border}` : 'none', transition:'width .25s', background:'#fff' }}>

          <div className="chat-scroll" style={{ flex:1, overflowY:'auto', padding:'20px 14px 8px' }}>
            <div style={{ maxWidth: docPanelOpen&&displayHtml?'100%':700, margin:'0 auto', display:'flex', flexDirection:'column', gap:16 }}>

              {/* warnings */}
              {warnings.length>0&&(
                <div style={{ fontSize:12, color:T.primaryDark, background:T.primaryLight, border:`1px solid ${T.borderTeal}`, borderRadius:9, padding:'8px 12px' }}>
                  <strong>Note:</strong> Some files had parse issues (they're still included):{' '}
                  {warnings.map((w,i)=><span key={i}><br/>• {w}</span>)}
                </div>
              )}

              {messages.map((msg,idx) => msg.role==='user' ? (
                <div key={idx} style={{ display:'flex', justifyContent:'flex-end' }}>
                  <div style={{ maxWidth:'80%', background:T.primaryLight, border:`1px solid ${T.borderTeal}`, borderRadius:'16px 16px 4px 16px', padding:'9px 14px', fontSize:13.5, color:T.text, lineHeight:1.6, whiteSpace:'pre-wrap', boxShadow:T.shadow }}>
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div key={idx} style={{ display:'flex', gap:9, alignItems:'flex-start' }}>
                  <div style={{ flexShrink:0, width:28, height:28, borderRadius:'50%', background:T.primaryLight, border:`1px solid ${T.borderTeal}`, display:'flex', alignItems:'center', justifyContent:'center', marginTop:2 }}>
                    <TealStar size={13}/>
                  </div>
                  <div style={{ flex:1, background:'#fff', border:`1px solid ${T.border}`, borderRadius:'4px 14px 14px 14px', padding:'9px 13px', fontSize:13, color:T.text, lineHeight:1.65, boxShadow:T.shadow }}>
                    {docPanelOpen
                      ? <span style={{ color:T.primaryDark, fontSize:12.5 }}>✓ Draft generated — see document panel →</span>
                      : <div className="doc-paper" style={{ fontSize:13 }} dangerouslySetInnerHTML={{ __html: msg.content }}/>
                    }
                  </div>
                </div>
              ))}

              {/* Typing / streaming indicator */}
              {isSending&&!streamingHtml&&(
                <div style={{ display:'flex', gap:9, alignItems:'flex-start' }}>
                  <div style={{ flexShrink:0, width:28, height:28, borderRadius:'50%', background:T.primaryLight, border:`1px solid ${T.borderTeal}`, display:'flex', alignItems:'center', justifyContent:'center' }}><TealStar size={13}/></div>
                  <div style={{ background:'#fff', border:`1px solid ${T.border}`, borderRadius:'4px 14px 14px 14px', padding:'10px 14px', boxShadow:T.shadow }}>
                    {docPanelOpen ? <span style={{ fontSize:12.5, color:T.primaryDark }}>Generating draft…</span> : <TypingDots/>}
                  </div>
                </div>
              )}
              {isSending&&streamingHtml&&docPanelOpen&&(
                <div style={{ display:'flex', gap:9, alignItems:'flex-start' }}>
                  <div style={{ flexShrink:0, width:28, height:28, borderRadius:'50%', background:T.primaryLight, border:`1px solid ${T.borderTeal}`, display:'flex', alignItems:'center', justifyContent:'center' }}><TealStar size={13}/></div>
                  <div style={{ background:'#fff', border:`1px solid ${T.border}`, borderRadius:'4px 14px 14px 14px', padding:'9px 13px', fontSize:12.5, color:T.primaryDark, boxShadow:T.shadow }}>
                    Streaming draft… see document panel →
                  </div>
                </div>
              )}

              {error&&<div style={{ fontSize:12.5, color:'#dc2626', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:9, padding:'9px 14px' }}>{error}</div>}
              <div ref={endRef}/>
            </div>
          </div>

          <div style={{ flexShrink:0, padding:'10px 14px 16px', borderTop:`1px solid ${T.border}`, background:'#fff' }}>
            {inputBar}
            <p style={{ textAlign:'center', fontSize:10.5, color:T.textMuted, marginTop:6 }}>Enter ↵ to send · Shift+Enter for new line · drag & drop files</p>
          </div>
        </div>

        {/* ── RIGHT: Document artifact panel ── */}
        {docPanelOpen && (
          <div style={{ flex:1, display:'flex', flexDirection:'column', background:'#ffffff', minWidth:0 }}>

            {/* artifact header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 16px', flexShrink:0, background:'#fff', borderBottom:`1px solid ${T.border}`, boxShadow:'0 1px 0 rgba(0,0,0,.04)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                <span style={{ fontSize:18 }}>📄</span>
                <div>
                  <span style={{ fontSize:13.5, fontWeight:600, color:T.text }}>Draft Document</span>
                  <span style={{ marginLeft:8, fontSize:10.5, color:'#fff', background:T.primary, borderRadius:4, padding:'1px 7px', fontWeight:600, letterSpacing:'.04em' }}>DOCX</span>
                  {isStreaming&&<span style={{ marginLeft:8, fontSize:10.5, color:T.primaryDark, background:T.primaryLight, borderRadius:4, padding:'1px 7px', fontWeight:600 }}>● LIVE</span>}
                </div>
              </div>
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                {citations.length>0&&<span style={{ fontSize:11, color:T.textMuted }}>{citations.length} source{citations.length!==1?'s':''}</span>}
                <button type="button" onClick={copyDraft} style={artBtn}><CopyIcon/><span>{copied?'Copied!':'Copy'}</span></button>
                <button type="button" onClick={exportDocx} disabled={isExporting||!latestHtml} style={artBtn}>
                  {isExporting?<Spinner/>:<DownIcon/>}<span>Download DOCX</span>
                </button>
                <button type="button" onClick={()=>setDocPanelOpen(false)} style={{ ...artBtn, minWidth:'unset', padding:'4px 7px' }}><XIcon/></button>
              </div>
            </div>

            {/* document paper */}
            <div style={{ flex:1, overflowY:'auto', background:'#f5f5f5', padding:'28px 32px' }}>
              {displayHtml ? (
                <div style={{ maxWidth:820, margin:'0 auto', background:'#fff', borderRadius:8, boxShadow:T.shadowMd, overflow:'hidden' }}>
                  <div
                    className={`doc-paper${isStreaming?' streaming-cursor':''}`}
                    style={{ padding:'56px 72px', fontSize:14, lineHeight:1.85 }}
                    dangerouslySetInnerHTML={{ __html: displayHtml }}
                  />
                </div>
              ) : (
                /* Loading placeholder while waiting for first token */
                <div style={{ maxWidth:820, margin:'0 auto', background:'#fff', borderRadius:8, boxShadow:T.shadowMd, padding:'56px 72px' }}>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16, minHeight:300, color:T.textMuted }}>
                    <Spinner/>
                    <p style={{ fontSize:14, margin:0 }}>Generating your draft…</p>
                    <p style={{ fontSize:12, margin:0, textAlign:'center', maxWidth:300 }}>The AI is reading your template and reference documents</p>
                  </div>
                </div>
              )}

              {citations.length>0&&(
                <div style={{ maxWidth:820, margin:'14px auto 0', padding:'9px 14px', background:T.primaryLight, border:`1px solid ${T.borderTeal}`, borderRadius:8, fontSize:11.5, color:T.textMid }}>
                  <strong style={{ color:T.text }}>Sources used:</strong> {citations.join(' · ')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const artBtn = {
  display:'inline-flex', alignItems:'center', gap:5,
  padding:'4px 9px', borderRadius:6,
  border:`1px solid #e5e7eb`, background:'#fff',
  fontSize:11.5, color:'#111827', cursor:'pointer', fontFamily:'inherit',
};
