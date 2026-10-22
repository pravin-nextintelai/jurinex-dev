# Draft Components

This directory contains all components related to the document drafting functionality, supporting multiple platforms including Google Docs and Microsoft Word.

## Components Overview

### 1. DraftSelectionCard
A reusable card component for displaying draft platform options.

**Props:**
- `title` (string): Card title
- `description` (string): Card description
- `icon` (string): Icon type ('google', 'microsoft', 'template')
- `onClick` (function): Click handler
- `iconBgColor` (string): Background color for the icon
- `disabled` (boolean): Whether the card is disabled

**Usage:**
```jsx
import { DraftSelectionCard } from '../components/DraftComponents';

<DraftSelectionCard
  title="Google Docs"
  description="Create documents with Google Docs"
  icon="google"
  iconBgColor="#4285F4"
  onClick={() => navigate('/draft/google-docs')}
/>
```

### 2. GoogleDocsEditor
Complete Google Docs integration component with authentication and document management.

**Features:**
- Google OAuth authentication
- Create new Google Docs documents
- List all user documents
- Open documents in Google Docs
- Delete documents
- Real-time sync with Google Drive

**API Endpoints Used:**
- `GET /drafting/api/auth/status` - Check Google connection status
- `GET /drafting/api/drafts/list` - List all Google Docs drafts
- `POST /drafting/api/drafts/initiate` - Create new document
- `DELETE /drafting/api/drafts/:draftId` - Delete document

**Usage:**
```jsx
import { GoogleDocsEditor } from '../components/DraftComponents';

<GoogleDocsEditor />
```

### 3. MicrosoftWordEditor
Complete Microsoft Word integration component with Office 365 authentication.

**Features:**
- Microsoft OAuth authentication
- Create new Word documents
- List all user documents
- Open documents in Word Online
- Download documents as .docx
- Delete documents
- Template selection (blank/legal)

**API Endpoints Used:**
- `GET /drafting/api/microsoft/auth/status` - Check Microsoft connection status
- `GET /drafting/api/microsoft/auth/signin` - Get Microsoft auth URL
- `GET /drafting/api/microsoft/documents/list` - List all Word documents
- `POST /drafting/api/microsoft/documents/create` - Create new document
- `GET /drafting/api/microsoft/documents/:id/download` - Download document
- `DELETE /drafting/api/microsoft/documents/:id` - Delete document

**Usage:**
```jsx
import { MicrosoftWordEditor } from '../components/DraftComponents';

<MicrosoftWordEditor />
```

## Pages

### DraftSelectionPage
Main landing page that displays cards for all available drafting platforms.

**Route:** `/draft-selection`

**Features:**
- Displays 3 cards: Google Docs, Microsoft Word, Template Based
- Navigation to respective platform pages
- Responsive grid layout
- Coming soon indicators for unavailable platforms

### GoogleDocsPage
Wrapper page for GoogleDocsEditor component.

**Route:** `/draft/google-docs`

### MicrosoftWordPage
Wrapper page for MicrosoftWordEditor component.

**Route:** `/draft/microsoft-word`

## Routing Configuration

Add these routes to your `App.jsx`:

```jsx
import DraftSelectionPage from './pages/DraftSelectionPage';
import GoogleDocsPage from './pages/GoogleDocsPage';
import MicrosoftWordPage from './pages/MicrosoftWordPage';

// Inside Routes
<Route path="/draft-selection" element={<AuthChecker><MainLayout><DraftSelectionPage /></MainLayout></AuthChecker>} />
<Route path="/draft/google-docs" element={<AuthChecker><MainLayout><GoogleDocsPage /></MainLayout></AuthChecker>} />
<Route path="/draft/microsoft-word" element={<AuthChecker><MainLayout><MicrosoftWordPage /></MainLayout></AuthChecker>} />
```

## Environment Variables

Make sure to set the following in your `.env` file:

```env
VITE_API_BASE_URL=http://localhost:5000
```

## Backend Requirements

### Google Docs Integration
The backend should implement these endpoints:
- Authentication flow with Google OAuth
- Document CRUD operations
- Integration with Google Drive API

### Microsoft Word Integration
The backend should implement these endpoints:
- Authentication flow with Microsoft OAuth
- Document CRUD operations
- Integration with Microsoft Graph API
- File download functionality

## Authentication Flow

### Google Docs
1. User clicks "Sign in with Google"
2. Redirected to Google OAuth consent screen
3. After authorization, user is redirected back with auth code
4. Backend exchanges code for access token
5. Token stored for API calls to Google Drive

### Microsoft Word
1. User clicks "Sign in with Microsoft"
2. Redirected to Microsoft OAuth consent screen
3. After authorization, user is redirected back with auth code
4. Backend exchanges code for access token
5. Token stored for API calls to Microsoft Graph

## State Management

All components use local state with React hooks:
- `useState` for component state
- `useEffect` for lifecycle events
- `useNavigate` for routing

## Error Handling

All API calls include comprehensive error handling:
- Network errors
- Authentication errors
- Permission errors
- Toast notifications for user feedback

## Styling

Components use Material-UI (MUI) for consistent design:
- Responsive grid layouts
- Custom styled components
- Theme-aware colors
- Smooth animations and transitions

## Future Enhancements

- Template-based drafting
- Real-time collaborative editing
- Version history
- Comments and suggestions
- Export to PDF
- Advanced formatting options
- Document templates library
- AI-powered content suggestions


