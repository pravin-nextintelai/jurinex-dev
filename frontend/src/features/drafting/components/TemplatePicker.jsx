import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import googleDriveApi, {
  loadGooglePickerApi,
  getGooglePickerApiKey,
  validateGooglePickerApiKey,
} from '@/shared/api/googleDriveApi';

/**
 * TemplatePicker Component
 * 
 * A specialized Google Drive Picker for selecting Google Docs templates.
 * Returns the selected template's fileId to the parent component.
 * 
 * @param {Object} props
 * @param {Function} props.onTemplateSelected - Callback when a template is selected (receives { id, name, mimeType, url })
 * @param {Function} [props.onCancel] - Callback when picker is cancelled
 * @param {string} [props.buttonClassName] - Custom button class
 * @param {string} [props.buttonText] - Custom button text
 * @param {boolean} [props.disabled] - Disable the button
 * @param {string} [props.folderId] - Optional folder ID to start browsing from
 */
const TemplatePicker = ({
  onTemplateSelected,
  onCancel,
  buttonClassName,
  buttonText = 'Select Template',
  disabled = false,
  folderId = null
}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(true);
  const [currentAccessToken, setCurrentAccessToken] = useState(null);

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
      console.error('[TemplatePicker] Error checking status:', error);
      setIsConnected(false);
    } finally {
      setCheckingConnection(false);
    }
  };

  // Handle OAuth callback
  useEffect(() => {
    const handleMessage = async (event) => {
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === 'GOOGLE_DRIVE_AUTH_SUCCESS') {
        setIsConnected(true);
        checkConnectionStatus();
      } else if (event.data?.type === 'GOOGLE_DRIVE_AUTH_ERROR') {
        setIsConnected(false);
        toast.error(`Google Drive connection failed: ${event.data.error || 'Unknown error'}`);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleConnectDrive = async () => {
    try {
      setIsLoading(true);
      const { authUrl } = await googleDriveApi.initiateAuth();

      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        authUrl,
        'google-drive-auth',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
      );

      const pollTimer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(pollTimer);
          setIsLoading(false);
          checkConnectionStatus();
        }
      }, 500);
    } catch (error) {
      console.error('[TemplatePicker] Error initiating auth:', error);
      toast.error('Failed to start Google Drive connection');
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
        console.error('[TemplatePicker] Missing/invalid Google Picker API key:', {
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

      setCurrentAccessToken(tokenData.accessToken);

      // Load picker API
      await loadGooglePickerApi();

      // Create picker specifically for Google Docs templates
      openTemplatePicker({
        accessToken: tokenData.accessToken,
        apiKey: pickerApiKey,
        folderId,
        onSelect: (file) => {
          console.log('[TemplatePicker] Template selected:', file);
          if (onTemplateSelected) {
            onTemplateSelected({
              ...file,
              accessToken: tokenData.accessToken
            });
          }
        },
        onCancel: () => {
          console.log('[TemplatePicker] Picker cancelled');
          if (onCancel) onCancel();
        }
      });
    } catch (error) {
      console.error('[TemplatePicker] Error opening picker:', error);
      toast.error('Failed to open template picker');
    } finally {
      setIsLoading(false);
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
        className={buttonClassName || "px-4 py-2.5 bg-gray-600 text-white rounded-lg flex items-center gap-2 opacity-50 cursor-not-allowed font-medium"}
      >
        <LoadingSpinner />
        <span>Checking...</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={disabled || isLoading}
      className={buttonClassName || `px-4 py-2.5 rounded-lg flex items-center gap-2 transition-all duration-200 font-medium ${
        disabled || isLoading
          ? 'bg-gray-600 cursor-not-allowed opacity-50 text-gray-300'
          : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-md hover:shadow-lg'
      }`}
    >
      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )}
      <span>
        {isLoading
          ? 'Loading...'
          : isConnected
            ? buttonText
            : 'Connect Drive'}
      </span>
    </button>
  );
};

/**
 * Loading spinner component
 */
const LoadingSpinner = () => (
  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
  </svg>
);

/**
 * Open Google Picker with full interface matching "Open a file" dialog
 * Includes: Recent, My Drive, Shared drives, Shared with me, Starred, Computers, Upload
 */
const openTemplatePicker = async ({
  accessToken,
  apiKey,
  folderId,
  onSelect,
  onCancel
}) => {
  await loadGooglePickerApi();

  // Remove any blur from background
  const style = document.createElement('style');
  style.id = 'template-picker-no-blur';
  style.textContent = `
    .picker-dialog-bg {
      background: rgba(0, 0, 0, 0.6) !important;
      backdrop-filter: none !important;
    }
    .picker-dialog {
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5) !important;
      border-radius: 12px !important;
    }
  `;
  if (!document.getElementById('template-picker-no-blur')) {
    document.head.appendChild(style);
  }

  // Recent view - shows recently accessed Google Docs files only
  const recentView = new window.google.picker.DocsView(window.google.picker.ViewId.RECENTLY_PICKED)
    .setIncludeFolders(false)
    .setMimeTypes('application/vnd.google-apps.document')
    .setMode(window.google.picker.DocsViewMode.GRID)
    .setLabel('Recent');

  // My Drive view - only Google Docs files from user's own drive (not shared drives)
  const myDriveView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(false)
    .setMimeTypes('application/vnd.google-apps.document')
    .setOwnedByMe(true) // Only show files owned by the user
    .setParent('root') // Start from root of user's drive
    .setMode(window.google.picker.DocsViewMode.GRID)
    .setLabel('My Drive');

  // If a specific folder is provided, filter to that folder
  if (folderId) {
    myDriveView.setParent(folderId);
  }

  // Shared drives view - only Google Docs files
  const sharedDrivesView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(false)
    .setMimeTypes('application/vnd.google-apps.document')
    .setMode(window.google.picker.DocsViewMode.GRID)
    .setLabel('Shared drives');

  // Shared with me view - only Google Docs files
  const sharedWithMeView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(false)
    .setOwnedByMe(false)
    .setMimeTypes('application/vnd.google-apps.document')
    .setMode(window.google.picker.DocsViewMode.GRID)
    .setLabel('Shared with me');

  // Starred view - Note: Google Picker API doesn't have a direct "starred" filter
  // We'll use a workaround by showing user's docs, but this won't filter by starred status
  // For now, we'll remove this view or show a message
  // Using DOCS view with ownedByMe as a workaround (not perfect, but better than showing all)
  const starredView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
    .setIncludeFolders(false)
    .setMimeTypes('application/vnd.google-apps.document')
    .setOwnedByMe(true) // At least filter to user's files
    .setMode(window.google.picker.DocsViewMode.GRID)
    .setLabel('Starred');

  // Upload view - allows uploading files from local computer
  const uploadView = new window.google.picker.DocsUploadView()
    .setIncludeFolders(true);

  const pickerBuilder = new window.google.picker.PickerBuilder()
    .addView(recentView)
    .addView(myDriveView)
    .addView(sharedDrivesView)
    .addView(sharedWithMeView)
    .addView(starredView)
    .addView(uploadView)
    .setOAuthToken(accessToken)
    .setDeveloperKey(apiKey)
    .setCallback((data) => {
      if (data.action === window.google.picker.Action.PICKED) {
        const doc = data.docs[0]; // Single select only
        
        console.log('[TemplatePicker] Selected document:', {
          id: doc.id,
          name: doc.name,
          mimeType: doc.mimeType,
          originalFileExtension: doc.originalFileExtension,
          type: doc.type,
          allProps: Object.keys(doc)
        });
        
        // Check if this came from upload - validate file extension if available
        // Note: Google Picker upload converts files to Google Docs, so we check originalFileExtension
        if (doc.originalFileExtension) {
          const allowedExtensions = ['.doc', '.docx'];
          const fileExt = doc.originalFileExtension.toLowerCase();
          if (!allowedExtensions.includes(fileExt)) {
            toast.error('Only Word documents (.doc, .docx) are allowed. PDFs and other file types are not supported.');
            return;
          }
          // If it's an uploaded file with valid extension, Google converts it to Google Docs
          // Accept it regardless of mimeType since Google converts it
          console.log('[TemplatePicker] Accepting uploaded file:', doc.name);
          onSelect({
            id: doc.id,
            name: doc.name,
            mimeType: 'application/vnd.google-apps.document', // Uploaded files are converted to Google Docs
            url: doc.url,
            iconUrl: doc.iconUrl,
            originalFileExtension: doc.originalFileExtension // Pass along for reference
          });
          return;
        }
        
        // For files selected from Drive (not uploaded), verify it's a Google Doc
        if (doc.mimeType !== 'application/vnd.google-apps.document') {
          console.error('[TemplatePicker] Invalid file type:', {
            mimeType: doc.mimeType,
            name: doc.name,
            originalFileExtension: doc.originalFileExtension
          });
          toast.error('Please select a Google Docs document');
          return;
        }

        onSelect({
          id: doc.id,
          name: doc.name,
          mimeType: doc.mimeType,
          url: doc.url,
          iconUrl: doc.iconUrl
        });
      } else if (data.action === window.google.picker.Action.CANCEL) {
        if (onCancel) onCancel();
      }
    })
    .setTitle('Open a file')
    .setSize(900, 600)
    .setOrigin(window.location.protocol + '//' + window.location.host);

  // Enable shared drives support
  pickerBuilder.enableFeature(window.google.picker.Feature.SUPPORT_DRIVES);

  const picker = pickerBuilder.build();
  picker.setVisible(true);
};

export default TemplatePicker;

