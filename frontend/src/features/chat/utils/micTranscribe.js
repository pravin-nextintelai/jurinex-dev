import { getUserIdForDrafting } from '@/config/apiConfig';

/**
 * Transcribe a short microphone recording via agentic-document-service
 * (Google Cloud Speech-to-Text — not LLM transcription).
 */
export async function transcribeMicAudio(blob, mimeType, serviceBaseUrl) {
  const base = String(serviceBaseUrl || '').replace(/\/$/, '');
  if (!base) throw new Error('Document service URL is not configured.');

  const ext = (mimeType || '').includes('webm') ? 'webm' : 'wav';
  const form = new FormData();
  form.append('file', blob, `recording.${ext}`);

  // The backend's token guard requires the caller's identity on /transcribe.
  const token = localStorage.getItem('token') || localStorage.getItem('authToken') || localStorage.getItem('access_token') || localStorage.getItem('jwt') || localStorage.getItem('auth_token');
  const userId = getUserIdForDrafting();
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(userId ? { 'X-User-Id': userId } : {}),
  };

  const res = await fetch(`${base}/api/v1/speech/transcribe`, {
    method: 'POST',
    headers,
    body: form,
  });

  let detail = '';
  try {
    const data = await res.json();
    detail = data?.detail || data?.message || '';
    if (res.ok) {
      const transcript = String(data?.transcript || '').trim();
      if (!transcript) throw new Error('No speech detected. Please try again.');
      return { transcript };
    }
  } catch (parseErr) {
    if (res.ok) throw parseErr;
  }

  throw new Error(
    detail || (res.status === 503
      ? 'Speech recognition is temporarily unavailable.'
      : `Transcription failed (${res.status}).`)
  );
}
