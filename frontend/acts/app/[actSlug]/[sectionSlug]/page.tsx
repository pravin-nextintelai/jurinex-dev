import type { Metadata } from "next";
import { getSection, getStaticParamsSafe } from "@/lib/api";
import { absoluteUrl, appUrl, toRoute } from "@/lib/route";
import { excerpt, provisionLabel } from "@/lib/text";
import { breadcrumbList, faqPage, legislation } from "@/lib/jsonld";
import type { LawLink, QuickFacts } from "@/lib/types";
import AiBadge from "@/components/AiBadge";
import Breadcrumbs from "@/components/Breadcrumbs";
import FootnoteList from "@/components/FootnoteList";
import JsonLd from "@/components/JsonLd";
import PrevNext from "@/components/PrevNext";
import SourceLink from "@/components/SourceLink";
import Link from "next/link";

export const dynamicParams = true;

type Params = { actSlug: string; sectionSlug: string };

export async function generateStaticParams(): Promise<Params[]> {
  const params = await getStaticParamsSafe();
  return params.map((p) => ({ actSlug: p.act_slug, sectionSlug: p.section_slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { actSlug, sectionSlug } = await params;
  const section = await getSection(actSlug, sectionSlug);
  const label = provisionLabel(section.act.provision_type);
  const title = `${label} ${section.number} ${section.act.short_name} – ${section.title}`;
  const url = absoluteUrl(section.url);

  return {
    title: { absolute: title },
    description: section.meta_description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title,
      description: section.meta_description,
      url,
      publishedTime: section.published_at,
      modifiedTime: section.updated_at,
    },
  };
}

const QUICK_FACT_LABELS: Record<keyof QuickFacts, string> = {
  punishment: "Punishment",
  bailable: "Bailable",
  cognizable: "Cognizable",
  triable_by: "Triable by",
  compoundable: "Compoundable",
};

function LawList({ id, title, items }: { id: string; title: string; items: LawLink[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
        {title}
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2 text-sm">
        {items.map((item) => (
          <li key={`${item.label}-${item.url ?? ""}`}>
            {item.url ? (
              <Link href={toRoute(item.url)} className="inline-block rounded-lg border border-nx-line px-3 py-1.5 font-medium text-nx-teal-deep transition-colors hover:border-teal-300 hover:bg-teal-50">
                {item.label}
              </Link>
            ) : (
              <span className="inline-block rounded-lg border border-nx-line px-3 py-1.5 text-nx-muted">{item.label}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function SectionPage({ params }: { params: Promise<Params> }) {
  const { actSlug, sectionSlug } = await params;
  const section = await getSection(actSlug, sectionSlug);
  const label = provisionLabel(section.act.provision_type);
  const url = absoluteUrl(section.url);
  const actUrl = appUrl(`/${section.act.slug}`);

  const quickFacts = (Object.keys(QUICK_FACT_LABELS) as (keyof QuickFacts)[])
    .map((key) => ({ key, label: QUICK_FACT_LABELS[key], value: section.quick_facts?.[key] ?? null }))
    .filter((row) => row.value !== null && row.value !== "");

  const jsonLd = [
    legislation({
      name: `${label} ${section.number} – ${section.title}`,
      legislationIdentifier: `${section.act.short_name} ${label} ${section.number}`,
      url,
      text: excerpt(section.text, 500),
      dateModified: section.updated_at,
      isPartOf: { name: section.act.title, url: actUrl },
    }),
    breadcrumbList([
      { name: "Acts", url: appUrl("/") },
      { name: section.act.title, url: actUrl },
      { name: `${label} ${section.number}`, url },
    ]),
    ...(section.faqs && section.faqs.length > 0 ? [faqPage(section.faqs)] : []),
  ];

  const crumbs = [{ label: section.act.title, href: `/${section.act.slug}` }];
  if (section.chapter?.number) crumbs.push({ label: `Chapter ${section.chapter.number}`, href: `/${section.act.slug}` });

  return (
    <article className="mx-auto max-w-3xl">
      <JsonLd data={jsonLd} />
      <Breadcrumbs items={crumbs} />

      <header className="mt-6">
        {section.heading && <p className="font-body text-sm font-semibold italic text-nx-muted">{section.heading}</p>}
        <h1 className="mt-2 font-display text-3xl leading-tight text-nx-ink sm:text-4xl">
          {label} {section.number}. {section.title}
        </h1>
        <p className="mt-3 text-sm text-nx-muted">
          {section.act.title}
          {section.chapter?.title && <> &middot; Chapter {section.chapter.number} &ndash; {section.chapter.title}</>}
        </p>
      </header>

      <div className="legal-text mt-8 max-w-[70ch] text-nx-ink">{section.text}</div>

      <FootnoteList footnotes={section.footnotes} />

      {section.summary && (
        <section aria-labelledby="summary-heading" className="mt-10 rounded-2xl border border-nx-line bg-nx-pale/60 p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="summary-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
              Summary
            </h2>
            {section.summary_is_ai && <AiBadge />}
          </div>
          <p className="mt-3 whitespace-pre-line leading-7 text-nx-ink">{section.summary}</p>
        </section>
      )}

      {section.key_points && section.key_points.length > 0 && (
        <section aria-labelledby="key-points-heading" className="mt-10">
          <h2 id="key-points-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
            Key points
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 leading-7 text-nx-ink">
            {section.key_points.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
        </section>
      )}

      {quickFacts.length > 0 && (
        <section aria-labelledby="quick-facts-heading" className="mt-10">
          <h2 id="quick-facts-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
            Quick facts
          </h2>
          <table className="mt-3 w-full border-collapse overflow-hidden rounded-xl border border-nx-line text-sm">
            <tbody>
              {quickFacts.map((row) => (
                <tr key={row.key} className="border-b border-nx-line last:border-b-0">
                  <th scope="row" className="w-40 bg-nx-pale/60 px-4 py-2.5 text-left font-semibold text-nx-muted">
                    {row.label}
                  </th>
                  <td className="px-4 py-2.5 text-nx-ink">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {section.faqs && section.faqs.length > 0 && (
        <section aria-labelledby="faqs-heading" className="mt-10">
          <h2 id="faqs-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
            Frequently asked questions
          </h2>
          <div className="mt-3 divide-y divide-nx-line rounded-xl border border-nx-line">
            {section.faqs.map((faq, index) => (
              <details key={index} className="group px-4 py-3">
                <summary className="flex cursor-pointer items-center justify-between gap-4 font-semibold text-nx-ink">
                  {faq.question}
                  <span aria-hidden="true" className="text-nx-faint transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-2 leading-7 text-nx-muted">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {(section.old_law.length > 0 || section.new_law.length > 0 || section.related.length > 0) && (
        <div className="mt-10 space-y-8">
          <LawList id="old-law-heading" title="Corresponding old law" items={section.old_law} />
          <LawList id="new-law-heading" title="Corresponding new law" items={section.new_law} />
          <LawList id="related-heading" title="Related provisions" items={section.related} />
        </div>
      )}

      {section.change_note && (
        <section aria-labelledby="change-note-heading" className="mt-10 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 id="change-note-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-800">
            Change note
          </h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-amber-900">{section.change_note}</p>
        </section>
      )}

      <PrevNext prev={section.prev} next={section.next} />
      <SourceLink sourceUrl={section.source_url} updatedAt={section.updated_at} />
    </article>
  );
}
