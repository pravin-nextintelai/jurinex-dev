import React from 'react';
import { useTemplateBuilderStore } from './templateBuilderStore';

const BRAND = '#21C1B6';

const STEP_ITEMS = [
  { step: 1, label: 'Document Type' },
  { step: 2, label: 'Context' },
  { step: 3, label: 'Jurisdiction' },
  { step: 4, label: 'Structure' },
  { step: 5, label: 'Clauses & Notes' },
  { step: 6, label: 'Review & Generate' },
];

function compact(value: string) {
  return value.length > 34 ? `${value.slice(0, 34)}...` : value;
}

export const RequirementsSidebar: React.FC = () => {
  const { currentStep, phase, requirements } = useTemplateBuilderStore();

  const progressStep = phase === 'preview' || phase === 'saved' || phase === 'saving'
    ? 6
    : phase === 'generating'
      ? 6
      : currentStep;

  const requirementRows = [
    ['Document Type', requirements.subjectLabel || requirements.subject],
    ['Generation Mode', requirements.referenceMode === 'with-document' ? 'With document' : 'Without document'],
    ['Reference Documents', requirements.referenceDocumentNames.join(', ')],
    ['Property Type', requirements.propertyType],
    ['Party Type', requirements.partyType],
    ['Value Range', requirements.valueRange],
    ['Court', requirements.court],
    ['Dispute Nature', requirements.disputeNature],
    ['Opposing Party', requirements.opposingParty],
    ['Jurisdiction', requirements.jurisdiction],
    ['Language', requirements.language],
    ['Detail Level', requirements.detailLevel],
    ['Emphasis', requirements.emphasis || requirements.urgency],
    ['Schedules', requirements.schedulePreference],
    ['Special Clauses', requirements.specialClauses.join(', ')],
    ['Custom Notes', requirements.freeText],
  ].filter(([, value]) => Boolean(value));

  return (
    <div className="flex flex-col" style={{ minHeight: '100vh' }}>
      <div className="px-3 py-4 space-y-1">
        {STEP_ITEMS.map((item) => {
          const done = item.step < progressStep;
          const active = item.step === progressStep;
          return (
            <div key={item.step} className={`flex items-center gap-2.5 px-2 py-2 rounded-lg ${active ? 'bg-teal-50' : ''}`}>
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={done || active ? { backgroundColor: BRAND, color: '#fff' } : { backgroundColor: '#F3F4F6', color: '#9CA3AF' }}
              >
                {done ? '✓' : item.step}
              </div>
              <span className={`text-xs ${active ? 'text-teal-700 font-semibold' : done ? 'text-gray-700' : 'text-gray-400'}`}>
                {item.label}
              </span>
            </div>
          );
        })}
      </div>

      {requirementRows.length > 0 && (
        <div className="mx-3 mb-4 p-3 bg-gray-50 rounded-xl border border-gray-100 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Requirements</p>
          {requirementRows.map(([label, value]) => (
            <div key={label} className="text-xs">
              <p className="text-gray-400">{label}</p>
              <p className="font-medium text-gray-700">{compact(String(value))}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto px-4 py-3 border-t border-gray-100">
        <p className="text-xs text-gray-400 text-center">Preview uses placeholders, not client facts</p>
      </div>
    </div>
  );
};
