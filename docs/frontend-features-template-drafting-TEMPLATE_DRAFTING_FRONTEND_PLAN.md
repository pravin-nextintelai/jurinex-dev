# Template Drafting Frontend Implementation Plan

## Overview

This document outlines the complete frontend architecture for the Template Drafting module
of the Jurinex Legal AI platform. The module enables users to select legal templates,
fill form fields, receive AI-assisted content suggestions, and export finalized documents.

---

## 1. Folder Structure

```
/src/template_drafting_component/
│
├── index.tsx                           # Module entry point & exports
├── routes.ts                           # Route configuration
├── README.md                           # Component documentation
│
├── pages/
│   ├── TemplateListingPage.tsx         # Template selection (cards)
│   ├── TemplatePreviewPage.tsx         # Full template preview modal
│   └── DraftEditorPage.tsx             # Main split-view editor
│
├── components/
│   ├── layout/
│   │   ├── SplitViewLayout.tsx         # Left/right panel container
│   │   ├── LeftPanel.tsx               # Template preview panel
│   │   └── RightPanel.tsx              # Form/Chat panel container
│   │
│   ├── template/
│   │   ├── TemplateCard.tsx            # Card for template listing
│   │   ├── TemplateGrid.tsx            # Grid container for cards
│   │   └── TemplateCategoryFilter.tsx  # Category filter dropdown
│   │
│   ├── preview/
│   │   ├── A4PageRenderer.tsx          # Single A4 page renderer
│   │   ├── A4PageContainer.tsx         # Virtualized page list
│   │   ├── PageScrollIndicator.tsx     # Current page indicator
│   │   └── BlockRenderer.tsx           # Individual block renderer
│   │
│   ├── form/
│   │   ├── DynamicForm.tsx             # Schema-driven form generator
│   │   ├── FormField.tsx               # Individual field component
│   │   ├── FormFieldTypes.tsx          # Type-specific field renderers
│   │   └── FormValidation.tsx          # Validation utilities
│   │
│   ├── chat/
│   │   ├── ChatPanel.tsx               # Main chat container
│   │   ├── ChatMessages.tsx            # Message list
│   │   ├── ChatInput.tsx               # Input with file upload
│   │   ├── AiSuggestionCard.tsx        # Insert/Undo card
│   │   ├── EvidenceSelector.tsx        # Plus button file selector
│   │   └── EvidenceFileItem.tsx        # Individual file display
│   │
│   ├── actions/
│   │   ├── ActionToolbar.tsx           # Top-left action buttons
│   │   ├── DownloadPdfButton.tsx       # PDF download
│   │   ├── PrintButton.tsx             # Print functionality
│   │   └── SendToDraftingButton.tsx    # Export to services
│   │
│   └── common/
│       ├── LoadingSpinner.tsx          # Loading indicator
│       ├── ErrorBoundary.tsx           # React error boundary
│       ├── EmptyState.tsx              # Empty state component
│       └── StatusBadge.tsx             # Active/Inactive badge
│
├── hooks/
│   ├── useTemplates.ts                 # Template fetching & caching
│   ├── useDraft.ts                     # Draft state management
│   ├── useVersioning.ts                # Undo/redo operations
│   ├── useAiSuggestions.ts             # AI suggestion management
│   ├── useEvidence.ts                  # Evidence file management
│   ├── useFormSync.ts                  # Form <-> Preview sync
│   └── useVirtualScroll.ts             # Page virtualization
│
├── services/
│   ├── api.ts                          # API client & endpoints
│   ├── templateApi.ts                  # Template-specific calls
│   ├── draftApi.ts                     # Draft CRUD operations
│   ├── aiApi.ts                        # AI suggestion calls
│   ├── evidenceApi.ts                  # Evidence upload/list
│   └── exportApi.ts                    # Export/finalize calls
│
├── store/
│   ├── draftStore.ts                   # Zustand store for drafts
│   ├── templateStore.ts                # Zustand store for templates
│   └── uiStore.ts                      # UI state (active panel, etc.)
│
├── styles/
│   ├── a4.css                          # A4 page styling
│   ├── preview.css                     # Preview panel styles
│   ├── form.css                        # Form panel styles
│   ├── chat.css                        # Chat panel styles
│   └── variables.css                   # CSS custom properties
│
├── utils/
│   ├── logger.ts                       # Structured logging
│   ├── blockHelpers.ts                 # Block manipulation utilities
│   ├── pageGrouping.ts                 # Group blocks by pageNo
│   ├── debounce.ts                     # Debounce utility
│   ├── validation.ts                   # Field validation helpers
│   └── domAnchors.ts                   # Stable DOM ID generation
│
└── types/
    ├── template.types.ts               # Template interfaces
    ├── draft.types.ts                  # Draft interfaces
    ├── block.types.ts                  # Block interfaces
    ├── ai.types.ts                     # AI suggestion interfaces
    └── api.types.ts                    # API response interfaces
```

---

## 2. State Management Strategy

### Primary State Store: Zustand

Zustand chosen for:
- Minimal boilerplate
- No context drilling
- Selective subscriptions (prevent re-renders)
- Easy persistence
- TypeScript support

### Store Structure

```typescript
// store/draftStore.ts
interface DraftState {
  // Core data
  templateMeta: TemplateMeta | null;
  templatePages: TemplatePage[];
  activePage: number;
  
  // Draft data
  draftId: string | null;
  draftTitle: string;
  draftStatus: 'draft' | 'exported' | 'finalized' | 'deleted';
  draftBlocks: DraftBlock[];
  currentVersionId: string | null;
  
  // Form state
  formData: Record<string, any>;
  formDirty: boolean;
  
  // AI state
  chatHistory: ChatMessage[];
  pendingSuggestions: AiSuggestion[];
  
  // Undo/redo
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  canUndo: boolean;
  canRedo: boolean;
  
  // Evidence
  evidenceFiles: EvidenceFile[];
  selectedEvidenceIds: string[];
  
  // UI state
  isLoading: boolean;
  error: AppError | null;
  activeRightPanel: 'form' | 'chat';
  
  // Actions
  loadDraft: (draftId: string) => Promise<void>;
  updateField: (key: string, value: any) => void;
  saveFields: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  requestAiSuggestion: (targetBlock: string, instruction: string) => Promise<void>;
  insertAiSuggestion: (suggestionId: string) => Promise<void>;
  rejectAiSuggestion: (suggestionId: string) => Promise<void>;
}
```

---

## 3. Rendering Strategy for 50-100 Pages

### Page Virtualization

Only render pages within viewport + buffer using react-virtuoso:

```tsx
import { Virtuoso } from 'react-virtuoso';

const A4PageContainer = ({ pages }: { pages: TemplatePage[] }) => {
  return (
    <Virtuoso
      totalCount={pages.length}
      itemContent={(index) => (
        <A4PageRenderer 
          page={pages[index]} 
          pageNumber={index + 1}
        />
      )}
      overscan={2}
    />
  );
};
```

### DOM Stability

Stable IDs for each block:
```tsx
const getBlockElementId = (blockKey: string, pageNo: number) => 
  `draft-block-${pageNo}-${blockKey}`;
```

### Incremental DOM Updates

When form field changes:
1. Find block element by ID
2. Update innerHTML directly
3. No React re-render required

---

## 4. Undo/Redo Model

### Server-Authoritative Versioning

```typescript
const handleUndo = async () => {
  if (!canUndo) return;
  
  // Call server
  const result = await draftApi.undo(draftId);
  
  // Refresh draft state
  await loadDraft(draftId);
  
  // Update local stacks
  redoStack.push({ versionId: currentVersionId });
  undoStack.pop();
};
```

### Stack Limits
- MAX_UNDO_STACK = 50 entries
- Clear redo stack on new action

---

## 5. Error Handling Strategy

### Structured Logging
```typescript
const Logger = {
  info: (action: string, ctx?: object) => 
    console.log(`[TEMPLATE_DRAFTING_UI][INFO] ${action}`, ctx),
  warn: (action: string, ctx?: object) => 
    console.warn(`[TEMPLATE_DRAFTING_UI][WARN] ${action}`, ctx),
  error: (action: string, ctx?: object) => 
    console.error(`[TEMPLATE_DRAFTING_UI][ERROR] ${action}`, ctx)
};
```

### Error Categories
- API_FAILURE
- RENDER_ERROR
- MISSING_BLOCK
- BACKEND_MISMATCH
- PERFORMANCE_THRESHOLD

---

## 6. Performance Safeguards

1. **Form Debouncing**: 50ms for DOM, 2000ms for API
2. **Page Virtualization**: Only render visible pages + 2 buffer
3. **Request Deduplication**: Prevent concurrent identical requests
4. **Progressive Loading**: Critical data first, secondary data async

---

## 7. API Integration Points

Base URL: `{VITE_API_BASE_URL}/api/drafting-templates/api`

| Endpoint | Purpose |
|----------|---------|
| GET /templates | List templates |
| GET /templates/:id | Get template with content |
| POST /drafts | Create draft |
| GET /drafts/:id | Get draft with blocks |
| PUT /drafts/:id/fields | Update form fields |
| POST /drafts/:id/undo | Undo action |
| POST /drafts/:id/redo | Redo action |
| POST /drafts/:id/ai/suggest | Request AI suggestion |
| POST /drafts/:id/ai/:sid/insert | Insert suggestion |
| POST /drafts/:id/evidence/upload | Upload evidence |
| POST /drafts/:id/export | Export DOCX |

---

## 8. Theming Approach

### Jurinex Design System
- Primary: #1A365D (Professional Blue)
- Secondary: #B7791F (Gold Accent)
- Font: Inter (UI), Times New Roman (Documents)
- Dark mode compatible
- Print-safe CSS

### A4 Page Styling
- Width: 210mm, Height: 297mm
- Padding: 25.4mm
- Serif font, 12pt, 1.6 line-height

---

## Backend Changes Required: NONE

---

*Document created: January 24, 2026*
