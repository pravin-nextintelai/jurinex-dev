import { useState } from "react"
import { CITATION_SHAPES, checkCitation } from "../../utils/microToolsData"
import { Icon } from "../primitives"
import { BareActNote, DraftCta, ToolFrame, fieldClass, labelClass } from "./ui"

const CHECKS = [
  "Name the court as it appears on the judgment.",
  "Name the coram: a Single Judge or a Division Bench, and the judges.",
  "Where you cite an offence, give the new section and the old section it corresponds to.",
  "Give the reporter citation and, where the court has issued one, the neutral citation.",
]

const CitationCheck = () => {
  const [value, setValue] = useState("(2024) 5 SCC 1")
  const [result, setResult] = useState(() => checkCitation("(2024) 5 SCC 1"))

  const run = (next = value) => setResult(checkCitation(next))

  return (
    <ToolFrame
      title="High Court bench line and citation check"
      badge="Shape of the citation"
      lede="This checks whether a citation is written in a reporter shape a court will recognise. It does not look the case up, and it does not confirm that the proposition is in the judgment."
      aside="SCC · AIR · neutral citations"
    >
      <div className="grid lg:grid-cols-2">
        <div className="border-b border-nx-line p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <label className={labelClass} htmlFor="citation-input">
            Paste one citation
          </label>
          <input
            id="citation-input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") run()
            }}
            placeholder="(2024) 5 SCC 1"
            className={`${fieldClass} mt-2`}
          />
          <button
            type="button"
            onClick={() => run()}
            disabled={!value.trim()}
            className="mt-3 inline-flex w-full items-center justify-center rounded-lg bg-nx-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nx-teal disabled:cursor-not-allowed disabled:opacity-40"
          >
            Check the citation
          </button>
          <p className={`${labelClass} mt-6`}>Shapes this check knows</p>
          <ul className="mt-2 divide-y divide-nx-line">
            {CITATION_SHAPES.map((shape) => (
              <li key={shape}>
                <button
                  type="button"
                  onClick={() => {
                    setValue(shape)
                    run(shape)
                  }}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-sm text-nx-ink hover:text-nx-teal"
                >
                  <span className="font-mono text-[13px]">{shape}</span>
                  <Icon name="ArrowRight" className="h-3.5 w-3.5 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-4 bg-nx-pale/40 p-5 sm:p-6">
          {result?.ok && (
            <div className="rounded-xl border border-nx-line bg-white p-4">
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-800">
                <Icon name="Check" className="h-3.5 w-3.5" />
                {result.label}
              </span>
              <p className="mt-3 font-mono text-sm text-nx-ink">{result.text}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2">
                {result.parts.map((part) => (
                  <div key={part.label} className="rounded-lg border border-nx-line px-3 py-2">
                    <dt className={labelClass}>{part.label}</dt>
                    <dd className="mt-1 text-sm font-semibold text-nx-ink">{part.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {result && !result.ok && (
            <div className="rounded-xl border border-nx-line bg-white p-4">
              <p className="text-sm font-semibold text-nx-ink">{result.reason}</p>
              <p className="mt-2 text-sm leading-relaxed text-nx-muted">
                Try one of the shapes on the left. A citation can be real and still fail this check if it uses a reporter that is not in the list.
              </p>
            </div>
          )}

          <div className="rounded-xl border border-nx-line bg-white p-4">
            <p className={labelClass}>Bench line, before the draft goes out</p>
            <ul className="mt-3 space-y-2">
              {CHECKS.map((item) => (
                <li key={item} className="flex gap-2 text-sm leading-relaxed text-nx-ink">
                  <Icon name="Check" className="mt-0.5 h-4 w-4 shrink-0 text-nx-teal" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <DraftCta text="For a citation checked against the judgment, use Jurinex citation research and then draft from it." />
          <BareActNote />
        </div>
      </div>
    </ToolFrame>
  )
}

export default CitationCheck
