import CaseStoragePage from './pages/CaseStoragePage';
import FolderDetailPage from './pages/FolderDetailPage';
import GoogleDriveCallback from './pages/GoogleDriveCallback';

export default [
  { path: '/case-storage', element: <CaseStoragePage />, auth: true },
  { path: '/documents/:folderName', element: <FolderDetailPage />, auth: true },
  { path: '/auth/google/drive/callback', element: <GoogleDriveCallback /> },
];
