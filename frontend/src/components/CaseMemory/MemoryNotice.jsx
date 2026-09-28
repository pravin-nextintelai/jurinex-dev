import React from 'react';
import { AlertTriangle, CircleCheck, Info } from 'lucide-react';

const TONES = {
  info: { Icon: Info, className: 'bg-slate-50 border-slate-200 text-slate-600' },
  warning: { Icon: AlertTriangle, className: 'bg-amber-50 border-amber-200 text-amber-800' },
  error: { Icon: AlertTriangle, className: 'bg-red-50 border-red-200 text-red-700' },
  success: { Icon: CircleCheck, className: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
};

/** An inline message, optionally with the list of reasons the server gave. */
const MemoryNotice = ({ tone = 'info', children, problems = [], action = null }) => {
  const { Icon, className } = TONES[tone] || TONES.info;
  return (
    <div
      className={`flex gap-2 rounded-lg border px-3 py-2 text-xs ${className}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div>{children}</div>
        {problems.length > 0 && (
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            {problems.map((problem, index) => (
              <li key={`${problem.code || 'problem'}-${index}`}>{problem.message}</li>
            ))}
          </ul>
        )}
        {action && <div className="mt-1.5">{action}</div>}
      </div>
    </div>
  );
};

export default MemoryNotice;
