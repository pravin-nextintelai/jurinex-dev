import { getFileExtension } from '@/shared/utils/fileHelpers';

/**
 * How the "Original Document" panel must render a file.
 *
 * The viewer is handed a signed URL to the RAW uploaded object, so the panel has to know what that
 * object is before choosing a renderer:
 *  - `pdf`     -> pdf.js (react-pdf).
 *  - `docx`    -> docx-preview, which parses the OOXML in the browser.
 *  - `native`  -> the browser renders it in an iframe on its own (images, plain text).
 *  - `unsupported` -> nothing can render it inline; offer a download instead.
 *
 * `unsupported` matters as much as the rest: pointing an iframe at a type the browser cannot display
 * (.docx, legacy .doc) makes it treat the navigation as a download, so merely opening the preview
 * silently drops the file in the user's Downloads folder.
 */
export type PreviewKind = 'pdf' | 'docx' | 'native' | 'unsupported';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const resolvePreviewKind = (
  mimetype?: string | null,
  fileName?: string | null,
): PreviewKind => {
  const mime = (mimetype || '').toLowerCase().split(';')[0].trim();
  const ext = getFileExtension(fileName || '');

  // Extension is checked first and mimetype second: the stored mimetype can be a generic
  // application/octet-stream (uploads that arrive without a type), whereas the original filename keeps
  // its real extension. Either alone is enough to identify the file.
  if (ext === '.pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === '.docx' || mime === DOCX_MIME) return 'docx';

  // Legacy Word (.doc) is a binary format, not OOXML — docx-preview cannot read it.
  if (ext === '.doc' || mime === 'application/msword') return 'unsupported';

  if (mime.startsWith('image/') || mime.startsWith('text/')) return 'native';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt'].includes(ext)) {
    return 'native';
  }

  return 'unsupported';
};

export default resolvePreviewKind;
