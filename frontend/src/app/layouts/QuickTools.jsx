import React from 'react';
import { Link } from 'react-router-dom';
import { MagnifyingGlassCircleIcon, DocumentDuplicateIcon, CalendarIcon, CreditCardIcon } from '@heroicons/react/24/outline';

const QuickTools = ({ isCollapsed }) => {
  return (
    <div>
      {!isCollapsed && (
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 mb-2">
          Quick Tools
        </div>
      )}
      <Link
        to="/chats"
        className={`flex items-center px-2 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 hover:text-blue-600 group ${isCollapsed ? 'justify-center' : ''}`}
        title={isCollapsed ? 'Case Search' : undefined}
      >
        <MagnifyingGlassCircleIcon className={`h-6 w-6 text-gray-500 group-hover:text-blue-600 ${isCollapsed ? '' : 'mr-3'}`} />
        {!isCollapsed && <span>Case Search</span>}
      </Link>
      <Link
        to="/calendar"
        className={`flex items-center px-2 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 hover:text-blue-600 group ${isCollapsed ? 'justify-center' : ''}`}
        title={isCollapsed ? 'Court Calendar' : undefined}
      >
        <CalendarIcon className={`h-6 w-6 text-gray-500 group-hover:text-blue-600 ${isCollapsed ? '' : 'mr-3'}`} />
        {!isCollapsed && <span>Court Calendar</span>}
      </Link>
    </div>
  );
};

export default QuickTools;