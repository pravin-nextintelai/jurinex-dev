import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import apiService from "@/shared/api/api";
import Swal from "sweetalert2";

const ChatHistoryPage = () => {
  const [chatModelChats, setChatModelChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChats, setSelectedChats] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(null);
  const navigate = useNavigate();

  const fetchChatModelChats = async () => {
    try {
      setLoading(true);
      setError(null);
      const allChats = [];

      // File-based sessions
      try {
        const filesResponse = await apiService.getChatModelFiles();
        if (filesResponse.success && filesResponse.data?.files?.length > 0) {
          for (const file of filesResponse.data.files) {
            try {
              const sessionsResponse = await apiService.getChatModelSessions(file.id);
              if (sessionsResponse.success && sessionsResponse.data?.sessions) {
                sessionsResponse.data.sessions.forEach((session) => {
                  const msgs = session.messages || [];
                  const lastMsg = msgs[msgs.length - 1];
                  if (lastMsg) {
                    allChats.push({
                      id: lastMsg.id,
                      file_id: file.id,
                      session_id: session.session_id,
                      question: lastMsg.question,
                      answer: lastMsg.answer,
                      created_at: session.last_message_at || lastMsg.created_at,
                      filename: file.filename,
                      message_count: session.message_count || msgs.length,
                      is_general_chat: false,
                    });
                  }
                });
              }
            } catch (err) {
              console.error(`[Chats] Error fetching sessions for file ${file.id}:`, err.message);
            }
          }
        }
      } catch (err) {
        console.error('[Chats] Error fetching ChatModel files:', err.message);
      }

      // General chat sessions (no file)
      try {
        const generalResponse = await apiService.getGeneralChatSessions();
        if (generalResponse.success && generalResponse.data?.sessions?.length > 0) {
          generalResponse.data.sessions.forEach((session) => {
            allChats.push({
              id: `general-${session.session_id}`,
              file_id: null,
              session_id: session.session_id,
              question: session.last_question || session.first_question || 'Legal question',
              answer: '',
              created_at: session.last_message_at,
              filename: null,
              message_count: session.message_count,
              is_general_chat: true,
            });
          });
        }
      } catch (err) {
        console.error('[Chats] Error fetching general chat sessions:', err.message);
      }

      setChatModelChats(allChats);
    } catch (err) {
      console.error('[Chats] Unexpected error:', err.message);
      setError(err.message || 'Failed to load chats');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChatModelChats();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.dropdown-container')) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const generateTopicTitle = (chat) => {
    if (!chat.question) return 'Untitled Chat';
    const words = chat.question.trim().split(' ');
    return words.length <= 8 ? chat.question : words.slice(0, 8).join(' ') + '...';
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffMinutes = Math.floor(diffTime / (1000 * 60));
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 7) return `${diffDays} days ago`;
    return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) !== 1 ? 's' : ''} ago`;
  };

  const handleChatClick = (chat) => {
    if (selectionMode) {
      toggleChatSelection(chat.id);
      return;
    }

    if (chat.is_general_chat || !chat.file_id) {
      navigate(`/chatmodel/session/${encodeURIComponent(chat.session_id)}`, {
        state: { chat: { session_id: chat.session_id, question: chat.question, is_general_chat: true } },
      });
    } else {
      navigate(`/chatmodel/${chat.file_id}/${chat.session_id}`, {
        state: { chat: { ...chat } },
      });
    }
  };

  const handleDeleteChat = async (chat, event) => {
    if (event) event.stopPropagation();
    setOpenDropdown(null);

    const result = await Swal.fire({
      title: 'Delete chat',
      text: 'Are you sure you want to delete this chat?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#21C1B6',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
      customClass: { popup: 'rounded-lg', confirmButton: 'rounded-lg', cancelButton: 'rounded-lg' },
    });

    if (result.isConfirmed) {
      setDeleting(true);
      try {
        setChatModelChats((prev) => prev.filter((c) => c.id !== chat.id));
        Swal.fire({ title: 'Deleted!', text: 'Chat has been deleted.', icon: 'success', timer: 1500, showConfirmButton: false });
      } catch (err) {
        console.error('[Chats] Error deleting chat:', err);
        Swal.fire({ title: 'Error!', text: err.message || 'Failed to delete chat.', icon: 'error', confirmButtonColor: '#21C1B6' });
      } finally {
        setDeleting(false);
      }
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedChats.size === 0) return;

    const result = await Swal.fire({
      title: `Delete ${selectedChats.size} chat(s)?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#21C1B6',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
      customClass: { popup: 'rounded-lg', confirmButton: 'rounded-lg', cancelButton: 'rounded-lg' },
    });

    if (result.isConfirmed) {
      setDeleting(true);
      setChatModelChats((prev) => prev.filter((c) => !selectedChats.has(c.id)));
      setSelectedChats(new Set());
      setSelectionMode(false);
      setDeleting(false);
      Swal.fire({ title: 'Deleted!', icon: 'success', timer: 1200, showConfirmButton: false });
    }
  };

  const handleDeleteAll = async () => {
    if (chatModelChats.length === 0) return;

    const result = await Swal.fire({
      title: 'Delete all chats?',
      text: `This will remove all ${chatModelChats.length} conversations from this view.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#21C1B6',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Delete All',
      cancelButtonText: 'Cancel',
      customClass: { popup: 'rounded-lg', confirmButton: 'rounded-lg', cancelButton: 'rounded-lg' },
    });

    if (result.isConfirmed) {
      setDeleting(true);
      setChatModelChats([]);
      setSelectedChats(new Set());
      setSelectionMode(false);
      setDeleting(false);
      Swal.fire({ title: 'Cleared!', icon: 'success', timer: 1200, showConfirmButton: false });
    }
  };

  const toggleSelectionMode = () => {
    setSelectionMode((prev) => !prev);
    if (selectionMode) setSelectedChats(new Set());
  };

  const toggleChatSelection = (chatId, event) => {
    if (event) event.stopPropagation();
    const next = new Set(selectedChats);
    next.has(chatId) ? next.delete(chatId) : next.add(chatId);
    setSelectedChats(next);
  };

  const toggleDropdown = (chatId, event) => {
    if (event) event.stopPropagation();
    setOpenDropdown(openDropdown === chatId ? null : chatId);
  };

  const filteredChats = chatModelChats
    .filter(
      (chat) =>
        chat.question?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        chat.filename?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1AA49B]"></div>
          <p className="text-gray-500 text-sm">Loading conversations...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-md border border-[#cfe1db] overflow-hidden max-w-sm w-full mx-4">
          <div className="bg-gradient-to-r from-[#21C1B6] to-[#1f6b5f] px-5 py-3.5">
            <p className="text-white font-semibold text-sm">Failed to load chats</p>
          </div>
          <div className="px-5 py-4 bg-[#eef5f2]">
            <p className="text-sm text-[#2b3528]">{error}</p>
            <button
              onClick={fetchChatModelChats}
              className="mt-3 px-4 py-1.5 bg-[#21C1B6] hover:bg-[#1AA49B] text-white text-xs font-semibold rounded-lg transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <h1 className="text-xl font-semibold text-gray-900">Your chat history</h1>

          <div className="flex items-center gap-2">
            {selectionMode && selectedChats.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                disabled={deleting}
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete ({selectedChats.size})
              </button>
            )}
            {chatModelChats.length > 0 && !selectionMode && (
              <button
                onClick={handleDeleteAll}
                disabled={deleting}
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete All
              </button>
            )}
            <button
              onClick={() => navigate('/chatmodel')}
              className="inline-flex items-center px-4 py-1.5 text-sm font-medium text-white rounded-lg transition-colors bg-[#21C1B6] hover:bg-[#1AA49B]"
            >
              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New chat
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            placeholder="Search your chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="block w-full pl-10 pr-3 py-3 border-2 border-[#21C1B6] rounded-xl text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#1AA49B] focus:border-[#1AA49B] bg-white"
          />
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-between mb-4 text-sm text-gray-600">
          <span>{filteredChats.length} conversation{filteredChats.length !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-3">
            {selectionMode && (
              <>
                <button onClick={() => setSelectedChats(new Set(filteredChats.map((c) => c.id)))} className="text-[#21C1B6] hover:text-[#1AA49B] font-medium">
                  Select All
                </button>
                <button onClick={() => setSelectedChats(new Set())} className="text-[#21C1B6] hover:text-[#1AA49B] font-medium">
                  Deselect All
                </button>
              </>
            )}
            <button
              onClick={toggleSelectionMode}
              className={`font-medium ${selectionMode ? 'text-red-500 hover:text-red-600' : 'text-[#21C1B6] hover:text-[#1AA49B]'}`}
            >
              {selectionMode ? 'Cancel' : 'Select'}
            </button>
          </div>
        </div>

        {/* Chat list */}
        <div className="space-y-3">
          {filteredChats.map((chat, index) => (
            <div
              key={chat.id || index}
              onClick={() => handleChatClick(chat)}
              className={`group cursor-pointer px-6 py-5 rounded-2xl border-2 transition-all ${
                selectionMode && selectedChats.has(chat.id)
                  ? 'bg-[#E6F7F5] border-[#1AA49B]'
                  : 'bg-white border-[#A3E4DB] hover:border-[#1AA49B] hover:bg-[#F5FFFE]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {selectionMode && (
                    <input
                      type="checkbox"
                      checked={selectedChats.has(chat.id)}
                      onChange={(e) => toggleChatSelection(chat.id, e)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-5 h-5 text-[#21C1B6] border-gray-300 rounded focus:ring-[#21C1B6] cursor-pointer"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-medium text-gray-900 truncate">
                        {generateTopicTitle(chat)}
                      </h3>
                      {chat.filename && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#e6f7f5] text-[#1AA49B] shrink-0">
                          {chat.filename.length > 20 ? chat.filename.slice(0, 20) + '…' : chat.filename}
                        </span>
                      )}
                      {chat.is_general_chat && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600 shrink-0">
                          General
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{formatDate(chat.created_at)}</span>
                      {chat.message_count > 1 && (
                        <span>{chat.message_count} messages</span>
                      )}
                    </div>
                  </div>
                </div>

                {!selectionMode && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity relative dropdown-container ml-2">
                    <button
                      className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                      onClick={(e) => toggleDropdown(chat.id, e)}
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                      </svg>
                    </button>
                    {openDropdown === chat.id && (
                      <div className="absolute right-0 top-10 z-50 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1">
                        <button
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                          onClick={(e) => handleDeleteChat(chat, e)}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Search no results */}
        {searchQuery && filteredChats.length === 0 && (
          <div className="text-center py-16">
            <svg className="mx-auto h-12 w-12 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-gray-500 text-sm">No conversations match your search</p>
          </div>
        )}

        {/* Empty state */}
        {!searchQuery && filteredChats.length === 0 && (
          <div className="text-center py-16">
            <svg className="mx-auto h-16 w-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-gray-600 text-lg font-medium mb-2">No conversations yet</p>
            <p className="text-gray-500 text-sm mb-5">Start a chat to see your history here</p>
            <button
              onClick={() => navigate('/chatmodel')}
              className="inline-flex items-center px-5 py-2 text-sm font-medium text-white rounded-xl bg-[#21C1B6] hover:bg-[#1AA49B] transition-colors"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Start a new chat
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default ChatHistoryPage;
