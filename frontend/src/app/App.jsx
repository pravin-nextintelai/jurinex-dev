import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, useLocation } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import StorageFullModal from '@/features/billing/components/StorageFullModal';
import { TokenQuotaProvider } from '@/features/billing/context/TokenQuotaContext';
import { SidebarProvider } from '@/shared/context/SidebarContext';
import { FileManagerProvider } from '@/shared/context/FileManagerContext';
import { routeElements } from './router';

/**
 * Scrolls the window to the top whenever the route path changes, so a page
 * opened from a footer link starts at its heading rather than wherever the
 * previous page was scrolled. Skips navigations that carry a target section
 * (state.scrollTo) or a hash: those pages scroll themselves.
 */
function ScrollToTop() {
  const { pathname, state, hash } = useLocation();

  useEffect(() => {
    if (state?.scrollTo || hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// Pages are registered per feature in features/<name>/routes.jsx (see ./router.jsx).
function App() {
  return (
    <Router>
      <ScrollToTop />
      <TokenQuotaProvider>
        <ToastContainer />
        <StorageFullModal />
        <SidebarProvider>
          <FileManagerProvider>
            <Routes>{routeElements}</Routes>
          </FileManagerProvider>
        </SidebarProvider>
      </TokenQuotaProvider>
    </Router>
  );
}

export default App;
