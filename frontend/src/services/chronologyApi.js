import axios from 'axios';
import { DOCS_BASE_URL, getUserIdForDrafting } from '../config/apiConfig';

const getAuthHeader = () => {
  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('authToken') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('jwt') ||
    localStorage.getItem('auth_token');
  const userId = getUserIdForDrafting();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(userId ? { 'X-User-Id': userId } : {}),
  };
};

const folderSegment = (folderName) => encodeURIComponent(String(folderName || '').trim());

/** Normalize either a bare tree or a payload that wraps it under `chronology`. */
const normalizeTree = (data) => {
  const tree = data?.chronology || data?.extractedData?.chronology || data;
  if (!tree || !Array.isArray(tree.dates)) return { dates: [], phases: [], sourceDocuments: [], eventCount: 0 };
  return {
    dates: tree.dates,
    phases: Array.isArray(tree.phases) ? tree.phases : [],
    sourceDocuments: Array.isArray(tree.sourceDocuments) ? tree.sourceDocuments : [],
    eventCount: Number(tree.eventCount) || tree.dates.reduce((n, d) => n + (d.events?.length || 0), 0),
  };
};

/** GET /api/files/{folderName}/chronology — stored tree only, no LLM call. */
export const getCaseChronology = async (folderName) => {
  const response = await axios.get(`${DOCS_BASE_URL}/${folderSegment(folderName)}/chronology`, {
    headers: getAuthHeader(),
  });
  return normalizeTree(response.data);
};

/**
 * POST /api/files/{folderName}/extract-case-fields?rebuild=true — re-reads the case's OCR and
 * builds the chronology again, even when one is already stored. No client timeout: long paper
 * books can take a few minutes with a thinking model.
 */
export const rebuildCaseChronology = async (folderName) => {
  const response = await axios.post(
    `${DOCS_BASE_URL}/${folderSegment(folderName)}/extract-case-fields`,
    {},
    { headers: getAuthHeader(), params: { rebuild: true }, timeout: 0 }
  );
  return normalizeTree(response.data);
};

export default { getCaseChronology, rebuildCaseChronology };
