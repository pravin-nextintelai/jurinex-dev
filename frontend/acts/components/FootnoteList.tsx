import type { Footnote } from "@/lib/types";

/** Footnotes under a provision. Hidden entirely when there are none. */
export default function FootnoteList({ footnotes }: { footnotes: Footnote[] | null | undefined }) {
  if (!footnotes || footnotes.length === 0) return null;

  return (
    <section aria-labelledby="footnotes-heading" className="mt-10 border-t border-nx-line pt-6">
      <h2 id="footnotes-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
        Footnotes
      </h2>
      <ol className="mt-4 space-y-2 text-sm leading-6 text-nx-muted">
        {footnotes.map((note) => (
          <li key={`${note.marker}-${note.text.slice(0, 24)}`} id={`fn-${note.marker}`} className="flex gap-3">
            <span className="w-6 flex-none text-right font-mono text-xs text-nx-teal-ink">{note.marker}.</span>
            <span className="min-w-0 flex-1">{note.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
