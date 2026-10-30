import type { Metadata } from "next";
import Link from "next/link";
import SearchBox from "@/components/SearchBox";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

/** Served with HTTP 404 whenever notFound() is called or no route matches. */
export default function NotFound() {
  return (
    <section className="mx-auto max-w-xl py-16 font-body">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">404</p>
      <h1 className="mt-4 font-display text-3xl text-nx-ink">This provision could not be found</h1>
      <p className="mt-4 text-nx-muted">
        The act, section or schedule you asked for is not published here. It may have been renumbered, or the link may be out of date.
      </p>
      <div className="mt-8">
        <SearchBox placeholder="Search for a section instead" />
      </div>
      <p className="mt-6 text-sm">
        <Link href="/" className="font-semibold text-nx-teal-deep hover:text-nx-teal-ink">
          &larr; Browse all bare acts
        </Link>
      </p>
    </section>
  );
}
