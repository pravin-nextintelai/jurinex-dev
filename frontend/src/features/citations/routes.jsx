import CitationReportPage from './pages/CitationReportPage';
import CitationTestingPage from './pages/CitationTestingPage';
import CitationResearchPage from './pages/CitationResearchPage';
import EnterpriseAnalyticsPage from './pages/EnterpriseAnalyticsPage';

export default [
  { path: '/citation', element: <CitationReportPage />, auth: true },
  { path: '/citation/reports', element: <CitationReportPage />, auth: true },
  { path: '/citation/reports/:reportId', element: <CitationReportPage />, auth: true },
  { path: '/citation-testing', element: <CitationTestingPage />, auth: true },
  { path: '/citation-research', element: <CitationResearchPage />, auth: true, layout: 'full' },
  { path: '/enterprise-analytics', element: <EnterpriseAnalyticsPage />, auth: true },
];
