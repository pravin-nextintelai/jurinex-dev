import {
  TemplateListingPage,
  TemplatePreviewPage,
  DraftEditorPage,
  SectionDraftingPage,
  AssembledPreviewPage,
} from '.';

export default [
  { path: '/template-drafting', element: <TemplateListingPage />, auth: true },
  { path: '/template-drafting/preview/:templateId', element: <TemplatePreviewPage />, auth: true },
  { path: '/template-drafting/drafts/:draftId/sections', element: <SectionDraftingPage />, auth: true },
  { path: '/template-drafting/drafts/:draftId/preview', element: <AssembledPreviewPage />, auth: true },
  { path: '/template-drafting/edit/:draftId', element: <DraftEditorPage />, auth: true },
];
