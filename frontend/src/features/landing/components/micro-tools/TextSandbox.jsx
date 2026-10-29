import { useState } from "react"
import { SAMPLE_PLEADING, rewritePleadings } from "../../utils/microToolsData"
import { BareActNote, DraftCta, ToolFrame, fieldClass, labelClass, useCopy } from "./ui"

const TextSandbox = () => {
  const [text, setText] = useState("")
  const [notice, setNotice] = useState("")
  const [result, setResult] = useState(null)
  const { copied, copy } = useCopy()

  const onFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (file.type.startsWith("image/")) {
      setNotice("This sandbox reads text. Copy the words out of the scan and paste them here.")
      return
    }
    const raw = await file.text()
    setNotice("")
    setText(raw.slice(0, 20000))
  }

  const run = () => {
    setNotice("")
    setResult(rewritePleadings(text))
  }

  return (
    <ToolFrame
      title="Vernacular FIR & 7/12 text sandbox"
      badge="Text in, sections updated"
      lede="Paste English, or text you have copied from a Marathi, Hindi, Tamil or Telugu scan. The sandbox rewrites section numbers it recognises. It does not read a photograph."
      aside="धारा · कलम · பிரிவு · సెక్షన్"
    >
      <div className="grid lg:grid-cols-2">
        <div className="border-b border-nx-line p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <label className={labelClass} htmlFor="fir-text">
            Paste the FIR, the 7/12 extract, or the pleading
          </label>
          <textarea
            id="fir-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={10}
            placeholder={SAMPLE_PLEADING}
            className={`${fieldClass} mt-2 resize-y`}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center rounded-lg border border-nx-line px-3 py-2 text-xs font-semibold text-nx-ink hover:border-nx-teal">
              Upload a text file
              <input type="file" accept=".txt,.text,text/plain,image/*" onChange={onFile} className="sr-only" />
            </label>
            <button
              type="button"
              onClick={() => {
                setNotice("")
                setText(SAMPLE_PLEADING)
              }}
              className="text-xs font-semibold text-nx-teal hover:text-nx-teal-deep"
            >
              Use a sample
            </button>
          </div>
          {notice && <p className="mt-3 text-sm leading-relaxed text-nx-muted">{notice}</p>}
          <button
            type="button"
            onClick={run}
            disabled={!text.trim()}
            className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-nx-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nx-teal disabled:cursor-not-allowed disabled:opacity-40"
          >
            Update the sections
          </button>
        </div>

        <div className="bg-nx-pale/40 p-5 sm:p-6">
          {!result && (
            <p className="text-sm leading-relaxed text-nx-muted">
              The updated text, and every section the sandbox could pair, will show here.
            </p>
          )}
          {result && (
            <div className="space-y-4">
              <div className="rounded-xl border border-nx-line bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className={labelClass}>Updated text</p>
                  <button
                    type="button"
                    onClick={() => copy("sandbox", result.text)}
                    className="text-xs font-semibold text-nx-teal hover:text-nx-teal-deep"
                  >
                    {copied === "sandbox" ? "Copied" : "Copy text"}
                  </button>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-nx-ink">{result.text}</p>
              </div>
              {result.replacements.length > 0 && (
                <ul className="space-y-2">
                  {result.replacements.map((item) => (
                    <li key={`${item.row.id}-${item.to}`} className="rounded-lg border border-nx-line bg-white px-3 py-2 text-sm text-nx-ink">
                      {item.to}
                    </li>
                  ))}
                </ul>
              )}
              {result.missed.length > 0 && (
                <ul className="space-y-1 text-sm leading-relaxed text-nx-muted">
                  {result.missed.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              {result.replacements.length === 0 && result.missed.length === 0 && (
                <p className="text-sm text-nx-muted">No section number in that text is in the table.</p>
              )}
              <DraftCta text="Once the sections are in the new codes, draft the full petition in Jurinex." />
              <BareActNote />
            </div>
          )}
        </div>
      </div>
    </ToolFrame>
  )
}

export default TextSandbox
