import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Archive, ArrowUpRight, ChevronDown, ChevronUp, Eye, Filter, Loader2, MessageSquare, Paperclip, Search } from "lucide-react";
import StatusBadge from "./StatusBadge";
import TrackingRail from "./TrackingRail";
import { STATUS_META, formatDate } from "./constants";

export default function TicketHistory({ loadingTickets, tickets, loadTickets }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [priorityFilter, setPriorityFilter] = useState("All Priority");
  const [activeTab, setActiveTab] = useState("active");
  const [expandedRow, setExpandedRow] = useState(null);

  const isArchived = (status) => status === "resolved" || status === "closed";

  const openTicketsCount = tickets.filter((t) => !isArchived(t.status)).length;
  const resolvedTicketsCount = tickets.filter((t) => isArchived(t.status)).length;

  const filteredTickets = tickets.filter((ticket) => {
    if (activeTab === "active" && isArchived(ticket.status)) return false;
    if (activeTab === "archive" && !isArchived(ticket.status)) return false;
    
    if (statusFilter !== "All Status") {
      const sFilter = statusFilter.toLowerCase().replace(" ", "_");
      if (ticket.status.toLowerCase() !== sFilter && ticket.status.toLowerCase() !== statusFilter.toLowerCase()) return false;
    }
    
    if (priorityFilter !== "All Priority" && ticket.priority.toLowerCase() !== priorityFilter.toLowerCase()) return false;
    if (search && !ticket.subject.toLowerCase().includes(search.toLowerCase()) && !ticket.ticket_number.toLowerCase().includes(search.toLowerCase())) return false;
    
    return true;
  });

  const toggleRow = (id) => {
    setExpandedRow(expandedRow === id ? null : id);
  };

  return (
    <div className="mt-8">
      {/* Header */}
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Your ticket history</h2>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
            <span>Track your support requests, view updates, and access the archive.</span>
            <span className="hidden lg:inline text-slate-300">|</span>
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 font-medium text-slate-600">
              <div className="flex items-center gap-1.5"><div className="h-1.5 w-1.5 rounded-full bg-amber-500"></div>Open</div>
              <div className="flex items-center gap-1.5"><div className="h-1.5 w-1.5 rounded-full bg-orange-500"></div>Pending</div>
              <div className="flex items-center gap-1.5"><div className="h-1.5 w-1.5 rounded-full bg-sky-500"></div>In Progress</div>
              <div className="flex items-center gap-1.5"><div className="h-1.5 w-1.5 rounded-full bg-emerald-500"></div>Resolved</div>
              <div className="flex items-center gap-1.5"><div className="h-1.5 w-1.5 rounded-full bg-slate-500"></div>Closed</div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button 
            type="button" 
            onClick={loadTickets} 
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition mr-2"
            title="Refresh history"
          >
            <ArrowUpRight className="h-4 w-4" />
          </button>
          
          <button className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
            <Filter className="h-4 w-4" />
          </button>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search queries..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 w-48 rounded-full border border-slate-200 pl-9 pr-4 text-sm outline-none focus:border-[#21C1B6] transition"
            />
          </div>

          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-full border border-slate-200 px-4 text-sm outline-none focus:border-[#21C1B6] focus:ring-1 focus:ring-[#21C1B6] appearance-none bg-white pr-8 bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%24%2024%22%20fill%3D%22none%22%20stroke%3D%22%2364748B%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_10px_center] bg-[length:16px_16px] text-slate-700 font-medium"
          >
            <option>All Status</option>
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="in progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          
         
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-8 flex gap-3">
        <button 
          onClick={() => { setActiveTab("active"); setExpandedRow(null); }}
          className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
            activeTab === "active" ? "bg-white text-slate-900 shadow border border-slate-200" : "text-slate-500 hover:bg-slate-50 border border-transparent"
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          Active Queries
          <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-bold ${activeTab === "active" ? "bg-[#DBEAFE] text-blue-700" : "bg-slate-100 text-slate-500"}`}>{openTicketsCount}</span>
        </button>
        <button 
          onClick={() => { setActiveTab("archive"); setExpandedRow(null); }}
          className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
            activeTab === "archive" ? "bg-white text-slate-900 shadow border border-slate-200" : "text-slate-500 hover:bg-slate-50 border border-transparent"
          }`}
        >
          <Archive className="h-4 w-4" />
          Solved Queries
          <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-bold ${activeTab === "archive" ? "bg-slate-200 text-slate-700" : "bg-slate-100 text-slate-500"}`}>{resolvedTicketsCount}</span>
        </button>
      </div>

      {/* Table container */}
      <div className="mt-6 overflow-hidden rounded-[20px] border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-[#FAFAFA] text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4">ID</th>
                <th className="px-6 py-4">SUBJECT</th>
                <th className="px-6 py-4">USER</th>
                <th className="px-6 py-4">STATUS</th>
                <th className="px-6 py-4">PRIORITY</th>
                <th className="px-6 py-4">TICKET</th>
                <th className="px-6 py-4">CREATED</th>
                <th className="px-6 py-4 text-center">DETAILS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingTickets ? (
                <tr>
                  <td colSpan="8" className="px-6 py-12 text-center text-slate-500">
                    <div className="flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
                  </td>
                </tr>
              ) : filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-6 py-12 text-center text-slate-500">
                    {activeTab === "archive" ? "No archived tickets." : "No active queries found. You can raise a new ticket."}
                  </td>
                </tr>
              ) : (
                filteredTickets.map((ticket, index) => {
                  const rowId = ticket.id || index;
                  const isExpanded = expandedRow === rowId;
                  
                  return (
                    <React.Fragment key={rowId}>
                      <tr 
                        onClick={() => toggleRow(rowId)}
                        className={`transition group cursor-pointer ${isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                      >
                        <td className="whitespace-nowrap px-6 py-4 font-semibold text-slate-900">
                          #{rowId + 1}
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-semibold text-slate-900">{ticket.subject}</div>
                          <div className="mt-1 text-xs text-slate-500 max-w-[250px] truncate">{ticket.message}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-semibold text-slate-900">{ticket.user?.name || "You"}</div>
                          <div className="mt-1 text-xs text-slate-500">{ticket.user?.email || "N/A"}</div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <StatusBadge status={ticket.status} />
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold bg-white ${
                            ticket.priority === 'urgent' ? 'text-red-500 border-red-200' :
                            ticket.priority === 'high' ? 'text-orange-500 border-orange-200' :
                            ticket.priority === 'medium' ? 'text-amber-500 border-amber-200' :
                            'text-slate-500 border-slate-200'
                          }`}>
                            {ticket.priority ? ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1) : "Medium"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 font-mono text-xs text-slate-600">
                          {ticket.ticket_number}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          {new Date(ticket.created_at).toLocaleDateString()}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-center">
                          <div className="flex items-center justify-center">
                            <button className={`rounded-full p-2 transition ${isExpanded ? 'bg-[#21C1B6] text-white shadow-sm' : 'text-slate-400 hover:bg-slate-200 hover:text-slate-700'}`}>
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50/50 border-b border-slate-100">
                          <td colSpan="8" className="px-6 py-6 border-t border-slate-100">
                            <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm grid gap-8 md:grid-cols-[2fr_1fr]">
                              
                              <div className="space-y-6">
                                <div>
                                  <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-2 mb-3">Ticket Description</h3>
                                  <p className="whitespace-pre-wrap text-sm leading-7 text-slate-600">
                                    {ticket.message}
                                  </p>
                                </div>
                            
                                {ticket.admin_note && (
                                  <div className="rounded-[20px] border border-[#D9F7F4] bg-[#F5FFFE] px-5 py-4">
                                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#157B74]">
                                      Latest support note
                                    </div>
                                    <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                                      {ticket.admin_note}
                                    </p>
                                  </div>
                                )}
                            
                                {(ticket.attachments || []).length > 0 && (
                                  <div>
                                    <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-2 mb-3">Attachments</h3>
                                    <div className="flex flex-wrap gap-3">
                                      {ticket.attachments.map((attachment) => (
                                        <a
                                          key={attachment.id}
                                          href={attachment.previewUrl || attachment.downloadUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-[#21C1B6] hover:text-[#157B74] shadow-sm hover:shadow-md"
                                        >
                                          <Paperclip className="mr-2 h-4 w-4" />
                                          {attachment.name}
                                        </a>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            
                              <div className="space-y-6">
                                <div className="rounded-[20px] border border-slate-100 bg-slate-50 px-5 py-4">
                                  <h3 className="text-sm font-semibold text-slate-900 mb-4">Status Tracking</h3>
                                  <TrackingRail status={ticket.status} />
                                </div>
                            
                                <div className="rounded-[20px] border border-slate-100 bg-slate-50 px-5 py-4">
                                  <h3 className="text-sm font-semibold text-slate-900 mb-4">Dates</h3>
                                  <div className="space-y-2 text-sm text-slate-600">
                                    <div className="flex justify-between">
                                      <span className="text-slate-400">Raised:</span>
                                      <span className="font-medium text-slate-800">{formatDate(ticket.created_at)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-slate-400">Updated:</span>
                                      <span className="font-medium text-slate-800">{formatDate(ticket.updated_at)}</span>
                                    </div>
                                  </div>
                                </div>
                                
                                {(ticket.status_history || []).length > 0 && (
                                  <div>
                                    <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-2 mb-3">Activity Log</h3>
                                    <div className="space-y-4">
                                      {ticket.status_history.map((entry) => (
                                        <div key={entry.id} className="flex gap-3">
                                          <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STATUS_META[entry.status]?.accent || "bg-slate-300"}`} />
                                          <div>
                                            <div className="text-sm font-medium text-slate-900">
                                              {entry.label || STATUS_META[entry.status]?.label || entry.status}
                                            </div>
                                            <div className="mt-1 text-xs text-slate-500">
                                              {entry.actorEmail || entry.actorType} • {formatDate(entry.createdAt)}
                                            </div>
                                            {entry.note && (
                                              <div className="mt-2 text-xs italic text-slate-500">
                                                "{entry.note}"
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-8 text-center pt-2">
        
      </div>

    </div>
  );
}
