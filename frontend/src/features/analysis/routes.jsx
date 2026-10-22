import AnalysisPage from './pages/AnalysisPage';
import ToolsPage from './pages/ToolsPage';

export default [
  { path: '/analysis', element: <AnalysisPage />, auth: true },
  { path: '/analysis/:fileId/:sessionId', element: <AnalysisPage />, auth: true },
  { path: '/analysis/session/:sessionId', element: <AnalysisPage />, auth: true },
  { path: '/tools', element: <ToolsPage />, auth: true },
  { path: '/tools/:fileId/:sessionId', element: <ToolsPage />, auth: true },
];
