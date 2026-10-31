import type { Chapter, Footnote, SectionLink } from "@/lib/types";

/** A section link plus its full text, when the reader could fetch it. */
export interface ReadableSection extends SectionLink {
  text: string | null;
  footnotes: Footnote[];
}

/** A chapter whose sections carry their text. */
export interface ReadableChapter extends Omit<Chapter, "sections"> {
  sections: ReadableSection[];
}

/** Sections grouped by their `heading`, preserving order. Sections without a heading form their own group. */
export function groupByHeading<S extends SectionLink>(chapter: { sections: S[] }): { heading: string | null; sections: S[] }[] {
  const groups: { heading: string | null; sections: S[] }[] = [];
  for (const section of chapter.sections) {
    const last = groups[groups.length - 1];
    if (last && last.heading === section.heading) last.sections.push(section);
    else groups.push({ heading: section.heading, sections: [section] });
  }
  return groups;
}

/** Stable DOM id for a chapter, used for deep links like `#chapter-ii`. */
export const chapterId = (chapter: Pick<Chapter, "number">, index: number) =>
  `chapter-${chapter.number ?? `general-${index}`}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");

/** "Chapter II" or "Preliminary" for sections outside any chapter. */
export const chapterName = (chapter: Pick<Chapter, "number">) => (chapter.number !== null ? `Chapter ${chapter.number}` : "Preliminary");

/** "sections 4–7", "section 3" or null when the chapter is empty. */
export function sectionRange(chapter: { sections: SectionLink[] }, label: string): string | null {
  const first = chapter.sections[0]?.number;
  const last = chapter.sections[chapter.sections.length - 1]?.number;
  if (!first) return null;
  const noun = label.toLowerCase();
  return first === last ? `${noun} ${first}` : `${noun}s ${first}–${last}`;
}
