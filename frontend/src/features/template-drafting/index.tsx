/**
 * Template Drafting Component
 * 
 * A plug-and-play module for legal document template drafting.
 * 
 * Features:
 * - Template listing with category filter
 * - Full A4 preview before draft creation
 * - Split-view editor with form and AI chat panels
 * - Real-time preview updates
 * - Undo/redo support
 * - AI-assisted content generation
 * - Evidence file upload
 * - PDF/DOCX export
 * 
 * Usage:
 * Import routes and add to your router:
 * 
 * ```tsx
 * import { templateDraftingRouteConfig } from './template_drafting_component';
 * 
 * // In your router config:
 * {templateDraftingRouteConfig.map(route => (
 *   <Route key={route.path} path={route.path} element={<route.element />} />
 * ))}
 * ```
 * 
 * Or import individual pages:
 * 
 * ```tsx
 * import { TemplateListingPage, DraftEditorPage } from './template_drafting_component';
 * ```
 */

// Routes and Pages
export {
    TEMPLATE_DRAFTING_ROUTES,
    templateDraftingRouteConfig,
    TemplateListingPage,
    TemplatePreviewPage,
    DraftEditorPage,
    SectionDraftingPage,
    AssembledPreviewPage
} from './routePaths';

// Components (for custom integrations)
export * from './components';

// Stores (for external state access)
export { useTemplateStore, useFilteredTemplates, useTemplateCategories } from './store/templateStore';
export { useDraftStore } from './store/draftStore';
export { useUiStore } from './store/uiStore';

// Services (for custom API calls)
export * from './services';

// Types
export * from './types';

// User Custom Template (create your own templates)
export * from './user_custom_template';

// Utilities
export * from './utils';

// Styles entry point
import './styles/index.css';
