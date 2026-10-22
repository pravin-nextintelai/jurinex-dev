import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import {
  CheckCheck,
  Clock3,
  Loader2,
  MessageSquareText,
  Paperclip,
  RefreshCcw,
  Search,
} from "lucide-react";
import apiService from "@/shared/api/api";

const STATUS_META = {
  open: {
    label: "Open",
    chip: "bg-amber-100 text-amber-700 border-amber-200",
  },
  in_progress: {
    label: "In Progress",
    chip: "bg-sky-100 text-sky-700 border-sky-200",
  },
  resolved: {
    label: "Resolved",
    chip: "bg-emerald-100 text-emerald-700 border-emerald-200",
  },
};

function formatDate(dateValue) {
  if (!dateValue) return "Not available";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateValue));
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.open;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${meta.chip}`}
    >
      {meta.label}
    </span>
  );
}

const SupportTicketsTab = () => {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const loadTickets = async (status = statusFilter) => {
    setLoading(true);
    try {
      const response = await apiService.getAdminSupportTickets(
        status === "all" ? {} : { status }
      );
      const nextTickets = response.tickets || [];
      setTickets(nextTickets);
    } catch (error) {
      console.error("[SupportTicketsTab] Failed to load tickets:", error);
      toast.error(error.response?.data?.message || "Failed to load support tickets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTickets(statusFilter);
  }, [statusFilter]);

  useEffect(() => {
    if (!tickets.length) {
      setSelectedId(null);
      setNoteDraft("");
      return;
    }

    const stillExists = tickets.some((ticket) => ticket.id === selectedId);
    const fallbackId = tickets[0]?.id ?? null;
    const nextId = stillExists ? selectedId : fallbackId;
    setSelectedId(nextId);

    const selected = tickets.find((ticket) => ticket.id === nextId);
    setNoteDraft(selected?.admin_note || "");
  }, [tickets, selectedId]);

  const filteredTickets = (() => {
    const query = search.trim().toLowerCase();
    if (!query) return tickets;

    return tickets.filter((ticket) =>
      [ticket.ticket_number, ticket.user_email, ticket.subject, ticket.message]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  })();

  const selectedTicket =
    filteredTickets.find((ticket) => ticket.id === selectedId) ||
    tickets.find((ticket) => ticket.id === selectedId) ||
    null;

  const replaceTicket = (updatedTicket) => {
    setTickets((prev) =>
      prev.map((ticket) => (ticket.id === updatedTicket.id ? updatedTicket : ticket))
    );
  };

  const handleSelectTicket = async (ticket) => {
    setSelectedId(ticket.id);
    setNoteDraft(ticket.admin_note || "");

    if (ticket.status !== "open") {
      return;
    }

    setActionLoading(true);
    try {
      const response = await apiService.markSupportTicketSeen(ticket.id);
      replaceTicket(response.ticket);
      setNoteDraft(response.ticket.admin_note || "");
      toast.success(`Ticket ${response.ticket.ticket_number} is now in progress.`);
    } catch (error) {
      console.error("[SupportTicketsTab] Failed to mark ticket seen:", error);
      toast.error(error.response?.data?.message || "Failed to update ticket status.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleStatusChange = async (status) => {
    if (!selectedTicket) return;

    setActionLoading(true);
    try {
      const response = await apiService.updateSupportTicketStatus(selectedTicket.id, {
        status,
        admin_note: noteDraft,
      });
      replaceTicket(response.ticket);
      toast.success(`Ticket ${response.ticket.ticket_number} updated to ${STATUS_META[status]?.label || status}.`);
    } catch (error) {
      console.error("[SupportTicketsTab] Failed to update ticket:", error);
      toast.error(error.response?.data?.message || "Failed to save ticket update.");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
      <div className="rounded-[28px] border border-slate-200 bg-white/90 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">Support Queue</h3>
            <p className="mt-1 text-sm text-slate-500">
              Open any ticket to move it into active processing.
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadTickets(statusFilter)}
            className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refresh
          </button>
        </div>

        <div className="mt-5 space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by ticket, email, subject..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-[#21C1B6] focus:bg-white"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#21C1B6]"
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>

        <div className="mt-5 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center rounded-3xl border border-dashed border-slate-200 px-4 py-16 text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading support tickets...
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-16 text-center text-sm text-slate-500">
              No support tickets found for the current filter.
            </div>
          ) : (
            filteredTickets.map((ticket) => {
              const isSelected = ticket.id === selectedId;
              return (
                <button
                  key={ticket.id}
                  type="button"
                  onClick={() => handleSelectTicket(ticket)}
                  className={`w-full rounded-3xl border p-4 text-left transition ${
                    isSelected
                      ? "border-[#21C1B6] bg-[#ECFDFC] shadow-[0_16px_30px_rgba(33,193,182,0.12)]"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {ticket.ticket_number}
                    </div>
                    <StatusBadge status={ticket.status} />
                  </div>
                  <div className="mt-2 line-clamp-1 text-sm font-medium text-slate-700">
                    {ticket.subject}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                    {ticket.message}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                    <span>{ticket.user_email}</span>
                    <span>{formatDate(ticket.created_at)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
        {!selectedTicket ? (
          <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-6 text-center">
            <MessageSquareText className="h-12 w-12 text-slate-300" />
            <h4 className="mt-4 text-lg font-semibold text-slate-900">Select a ticket</h4>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
              Choose a ticket from the queue to review the user issue, open attachments,
              and update its status.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-2xl font-semibold text-slate-900">
                    {selectedTicket.ticket_number}
                  </h3>
                  <StatusBadge status={selectedTicket.status} />
                </div>
                <p className="mt-2 text-sm text-slate-500">{selectedTicket.subject}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right text-xs text-slate-500">
                <div>Created: {formatDate(selectedTicket.created_at)}</div>
                <div className="mt-1">Updated: {formatDate(selectedTicket.updated_at)}</div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Requester
                </div>
                <div className="mt-2 text-sm font-medium text-slate-900">
                  {selectedTicket.user_name || "User"}
                </div>
                <div className="mt-1 text-sm text-slate-500">{selectedTicket.user_email}</div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Priority
                </div>
                <div className="mt-2 text-sm font-medium capitalize text-slate-900">
                  {selectedTicket.priority}
                </div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Resolution
                </div>
                <div className="mt-2 text-sm text-slate-900">
                  {selectedTicket.resolved_at
                    ? formatDate(selectedTicket.resolved_at)
                    : "Pending"}
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                User description
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                {selectedTicket.message}
              </p>
            </div>

            <div className="rounded-[24px] border border-slate-200 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Admin update</div>
                  <p className="mt-1 text-xs text-slate-500">
                    Add a visible note for the user before moving the ticket status.
                  </p>
                </div>
                {actionLoading && (
                  <div className="inline-flex items-center text-xs text-slate-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </div>
                )}
              </div>

              <textarea
                rows="6"
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                className="mt-4 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#21C1B6] focus:bg-white"
                placeholder="Write what the team is doing, what was found, or the resolution shared with the user..."
              />

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleStatusChange("in_progress")}
                  className="inline-flex items-center rounded-full bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Clock3 className="mr-2 h-4 w-4" />
                  Mark In Progress
                </button>
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleStatusChange("resolved")}
                  className="inline-flex items-center rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <CheckCheck className="mr-2 h-4 w-4" />
                  Mark Resolved
                </button>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
              <div className="rounded-[24px] border border-slate-200 p-5">
                <div className="text-sm font-semibold text-slate-900">Ticket timeline</div>
                <div className="mt-4 space-y-4">
                  {(selectedTicket.status_history || []).length === 0 ? (
                    <div className="text-sm text-slate-500">No tracking events yet.</div>
                  ) : (
                    selectedTicket.status_history.map((entry) => (
                      <div key={entry.id} className="flex gap-3">
                        <div className="mt-1 h-2.5 w-2.5 rounded-full bg-[#21C1B6]" />
                        <div>
                          <div className="text-sm font-medium text-slate-900">
                            {entry.label || STATUS_META[entry.status]?.label || entry.status}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {entry.actorEmail || entry.actorType} • {formatDate(entry.createdAt)}
                          </div>
                          {entry.note && (
                            <div className="mt-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
                              {entry.note}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-200 p-5">
                <div className="text-sm font-semibold text-slate-900">Attachments</div>
                <div className="mt-4 space-y-3">
                  {(selectedTicket.attachments || []).length === 0 ? (
                    <div className="text-sm text-slate-500">No attachments were uploaded.</div>
                  ) : (
                    selectedTicket.attachments.map((attachment) => (
                      <a
                        key={attachment.id}
                        href={attachment.previewUrl || attachment.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:border-[#21C1B6] hover:bg-[#ECFDFC]"
                      >
                        <span className="truncate">{attachment.name}</span>
                        <Paperclip className="ml-3 h-4 w-4 shrink-0 text-slate-400" />
                      </a>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SupportTicketsTab;
