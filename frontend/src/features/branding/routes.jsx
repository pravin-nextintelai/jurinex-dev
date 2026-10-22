import BrandingProfilesPage from './pages/BrandingProfilesPage';
import BrandingProfileEditorPage from './pages/BrandingProfileEditorPage';

export default [
  { path: '/branding', element: <BrandingProfilesPage />, auth: true },
  { path: '/branding/:id', element: <BrandingProfileEditorPage />, auth: true },
];
