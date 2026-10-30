/**
 * JSON-LD builders. Each returns a plain object that <JsonLd> serialises.
 * Every url must already be absolute (see absoluteUrl / appUrl).
 */

export type JsonLdObject = Record<string, unknown>;

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function breadcrumbList(items: BreadcrumbItem[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export interface LegislationInput {
  name: string;
  url: string;
  alternateName?: string | null;
  legislationIdentifier?: string | null;
  legislationDate?: string | number | null;
  legislationJurisdiction?: string;
  dateModified?: string | null;
  text?: string | null;
  isPartOf?: { name: string; url: string } | null;
}

export function legislation(input: LegislationInput): JsonLdObject {
  const out: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "Legislation",
    name: input.name,
    url: input.url,
    inLanguage: "en-IN",
    legislationJurisdiction: input.legislationJurisdiction ?? "IN",
  };
  if (input.alternateName) out.alternateName = input.alternateName;
  if (input.legislationIdentifier) out.legislationIdentifier = input.legislationIdentifier;
  if (input.legislationDate !== undefined && input.legislationDate !== null) {
    out.legislationDate = String(input.legislationDate);
  }
  if (input.dateModified) out.dateModified = input.dateModified;
  if (input.text) out.text = input.text;
  if (input.isPartOf) {
    out.isPartOf = { "@type": "Legislation", name: input.isPartOf.name, url: input.isPartOf.url };
  }
  return out;
}

export interface FaqInput {
  question: string;
  answer: string;
}

export function faqPage(faqs: FaqInput[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
}

export interface ItemListEntry {
  name: string;
  url: string;
}

function itemListBody(items: ItemListEntry[]): JsonLdObject {
  return {
    "@type": "ItemList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: item.url,
    })),
  };
}

export function itemList(items: ItemListEntry[]): JsonLdObject {
  return { "@context": "https://schema.org", ...itemListBody(items) };
}

export interface CollectionPageInput {
  name: string;
  description: string;
  url: string;
  items: ItemListEntry[];
}

export function collectionPage(input: CollectionPageInput): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: input.name,
    description: input.description,
    url: input.url,
    inLanguage: "en-IN",
    mainEntity: itemListBody(input.items),
  };
}

/** Serialise for a <script type="application/ld+json">; `<` is escaped so the JSON can never close the tag. */
export function serializeJsonLd(data: JsonLdObject | JsonLdObject[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
