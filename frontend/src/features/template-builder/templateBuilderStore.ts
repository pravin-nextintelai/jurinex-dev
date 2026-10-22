import { create } from 'zustand';

export type BuilderPhase =
  | 'selecting'
  | 'answering'
  | 'generating'
  | 'preview'
  | 'saving'
  | 'saved'
  | 'error';

export interface StructureQuestion {
  id: string;
  question: string;
  placeholder: string;
  type: 'single_select' | 'multi_select' | 'yes_no' | 'range' | string;
  required: boolean;
  hint: string | null;
  options: string[] | null;
}

export interface ExtractedField {
  fieldId: string;
  label: string;
  type: string;
  required: boolean;
  group: string;
}

export interface ParsedSection {
  section_name: string;
  section_purpose?: string;
  section_intro?: string;
  section_prompts?: unknown[];
  order_index: number;
  content?: string;
}

export interface GenerationMetadata {
  generatedAt: string;
  documentType: string;
  templateName: string;
  category: string;
  jurisdiction: string;
  language: string;
  totalFields: number;
  totalSections: number;
  model: string;
  referenceDocumentUsed?: boolean;
  referenceDocumentName?: string;
  referenceDocumentNames?: string[];
}

export interface TemplateRequirements {
  subject: string;
  subjectLabel: string;
  category: string;
  customDescription: string;
  referenceMode: 'without-document' | 'with-document';
  referenceDocuments: File[];
  referenceDocumentNames: string[];
  propertyType: string;
  partyType: string;
  valueRange: string;
  court: string;
  disputeNature: string;
  opposingParty: string;
  orgType: string;
  trustPurpose: string;
  corpusSize: string;
  audienceType: string;
  personalLaw: string;
  urgency: string;
  jurisdiction: string;
  language: string;
  detailLevel: string;
  emphasis: string;
  schedulePreference: string;
  specialClauses: string[];
  freeText: string;
}

interface BuilderState {
  phase: BuilderPhase;
  currentStep: number;
  requirements: TemplateRequirements;
  generatedTemplateText: string;
  generationStreamText: string;
  extractedFields: ExtractedField[];
  parsedSections: ParsedSection[];
  generationMetadata: GenerationMetadata | null;
  savedTemplateId: string | null;
  savedTemplateName: string | null;
  errorMessage: string;
  dynamicMode: boolean;
  dynamicQuestions: StructureQuestion[];
  dynamicAnswers: Record<string, string>;
  dynamicQuestionsLoading: boolean;
  dynamicQuestionsError: string;
}

interface BuilderActions {
  setPhase: (phase: BuilderPhase) => void;
  setCurrentStep: (step: number) => void;
  updateRequirements: (patch: Partial<TemplateRequirements>) => void;
  resetRequirements: () => void;
  setGenerationResult: (
    text: string,
    fields: ExtractedField[],
    sections: ParsedSection[],
    metadata: GenerationMetadata
  ) => void;
  setGenerationStreamText: (text: string) => void;
  appendGenerationStreamText: (text: string) => void;
  clearGenerationStreamText: () => void;
  setSaveResult: (templateId: string, templateName: string) => void;
  setError: (message: string) => void;
  reset: () => void;
  setDynamicMode: (enabled: boolean) => void;
  setDynamicQuestions: (questions: StructureQuestion[]) => void;
  setDynamicAnswer: (questionId: string, answer: string) => void;
  setDynamicQuestionsLoading: (loading: boolean) => void;
  setDynamicQuestionsError: (error: string) => void;
  clearDynamicState: () => void;
}

const initialRequirements: TemplateRequirements = {
  subject: '',
  subjectLabel: '',
  category: '',
  customDescription: '',
  referenceMode: 'without-document',
  referenceDocuments: [],
  referenceDocumentNames: [],
  propertyType: '',
  partyType: '',
  valueRange: '',
  court: '',
  disputeNature: '',
  opposingParty: '',
  orgType: '',
  trustPurpose: '',
  corpusSize: '',
  audienceType: '',
  personalLaw: '',
  urgency: '',
  jurisdiction: '',
  language: '',
  detailLevel: '',
  emphasis: '',
  schedulePreference: '',
  specialClauses: [],
  freeText: '',
};

const initialState: BuilderState = {
  phase: 'selecting',
  currentStep: 1,
  requirements: initialRequirements,
  generatedTemplateText: '',
  generationStreamText: '',
  extractedFields: [],
  parsedSections: [],
  generationMetadata: null,
  savedTemplateId: null,
  savedTemplateName: null,
  errorMessage: '',
  dynamicMode: false,
  dynamicQuestions: [],
  dynamicAnswers: {},
  dynamicQuestionsLoading: false,
  dynamicQuestionsError: '',
};

export const useTemplateBuilderStore = create<BuilderState & BuilderActions>((set, get) => ({
  ...initialState,

  setPhase: (phase) => set({ phase }),

  setCurrentStep: (step) => set({ currentStep: Math.max(1, Math.min(step, 6)), phase: 'answering' }),

  updateRequirements: (patch) =>
    set((state) => ({
      requirements: {
        ...state.requirements,
        ...patch,
      },
    })),

  resetRequirements: () => set({ requirements: { ...initialRequirements }, currentStep: 1, phase: 'selecting', dynamicMode: false, dynamicQuestions: [], dynamicAnswers: {}, dynamicQuestionsLoading: false, dynamicQuestionsError: '' }),

  setGenerationResult: (text, fields, sections, metadata) =>
    set({
      generatedTemplateText: text,
      generationStreamText: '',
      extractedFields: fields,
      parsedSections: sections,
      generationMetadata: metadata,
      phase: 'preview',
    }),

  setGenerationStreamText: (generationStreamText) => set({ generationStreamText }),

  appendGenerationStreamText: (text) =>
    set((state) => ({ generationStreamText: `${state.generationStreamText}${text}` })),

  clearGenerationStreamText: () => set({ generationStreamText: '' }),

  setSaveResult: (savedTemplateId, savedTemplateName) =>
    set({ savedTemplateId, savedTemplateName, phase: 'saved' }),

  setError: (errorMessage) => set({ errorMessage, phase: 'error' }),

  setDynamicMode: (dynamicMode) => set({ dynamicMode }),

  setDynamicQuestions: (dynamicQuestions) =>
    set({ dynamicQuestions, dynamicQuestionsLoading: false, dynamicQuestionsError: '' }),

  setDynamicAnswer: (questionId, answer) =>
    set((state) => ({ dynamicAnswers: { ...state.dynamicAnswers, [questionId]: answer } })),

  setDynamicQuestionsLoading: (dynamicQuestionsLoading) => set({ dynamicQuestionsLoading }),

  setDynamicQuestionsError: (dynamicQuestionsError) =>
    set({ dynamicQuestionsError, dynamicQuestionsLoading: false }),

  clearDynamicState: () =>
    set({ dynamicMode: false, dynamicQuestions: [], dynamicAnswers: {}, dynamicQuestionsLoading: false, dynamicQuestionsError: '' }),

  reset: () => set({ ...initialState, requirements: { ...initialRequirements } }),
}));
