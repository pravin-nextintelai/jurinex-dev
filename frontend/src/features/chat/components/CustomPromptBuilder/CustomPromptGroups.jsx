import React, { useState } from 'react';
import { Folder, FolderOpen, ChevronDown, Trash2, Loader2, FileText } from 'lucide-react';

/**
 * Accordion of the user's custom prompt groups (folders → prompts).
 * Clicking a prompt runs it (parent decides how); small trash icons delete
 * a single prompt or a whole folder.
 */
const CustomPromptGroups = ({
  groups = [],
  loading = false,
  onPromptClick,
  onDeletePrompt,
  onDeleteGroup,
  emptyHint = 'No custom prompts yet. Click + to create one.',
}) => {
  const [openIds, setOpenIds] = useState(() => new Set());

  const toggle = (id) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-4 text-gray-400 text-[13px]">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading your prompts…</span>
      </div>
    );
  }

  if (!groups.length) {
    return <p className="px-3 py-3 text-[12px] text-gray-400 text-center">{emptyHint}</p>;
  }

  return (
    <div className="space-y-1">
      {groups.map((group) => {
        const isOpen = openIds.has(group.id);
        const prompts = group.prompts || [];
        return (
          <div key={group.id} className="rounded-lg border border-gray-100 bg-white overflow-hidden">
            <div className="group/hdr flex items-center gap-2 px-2.5 py-2 hover:bg-gray-50 cursor-pointer" onClick={() => toggle(group.id)}>
              {isOpen
                ? <FolderOpen className="h-4 w-4 text-[#21C1B6] flex-shrink-0" />
                : <Folder className="h-4 w-4 text-[#21C1B6] flex-shrink-0" />}
              <span className="flex-1 text-[13px] font-medium text-gray-800 truncate">{group.name}</span>
              <span className="text-[11px] text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5">{prompts.length}</span>
              {onDeleteGroup && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDeleteGroup(group); }}
                  className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover/hdr:opacity-100 transition-opacity"
                  title="Delete group"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <ChevronDown className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>

            {isOpen && (
              <div className="border-t border-gray-100 py-1">
                {prompts.length === 0 ? (
                  <p className="px-3 py-2 text-[12px] text-gray-400">Empty group — add prompts via +</p>
                ) : (
                  prompts.map((prompt) => (
                    <div key={prompt.id} className="group/item flex items-start gap-2 px-2.5 py-1.5 hover:bg-[#f0fdfa] cursor-pointer">
                      <button
                        type="button"
                        onClick={() => onPromptClick?.(prompt)}
                        className="flex items-start gap-2 flex-1 min-w-0 text-left"
                        title={prompt.description || prompt.prompt_text}
                      >
                        <FileText className="h-3.5 w-3.5 text-[#21C1B6] flex-shrink-0 mt-0.5" />
                        <span className="flex-1 text-[12.5px] text-gray-700 leading-snug">{prompt.name}</span>
                      </button>
                      {onDeletePrompt && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onDeletePrompt(prompt); }}
                          className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover/item:opacity-100 transition-opacity flex-shrink-0"
                          title="Delete prompt"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default CustomPromptGroups;
