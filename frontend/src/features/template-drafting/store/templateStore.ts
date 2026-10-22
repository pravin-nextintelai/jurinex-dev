/**
 * Template Drafting Component - Template Store
 * Zustand store for template listing and selection
 */

import { create } from 'zustand';
import { templateApi } from '../services';
import { Logger } from '../utils/logger';
import type { TemplateListItem, Template, AppError, ErrorCategory } from '../types';

interface TemplateState {
    // Data
    templates: TemplateListItem[];
    selectedTemplate: Template | null;

    // UI state
    isLoading: boolean;
    isLoadingDetails: boolean;
    error: AppError | null;
    categoryFilter: string | null;

    // Actions
    loadTemplates: () => Promise<void>;
    loadTemplateById: (templateId: string) => Promise<Template | null>;
    setSelectedTemplate: (template: Template | null) => void;
    setCategoryFilter: (category: string | null) => void;
    clearError: () => void;
}

export const useTemplateStore = create<TemplateState>((set, get) => ({
    // Initial state
    templates: [],
    selectedTemplate: null,
    isLoading: false,
    isLoadingDetails: false,
    error: null,
    categoryFilter: null,

    loadTemplates: async () => {
        set({ isLoading: true, error: null });

        try {
            Logger.info('LOAD_TEMPLATES_START');

            const response = await templateApi.list();

            Logger.info('LOAD_TEMPLATES_SUCCESS', { count: response.count });

            set({
                templates: response.templates,
                isLoading: false
            });
        } catch (error) {
            const appError: AppError = {
                category: 'API_FAILURE' as ErrorCategory,
                message: 'Failed to load templates. Please try again.',
                recoverable: true
            };

            Logger.error('LOAD_TEMPLATES_FAILED', { error: (error as Error).message });

            set({
                isLoading: false,
                error: appError
            });
        }
    },

    loadTemplateById: async (templateId: string) => {
        set({ isLoadingDetails: true, error: null });

        try {
            Logger.info('LOAD_TEMPLATE_DETAILS_START', { templateId });

            const response = await templateApi.getById(templateId);

            Logger.info('LOAD_TEMPLATE_DETAILS_SUCCESS', {
                templateId,
                templateName: response.template.name
            });

            set({
                selectedTemplate: response.template,
                isLoadingDetails: false
            });

            return response.template;
        } catch (error) {
            const appError: AppError = {
                category: 'API_FAILURE' as ErrorCategory,
                message: 'Failed to load template details. Please try again.',
                recoverable: true
            };

            Logger.error('LOAD_TEMPLATE_DETAILS_FAILED', {
                templateId,
                error: (error as Error).message
            });

            set({
                isLoadingDetails: false,
                error: appError
            });

            return null;
        }
    },

    setSelectedTemplate: (template: Template | null) => {
        set({ selectedTemplate: template });
    },

    setCategoryFilter: (category: string | null) => {
        set({ categoryFilter: category });
    },

    clearError: () => {
        set({ error: null });
    }
}));

/**
 * Selector: Get filtered templates by category
 */
export const useFilteredTemplates = (): TemplateListItem[] => {
    const templates = useTemplateStore((state: TemplateState) => state.templates);
    const categoryFilter = useTemplateStore((state: TemplateState) => state.categoryFilter);

    if (!categoryFilter) {
        return templates;
    }

    return templates.filter(t => t.category === categoryFilter);
};

/**
 * Selector: Get unique categories from templates
 */
export const useTemplateCategories = (): string[] => {
    const templates = useTemplateStore((state: TemplateState) => state.templates);

    const categories = new Set<string>();
    templates.forEach((t: TemplateListItem) => {
        if (t.category) {
            categories.add(t.category);
        }
    });

    return Array.from(categories).sort();
};
