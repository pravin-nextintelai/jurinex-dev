import React, { useState } from "react";
import { ChevronDown, ChevronUp, Search, Sparkles } from "lucide-react";
import { FAQS } from "./constants";

export default function FaqSection() {
  const [search, setSearch] = useState("");
  const [openFAQ, setOpenFAQ] = useState(null);

  const filteredFaqs = (() => {
    const query = search.trim().toLowerCase();
    if (!query) return FAQS;
    return FAQS.filter(
      (faq) =>
        faq.question.toLowerCase().includes(query) ||
        faq.answer.toLowerCase().includes(query)
    );
  })();

  return (
    <div className="rounded-[28px] border border-[#B6EFE9] bg-white p-5 md:p-7 shadow-[0_12px_30px_rgba(33,193,182,0.06)]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Frequently asked questions</h2>
          <p className="mt-1.5 text-sm leading-6 text-slate-500">
            Search the common answers first. If your issue still needs attention, raise a ticket.
          </p>
        </div>
        <Sparkles className="hidden h-5 w-5 text-[#21C1B6] sm:block" />
      </div>

      <div className="relative mt-5">
        <Search className="pointer-events-none absolute left-4 top-3 h-4 w-4 text-[#21C1B6]" />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search FAQs..."
          className="w-full rounded-[16px] border border-[#7BE0D8] bg-[#F8FFFE] py-2.5 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-[#21C1B6] focus:bg-white"
        />
      </div>

      <div className="mt-5 space-y-2.5">
        {filteredFaqs.length === 0 ? (
          <div className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            No FAQs match your search.
          </div>
        ) : (
          filteredFaqs.map((faq, index) => {
            const isOpen = openFAQ === index;
            return (
              <div key={faq.question} className="overflow-hidden rounded-[16px] border border-[#BDEDE8] bg-[#FCFEFE]">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
                  onClick={() => setOpenFAQ(isOpen ? null : index)}
                >
                  <span className="text-[13px] font-semibold text-slate-900 sm:text-sm">
                    {faq.question}
                  </span>
                  {isOpen ? (
                    <ChevronUp className="h-4 w-4 shrink-0 text-[#21C1B6]" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-[#21C1B6]" />
                  )}
                </button>
                {isOpen && (
                  <div className="border-t border-[#E2F8F5] px-4 py-3 text-sm leading-6 text-slate-600 bg-white">
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
