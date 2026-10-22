/**
 * storageGuard.js
 *
 * Utilities for detecting and surfacing storage-full errors (HTTP 507)
 * from any backend upload endpoint across all services.
 *
 * Usage:
 *   import { isStorageFullError, storageFullMessage, emitStorageFull } from './storageGuard';
 *
 *   try {
 *     await api.uploadFile(...);
 *   } catch (err) {
 *     if (isStorageFullError(err)) {
 *       emitStorageFull(err);     // shows global modal
 *       return;
 *     }
 *     // handle other errors
 *   }
 */

/** Returns true when the error is a storage-limit-exceeded response from any service. */
export function isStorageFullError(err) {
  if (!err) return false;
  // HTTP 507 Insufficient Storage
  if (err?.response?.status === 507) return true;
  // Code set by Python FastAPI (detail.code) or Node (error.code)
  if (err?.code === 'STORAGE_LIMIT_EXCEEDED') return true;
  // Check nested detail object (FastAPI wraps in detail)
  if (err?.response?.data?.code === 'STORAGE_LIMIT_EXCEEDED') return true;
  if (err?.response?.data?.detail?.code === 'STORAGE_LIMIT_EXCEEDED') return true;
  // Fallback: message contains keyword
  const msg = (err?.message || err?.response?.data?.message || '').toLowerCase();
  return msg.includes('storage_limit_exceeded') || msg.includes('storage is full');
}

/** Returns a human-friendly message for a storage-full error. */
export function storageFullMessage(err) {
  return (
    err?.response?.data?.message ||
    err?.response?.data?.detail?.message ||
    err?.message ||
    'Your storage is full. Please delete some files or upgrade your plan to continue uploading.'
  );
}

/** Dispatch a global DOM event so any listener (StorageFullModal) can show the alert. */
export function emitStorageFull(err) {
  const msg = storageFullMessage(err);
  window.dispatchEvent(new CustomEvent('jurinex:storage-full', { detail: { message: msg } }));
}
