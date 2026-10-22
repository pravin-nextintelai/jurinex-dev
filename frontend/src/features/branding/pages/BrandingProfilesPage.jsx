import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit2, Trash2, Star, Palette, CheckCircle } from 'lucide-react';
import { getProfiles, deleteProfile, saveProfile, refreshProfiles } from '../utils/brandingStorage';

export default function BrandingProfilesPage() {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState([]);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => {
    setProfiles(getProfiles()); // instant render from cache
    refreshProfiles().then(setProfiles); // then server truth (survives logout)
  }, []);

  const handleSetDefault = (profile) => {
    saveProfile({ ...profile, isDefault: true });
    setProfiles(getProfiles());
  };

  const handleDelete = (id) => {
    deleteProfile(id);
    setProfiles(getProfiles());
    setDeleteConfirm(null);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-50 rounded-lg">
              <Palette className="w-6 h-6 text-teal-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Custom Branding</h1>
              <p className="text-sm text-gray-500 mt-0.5">Manage letterhead profiles for your document exports</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/branding/new')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            New Profile
          </button>
        </div>

        {profiles.length === 0 ? (
          /* Empty state */
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
              <div className="w-16 h-16 rounded-full bg-teal-50 flex items-center justify-center mb-4">
                <Palette className="w-8 h-8 text-teal-500" />
              </div>
              <h2 className="text-lg font-semibold text-gray-800 mb-2">No Branding Profiles Yet</h2>
              <p className="text-sm text-gray-500 max-w-sm mb-6">
                Create a custom branding profile with your firm's letterhead, logo, and typography. It will be applied to your document exports.
              </p>
              <button
                onClick={() => navigate('/branding/new')}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Create First Profile
              </button>
            </div>
          </div>
        ) : (
          /* Profiles table */
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-5 py-3.5 font-semibold text-gray-600">Profile Name</th>
                  <th className="text-left px-5 py-3.5 font-semibold text-gray-600">Firm / Advocate</th>
                  <th className="text-left px-5 py-3.5 font-semibold text-gray-600">Font</th>
                  <th className="text-left px-5 py-3.5 font-semibold text-gray-600">Created</th>
                  <th className="text-left px-5 py-3.5 font-semibold text-gray-600">Status</th>
                  <th className="text-right px-5 py-3.5 font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {profiles.map(profile => (
                  <tr key={profile.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        {profile.logo ? (
                          <img src={profile.logo} alt="" className="w-8 h-8 object-contain rounded border border-gray-200" />
                        ) : (
                          <div className="w-8 h-8 rounded border border-gray-200 bg-teal-50 flex items-center justify-center">
                            <Palette className="w-4 h-4 text-teal-400" />
                          </div>
                        )}
                        <span className="font-medium text-gray-900">{profile.name || '(Unnamed)'}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-gray-600">{profile.firmName || '—'}</td>
                    <td className="px-5 py-4 text-gray-600">{profile.fontFamily || 'Georgia'}, {profile.fontSize || 12}pt</td>
                    <td className="px-5 py-4 text-gray-500">
                      {profile.createdAt ? new Date(profile.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-5 py-4">
                      {profile.isDefault ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-50 text-teal-700 rounded-full text-xs font-medium">
                          <CheckCircle className="w-3 h-3" /> Default
                        </span>
                      ) : (
                        <button
                          onClick={() => handleSetDefault(profile)}
                          className="text-xs text-gray-400 hover:text-teal-600 transition-colors cursor-pointer"
                        >
                          Set as default
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => navigate(`/branding/${profile.id}`)}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-800 transition-colors cursor-pointer"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(profile.id)}
                          className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600 transition-colors cursor-pointer"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Profile?</h3>
            <p className="text-sm text-gray-500 mb-6">This branding profile will be permanently deleted and cannot be recovered.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 cursor-pointer">
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
