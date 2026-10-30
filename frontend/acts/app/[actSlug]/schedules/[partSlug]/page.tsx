import type { Metadata } from "next";
import Link from "next/link";
import { getPart } from "@/lib/api";
import { absoluteUrl, appUrl } from "@/lib/route";
import { excerpt, formatDate, titleCase } from "@/lib/text";
import { breadcrumbList, legislation } from "@/lib/jsonld";
import { Icon } from "@/components/site/Icon";
import Breadcrumbs from "@/components/Breadcrumbs";
import FootnoteList from "@/components/FootnoteList";
import JsonLd from "@/components/JsonLd";
import SearchBox from "@/components/SearchBox";

export const dynamicParams = true;

type Params = { actSlug: string; partSlug: string };

const KIND_LABEL: Record<string, string> = {
  preamble: "Preamble",
  schedule: "Schedule",
  statement_of_objects: "Statement of Objects and Reasons",
  other: "Annexure",
};

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { actSlug, partSlug } = await params;
  const part = await getPart(actSlug, partSlug);
  const title = `${titleCase(part.title)} – ${part.act.title}`;
  const url = absoluteUrl(part.url);

  return {
    title: { absolute: title },
    description: part.meta_description,
    alternates: { canonical: url },
    openGraph: { type: "article", title, description: part.meta_description, url, modifiedTime: part.updated_at },
  };
}

export default async function PartPage({ params }: { params: Promise<Params> }) {
  const { actSlug, partSlug } = await params;
  const part = await getPart(actSlug, partSlug);
  const heading = part.kind === "preamble" ? "Preamble" : part.title;
  const url = absoluteUrl(part.url);
  const actRoute = `/${part.act.slug}`;
  const actUrl = appUrl(actRoute);

  const jsonLd = [
    legislation({
      name: `${titleCase(part.title)} – ${part.act.title}`,
      url,
      text: excerpt(part.text, 500),
      dateModified: part.updated_at,
      isPartOf: { name: part.act.title, url: actUrl },
    }),
    breadcrumbList([
      { name: "Acts", url: appUrl("/") },
      { name: part.act.title, url: actUrl },
      { name: titleCase(part.title), url },
    ]),
  ];

  return (
    <article>
      <JsonLd data={jsonLd} />
      <Breadcrumbs items={[{ label: part.act.title, href: actRoute }, { label: titleCase(part.title) }]} />

      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
        <div className="min-w-0">
          <header>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-teal-50 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-nx-teal-ink ring-1 ring-teal-100">
                {KIND_LABEL[part.kind] ?? "Annexure"}
              </span>
              <span className="inline-flex items-center rounded-md bg-nx-pale px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-nx-muted">
                {part.act.short_name}
              </span>
            </div>
            <h1 className="mt-4 font-display text-3xl leading-tight text-nx-ink sm:text-4xl">{heading}</h1>
            <p className="mt-3 text-sm text-nx-muted">
              <Link href={actRoute} className="font-medium text-nx-teal-deep hover:text-nx-teal-ink">
                {part.act.title}
              </Link>
            </p>
          </header>

          <div className="mt-8 rounded-2xl border border-nx-line bg-white shadow-[0_1px_2px_rgba(16,20,19,0.04)]">
            <div className={`${part.kind === "preamble" ? "legal-text" : "legal-pre"} px-6 py-7 text-nx-ink sm:px-10 sm:py-9`}>{part.text}</div>
            <div className="px-6 sm:px-10">
              <FootnoteList footnotes={part.footnotes} />
            </div>
            {part.footnotes.length > 0 && <div className="h-6" />}
          </div>

          <aside className="mt-8 flex flex-col gap-2 border-t border-nx-line pt-5 text-sm text-nx-muted sm:flex-row sm:items-center sm:justify-between">
            {part.source_url ? (
              <a href={part.source_url} rel="nofollow noopener" target="_blank" className="inline-flex items-center gap-1.5 font-medium text-nx-teal-deep hover:text-nx-teal-ink">
                Official source
                <Icon name="ExternalLink" className="h-3.5 w-3.5" />
              </a>
            ) : (
              <span />
            )}
            <p>Last updated {formatDate(part.updated_at)}</p>
          </aside>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-28">
          <section className="rounded-2xl border border-nx-line bg-white p-5 text-sm">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">Part of</p>
            <p className="mt-2 font-display text-lg leading-snug text-nx-ink">{part.act.title}</p>
            <Link
              href={actRoute}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-nx-ink/20 px-4 py-2 font-semibold text-nx-ink transition-colors hover:border-teal-600 hover:text-teal-700"
            >
              <Icon name="ArrowLeft" className="h-4 w-4" />
              Back to the act
            </Link>
          </section>

          <section aria-label="Search" className="rounded-2xl border border-nx-line bg-nx-pale/60 p-5">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-faint">Find a provision</p>
            <div className="mt-3">
              <SearchBox placeholder={`e.g. 1 ${part.act.short_name}`} />
            </div>
          </section>
        </aside>
      </div>
    </article>
  );
}
