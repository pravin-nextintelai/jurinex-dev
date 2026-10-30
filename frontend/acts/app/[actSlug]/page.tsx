import type { Metadata } from "next";
import Link from "next/link";
import { getAct, getStaticParamsSafe } from "@/lib/api";
import { absoluteUrl, appUrl, toRoute } from "@/lib/route";
import { formatDate, humanizeSlug, provisionLabel } from "@/lib/text";
import { breadcrumbList, legislation } from "@/lib/jsonld";
import type { Chapter } from "@/lib/types";
import { Icon } from "@/components/site/Icon";
import AiBadge from "@/components/AiBadge";
import Breadcrumbs from "@/components/Breadcrumbs";
import JsonLd from "@/components/JsonLd";
import SearchBox from "@/components/SearchBox";

export const dynamicParams = true;

type Params = { actSlug: string };

export async function generateStaticParams(): Promise<Params[]> {
  const params = await getStaticParamsSafe();
  const slugs = [...new Set(params.map((p) => p.act_slug))];
  return slugs.map((actSlug) => ({ actSlug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { actSlug } = await params;
  const act = await getAct(actSlug);
  const title = `${act.title} (${act.short_name}) – Bare Act Full Text`;
  const url = absoluteUrl(act.url);

  return {
    title: { absolute: title },
    description: act.meta_description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title,
      description: act.meta_description,
      url,
      modifiedTime: act.updated_at,
      publishedTime: act.published_at,
    },
  };
}

/** Sections grouped by their `heading`, preserving order. Sections without a heading form their own group. */
function groupByHeading(chapter: Chapter): { heading: string | null; sections: Chapter["sections"] }[] {
  const groups: { heading: string | null; sections: Chapter["sections"] }[] = [];
  for (const section of chapter.sections) {
    const last = groups[groups.length - 1];
    if (last && last.heading === section.heading) last.sections.push(section);
    else groups.push({ heading: section.heading, sections: [section] });
  }
  return groups;
}

const chapterId = (chapter: Chapter, index: number) => `chapter-${chapter.number ?? `general-${index}`}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");

export default async function ActPage({ params }: { params: Promise<Params> }) {
  const { actSlug } = await params;
  const act = await getAct(actSlug);
  const label = provisionLabel(act.provision_type);
  const url = absoluteUrl(act.url);

  // Sections outside any chapter (number: null) are listed first.
  const chapters = [...act.chapters].sort((a, b) => Number(a.number !== null) - Number(b.number !== null));
  const firstSection = chapters[0]?.sections[0];

  const jsonLd = [
    legislation({
      name: act.title,
      alternateName: act.short_name,
      legislationIdentifier: act.act_number ? `Act No. ${act.act_number} of ${act.year}` : null,
      legislationDate: act.year,
      url,
      dateModified: act.updated_at,
    }),
    breadcrumbList([
      { name: "Acts", url: appUrl("/") },
      { name: act.title, url },
    ]),
  ];

  const facts: { label: string; value: string }[] = [
    { label: "Short name", value: act.short_name },
    { label: "Year", value: String(act.year) },
    ...(act.act_number ? [{ label: "Act number", value: `${act.act_number} of ${act.year}` }] : []),
    ...(act.category ? [{ label: "Ministry", value: humanizeSlug(act.category) }] : []),
    { label: `${label}s`, value: String(act.section_count) },
    { label: "Last updated", value: formatDate(act.updated_at) },
  ];

  return (
    <article>
      <JsonLd data={jsonLd} />
      <Breadcrumbs items={[{ label: act.title }]} />

      {/* Title band */}
      <header className="mt-6 rounded-[2rem] border border-nx-line bg-nx-pale/70 px-6 py-8 sm:px-10 sm:py-10">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-md bg-white px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-nx-teal-ink ring-1 ring-teal-100">
            {act.short_name}
          </span>
          {act.act_number && (
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-nx-faint">
              Act No. {act.act_number} of {act.year}
            </span>
          )}
        </div>
        <h1 className="mt-4 max-w-4xl font-display text-3xl leading-tight text-nx-ink sm:text-4xl lg:text-5xl">{act.title}</h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-nx-muted">{act.meta_description}</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {firstSection && (
            <Link
              href={toRoute(firstSection.url)}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-teal-500/25 transition-colors hover:bg-teal-700"
            >
              Start reading
              <Icon name="ArrowRight" className="h-4 w-4" />
            </Link>
          )}
          {act.source_url && (
            <a
              href={act.source_url}
              rel="nofollow noopener"
              target="_blank"
              className="inline-flex items-center gap-2 rounded-lg border border-nx-ink/20 bg-white px-5 py-2.5 text-sm font-semibold text-nx-ink transition-colors hover:border-teal-600 hover:text-teal-700"
            >
              Official source
              <Icon name="ExternalLink" className="h-4 w-4" />
            </a>
          )}
        </div>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        {/* Main column */}
        <div className="min-w-0">
          {act.overview && (
            <section aria-labelledby="overview-heading" className="rounded-2xl border border-nx-line p-6 sm:p-8">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="overview-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
                  Overview
                </h2>
                {act.overview_is_ai && <AiBadge />}
              </div>
              <p className="mt-3 whitespace-pre-line leading-7 text-nx-ink">{act.overview}</p>
            </section>
          )}

          {act.preamble && (
            <section aria-labelledby="preamble-heading" className={`${act.overview ? "mt-8" : ""} rounded-2xl border border-nx-line bg-white p-6 sm:p-8`}>
              <h2 id="preamble-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
                <Link href={toRoute(act.preamble.url)} className="hover:text-teal-700">
                  {act.preamble.title}
                </Link>
              </h2>
              <p className="legal-text mt-3 text-nx-ink">{act.preamble.text}</p>
            </section>
          )}

          <section aria-labelledby="contents-heading" className={act.overview || act.preamble ? "mt-10" : ""}>
            <div className="flex items-end justify-between gap-4 border-b border-nx-line pb-3">
              <h2 id="contents-heading" className="font-display text-2xl text-nx-ink">
                Contents
              </h2>
              <p className="text-sm text-nx-muted">
                {chapters.length} {chapters.length === 1 ? "part" : "parts"} &middot; {act.section_count} {label.toLowerCase()}s
              </p>
            </div>

            <div className="mt-6 space-y-6">
              {chapters.map((chapter, chapterIndex) => (
                <section key={chapterId(chapter, chapterIndex)} id={chapterId(chapter, chapterIndex)} className="scroll-mt-28 rounded-2xl border border-nx-line">
                  {chapter.number !== null ? (
                    <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-nx-line bg-nx-pale/60 px-5 py-3 sm:px-6">
                      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-nx-teal-ink">Chapter {chapter.number}</span>
                      {chapter.title && <span className="font-display text-lg text-nx-ink">{chapter.title}</span>}
                    </h3>
                  ) : (
                    <h3 className="border-b border-nx-line bg-nx-pale/60 px-5 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-nx-teal-ink sm:px-6">
                      Preliminary
                    </h3>
                  )}
                  <div className="space-y-5 px-3 py-4 sm:px-4">
                    {groupByHeading(chapter).map((group, groupIndex) => (
                      <div key={`${group.heading ?? "none"}-${groupIndex}`}>
                        {group.heading && <h4 className="mb-1 px-2 font-body text-sm font-semibold italic text-nx-muted">{group.heading}</h4>}
                        <ol className="divide-y divide-nx-line/70">
                          {group.sections.map((section) => (
                            <li key={section.slug}>
                              <Link href={toRoute(section.url)} className="group flex items-baseline gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-teal-50">
                                <span className="w-24 flex-none font-mono text-xs text-nx-teal-ink">
                                  {label} {section.number}
                                </span>
                                <span className="min-w-0 flex-1 text-[15px] leading-snug text-nx-ink group-hover:text-teal-700">{section.title}</span>
                                <Icon name="ArrowRight" className="h-4 w-4 flex-none self-center text-nx-faint opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                              </Link>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>

          {act.parts_after.length > 0 && (
            <section aria-labelledby="schedules-heading" className="mt-10">
              <h2 id="schedules-heading" className="border-b border-nx-line pb-3 font-display text-2xl text-nx-ink">
                Schedules and annexures
              </h2>
              <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                {act.parts_after.map((part) => (
                  <li key={part.slug}>
                    <Link
                      href={toRoute(part.url)}
                      className="group flex items-center justify-between gap-3 rounded-xl border border-nx-line px-4 py-3.5 text-sm font-semibold text-nx-ink transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700"
                    >
                      {part.title}
                      <Icon name="ArrowRight" className="h-4 w-4 text-nx-faint transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-6 lg:sticky lg:top-28">
          <section aria-labelledby="facts-heading" className="rounded-2xl border border-nx-line bg-white p-5">
            <h2 id="facts-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
              At a glance
            </h2>
            <dl className="mt-3 divide-y divide-nx-line/70 text-sm">
              {facts.map((fact) => (
                <div key={fact.label} className="flex justify-between gap-4 py-2">
                  <dt className="text-nx-muted">{fact.label}</dt>
                  <dd className="text-right font-medium text-nx-ink">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {chapters.length > 1 && (
            <nav aria-labelledby="jump-heading" className="rounded-2xl border border-nx-line bg-white p-5">
              <h2 id="jump-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
                In this act
              </h2>
              <ol className="mt-3 max-h-80 space-y-1 overflow-y-auto text-sm">
                {chapters.map((chapter, index) => (
                  <li key={chapterId(chapter, index)}>
                    <a href={`#${chapterId(chapter, index)}`} className="block rounded-md px-2 py-1.5 text-nx-muted transition-colors hover:bg-teal-50 hover:text-teal-700">
                      {chapter.number !== null ? `Chapter ${chapter.number}` : "Preliminary"}
                      {chapter.title && <span className="block truncate text-xs text-nx-faint">{chapter.title}</span>}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}

          <section aria-label="Search" className="rounded-2xl border border-nx-line bg-nx-pale/60 p-5">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">Find a provision</p>
            <div className="mt-3">
              <SearchBox placeholder={`e.g. 1 ${act.short_name}`} />
            </div>
          </section>
        </aside>
      </div>
    </article>
  );
}
