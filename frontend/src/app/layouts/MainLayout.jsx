import React, { useEffect } from 'react';
import Sidebar from './Sidebar';
import MainContent from './MainContent';
import AppAssistant from '@/features/chat/components/AppAssistant';
import TokenExhaustionBanner from '@/features/billing/components/TokenExhaustionBanner';
import { useSidebar } from '@/shared/context/SidebarContext';
import { useAuth } from '@/shared/context';
import { useTokenQuota } from '@/features/billing/context/TokenQuotaContext';

const MainLayout = ({ children, useNoPadding = false }) => {
  const { isSidebarHidden, setIsSidebarHidden } = useSidebar();
  const { isAuthenticated, loading } = useAuth();
  const { quotaStatus, onTopupSuccess } = useTokenQuota();

  const pageTitle = children.type?.name?.replace('Page', '') || 'Drafting';
  const pageSubtitle = `This is the ${pageTitle} page.`;

  useEffect(() => {
    if (isAuthenticated && !loading) {
      setIsSidebarHidden(false);
    }
  }, [isAuthenticated, loading, setIsSidebarHidden]);

  const shouldShowSidebar = isAuthenticated && !loading;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Banner sits at the top of the column — pushes sidebar+content down naturally */}
      <TokenExhaustionBanner quotaStatus={quotaStatus} onTopupSuccess={onTopupSuccess} />

      {/* Sidebar + main content row fills the remaining height */}
      <div className="flex flex-row flex-1 min-h-0 overflow-hidden">
        {shouldShowSidebar && <Sidebar />}
        <MainContent pageTitle={pageTitle} pageSubtitle={pageSubtitle} noPadding={useNoPadding}>
          {children}
        </MainContent>
        {shouldShowSidebar && <AppAssistant />}
      </div>
    </div>
  );
};

export default MainLayout;
