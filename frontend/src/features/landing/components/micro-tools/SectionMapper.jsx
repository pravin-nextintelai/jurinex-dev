import { useState } from "react"
import {
  CODE_FILTERS,
  SAMPLE_PLEADING,
  SECTIONS,
  emptyHint,
  footnoteFor,
  newSectionText,
  popularSections,
  rewritePleadings,
  searchSections,
} from "../../utils/microToolsData"
import { Icon } from "../primitives"
import { BareActNote, DraftCta, ToolFrame, fieldClass, labelClass, useCopy } from "./ui"

const citeLine = (section) =>
  `Section ${section.old.section} ${section.old.code} → Section ${newSectionText(section)} ${section.neu.code}`

const SectionMapper = () => {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("all")
  const [selectedId, setSelectedId] = useState("ipc-420")
  const [pleading, setPleading] = useState("")
  const [rewrite, setRewrite] = useState(null)
  const { copied, copy } = useCopy()

  const searching = query.trim().length > 0
  const results = searching ? searchSections(query, filter) : null
  const selected = !searching
    ? SECTIONS.find((section) => section.id === selectedId)
    : results.find((section) => section.id === selectedId) || results[0] || null
  const list = searching ? results : popularSections()
  const year = selected?.neu.act.match(/\d{4}/)?.[0]
  const footnote = selected ? footnoteFor(selected) : ""

  const choose = (section) => setSelectedId(section.id)

  const updatePleading = () => {
    const next = rewritePleadings(pleading)
    setRewrite(next)
    if (next.replacements[0]) {
      setQuery("")
      setFilter("all")
      setSelectedId(next.replacements[0].row.id)
    }
  }

  return (
    <ToolFrame
      title="Instant IPC / CrPC / IEA ↔ BNS / BNSS / BSA section mapper"
      badge="Bare-Act correspondence"
      lede="Search a section from the old codes or the new ones. The result is the published correspondence, with a footnote you can paste into a draft."
      aside="Comparative tables · BNS · BNSS · BSA"
    >
      <div className="grid lg:grid-cols-2">
        <div className="border-b border-nx-line p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <label className={labelClass} htmlFor="code-filter">
            Select a code and search the section
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <select
              id="code-filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className={`${fieldClass} sm:w-52`}
            >
              {CODE_FILTERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g. 420, 438, 65B, 302"
              aria-label="Search a section number"
              className={fieldClass}
            />
          </div>

          <p className={`${labelClass} mt-6`}>{searching ? "Matches" : "Often cited"}</p>
          {searching && results.length > 1 && (
            <p className="mt-2 text-xs leading-relaxed text-nx-muted">
              This number is used in more than one code. Pick the row that names the Act you are citing.
            </p>
          )}
          {searching && results.length === 0 && (
            <p className="mt-3 rounded-lg border border-dashed border-nx-line bg-nx-pale/70 px-3 py-3 text-sm leading-relaxed text-nx-muted">
              {emptyHint(query)}
            </p>
          )}
          {list.length > 0 && (
            <ul className="mt-2 divide-y divide-nx-line">
              {list.map((section) => {
                const on = selected?.id === section.id
                return (
                  <li key={section.id}>
                    <button
                      type="button"
                      onClick={() => choose(section)}
                      aria-pressed={on}
                      className={`flex w-full items-center justify-between gap-3 py-2.5 text-left text-sm transition ${
                        on ? "font-semibold text-nx-teal" : "text-nx-ink hover:text-nx-teal"
                      }`}
                    >
                      <span>{citeLine(section)}</span>
                      <Icon name="ArrowRight" className="h-3.5 w-3.5 shrink-0" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <label className={`${labelClass} mt-6 block`} htmlFor="pleading-text">
            Or paste a pleading to update the sections
          </label>
          <textarea
            id="pleading-text"
            value={pleading}
            onChange={(event) => setPleading(event.target.value)}
            rows={5}
            placeholder={SAMPLE_PLEADING}
            className={`${fieldClass} mt-2 resize-y`}
          />
          <button
            type="button"
            onClick={() => setPleading(SAMPLE_PLEADING)}
            className="mt-2 text-xs font-semibold text-nx-teal hover:text-nx-teal-deep"
          >
            Use a sample pleading
          </button>
          <button
            type="button"
            onClick={updatePleading}
            disabled={!pleading.trim()}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-nx-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nx-teal disabled:cursor-not-allowed disabled:opacity-40"
          >
            Replace old sections with the BNS / BNSS / BSA equivalent
            <Icon name="ArrowRight" className="h-4 w-4" />
          </button>

          {rewrite && (
            <div className="mt-4 rounded-lg border border-teal-100 bg-teal-50/50 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className={labelClass}>
                  {rewrite.replacements.length
                    ? `${rewrite.replacements.length} section${rewrite.replacements.length === 1 ? "" : "s"} updated`
                    : "Nothing to update"}
                </p>
                {rewrite.replacements.length > 0 && (
                  <button
                    type="button"
                    onClick={() => copy("pleading", rewrite.text)}
                    className="text-xs font-semibold text-nx-teal hover:text-nx-teal-deep"
                  >
                    {copied === "pleading" ? "Copied" : "Copy text"}
                  </button>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-nx-ink">{rewrite.text}</p>
              {rewrite.missed.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs leading-relaxed text-nx-muted">
                  {rewrite.missed.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="bg-nx-pale/40 p-5 sm:p-6">
          {!selected && (
            <p className="text-sm leading-relaxed text-nx-muted">
              Search a section, or pick one from the list. The correspondence opens here.
            </p>
          )}
          {selected && (
            <div className="rounded-xl border border-nx-line bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="font-display text-lg font-semibold leading-snug text-nx-ink">{selected.title}</h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-800">
                  <Icon name="Check" className="h-3.5 w-3.5" />
                  In the comparative table
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-nx-teal/30 bg-white px-2 py-1 text-xs font-semibold text-nx-teal">
                  Section {selected.old.section} {selected.old.code}
                </span>
                <Icon name="ArrowRight" className="h-3.5 w-3.5 text-nx-faint" />
                <span className="rounded-md bg-nx-teal px-2 py-1 text-xs font-semibold text-white">
                  Section {newSectionText(selected)} {selected.neu.code}
                  {year ? <span className="font-medium text-white/80">, {year}</span> : null}
                </span>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-nx-line p-3">
                  <p className={labelClass}>{selected.punishment ? "Punishment" : "Statutory scope"}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-nx-ink">{selected.punishment || selected.scope}</p>
                </div>
                <div className="rounded-lg border border-nx-line p-3">
                  <p className={labelClass}>What changed</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-nx-ink">{selected.keyChange}</p>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-nx-line bg-nx-pale/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className={labelClass}>Ready-to-paste footnote</p>
                  <button
                    type="button"
                    onClick={() => copy("note", footnote)}
                    className="text-xs font-semibold text-nx-teal hover:text-nx-teal-deep"
                  >
                    {copied === "note" ? "Copied" : "Copy footnote"}
                  </button>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-nx-muted">{footnote}</p>
              </div>

              <div className="mt-4">
                <DraftCta text="Draft the petition in Jurinex from your papers, with this correspondence in the pleading." />
              </div>
              <div className="mt-3">
                <BareActNote />
              </div>
            </div>
          )}
        </div>
      </div>
    </ToolFrame>
  )
}

export default SectionMapper
