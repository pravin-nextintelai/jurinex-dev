import React from "react";
import { Loader2, MessageSquarePlus, Paperclip, X } from "lucide-react";

export default function RaiseTicketModal({
  setShowForm,
  formData,
  setFormData,
  submitting,
  handleSubmit,
  handleChange,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-[32px] border border-white/80 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.18)]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 sm:px-8">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Raise a support ticket</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Share the issue, upload screenshots, and we will track every update here.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-6 sm:px-8">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Issue type
              </label>
              <select
                name="subject"
                value={formData.subject}
                onChange={handleChange}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#21C1B6] focus:bg-white"
                required
              >
                <option value="Technical issue">Technical issue</option>
                <option value="Billing question">Billing question</option>
                <option value="Account issue">Account issue</option>
                <option value="Feature request">Feature request</option>
                <option value="General support">General support</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Priority
              </label>
              <select
                name="priority"
                value={formData.priority}
                onChange={handleChange}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#21C1B6] focus:bg-white"
                required
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              Description
            </label>
            <textarea
              name="message"
              rows="6"
              value={formData.message}
              onChange={handleChange}
              placeholder="Describe the problem, the page where it happened, what you expected, and what actually happened..."
              className="w-full rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#21C1B6] focus:bg-white"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              Attach screenshots or files
            </label>
            <div className="rounded-[28px] border border-dashed border-[#7BE0D8] bg-[#F8FFFE] p-4">
              <label className="flex cursor-pointer items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50">
                <Paperclip className="mr-2 h-4 w-4 text-[#21C1B6]" />
                Choose files
                <input
                  type="file"
                  name="attachments"
                  multiple
                  accept="image/*,.pdf,.doc,.docx"
                  onChange={handleChange}
                  className="hidden"
                />
              </label>
              <p className="mt-3 text-xs leading-6 text-slate-500">
                Up to 30 files. Accepted: screenshots, PDFs, DOC, DOCX. Maximum 10 MB each.
              </p>

              {formData.attachments.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {formData.attachments.map((file) => (
                    <span
                      key={`${file.name}-${file.size}`}
                      className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
                    >
                      <Paperclip className="mr-2 h-3.5 w-3.5 text-slate-400" />
                      {file.name}
                      <button
                        type="button"
                        onClick={() =>
                          setFormData((prev) => ({
                            ...prev,
                            attachments: prev.attachments.filter(
                              (f) => !(f.name === file.name && f.size === file.size)
                            ),
                          }))
                        }
                        className="ml-2 rounded-full text-slate-400 hover:text-red-500 transition"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-full bg-[#21C1B6] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#169D95] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Raising ticket...
                </>
              ) : (
                <>
                  <MessageSquarePlus className="mr-2 h-4 w-4" />
                  Raise Ticket
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
