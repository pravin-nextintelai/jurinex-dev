import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Send, Loader2, ChevronDown, Bot, X, Wrench, Mic, MicOff } from 'lucide-react';
import UploadOptionsMenu from '@/features/case-storage/components/UploadOptionsMenu';
import PromptChipsBar from '@/features/chat/components/PromptChipsBar';

const CHAT_INPUT_MIN_HEIGHT = 24;
const CHAT_INPUT_MAX_HEIGHT = 200;

const ChatInputArea = ({
  fileInputRef,
  isUploading,
  handleFileUpload,
  handleGoogleDriveUpload,
  fileId,
  selectedSecretId,
  processingStatus,
  isLoading,
  isGeneratingInsights,
  isLoadingSecrets,
  activeDropdown,
  secrets,
  handleDropdownSelect,
  chatInput,
  handleChatInputChange,
  isSecretPromptSelected,
  handleSend,
  documentData,
  hasResponse,
  formatFileSize,
  formatDate,
  setIsSecretPromptSelected,
  setActiveDropdown,
  setSelectedSecretId,
  progressPercentage,
  getInputPlaceholder,
  isSplitView = false,
  showToolsDropdown,
  setShowToolsDropdown,
  handleMindmapClick,
  folderName = null,
  setChatInput, // Need this to update input from voice
}) => {
  const toolsDropdownRef = useRef(null);
  const chatInputRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState(null);

  // Speech recognition setup
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognitionInstance = new SpeechRecognition();
      recognitionInstance.continuous = false;
      recognitionInstance.interimResults = false;
      recognitionInstance.lang = 'en-US';

      recognitionInstance.onstart = () => setIsListening(true);
      recognitionInstance.onend = () => setIsListening(false);
      recognitionInstance.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (setChatInput) {
          setChatInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
        
        // Reset secret prompt if voice input is given
        if (isSecretPromptSelected) {
          setIsSecretPromptSelected(false);
          if (setActiveDropdown) setActiveDropdown("Custom Query");
          if (setSelectedSecretId) setSelectedSecretId(null);
        }
      };
      recognitionInstance.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      setRecognition(recognitionInstance);
    }
  }, [isSecretPromptSelected, setChatInput, setActiveDropdown, setSelectedSecretId, setIsSecretPromptSelected]);

  const resizeChatInput = useCallback(() => {
    const ta = chatInputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const nextHeight = Math.min(Math.max(ta.scrollHeight, CHAT_INPUT_MIN_HEIGHT), CHAT_INPUT_MAX_HEIGHT);
    ta.style.height = `${nextHeight}px`;
    ta.style.overflowY = ta.scrollHeight > CHAT_INPUT_MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    resizeChatInput();
  }, [chatInput, resizeChatInput]);

  const onInputChange = (e) => {
    handleChatInputChange(e);
    requestAnimationFrame(resizeChatInput);
  };

  const onInputKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  const toggleListening = () => {
    if (!recognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch (err) {
        console.error('Failed to start recognition:', err);
      }
    }
  };

  return (
    <div className={isSplitView ? '' : 'flex flex-col items-center justify-center h-full w-full'}>
      {!isSplitView && (
        <div className="text-center max-w-2xl px-6 mb-12">
          <h3 className="text-3xl font-bold mb-4 text-gray-900">Welcome to Smart Legal Insights</h3>
          <p className="text-gray-600 text-xl leading-relaxed">
            Upload a legal document or ask a question to begin your AI-powered analysis.
          </p>
        </div>
      )}
      
      <div className={isSplitView ? '' : 'w-full max-w-4xl px-6'}>
        <form onSubmit={handleSend} className="mx-auto">
          {(isLoadingSecrets || secrets.length > 0) && (
            <PromptChipsBar
              secrets={secrets}
              isLoading={isLoadingSecrets}
              selectedSecretId={selectedSecretId}
              activeLabel={isSecretPromptSelected ? activeDropdown : null}
              onSelect={(secret) => handleDropdownSelect(secret.name, secret.id, secret.llm_name)}
              disabled={isLoading || isGeneratingInsights}
              size={isSplitView ? 'compact' : 'default'}
              className={isSplitView ? 'mb-1' : 'mb-1.5'}
            />
          )}
          <div className={`flex items-end space-x-3 bg-gray-50 rounded-xl border ${isSplitView ? 'border-gray-200 px-2.5 py-2' : 'border-gray-500 px-5 py-6'} focus-within:border-[#21C1B6] focus-within:bg-white focus-within:shadow-sm analysis-input-container`}>
            <UploadOptionsMenu
              fileInputRef={fileInputRef}
              isUploading={isUploading}
              onLocalFileClick={() => fileInputRef.current?.click()}
              onGoogleDriveUpload={handleGoogleDriveUpload}
              folderName={folderName}
              isSplitView={isSplitView}
            />
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff,.mp3,.wav,.m4a,.flac,.ogg,.webm,.aac,.mp4"
              onChange={handleFileUpload}
              disabled={isUploading}
              multiple
            />
            <div className="relative flex-shrink-0" ref={toolsDropdownRef}>
              <button
                type="button"
                onClick={() => setShowToolsDropdown(!showToolsDropdown)}
                disabled={isLoading || isGeneratingInsights || !fileId}
                className={`flex items-center space-x-2 ${isSplitView ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'} font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed`}
                title="Tools"
              >
                <Wrench className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
                <span>Tools</span>
                <ChevronDown className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
              </button>
              {showToolsDropdown && (
                <div className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                  <button
                    type="button"
                    onClick={() => {
                      handleMindmapClick();
                      setShowToolsDropdown(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
                  >
                    Mindmap
                  </button>
                </div>
              )}
            </div>
            <textarea
              ref={chatInputRef}
              rows={1}
              value={chatInput}
              onChange={onInputChange}
              onKeyDown={onInputKeyDown}
              placeholder={getInputPlaceholder()}
              className={`flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 ${isSplitView ? 'text-xs' : 'text-[15px]'} font-medium ${isSplitView ? 'py-1' : 'py-2'} min-w-0 analysis-page-user-input resize-none leading-relaxed`}
              style={{ maxHeight: CHAT_INPUT_MAX_HEIGHT, minHeight: CHAT_INPUT_MIN_HEIGHT }}
              disabled={
                isLoading ||
                isGeneratingInsights ||
                !fileId ||
                (processingStatus?.status !== 'processed' &&
                  processingStatus?.status !== null &&
                  progressPercentage < 100)
              }
            />

            <button
              type="button"
              onClick={toggleListening}
              className={`p-2 rounded-full transition-all duration-300 flex-shrink-0 ${
                isListening 
                  ? 'bg-red-500 text-white animate-pulse shadow-lg scale-110' 
                  : 'text-gray-400 hover:text-[#21C1B6] hover:bg-gray-50'
              }`}
              disabled={isLoading || isGeneratingInsights || !fileId || isSecretPromptSelected}
              title={isListening ? "Stop listening" : "Start voice input"}
            >
              {isListening ? (
                <MicOff className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
              ) : (
                <Mic className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
              )}
            </button>

            <button
              type="submit"
              disabled={
                isLoading ||
                isGeneratingInsights ||
                (!chatInput.trim() && !isSecretPromptSelected) ||
                !fileId ||
                (processingStatus && processingStatus.status !== 'processed' && progressPercentage < 100)
              }
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
              className={`${isSplitView ? 'p-1.5' : 'p-2'} bg-black hover:bg-gray-800 disabled:bg-gray-300 text-white rounded-lg transition-colors flex-shrink-0`}
              title="Send Message"
            >
              {isLoading || isGeneratingInsights ? (
                <Loader2 className={isSplitView ? 'h-3 w-3' : 'h-5 w-5'} animate-spin />
              ) : (
                <Send className={isSplitView ? 'h-3 w-3' : 'h-5 w-5'} />
              )}
            </button>
          </div>
          {isSecretPromptSelected && (
            <div className={`mt-${isSplitView ? '1.5' : '3'} p-${isSplitView ? '1.5' : '2'} bg-[#E0F7F6] border border-[#21C1B6] rounded-lg`}>
              <div className={`flex items-center space-x-${isSplitView ? '1.5' : '2'} text-${isSplitView ? 'xs' : 'sm'} text-[#21C1B6]`}>
                <Bot className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
                <span>
                  {isSplitView ? 'Using: ' : 'Using analysis prompt: '}
                  <strong>{activeDropdown}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIsSecretPromptSelected(false);
                    setActiveDropdown('Custom Query');
                    setSelectedSecretId(null);
                  }}
                  className="ml-auto text-[#21C1B6] hover:text-[#1AA49B]"
                >
                  <X className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default ChatInputArea;






