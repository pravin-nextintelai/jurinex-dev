import DashboardPage from './pages/DashboardPage';
import CaseDetailView from './components/CaseDetailView';

export default [
  { path: '/dashboard', element: <DashboardPage />, auth: true },
  { path: '/cases/:id', element: <CaseDetailView />, auth: true },
];
