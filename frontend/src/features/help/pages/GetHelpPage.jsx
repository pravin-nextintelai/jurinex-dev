import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { MessageSquarePlus } from "lucide-react";
import apiService from "@/shared/api/api";

import GetHelpDashboard from "../components/GetHelpDashboard";
import RaiseTicketModal from "../components/RaiseTicketModal";

const GetHelpPage = () => {
  const [showForm, setShowForm] = useState(false);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [formData, setFormData] = useState({
    subject: "Technical issue",
    priority: "medium",
    message: "",
    attachments: [],
  });

  const loadTickets = async () => {
    setLoadingTickets(true);
    try {
      console.log("[GetHelpPage] loadTickets:start", {
        endpoint: "/support/tickets/my",
      });
      const response = await apiService.getMySupportTickets();
      console.log("[GetHelpPage] loadTickets:success", {
        ticketCount: response.tickets?.length || 0,
        tickets: response.tickets || [],
      });
      setTickets(response.tickets || []);
    } catch (error) {
      console.error("[GetHelpPage] Failed to load tickets:", error);
      console.error("[GetHelpPage] loadTickets:error_payload", {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      toast.error(error.response?.data?.message || "Failed to load support history.");
    } finally {
      setLoadingTickets(false);
    }
  };

  useEffect(() => {
    loadTickets();
  }, []);

  const handleChange = (event) => {
    const { name, value, files } = event.target;

    if (name === "attachments") {
      const newFiles = Array.from(files || []);
      setFormData((prev) => {
        const existing = prev.attachments;
        const existingKeys = new Set(existing.map((f) => `${f.name}-${f.size}`));
        const deduplicated = newFiles.filter((f) => !existingKeys.has(`${f.name}-${f.size}`));
        const merged = [...existing, ...deduplicated].slice(0, 30);
        return { ...prev, attachments: merged };
      });
      return;
    }

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      const payload = new FormData();
      payload.append("subject", formData.subject);
      payload.append("priority", formData.priority);
      payload.append("message", formData.message.trim());
      formData.attachments.forEach((file) => {
        payload.append("attachments", file);
      });

      console.log("[GetHelpPage] handleSubmit:start", {
        subject: formData.subject,
        priority: formData.priority,
        messageLength: formData.message.trim().length,
        attachmentCount: formData.attachments.length,
        attachments: formData.attachments.map((file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
        })),
      });

      const response = await apiService.submitSupportQuery(payload);
      console.log("[GetHelpPage] handleSubmit:success", {
        ticketNumber: response.ticket?.ticket_number,
        ticketId: response.ticket?.id,
        status: response.ticket?.status,
        attachmentCount: response.ticket?.attachments?.length || 0,
      });
      setTickets((prev) => [response.ticket, ...prev]);
      setFormData({
        subject: "Technical issue",
        priority: "medium",
        message: "",
        attachments: [],
      });
      setShowForm(false);
      toast.success(`Ticket ${response.ticket.ticket_number} raised successfully.`);
    } catch (error) {
      console.error("[GetHelpPage] Failed to submit ticket:", error);
      console.error("[GetHelpPage] handleSubmit:error_payload", {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      toast.error(error.response?.data?.message || "Failed to raise support ticket.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(33,193,182,0.1),_transparent_32%),linear-gradient(180deg,_#F8FAFC_0%,_#EEF2FF_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <GetHelpDashboard 
        tickets={tickets} 
        loadingTickets={loadingTickets} 
        loadTickets={loadTickets} 
      />

      <button
        type="button"
        onClick={() => setShowForm(true)}
        className="fixed bottom-6 right-6 z-40 inline-flex items-center rounded-full bg-[#21C1B6] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_20px_40px_rgba(33,193,182,0.35)] transition hover:bg-[#169D95] sm:bottom-8 sm:right-8"
      >
        <MessageSquarePlus className="mr-2 h-5 w-5" />
        Raise Ticket
      </button>

      {showForm && (
        <RaiseTicketModal
          setShowForm={setShowForm}
          formData={formData}
          setFormData={setFormData}
          submitting={submitting}
          handleSubmit={handleSubmit}
          handleChange={handleChange}
        />
      )}
    </div>
  );
};

export default GetHelpPage;
