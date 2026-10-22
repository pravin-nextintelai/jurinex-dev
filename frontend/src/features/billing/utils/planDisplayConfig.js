/**
 * Display limits from payment_DB.subscription_plans on plan cards.
 * NULL on a column = uses admin default (Document_DB llm_chat_config / summarization_chat_config).
 */

const CHAT_LIMIT_FIELDS = [
  { key: 'chat_token_limit', label: 'Chat tokens / day' },
  { key: 'chat_messages_per_hour', label: 'Chat messages / hour' },
  { key: 'chat_chats_per_day', label: 'Chats / day' },
  { key: 'chat_quota_per_minute', label: 'Chats / minute' },
  { key: 'chat_max_document_pages', label: 'Max document pages (chat)' },
  { key: 'chat_max_document_size_mb', label: 'Max file size MB (chat)' },
  { key: 'chat_max_file_upload_per_day', label: 'File uploads / day (chat)' },
  { key: 'chat_max_upload_files', label: 'Files per upload (chat)' },
];

const SUMMARIZATION_LIMIT_FIELDS = [
  { key: 'summarization_token_limit', label: 'Summary tokens / day' },
  { key: 'sum_messages_per_hour', label: 'Summary messages / hour' },
  { key: 'sum_chats_per_day', label: 'Summary chats / day' },
  { key: 'sum_quota_per_minute', label: 'Summary chats / minute' },
  { key: 'sum_max_document_pages', label: 'Max document pages (summary)' },
  { key: 'sum_max_document_size_mb', label: 'Max file size MB (summary)' },
  { key: 'sum_max_file_upload_per_day', label: 'File uploads / day (summary)' },
  { key: 'sum_max_upload_files', label: 'Files per upload (summary)' },
  { key: 'sum_max_context_documents', label: 'Max context documents' },
  { key: 'sum_max_conversation_history', label: 'Max conversation history' },
];

const GENERAL_LIMIT_FIELDS = [
  { key: 'token_limit', label: 'Token allowance (legacy)' },
  { key: 'carry_over_limit', label: 'Carry-over tokens' },
  { key: 'document_limit', label: 'Documents' },
  { key: 'ai_analysis_limit', label: 'AI analyses' },
  { key: 'storage_limit_gb', label: 'Storage (GB)' },
  { key: 'template_access', label: 'Template access', boolean: true },
  { key: 'drafting_type', label: 'Drafting' },
];

/** Coerce API/DB values to a safe React text child (never render raw objects or Promises). */
export const toDisplayString = (input, fallback = '') => {
  if (input == null || input === '') return fallback;
  if (typeof input === 'string') return input.trim() || fallback;
  if (typeof input === 'number' || typeof input === 'boolean') return String(input);
  if (typeof input === 'function' || (typeof input === 'object' && typeof input.then === 'function')) {
    return fallback;
  }
  if (typeof input === 'object') {
    if (typeof input.message === 'string' && input.message.trim()) return input.message.trim();
    if (typeof input.description === 'string' && input.description.trim()) return input.description.trim();
    if (input.value != null && typeof input.value !== 'object') {
      return toDisplayString(input.value, fallback);
    }
    if (typeof input.reason === 'string' && input.reason.trim()) return input.reason.trim();
  }
  try {
    const s = String(input).trim();
    return s && s !== '[object Object]' ? s : fallback;
  } catch {
    return fallback;
  }
};

const coerceLimitScalar = (value) => {
  if (value == null || value === '') return null;
  if (typeof value === 'object' && typeof value.then === 'function') return null;
  if (typeof value === 'object' && value.value != null && typeof value.value !== 'object') {
    return value.value;
  }
  if (typeof value === 'object' && !(value instanceof Date)) {
    const text = toDisplayString(value, '');
    return text || null;
  }
  return value;
};

export const formatPlanLimitValue = (value, { boolean = false } = {}) => {
  const scalar = coerceLimitScalar(value);
  if (scalar === null || scalar === undefined || scalar === '') return null;
  if (boolean) {
    const s = String(scalar).toLowerCase();
    if (['true', '1', 'yes'].includes(s)) return 'Yes';
    if (['false', '0', 'no'].includes(s)) return 'No';
    return String(scalar);
  }
  const n = Number(scalar);
  if (Number.isFinite(n)) {
    if (n <= 0) return 'Unlimited';
    return n.toLocaleString('en-IN');
  }
  return toDisplayString(scalar, null);
};

const parseMarketingFeatures = (features) => {
  if (!features) return [];
  if (Array.isArray(features)) return features.map((f) => String(f).trim()).filter(Boolean);
  if (typeof features === 'string') {
    return features.split(',').map((f) => f.trim()).filter(Boolean);
  }
  return [];
};

const buildSectionItems = (plan, fieldDefs) =>
  fieldDefs
    .map(({ key, label, boolean }) => {
      const raw = plan[key];
      if (raw === null || raw === undefined || raw === '') return null;
      const value = formatPlanLimitValue(raw, { boolean });
      if (!value) return null;
      return { label, value };
    })
    .filter(Boolean);

/**
 * @param {object} plan - subscription_plans row
 * @returns {{ marketing: string[], sections: { title: string, items: { label: string, value: string }[] }[] }}
 */
export const buildPlanLimitSections = (plan) => {
  if (!plan || typeof plan !== 'object') {
    return { marketing: [], sections: [] };
  }

  const sections = [];

  const chat = buildSectionItems(plan, CHAT_LIMIT_FIELDS);
  if (chat.length) {
    sections.push({ title: 'Chat Model Limits', items: chat });
  }

  const sum = buildSectionItems(plan, SUMMARIZATION_LIMIT_FIELDS);
  if (sum.length) {
    sections.push({ title: 'Summarization Limits', items: sum });
  }

  return { marketing: [], sections };
};
