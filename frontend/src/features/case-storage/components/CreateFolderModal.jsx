import React, { useState } from 'react';

const CreateFolderModal = ({ isOpen, onClose, onCreate }) => {
  const [folderName, setFolderName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!folderName.trim()) {
      setError('Folder name cannot be empty.');
      return;
    }
    setError('');
    onCreate(folderName.trim());
    setFolderName('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md border border-gray-200">
        <h3 className="text-xl font-semibold text-gray-900 mb-4">
          Create New Folder
        </h3>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label
              htmlFor="folderName"
              className="block text-gray-700 text-sm font-medium mb-2"
            >
              Folder Name
            </label>
            <input
              id="folderName"
              className="w-full px-4 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2"
              style={{
                transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = '#A8E8E4';
                e.currentTarget.style.boxShadow = '0 0 0 3px #A8E8E460';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '#D1D5DB';
                e.currentTarget.style.boxShadow = 'none';
              }}
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="e.g., My Legal Documents"
              required
            />
            {error && (
              <p className="text-red-500 text-sm mt-2">{error}</p>
            )}
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-md transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              className="px-4 py-2 text-white rounded-md transition-all"
              style={{
                backgroundColor: '#21C1B6',
                transition: 'background-color 0.3s ease',
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = '#1AA49B')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = '#21C1B6')
              }
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateFolderModal;
