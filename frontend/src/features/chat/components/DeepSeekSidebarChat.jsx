import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { X, Send, ChevronDown, Loader2, Bot, Zap, Search, RotateCcw, BookOpen, Plus, FolderHeart } from 'lucide-react';
import { useIntelligentFolderChat } from '../hooks/useIntelligentFolderChat';
import { fetchSecretsList } from '@/shared/api/secretsService';
import { fetchCustomPromptGroups, deleteCustomPrompt, deleteCustomPromptGroup } from '../api/customPromptsService';
import CustomPromptBuilderModal from './CustomPromptBuilder/CustomPromptBuilderModal';
import CustomPromptGroups from './CustomPromptBuilder/CustomPromptGroups';
import documentApi from '@/shared/api/documentApi';
import { normalizeMarkdownFormatting, ensureTableSeparators, markdownTableComponents, markdownRehypePlugins } from '@/shared/utils/markdownUtils';

function scrollToBottom(el) {
  if (el) el.scrollTop = el.scrollHeight;
}

function PresetIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.396 0 2.7.39 3.8 1.068A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
    </svg>
  );
}

// Clean DeepSeek-style table: no vertical grid lines, light horizontal row
// dividers, bold first ("Field") column, generous padding. All styling lives in
// the .ds-table CSS class so first-column bolding works.
const dsTableComponents = {
  table: ({ node, ...props }) => (
    <div className="ds-table-wrap">
      <table className="ds-table" {...props} />
    </div>
  ),
  thead: ({ node, ...props }) => <thead {...props} />,
  tbody: ({ node, ...props }) => <tbody {...props} />,
  tr: ({ node, ...props }) => <tr {...props} />,
  th: ({ node, ...props }) => <th {...props} />,
  td: ({ node, ...props }) => <td {...props} />,
};

const AssistantMessage = React.memo(function AssistantMessage({ text }) {
  const normalised = ensureTableSeparators(normalizeMarkdownFormatting(text || ''));
  return (
    <div className="ds-msg ds-msg--assistant">
      <div className="ds-msg__avatar">
        <Bot size={14} />
      </div>
      <div className="ds-msg__body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
          rehypePlugins={markdownRehypePlugins}
          components={{ ...markdownTableComponents, ...dsTableComponents }}
        >
          {normalised}
        </ReactMarkdown>
      </div>
    </div>
  );
});

export default function DeepSeekSidebarChat({ isOpen, onClose, sidebarCollapsed = false }) {
  const [cases, setCases] = useState([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [selectedCase, setSelectedCase] = useState(null);
  const [caseDropdownOpen, setCaseDropdownOpen] = useState(false);

  const [presets, setPresets] = useState([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [presetSearch, setPresetSearch] = useState('');

  const [customGroups, setCustomGroups] = useState([]);
  const [customGroupsLoading, setCustomGroupsLoading] = useState(false);
  const [showPromptBuilder, setShowPromptBuilder] = useState(false);

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const caseDropRef = useRef(null);

  const folderName = selectedCase?.folder_name || selectedCase?.folderName || selectedCase?.name || selectedCase?.id || '__none__';
  const { text: streamText, isStreaming, error: streamError, sendMessage, clear } = useIntelligentFolderChat(folderName);

  useEffect(() => {
    if (!isOpen) return;
    setCasesLoading(true);
    documentApi.getCases()
      .then((r) => {
        const list = r?.cases ?? r?.data ?? (Array.isArray(r) ? r : []);
        setCases(Array.isArray(list) ? list : []);
      })
      .catch(() => setCases([]))
      .finally(() => setCasesLoading(false));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setPresetsLoading(true);
    fetchSecretsList({ includeValues: false })
      .then((list) => setPresets(Array.isArray(list) ? list : []))
      .catch(() => setPresets([]))
      .finally(() => setPresetsLoading(false));
  }, [isOpen]);

  const loadCustomGroups = useCallback((showSpinner = false) => {
    if (showSpinner) setCustomGroupsLoading(true);
    fetchCustomPromptGroups()
      .then((list) => setCustomGroups(Array.isArray(list) ? list : []))
      .catch(() => {})
      .finally(() => setCustomGroupsLoading(false));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    loadCustomGroups(true);
  }, [isOpen, loadCustomGroups]);

  useEffect(() => {
    if (!caseDropdownOpen) return;
    const handler = (e) => {
      if (caseDropRef.current && !caseDropRef.current.contains(e.target)) setCaseDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [caseDropdownOpen]);

  useEffect(() => {
    scrollToBottom(messagesEndRef.current?.parentElement);
  }, [messages, streamText]);

  const prevStreaming = useRef(false);
  useEffect(() => {
    if (!isStreaming && prevStreaming.current && streamText) {
      setMessages((prev) => [...prev, { role: 'assistant', text: streamText, id: Date.now() }]);
      clear();
    }
    prevStreaming.current = isStreaming;
  }, [isStreaming, streamText, clear]);

  const handleSend = useCallback(async (question, secretId = null) => {
    if (!selectedCase || isStreaming) return;
    if (!question?.trim() && !secretId) return;

    if (question?.trim()) {
      setMessages((prev) => [...prev, { role: 'user', text: question.trim(), id: Date.now() }]);
      setInputText('');
    } else {
      const preset = presets.find((p) => p.id === secretId);
      if (preset) {
        setMessages((prev) => [
          ...prev,
          { role: 'user', text: `[Preset] ${preset.name || preset.label || secretId}`, id: Date.now(), isPreset: true },
        ]);
      }
    }

    await sendMessage(question?.trim() || null, secretId, { llm_name: 'deepseek' });
  }, [selectedCase, isStreaming, sendMessage, presets]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(inputText); }
  };

  const handlePresetClick = (preset) => {
    if (!selectedCase) { setCaseDropdownOpen(true); return; }
    handleSend(null, preset.id);
  };

  const handleCustomPromptClick = useCallback((prompt) => {
    if (!selectedCase) { setCaseDropdownOpen(true); return; }
    if (isStreaming || !prompt?.prompt_text) return;
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: `[My Prompt] ${prompt.name}`, id: Date.now(), isPreset: true },
    ]);
    void sendMessage(prompt.prompt_text, null, { llm_name: 'deepseek' });
  }, [selectedCase, isStreaming, sendMessage]);

  const handleDeleteCustomPrompt = useCallback(async (prompt) => {
    if (!window.confirm(`Delete prompt "${prompt.name}"?`)) return;
    try {
      await deleteCustomPrompt(prompt.id);
      loadCustomGroups();
    } catch { /* keep list as-is on failure */ }
  }, [loadCustomGroups]);

  const handleDeleteCustomGroup = useCallback(async (group) => {
    const count = group.prompts?.length ?? 0;
    if (!window.confirm(`Delete group "${group.name}"${count ? ` and its ${count} prompt(s)` : ''}?`)) return;
    try {
      await deleteCustomPromptGroup(group.id);
      loadCustomGroups();
    } catch { /* keep list as-is on failure */ }
  }, [loadCustomGroups]);

  const handleClearChat = () => { setMessages([]); clear(); };

  const filteredPresets = presets.filter((p) => {
    if (!presetSearch.trim()) return true;
    const q = presetSearch.toLowerCase();
    return (p.name || '').toLowerCase().includes(q) || (p.label || '').toLowerCase().includes(q);
  });

  if (!isOpen) return null;

  const panelLeft = sidebarCollapsed ? 80 : 288;
  const panelWidth = `calc(100vw - ${panelLeft}px)`;

  const errorText = typeof streamError === 'string'
    ? streamError
    : streamError?.body || streamError?.message || streamError?.title || null;

  return (
    <>
      <div className="ds-backdrop" onClick={onClose} style={{ opacity: 0 }} />

      <div className="ds-panel" style={{ left: panelLeft, width: panelWidth }}>

        {/* header */}
        <div className="ds-header">
          <div className="ds-header__title">
            <div className="ds-header__icon"><Zap size={16} /></div>
            <span>DeepSeek AI</span>
          </div>
          <button className="ds-header__close" onClick={onClose} title="Close"><X size={18} /></button>
        </div>

        {/* case selector */}
        <div className="ds-case-selector" ref={caseDropRef}>
          <label className="ds-case-selector__label">Case / Folder</label>
          <button
            className={`ds-case-selector__trigger ${caseDropdownOpen ? 'ds-case-selector__trigger--open' : ''}`}
            onClick={() => setCaseDropdownOpen((v) => !v)}
          >
            {casesLoading ? (
              <span className="ds-case-selector__placeholder"><Loader2 size={14} className="ds-spin" /> Loading cases…</span>
            ) : selectedCase ? (
              <span className="ds-case-selector__value">{selectedCase.name || selectedCase.title || selectedCase.id}</span>
            ) : (
              <span className="ds-case-selector__placeholder">Select a case to begin…</span>
            )}
            <ChevronDown size={16} className={`ds-case-selector__chevron ${caseDropdownOpen ? 'ds-case-selector__chevron--up' : ''}`} />
          </button>

          {caseDropdownOpen && (
            <div className="ds-case-dropdown">
              {cases.length === 0 ? (
                <div className="ds-case-dropdown__empty">No cases found</div>
              ) : (
                cases.map((c) => (
                  <button
                    key={c.id || c.name}
                    className={`ds-case-dropdown__item ${selectedCase?.id === c.id ? 'ds-case-dropdown__item--active' : ''}`}
                    onClick={() => { setSelectedCase(c); setCaseDropdownOpen(false); handleClearChat(); }}
                  >
                    {c.name || c.title || c.id}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* two-column body */}
        <div className="ds-body">

          {/* LEFT: preset prompts */}
          <div className="ds-presets">
            <div className="ds-presets__header">
              <BookOpen size={14} />
              <span>Preset Prompts</span>
              {presets.length > 0 && <span className="ds-tab__badge">{presets.length}</span>}
              <button
                className="ds-presets__add"
                onClick={() => setShowPromptBuilder(true)}
                title="Create your own custom prompt"
                aria-label="Create custom prompt"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="ds-presets__search">
              <Search size={14} className="ds-presets__search-icon" />
              <input
                type="text"
                placeholder="Search prompts…"
                value={presetSearch}
                onChange={(e) => setPresetSearch(e.target.value)}
                className="ds-presets__search-input"
              />
            </div>
            <div className="ds-presets__list">
              {presetsLoading ? (
                <div className="ds-presets__loading"><Loader2 size={18} className="ds-spin" /><span>Loading prompts…</span></div>
              ) : filteredPresets.length === 0 ? (
                <div className="ds-presets__empty">
                  {presetSearch ? 'No prompts match your search.' : 'No preset prompts available.'}
                </div>
              ) : (
                filteredPresets.map((preset) => (
                  <button
                    key={preset.id}
                    className="ds-preset-item"
                    onClick={() => handlePresetClick(preset)}
                    title={!selectedCase ? 'Select a case first' : ''}
                  >
                    <span className="ds-preset-item__icon"><PresetIcon /></span>
                    <span className="ds-preset-item__name">{preset.name || preset.label || preset.id}</span>
                    {!selectedCase && <span className="ds-preset-item__hint">Select case first</span>}
                  </button>
                ))
              )}
            </div>

            {/* user's own prompt groups */}
            <div className="ds-custom-section">
              <div className="ds-presets__header ds-custom-section__header">
                <FolderHeart size={14} />
                <span>My Prompts</span>
                {customGroups.length > 0 && (
                  <span className="ds-tab__badge">
                    {customGroups.reduce((n, g) => n + (g.prompts?.length ?? 0), 0)}
                  </span>
                )}
                <button
                  className="ds-presets__add"
                  onClick={() => setShowPromptBuilder(true)}
                  title="Create your own custom prompt"
                  aria-label="Create custom prompt"
                >
                  <Plus size={14} />
                </button>
              </div>
              <div className="ds-custom-section__body">
                <CustomPromptGroups
                  groups={customGroups}
                  loading={customGroupsLoading}
                  onPromptClick={handleCustomPromptClick}
                  onDeletePrompt={handleDeleteCustomPrompt}
                  onDeleteGroup={handleDeleteCustomGroup}
                />
              </div>
            </div>
          </div>

          {/* RIGHT: chat */}
          <div className="ds-chat-pane">
            <div className="ds-messages">
              {!selectedCase && messages.length === 0 && (
                <div className="ds-messages__empty">
                  <Bot size={32} className="ds-messages__empty-icon" />
                  <p>Select a case above, then ask a question or run a preset prompt.</p>
                </div>
              )}

              {messages.map((msg) =>
                msg.role === 'user' ? (
                  <div key={msg.id} className={`ds-msg ds-msg--user ${msg.isPreset ? 'ds-msg--preset' : ''}`}>
                    <div className="ds-msg__body">
                      {msg.isPreset
                        ? <span className="ds-msg__preset-label"><PresetIcon /> {msg.text}</span>
                        : msg.text}
                    </div>
                  </div>
                ) : (
                  <AssistantMessage key={msg.id} text={msg.text} />
                )
              )}

              {isStreaming && <AssistantMessage text={streamText || ''} />}

              {streamError && !isStreaming && errorText && (
                <div className="ds-msg ds-msg--error">
                  <span>⚠ {errorText}</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* input bar */}
            <div className="ds-input-bar">
              {messages.length > 0 && (
                <button className="ds-input-bar__clear" onClick={handleClearChat} title="Clear chat">
                  <RotateCcw size={14} />
                </button>
              )}
              <textarea
                ref={inputRef}
                className="ds-input-bar__textarea"
                placeholder={selectedCase ? 'Ask DeepSeek about this case…' : 'Select a case first…'}
                value={inputText}
                disabled={!selectedCase || isStreaming}
                rows={1}
                onChange={(e) => {
                  setInputText(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                }}
                onKeyDown={handleKeyDown}
              />
              <button
                className={`ds-input-bar__send ${(!selectedCase || !inputText.trim() || isStreaming) ? 'ds-input-bar__send--disabled' : ''}`}
                disabled={!selectedCase || !inputText.trim() || isStreaming}
                onClick={() => handleSend(inputText)}
                title="Send"
              >
                {isStreaming ? <Loader2 size={16} className="ds-spin" /> : <Send size={16} />}
              </button>
            </div>
          </div>

        </div>
      </div>

      <CustomPromptBuilderModal
        isOpen={showPromptBuilder}
        onClose={() => setShowPromptBuilder(false)}
        groups={customGroups}
        onSaved={() => loadCustomGroups()}
      />
    </>
  );
}
