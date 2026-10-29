import { useState } from "react"
import PropTypes from "prop-types"
import { Link } from "react-router-dom"
import { Icon } from "../primitives"

export const fieldClass =
  "w-full rounded-lg border border-nx-line bg-white px-3 py-2.5 text-sm text-nx-ink shadow-sm outline-none transition placeholder:text-nx-faint focus:border-nx-teal focus:ring-2 focus:ring-nx-teal/20"

export const labelClass = "text-[11px] font-bold uppercase tracking-[0.14em] text-nx-faint"

export function useCopy() {
  const [copied, setCopied] = useState("")

  const copy = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      window.setTimeout(() => setCopied((current) => (current === key ? "" : current)), 1600)
    } catch {
      setCopied("error")
    }
  }

  return { copied, copy }
}

export const ToolFrame = ({ title, badge, lede, aside, children }) => (
  <section
    id="micro-tool"
    className="mt-6 overflow-hidden rounded-2xl border border-nx-line bg-white shadow-[0_20px_50px_-32px_rgba(16,20,19,0.55)]"
  >
    <header className="bg-nx-ink px-5 py-4 text-white sm:px-6 sm:py-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-display text-lg font-semibold leading-snug sm:text-xl">{title}</h1>
        {badge && (
          <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-nx-mint ring-1 ring-inset ring-white/15">
            {badge}
          </span>
        )}
      </div>
      {lede && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/75">{lede}</p>}
      {aside && <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">{aside}</p>}
    </header>
    {children}
  </section>
)

ToolFrame.propTypes = {
  title: PropTypes.string.isRequired,
  badge: PropTypes.string,
  lede: PropTypes.string,
  aside: PropTypes.string,
  children: PropTypes.node,
}

export const DraftCta = ({ text }) => (
  <div className="rounded-xl border border-teal-100 bg-teal-50/80 p-4">
    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-nx-teal">Need the full petition?</p>
    <p className="mt-1.5 text-sm leading-relaxed text-nx-ink">{text}</p>
    <Link
      to="/register"
      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-nx-teal px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-nx-teal-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nx-teal"
    >
      Start drafting free
      <Icon name="ArrowRight" className="h-4 w-4" />
    </Link>
  </div>
)

DraftCta.propTypes = { text: PropTypes.string.isRequired }

export const BareActNote = () => (
  <p className="text-xs leading-relaxed text-nx-faint">
    Drafting aid from the published comparative tables. Read the section in the bare Act before you file.
  </p>
)
