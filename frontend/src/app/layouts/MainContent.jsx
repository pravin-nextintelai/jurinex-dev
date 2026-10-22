import React from 'react';

const MainContent = ({ children, noPadding = false }) => {
  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      <div className={`flex-1 flex flex-col overflow-y-auto ${noPadding ? 'bg-white' : 'bg-gray-50 p-8'}`}>
        {children}
      </div>
    </div>
  );
};

export default MainContent;
