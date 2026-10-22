import DocumentUploadPage from './pages/DocumentUploadPage';
import EvidenceMatrixPage from './pages/EvidenceMatrixPage';
import GroundSummaryPage from './pages/GroundSummaryPage';

export default [
  { path: '/documents', element: <DocumentUploadPage />, auth: true },
  { path: '/evidence-matrix', element: <EvidenceMatrixPage />, auth: true },
  { path: '/ground-summary', element: <GroundSummaryPage />, auth: true },
];
