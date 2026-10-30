import Link from "next/link";
import { toRoute } from "@/lib/route";
import type { NeighbourLink } from "@/lib/types";

/** Previous / next provision links with rel="prev" and rel="next". */
export default function PrevNext({ prev, next }: { prev: NeighbourLink | null; next: NeighbourLink | null }) {
  if (!prev && !next) return null;

  return (
    <nav aria-label="Previous and next provision" className="mt-10 grid gap-3 border-t border-nx-line pt-6 font-body sm:grid-cols-2">
      {prev ? (
        <Link
          href={toRoute(prev.url)}
          rel="prev"
          className="group rounded-xl border border-nx-line px-4 py-3 transition-colors hover:border-teal-300 hover:bg-teal-50"
        >
          <span className="block font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-nx-faint">Previous</span>
          <span className="mt-1 block text-sm font-semibold text-nx-ink group-hover:text-teal-700">&larr; {prev.label}</span>
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      {next && (
        <Link
          href={toRoute(next.url)}
          rel="next"
          className="group rounded-xl border border-nx-line px-4 py-3 text-right transition-colors hover:border-teal-300 hover:bg-teal-50"
        >
          <span className="block font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-nx-faint">Next</span>
          <span className="mt-1 block text-sm font-semibold text-nx-ink group-hover:text-teal-700">{next.label} &rarr;</span>
        </Link>
      )}
    </nav>
  );
}
