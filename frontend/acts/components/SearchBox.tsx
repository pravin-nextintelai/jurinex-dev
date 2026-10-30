"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BASE_PATH, toRoute } from "@/lib/route";
import { sanitizeSnippet } from "@/lib/text";
import type { SearchHit, SearchResponse } from "@/lib/types";

const MIN_CHARS = 2;
const MAX_CHARS = 100;
const DEBOUNCE_MS = 300;

type Status = "idle" | "loading" | "done" | "error";

interface SearchBoxProps {
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

/**
 * The only client component on the site. It talks to /acts/api/search, which
 * proxies the backend's public search endpoint. Results are rendered as real
 * links, exact matches first with a "Direct match" badge.
 */
export default function SearchBox({ placeholder = "Search sections, e.g. 318 BNS or cheating", autoFocus = false, className = "" }: SearchBoxProps) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim();

  function updateQuery(value: string) {
    setQuery(value);
    setOpen(true);
    if (value.trim().length < MIN_CHARS) {
      abortRef.current?.abort();
      setHits([]);
      setStatus("idle");
      setErrorMessage("");
    }
  }

  useEffect(() => {
    if (trimmed.length < MIN_CHARS) return;

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("loading");
      setErrorMessage("");

      try {
        const res = await fetch(`${BASE_PATH}/api/search?q=${encodeURIComponent(trimmed.slice(0, MAX_CHARS))}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        if (res.status === 429) {
          const retry = res.headers.get("Retry-After");
          setHits([]);
          setStatus("error");
          setErrorMessage(retry ? `Too many searches. Try again in ${retry} seconds.` : "Too many searches. Try again shortly.");
          return;
        }
        if (!res.ok) {
          setHits([]);
          setStatus("error");
          setErrorMessage("Search is unavailable right now.");
          return;
        }

        const body = (await res.json()) as SearchResponse;
        const sorted = [...body.data].sort((a, b) => Number(b.exact) - Number(a.exact));
        setHits(sorted);
        setStatus("done");
        setActiveIndex(-1);
        setOpen(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setHits([]);
        setStatus("error");
        setErrorMessage("Search is unavailable right now.");
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [trimmed]);

  // Close the list when focus leaves the widget.
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const exactHit = useMemo(() => hits.find((hit) => hit.exact), [hits]);
  const showList = open && trimmed.length >= MIN_CHARS && (hits.length > 0 || status === "done" || status === "error");

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (hits.length === 0) return;
      setOpen(true);
      setActiveIndex((index) => (index + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (hits.length === 0) return;
      setActiveIndex((index) => (index <= 0 ? hits.length - 1 : index - 1));
    } else if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    } else if (event.key === "Enter") {
      const target = activeIndex >= 0 ? hits[activeIndex] : exactHit;
      if (target) {
        event.preventDefault();
        setOpen(false);
        router.push(toRoute(target.url));
      }
    }
  }

  return (
    <div ref={rootRef} className={`relative font-body ${className}`}>
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search bare acts
      </label>
      <input
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${listId}-list`}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={MAX_CHARS}
        value={query}
        placeholder={placeholder}
        onChange={(event) => updateQuery(event.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="w-full rounded-xl border border-nx-line bg-white px-4 py-3 text-base text-nx-ink shadow-sm placeholder:text-nx-faint focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
      />
      {status === "loading" && (
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase tracking-[0.2em] text-nx-faint" aria-hidden="true">
          Searching
        </span>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {status === "done" ? `${hits.length} results` : status === "error" ? errorMessage : ""}
      </p>

      {showList && (
        <ul
          id={`${listId}-list`}
          role="listbox"
          aria-label="Search results"
          className="absolute z-40 mt-2 max-h-96 w-full overflow-y-auto rounded-xl border border-nx-line bg-white p-1 shadow-xl"
        >
          {status === "error" && <li className="px-3 py-2 text-sm text-red-700">{errorMessage}</li>}
          {status === "done" && hits.length === 0 && <li className="px-3 py-2 text-sm text-nx-muted">No matching provisions.</li>}
          {hits.map((hit, index) => {
            const active = index === activeIndex;
            return (
              <li
                key={`${hit.url}-${index}`}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={active}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <Link
                  href={toRoute(hit.url)}
                  tabIndex={-1}
                  onClick={() => setOpen(false)}
                  className={`block rounded-lg px-3 py-2 transition-colors ${active ? "bg-teal-50" : "hover:bg-nx-pale"}`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-nx-teal-ink">{hit.label}</span>
                    {hit.exact && (
                      <span className="rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
                        Direct match
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold text-nx-ink">{hit.title}</span>
                  {hit.snippet && (
                    <span
                      className="mt-0.5 block text-xs leading-5 text-nx-muted"
                      dangerouslySetInnerHTML={{ __html: sanitizeSnippet(hit.snippet) }}
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
