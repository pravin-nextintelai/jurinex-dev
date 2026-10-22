import React from "react";
import { Clock3, ShieldCheck, Ticket } from "lucide-react";
import FaqSection from "./FaqSection";
import TicketHistory from "./TicketHistory";

export default function GetHelpDashboard({ tickets, loadingTickets, loadTickets }) {
  const isArchived = (status) => status === "resolved" || status === "closed";
  const openTicketsCount = tickets.filter((ticket) => !isArchived(ticket.status)).length;
  const resolvedTicketsCount = tickets.filter((ticket) => isArchived(ticket.status)).length;

  return (
    <div className="w-full max-w-[1590px] mx-auto space-y-5">
      <div className="grid gap-5 xl:grid-cols-[1fr_320px] items-start">
        
        {/* Left Column: Header + FAQ */}
        <div className="flex flex-col gap-5">
          <div className="rounded-[20px] border border-white/70 bg-white/60 p-5 shadow-sm backdrop-blur-md">
            <div>
              <div className="inline-flex items-center rounded-full border border-[#B6EFE9] bg-[#ECFDFC] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#157B74]">
                Jurinex Help Center
              </div>
              <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Support & Query Dashboard
              </h1>
            </div>
          </div>

          <FaqSection />
        </div>

        {/* Right Column: Stats + Guidelines */}
        <div className="flex flex-col gap-5">
          {/* Quick Stats Grid */}
          <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
            <div className="flex items-center justify-between rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
              <div className="flex items-center gap-3 text-slate-900">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50">
                  <Ticket className="h-5 w-5 text-[#21C1B6]" />
                </div>
                <span className="text-sm font-semibold">Total Queries</span>
              </div>
              <div className="text-2xl font-bold text-slate-950">{tickets.length}</div>
            </div>
            <div className="flex items-center justify-between rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
              <div className="flex items-center gap-3 text-slate-900">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50">
                  <Clock3 className="h-5 w-5 text-sky-500" />
                </div>
                <span className="text-sm font-semibold">Active</span>
              </div>
              <div className="text-2xl font-bold text-slate-950">{openTicketsCount}</div>
            </div>
            <div className="flex items-center justify-between rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
              <div className="flex items-center gap-3 text-slate-900">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50">
                  <ShieldCheck className="h-5 w-5 text-emerald-500" />
                </div>
                <span className="text-sm font-semibold">Resolved</span>
              </div>
              <div className="text-2xl font-bold text-slate-950">{resolvedTicketsCount}</div>
            </div>
          </div>

          {/* Guidelines */}
          <div className="rounded-[24px] border border-slate-200 bg-white p-8 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">What to include</h2>
            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
              <div>
                <div className="font-semibold text-slate-900">What you were trying to do</div>
                Mention the page, workflow, or action.
              </div>
              <div>
                <div className="font-semibold text-slate-900">What actually happened</div>
                Include the exact error or missing behavior.
              </div>
              <div>
                <div className="font-semibold text-slate-900">Anything to reproduce it</div>
                Add screenshots, timings, blocks.
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Ticket History spans full width below the columns */}
      <TicketHistory tickets={tickets} loadingTickets={loadingTickets} loadTickets={loadTickets} />

    </div>
  );
}
