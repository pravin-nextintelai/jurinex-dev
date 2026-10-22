export const FAQS = [
  {
    question: "How long does it take to get a response?",
    answer:
      "Most requests are reviewed within 24 to 48 hours. Higher priority issues are picked up faster when enough detail and screenshots are attached.",
  },
  {
    question: "Can I track my support requests?",
    answer:
      "Yes. Every ticket appears in your Help Center history with a live status trail so you can see when it was raised, opened by support, and resolved.",
  },
  {
    question: "What files can I attach?",
    answer:
      "You can upload screenshots, PDFs, and Word documents. Each file can be up to 10 MB and you can attach up to 30 files per ticket.",
  },
  {
    question: "Will I receive email updates?",
    answer:
      "Yes. You receive an email when your ticket is raised, when an admin starts working on it, and when the ticket is marked resolved.",
  },
  {
    question: "What should I include in the description?",
    answer:
      "Explain what you were trying to do, what happened instead, whether it is blocking your work, and attach screenshots if possible.",
  },
];

export const TRACKING_STEPS = ["open", "pending", "in_progress", "resolved", "closed"];

export const STATUS_META = {
  open: {
    label: "Open",
    chip: "bg-white text-amber-500 border-amber-200",
    accent: "bg-amber-500",
  },
  pending: {
    label: "Pending",
    chip: "bg-white text-orange-500 border-orange-200",
    accent: "bg-orange-500",
  },
  in_progress: {
    label: "In Progress",
    chip: "bg-white text-sky-500 border-sky-200",
    accent: "bg-sky-500",
  },
  resolved: {
    label: "Resolved",
    chip: "bg-white text-emerald-500 border-emerald-200",
    accent: "bg-emerald-500",
  },
  closed: {
    label: "Closed",
    chip: "bg-white text-slate-500 border-slate-200",
    accent: "bg-slate-500",
  },
};

export function formatDate(dateValue) {
  if (!dateValue) return "Not available";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateValue));
}
