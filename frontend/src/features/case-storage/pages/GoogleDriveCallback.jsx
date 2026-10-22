import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import googleDriveApi from '@/shared/api/googleDriveApi';

const GoogleDriveCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('processing');
  const [error, setError] = useState(null);
  const isProcessingRef = useRef(false); // Guard to prevent duplicate processing

  useEffect(() => {
    
    const handleCallback = async () => {
      // Prevent duplicate processing
      if (isProcessingRef.current) {
        console.log('[GoogleDriveCallback] Already processing, skipping duplicate call');
        return;
      }
      
      const success = searchParams.get('success');
      const errorParam = searchParams.get('error');
      const code = searchParams.get('code');
      const state = searchParams.get('state');

      // Check for success parameter first (backend already processed the OAuth)
      // IMPORTANT: If success=true, backend already handled it - DO NOT POST again
      if (success === 'true') {
        isProcessingRef.current = true;
        setStatus('success');
        toast.success('Google Drive connected successfully!');

        const returnTo = searchParams.get('returnTo');

        // If opened as popup, send success message to parent window
        if (window.opener) {
          window.opener.postMessage({
            type: 'GOOGLE_DRIVE_AUTH_SUCCESS'
          }, window.location.origin);
          
          // Close popup after short delay
          setTimeout(() => window.close(), 1500);
        } else {
          // If not a popup, redirect to returnTo (e.g. assembled preview) or dashboard
          const targetPath = returnTo && returnTo.startsWith('/') ? returnTo : '/dashboard';
          setTimeout(() => {
            navigate(targetPath, { replace: true });
          }, 1500);
        }
        return;
      }

      // Check for error parameter
      if (errorParam) {
        isProcessingRef.current = true;
        setStatus('error');
        setError(`Authorization failed: ${errorParam}`);
        
        // If opened as popup, send message to parent
        if (window.opener) {
          window.opener.postMessage({
            type: 'GOOGLE_DRIVE_AUTH_ERROR',
            error: errorParam
          }, window.location.origin);
          setTimeout(() => window.close(), 2000);
        }
        return;
      }

      // Legacy flow: if code and state are present AND no success/error, use POST API to complete OAuth
      // This is ONLY for cases where Google redirects directly to frontend (shouldn't happen in normal flow)
      // NOTE: This should rarely execute since backend handles the callback first
      if (code && state && !success && !errorParam) {
        isProcessingRef.current = true;
        try {
          console.log('[GoogleDriveCallback] Processing legacy callback with code/state');
          // Complete the OAuth flow via POST API
          const result = await googleDriveApi.handleCallback(code, state);
          
          setStatus('success');
          toast.success('Google Drive connected successfully!');

          // If opened as popup, send success message to parent window
          if (window.opener) {
            window.opener.postMessage({
              type: 'GOOGLE_DRIVE_AUTH_SUCCESS',
              code,
              state
            }, window.location.origin);
            
            // Close popup after short delay
            setTimeout(() => window.close(), 1500);
          } else {
            const returnTo = searchParams.get('returnTo');
            const targetPath = returnTo && returnTo.startsWith('/') ? returnTo : '/dashboard';
            setTimeout(() => {
              navigate(targetPath, { replace: true });
            }, 1500);
          }
        } catch (err) {
          console.error('[GoogleDriveCallback] Error:', err);
          setStatus('error');
          setError(err.response?.data?.error || err.message || 'Failed to connect Google Drive');
          
          if (window.opener) {
            window.opener.postMessage({
              type: 'GOOGLE_DRIVE_AUTH_ERROR',
              error: err.message
            }, window.location.origin);
          }
        }
        return;
      }

      // No success, no error, no code - invalid request
      if (!isProcessingRef.current) {
        isProcessingRef.current = true;
        setStatus('error');
        setError('Invalid callback request. Please try connecting again.');
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="bg-gray-800 p-8 rounded-lg shadow-xl max-w-md w-full mx-4 text-center">
        {status === 'processing' && (
          <>
            <div className="mb-4">
              <svg className="animate-spin h-12 w-12 mx-auto text-blue-500" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Connecting Google Drive</h2>
            <p className="text-gray-400">Please wait while we complete the authorization...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="mb-4">
              <svg className="h-12 w-12 mx-auto text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Google Drive Connected!</h2>
            <p className="text-gray-400">
              {window.opener 
                ? 'This window will close automatically...' 
                : 'Redirecting...'}
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mb-4">
              <svg className="h-12 w-12 mx-auto text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Connection Failed</h2>
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={() => window.opener ? window.close() : navigate('/dashboard')}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
            >
              {window.opener ? 'Close' : 'Go to Dashboard'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default GoogleDriveCallback;



