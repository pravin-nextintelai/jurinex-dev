import React from 'react';
import { buildPlanLimitSections, toDisplayString } from '../utils/planDisplayConfig';

/**
 * Shows Chat Model and Summarization limits from subscription_plans on plan cards.
 * Only fields with a non-null value are rendered.
 */
const PlanLimitsDisplay = ({
  plan,
  planLimitSections,
  textClassName = 'font-dmSans text-xs leading-snug text-teal-700',
  sectionTitleClassName = 'font-dmSans text-[10px] font-semibold uppercase tracking-wide text-[#0F766E] mt-3 mb-1',
}) => {
  const source = plan?.backendPlan || plan;
  const { sections } =
    planLimitSections || buildPlanLimitSections(source);

  const hasContent = sections.some((s) => s.items?.length);

  if (!hasContent) {
    return (
      <p className={`italic ${textClassName}`}>
        No chat or summarization limits configured on this plan yet.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {sections.map((section) => (
        <div key={section.title}>
          <p className={sectionTitleClassName}>{toDisplayString(section.title)}</p>
          <ul className="space-y-1.5">
            {section.items.map((item) => (
              <li key={`${section.title}-${item.label}`} className="flex items-start justify-between gap-2">
                <span className={`${textClassName} text-juri-muted`}>{toDisplayString(item.label)}</span>
                <span className={`${textClassName} font-semibold text-teal-800 shrink-0`}>
                  {toDisplayString(item.value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <p className="mt-3 font-dmSans text-[10px] leading-snug text-juri-muted italic">
        Limits shown apply only to this plan. Unset columns use global admin config at runtime.
      </p>
    </div>
  );
};

export default PlanLimitsDisplay;
