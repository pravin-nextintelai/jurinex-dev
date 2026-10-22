/**
 * File helper utilities for evidence upload and display
 */

const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024; // 200MB
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.webp'];

/**
 * Format file size for display
 * @param {number} bytes - File size in bytes
 * @returns {string} e.g. "1.5 MB", "320 KB"
 */
export function formatFileSize(bytes) {
  if (bytes == null || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Validate file size (max 20MB)
 * @param {File} file
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateFileSize(file) {
  if (!file?.size) return { valid: false, error: 'Invalid file' };
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File must be under 200MB (current: ${formatFileSize(file.size)})`,
    };
  }
  return { valid: true };
}

/**
 * Get file extension (lowercase, with dot)
 * @param {string} fileName
 * @returns {string}
 */
export function getFileExtension(fileName) {
  if (!fileName) return '';
  const last = fileName.lastIndexOf('.');
  return last === -1 ? '' : fileName.slice(last).toLowerCase();
}

/**
 * Check if file type is allowed for evidence upload
 * @param {File} file
 * @returns {boolean}
 */
export function isAllowedEvidenceFile(file) {
  if (!file?.name) return false;
  const ext = getFileExtension(file.name);
  return ALLOWED_EXTENSIONS.includes(ext);
}

export const MAX_EVIDENCE_FILE_SIZE = MAX_FILE_SIZE_BYTES;
export const ALLOWED_EVIDENCE_EXTENSIONS = ALLOWED_EXTENSIONS;
