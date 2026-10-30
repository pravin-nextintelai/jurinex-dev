import { describe, expect, it } from "vitest";
import { absoluteUrl, appUrl, toRoute } from "@/lib/route";

describe("toRoute", () => {
  it("strips the leading /acts so Next's basePath does not double it", () => {
    expect(toRoute("/acts/bharatiya-nyaya-sanhita-2023")).toBe("/bharatiya-nyaya-sanhita-2023");
    expect(toRoute("/acts/bns/section-318")).toBe("/bns/section-318");
    expect(toRoute("/acts/bns/schedules/first-schedule")).toBe("/bns/schedules/first-schedule");
  });

  it("maps the index and query-only URLs to the root", () => {
    expect(toRoute("/acts")).toBe("/");
    expect(toRoute("/acts?page=2")).toBe("/?page=2");
    expect(toRoute("")).toBe("/");
  });

  it("leaves paths that do not start with /acts alone", () => {
    expect(toRoute("/bns/section-1")).toBe("/bns/section-1");
    expect(toRoute("bns/section-1")).toBe("/bns/section-1");
  });

  it("does not strip /acts from a slug that merely begins with the word", () => {
    expect(toRoute("/actsomething/x")).toBe("/actsomething/x");
  });

  it("accepts absolute URLs on our own host", () => {
    expect(toRoute("https://example.com/acts/bns/section-318?x=1")).toBe("/bns/section-318?x=1");
  });
});

describe("absoluteUrl / appUrl", () => {
  it("prefixes SITE_URL", () => {
    expect(absoluteUrl("/acts/bns")).toBe("https://example.com/acts/bns");
    expect(appUrl("/")).toBe("https://example.com/acts");
    expect(appUrl("/sitemap.xml")).toBe("https://example.com/acts/sitemap.xml");
    expect(appUrl("/?page=2")).toBe("https://example.com/acts/?page=2");
  });
});
