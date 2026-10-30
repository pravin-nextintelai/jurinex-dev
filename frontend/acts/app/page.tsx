import type { Metadata } from "next";
import Link from "next/link";
import { getActs } from "@/lib/api";
import { absoluteUrl, appUrl, toRoute } from "@/lib/route";
import { formatDate, humanizeSlug } from "@/lib/text";
import { breadcrumbList, collectionPage } from "@/lib/jsonld";
import { Icon } from "@/components/site/Icon";
import JsonLd from "@/components/JsonLd";
import Pagination from "@/components/Pagination";
import SearchBox from "@/components/SearchBox";

const LIMIT = 50;
const TITLE = "Bare Acts of India – Full Text of Central Acts";
const DESCRIPTION =
  "Read the full bare act text of Indian central acts – BNS, BNSS, BSA, Constitution and more – section by section.";

type SearchParams = Record<string, string | string[] | undefined>;

interface Filters {
  page: number;
  category: string;
  q: string;
}

function readFilters(params: SearchParams): Filters {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const pageRaw = Number.parseInt(first(params.page), 10);
  return {
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1,
    category: first(params.category).trim().slice(0, 100),
    q: first(params.q).trim().slice(0, 100),
  };
}

function hrefFor(filters: Filters, page: number): string {
  const qs = new URLSearchParams();
  if (page > 1) qs.set("page", String(page));
  if (filters.category) qs.set("category", filters.category);
  if (filters.q) qs.set("q", filters.q);
  const query = qs.toString();
  return query ? `/?${query}` : "/";
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const filters = readFilters(await searchParams);
  const filtered = Boolean(filters.q || filters.category);
  const title = filters.page > 1 ? `${TITLE} – Page ${filters.page}` : TITLE;
  const canonical = filters.page > 1 ? appUrl(`/?page=${filters.page}`) : appUrl("/");

  return {
    title: { absolute: title },
    description: DESCRIPTION,
    alternates: { canonical },
    robots: filtered ? { index: false, follow: true } : { index: true, follow: true },
    openGraph: { type: "website", title, description: DESCRIPTION, url: canonical },
  };
}

const PILLARS = [
  { icon: "ScrollText", title: "Official text", text: "Every provision is taken from India Code and linked back to its official source." },
  { icon: "ListTree", title: "Section by section", text: "Chapters, headings, footnotes and schedules, each on its own page with previous and next links." },
  { icon: "RefreshCw", title: "Kept current", text: "Amendments and renumberings are tracked, and old links redirect to the new provision." },
];

export default async function ActsListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = readFilters(await searchParams);
  const filtered = Boolean(filters.q || filters.category);
  const { acts, meta } = await getActs({
    page: filters.page,
    limit: LIMIT,
    category: filters.category || undefined,
    q: filters.q || undefined,
  });

  const categories = [...new Set(acts.map((act) => act.category).filter((c): c is string => Boolean(c)))];
  if (filters.category && !categories.includes(filters.category)) categories.unshift(filters.category);
  categories.sort();

  const latest = acts.map((a) => a.updated_at).sort().at(-1);

  const jsonLd = [
    collectionPage({
      name: TITLE,
      description: DESCRIPTION,
      url: filters.page > 1 ? appUrl(`/?page=${filters.page}`) : appUrl("/"),
      items: acts.map((act) => ({ name: act.title, url: absoluteUrl(act.url) })),
    }),
    breadcrumbList([{ name: "Acts", url: appUrl("/") }]),
  ];

  return (
    <>
      <JsonLd data={jsonLd} />

      {/* Hero */}
      <section className="relative -mx-5 overflow-hidden rounded-[2rem] bg-nx-forest px-5 py-14 text-white sm:-mx-8 sm:px-8 sm:py-20">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_80%_-20%,rgba(255,255,255,0.18),transparent)]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -left-20 h-72 w-72 rounded-full bg-nx-mint/20 blur-3xl" />
        <div className="relative mx-auto max-w-3xl text-center">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.28em] text-nx-mint">Jurinex Library</p>
          <h1 className="mt-4 font-display text-4xl leading-tight sm:text-5xl lg:text-6xl">Bare Acts of India</h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-white/85 sm:text-lg">{DESCRIPTION}</p>
          <div className="mx-auto mt-8 max-w-2xl text-left text-nx-ink">
            <SearchBox placeholder="Search a section or act, e.g. 318 BNS, cheating, Bills of Lading" />
          </div>
          <dl className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 font-mono text-[11px] uppercase tracking-[0.2em] text-white/75">
            <div className="flex items-center gap-2">
              <dt className="sr-only">Published acts</dt>
              <dd>
                <span className="text-lg font-semibold tracking-normal text-white">{meta.total}</span> {meta.total === 1 ? "act" : "acts"}
              </dd>
            </div>
            {latest && (
              <div className="flex items-center gap-2">
                <dt className="sr-only">Last updated</dt>
                <dd>Updated {formatDate(latest)}</dd>
              </div>
            )}
            <div className="flex items-center gap-2">
              <dt className="sr-only">Source</dt>
              <dd>Source: India Code</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Filter bar */}
      <section className="mt-10 flex flex-col gap-4 border-b border-nx-line pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-display text-2xl text-nx-ink">{filtered ? "Matching acts" : "All acts"}</h2>
          <p className="mt-1 text-sm text-nx-muted">
            {meta.total} {meta.total === 1 ? "act" : "acts"}
            {filters.q && (
              <>
                {" "}
                matching <strong className="font-semibold text-nx-ink">&ldquo;{filters.q}&rdquo;</strong>
              </>
            )}
            {filters.category && (
              <>
                {" "}
                in <strong className="font-semibold text-nx-ink">{humanizeSlug(filters.category)}</strong>
              </>
            )}
            {meta.total > LIMIT && <> &middot; page {meta.page} of {Math.ceil(meta.total / meta.limit)}</>}
          </p>
        </div>
        <form method="get" action="/acts" className="flex flex-wrap items-center gap-2 text-sm">
          {filters.q && <input type="hidden" name="q" value={filters.q} />}
          <label htmlFor="category" className="font-medium text-nx-muted">
            Ministry
          </label>
          <select
            id="category"
            name="category"
            defaultValue={filters.category}
            className="rounded-lg border border-nx-line bg-white px-3 py-2 text-nx-ink focus:border-teal-500 focus:outline-none"
          >
            <option value="">All ministries</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {humanizeSlug(category)}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-lg bg-nx-ink px-4 py-2 font-semibold text-white transition-colors hover:bg-teal-700">
            Apply
          </button>
          {filtered && (
            <Link href="/" className="px-2 py-2 font-medium text-nx-teal-deep hover:text-nx-teal-ink">
              Clear
            </Link>
          )}
        </form>
      </section>

      {/* Act cards */}
      {acts.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-nx-line p-12 text-center">
          <p className="font-display text-xl text-nx-ink">No acts match this view yet</p>
          <p className="mt-2 text-sm text-nx-muted">Try a different search, or clear the filter to see every published act.</p>
        </div>
      ) : (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {acts.map((act) => (
            <li key={act.slug}>
              <Link
                href={toRoute(act.url)}
                className="group flex h-full flex-col rounded-2xl border border-nx-line bg-white p-6 shadow-[0_1px_2px_rgba(16,20,19,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-[0_18px_40px_-24px_rgba(6,52,44,0.35)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center rounded-md bg-teal-50 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-nx-teal-ink ring-1 ring-teal-100">
                    {act.short_name}
                  </span>
                  <span className="font-mono text-xs text-nx-faint">
                    {act.act_number ? `No. ${act.act_number} of ${act.year}` : act.year}
                  </span>
                </div>
                <h3 className="mt-4 font-display text-xl leading-snug text-nx-ink group-hover:text-teal-700">{act.title}</h3>
                {act.category && <p className="mt-2 text-sm text-nx-muted">{humanizeSlug(act.category)}</p>}
                <div className="mt-auto flex items-center justify-between border-t border-nx-line pt-4 text-sm">
                  <span className="text-nx-muted">
                    {act.section_count} {act.provision_type === "article" ? "articles" : "sections"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-nx-teal-deep">
                    Read act
                    <Icon name="ArrowRight" className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Pagination page={meta.page} total={meta.total} limit={meta.limit} hrefFor={(n) => hrefFor(filters, n)} />

      {/* Pillars */}
      {!filtered && (
        <section aria-labelledby="pillars-heading" className="mt-16 border-t border-nx-line pt-12">
          <h2 id="pillars-heading" className="sr-only">
            About this library
          </h2>
          <ul className="grid gap-8 sm:grid-cols-3">
            {PILLARS.map((pillar) => (
              <li key={pillar.title} className="flex gap-4">
                <span className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-teal-50 text-nx-teal ring-1 ring-teal-100">
                  <Icon name={pillar.icon} className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-semibold text-nx-ink">{pillar.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-nx-muted">{pillar.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
