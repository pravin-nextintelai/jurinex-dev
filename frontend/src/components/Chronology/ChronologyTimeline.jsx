import React from 'react';
import { datesFromStartToLast } from './chronologyOrder';
import { eventCite, phaseLabel, roleLabel, showDaySummary } from './chronologyDisplay';

const PHASE_TONE = {
  pre_litigation: 'bg-sky-50 text-sky-800 border-sky-100',
  correspondence: 'bg-slate-50 text-slate-800 border-slate-200',
  institution: 'bg-violet-50 text-violet-800 border-violet-100',
  pending: 'bg-cyan-50 text-cyan-800 border-cyan-100',
  pleadings: 'bg-amber-50 text-amber-800 border-amber-100',
  interim: 'bg-teal-50 text-teal-800 border-teal-100',
  evidence: 'bg-orange-50 text-orange-800 border-orange-100',
  listing: 'bg-stone-50 text-stone-700 border-stone-200',
  hearing: 'bg-rose-50 text-rose-800 border-rose-100',
  arguments: 'bg-rose-50 text-rose-800 border-rose-100',
  order: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  judgment: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  appeal: 'bg-indigo-50 text-indigo-800 border-indigo-100',
  execution: 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-100',
  other: 'bg-gray-50 text-gray-700 border-gray-200',
};

const ROLE_TONE = {
  petitioner: 'bg-sky-50 text-sky-800 border-sky-100',
  respondent: 'bg-amber-50 text-amber-800 border-amber-100',
  court: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  official: 'bg-slate-50 text-slate-800 border-slate-200',
  impugned: 'bg-orange-50 text-orange-800 border-orange-100',
  admitted: 'bg-teal-50 text-teal-800 border-teal-100',
  disputed: 'bg-rose-50 text-rose-800 border-rose-100',
};

function phaseClass(phaseId) {
  return PHASE_TONE[phaseId] || PHASE_TONE.other;
}

function EventBlock({ event }) {
  if (!event) return null;
  const cite = eventCite(event);
  const role = roleLabel(event.sourceRole);
  const disputed = Boolean(event.disputed) || event.sourceRole === 'disputed';
  return (
    <div className="mt-3 pl-3 border-l-2 border-gray-100">
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-sm font-semibold text-gray-900">{event.title}</p>
        {disputed ? (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold border bg-rose-50 text-rose-800 border-rose-100">
            Disputed
          </span>
        ) : null}
        {role && event.sourceRole !== 'disputed' ? (
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${ROLE_TONE[event.sourceRole] || ROLE_TONE.disputed}`}>
            {role}
          </span>
        ) : null}
      </div>
      {event.particulars ? (
        <p className="mt-1 text-sm leading-relaxed text-gray-600">{event.particulars}</p>
      ) : null}
      {event.sourceQuote ? (
        <p className="mt-2 text-xs italic leading-relaxed text-gray-500">
          “{event.sourceQuote}”
        </p>
      ) : null}
      {cite ? (
        <p className="mt-1 text-[11px] text-gray-500">{cite}</p>
      ) : null}
      {event.sourceDocument ? (
        <p className="mt-0.5 text-[11px] uppercase tracking-wide text-gray-400">
          {event.sourceDocument}
        </p>
      ) : null}
    </div>
  );
}

function DateNode({ node }) {
  const events = Array.isArray(node?.events) ? node.events : [];
  const summaryVisible = showDaySummary(node);
  const approximate = node.precision && node.precision !== 'day';
  return (
    <article className="relative pl-6 pb-8 last:pb-0">
      <span className="absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full bg-[#21C1B6] ring-4 ring-[#f0fdfb]" />
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <time className="text-sm font-bold text-gray-900">
          {node.displayDate || node.date}
        </time>
        {approximate ? (
          <span className="text-[10px] font-medium text-gray-400">exact day not on record</span>
        ) : null}
        {node.phase ? (
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${phaseClass(node.phase)}`}>
            {phaseLabel(node.phase)}
          </span>
        ) : null}
      </div>
      {summaryVisible ? (
        <p className="text-sm leading-relaxed text-gray-700">{node.summary}</p>
      ) : null}
      {events.map((event, index) => (
        <EventBlock key={`${node.date}-${index}`} event={event} />
      ))}
    </article>
  );
}

const ChronologyTimeline = ({ tree }) => {
  const dates = datesFromStartToLast(tree?.dates);

  if (!dates.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm font-medium text-gray-700">No chronology events yet</p>
        <p className="mt-1 text-xs text-gray-500 max-w-sm">
          Grounded dates appear here after case documents are processed and auto-fill completes.
        </p>
      </div>
    );
  }

  const first = dates[0]?.displayDate || dates[0]?.date;
  const last = dates[dates.length - 1]?.displayDate || dates[dates.length - 1]?.date;

  return (
    <div className="chronology-print-root">
      <p className="text-xs text-gray-500 mb-6">
        From the start of the case to the latest event
        {first && last ? ` · ${first} → ${last}` : ''}
      </p>
      <div className="relative ml-1 border-l-2 border-[#ccfbf1]">
        {dates.map((node) => (
          <DateNode key={node.date || node.displayDate} node={node} />
        ))}
      </div>
    </div>
  );
};

export default ChronologyTimeline;
