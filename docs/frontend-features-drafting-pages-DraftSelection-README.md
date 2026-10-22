# Enhanced Draft Selection Page

This folder contains the enhanced Draft Selection page with template gallery and two-panel layout functionality.

## Structure

```
DraftSelectionEnhanced/
├── DraftSelectionPageEnhanced.jsx    # Main page component
├── components/
│   ├── TemplateGallery.jsx           # Horizontal scrollable template gallery
│   ├── TwoPanelLayout.jsx            # Two-panel layout container
│   ├── TemplatePreviewPanel.jsx      # Left panel: template preview (read-only)
│   ├── ChatAndFormPanel.jsx          # Right panel: chat + form fields
│   └── index.js                      # Component exports
├── styles/
│   └── enhanced-draft-selection.css  # Styles and transitions
└── README.md                         # This file
```

## Features

### 1. Three Platform Cards
- Google Docs
- Microsoft Word
- Zoho Office

### 2. Template Gallery
- Horizontal scrollable gallery
- Smooth scrolling with arrow navigation
- Template cards with hover effects
- Responsive design

### 3. Two-Panel Layout
When a template is clicked:
- **Left Panel**: Template preview (read-only, original formatting)
  - Shows template content with editable blanks highlighted
  - Supports TipTap JSON and HTML fallback formats
  - Fields are visually distinct with yellow background and dashed borders

- **Right Panel**: Chat + Form Fields
  - **Chat Section**: AI assistant interface
    - Message history
    - Input field with send button
    - Loading states
  - **Form Section**: Auto-generated form fields
    - Fields generated from template schema
    - Real-time updates
    - Field validation support

## Usage

```jsx
import DraftSelectionPageEnhanced from './pages/DraftSelectionEnhanced/DraftSelectionPageEnhanced';

// In your router
<Route path="/draft-selection-enhanced" element={<DraftSelectionPageEnhanced />} />
```

## Components

### TemplateGallery
Horizontal scrollable gallery displaying available templates.

**Props:**
- `templates` (Array): List of template objects
- `onTemplateClick` (Function): Callback when template is clicked
- `isLoading` (Boolean): Loading state

### TwoPanelLayout
Container for the two-panel view when a template is selected.

**Props:**
- `template` (Object): Selected template with schema and content
- `onClose` (Function): Callback to close the two-panel view
- `isLoading` (Boolean): Loading state

### TemplatePreviewPanel
Left panel showing template preview with editable blanks.

**Props:**
- `template` (Object): Template object with content and schema

### ChatAndFormPanel
Right panel with chat interface and form fields.

**Props:**
- `template` (Object): Template object with schema for form generation

## API Integration

The page uses `templateApi.js` service located at:
- `frontend/src/services/templateApi.js`

**Methods:**
- `getTemplates(category)`: Fetch all templates
- `getTemplateById(id)`: Fetch full template with schema and content
- `getTemplateSchema(id)`: Fetch only schema for form generation

## Styling

All styles are in `styles/enhanced-draft-selection.css`:
- Smooth transitions and animations
- Responsive breakpoints
- Hover effects
- Loading states
- Mobile-friendly layouts

## Responsive Design

- **Desktop (>1024px)**: Side-by-side panels
- **Tablet (768px-1024px)**: Stacked panels, full-width
- **Mobile (<768px)**: Vertical layout, optimized for small screens

## State Management

The page uses React hooks for state management:
- `useState` for local component state
- Template data fetched on mount
- Selected template state controls panel visibility

## Future Enhancements

- Connect chat to actual AI service
- Sync form field changes with template preview
- Save draft functionality
- Template search and filtering
- Category filtering in gallery
