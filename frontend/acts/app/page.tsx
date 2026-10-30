import type { Metadata } from "next";
import Link from "next/link";
import { getActs } from "@/lib/api";
import { absoluteUrl, appUrl, toRoute } from "@/lib/route";
import { humanizeSlug } from "@/lib/text";
import { breadcrumbList, collectionPage } from "@/lib/jsonld";
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

export default async function ActsListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = readFilters(await searchParams);
  const { acts, meta } = await getActs({
    page: filters.page,
    limit: LIMIT,
    category: filters.category || undefined,
    q: filters.q || undefined,
  });

  const categories = [...new Set(acts.map((act) => act.category).filter((c): c is string => Boolean(c)))];
  if (filters.category && !categories.includes(filters.category)) categories.unshift(filters.category);
  categories.sort();

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

      <header className="max-w-3xl">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-nx-teal-ink">Jurinex Library</p>
        <h1 className="mt-3 font-display text-4xl text-nx-ink sm:text-5xl">Bare Acts</h1>
        <p className="mt-4 text-lg leading-relaxed text-nx-muted">{DESCRIPTION}</p>
      </header>

      <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
        <SearchBox />
        <form method="get" action="/acts" className="flex flex-wrap items-center gap-2 text-sm">
          {filters.q && <input type="hidden" name="q" value={filters.q} />}
          <label htmlFor="category" className="font-medium text-nx-muted">
            Category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={filters.category}
            className="rounded-lg border border-nx-line bg-white px-3 py-2 text-nx-ink focus:border-teal-500 focus:outline-none"
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {humanizeSlug(category)}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-lg border border-nx-ink/30 px-4 py-2 font-semibold text-nx-ink hover:border-teal-600 hover:text-teal-700">
            Apply
          </button>
          {(filters.category || filters.q) && (
            <Link href="/" className="px-2 py-2 font-medium text-nx-teal-deep hover:text-nx-teal-ink">
              Clear
            </Link>
          )}
        </form>
      </div>

      {(filters.q || filters.category) && (
        <p className="mt-6 text-sm text-nx-muted">
          Showing {meta.total} act{meta.total === 1 ? "" : "s"}
          {filters.q && (
            <>
              {" "}
              matching <strong className="text-nx-ink">&ldquo;{filters.q}&rdquo;</strong>
            </>
          )}
          {filters.category && (
            <>
              {" "}
              in <strong className="text-nx-ink">{humanizeSlug(filters.category)}</strong>
            </>
          )}
          .
        </p>
      )}

      {acts.length === 0 ? (
        <p className="mt-10 rounded-xl border border-dashed border-nx-line p-8 text-center text-nx-muted">No published acts match this view yet.</p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {acts.map((act) => (
            <li key={act.slug}>
              <Link
                href={toRoute(act.url)}
                className="group flex h-full flex-col rounded-2xl border border-nx-line bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="rounded-md bg-teal-50 px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-nx-teal-ink">
                    {act.short_name}
                  </span>
                  <span className="font-mono text-xs text-nx-faint">{act.year}</span>
                </span>
                <span className="mt-3 font-display text-lg leading-snug text-nx-ink group-hover:text-teal-700">{act.title}</span>
                <span className="mt-auto pt-4 text-sm text-nx-muted">
                  {act.section_count} {act.provision_type === "article" ? "articles" : "sections"}
                  {act.category && <> &middot; {humanizeSlug(act.category)}</>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Pagination page={meta.page} total={meta.total} limit={meta.limit} hrefFor={(n) => hrefFor(filters, n)} />
    </>
  );
}
