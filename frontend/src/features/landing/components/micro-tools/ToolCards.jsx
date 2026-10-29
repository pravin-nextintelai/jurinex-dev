import PropTypes from "prop-types"
import { Link } from "react-router-dom"

const ToolCards = ({ tools, active }) => (
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {tools.map((tool) => {
      const on = tool.slug === active
      return (
        <Link
          key={tool.slug}
          to={tool.href}
          aria-current={on ? "page" : undefined}
          className={`flex h-full flex-col rounded-xl bg-white p-4 transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nx-teal ${
            on
              ? "border-2 border-nx-teal shadow-[0_12px_30px_-18px_rgba(8,163,147,0.65)]"
              : "border border-nx-line hover:border-teal-200"
          }`}
        >
          <span className="flex items-start justify-between gap-3">
            <span className={`text-[10px] font-bold uppercase tracking-[0.14em] ${on ? "text-nx-teal" : "text-nx-faint"}`}>
              {tool.kicker}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-nx-faint">{tool.pathLabel}</span>
          </span>
          <span className="mt-2 block text-sm font-semibold leading-snug text-nx-ink">{tool.title}</span>
          <span className="mt-2 block flex-1 text-xs leading-relaxed text-nx-muted">{tool.description}</span>
        </Link>
      )
    })}
  </div>
)

ToolCards.propTypes = {
  tools: PropTypes.arrayOf(PropTypes.object).isRequired,
  active: PropTypes.string.isRequired,
}

export default ToolCards
