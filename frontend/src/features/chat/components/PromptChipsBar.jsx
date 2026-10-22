import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Plus, X, Trash2 } from 'lucide-react';

/**
 * Prompt library bar.
 *
 * Row 1 — the "+" builder button, the built-in/preset prompt chips, and one
 *         colour-coded tab per custom prompt group.
 * Row 2 — appears when a group tab is open: that group's prompts as pills.
 *         Clicking one runs it; only its name is ever shown, never the body.
 *
 * onSelect(secret) — parent handles preset name / id / llm_name as needed.
 */

// One pastel identity per group, assigned by position so a group keeps its
// colour as long as the list order is stable.
// `band` is the row-2 container tint for that group. Every class is written out
// in full so Tailwind's JIT scanner picks it up (no computed class strings).
const GROUP_COLORS = [
  { idle: 'bg-[#FBF7E8] text-[#8A6D1F]', active: 'bg-white text-[#8A6D1F] border-[#D9C27E]', band: 'bg-[#FDFBF3]' },
  { idle: 'bg-[#E8F7F6] text-[#127a72]', active: 'bg-white text-[#127a72] border-[#21C1B6]', band: 'bg-[#F4FBFA]' },
  { idle: 'bg-[#F0EDFB] text-[#5b4bab]', active: 'bg-white text-[#5b4bab] border-[#9A88E0]', band: 'bg-[#F8F6FD]' },
  { idle: 'bg-[#EAF6EC] text-[#3d7a4a]', active: 'bg-white text-[#3d7a4a] border-[#79BE89]', band: 'bg-[#F5FBF6]' },
  { idle: 'bg-[#FDEFEA] text-[#a35434]', active: 'bg-white text-[#a35434] border-[#E19A78]', band: 'bg-[#FEF8F5]' },
  { idle: 'bg-[#EAF1FA] text-[#3a6291]', active: 'bg-white text-[#3a6291] border-[#7FA8D6]', band: 'bg-[#F5F8FC]' },
];

const groupColor = (index) => GROUP_COLORS[index % GROUP_COLORS.length];

const PromptChipsBar = ({
  secrets = [],
  isLoading = false,
  selectedSecretId = null,
  activeLabel = null,
  onSelect,
  disabled = false,
  className = '',
  size = 'default',
  onAddClick = null,
  customGroups = [],
  onSelectCustomPrompt = null,
  onDeleteCustomPrompt = null,
  onDeleteGroup = null,
}) => {
  const scrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [openGroupId, setOpenGroupId] = useState(null);

  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    updateScrollButtons();
    const el = scrollRef.current;
    if (!el) return undefined;
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateScrollButtons)
      : null;
    ro?.observe(el);
    window.addEventListener('resize', updateScrollButtons);
    return () => {
      el.removeEventListener('scroll', updateScrollButtons);
      ro?.disconnect();
      window.removeEventListener('resize', updateScrollButtons);
    };
  }, [secrets, customGroups, isLoading, updateScrollButtons]);

  // Drop the open group if it disappears (deleted elsewhere).
  useEffect(() => {
    if (openGroupId && !customGroups.some((g) => g.id === openGroupId)) {
      setOpenGroupId(null);
    }
  }, [customGroups, openGroupId]);

  const scrollBy = (direction) => {
    scrollRef.current?.scrollBy({ left: direction * 220, behavior: 'smooth' });
  };

  const compact = size === 'compact';
  const chipClass = compact
    ? 'px-2 py-0.5 text-[11px] leading-tight'
    : 'px-2.5 py-1 text-xs leading-tight';

  const hasCustomFeatures = Boolean(onAddClick || customGroups.length);

  // Built-in modes (Citation Search, Drafting Mode) are always shown — never
  // replaced by a loading spinner while additional secrets are fetched.
  if (!secrets?.length && !hasCustomFeatures) {
    if (isLoading) {
      return (
        <div className={`flex items-center gap-1.5 py-0 text-gray-500 text-[11px] ${className}`}>
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Loading prompts…</span>
        </div>
      );
    }
    return null;
  }

  const openGroup = openGroupId
    ? customGroups.find((g) => g.id === openGroupId) || null
    : null;
  const openGroupIndex = openGroup ? customGroups.indexOf(openGroup) : -1;

  return (
    <div className={`min-w-0 ${className}`}>
      {/* ── row 1: builder button + preset chips + group tabs ─────────────── */}
      <div className="relative flex items-center gap-0.5 min-w-0">
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            disabled={disabled}
            className="flex-shrink-0 p-0.5 rounded-md bg-white text-gray-500 hover:text-gray-800 disabled:opacity-40"
            aria-label="Scroll prompts left"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        )}

        {onAddClick && (
          <button
            type="button"
            disabled={disabled}
            onClick={onAddClick}
            title="Build your own prompt"
            aria-label="Build your own prompt"
            className={`flex-shrink-0 inline-flex items-center justify-center rounded-full text-[#21C1B6] bg-[#f0fdfa] hover:bg-[#E0F7F6] transition-colors ${chipClass} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Plus className="h-3 w-3" />
          </button>
        )}

        <div
          ref={scrollRef}
          className="flex flex-1 gap-1.5 overflow-x-auto min-w-0 py-0 prompt-chips-scroll"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {secrets.map((secret) => {
            const isSelected =
              (selectedSecretId != null && selectedSecretId === secret.id) ||
              (activeLabel && activeLabel === secret.name);
            return (
              <button
                key={secret.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect?.(secret)}
                className={`flex-shrink-0 whitespace-nowrap font-medium rounded-full transition-colors ${chipClass} ${
                  isSelected
                    ? 'bg-[#E0F7F6] text-[#11766f]'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {secret.name}
              </button>
            );
          })}

          {customGroups.map((group, index) => {
            const c = groupColor(index);
            const isOpen = openGroupId === group.id;
            return (
              <button
                key={group.id}
                type="button"
                disabled={disabled}
                onClick={() => setOpenGroupId(isOpen ? null : group.id)}
                title={`${group.prompts?.length ?? 0} prompt(s)`}
                className={`flex-shrink-0 whitespace-nowrap font-medium rounded-full transition-colors ${chipClass} ${
                  isOpen ? `${c.active} shadow-sm border border-[#f1f5f9]` : c.idle
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {group.name}
              </button>
            );
          })}

          {isLoading && (
            <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[11px] text-gray-400">
              <Loader2 className="h-3 w-3 animate-spin" />
            </span>
          )}
        </div>

        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollBy(1)}
            disabled={disabled}
            className="flex-shrink-0 p-0.5 rounded-md bg-white text-gray-500 hover:text-gray-800 disabled:opacity-40"
            aria-label="Scroll prompts right"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* ── row 2: prompts inside the open group ──────────────────────────── */}
      {openGroup && (
        <div
          className={`mt-1 flex gap-1.5 overflow-x-auto rounded-lg border px-2 min-w-0 prompt-chips-scroll ${
            compact ? 'py-1' : 'py-1.5'
          } ${groupColor(openGroupIndex).band}`}
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {(openGroup.prompts || []).length === 0 ? (
            <span className="px-1 py-0.5 text-[11px] text-gray-500 whitespace-nowrap">
              No prompts in this group yet — click + to build one.
            </span>
          ) : (
            openGroup.prompts.map((prompt) => (
              // Wrapper (not a button) so the delete control can nest legally.
              <span
                key={prompt.id}
                className={`group/pill flex-shrink-0 inline-flex items-center whitespace-nowrap rounded-full border border-gray-200 bg-white transition-colors hover:border-[#21C1B6] ${
                  disabled ? 'opacity-50' : ''
                }`}
              >
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelectCustomPrompt?.(prompt)}
                  title={prompt.description || prompt.name}
                  className={`font-medium text-gray-700 group-hover/pill:text-[#21C1B6] rounded-full ${chipClass} disabled:cursor-not-allowed`}
                >
                  {prompt.name}
                </button>
                {onDeleteCustomPrompt && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onDeleteCustomPrompt(prompt)}
                    title={`Delete "${prompt.name}"`}
                    aria-label={`Delete prompt ${prompt.name}`}
                    className="mr-1 -ml-0.5 p-0.5 rounded-full text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover/pill:opacity-100 focus:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))
          )}

          {onDeleteGroup && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onDeleteGroup(openGroup)}
              title={`Delete the "${openGroup.name}" group`}
              className={`flex-shrink-0 ml-auto inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-transparent text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors ${chipClass} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <Trash2 className="h-3 w-3" /> Delete group
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default PromptChipsBar;
