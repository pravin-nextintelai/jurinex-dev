"use client";

import { useEffect } from "react";

/** Rendered when a server component throws (for example a 5xx from the backend). */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="mx-auto max-w-xl py-16 text-center font-body">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">Something went wrong</p>
      <h1 className="mt-4 font-display text-3xl text-nx-ink">We could not load this page</h1>
      <p className="mt-4 text-nx-muted">
        The bare acts service did not answer in time. This is usually temporary. Please try again in a moment.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-8 rounded-lg bg-teal-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-teal-500/25 transition-colors hover:bg-teal-700"
      >
        Try again
      </button>
    </section>
  );
}
