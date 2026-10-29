import PropTypes from "prop-types"
import { useNavigate } from "react-router-dom"
import PublicPageShell from "../components/PublicPageShell"
import { Icon, PrimaryButton, Reveal, SecondaryButton } from "../components/primitives"
import { COMPARE_COLUMNS, COMPARE_ROWS } from "../utils/compareData"

const cellTone = (cell, highlight) => {
  if (highlight) return "bg-teal-50 font-medium text-teal-900"
  if (cell.tone === "no") return "bg-rose-50/80 text-rose-800"
  if (cell.tone === "warn") return "bg-amber-50 text-amber-900"
  if (cell.tone === "muted") return "text-nx-faint"
  if (cell.tone === "yes") return "font-medium text-teal-800"
  return "text-nx-ink"
}

const CellBody = ({ cell }) => {
  const lines = cell.lines || [cell.text]
  const showCheck = cell.tone === "yes"
  const showCross = cell.tone === "no"
  return (
    <span className="flex items-start gap-2">
      {showCheck && (
        <Icon name="Check" className="mt-0.5 h-4 w-4 flex-none text-nx-teal" strokeWidth={2.4} />
      )}
      {showCross && <Icon name="X" className="mt-0.5 h-4 w-4 flex-none text-rose-600" strokeWidth={2.4} />}
      <span className="min-w-0">
        {lines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </span>
    </span>
  )
}

CellBody.propTypes = {
  cell: PropTypes.shape({
    tone: PropTypes.string,
    text: PropTypes.string,
    lines: PropTypes.arrayOf(PropTypes.string),
  }).isRequired,
}

/**
 * Standalone comparison for the Legal Hub item "Why Jurinex (Compare)".
 * Brand column uses the logo teal; the rest of the page follows the
 * landing type, borders and pale ground.
 */
const ComparePage = () => {
  const navigate = useNavigate()

  return (
    <PublicPageShell title="Why Jurinex">
      <section className="bg-nx-pale py-14 sm:py-20" aria-labelledby="compare-heading">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <Reveal className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-nx-teal">Compare</p>
            <h1
              id="compare-heading"
              className="mt-3 font-display text-3xl font-semibold leading-[1.15] tracking-tight text-nx-ink sm:text-4xl"
            >
              How Jurinex Compares to Indian &amp; Global Legal Tools
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-nx-muted sm:text-lg">
              Architecture, vernacular OCR, citation verification, Indian court formatting, data
              residency and published entry pricing — side by side.
            </p>
          </Reveal>

          <p className="mt-8 text-xs font-medium text-nx-faint sm:hidden">Swipe sideways to see every column.</p>

          <Reveal className="mt-3 overflow-hidden rounded-2xl border border-nx-line bg-white shadow-[0_24px_48px_-28px_rgba(13,60,55,0.35)] sm:mt-8">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                <caption className="sr-only">
                  How Jurinex compares with Claw, VakilAI, Nyayanidhi, NyayAssist, Manupatra, SCC
                  Online, Harvey and ChatGPT
                </caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="sticky left-0 z-20 bg-nx-ink px-4 py-4 text-xs font-semibold uppercase tracking-[0.08em] text-white"
                    >
                      Capability / Feature
                    </th>
                    {COMPARE_COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        scope="col"
                        className={`px-4 py-4 align-bottom text-sm font-semibold leading-tight ${
                          col.highlight ? "bg-nx-teal text-white" : "bg-nx-ink text-white"
                        }`}
                      >
                        {col.label}
                        {col.sub && (
                          <span className={`mt-0.5 block text-xs font-medium ${col.highlight ? "text-white/80" : "text-white/60"}`}>
                            {col.sub}
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map((row, index) => (
                    <tr key={row.feature} className={index % 2 === 1 ? "bg-nx-pale" : "bg-white"}>
                      <th
                        scope="row"
                        className={`sticky left-0 z-10 border-t border-nx-line px-4 py-4 text-left text-[13px] font-semibold leading-snug text-nx-ink ${
                          index % 2 === 1 ? "bg-nx-pale" : "bg-white"
                        }`}
                      >
                        {row.feature}
                      </th>
                      {COMPARE_COLUMNS.map((col) => {
                        const cell = row.cells[col.key]
                        return (
                          <td
                            key={col.key}
                            className={`border-t border-nx-line px-4 py-4 align-top text-[13px] leading-snug ${cellTone(
                              cell,
                              col.highlight
                            )}`}
                          >
                            <CellBody cell={cell} />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>

          <p className="mt-4 max-w-3xl text-xs leading-relaxed text-nx-faint">
            Jurinex prices are the published monthly plans (Lite, Plus and Pro). Other columns
            summarise publicly described products and list prices, which can change. “Unconfirmed”
            means the capability is not stated in public material.
          </p>

          <Reveal className="mt-12 flex flex-col gap-3 sm:flex-row">
            <PrimaryButton onClick={() => navigate("/register")} ariaLabel="Start a free Jurinex trial">
              Start Free Trial
            </PrimaryButton>
            <SecondaryButton
              onClick={() => navigate("/", { state: { scrollTo: "pricing" } })}
              ariaLabel="See Jurinex pricing"
            >
              See pricing
            </SecondaryButton>
          </Reveal>
        </div>
      </section>
    </PublicPageShell>
  )
}

export default ComparePage
