import React, { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import draftingApi from '../api/draftingApi';
import { toast } from 'react-toastify';

/**
 * ShareModal Component
 * Allows users to share Google Docs documents with others
 */
const ShareModal = ({ isOpen, onClose, draftId, googleFileId, documentTitle, accessToken }) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('writer');
  const [permissions, setPermissions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingPermissions, setIsLoadingPermissions] = useState(false);
  const [generalAccess, setGeneralAccess] = useState('restricted');
  const [linkSharingEnabled, setLinkSharingEnabled] = useState(false);

  // Load permissions when modal opens
  useEffect(() => {
    if (isOpen && draftId && accessToken) {
      loadPermissions();
    }
  }, [isOpen, draftId, accessToken]);

  const loadPermissions = useCallback(async () => {
    if (!draftId || !accessToken) return;

    try {
      setIsLoadingPermissions(true);
      const response = await draftingApi.getDraftPermissions(draftId, accessToken);
      if (response.success) {
        setPermissions(response.permissions || []);

        // Check if "anyone" permission exists (public link)
        const anyonePermission = response.permissions?.find(p => p.type === 'anyone');
        if (anyonePermission) {
          setGeneralAccess(anyonePermission.role);
          setLinkSharingEnabled(true);
        } else {
          setGeneralAccess('restricted');
          setLinkSharingEnabled(false);
        }
      }
    } catch (error) {
      console.error('[ShareModal] Error loading permissions:', error);
      if (error.response?.data?.needsAuth) {
        toast.error('Google access token expired. Please reconnect your Google account.');
      }
    } finally {
      setIsLoadingPermissions(false);
    }
  }, [draftId, accessToken]);

  const handleShare = async (e) => {
    e.preventDefault();

    if (!email || !email.includes('@')) {
      toast.error('Please enter a valid email address');
      return;
    }

    if (!accessToken) {
      toast.error('Google access token is required');
      return;
    }

    try {
      setIsLoading(true);
      const response = await draftingApi.shareDraft(draftId, accessToken, email, role);

      if (response.success) {
        toast.success(`Document shared with ${email} as ${role}`);
        setEmail('');
        setRole('writer');
        await loadPermissions();
      }
    } catch (error) {
      console.error('[ShareModal] Error sharing:', error);
      if (error.response?.data?.needsAuth) {
        toast.error('Google access token expired. Please reconnect your Google account.');
      } else {
        toast.error(error.response?.data?.error || 'Failed to share document');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleMakePublic = async (selectedRole) => {
    if (!accessToken) {
      toast.error('Google access token is required');
      return;
    }

    try {
      setIsLoading(true);
      const response = await draftingApi.makeDraftPublic(draftId, accessToken, selectedRole);

      if (response.success) {
        toast.success('Document is now accessible to anyone with the link');
        setGeneralAccess(selectedRole);
        setLinkSharingEnabled(true);
        await loadPermissions();
      }
    } catch (error) {
      console.error('[ShareModal] Error making public:', error);
      if (error.response?.data?.needsAuth) {
        toast.error('Google access token expired. Please reconnect your Google account.');
      } else {
        toast.error(error.response?.data?.error || 'Failed to make document public');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemovePermission = async (permissionId) => {
    if (!accessToken) {
      toast.error('Google access token is required');
      return;
    }

    if (!window.confirm('Are you sure you want to remove this person\'s access?')) {
      return;
    }

    try {
      setIsLoading(true);
      const response = await draftingApi.removePermission(draftId, permissionId, accessToken);

      if (response.success) {
        toast.success('Access removed successfully');
        await loadPermissions();
      }
    } catch (error) {
      console.error('[ShareModal] Error removing permission:', error);
      if (error.response?.data?.needsAuth) {
        toast.error('Google access token expired. Please reconnect your Google account.');
      } else {
        toast.error(error.response?.data?.error || 'Failed to remove access');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (googleFileId) {
      const link = `https://docs.google.com/document/d/${googleFileId}/edit`;
      navigator.clipboard.writeText(link).then(() => {
        toast.success('Link copied to clipboard');
      }).catch(() => {
        toast.error('Failed to copy link');
      });
    }
  };

  if (!isOpen) return null;

  const roleLabels = {
    reader: 'Viewer',
    commenter: 'Commenter',
    writer: 'Editor',
    owner: 'Owner'
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg mx-4 border border-gray-200" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            Share "{documentTitle || 'Document'}"
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 max-h-[600px] overflow-y-auto">
          {/* Add people section */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Add people, groups, spaces, and calendar events
            </label>
            <form onSubmit={handleShare} className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email address"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isLoading}
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isLoading}
              >
                <option value="reader">Viewer</option>
                <option value="commenter">Commenter</option>
                <option value="writer">Editor</option>
              </select>
              <button
                type="submit"
                disabled={isLoading || !email}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? 'Sharing...' : 'Share'}
              </button>
            </form>
          </div>

          {/* People with access */}
          {isLoadingPermissions ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-600"></div>
            </div>
          ) : permissions.length > 0 ? (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-3">People with access</h3>
              <div className="space-y-2">
                {permissions.map((permission) => (
                  <div
                    key={permission.id}
                    className="flex items-center justify-between py-2 px-3 hover:bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                        {permission.emailAddress
                          ? permission.emailAddress.charAt(0).toUpperCase()
                          : permission.type === 'anyone'
                            ? 'A'
                            : 'U'}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {permission.displayName || permission.emailAddress || 'Anyone with the link'}
                        </p>
                        {permission.emailAddress && (
                          <p className="text-xs text-gray-500">{permission.emailAddress}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-600">
                        {roleLabels[permission.role] || permission.role}
                      </span>
                      {permission.type !== 'anyone' && permission.role !== 'owner' && (
                        <button
                          onClick={() => handleRemovePermission(permission.id)}
                          disabled={isLoading}
                          className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* General access */}
          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">General access</h3>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {linkSharingEnabled ? (
                  <span className="text-sm text-gray-600">
                    Anyone with the link can {generalAccess === 'reader' ? 'view' : generalAccess === 'commenter' ? 'comment' : 'edit'}
                  </span>
                ) : (
                  <span className="text-sm text-gray-600 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                    Restricted
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  if (linkSharingEnabled) {
                    // TODO: Implement disable link sharing
                    toast.info('Disabling link sharing is not yet implemented');
                  } else {
                    handleMakePublic('reader');
                  }
                }}
                disabled={isLoading}
                className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
              >
                {linkSharingEnabled ? 'Change' : 'Change'}
              </button>
            </div>
          </div>

          {/* Copy link button */}
          <div className="mt-4 pt-4 border-t border-gray-200">
            <button
              onClick={handleCopyLink}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy link
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShareModal;

