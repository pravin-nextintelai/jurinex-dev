import LawFirmRegistrationPage from './pages/LawFirmRegistrationPage';
import LoginPage from './pages/LoginPage';
import SetPasswordPage from './pages/SetPasswordPage';

export default [
  { path: '/register', element: <LawFirmRegistrationPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/set-password', element: <SetPasswordPage /> },
];
