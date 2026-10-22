import React, { createContext, useState, useContext } from 'react';

export const SidebarContext = createContext(null);

export const SidebarProvider = ({ children }) => {
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [forceSidebarCollapsed, setForceSidebarCollapsed] = useState(false);

  return (
    <SidebarContext.Provider value={{ isSidebarHidden, setIsSidebarHidden, isSidebarCollapsed, setIsSidebarCollapsed, forceSidebarCollapsed, setForceSidebarCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
};

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
};