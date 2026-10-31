"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { toRoute } from "@/lib/route";
import { chapterId, chapterName, groupByHeading, sectionRange } from "@/lib/chapters";
import type { ReadableChapter, ReadableSection } from "@/lib/chapters";
import type { PartLink } from "@/lib/types";
import { Icon } from "@/components/site/Icon";

interface Preamble {
  title: string;
  text: string;
  url: string;
}

interface ChapterContentsProps {
  chapters: ReadableChapter[];
  /** "Section" or "Article". */
  label: string;
  preamble: Preamble | null;
  partsAfter: PartLink[];
  /** Rendered under the contents list in the left column (e.g. the search box). */
  aside?: React.ReactNode;
}

type Entry =
  | { kind: "preamble"; id: string; preamble: Preamble }
  | { kind: "chapter"; id: string; chapter: ReadableChapter; index: number };

const PREAMBLE_ID = "preamble";

/** Lines that open a sub-clause, proviso or explanation are indented, as in the printed Gazette. */
const INDENTED_LINE = /^(\(\s*[0-9]+[A-Za-z]?\s*\)|\(\s*[a-z]{1,4}\s*\)|\(\s*[ivxlc]+\s*\)|Provided|Explanation|Illustration)/;

/** Provision text split into paragraphs; the first runs on from the bold title. */
function ProvisionText({ text }: { text: string }) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const [first, ...rest] = lines;
  return (
    <>
      {first && (
        <>
          {"—"}
          {first}
        </>
      )}
      {rest.map((line, index) => (
        <span key={index} className={`block ${INDENTED_LINE.test(line) ? "pl-6 sm:pl-8" : ""}`}>
          {line}
        </span>
      ))}
    </>
  );
}

/** A full provision in the reader: bold "N. Title.—" running into the text, with its footnotes. */
function SectionBody({ section, label }: { section: ReadableSection; label: string }) {
  const href = toRoute(section.url);
  return (
    <article id={`s-${section.slug}`} className="scroll-mt-28">
      <div className="reader-text text-nx-ink">
        <Link href={href} className="font-semibold text-nx-ink hover:text-teal-700">
          {section.number}. {section.title}.
        </Link>
        {section.text ? (
          <ProvisionText text={section.text} />
        ) : (
          <span className="text-nx-muted">
            {" "}
            <Link href={href} className="font-medium text-nx-teal-deep hover:text-nx-teal-ink">
              Read the full text of {label.toLowerCase()} {section.number}
            </Link>
          </span>
        )}
      </div>
      {section.footnotes.length > 0 && (
        <ol className="mt-3 space-y-0.5 border-t border-nx-line pt-2.5 font-editorial text-[13.5px] leading-6 text-nx-muted">
          {section.footnotes.map((note, noteIndex) => (
            <li key={`${section.slug}-${noteIndex}-${note.marker}`} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-1">
              <sup className="pt-1 font-mono text-[10px] text-nx-teal-ink">{note.marker}</sup>
              <span>{note.text}</span>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

/**
 * Reading layout for an act: a sticky "Contents" list on the left covering
 * the preamble, every chapter and the schedules, and the selected part's
 * full text on the right with previous / next controls. Every part is in
 * the DOM (inactive ones are `hidden`) so crawlers and find-in-page still see
 * every provision. The selection follows the URL hash, so `#chapter-ii`
 * deep links keep working.
 */
export default function ChapterContents({ chapters, label, preamble, partsAfter, aside }: ChapterContentsProps) {
  const baseId = useId();

  const entries: Entry[] = [
    ...(preamble ? [{ kind: "preamble" as const, id: PREAMBLE_ID, preamble }] : []),
    ...chapters.map((chapter, index) => ({ kind: "chapter" as const, id: chapterId(chapter, index), chapter, index })),
  ];
  const total = entries.length;
  const [active, setActive] = useState(0);

  // Sync with the hash on load and whenever a "#chapter-…" link is followed.
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (!hash) return;
      const index = entries.findIndex((entry) => entry.id === hash);
      if (index >= 0) setActive(index);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
    // entries is rebuilt each render from stable props
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters, preamble]);

  function select(index: number) {
    const entry = entries[index];
    if (!entry) return;
    setActive(index);
    window.history.replaceState(null, "", `#${entry.id}`);
    const reader = document.getElementById(`${baseId}-reader`);
    reader?.querySelectorAll<HTMLElement>(".reader-panel").forEach((panel) => panel.scrollTo({ top: 0 }));
    reader?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  const previous = entries[active - 1];
  const next = entries[active + 1];
  const nameOf = (entry: Entry) => (entry.kind === "preamble" ? entry.preamble.title : chapterName(entry.chapter));

  const pagerButton =
    "inline-flex items-center gap-1.5 rounded-lg border border-nx-line bg-white px-3 py-2 text-sm font-medium text-nx-ink transition-colors hover:border-teal-300 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-nx-line disabled:hover:text-nx-ink";

  return (
    <div className="grid gap-8 lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start">
      {/* Left: contents */}
      <div className="space-y-5 lg:sticky lg:top-28">
        <nav aria-label="Contents" className="overflow-hidden rounded-2xl border border-nx-line bg-white">
          <div className="flex items-center justify-between border-b border-nx-line bg-nx-pale/60 px-4 py-3">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-nx-faint">Contents</p>
            <p className="font-mono text-[11px] text-nx-faint">
              {chapters.length} {chapters.length === 1 ? "chapter" : "chapters"}
            </p>
          </div>

          <ol role="tablist" aria-orientation="vertical" className="max-h-[calc(100vh-16rem)] overflow-y-auto p-2">
            {entries.map((entry, index) => {
              const on = index === active;
              const range = entry.kind === "chapter" ? sectionRange(entry.chapter, label) : null;
              const title = entry.kind === "chapter" ? entry.chapter.title : null;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    role="tab"
                    id={`${baseId}-tab-${index}`}
                    aria-selected={on}
                    aria-controls={`${baseId}-panel-${index}`}
                    onClick={() => select(index)}
                    className={`relative block w-full rounded-lg py-2.5 pl-4 pr-3 text-left transition-colors ${
                      on ? "bg-teal-50 text-teal-800" : "text-nx-ink hover:bg-nx-pale"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-nx-teal transition-opacity ${on ? "opacity-100" : "opacity-0"}`}
                    />
                    <span className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold">{nameOf(entry)}</span>
                      {range && <span className="font-mono text-[11px] text-nx-faint">&middot; {range}</span>}
                    </span>
                    {title && (
                      <span className={`mt-0.5 block text-[11px] uppercase leading-snug tracking-[0.06em] ${on ? "text-teal-700" : "text-nx-faint"}`}>
                        {title}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}

            {partsAfter.length > 0 && (
              <li className="mt-2 border-t border-nx-line pt-2">
                <p className="px-4 pb-1 pt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-nx-faint">Schedules</p>
                <ul>
                  {partsAfter.map((part) => (
                    <li key={part.slug}>
                      <Link
                        href={toRoute(part.url)}
                        className="group flex items-center justify-between gap-3 rounded-lg py-2 pl-4 pr-3 text-sm text-nx-ink transition-colors hover:bg-nx-pale hover:text-teal-700"
                      >
                        <span className="truncate font-medium">{part.title}</span>
                        <Icon name="ArrowUpRight" className="h-3.5 w-3.5 flex-none text-nx-faint group-hover:text-teal-700" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            )}
          </ol>
        </nav>

        {aside}
      </div>

      {/* Right: the selected part, full text */}
      <div id={`${baseId}-reader`} className="min-w-0 scroll-mt-28 overflow-hidden rounded-2xl border border-nx-line bg-white shadow-[0_1px_2px_rgba(16,20,19,0.04)]">
        <div className="flex items-center justify-between gap-3 border-b border-nx-line bg-nx-pale/60 px-3 py-2.5 sm:px-4">
          <button type="button" onClick={() => select(active - 1)} disabled={!previous} className={pagerButton}>
            <Icon name="ChevronLeft" className="h-4 w-4" />
            {previous ? nameOf(previous) : "Previous"}
          </button>
          <p className="font-mono text-xs text-nx-muted" aria-live="polite">
            {active + 1} of {total}
          </p>
          <button type="button" onClick={() => select(active + 1)} disabled={!next} className={pagerButton}>
            {next ? nameOf(next) : "Next"}
            <Icon name="ChevronRight" className="h-4 w-4" />
          </button>
        </div>

        {entries.map((entry, index) => {
          const on = index === active;
          const panelProps = {
            id: `${baseId}-panel-${index}`,
            role: "tabpanel",
            "aria-labelledby": `${baseId}-tab-${index}`,
            hidden: !on,
          };

          if (entry.kind === "preamble") {
            return (
              <section
                key={entry.id}
                {...panelProps}
                className="reader-panel h-[calc(100vh-17rem)] min-h-[22rem] overflow-y-auto overscroll-contain px-6 py-7 [scrollbar-width:thin] sm:px-10 sm:py-9"
              >
                <div id={entry.id} className="scroll-mt-28" />
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">{entry.preamble.title}</p>
                  <Link href={toRoute(entry.preamble.url)} className="inline-flex items-center gap-1 text-xs font-semibold text-nx-teal-deep hover:text-nx-teal-ink">
                    Open page
                    <Icon name="ArrowUpRight" className="h-3.5 w-3.5" />
                  </Link>
                </div>
                <p className="reader-text mt-5 text-nx-ink">{entry.preamble.text}</p>
              </section>
            );
          }

          const { chapter } = entry;
          return (
            <section
              key={entry.id}
              {...panelProps}
              className="reader-panel h-[calc(100vh-17rem)] min-h-[22rem] overflow-y-auto overscroll-contain px-6 py-7 [scrollbar-width:thin] sm:px-10 sm:py-9"
            >
              <div id={entry.id} className="scroll-mt-28" />
              {/* Centered chapter heading, as printed in the Gazette */}
              <header className="text-center">
                <h3 className="font-display text-xl font-semibold uppercase tracking-[0.06em] text-nx-ink">{chapterName(chapter)}</h3>
                {chapter.title && <p className="mt-1 font-editorial text-base uppercase tracking-[0.04em] text-nx-ink">{chapter.title}</p>}
                <p className="mt-2 font-mono text-[11px] text-nx-faint">
                  {chapter.sections.length} {label.toLowerCase()}
                  {chapter.sections.length === 1 ? "" : "s"}
                </p>
              </header>

              <div className="mt-7 space-y-6">
                {groupByHeading(chapter).map((group, groupIndex) => (
                  <div key={`${group.heading ?? "none"}-${groupIndex}`} className="space-y-7">
                    {group.heading && <h4 className="text-center font-editorial text-base italic text-nx-muted">{group.heading}</h4>}
                    {group.sections.map((section) => (
                      <SectionBody key={section.slug} section={section} label={label} />
                    ))}
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        {total > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-nx-line bg-nx-pale/40 px-4 py-2.5 text-sm sm:px-5">
            {previous ? (
              <button type="button" onClick={() => select(active - 1)} className="inline-flex items-center gap-1.5 font-medium text-nx-muted hover:text-teal-700">
                <Icon name="ChevronLeft" className="h-4 w-4" />
                {nameOf(previous)}
              </button>
            ) : (
              <span />
            )}
            {next && (
              <button type="button" onClick={() => select(active + 1)} className="inline-flex items-center gap-1.5 font-medium text-nx-teal-deep hover:text-nx-teal-ink">
                {nameOf(next)}
                <Icon name="ChevronRight" className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
