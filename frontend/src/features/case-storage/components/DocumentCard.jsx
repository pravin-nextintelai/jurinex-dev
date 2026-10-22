import React, { useState, useRef, useEffect } from 'react';
import { MoreVertical, Trash2, CheckCircle, AlertCircle, Loader, Music, Play, Pause } from 'lucide-react';
import { toast } from 'react-toastify';
import DocumentProcessingProgress from './DocumentProcessingProgress';
import documentApi from '@/shared/api/documentApi';

const PdfIcon = ({ className = "w-6 h-6", isProcessing = false }) => (
  <svg
    className={className}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M20 2H8C7.46957 2 6.96086 2.21071 6.58579 2.58579C6.21071 2.96086 6 3.46957 6 4V28C6 28.5304 6.21071 29.0391 6.58579 29.4142C6.96086 29.7893 7.46957 30 8 30H24C24.5304 30 25.0391 29.7893 25.4142 29.4142C25.7893 29.0391 26 28.5304 26 28V8L20 2Z"
      fill={isProcessing ? "#DBEAFE" : "#FEE2E2"}
      stroke={isProcessing ? "#3B82F6" : "#DC2626"}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M20 2V8H26"
      fill="white"
      stroke={isProcessing ? "#3B82F6" : "#DC2626"}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <text
      x="16"
      y="20"
      textAnchor="middle"
      fill={isProcessing ? "#2563EB" : "#DC2626"}
      fontSize="7"
      fontWeight="600"
      fontFamily="system-ui, -apple-system, sans-serif"
    >
      PDF
    </text>
  </svg>
);

const DocumentCard = ({ document, individualStatus, onDocumentClick, onDelete }) => {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);
  const [animatedProgress, setAnimatedProgress] = useState(0);
  const animationFrameRef = useRef();
  const audioRef = useRef(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isResolvingAudio, setIsResolvingAudio] = useState(false);
  const [resolvedAudioUrl, setResolvedAudioUrl] = useState(null);
  const generatedBlobUrlRef = useRef(null);
  const pendingPlayRef = useRef(false);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      window.document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      window.document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMenu]);

  useEffect(() => {
    const targetProgress = individualStatus?.progress ?? document.processing_progress ?? 0;
    const status = individualStatus?.status || document.status || 'unknown';
    const isCompleted = ['completed', 'processed', 'ready', 'success'].includes(status.toLowerCase());

    if (isCompleted) {
      setAnimatedProgress(100);
      return;
    }

    const animate = () => {
      setAnimatedProgress(current => {
        const diff = targetProgress - current;
        if (Math.abs(diff) < 0.1) {
          cancelAnimationFrame(animationFrameRef.current);
          return targetProgress;
        }
        const step = diff * 0.1;
        return current + step;
      });
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [individualStatus?.progress, document.processing_progress, individualStatus?.status, document.status]);

  const getStatusBadgeColor = (status) => {
    if (!status) return 'bg-gray-50 text-gray-600 border border-gray-200';

    const statusLower = status.toLowerCase();
    switch (statusLower) {
      case 'completed':
      case 'processed':
      case 'ready':
      case 'success':
        return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
      case 'processing':
      case 'batch_processing':
        return 'bg-blue-50 text-blue-700 border border-blue-200';
      case 'pending':
        return 'bg-yellow-50 text-yellow-700 border border-yellow-200';
      case 'queued':
      case 'batch_queued':
        return 'bg-amber-50 text-amber-700 border border-amber-200';
      case 'failed':
      case 'error':
        return 'bg-red-50 text-red-700 border border-red-200';
      default:
        return 'bg-gray-50 text-gray-600 border border-gray-200';
    }
  };

  const getStatusIcon = (status) => {
    const statusLower = status?.toLowerCase() || '';
    
    if (['completed', 'processed', 'ready', 'success'].includes(statusLower)) {
      return <CheckCircle className="w-3 h-3" />;
    }
    if (['processing', 'batch_processing', 'queued', 'batch_queued', 'pending'].includes(statusLower)) {
      return <Loader className="w-3 h-3 animate-spin" />;
    }
    if (['failed', 'error'].includes(statusLower)) {
      return <AlertCircle className="w-3 h-3" />;
    }
    return null;
  };

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return 'N/A';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown date';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (e) {
      return 'Invalid date';
    }
  };

  const displayName = document.name ||
                      document.originalname ||
                      document.filename ||
                      document.original_name ||
                      "Unnamed Document";
  const normalizedName = displayName.toLowerCase();
  const normalizedMime = (document.mimetype || document.mimeType || document.type || '').toLowerCase();
  const isAudioFile =
    normalizedMime.startsWith('audio/') ||
    ['.mp3', '.wav', '.wave', '.flac', '.ogg', '.opus', '.webm', '.m4a', '.aac', '.amr'].some((ext) =>
      normalizedName.endsWith(ext)
    );
  const directAudioUrl = document.previewUrl || document.viewUrl || document.url || null;
  const audioUrl = resolvedAudioUrl || directAudioUrl;

  const currentStatus = individualStatus?.status || document.status || 'unknown';
  const progress = animatedProgress;
  const currentOperation = individualStatus?.current_operation || document.current_operation || '';

  const isProcessing = ['processing', 'queued', 'pending', 'batch_processing', 'batch_queued'].includes(currentStatus.toLowerCase());
  const isFailed = ['failed', 'error'].includes(currentStatus.toLowerCase());
  const isCompleted = ['completed', 'processed', 'ready', 'success'].includes(currentStatus.toLowerCase());

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete "${displayName}"?`)) {
      try {
        await onDelete(document.id);
        toast.success(`Document "${displayName}" deleted successfully!`);
      } catch (error) {
        toast.error(`Failed to delete document "${displayName}".`);
        console.error("Error deleting document:", error);
      }
    }
    setShowMenu(false);
  };

  const toggleMenu = (e) => {
    e.stopPropagation();
    setShowMenu(!showMenu);
  };

  useEffect(() => {
    if (generatedBlobUrlRef.current) {
      URL.revokeObjectURL(generatedBlobUrlRef.current);
      generatedBlobUrlRef.current = null;
    }
    setResolvedAudioUrl(null);
    setIsAudioPlaying(false);
    pendingPlayRef.current = false;
  }, [document.id]);

  useEffect(() => {
    return () => {
      if (generatedBlobUrlRef.current) {
        URL.revokeObjectURL(generatedBlobUrlRef.current);
        generatedBlobUrlRef.current = null;
      }
    };
  }, []);

  const resolveAudioUrl = async () => {
    if (audioUrl) return audioUrl;
    if (!document?.id) return null;

    setIsResolvingAudio(true);
    try {
      try {
        const viewData = await documentApi.getDocumentViewInfo(document.id, 1);
        const viewUrl = viewData?.viewUrlWithPage || viewData?.viewUrl || viewData?.signedUrl;
        if (viewUrl) {
          setResolvedAudioUrl(viewUrl);
          return viewUrl;
        }
      } catch (error) {
        console.warn('Audio view URL fetch failed:', error);
      }

      const content = await documentApi.getDocumentContent(document.id);
      const fallbackUrl = content?.previewUrl || content?.viewUrl || content?.url || null;
      if (fallbackUrl) {
        setResolvedAudioUrl(fallbackUrl);
        return fallbackUrl;
      }
      return null;
    } finally {
      setIsResolvingAudio(false);
    }
  };

  const waitForPlayableAudioUrl = async ({ attempts = 6, delayMs = 1000 } = {}) => {
    for (let i = 0; i < attempts; i += 1) {
      const url = await resolveAudioUrl();
      if (url) return url;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return null;
  };

  const waitForAudioReady = (audioEl, timeoutMs = 8000) =>
    new Promise((resolve, reject) => {
      if (!audioEl) {
        reject(new Error('Audio element not found.'));
        return;
      }

      const cleanup = () => {
        audioEl.removeEventListener('loadedmetadata', onReady);
        audioEl.removeEventListener('canplay', onReady);
        audioEl.removeEventListener('error', onError);
        clearTimeout(timer);
      };

      const onReady = () => {
        cleanup();
        resolve(true);
      };

      const onError = () => {
        cleanup();
        reject(new Error('Audio source could not be loaded.'));
      };

      if (audioEl.readyState >= 2) {
        resolve(true);
        return;
      }

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Audio loading timed out.'));
      }, timeoutMs);

      audioEl.addEventListener('loadedmetadata', onReady);
      audioEl.addEventListener('canplay', onReady);
      audioEl.addEventListener('error', onError);
    });

  const tryPlayWithPreparedSource = async (audioEl, primaryUrl, secondaryUrl = null) => {
    const candidates = [primaryUrl, secondaryUrl].filter(Boolean);
    let lastError = null;

    for (const url of candidates) {
      try {
        if (audioEl.src !== url) {
          audioEl.src = url;
          audioEl.load();
        }
        await waitForAudioReady(audioEl, 8000);
        await audioEl.play();
        return true;
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error('Audio playback failed.');
  };

  useEffect(() => {
    if (!isAudioFile || isProcessing || audioUrl || isResolvingAudio) return;
    resolveAudioUrl().catch((error) => {
      console.warn('Background audio URL resolve failed:', error);
    });
  }, [isAudioFile, isProcessing, audioUrl, isResolvingAudio]);

  useEffect(() => {
    if (!audioRef.current || !audioUrl || !pendingPlayRef.current) return;
    const audioEl = audioRef.current;

    const playWhenReady = async () => {
      try {
        if (audioEl.src !== audioUrl) {
          audioEl.src = audioUrl;
          audioEl.load();
        }
        await audioEl.play();
        setIsAudioPlaying(true);
        pendingPlayRef.current = false;
      } catch (error) {
        console.warn('Deferred autoplay blocked, waiting for manual play:', error);
      }
    };

    playWhenReady();
  }, [audioUrl]);

  const handleToggleAudio = async (e) => {
    e.stopPropagation();
    if (!audioRef.current) return;

    try {
      if (!audioUrl) {
        pendingPlayRef.current = true;
      }
      const playableUrl = await waitForPlayableAudioUrl({ attempts: 6, delayMs: 1000 });
      if (!playableUrl) {
        // Keep pending state; user can keep using same top play button while backend finalizes.
        toast.info('Audio is still preparing. It will be available shortly.');
        return;
      }

      if (audioRef.current.paused) {
        await tryPlayWithPreparedSource(audioRef.current, playableUrl, directAudioUrl);
        setIsAudioPlaying(true);
        pendingPlayRef.current = false;
      } else {
        audioRef.current.pause();
        setIsAudioPlaying(false);
        pendingPlayRef.current = false;
      }
    } catch (error) {
      console.error('Audio playback failed:', error);
      if (error?.name === 'AbortError' || error?.name === 'NotAllowedError') {
        // Transient browser/media timing issues should not show a hard failure toast.
        return;
      }
      const message = String(error?.message || '').toLowerCase();
      if (message.includes('404') || message.includes('not found') || message.includes('not available')) {
        toast.info('Audio is still processing. Please try again in a few seconds.');
        return;
      }
      if (message.includes('timed out') || message.includes('could not be loaded')) {
        toast.info('Audio is loading. Please try once more.');
        return;
      }
      pendingPlayRef.current = false;
      toast.error('Unable to play this audio file.');
      setIsAudioPlaying(false);
    }
  };

  return (
    <div
      className="group bg-white px-4 py-3 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer border border-gray-100 hover:border-gray-200 relative"
      onClick={() => !isProcessing && !isAudioFile && onDocumentClick(document)}
      style={{ opacity: isProcessing ? 0.95 : 1 }}
    >
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">
          {isAudioFile ? (
            <div className="w-7 h-7 rounded-full bg-[#E0F7F6] text-[#21C1B6] flex items-center justify-center">
              <Music className="w-4 h-4" />
            </div>
          ) : (
            <PdfIcon className="w-7 h-7" isProcessing={isProcessing} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate text-sm leading-tight mb-1" title={displayName}>
                {displayName}
              </p>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="font-medium">{formatFileSize(document.size)}</span>
                <span className="text-gray-300">•</span>
                <span>{formatDate(document.created_at)}</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isAudioFile && !isProcessing && (
                <button
                  onClick={handleToggleAudio}
                  disabled={isResolvingAudio}
                  className="p-1.5 rounded-lg text-[#1f6b5f] hover:bg-[#E0F7F6] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200"
                  title={isAudioPlaying ? 'Pause audio' : 'Play audio'}
                >
                  {isResolvingAudio ? <Loader className="w-4 h-4 animate-spin" /> : isAudioPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
              )}
              <span
                className={`px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap flex items-center gap-1.5 ${getStatusBadgeColor(currentStatus)}`}
              >
                {getStatusIcon(currentStatus)}
                <span className="capitalize">{currentStatus}</span>
              </span>
              {onDelete && !isProcessing && (
                <div className="relative" ref={menuRef}>
                  <button
                    onClick={toggleMenu}
                    className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors duration-200 opacity-0 group-hover:opacity-100"
                    title="More options"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  
                  {showMenu && (
                    <div className="absolute right-0 mt-1 w-36 bg-white rounded-lg shadow-lg border border-gray-200 z-10 overflow-hidden">
                      <button
                        onClick={handleDelete}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors duration-150"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {(isProcessing || isFailed) && (
            <div className="mt-2.5">
              <DocumentProcessingProgress
                document={{ id: document.id, name: displayName }}
                status={currentStatus}
                progress={progress}
                currentOperation={currentOperation}
              />
            </div>
          )}
          {isAudioFile && !isProcessing && (
            <div className="mt-2.5">
              <audio
                ref={audioRef}
                src={audioUrl || undefined}
                controls
                preload="metadata"
                onPlay={() => setIsAudioPlaying(true)}
                onPause={() => setIsAudioPlaying(false)}
                onEnded={() => setIsAudioPlaying(false)}
                onError={() => setIsAudioPlaying(false)}
                className="w-full h-9"
              >
                Your browser does not support the audio element.
              </audio>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentCard;