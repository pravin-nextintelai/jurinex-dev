import { describe, expect, it } from "vitest";
import { breadcrumbList, collectionPage, faqPage, itemList, legislation, serializeJsonLd } from "@/lib/jsonld";
import { excerpt, provisionLabel, sanitizeSnippet, titleCase } from "@/lib/text";

describe("legislation", () => {
  it("builds an act-level Legislation object", () => {
    const out = legislation({
      name: "The Bharatiya Nyaya Sanhita, 2023",
      alternateName: "BNS",
      legislationIdentifier: "Act No. 45 of 2023",
      legislationDate: 2023,
      url: "https://example.com/acts/bns",
      dateModified: "2025-01-01T00:00:00Z",
    });

    expect(out).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Legislation",
      name: "The Bharatiya Nyaya Sanhita, 2023",
      alternateName: "BNS",
      legislationIdentifier: "Act No. 45 of 2023",
      legislationDate: "2023",
      legislationJurisdiction: "IN",
      url: "https://example.com/acts/bns",
      dateModified: "2025-01-01T00:00:00Z",
    });
    expect(out).not.toHaveProperty("isPartOf");
    expect(out).not.toHaveProperty("text");
  });

  it("nests isPartOf for a section and drops null fields", () => {
    const out = legislation({
      name: "Section 318 \u2013 Cheating",
      legislationIdentifier: "BNS Section 318",
      url: "https://example.com/acts/bns/section-318",
      text: "Whoever cheats",
      dateModified: null,
      alternateName: null,
      isPartOf: { name: "The Bharatiya Nyaya Sanhita, 2023", url: "https://example.com/acts/bns" },
    });

    expect(out.isPartOf).toEqual({
      "@type": "Legislation",
      name: "The Bharatiya Nyaya Sanhita, 2023",
      url: "https://example.com/acts/bns",
    });
    expect(out).not.toHaveProperty("dateModified");
    expect(out).not.toHaveProperty("alternateName");
  });
});

describe("breadcrumbList", () => {
  it("numbers positions from 1", () => {
    const out = breadcrumbList([
      { name: "Acts", url: "https://example.com/acts" },
      { name: "BNS", url: "https://example.com/acts/bns" },
    ]);
    expect(out.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Acts", item: "https://example.com/acts" },
      { "@type": "ListItem", position: 2, name: "BNS", item: "https://example.com/acts/bns" },
    ]);
  });
});

describe("faqPage / itemList / collectionPage", () => {
  it("maps FAQs to Question/Answer pairs", () => {
    const out = faqPage([{ question: "Is it bailable?", answer: "No." }]);
    expect(out["@type"]).toBe("FAQPage");
    expect(out.mainEntity).toEqual([
      { "@type": "Question", name: "Is it bailable?", acceptedAnswer: { "@type": "Answer", text: "No." } },
    ]);
  });

  it("builds an ItemList and embeds it in a CollectionPage", () => {
    const items = [{ name: "BNS", url: "https://example.com/acts/bns" }];
    expect(itemList(items)).toMatchObject({ "@type": "ItemList" });
    const page = collectionPage({ name: "Bare Acts", description: "d", url: "https://example.com/acts", items });
    expect(page["@type"]).toBe("CollectionPage");
    expect(page.mainEntity).toMatchObject({ "@type": "ItemList" });
    expect(page.mainEntity).not.toHaveProperty("@context");
  });
});

describe("serializeJsonLd", () => {
  it("escapes < so the JSON cannot break out of the script tag", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c/script>");
  });
});

describe("text helpers", () => {
  it("picks Article for article-based acts", () => {
    expect(provisionLabel("article")).toBe("Article");
    expect(provisionLabel("section")).toBe("Section");
    expect(provisionLabel(undefined)).toBe("Section");
  });

  it("title-cases schedule titles", () => {
    expect(titleCase("THE FIRST SCHEDULE")).toBe("The First Schedule");
    expect(titleCase("STATEMENT OF OBJECTS AND REASONS")).toBe("Statement of Objects and Reasons");
  });

  it("truncates excerpts at a word boundary", () => {
    const out = excerpt("word ".repeat(200), 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith("\u2026")).toBe(true);
  });

  it("keeps only <mark> in search snippets", () => {
    expect(sanitizeSnippet('<b>x</b> <mark>cheat</mark> <img src=x onerror="alert(1)">')).toBe(
      "&lt;b&gt;x&lt;/b&gt; <mark>cheat</mark> &lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });
});
