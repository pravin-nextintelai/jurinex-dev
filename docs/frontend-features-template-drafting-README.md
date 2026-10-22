# Template Drafting Component

A plug-and-play React module for legal document template drafting in the Jurinex platform.

## Features

- 📋 **Template Listing** - Browse and filter templates by category
- 👁️ **A4 Preview** - Full page-by-page preview before drafting
- ✏️ **Split View Editor** - Left preview + right form/chat panels
- 🔄 **Real-time Sync** - Form changes instantly update preview
- ↩️ **Undo/Redo** - Server-backed version history
- 🤖 **AI Assistant** - State-aware content suggestions
- 📎 **Evidence Upload** - Add context for AI generation
- 📄 **Export** - PDF (print) and DOCX download

## Folder Structure

```
template_drafting_component/
├── components/          # React components
│   ├── common/         # Shared UI components
│   ├── template/       # Template listing components
│   ├── preview/        # A4 page rendering
│   ├── form/           # Dynamic form generation
│   ├── chat/           # AI chat panel
│   ├── actions/        # Toolbar buttons
│   └── layout/         # Split view layout
├── pages/              # Route pages
├── store/              # Zustand state stores
├── services/           # API service modules
├── styles/             # CSS stylesheets
├── types/              # TypeScript definitions
├── utils/              # Utility functions
├── routes.ts           # Route configuration
└── index.tsx           # Module entry point
```

## Integration

### 1. Add Routes to App.jsx

```jsx
import { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { 
  TemplateListingPage, 
  TemplatePreviewPage, 
  DraftEditorPage,
  DraftResumePage
} from './template_drafting_component';

// In your routes:
<Route path="/template-drafting" element={
  <Suspense fallback={<div>Loading...</div>}>
    <TemplateListingPage />
  </Suspense>
} />
<Route path="/template-drafting/templates/:templateId/preview" element={
  <Suspense fallback={<div>Loading...</div>}>
    <TemplatePreviewPage />
  </Suspense>
} />
<Route path="/template-drafting/drafts" element={
  <Suspense fallback={<div>Loading...</div>}>
    <DraftResumePage />
  </Suspense>
} />
<Route path="/template-drafting/drafts/:draftId/edit" element={
  <Suspense fallback={<div>Loading...</div>}>
    <DraftEditorPage />
  </Suspense>
} />
```

### 2. Add Sidebar Entry

In your sidebar component, add:

```jsx
<Link to="/template-drafting">
  📝 Template Drafting
</Link>
```

### 3. Install Dependencies

Ensure these packages are installed:

```bash
npm install zustand axios
```

## API Configuration

The component uses the gateway URL from `VITE_API_BASE_URL` environment variable:

```
# .env
VITE_API_BASE_URL=http://localhost:5006
```

API calls go through: `{VITE_API_BASE_URL}/api/drafting-templates/api/*`

## Theming

The component uses CSS custom properties for theming. Override in your global CSS:

```css
:root {
  --jx-primary: #1A365D;
  --jx-secondary: #B7791F;
  /* ... other variables */
}
```

Full variable list in `styles/variables.css`.

## Performance

- **Page virtualization** - Only renders visible pages
- **DOM-level updates** - Form changes update DOM directly, avoiding full re-renders
- **Debounced saves** - 2-second debounce for API field updates
- **Lazy loading** - Pages are code-split for faster initial load

## Logging

All logs are prefixed with `[TEMPLATE_DRAFTING_UI]` for easy filtering:

```
[TEMPLATE_DRAFTING_UI][INFO] LOAD_DRAFT_SUCCESS { draftId: "...", pageCount: 4 }
[TEMPLATE_DRAFTING_UI][ERROR] API_RESPONSE_ERROR { url: "...", status: 500 }
```

## Backend Requirements

This component requires the `drafting-template-service` backend running on port 5010, proxied through the gateway at `/api/drafting-templates/*`.

No backend changes are required for this implementation.
