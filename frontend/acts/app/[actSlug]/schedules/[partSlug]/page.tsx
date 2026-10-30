import type { Metadata } from "next";
import Link from "next/link";
import { getPart } from "@/lib/api";
import { absoluteUrl, appUrl } from "@/lib/route";
import { excerpt, titleCase } from "@/lib/text";
import { breadcrumbList, legislation } from "@/lib/jsonld";
import Breadcrumbs from "@/components/Breadcrumbs";
import FootnoteList from "@/components/FootnoteList";
import JsonLd from "@/components/JsonLd";
import SourceLink from "@/components/SourceLink";

export const dynamicParams = true;

type Params = { actSlug: string; partSlug: string };

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
  const actUrl = appUrl(`/${part.act.slug}`);

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
    <article className="mx-auto max-w-4xl">
      <JsonLd data={jsonLd} />
      <Breadcrumbs items={[{ label: part.act.title, href: `/${part.act.slug}` }, { label: titleCase(part.title) }]} />

      <header className="mt-6">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-teal-ink">{part.act.short_name}</p>
        <h1 className="mt-3 font-display text-3xl leading-tight text-nx-ink sm:text-4xl">{heading}</h1>
        <p className="mt-3 text-sm text-nx-muted">{part.act.title}</p>
      </header>

      <div className="legal-pre mt-8 rounded-xl border border-nx-line bg-nx-pale/40 p-5 text-nx-ink sm:p-6">{part.text}</div>

      <FootnoteList footnotes={part.footnotes} />

      <p className="mt-10 text-sm">
        <Link href={`/${part.act.slug}`} className="font-semibold text-nx-teal-deep hover:text-nx-teal-ink">
          &larr; Back to {part.act.title}
        </Link>
      </p>

      <SourceLink sourceUrl={part.source_url} updatedAt={part.updated_at} />
    </article>
  );
}
