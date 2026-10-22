import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-toastify';
import googleDriveApi, {
  openGooglePicker,
  loadGooglePickerApi,
  getGooglePickerApiKey,
  validateGooglePickerApiKey,
} from '@/shared/api/googleDriveApi';
import driveLogo from '@/assets/3128271.png';

const GoogleDrivePicker = ({ 
  onFilesSelected, 
  onUploadComplete,
  folderName,
  buttonClassName,
  iconClassName,
  buttonText = 'Google Drive',
  multiselect = true,
  disabled = false,
  showDriveIcon = false,
  showIconOnly = false
}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(true);
  const [currentAccessToken, setCurrentAccessToken] = useState(null);
  const isProcessingRef = useRef(false); // Guard to prevent duplicate processing

  // Check connection status on mount
  useEffect(() => {
    checkConnectionStatus();
  }, []);

  const checkConnectionStatus = async () => {
    try {
      setCheckingConnection(true);
      const status = await googleDriveApi.getConnectionStatus();
      setIsConnected(status.connected);
    } catch (error) {
      console.error('[GoogleDrive] Error checking status:', error);
      setIsConnected(false);
    } finally {
      setCheckingConnection(false);
    }
  };

  // Handle OAuth callback from popup/redirect
  useEffect(() => {
    const handleMessage = async (event) => {
      // Only process messages from same origin
      if (event.origin !== window.location.origin) {
        return;
      }
      
      // Prevent duplicate processing
      if (isProcessingRef.current) {
        console.log('[GoogleDrive] Already processing callback, skipping duplicate message');
        return;
      }
      
      if (event.data?.type === 'GOOGLE_DRIVE_AUTH_SUCCESS') {
        const { code, state } = event.data;
        
        // If backend already processed (no code/state in message), just update status
        if (!code || !state) {
          console.log('[GoogleDrive] Backend already processed callback, updating connection status');
          isProcessingRef.current = true;
          setIsConnected(true);
          // Re-check connection status to ensure it's updated
          checkConnectionStatus();
          // Reset after a delay to allow future callbacks
          setTimeout(() => {
            isProcessingRef.current = false;
          }, 2000);
          // Don't call handleCallback again - backend already did it
          return;
        }
        
        // Legacy flow: if code/state are present, POST to backend
        // This should rarely happen since backend handles it first
        isProcessingRef.current = true;
        try {
          console.log('[GoogleDrive] Processing callback with code/state from message');
          await googleDriveApi.handleCallback(code, state);
          setIsConnected(true);
          toast.success('Google Drive connected successfully!');
        } catch (error) {
          console.error('[GoogleDrive] Callback error:', error);
          // Only show error if it's not a "code already used" error
          if (!error.response?.data?.message?.includes('already') && 
              !error.response?.data?.message?.includes('Invalid authorization code')) {
            toast.error('Failed to connect Google Drive');
          }
        } finally {
          // Reset after a delay to allow future callbacks
          setTimeout(() => {
            isProcessingRef.current = false;
          }, 2000);
        }
      } else if (event.data?.type === 'GOOGLE_DRIVE_AUTH_ERROR') {
        isProcessingRef.current = true;
        console.error('[GoogleDrive] Auth error from popup:', event.data.error);
        setIsConnected(false);
        toast.error(`Google Drive connection failed: ${event.data.error || 'Unknown error'}`);
        // Reset after a delay
        setTimeout(() => {
          isProcessingRef.current = false;
        }, 2000);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Handle URL params for OAuth callback (if using redirect flow)
  // NOTE: This should rarely execute since the callback page handles redirects
  useEffect(() => {
    // Only process if we're on the callback route and not already processed
    if (!window.location.pathname.includes('/auth/google/drive/callback')) {
      return;
    }
    
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const success = urlParams.get('success');
    const error = urlParams.get('error');
    
    // Don't process if backend already handled it (success/error present)
    // The callback page will handle these cases
    if (success || error) {
      return;
    }
    
    // Only process if code and state are present and state contains userId
    if (code && state?.includes('userId')) {
      handleOAuthCallback(code, state);
    }
  }, []);

  const handleOAuthCallback = async (code, state) => {
    try {
      setIsLoading(true);
      await googleDriveApi.handleCallback(code, state);
      setIsConnected(true);
      toast.success('Google Drive connected successfully!');
      
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (error) {
      console.error('[GoogleDrive] OAuth callback error:', error);
      toast.error('Failed to connect Google Drive');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnectDrive = async () => {
    try {
      setIsLoading(true);
      const { authUrl } = await googleDriveApi.initiateAuth();
      
      // Open OAuth in popup
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      
      const popup = window.open(
        authUrl,
        'google-drive-auth',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
      );

      // Poll for popup close (fallback for redirect flow)
      const pollTimer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(pollTimer);
          setIsLoading(false);
          // Re-check connection status
          checkConnectionStatus();
        }
      }, 500);

    } catch (error) {
      console.error('[GoogleDrive] Error initiating auth:', error);
      const msg =
        error.response?.data?.message ||
        error.response?.data?.error ||
        (error.response?.status === 503 ? 'Google Drive OAuth is not configured on the server' : null);
      toast.error(msg || 'Failed to start Google Drive connection');
      setIsLoading(false);
    }
  };

  const handleOpenPicker = async () => {
    try {
      setIsLoading(true);

      const pickerApiKey = getGooglePickerApiKey();
      const keyValidation = validateGooglePickerApiKey(pickerApiKey);
      if (!keyValidation.valid) {
        toast.error('Google Drive Picker is not configured. Set VITE_GOOGLE_DRIVE_API_KEY in frontend/.env and restart frontend.');
        console.error('[GoogleDrive] Missing/invalid Google Picker API key:', {
          reason: keyValidation.reason,
          hasLegacyKey: Boolean(import.meta.env.VITE_GOOGLE_API_KEY),
          hasDriveKey: Boolean(import.meta.env.VITE_GOOGLE_DRIVE_API_KEY),
        });
        return;
      }

      // Get fresh access token
      let tokenData;
      try {
        tokenData = await googleDriveApi.getAccessToken();
      } catch (error) {
        if (error.response?.data?.needsAuth) {
          setIsConnected(false);
          toast.info('Please reconnect your Google Drive');
          return;
        }
        throw error;
      }

      // Store the access token for later use when downloading
      setCurrentAccessToken(tokenData.accessToken);

      // Load and open picker
      await loadGooglePickerApi();
      
      openGooglePicker({
        accessToken: tokenData.accessToken,
        apiKey: pickerApiKey,
        multiselect,
        onSelect: (files) => handleFilesSelected(files, tokenData.accessToken),
        onCancel: () => {
          console.log('[GoogleDrive] Picker cancelled');
        }
      });

    } catch (error) {
      console.error('[GoogleDrive] Error opening picker:', error);
      toast.error('Failed to open Google Drive picker');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFilesSelected = async (files, accessToken) => {
    console.log('[GoogleDrive] Files selected:', files);
    
    if (onFilesSelected) {
      onFilesSelected(files);
    }

    // If onUploadComplete is provided, download files to server
    if (onUploadComplete) {
      try {
        setIsUploading(true);
        toast.info(`Downloading ${files.length} file(s) from Google Drive...`);

        // Pass the access token to the API
        const token = accessToken || currentAccessToken;
        if (!token) {
          throw new Error('No access token available. Please try again.');
        }

        const result = await googleDriveApi.downloadMultipleFiles(files, token, folderName);
        
        if (result.success) {
          toast.success(`Successfully uploaded ${result.summary.successful} file(s)`);
          
          if (result.summary.failed > 0) {
            toast.warning(`${result.summary.failed} file(s) failed to upload`);
          }
          
          onUploadComplete(result.documents.filter(d => d.status === 'queued'));
        } else {
          // Get specific error from failed documents
          const failedDoc = result.documents?.find(d => d.status === 'failed');
          const errorMsg = failedDoc?.error || result.error || result.message || 'Upload failed';
          console.error('[GoogleDrive] Upload failed:', errorMsg, result);
          throw new Error(errorMsg);
        }
      } catch (error) {
        console.error('[GoogleDrive] Upload error:', error);
        
        if (error.response?.data?.needsAuth) {
          setIsConnected(false);
          toast.error('Google Drive authorization expired. Please reconnect.');
        } else {
          toast.error(error.message || error.response?.data?.error || 'Failed to upload files from Google Drive');
        }
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleClick = () => {
    if (isConnected) {
      handleOpenPicker();
    } else {
      handleConnectDrive();
    }
  };

  if (checkingConnection) {
    return (
      <button
        disabled
        className={buttonClassName || "px-4 py-2 bg-gray-600 text-white rounded-md flex items-center gap-2 opacity-50 cursor-not-allowed"}
      >
        <img src={driveLogo} alt="Google Drive" className={iconClassName || "h-5 w-5 opacity-50"} />
        <span className="font-medium">Checking...</span>
      </button>
    );
  }

  // Icon size based on className
  const iconSize = iconClassName?.includes('h-4') ? 'h-4 w-4' : iconClassName?.includes('h-5') ? 'h-5 w-5' : 'h-5 w-5';

  return (
    <button
      onClick={handleClick}
      disabled={disabled || isLoading || isUploading}
      className={buttonClassName || `px-4 py-2 text-white rounded-md flex items-center gap-2 transition-colors duration-200 ${
        disabled || isLoading || isUploading 
          ? 'bg-gray-600 cursor-not-allowed opacity-50' 
          : 'bg-[#4285F4] hover:bg-[#3367D6]'
      }`}
      title={showIconOnly ? (isConnected ? 'Upload from Google Drive' : 'Connect Google Drive') : undefined}
    >
      {isLoading || isUploading ? (
        <svg className={iconClassName || "animate-spin h-5 w-5"} viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ) : (
        <img src={driveLogo} alt="Google Drive" className={iconClassName || iconSize} />
      )}
      {!showIconOnly && (
        <span className="font-medium">
          {isUploading 
            ? 'Uploading...' 
            : isLoading 
              ? 'Loading...' 
              : isConnected 
                ? buttonText 
                : 'Connect Drive'}
        </span>
      )}
    </button>
  );
};

export default GoogleDrivePicker;

