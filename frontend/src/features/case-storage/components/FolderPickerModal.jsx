import React, { useState } from 'react';
import { FolderOpen, Search } from 'lucide-react';

/**
 * Lets the user pick an existing folder or create a new one before uploading,
 * for entry points (like a top-level "Upload" button) that aren't already
 * scoped to a folder.
 */
const FolderPickerModal = ({ isOpen, onClose, folders, onChooseExisting, onCreateNew }) => {
  const [mode, setMode] = useState('existing');
  const [search, setSearch] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const filteredFolders = folders.filter((f) =>
    (f.case_title || f.name || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleClose = () => {
    setMode('existing');
    setSearch('');
    setNewFolderName('');
    setError('');
    onClose();
  };

  const handleCreateSubmit = (e) => {
    e.preventDefault();
    if (!newFolderName.trim()) {
      setError('Folder name cannot be empty.');
      return;
    }
    onCreateNew(newFolderName.trim());
    handleClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-gray-100 overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">Choose a folder</h3>
          <p className="text-xs text-gray-400 mt-0.5">Pick an existing folder or create a new one to upload into.</p>
        </div>

        <div className="flex border-b border-gray-100">
          <button
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${mode === 'existing' ? 'text-[#21C1B6] border-b-2' : 'text-gray-400'}`}
            style={mode === 'existing' ? { borderColor: '#21C1B6' } : {}}
            onClick={() => setMode('existing')}
          >
            Existing folder
          </button>
          <button
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${mode === 'new' ? 'text-[#21C1B6] border-b-2' : 'text-gray-400'}`}
            style={mode === 'new' ? { borderColor: '#21C1B6' } : {}}
            onClick={() => setMode('new')}
          >
            New folder
          </button>
        </div>

        {mode === 'existing' ? (
          <div className="p-5">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search folders..."
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:outline-none"
              />
            </div>
            <div className="max-h-64 overflow-y-auto -mx-1">
              {filteredFolders.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No folders found.</p>
              ) : (
                filteredFolders.map((f) => (
                  <button
                    key={f.id || f.name}
                    onClick={() => { onChooseExisting(f.name); handleClose(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-gray-50 text-left transition-colors"
                  >
                    <FolderOpen className="w-4 h-4 flex-shrink-0" style={{ color: '#21C1B6' }} />
                    <span className="text-sm text-gray-700 truncate">{f.case_title || f.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreateSubmit} className="p-5">
            <label className="block text-gray-700 text-sm font-medium mb-2">Folder name</label>
            <input
              autoFocus
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g., My Legal Documents"
              className="w-full px-4 py-2 bg-white border border-gray-300 rounded-xl text-sm focus:outline-none"
            />
            {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
            <div className="flex justify-end gap-3 mt-4">
              <button type="button" onClick={handleClose} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-white rounded-xl text-sm font-semibold transition-colors"
                style={{ backgroundColor: '#21C1B6' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
              >
                Create &amp; continue
              </button>
            </div>
          </form>
        )}

        {mode === 'existing' && (
          <div className="flex justify-end px-5 pb-5">
            <button onClick={handleClose} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium transition-colors">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FolderPickerModal;
