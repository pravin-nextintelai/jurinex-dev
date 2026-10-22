import React from 'react';
import { ChevronRight } from 'lucide-react';

const MessagesList = ({
  messages,
  selectedMessageId,
  handleMessageClick,
  displayLimit,
  showAllChats,
  setShowAllChats,
  highlightText,
  formatDate,
  searchQuery,
}) => {
  return (
    <div className="flex-1 overflow-y-auto px-3 py-1.5 [scrollbar-width:thin] [scrollbar-color:#c5c7cc_#f3f4f6] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full">
        <div className="space-y-1.5">
          {messages
            .filter(
              (msg) =>
                (msg.display_text_left_panel || msg.question || '').toLowerCase().includes(searchQuery.toLowerCase())
            )
            .slice(0, showAllChats ? messages.length : displayLimit)
            .map((msg, i) => (
              <div
                key={msg.id || i}
                onClick={() => handleMessageClick(msg)}
                className={`p-2 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md ${
                  selectedMessageId === msg.id ? 'bg-[#E0F7F6] border-[#21C1B6] shadow-sm' : 'bg-white border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900 mb-0.5 line-clamp-2">
                      {highlightText(msg.display_text_left_panel || msg.question, searchQuery)}
                    </p>
                    <div className="flex items-center space-x-1.5 text-xs text-gray-500">
                      <span>{formatDate(msg.timestamp || msg.created_at)}</span>
                      {msg.session_id && (
                        <>
                          <span>•</span>
                          <span className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">
                            {msg.session_id.split('-')[1]?.substring(0, 8) || 'N/A'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {selectedMessageId === msg.id && <ChevronRight className="h-3 w-3 text-[#21C1B6] flex-shrink-0 ml-1.5" />}
                </div>
              </div>
            ))}
          {messages.length > displayLimit && !showAllChats && (
            <div className="text-center py-3">
              <button
                onClick={() => setShowAllChats(true)}
                className="px-3 py-1.5 text-xs font-medium text-[#21C1B6] bg-[#E0F7F6] rounded-lg hover:bg-[#D0EBEA] transition-colors"
              >
                See All ({messages.length - displayLimit} more)
              </button>
            </div>
          )}
        </div>
    </div>
  );
};

export default MessagesList;


