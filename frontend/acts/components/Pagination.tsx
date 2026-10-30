import Link from "next/link";

interface PaginationProps {
  page: number;
  total: number;
  limit: number;
  /** Builds the href for a page number, preserving any filters. */
  hrefFor: (page: number) => string;
}

/** Real <a href="?page=n"> links so crawlers can follow every page. */
export default function Pagination({ page, total, limit, hrefFor }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  if (totalPages <= 1) return null;

  const pages = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  const ordered = [...pages].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);

  return (
    <nav aria-label="Pagination" className="mt-10 flex flex-wrap items-center justify-center gap-2 font-body text-sm">
      {page > 1 && (
        <Link href={hrefFor(page - 1)} rel="prev" className="rounded-lg border border-nx-line px-3 py-2 text-nx-muted hover:border-teal-300 hover:text-teal-700">
          Previous
        </Link>
      )}
      {ordered.map((n, index) => {
        const previous = ordered[index - 1];
        const gap = previous !== undefined && n - previous > 1;
        return (
          <span key={n} className="flex items-center gap-2">
            {gap && (
              <span aria-hidden="true" className="px-1 text-nx-faint">
                &hellip;
              </span>
            )}
            {n === page ? (
              <span aria-current="page" className="rounded-lg bg-teal-600 px-3 py-2 font-semibold text-white">
                {n}
              </span>
            ) : (
              <Link href={hrefFor(n)} className="rounded-lg border border-nx-line px-3 py-2 text-nx-muted hover:border-teal-300 hover:text-teal-700">
                {n}
              </Link>
            )}
          </span>
        );
      })}
      {page < totalPages && (
        <Link href={hrefFor(page + 1)} rel="next" className="rounded-lg border border-nx-line px-3 py-2 text-nx-muted hover:border-teal-300 hover:text-teal-700">
          Next
        </Link>
      )}
    </nav>
  );
}
