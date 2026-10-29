import { useState } from "react"
import { LIMITATION_ARTICLES, filingDeadline } from "../../utils/microToolsData"
import { BareActNote, DraftCta, ToolFrame, fieldClass, labelClass } from "./ui"

const LimitationCalculator = () => {
  const [articleId, setArticleId] = useState("116a")
  const [start, setStart] = useState("")
  const [copyDays, setCopyDays] = useState("0")
  const [customDays, setCustomDays] = useState("90")
  const [excludeCopy, setExcludeCopy] = useState(false)

  const article = LIMITATION_ARTICLES.find((item) => item.id === articleId)
  const showCopy = article?.copy === true || (article?.copy == null && excludeCopy)
  const result = start
    ? filingDeadline({
        articleId,
        start,
        copyDays: Number(copyDays),
        customDays: Number(customDays),
        excludeCopy,
      })
    : null

  return (
    <ToolFrame
      title="Indian court limitation calculator"
      badge="Limitation Act, 1963"
      lede="Count the period in the Schedule from the date you enter. Time taken to obtain a certified copy is added for an appeal or a review, under Section 12(2)."
      aside="The starting day is not counted"
    >
      <div className="grid lg:grid-cols-2">
        <div className="border-b border-nx-line p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <label className={labelClass} htmlFor="limitation-article">
            What are you filing?
          </label>
          <select
            id="limitation-article"
            value={articleId}
            onChange={(event) => setArticleId(event.target.value)}
            className={`${fieldClass} mt-2`}
          >
            {LIMITATION_ARTICLES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} · {item.article}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs leading-relaxed text-nx-muted">Time runs from {article.from}.</p>

          {articleId === "custom" && (
            <div className="mt-4">
              <label className={labelClass} htmlFor="custom-days">
                Period in days
              </label>
              <input
                id="custom-days"
                inputMode="numeric"
                value={customDays}
                onChange={(event) => setCustomDays(event.target.value.replace(/[^\d]/g, ""))}
                className={`${fieldClass} mt-2`}
              />
              <label className="mt-3 flex items-start gap-2 text-sm text-nx-ink">
                <input
                  type="checkbox"
                  checked={excludeCopy}
                  onChange={(event) => setExcludeCopy(event.target.checked)}
                  className="mt-0.5 accent-nx-teal"
                />
                This is an appeal or a review, so exclude certified-copy time under Section 12(2).
              </label>
            </div>
          )}

          <label className={`${labelClass} mt-4 block`} htmlFor="limitation-start">
            Date the period runs from
          </label>
          <input
            id="limitation-start"
            type="date"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            className={`${fieldClass} mt-2`}
          />

          {article.copy === false && (
            <p className="mt-4 text-xs leading-relaxed text-nx-muted">
              Section 12(2) excludes certified-copy time for an appeal, a revision or a review. It does not apply to this entry.
            </p>
          )}
          {showCopy && (
            <div className="mt-4">
              <label className={labelClass} htmlFor="copy-days">
                Days taken to obtain the certified copy
              </label>
              <input
                id="copy-days"
                inputMode="numeric"
                value={copyDays}
                onChange={(event) => setCopyDays(event.target.value.replace(/[^\d]/g, ""))}
                className={`${fieldClass} mt-2`}
              />
              <p className="mt-2 text-xs leading-relaxed text-nx-muted">
                Section 12(2) excludes the time requisite for obtaining the copy. Enter the days between applying for it and receiving it.
              </p>
            </div>
          )}
        </div>

        <div className="bg-nx-pale/40 p-5 sm:p-6">
          {!result && (
            <p className="text-sm leading-relaxed text-nx-muted">
              Enter the date the period runs from. The last day for filing shows here.
            </p>
          )}
          {result?.error && (
            <p className="rounded-lg border border-dashed border-nx-line bg-white px-3 py-3 text-sm text-nx-muted">{result.error}</p>
          )}
          {result && !result.error && (
            <div className="space-y-4">
              <div className="rounded-xl border border-nx-line bg-white p-5">
                <p className={labelClass}>Last day for filing</p>
                <p className="mt-2 font-display text-3xl font-semibold text-nx-teal">{result.display}</p>
                <p className="mt-1 text-sm text-nx-muted">{result.weekday}</p>
                <p className="mt-4 text-sm leading-relaxed text-nx-ink">
                  {result.article.article}: {result.period}, running from {result.article.from}. The day you entered is not counted.
                  {result.useCopy && result.copies > 0
                    ? ` ${result.copies} certified-copy day${result.copies === 1 ? "" : "s"} ${result.copies === 1 ? "is" : "are"} added under Section 12(2).`
                    : ""}
                </p>
              </div>
              <p className="text-sm leading-relaxed text-nx-muted">
                If the court is closed on that day, Section 4 of the Limitation Act lets you file on the next day the court reopens. This count does not decide when time started, and it does not apply Section 5, Section 14 or Section 18 for you.
              </p>
              <DraftCta text="Once the last day is fixed, draft the filing in Jurinex." />
              <BareActNote />
            </div>
          )}
        </div>
      </div>
    </ToolFrame>
  )
}

export default LimitationCalculator
