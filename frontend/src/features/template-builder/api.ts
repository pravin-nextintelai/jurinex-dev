/**
 * Template Builder API — Claude-powered endpoints
 *
 *  POST /analysis/get-questions      → Claude returns document-specific questions
 *  POST /analysis/generate-template  → Claude drafts the full legal template
 *  POST /analysis/save-generated     → Saves to user's custom library
 */

import axios, { AxiosError } from 'axios';
import { TEMPLATE_ANALYZER_API_BASE } from '@/config/apiConfig.js';
import { throwIfQuotaResponse } from '@/shared/utils/quotaError.js';
import type {
  ExtractedField,
  ParsedSection,
  GenerationMetadata,
  TemplateRequirements,
  StructureQuestion,
} from './templateBuilderStore';

// ── Auth helpers ──────────────────────────────────────────────────────────────

function getAuthToken(): string | null {
  return (
    localStorage.getItem('token') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('auth_token') ||
    localStorage.getItem('authToken') ||
    null
  );
}

function getUserId(): string | null {
  try {
    const userStr = localStorage.getItem('user') || localStorage.getItem('userInfo');
    if (userStr) {
      const parsed = JSON.parse(userStr);
      const id = parsed?.id ?? parsed?.userId ?? parsed?.user_id;
      if (id != null) return String(id);
    }
    const token = getAuthToken();
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1] || '{}'));
      const id = payload?.id ?? payload?.userId ?? payload?.user_id ?? payload?.sub;
      if (id != null) return String(id);
    }
  } catch {
    // ignore
  }
  return null;
}

function normalizeBase(base: string): string {
  const t = String(base || '').replace(/\/+$/, '');
  if (!t) return '/analysis';
  return t.endsWith('/analysis') ? t : `${t}/analysis`;
}

function extractError(error: unknown): string {
  if (error instanceof AxiosError && error.response?.data) {
    const d = error.response.data as { detail?: string | string[] };
    if (typeof d.detail === 'string') return d.detail;
    if (Array.isArray(d.detail) && d.detail.length) return String(d.detail[0]);
  }
  return error instanceof Error ? error.message : 'Request failed';
}

function getPageControl(detailLevel: string): { targetRange: string; hardRule: string; sectionGuidance: string } {
  const value = (detailLevel || '').toLowerCase();
  if (value.includes('concise') || value.includes('5-8')) {
    return {
      targetRange: '5-8 pages',
      hardRule: 'Hard rule: keep the generated template within 5-8 pages. Do not exceed 8 pages.',
      sectionGuidance: 'Use only essential clauses, compact drafting, and minimal schedules.',
    };
  }
  if (value.includes('detailed') || value.includes('15-25')) {
    return {
      targetRange: '15-25 pages',
      hardRule: 'Hard rule: generate a detailed template within 15-25 pages. Do not exceed 25 pages unless explicitly required by law.',
      sectionGuidance: 'Use exhaustive clauses, fuller definitions, and comprehensive schedules.',
    };
  }
  return {
    targetRange: '8-15 pages',
    hardRule: 'Hard rule: keep the generated template within 8-15 pages. Do not exceed 15 pages.',
    sectionGuidance: 'Use balanced detail, standard clause depth, and standard schedules.',
  };
}

// ── Axios client ──────────────────────────────────────────────────────────────

const client = axios.create({
  baseURL: normalizeBase(TEMPLATE_ANALYZER_API_BASE),
  timeout: 180_000, // 3 min — Claude can take time for large templates
});

client.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const userId = getUserId();
  if (userId) config.headers['X-User-Id'] = userId;
  return config;
});

// ── Response types ────────────────────────────────────────────────────────────

export interface GetQuestionsResponse {
  success: boolean;
  document_type: string;
  questions: Array<Record<string, unknown>>;
}

export interface GenerateTemplateResponse {
  success: boolean;
  templateText: string;
  fields: ExtractedField[];
  sections: ParsedSection[];
  metadata: GenerationMetadata;
}

export interface GenerateTemplateStreamEvent {
  type: 'start' | 'chunk' | 'complete' | 'error';
  message?: string;
  text?: string;
  templateText?: string;
  fields?: ExtractedField[];
  sections?: ParsedSection[];
  metadata?: GenerationMetadata;
}

export interface SaveGeneratedResponse {
  success: boolean;
  templateId: string;
  message: string;
}

export interface GetStructureQuestionsResponse {
  success: boolean;
  description: string;
  questions: StructureQuestion[];
}

// ── API methods ───────────────────────────────────────────────────────────────

export const templateBuilderApi = {
  /**
   * Fetch AI-generated structure questions for a custom description.
   * Returns 8-12 questions about clause presence, party types, value ranges —
   * NOT data questions (names, dates, amounts).
   */
  getStructureQuestions: async (
    description: string,
    jurisdiction?: string,
    referenceDocuments?: File[],
  ): Promise<GetStructureQuestionsResponse> => {
    try {
      let res;
      if (referenceDocuments && referenceDocuments.length > 0) {
        const form = new FormData();
        form.append('description', description);
        form.append('jurisdiction', jurisdiction || 'India');
        referenceDocuments.forEach((file) => form.append('reference_documents', file));
        // Backward compatibility for older analyzer instances that still expect singular key.
        form.append('reference_document', referenceDocuments[0]);
        res = await client.post<GetStructureQuestionsResponse>('/get-structure-questions-with-document', form);
      } else {
        res = await client.post<GetStructureQuestionsResponse>('/get-structure-questions', {
          description,
          jurisdiction: jurisdiction || 'India',
        });
      }
      return res.data;
    } catch (error) {
      throw new Error(extractError(error));
    }
  },

  /**
   * Legacy dynamic-question endpoint. Kept for backward compatibility.
   */
  getQuestions: async (documentType: string): Promise<GetQuestionsResponse> => {
    try {
      const res = await client.post<GetQuestionsResponse>('/get-questions', {
        document_type: documentType,
      });
      return res.data;
    } catch (error) {
      throw new Error(extractError(error));
    }
  },

  /**
   * Send structured template requirements → AI drafts the complete legal template.
   * In dynamic mode, pass dynamicQuestions + dynamicAnswers to use AI-generated Q&A
   * instead of the static requirements fields.
   */
  generateTemplate: async (payload: {
    requirements: TemplateRequirements;
    dynamicQuestions?: StructureQuestion[];
    dynamicAnswers?: Record<string, string>;
  }): Promise<GenerateTemplateResponse> => {
    try {
      const { requirements, dynamicQuestions, dynamicAnswers } = payload;
      const pageControl = getPageControl(requirements.detailLevel);

      // ── Dynamic mode: use AI-generated structure Q&A ─────────────────────
      if (dynamicQuestions && dynamicQuestions.length > 0 && dynamicAnswers) {
        const questions = [
          ...dynamicQuestions.map((q) => ({
            id: q.id,
            question: q.question,
            type: q.type,
          })),
          { id: 'req_detail_level', question: 'Detail Level', type: 'text' },
          { id: 'req_target_page_range', question: 'Target Page Range', type: 'text' },
          { id: 'req_page_limit_rule', question: 'Page Limit Rule', type: 'text' },
          { id: 'req_page_planning_guidance', question: 'Page Planning Guidance', type: 'text' },
        ];
        const answers: Record<string, string> = {};
        for (const q of dynamicQuestions) {
          answers[q.id] = (dynamicAnswers[q.id] || '').replace(/\|\|/g, ', ');
        }
        answers.req_detail_level = requirements.detailLevel || 'Balanced (8-15 pages)';
        answers.req_target_page_range = pageControl.targetRange;
        answers.req_page_limit_rule = pageControl.hardRule;
        answers.req_page_planning_guidance = pageControl.sectionGuidance;

        const res = await client.post<GenerateTemplateResponse>('/generate-template', {
          document_type: requirements.subjectLabel || requirements.subject || 'Legal Template',
          answers,
          questions,
          jurisdiction: requirements.jurisdiction || 'India',
          language: requirements.language || 'English',
        });
        return res.data;
      }

      // ── Standard mode: use static requirements fields ─────────────────────
      const entries = [
        ['Document Type', requirements.subjectLabel || requirements.subject],
        ['Category', requirements.category],
        ['Custom Description', requirements.customDescription],
        ['Property Type', requirements.propertyType],
        ['Party Type', requirements.partyType],
        ['Value Range', requirements.valueRange],
        ['Court', requirements.court],
        ['Dispute Nature', requirements.disputeNature],
        ['Opposing Party', requirements.opposingParty],
        ['Organization Type', requirements.orgType],
        ['Trust Purpose', requirements.trustPurpose],
        ['Corpus Size', requirements.corpusSize],
        ['Audience Type', requirements.audienceType],
        ['Personal Law', requirements.personalLaw],
        ['Urgency', requirements.urgency],
        ['Detail Level', requirements.detailLevel],
        ['Target Page Range', pageControl.targetRange],
        ['Page Limit Rule', pageControl.hardRule],
        ['Page Planning Guidance', pageControl.sectionGuidance],
        ['Emphasis', requirements.emphasis],
        ['Schedule Preference', requirements.schedulePreference],
        ['Special Clauses', requirements.specialClauses.join(', ')],
        ['Additional Notes', requirements.freeText],
      ].filter(([, value]) => Boolean(value));

      const questions = entries.map(([label], index) => ({
        id: `req_${index + 1}`,
        question: label,
        type: 'text',
      }));

      const answers = Object.fromEntries(
        entries.map(([_, value], index) => [`req_${index + 1}`, String(value)])
      );

      const res = await client.post<GenerateTemplateResponse>('/generate-template', {
        document_type: requirements.subjectLabel || requirements.subject || 'Legal Template',
        answers,
        questions,
        jurisdiction: requirements.jurisdiction || 'India',
        language: requirements.language || 'English',
      });
      return res.data;
    } catch (error) {
      throw new Error(extractError(error));
    }
  },

  streamGenerateTemplate: async (
    payload: {
      requirements: TemplateRequirements;
      dynamicQuestions?: StructureQuestion[];
      dynamicAnswers?: Record<string, string>;
    },
    handlers: {
      onEvent?: (event: GenerateTemplateStreamEvent) => void;
    } = {},
  ): Promise<GenerateTemplateResponse> => {
    const { requirements, dynamicQuestions, dynamicAnswers } = payload;
    const pageControl = getPageControl(requirements.detailLevel);
    let questions: Array<{ id: string; question: string; type: string }> = [];
    let answers: Record<string, string> = {};

    if (dynamicQuestions && dynamicQuestions.length > 0 && dynamicAnswers) {
      questions = [
        ...dynamicQuestions.map((q) => ({
          id: q.id,
          question: q.question,
          type: q.type,
        })),
        { id: 'req_detail_level', question: 'Detail Level', type: 'text' },
        { id: 'req_target_page_range', question: 'Target Page Range', type: 'text' },
        { id: 'req_page_limit_rule', question: 'Page Limit Rule', type: 'text' },
        { id: 'req_page_planning_guidance', question: 'Page Planning Guidance', type: 'text' },
      ];
      for (const q of dynamicQuestions) {
        answers[q.id] = (dynamicAnswers[q.id] || '').replace(/\|\|/g, ', ');
      }
      answers.req_detail_level = requirements.detailLevel || 'Balanced (8-15 pages)';
      answers.req_target_page_range = pageControl.targetRange;
      answers.req_page_limit_rule = pageControl.hardRule;
      answers.req_page_planning_guidance = pageControl.sectionGuidance;
    } else {
      const entries = [
        ['Document Type', requirements.subjectLabel || requirements.subject],
        ['Category', requirements.category],
        ['Custom Description', requirements.customDescription],
        ['Property Type', requirements.propertyType],
        ['Party Type', requirements.partyType],
        ['Value Range', requirements.valueRange],
        ['Court', requirements.court],
        ['Dispute Nature', requirements.disputeNature],
        ['Opposing Party', requirements.opposingParty],
        ['Organization Type', requirements.orgType],
        ['Trust Purpose', requirements.trustPurpose],
        ['Corpus Size', requirements.corpusSize],
        ['Audience Type', requirements.audienceType],
        ['Personal Law', requirements.personalLaw],
        ['Urgency', requirements.urgency],
        ['Detail Level', requirements.detailLevel],
        ['Target Page Range', pageControl.targetRange],
        ['Page Limit Rule', pageControl.hardRule],
        ['Page Planning Guidance', pageControl.sectionGuidance],
        ['Emphasis', requirements.emphasis],
        ['Schedule Preference', requirements.schedulePreference],
        ['Special Clauses', requirements.specialClauses.join(', ')],
        ['Additional Notes', requirements.freeText],
      ].filter(([, value]) => Boolean(value));

      questions = entries.map(([label], index) => ({
        id: `req_${index + 1}`,
        question: label,
        type: 'text',
      }));
      answers = Object.fromEntries(entries.map(([_, value], index) => [`req_${index + 1}`, String(value)]));
    }

    const token = getAuthToken();
    const userId = getUserId();
    const headers: HeadersInit = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(userId ? { 'X-User-Id': userId } : {}),
    };
    const hasReferenceDocument = requirements.referenceDocuments.length > 0;
    let body: BodyInit;
    let endpoint = '/generate-template-stream';

    if (hasReferenceDocument) {
      endpoint = '/generate-template-stream-with-document';
      const form = new FormData();
      form.append('document_type', requirements.subjectLabel || requirements.subject || 'Legal Template');
      form.append('answers', JSON.stringify(answers));
      form.append('questions', JSON.stringify(questions));
      form.append('jurisdiction', requirements.jurisdiction || 'India');
      form.append('language', requirements.language || 'English');
      requirements.referenceDocuments.forEach((file) => form.append('reference_documents', file));
      // Backward compatibility for older analyzer instances that still expect singular key.
      form.append('reference_document', requirements.referenceDocuments[0]);
      body = form;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({
        document_type: requirements.subjectLabel || requirements.subject || 'Legal Template',
        answers,
        questions,
        jurisdiction: requirements.jurisdiction || 'India',
        language: requirements.language || 'English',
      });
    }

    const response = await fetch(`${normalizeBase(TEMPLATE_ANALYZER_API_BASE)}${endpoint}`, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      // Throws a quota error (isQuotaError=true) for 429/503 token-limit responses,
      // or a plain Error for other failures.
      await throwIfQuotaResponse(response, `Request failed (${response.status})`);
    }
    if (!response.body) {
      throw new Error('No response body from generation service');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completed: GenerateTemplateResponse | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const event = JSON.parse(trimmed) as GenerateTemplateStreamEvent;
        handlers.onEvent?.(event);
        if (event.type === 'error') {
          throw new Error(event.message || 'Streaming generation failed');
        }
        if (event.type === 'complete') {
          completed = {
            success: true,
            templateText: event.templateText || '',
            fields: event.fields || [],
            sections: event.sections || [],
            metadata: event.metadata as GenerationMetadata,
          };
        }
      }
    }

    if (buffer.trim()) {
      const event = JSON.parse(buffer.trim()) as GenerateTemplateStreamEvent;
      handlers.onEvent?.(event);
      if (event.type === 'error') {
        throw new Error(event.message || 'Streaming generation failed');
      }
      if (event.type === 'complete') {
        completed = {
          success: true,
          templateText: event.templateText || '',
          fields: event.fields || [],
          sections: event.sections || [],
          metadata: event.metadata as GenerationMetadata,
        };
      }
    }

    if (!completed) {
      throw new Error('Template generation stream ended without a final result');
    }

    return completed;
  },

  /**
   * Save the reviewed template to the user's custom library.
   */
  saveGeneratedTemplate: async (payload: {
    templateText: string;
    fields: ExtractedField[];
    sections: ParsedSection[];
    metadata: GenerationMetadata;
    requirements: Record<string, unknown>;
  }): Promise<SaveGeneratedResponse> => {
    try {
      const res = await client.post<SaveGeneratedResponse>('/save-generated', payload);
      return res.data;
    } catch (error) {
      throw new Error(extractError(error));
    }
  },
};
