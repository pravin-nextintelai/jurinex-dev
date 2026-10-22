import React, { useState, useEffect } from 'react';
import {
  Plus,
  FileEdit,
  Edit,
  Trash2,
  Download,
  RefreshCw,
  ArrowLeft,
  Loader
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import axios from 'axios';
import { DRAFTING_SERVICE_URL } from '@/config/apiConfig';

const MicrosoftWordEditor = () => {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocTemplate, setNewDocTemplate] = useState('blank');
  const [isConnected, setIsConnected] = useState(false);
  const [authUrl, setAuthUrl] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    checkMicrosoftConnection();
  }, []);

  const checkMicrosoftConnection = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(
        `${DRAFTING_SERVICE_URL}/api/microsoft/auth/status`,
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
      console.error('Error checking Microsoft connection:', error);
      // If endpoint doesn't exist yet, show connection UI
      setIsConnected(false);
    }
  };

  const handleMicrosoftSignIn = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(
        `${DRAFTING_SERVICE_URL}/api/microsoft/auth/signin`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      
      if (response.data.authUrl) {
        window.location.href = response.data.authUrl;
      }
    } catch (error) {
      console.error('Error getting Microsoft auth URL:', error);
      toast.error('Failed to connect to Microsoft Office');
    }
  };

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(
        `${DRAFTING_SERVICE_URL}/api/microsoft/documents/list`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      
      setDocuments(response.data.documents || []);
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
        `${DRAFTING_SERVICE_URL}/api/microsoft/documents/create`,
        {
          title: newDocTitle,
          templateId: newDocTemplate
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      toast.success('Document created successfully!');
      setCreateDialogOpen(false);
      setNewDocTitle('');
      setNewDocTemplate('blank');
      loadDocuments();
      
      // Open document if URL is provided
      if (response.data.webUrl) {
        window.open(response.data.webUrl, '_blank');
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

  const handleDeleteDocument = async (docId) => {
    if (!window.confirm('Are you sure you want to delete this document?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      await axios.delete(
        `${DRAFTING_SERVICE_URL}/api/microsoft/documents/${docId}`,
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

  const handleDownloadDocument = async (docId, title) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(
        `${DRAFTING_SERVICE_URL}/api/microsoft/documents/${docId}/download`,
        {
          headers: { Authorization: `Bearer ${token}` },
          responseType: 'blob',
          onDownloadProgress: (progressEvent) => {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(percentCompleted);
          }
        }
      );

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${title}.docx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      setUploadProgress(0);
      toast.success('Document downloaded successfully');
    } catch (error) {
      console.error('Error downloading document:', error);
      toast.error('Failed to download document');
      setUploadProgress(0);
    }
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="w-20 h-20 bg-blue-700 rounded-full flex items-center justify-center mx-auto mb-6">
            <FileEdit className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Connect to Microsoft Office
          </h2>
          <p className="text-gray-600 mb-6">
            To use Microsoft Word for drafting, you need to connect your Microsoft account.
          </p>
          <button
            onClick={handleMicrosoftSignIn}
            className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <FileEdit className="w-5 h-5" />
            Sign in with Microsoft
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
            Microsoft Word Drafts
          </h1>
          <button
            onClick={() => setCreateDialogOpen(true)}
            className="bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2 px-4 rounded-lg transition-colors flex items-center gap-2 mr-2"
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
          <FileEdit className="w-5 h-5 text-green-600" />
          <span className="text-green-800 font-medium">Connected to Microsoft Office</span>
        </div>

        {/* Upload Progress */}
        {uploadProgress > 0 && (
          <div className="mb-6">
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
            <p className="text-sm text-gray-600 text-center mt-2">{uploadProgress}%</p>
          </div>
        )}

        {/* Documents Grid */}
        {loading ? (
          <div className="flex justify-center items-center py-16">
            <Loader className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : documents.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-12 text-center">
            <FileEdit className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-700 mb-2">
              No documents yet
            </h3>
            <p className="text-gray-500">
              Create your first Word document to get started
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="bg-white rounded-xl shadow hover:shadow-xl transition-shadow p-6 flex flex-col"
              >
                <div className="flex items-center mb-4">
                  <FileEdit className="w-6 h-6 text-blue-700 mr-2" />
                  <h3 className="text-lg font-semibold text-gray-900 truncate flex-grow">
                    {doc.title}
                  </h3>
                </div>
                
                <div className="border-t border-gray-200 my-4"></div>
                
                <div className="mb-4 space-y-1">
                  <p className="text-xs text-gray-500">
                    Created: {new Date(doc.createdAt || doc.createdDateTime).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-gray-500">
                    Modified: {new Date(doc.modifiedAt || doc.lastModifiedDateTime).toLocaleDateString()}
                  </p>
                </div>

                <span className="inline-block bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-1 rounded mb-4">
                  {doc.status || 'Draft'}
                </span>

                <div className="flex gap-2 mt-auto">
                  <button
                    onClick={() => handleOpenDocument(doc.webUrl)}
                    className="flex-1 bg-blue-700 hover:bg-blue-800 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                    title="Open in Word Online"
                  >
                    <Edit className="w-4 h-4" />
                    Open
                  </button>
                  <button
                    onClick={() => handleDownloadDocument(doc.id, doc.title)}
                    className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteDocument(doc.id)}
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
                Create New Word Document
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
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
                  autoFocus
                />
                
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Template (optional)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setNewDocTemplate('blank')}
                    className={`p-4 border-2 rounded-lg transition-colors ${
                      newDocTemplate === 'blank'
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    <p className="text-sm font-medium">Blank Document</p>
                  </button>
                  <button
                    onClick={() => setNewDocTemplate('legal')}
                    className={`p-4 border-2 rounded-lg transition-colors ${
                      newDocTemplate === 'legal'
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    <p className="text-sm font-medium">Legal Template</p>
                  </button>
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setCreateDialogOpen(false);
                    setNewDocTitle('');
                    setNewDocTemplate('blank');
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateDocument}
                  disabled={loading || !newDocTitle.trim()}
                  className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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

export default MicrosoftWordEditor;
