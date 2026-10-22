/**
 * Template Drafting Component - Draft API Service
 */

import { api } from './api';
import type {
    DraftsResponse,
    DraftResponse,
    CreateDraftRequest,
    CreateDraftResponse,
    UpdateFieldsRequest,
    UpdateFieldsResponse,
    VersionHistoryResponse,
    UndoRedoResponse
} from '../types';

export const draftApi = {
    /**
     * List all user's drafts
     */
    list: async (): Promise<DraftsResponse> => {
        const response = await api.get<DraftsResponse>('/drafts');
        return response.data;
    },

    /**
     * Create new draft from template
     */
    create: async (data: CreateDraftRequest): Promise<CreateDraftResponse> => {
        const response = await api.post<CreateDraftResponse>('/drafts', data);
        return response.data;
    },

    /**
     * Get draft by ID with current state (all blocks)
     */
    getById: async (draftId: string): Promise<DraftResponse> => {
        const response = await api.get<DraftResponse>(`/drafts/${draftId}`);
        return response.data;
    },

    /**
     * Update draft form fields (creates new version)
     */
    updateFields: async (
        draftId: string,
        fields: Record<string, string | number | null>
    ): Promise<UpdateFieldsResponse> => {
        const response = await api.put<UpdateFieldsResponse>(
            `/drafts/${draftId}/fields`,
            { fields }
        );
        return response.data;
    },

    /**
     * Update draft title
     */
    updateTitle: async (draftId: string, title: string): Promise<{ success: boolean }> => {
        const response = await api.put(`/drafts/${draftId}/title`, { title });
        return response.data;
    },

    /**
     * Delete draft (soft delete)
     */
    delete: async (draftId: string): Promise<{ success: boolean; message: string }> => {
        const response = await api.delete(`/drafts/${draftId}`);
        return response.data;
    },

    /**
     * Undo last action
     */
    undo: async (draftId: string): Promise<UndoRedoResponse> => {
        const response = await api.post<UndoRedoResponse>(`/drafts/${draftId}/undo`);
        return response.data;
    },

    /**
     * Redo undone action
     */
    redo: async (draftId: string): Promise<UndoRedoResponse> => {
        const response = await api.post<UndoRedoResponse>(`/drafts/${draftId}/redo`);
        return response.data;
    },

    /**
     * Get version history
     */
    getVersionHistory: async (draftId: string): Promise<VersionHistoryResponse> => {
        const response = await api.get<VersionHistoryResponse>(`/drafts/${draftId}/versions`);
        return response.data;
    },

    /**
     * Restore to specific version
     */
    restoreVersion: async (
        draftId: string,
        versionId: string
    ): Promise<{ success: boolean; versionId: string; versionNo: number }> => {
        const response = await api.post(`/drafts/${draftId}/versions/${versionId}/restore`);
        return response.data;
    },

    /**
     * Get HTML preview for draft
     */
    getPreview: async (draftId: string): Promise<{ html: string; versionId: string; renderId: string }> => {
        const response = await api.get<{ html: string; versionId: string; renderId: string }>(`/drafts/${draftId}/preview`);
        return response.data;
    },

    /**
     * Get section prompts for draft
     */
    getSectionPrompts: async (draftId: string): Promise<any[]> => {
        const response = await api.get<{ success: boolean; prompts: any[] }>(`/drafts/${draftId}/sections/prompts`);
        return response.data.prompts;
    },

    /**
     * Update section prompt
     */
    saveSectionPrompt: async (draftId: string, sectionId: string, data: { customPrompt?: string; isDeleted?: boolean; detailLevel?: string; language?: string; sectionName?: string; sectionType?: string; sortOrder?: number }): Promise<any> => {
        const payload = {
            sectionId,
            ...data
        };
        const response = await api.post(`/drafts/${draftId}/sections/prompts`, payload);
        return response.data;
    },

    saveSectionOrder: async (draftId: string, sectionIds: string[]): Promise<any> => {
        const response = await api.post(`/drafts/${draftId}/sections/order`, { sectionIds });
        return response.data;
    },

    /**
     * Get all section versions for a draft
     */
    getSections: async (draftId: string): Promise<{ success: boolean; sections: any[]; count: number }> => {
        const response = await api.get<{ success: boolean; sections: any[]; count: number }>(`/drafts/${draftId}/sections`);
        return response.data;
    },

    /**
     * Get single section content by section_key
     */
    getSection: async (draftId: string, sectionKey: string): Promise<{ success: boolean; version: any; reviews?: any[] }> => {
        const response = await api.get<{ success: boolean; version: any; reviews?: any[] }>(
            `/drafts/${draftId}/sections/${encodeURIComponent(sectionKey)}`
        );
        return response.data;
    },

    /**
     * Generate section content (RAG + LLM + optional critic can take several minutes)
     */
    generateSection: async (
        draftId: string,
        sectionKey: string,
        body: {
            section_prompt?: string;
            auto_validate?: boolean;
            language?: string;
            wait_for_completion?: boolean;
        }
    ): Promise<{
        success: boolean;
        version?: any;
        critic_review?: any;
        job_id?: string;
        queued?: boolean;
        processing?: boolean;
        completed?: boolean;
        failed?: boolean;
        status?: string;
        message?: string;
        error?: string;
    }> => {
        const response = await api.post(
            `/drafts/${draftId}/sections/${encodeURIComponent(sectionKey)}/generate`,
            body,
            { timeout: 30000 }
        );
        return response.data;
    },

    getSectionGenerationJob: async (
        draftId: string,
        sectionKey: string,
        jobId: string
    ): Promise<{
        success: boolean;
        version?: any;
        critic_review?: any;
        job_id?: string;
        queued?: boolean;
        processing?: boolean;
        completed?: boolean;
        failed?: boolean;
        status?: string;
        message?: string;
        error?: string;
    }> => {
        const response = await api.get(
            `/drafts/${draftId}/sections/${encodeURIComponent(sectionKey)}/jobs/${encodeURIComponent(jobId)}`
        );
        return response.data;
    },

    /**
     * Refine section with user feedback
     */
    refineSection: async (
        draftId: string,
        sectionKey: string,
        body: { user_feedback: string; rag_query?: string; auto_validate?: boolean; language?: string }
    ): Promise<{ success: boolean; version: any; critic_review?: any }> => {
        const response = await api.post(
            `/drafts/${draftId}/sections/${encodeURIComponent(sectionKey)}/refine`,
            body,
            { timeout: 300000 }
        ); // 5 min
        return response.data;
    },

    /**
     * Update section version content
     */
    updateSectionVersion: async (
        draftId: string,
        sectionKey: string,
        versionId: string,
        contentHtml: string
    ): Promise<any> => {
        const response = await api.put(
            `/drafts/${draftId}/sections/${encodeURIComponent(sectionKey)}/versions/${versionId}`,
            { content_html: contentHtml }
        );
        return response.data;
    },

    /**
     * Export assembled HTML to DOCX (download)
     */
    exportDocx: async (
        draftId: string,
        htmlContent: string,
        cssContent?: string
    ): Promise<Blob> => {
        const response = await api.post(
            `/drafts/${draftId}/export/docx`,
            { html_content: htmlContent, template_css: cssContent || undefined, css_content: cssContent || '' },
            { responseType: 'blob', timeout: 300000 }
        );
        const blob = response.data as Blob;
        if (!(blob instanceof Blob) || blob.size === 0) {
            throw new Error('Export returned no data');
        }
        if (blob.type === 'application/json' || (blob.size < 500 && blob.type.startsWith('text/'))) {
            const text = await blob.text();
            let msg = 'Export failed';
            try {
                const json = JSON.parse(text);
                msg = json.detail || json.message || json.error || msg;
            } catch {
                if (text.length < 300) msg = text;
            }
            throw new Error(msg);
        }
        return blob;
    },

    /**
     * Get template CSS for a draft (for section preview A4/format)
     */
    getTemplateCss: async (draftId: string): Promise<{ success: boolean; template_css?: string | null }> => {
        const response = await api.get<{ success: boolean; template_css?: string | null }>(`/drafts/${draftId}/template-css`);
        return response.data;
    },

    /**
     * Assemble final document (supports up to 500+ pages)
     * @param forceReassemble - Bypass cache (e.g. after user connects Google Drive)
     */
    assemble: async (draftId: string, sectionIds: string[], forceReassemble?: boolean): Promise<{ success: boolean; final_document: string; template_css?: string }> => {
        const response = await api.post<{ success: boolean; final_document: string; template_css?: string }>(
            `/drafts/${draftId}/assemble`,
            { section_ids: sectionIds, force_reassemble: !!forceReassemble },
            { timeout: 600000 }  // 10 min for large documents (500+ pages)
        );
        return response.data;
    }
};
