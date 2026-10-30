/**
 * Tiny stand-in for bare-acts-service, for local development and smoke tests
 * when the real FastAPI service is not running.
 *
 *   node scripts/mock-backend.mjs            # listens on :8096
 *   PORT=9000 node scripts/mock-backend.mjs
 *
 * Implements P1 to P7 from docs/BARE_ACTS_API.md section 12 with two sample
 * acts, one moved slug (bns -> 301) and the envelope / error shapes.
 * It is not part of the production image.
 */
import http from "node:http";

const PORT = Number(process.env.PORT || 8096);
const API_KEY = process.env.BARE_ACTS_API_KEY || "";
const NOW = "2025-06-01T10:00:00Z";

const BNS = {
  title: "The Bharatiya Nyaya Sanhita, 2023",
  short_name: "BNS",
  slug: "bharatiya-nyaya-sanhita-2023",
  year: 2023,
  act_number: "45",
  category: "ministry-of-home-affairs",
  provision_type: "section",
};
const COI = {
  title: "The Constitution of India",
  short_name: "Constitution",
  slug: "constitution-of-india",
  year: 1950,
  act_number: null,
  category: "ministry-of-law-and-justice",
  provision_type: "article",
};

const sectionsOf = (act, numbers, chapter, heading = null) =>
  numbers.map((n) => ({
    number: String(n),
    title: `Provision ${n}`,
    slug: `section-${n}`,
    heading,
    url: `/acts/${act.slug}/section-${n}`,
    chapter,
  }));

const BNS_SECTIONS = [
  ...sectionsOf(BNS, [1, 2, 3], null),
  ...sectionsOf(BNS, [316, 317], { number: "XVII", title: "OF OFFENCES AGAINST PROPERTY" }, "Of criminal misappropriation"),
  ...sectionsOf(BNS, [318, 319], { number: "XVII", title: "OF OFFENCES AGAINST PROPERTY" }, "Of cheating"),
];
BNS_SECTIONS.find((s) => s.number === "318").title = "Cheating";

const COI_SECTIONS = sectionsOf(COI, [12, 13, 14, 21], { number: "III", title: "FUNDAMENTAL RIGHTS" });
COI_SECTIONS.find((s) => s.number === "21").title = "Protection of life and personal liberty";

const ACTS = [
  { ...BNS, sections: BNS_SECTIONS, parts: [
    { kind: "preamble", title: "Preamble", slug: "preamble", text: "An Act to consolidate and amend the provisions relating to offences and for matters connected therewith or incidental thereto." },
    { kind: "schedule", title: "THE FIRST SCHEDULE", slug: "first-schedule", text: "Section   Offence                 Punishment        Cognizable   Bailable   Court\n1         Title and extent        -                 -            -          -\n318       Cheating                3 years            Non-cognizable Bailable   Any Magistrate" },
  ] },
  { ...COI, sections: COI_SECTIONS, parts: [] },
];

const MOVED = { bns: BNS.slug };

const summary = (act) => ({
  title: act.title, short_name: act.short_name, slug: act.slug, year: act.year, act_number: act.act_number,
  category: act.category, provision_type: act.provision_type, section_count: act.sections.length,
  url: `/acts/${act.slug}`, updated_at: NOW,
});

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
const error = (res, status, code, message, headers) => json(res, status, { error: { code, message, details: null } }, headers);

const hits = new Map();

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname.replace(/\/+$/, "");
    const auth = req.headers["x-api-key"] || "";

    if (path !== "/api/search" && API_KEY && auth !== API_KEY) return error(res, 401, "UNAUTHORIZED", "bad api key");

    if (path === "/api/acts") {
      const page = Number(url.searchParams.get("page") || 1);
      const limit = Number(url.searchParams.get("limit") || 20);
      const category = url.searchParams.get("category");
      const q = (url.searchParams.get("q") || "").toLowerCase();
      let list = ACTS.map(summary);
      if (category) list = list.filter((a) => a.category === category);
      if (q) list = list.filter((a) => `${a.title} ${a.short_name}`.toLowerCase().includes(q));
      return json(res, 200, { data: list.slice((page - 1) * limit, page * limit), meta: { page, limit, total: list.length } });
    }

    if (path === "/api/sitemap-entries") {
      const entries = ACTS.flatMap((a) => [
        { url: `/acts/${a.slug}`, lastmod: NOW },
        ...a.sections.map((s) => ({ url: s.url, lastmod: NOW })),
        ...a.parts.map((p) => ({ url: `/acts/${a.slug}/schedules/${p.slug}`, lastmod: NOW })),
      ]);
      return json(res, 200, { data: { entries, page: 1, total: entries.length, total_pages: 1 } });
    }

    if (path === "/api/static-params") {
      return json(res, 200, { data: ACTS.flatMap((a) => a.sections.map((s) => ({ act_slug: a.slug, section_slug: s.slug }))) });
    }

    if (path === "/api/search") {
      const q = (url.searchParams.get("q") || "").trim();
      if (q.length < 2 || q.length > 100) return error(res, 422, "QUERY_TOO_SHORT", "q must be 2-100 characters");
      const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
      const count = (hits.get(ip) || 0) + 1;
      hits.set(ip, count);
      setTimeout(() => hits.set(ip, Math.max(0, (hits.get(ip) || 1) - 1)), 60_000);
      if (count > 30) return error(res, 429, "RATE_LIMITED", "30 requests per minute", { "retry-after": "60" });
      const words = q.toLowerCase().split(/\s+/);
      const data = ACTS.flatMap((a) =>
        a.sections
          .filter((s) => words.every((w) => `${s.number} ${s.title} ${a.short_name}`.toLowerCase().includes(w)))
          .map((s) => ({
            type: "section", act: { title: a.title, short_name: a.short_name, slug: a.slug }, number: s.number, title: s.title,
            label: `${a.provision_type === "article" ? "Article" : "Section"} ${s.number} ${a.short_name}`, url: s.url,
            snippet: `Whoever commits <mark>${s.title.toLowerCase()}</mark> shall be punished…`,
            exact: words.includes(s.number) && words.includes(a.short_name.toLowerCase()),
          })),
      );
      return json(res, 200, { data, meta: { q, total: data.length } });
    }

    const m = path.match(/^\/api\/acts\/([^/]+)(?:\/(sections|parts)\/([^/]+))?$/);
    if (!m) return error(res, 404, "NOT_FOUND", "no route");
    const [, actSlug, kind, childSlug] = m;

    if (MOVED[actSlug]) {
      const rest = kind ? `/${kind === "sections" ? "" : "schedules/"}${childSlug}`.replace("//", "/") : "";
      return json(res, 301, { data: { new_path: `/acts/${MOVED[actSlug]}${rest}` } });
    }
    const act = ACTS.find((a) => a.slug === actSlug);
    if (!act) return error(res, 404, "ACT_NOT_FOUND", "no such act");

    if (!kind) {
      const chapters = [];
      for (const s of act.sections) {
        const key = s.chapter ? s.chapter.number : null;
        let ch = chapters.find((c) => c.number === key);
        if (!ch) chapters.push((ch = { number: key, title: s.chapter ? s.chapter.title : null, sections: [] }));
        ch.sections.push({ number: s.number, title: s.title, slug: s.slug, heading: s.heading, url: s.url });
      }
      const preamble = act.parts.find((p) => p.kind === "preamble");
      return json(res, 200, { data: {
        ...summary(act), overview: null, overview_is_ai: false,
        meta_description: `${act.title} (${act.short_name}) – full bare act text, section by section.`,
        source_url: "https://www.indiacode.nic.in/", published_at: NOW,
        preamble: preamble ? { title: preamble.title, text: preamble.text, url: `/acts/${act.slug}/schedules/${preamble.slug}` } : null,
        chapters,
        parts_after: act.parts.filter((p) => p.kind !== "preamble").map((p) => ({ kind: p.kind, title: p.title, slug: p.slug, url: `/acts/${act.slug}/schedules/${p.slug}` })),
      } });
    }

    const actRef = { title: act.title, short_name: act.short_name, slug: act.slug, provision_type: act.provision_type };

    if (kind === "sections") {
      const i = act.sections.findIndex((s) => s.slug === childSlug);
      if (i < 0) return error(res, 404, "SECTION_NOT_FOUND", "no such section");
      const s = act.sections[i];
      const label = act.provision_type === "article" ? "Article" : "Section";
      const nb = (x) => (x ? { label: `${label} ${x.number}`, url: x.url } : null);
      const is318 = s.number === "318";
      return json(res, 200, { data: {
        act: actRef, chapter: s.chapter, heading: s.heading, number: s.number, title: s.title, slug: s.slug, url: s.url,
        text: `(1) Whoever, by deceiving any person¹, fraudulently or dishonestly induces the person so deceived to deliver any property to any person, is said to "${s.title.toLowerCase()}".\n(2) Whoever cheats shall be punished with imprisonment of either description for a term which may extend to three years, or with fine, or with both.`,
        footnotes: [{ marker: "1", text: "Subs. by Act 45 of 2023, s. 2, for \"any person\" (w.e.f. 1-7-2024)." }],
        summary: is318 ? "Section 318 defines cheating and sets out graded punishments." : null, summary_is_ai: is318,
        key_points: is318 ? ["Deception must induce delivery of property", "Punishable up to seven years in aggravated cases"] : null,
        faqs: is318 ? [{ question: "Is cheating under Section 318 BNS bailable?", answer: "Simple cheating is bailable; aggravated forms are not." }] : null,
        change_note: null,
        meta_description: `${label} ${s.number} ${act.short_name} – ${s.title}. Read the full bare act text with footnotes.`,
        quick_facts: { punishment: is318 ? "Up to 3 years, or fine, or both" : null, bailable: is318 ? "Yes" : null, cognizable: null, triable_by: null, compoundable: null },
        old_law: is318 ? [{ label: "IPC Section 415", url: null }, { label: "IPC Section 420", url: null }] : [], new_law: [], related: [],
        prev: nb(act.sections[i - 1]), next: nb(act.sections[i + 1]),
        source_url: "https://www.indiacode.nic.in/", published_at: NOW, updated_at: NOW,
      } });
    }

    const part = act.parts.find((p) => p.slug === childSlug);
    if (!part) return error(res, 404, "PART_NOT_FOUND", "no such part");
    return json(res, 200, { data: {
      act: actRef, kind: part.kind, title: part.title, slug: part.slug, url: `/acts/${act.slug}/schedules/${part.slug}`,
      text: part.text, footnotes: [], meta_description: `${part.title} of ${act.title} – full text.`,
      source_url: "https://www.indiacode.nic.in/", updated_at: NOW,
    } });
  })
  .listen(PORT, () => console.log(`mock bare-acts-service on http://localhost:${PORT}`));
