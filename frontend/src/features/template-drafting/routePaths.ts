/**
 * Template Drafting Component - Routes Configuration
 *
 * API usage (see API_POSTMAN.md + API_DOCUMENTATION.md):
 * - Admin templates: agent-draft-service GET /api/templates (templateWizardApi.fetchTemplates)
 * - User templates: Template Analyzer GET /api/template-analysis/templates (customTemplateApi.getUserTemplates)
 * - Template fields/sections: agent-draft-service GET /api/templates/:id (draftFormApi.getTemplate) for both admin and user
 * - Create draft: agent-draft-service POST /api/drafts (draftFormApi.createDraft)
 * - Get draft + merged field values (autopopulation): agent-draft-service GET /api/drafts/:id (draftFormApi.getDraft)
 * - Section prompts: agent-draft-service GET/POST /api/drafts/:id/sections/prompts (draftApi.getSectionPrompts, saveSectionPrompt)
 * - Section generate/refine: agent-draft-service POST /api/drafts/:id/sections/:key/generate|refine (sectionApi)
 */

// Direct exports of page components (not lazy loaded)
// App.jsx provides the Suspense wrapper
export { TemplateListingPage } from './pages/TemplateListingPage';
export { TemplatePreviewPage } from './pages/TemplatePreviewPage';
export { DraftEditorPage } from './pages/DraftEditorPage';
export { DraftResumePage } from './pages/DraftResumePage';
export { SectionDraftingPage } from './pages/SectionDraftingPage';
export { AssembledPreviewPage } from './pages/AssembledPreviewPage';

export const TEMPLATE_DRAFTING_ROUTES = {
    BASE: '/template-drafting',
    LISTING: '/template-drafting',
    TEMPLATE_PREVIEW: '/template-drafting/templates/:templateId/preview',
    DRAFTS: '/template-drafting/drafts',
    EDITOR: '/template-drafting/drafts/:draftId/edit',
    SECTION_DRAFTING: '/template-drafting/drafts/:draftId/sections',
    ASSEMBLED_PREVIEW: '/template-drafting/drafts/:draftId/preview'
};

export const templateDraftingRouteConfig = [
    {
        path: TEMPLATE_DRAFTING_ROUTES.LISTING,
        Component: 'TemplateListingPage',
        exact: true
    },
    {
        path: TEMPLATE_DRAFTING_ROUTES.TEMPLATE_PREVIEW,
        Component: 'TemplatePreviewPage'
    },
    {
        path: TEMPLATE_DRAFTING_ROUTES.DRAFTS,
        Component: 'DraftResumePage'
    },
    {
        path: TEMPLATE_DRAFTING_ROUTES.SECTION_DRAFTING,
        Component: 'SectionDraftingPage'
    },
    {
        path: TEMPLATE_DRAFTING_ROUTES.EDITOR,
        Component: 'DraftEditorPage'
    }
];
