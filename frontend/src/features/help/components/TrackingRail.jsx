import React from "react";
import { TRACKING_STEPS, STATUS_META } from "./constants";

export default function TrackingRail({ status }) {
  const currentIndex = TRACKING_STEPS.indexOf(status);

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
      {TRACKING_STEPS.map((step, index) => {
        const isActive = currentIndex >= index;
        const isCurrent = status === step;
        return (
          <React.Fragment key={step}>
            <div className="flex items-center gap-1.5 shrink-0">
              <div
                className={`h-2 w-2 rounded-full transition-all duration-300 ${
                  isActive ? STATUS_META[step].accent : "bg-slate-200"
                } ${isCurrent ? "ring-2 ring-slate-100 scale-110" : ""}`}
              />
              <span
                className={`text-[9px] font-bold uppercase tracking-wider ${
                  isActive ? "text-slate-700" : "text-slate-400"
                }`}
              >
                {STATUS_META[step].label}
              </span>
            </div>
            {index < TRACKING_STEPS.length - 1 && (
              <div
                className={`h-[1px] min-w-[8px] flex-1 ${
                  currentIndex > index ? "bg-slate-400" : "bg-slate-200"
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
