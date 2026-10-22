import axios from 'axios';
import { DOCUMENT_SERVICE_URL } from '@/config/apiConfig';

// Z.AI Translation Agent endpoints served by agentic-document-service (port 8092).
const translationClient = axios.create({
  baseURL: DOCUMENT_SERVICE_URL,
  withCredentials: false,
  timeout: 180000, // reflection/cot strategies are multi-pass and slow
});

/** Strategies + configured flag: { configured, strategies: [{id, description}] } */
export const getTranslationStrategies = async () => {
  const res = await translationClient.get('/api/v1/translation/strategies');
  return res.data;
};

/**
 * Translate text.
 * Returns { translated_text, source_lang, target_lang, strategy, truncated, request_id, usage }.
 */
export const translateText = async ({
  text,
  targetLang,
  sourceLang = 'auto',
  strategy = 'general',
  suggestion = '',
}) => {
  const res = await translationClient.post('/api/v1/translation/translate', {
    text,
    target_lang: targetLang,
    source_lang: sourceLang,
    strategy,
    suggestion: suggestion || null,
  });
  return res.data;
};

/**
 * Start an async document translation job (PDF/DOCX upload).
 * Returns the job state: { job_id, status, progress, ... }.
 */
export const translateDocument = async ({
  file,
  targetLang,
  sourceLang = 'auto',
  strategy = 'general',
  outputFormat = 'docx',
  suggestion = '',
}) => {
  const form = new FormData();
  form.append('file', file);
  form.append('target_lang', targetLang);
  form.append('source_lang', sourceLang);
  form.append('strategy', strategy);
  form.append('output_format', outputFormat);
  if (suggestion) form.append('suggestion', suggestion);
  const res = await translationClient.post('/api/v1/translation/document', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
};

export const getDocumentTranslationStatus = async (jobId) => {
  const res = await translationClient.get(`/api/v1/translation/document/${jobId}/status`);
  return res.data;
};

export const documentTranslationDownloadUrl = (jobId) =>
  `${DOCUMENT_SERVICE_URL}/api/v1/translation/document/${jobId}/download`;
