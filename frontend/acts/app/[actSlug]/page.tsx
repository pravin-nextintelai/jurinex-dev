import type { Metadata } from "next";
import Link from "next/link";
import { getAct, getStaticParamsSafe } from "@/lib/api";
import { absoluteUrl, appUrl, toRoute } from "@/lib/route";
import { formatDate, provisionLabel } from "@/lib/text";
import { breadcrumbList, legislation } from "@/lib/jsonld";
import type { Chapter } from "@/lib/types";
import AiBadge from "@/components/AiBadge";
import Breadcrumbs from "@/components/Breadcrumbs";
import JsonLd from "@/components/JsonLd";
import SourceLink from "@/components/SourceLink";

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

/** Sections grouped by their `heading`, preserving order. Sections without a heading come as their own group. */
function groupByHeading(chapter: Chapter): { heading: string | null; sections: Chapter["sections"] }[] {
  const groups: { heading: string | null; sections: Chapter["sections"] }[] = [];
  for (const section of chapter.sections) {
    const last = groups[groups.length - 1];
    if (last && last.heading === section.heading) last.sections.push(section);
    else groups.push({ heading: section.heading, sections: [section] });
  }
  return groups;
}

export default async function ActPage({ params }: { params: Promise<Params> }) {
  const { actSlug } = await params;
  const act = await getAct(actSlug);
  const label = provisionLabel(act.provision_type);
  const url = absoluteUrl(act.url);

  // Sections outside any chapter (number: null) are listed first.
  const chapters = [...act.chapters].sort((a, b) => Number(a.number !== null) - Number(b.number !== null));

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

  return (
    <article>
      <JsonLd data={jsonLd} />
      <Breadcrumbs items={[{ label: act.title }]} />

      <header className="mt-6 max-w-3xl">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-teal-ink">
          {act.short_name}
          {act.act_number && <> &middot; Act No. {act.act_number} of {act.year}</>}
        </p>
        <h1 className="mt-3 font-display text-3xl leading-tight text-nx-ink sm:text-4xl">{act.title}</h1>
        <p className="mt-3 text-sm text-nx-muted">
          {act.section_count} {label.toLowerCase()}s &middot; Last updated {formatDate(act.updated_at)}
        </p>
      </header>

      {act.overview && (
        <section aria-labelledby="overview-heading" className="mt-8 max-w-3xl rounded-2xl border border-nx-line bg-nx-pale/60 p-6">
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
        <section aria-labelledby="preamble-heading" className="mt-8 max-w-3xl">
          <h2 id="preamble-heading" className="font-display text-xl text-nx-ink">
            <Link href={toRoute(act.preamble.url)} className="hover:text-teal-700">
              {act.preamble.title}
            </Link>
          </h2>
          <p className="legal-text mt-3 text-nx-ink">{act.preamble.text}</p>
        </section>
      )}

      <section aria-labelledby="contents-heading" className="mt-10">
        <h2 id="contents-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
          Contents
        </h2>

        <div className="mt-4 space-y-8">
          {chapters.map((chapter, chapterIndex) => (
            <section key={`${chapter.number ?? "none"}-${chapterIndex}`} className="rounded-2xl border border-nx-line p-5 sm:p-6">
              {chapter.number !== null && (
                <h3 className="font-display text-lg text-nx-ink">
                  Chapter {chapter.number}
                  {chapter.title && <> &ndash; {chapter.title}</>}
                </h3>
              )}
              <div className={chapter.number !== null ? "mt-4 space-y-5" : "space-y-5"}>
                {groupByHeading(chapter).map((group, groupIndex) => (
                  <div key={`${group.heading ?? "none"}-${groupIndex}`}>
                    {group.heading && (
                      <h4 className="mb-2 font-body text-sm font-semibold italic text-nx-muted">{group.heading}</h4>
                    )}
                    <ul className="grid gap-1 sm:grid-cols-2">
                      {group.sections.map((section) => (
                        <li key={section.slug}>
                          <Link href={toRoute(section.url)} className="group flex gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-teal-50">
                            <span className="flex-none font-mono text-xs text-nx-teal-ink">
                              {label} {section.number}.
                            </span>
                            <span className="text-nx-ink group-hover:text-teal-700">{section.title}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      {act.parts_after.length > 0 && (
        <section aria-labelledby="schedules-heading" className="mt-10">
          <h2 id="schedules-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
            Schedules and annexures
          </h2>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {act.parts_after.map((part) => (
              <li key={part.slug}>
                <Link href={toRoute(part.url)} className="block rounded-xl border border-nx-line px-4 py-3 text-sm font-semibold text-nx-ink transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700">
                  {part.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SourceLink sourceUrl={act.source_url} updatedAt={act.updated_at} />
    </article>
  );
}
