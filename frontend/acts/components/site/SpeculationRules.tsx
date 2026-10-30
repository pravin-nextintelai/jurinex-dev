import { BASE_PATH } from "@/lib/route";

/**
 * Links from these pages into the React app are full document loads (it is a
 * different application on the same domain). Speculation Rules ask Chromium to
 * prerender such a page in the background as soon as its link is hovered, so
 * the click swaps to an already rendered document with no loading state.
 * Browsers without support simply ignore the script. Pages inside this app are
 * left to Next's own <Link> prefetching.
 */
const RULES = {
  prerender: [
    {
      source: "document",
      where: {
        and: [
          { href_matches: "/*" },
          { not: { href_matches: [BASE_PATH, `${BASE_PATH}/*`] } },
          { not: { selector_matches: "[target=_blank]" } },
        ],
      },
      eagerness: "moderate",
    },
  ],
  prefetch: [
    {
      source: "document",
      where: {
        and: [{ href_matches: "/*" }, { not: { href_matches: [BASE_PATH, `${BASE_PATH}/*`] } }, { not: { selector_matches: "[target=_blank]" } }],
      },
      eagerness: "eager",
    },
  ],
};

export default function SpeculationRules() {
  return <script type="speculationrules" dangerouslySetInnerHTML={{ __html: JSON.stringify(RULES) }} />;
}
