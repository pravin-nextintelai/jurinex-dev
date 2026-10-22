import React from 'react';
import { ArrowRight } from 'lucide-react';

const DashboardInsights = ({ insights }) => {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-5">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
          Quick Actions
        </h2>
        <div className="flex-1 h-px bg-gray-100" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {insights.map((insight, index) => (
          <div
            key={index}
            className="group bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5 cursor-pointer"
            style={{ borderLeft: `3px solid ${insight.color}` }}
            onClick={insight.onClick}
          >
            <div className="flex items-start gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0"
                style={{ backgroundColor: insight.color }}
              >
                {insight.icon}
              </div>
              <h3 className="font-semibold text-gray-900 text-sm leading-snug mt-1 flex-1">
                {insight.title}
              </h3>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed mb-4 line-clamp-2">
              {insight.description}
            </p>
            <div
              className="flex items-center gap-1.5 text-xs font-semibold"
              style={{ color: insight.color }}
            >
              <span>{insight.action}</span>
              <ArrowRight
                size={13}
                className="transition-transform duration-200 group-hover:translate-x-1"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DashboardInsights;
