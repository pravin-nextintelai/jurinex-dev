import React, { useState } from 'react';
import { createFirmUser } from '../api/rbacApi';
import { toast } from 'react-toastify';

const AddUserModal = ({ isOpen, onClose, onUserCreated }) => {
  const [formData, setFormData] = useState({ fullName: '', email: '' });
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const fullName = formData.fullName.trim();
  const initials = fullName
    ? fullName
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('')
    : 'NU';

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.fullName || !formData.email) {
      toast.error('Please fill all fields');
      return;
    }

    setLoading(true);
    try {
      // Create user with default empty permissions. Permissions can be assigned later.
      const response = await createFirmUser({ ...formData, permissions: {} });
      if (response.emailSent === false) {
        toast.warning(response.message || 'User created, but the create-password email could not be sent.');
      } else {
        toast.success(response.message || 'User created successfully. A create-password email has been sent.');
      }
      onUserCreated();
      setFormData({ fullName: '', email: '' });
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 py-8 backdrop-blur-sm">
      <div className="relative w-full max-w-xl overflow-hidden rounded-[28px] border border-white/70 bg-white/95 shadow-[0_30px_90px_rgba(15,23,42,0.18)] ring-1 ring-slate-200/80">
        <div className="absolute inset-x-0 top-0 h-28 bg-[linear-gradient(135deg,rgba(33,193,182,0.16),rgba(255,255,255,0.94),rgba(239,68,68,0.08))]" />

        <div className="relative flex items-start justify-between border-b border-slate-200/80 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#1AA49B]">
              Firm Access
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">Add New User</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
              Create a firm user profile and send a secure password setup invite without leaving this page.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white/90 p-2 text-slate-400 transition hover:border-slate-300 hover:text-slate-700"
            aria-label="Close add user modal"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="relative px-6 py-6">
          <div className="mb-6 flex items-start gap-4 rounded-2xl border border-[#D6F5F2] bg-[#F3FCFB] px-4 py-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#21C1B6] text-sm font-semibold text-white shadow-[0_16px_30px_rgba(33,193,182,0.24)]">
              {initials}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900">Invite flow</h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                The user will receive a create-password email and can activate their account from there.
              </p>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Full Name</label>
              <input
                type="text"
                name="fullName"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none transition focus:border-[#21C1B6] focus:ring-4 focus:ring-[#21C1B6]/15"
                placeholder="e.g. John Doe"
                value={formData.fullName}
                onChange={handleChange}
              />
              <p className="mt-2 text-xs text-slate-500">This name will appear across your firm workspace.</p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Email Address</label>
              <input
                type="email"
                name="email"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none transition focus:border-[#21C1B6] focus:ring-4 focus:ring-[#21C1B6]/15"
                placeholder="e.g. john@example.com"
                value={formData.email}
                onChange={handleChange}
              />
              <p className="mt-2 text-xs text-slate-500">We will send the password setup link to this address.</p>
            </div>
          </div>

          <div className="mt-8 flex justify-end gap-3 border-t border-slate-200/80 pt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-[#E11D48] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(225,29,72,0.24)] transition hover:bg-[#BE123C] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddUserModal;
