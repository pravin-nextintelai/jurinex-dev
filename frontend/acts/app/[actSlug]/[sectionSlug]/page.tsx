import type { Metadata } from "next";
import Link from "next/link";
import { getSection, getStaticParamsSafe } from "@/lib/api";
import { absoluteUrl, appUrl, toRoute } from "@/lib/route";
import { excerpt, formatDate, provisionLabel } from "@/lib/text";
import { breadcrumbList, faqPage, legislation } from "@/lib/jsonld";
import type { LawLink, QuickFacts } from "@/lib/types";
import { Icon } from "@/components/site/Icon";
import AiBadge from "@/components/AiBadge";
import Breadcrumbs from "@/components/Breadcrumbs";
import FootnoteList from "@/components/FootnoteList";
import JsonLd from "@/components/JsonLd";
import PrevNext from "@/components/PrevNext";
import SearchBox from "@/components/SearchBox";

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">{children}</h2>;
}

function LawList({ title, items }: { title: string; items: LawLink[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title}>
      <SectionLabel>{title}</SectionLabel>
      <ul className="mt-3 flex flex-wrap gap-2 text-sm">
        {items.map((item) => (
          <li key={`${item.label}-${item.url ?? ""}`}>
            {item.url ? (
              <Link
                href={toRoute(item.url)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-nx-line bg-white px-3 py-1.5 font-medium text-nx-teal-deep transition-colors hover:border-teal-300 hover:bg-teal-50"
              >
                {item.label}
                <Icon name="ArrowUpRight" className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <span className="inline-block rounded-lg border border-nx-line bg-nx-pale/60 px-3 py-1.5 text-nx-muted">{item.label}</span>
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
  const actRoute = `/${section.act.slug}`;
  const actUrl = appUrl(actRoute);

  const quickFacts = (Object.keys(QUICK_FACT_LABELS) as (keyof QuickFacts)[])
    .map((key) => ({ key, label: QUICK_FACT_LABELS[key], value: section.quick_facts?.[key] ?? null }))
    .filter((row) => row.value !== null && row.value !== "");

  const hasRelated = section.old_law.length > 0 || section.new_law.length > 0 || section.related.length > 0;

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

  const crumbs = [{ label: section.act.title, href: actRoute }];
  if (section.chapter?.number) crumbs.push({ label: `Chapter ${section.chapter.number}`, href: actRoute });

  return (
    <article>
      <JsonLd data={jsonLd} />
      <Breadcrumbs items={crumbs} />

      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
        {/* Reading column */}
        <div className="min-w-0">
          <header>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-teal-50 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-nx-teal-ink ring-1 ring-teal-100">
                {label} {section.number}
              </span>
              <span className="inline-flex items-center rounded-md bg-nx-pale px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-nx-muted">
                {section.act.short_name}
              </span>
              {section.chapter?.number && (
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-nx-faint">
                  Chapter {section.chapter.number}
                  {section.chapter.title && <> &middot; {section.chapter.title}</>}
                </span>
              )}
            </div>
            {section.heading && <p className="mt-4 font-body text-sm font-semibold italic text-nx-muted">{section.heading}</p>}
            <h1 className="mt-2 font-display text-3xl leading-tight text-nx-ink sm:text-4xl">
              {label} {section.number}. {section.title}
            </h1>
            <p className="mt-3 text-sm text-nx-muted">
              <Link href={actRoute} className="font-medium text-nx-teal-deep hover:text-nx-teal-ink">
                {section.act.title}
              </Link>
            </p>
          </header>

          {/* 1. Text */}
          <div className="mt-8 rounded-2xl border border-nx-line bg-white px-6 py-7 shadow-[0_1px_2px_rgba(16,20,19,0.04)] sm:px-10 sm:py-9">
            <div className="legal-text max-w-[70ch] text-nx-ink">{section.text}</div>
            {/* 2. Footnotes */}
            <FootnoteList footnotes={section.footnotes} />
          </div>

          {/* 3. Summary */}
          {section.summary && (
            <section aria-labelledby="summary-heading" className="mt-8 rounded-2xl border border-teal-100 bg-teal-50/50 p-6 sm:p-8">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="summary-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-teal-ink">
                  Summary
                </h2>
                {section.summary_is_ai && <AiBadge />}
              </div>
              <p className="mt-3 whitespace-pre-line leading-7 text-nx-ink">{section.summary}</p>
            </section>
          )}

          {/* 4. Key points */}
          {section.key_points && section.key_points.length > 0 && (
            <section aria-labelledby="key-points-heading" className="mt-8">
              <h2 id="key-points-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
                Key points
              </h2>
              <ul className="mt-3 space-y-2.5">
                {section.key_points.map((point, index) => (
                  <li key={index} className="flex gap-3 leading-7 text-nx-ink">
                    <Icon name="CircleCheck" className="mt-1.5 h-4 w-4 flex-none text-nx-teal" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 5. Quick facts */}
          {quickFacts.length > 0 && (
            <section aria-labelledby="quick-facts-heading" className="mt-8">
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

          {/* 6. FAQs */}
          {section.faqs && section.faqs.length > 0 && (
            <section aria-labelledby="faqs-heading" className="mt-8">
              <h2 id="faqs-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
                Frequently asked questions
              </h2>
              <div className="mt-3 divide-y divide-nx-line rounded-xl border border-nx-line">
                {section.faqs.map((faq, index) => (
                  <details key={index} className="group px-4 py-3">
                    <summary className="flex cursor-pointer items-center justify-between gap-4 font-semibold text-nx-ink">
                      {faq.question}
                      <Icon name="Plus" className="h-4 w-4 flex-none text-nx-faint transition-transform group-open:rotate-45" />
                    </summary>
                    <p className="mt-2 leading-7 text-nx-muted">{faq.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          )}

          {/* 7. Old / new / related law */}
          {hasRelated && (
            <div className="mt-8 space-y-6 rounded-2xl border border-nx-line p-6">
              <LawList title="Corresponding old law" items={section.old_law} />
              <LawList title="Corresponding new law" items={section.new_law} />
              <LawList title="Related provisions" items={section.related} />
            </div>
          )}

          {/* 8. Change note */}
          {section.change_note && (
            <section aria-labelledby="change-note-heading" className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-5">
              <h2 id="change-note-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-800">
                Change note
              </h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-amber-900">{section.change_note}</p>
            </section>
          )}

          {/* 9. Previous / next */}
          <PrevNext prev={section.prev} next={section.next} />

          {/* 10. Source */}
          <aside className="mt-8 flex flex-col gap-2 border-t border-nx-line pt-5 text-sm text-nx-muted sm:flex-row sm:items-center sm:justify-between">
            {section.source_url ? (
              <a href={section.source_url} rel="nofollow noopener" target="_blank" className="inline-flex items-center gap-1.5 font-medium text-nx-teal-deep hover:text-nx-teal-ink">
                Official source
                <Icon name="ExternalLink" className="h-3.5 w-3.5" />
              </a>
            ) : (
              <span />
            )}
            <p>Last updated {formatDate(section.updated_at)}</p>
          </aside>
        </div>

        {/* Sidebar */}
        <aside className="space-y-6 lg:sticky lg:top-28">
          <section aria-labelledby="about-act-heading" className="rounded-2xl border border-nx-line bg-white p-5">
            <h2 id="about-act-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">
              This provision
            </h2>
            <dl className="mt-3 divide-y divide-nx-line/70 text-sm">
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-nx-muted">Act</dt>
                <dd className="text-right font-medium text-nx-ink">{section.act.short_name}</dd>
              </div>
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-nx-muted">{label}</dt>
                <dd className="text-right font-medium text-nx-ink">{section.number}</dd>
              </div>
              {section.chapter?.number && (
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-nx-muted">Chapter</dt>
                  <dd className="text-right font-medium text-nx-ink">{section.chapter.number}</dd>
                </div>
              )}
              {section.footnotes.length > 0 && (
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-nx-muted">Footnotes</dt>
                  <dd className="text-right font-medium text-nx-ink">{section.footnotes.length}</dd>
                </div>
              )}
            </dl>
            <Link
              href={actRoute}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-nx-ink/20 px-4 py-2 text-sm font-semibold text-nx-ink transition-colors hover:border-teal-600 hover:text-teal-700"
            >
              <Icon name="ListTree" className="h-4 w-4" />
              All {label.toLowerCase()}s of this act
            </Link>
          </section>

          {(section.prev || section.next) && (
            <nav aria-label="Nearby provisions" className="rounded-2xl border border-nx-line bg-white p-5 text-sm">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">Nearby</p>
              <ul className="mt-3 space-y-2">
                {section.prev && (
                  <li>
                    <Link href={toRoute(section.prev.url)} rel="prev" className="flex items-center gap-2 text-nx-muted hover:text-teal-700">
                      <Icon name="ArrowLeft" className="h-4 w-4" /> {section.prev.label}
                    </Link>
                  </li>
                )}
                {section.next && (
                  <li>
                    <Link href={toRoute(section.next.url)} rel="next" className="flex items-center gap-2 text-nx-muted hover:text-teal-700">
                      <Icon name="ArrowRight" className="h-4 w-4" /> {section.next.label}
                    </Link>
                  </li>
                )}
              </ul>
            </nav>
          )}

          <section aria-label="Search" className="rounded-2xl border border-nx-line bg-nx-pale/60 p-5">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">Find a provision</p>
            <div className="mt-3">
              <SearchBox placeholder={`e.g. ${section.number} ${section.act.short_name}`} />
            </div>
          </section>
        </aside>
      </div>
    </article>
  );
}
