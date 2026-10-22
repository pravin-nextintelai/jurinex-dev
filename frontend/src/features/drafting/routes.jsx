import DraftingPage from './pages/DraftingPage';
import DraftsPage from './pages/DraftsPage';
import DraftEditorPage from './pages/DraftEditorPage';
import DraftSelectionPage from './pages/DraftSelection/DraftSelectionPageEnhanced';
import AllTemplatesPage from './pages/DraftSelection/AllTemplatesPage';
import DraftFormPage from './pages/DraftFormPage';
import ChatDraftPage from './pages/ChatDraftPage';
import GoogleDocsPage from './pages/GoogleDocsPage';
import MicrosoftWordPage from './pages/MicrosoftWordPage';
import { DraftingOiPage } from './components/ZohoOffice';

export default [
  { path: '/drafting', element: <DraftingPage />, auth: true },
  { path: '/draft-selection', element: <DraftSelectionPage />, auth: true },
  { path: '/draft-selection/templates', element: <AllTemplatesPage />, auth: true },
  { path: '/draft-form/:draftId', element: <DraftFormPage />, auth: true },
  { path: '/chat-draft', element: <ChatDraftPage />, auth: true, layout: 'full' },
  { path: '/draft/google-docs', element: <GoogleDocsPage />, auth: true },
  { path: '/draft/microsoft-word', element: <MicrosoftWordPage />, auth: true },
  { path: '/draft/zoho-office', element: <DraftingOiPage />, auth: true },
  { path: '/drafts', element: <DraftsPage />, auth: true },
  { path: '/draft/:draftId', element: <DraftEditorPage />, auth: true, layout: 'none' },
  { path: '/draft/new', element: <DraftEditorPage />, auth: true, layout: 'none' },
];
