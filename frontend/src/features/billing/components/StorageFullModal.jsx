/**
 * StorageFullModal
 *
 * A global modal that appears whenever any upload endpoint returns HTTP 507
 * (storage quota exceeded). Mount it once at the app root.
 *
 * Listens for the custom DOM event `jurinex:storage-full` emitted by
 * storageGuard.js → emitStorageFull().
 *
 * Usage (App.jsx or root layout):
 *   import StorageFullModal from './components/StorageFullModal';
 *   ...
 *   <StorageFullModal />
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardDrive, AlertTriangle, X, ArrowUpRight, Trash2 } from 'lucide-react';
import { SUBSCRIPTION_PLANS_PATH } from '@/shared/utils/planUpgrade';

export default function StorageFullModal() {
  const navigate  = useNavigate();
  const [open, setOpen]       = useState(false);
  const [message, setMessage] = useState('');

  const handleEvent = useCallback((e) => {
    setMessage(e.detail?.message || 'Your storage is full.');
    setOpen(true);
  }, []);

  useEffect(() => {
    window.addEventListener('jurinex:storage-full', handleEvent);
    return () => window.removeEventListener('jurinex:storage-full', handleEvent);
  }, [handleEvent]);

  if (!open) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => setOpen(false)}
    >
      {/* Modal card */}
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-0 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Red header strip */}
        <div className="bg-gradient-to-r from-red-500 to-rose-500 px-6 pt-6 pb-8">
          <div className="flex items-start justify-between">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <HardDrive size={24} className="text-white" />
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
            >
              <X size={14} className="text-white" />
            </button>
          </div>
          <h2 className="text-xl font-black text-white mt-4 leading-tight">
            Storage Full
          </h2>
          <p className="text-red-100 text-sm mt-1">
            You've used all available storage on your plan.
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Warning box */}
          <div className="flex gap-3 bg-red-50 border border-red-100 rounded-xl p-3.5">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 leading-relaxed">
              {message}
            </p>
          </div>

          {/* What to do */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              What can you do?
            </p>
            <div className="space-y-2">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <Trash2 size={15} className="text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-slate-700">Delete old files</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Go to your Documents or Drafts and remove files you no longer need.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-xl bg-teal-50 border border-teal-100">
                <ArrowUpRight size={15} className="text-teal-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-teal-700">Upgrade your plan</p>
                  <p className="text-xs text-teal-500 mt-0.5">
                    Get more storage space by upgrading to a higher plan.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer buttons */}
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={() => setOpen(false)}
            className="flex-1 h-10 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => { setOpen(false); navigate(SUBSCRIPTION_PLANS_PATH); }}
            className="flex-1 h-10 rounded-xl bg-teal-600 text-sm font-bold text-white hover:bg-teal-700 transition-colors flex items-center justify-center gap-1.5"
          >
            Upgrade Plan <ArrowUpRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
