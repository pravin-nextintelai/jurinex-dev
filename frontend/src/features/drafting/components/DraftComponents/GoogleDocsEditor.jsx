import React, { useState, useEffect } from 'react';
import {
  Plus,
  FileText,
  Edit,
  Trash2,
  RefreshCw,
  ArrowLeft,
  Loader
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import axios from 'axios';
import { DRAFTING_SERVICE_URL } from '@/config/apiConfig';

const GoogleDocsEditor = () => {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [authUrl, setAuthUrl] = useState('');

  useEffect(() => {
    checkGoogleConnection();
  }, []);

  const checkGoogleConnection = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(
        `${DRAFTING_SERVICE_URL}/api/auth/status`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      
      if (response.data.connected) {
        setIsConnected(true);
        loadDocuments();
      } else {
        setAuthUrl(response.data.authUrl);
      }
    } catch (error) {
      console.error('Error checking Google connection:', error);
      toast.error('Failed to check Google Drive connection');
    }
  };

  const handleGoogleSignIn = () => {
    if (authUrl) {
      window.location.href = authUrl;
    } else {
      toast.error('Auth URL not available');
    }
  };

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(
        `${DRAFTING_SERVICE_URL}/api/drafts/list`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      
      setDocuments(response.data.drafts || []);
    } catch (error) {
      console.error('Error loading documents:', error);
      toast.error('Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDocument = async () => {
    if (!newDocTitle.trim()) {
      toast.error('Please enter a document title');
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${DRAFTING_SERVICE_URL}/api/drafts/initiate`,
        {
          title: newDocTitle,
          templateId: 'blank'
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      toast.success('Document created successfully!');
      setCreateDialogOpen(false);
      setNewDocTitle('');
      loadDocuments();
      
      // Open document in new tab
      if (response.data.googleDocsUrl) {
        window.open(response.data.googleDocsUrl, '_blank');
      }
    } catch (error) {
      console.error('Error creating document:', error);
      toast.error(error.response?.data?.error || 'Failed to create document');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDocument = (docUrl) => {
    window.open(docUrl, '_blank');
  };

  const handleDeleteDocument = async (draftId) => {
    if (!window.confirm('Are you sure you want to delete this document?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      await axios.delete(
        `${DRAFTING_SERVICE_URL}/api/drafts/${draftId}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      toast.success('Document deleted successfully');
      loadDocuments();
    } catch (error) {
      console.error('Error deleting document:', error);
      toast.error('Failed to delete document');
    }
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="w-20 h-20 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <FileText className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Connect to Google Drive
          </h2>
          <p className="text-gray-600 mb-6">
            To use Google Docs for drafting, you need to connect your Google account.
          </p>
          <button
            onClick={handleGoogleSignIn}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <FileText className="w-5 h-5" />
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center mb-6">
          <button
            onClick={() => navigate('/draft-selection')}
            className="mr-4 p-2 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-3xl font-bold text-gray-900 flex-grow">
            Google Docs Drafts
          </h1>
          <button
            onClick={() => setCreateDialogOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors flex items-center gap-2 mr-2"
          >
            <Plus className="w-5 h-5" />
            New Document
          </button>
          <button
            onClick={loadDocuments}
            disabled={loading}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Connection Status */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 flex items-center gap-2">
          <FileText className="w-5 h-5 text-green-600" />
          <span className="text-green-800 font-medium">Connected to Google Drive</span>
        </div>

        {/* Documents Grid */}
        {loading ? (
          <div className="flex justify-center items-center py-16">
            <Loader className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : documents.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-12 text-center">
            <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-700 mb-2">
              No documents yet
            </h3>
            <p className="text-gray-500">
              Create your first document to get started
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {documents.map((doc) => (
              <div
                key={doc.draftId}
                className="bg-white rounded-xl shadow hover:shadow-xl transition-shadow p-6 flex flex-col"
              >
                <div className="flex items-center mb-4">
                  <FileText className="w-6 h-6 text-blue-600 mr-2" />
                  <h3 className="text-lg font-semibold text-gray-900 truncate flex-grow">
                    {doc.title}
                  </h3>
                </div>
                
                <div className="border-t border-gray-200 my-4"></div>
                
                <div className="mb-4 space-y-1">
                  <p className="text-xs text-gray-500">
                    Created: {new Date(doc.createdAt).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-gray-500">
                    Modified: {new Date(doc.updatedAt).toLocaleDateString()}
                  </p>
                </div>

                <span className="inline-block bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-1 rounded mb-4">
                  {doc.status || 'Draft'}
                </span>

                <div className="flex gap-2 mt-auto">
                  <button
                    onClick={() => handleOpenDocument(doc.googleDocsUrl)}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                    title="Open in Google Docs"
                  >
                    <Edit className="w-4 h-4" />
                    Open
                  </button>
                  <button
                    onClick={() => handleDeleteDocument(doc.draftId)}
                    className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create Document Dialog */}
        {createDialogOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Create New Document
              </h2>
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Document Title
                </label>
                <input
                  type="text"
                  value={newDocTitle}
                  onChange={(e) => setNewDocTitle(e.target.value)}
                  placeholder="Enter document title..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setCreateDialogOpen(false);
                    setNewDocTitle('');
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateDocument}
                  disabled={loading || !newDocTitle.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {loading && <Loader className="w-4 h-4 animate-spin" />}
                  Create
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GoogleDocsEditor;
