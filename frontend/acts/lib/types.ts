/** Shapes returned by bare-acts-service's public read API (/api/*). */

export type ProvisionType = "section" | "article";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface ListMeta {
  page: number;
  limit: number;
  total: number;
}

export interface Envelope<T, M = undefined> {
  data: T;
  meta?: M;
}

/** P1: GET /api/acts */
export interface ActSummary {
  title: string;
  short_name: string;
  slug: string;
  year: number;
  act_number: string | null;
  category: string | null;
  provision_type: ProvisionType;
  section_count: number;
  url: string;
  updated_at: string;
}

export interface ActsPage {
  acts: ActSummary[];
  meta: ListMeta;
}

export interface SectionLink {
  number: string;
  title: string;
  slug: string;
  heading: string | null;
  url: string;
}

export interface Chapter {
  number: string | null;
  title: string | null;
  sections: SectionLink[];
}

export type PartKind = "preamble" | "schedule" | "statement_of_objects" | "other";

export interface PartLink {
  kind: PartKind;
  title: string;
  slug: string;
  url: string;
}

/** P2: GET /api/acts/{act_slug} */
export interface ActDetail {
  title: string;
  short_name: string;
  slug: string;
  year: number;
  act_number: string | null;
  category: string | null;
  provision_type: ProvisionType;
  overview: string | null;
  overview_is_ai: boolean;
  meta_description: string;
  source_url: string | null;
  section_count: number;
  url: string;
  published_at: string;
  updated_at: string;
  preamble: { title: string; text: string; url: string } | null;
  chapters: Chapter[];
  parts_after: PartLink[];
}

export interface ActRef {
  title: string;
  short_name: string;
  slug: string;
  provision_type: ProvisionType;
}

export interface Footnote {
  marker: string;
  text: string;
}

export interface Faq {
  question: string;
  answer: string;
}

export interface QuickFacts {
  punishment: string | null;
  bailable: string | null;
  cognizable: string | null;
  triable_by: string | null;
  compoundable: string | null;
}

export interface LawLink {
  label: string;
  url: string | null;
}

export interface NeighbourLink {
  label: string;
  url: string;
}

/** P3: GET /api/acts/{act_slug}/sections/{section_slug} */
export interface SectionDetail {
  act: ActRef;
  chapter: { number: string | null; title: string | null } | null;
  heading: string | null;
  number: string;
  title: string;
  slug: string;
  url: string;
  text: string;
  footnotes: Footnote[];
  summary: string | null;
  summary_is_ai: boolean;
  key_points: string[] | null;
  faqs: Faq[] | null;
  change_note: string | null;
  meta_description: string;
  quick_facts: QuickFacts;
  old_law: LawLink[];
  new_law: LawLink[];
  related: LawLink[];
  prev: NeighbourLink | null;
  next: NeighbourLink | null;
  source_url: string | null;
  published_at: string;
  updated_at: string;
}

/** P4: GET /api/acts/{act_slug}/parts/{part_slug} */
export interface PartDetail {
  act: ActRef;
  kind: PartKind;
  title: string;
  slug: string;
  url: string;
  text: string;
  footnotes: Footnote[];
  meta_description: string;
  source_url: string | null;
  updated_at: string;
}

/** P5: GET /api/sitemap-entries */
export interface SitemapEntry {
  url: string;
  lastmod: string;
}

export interface SitemapPage {
  entries: SitemapEntry[];
  page: number;
  total: number;
  total_pages: number;
}

/** P6: GET /api/static-params */
export interface StaticParam {
  act_slug: string;
  section_slug: string;
}

/** P7: GET /api/search */
export interface SearchHit {
  type: string;
  act: { title: string; short_name: string; slug: string };
  number: string | null;
  title: string;
  label: string;
  url: string;
  snippet: string | null;
  exact: boolean;
}

export interface SearchResponse {
  data: SearchHit[];
  meta: { q: string; total: number };
}
