import PropTypes from "prop-types"
import { motion as Motion, useReducedMotion } from "framer-motion"
import * as Icons from "lucide-react"
import { EASE } from "./motionTokens"

/**
 * Resolves an icon name from constants to a lucide-react component.
 * Falls back to Sparkles so a typo never crashes the page.
 */
export const Icon = ({ name, className, strokeWidth = 1.75 }) => {
  const Cmp = Icons[name] || Icons.Sparkles
  return <Cmp className={className} strokeWidth={strokeWidth} aria-hidden="true" />
}

Icon.propTypes = {
  name: PropTypes.string.isRequired,
  className: PropTypes.string,
  strokeWidth: PropTypes.number,
}

/**
 * Scroll-reveal wrapper. Renders a plain div when the user prefers
 * reduced motion, so the page stays fully static for them.
 */
export const Reveal = ({ children, delay = 0, y = 22, className, as = "div" }) => {
  const reduce = useReducedMotion()
  const Tag = as
  if (reduce) return <Tag className={className}>{children}</Tag>
  const MotionTag = Motion[as] || Motion.div
  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-72px" }}
      transition={{ duration: 0.55, delay, ease: EASE }}
    >
      {children}
    </MotionTag>
  )
}

Reveal.propTypes = {
  children: PropTypes.node,
  delay: PropTypes.number,
  y: PropTypes.number,
  className: PropTypes.string,
  as: PropTypes.string,
}

/** Small uppercase label above a section heading. */
export const Eyebrow = ({ children, dark = false }) => (
  <p
    className={`text-xs font-semibold uppercase tracking-[0.16em] ${
      dark ? "text-white" : "text-nx-teal"
    }`}
  >
    {children}
  </p>
)

Eyebrow.propTypes = { children: PropTypes.node, dark: PropTypes.bool }

/**
 * Standard section header: eyebrow + serif heading + optional lede.
 */
export const SectionHeading = ({ eyebrow, title, lede, align = "center", dark = false, id }) => (
  <Reveal
    className={`max-w-3xl ${align === "center" ? "mx-auto text-center" : "text-left"}`}
  >
    {eyebrow && <Eyebrow dark={dark}>{eyebrow}</Eyebrow>}
    <h2
      id={id}
      className={`mt-3 font-display text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl ${
        dark ? "text-white" : "text-nx-ink"
      }`}
    >
      {title}
    </h2>
    {lede && (
      <p
        className={`mt-4 text-base leading-relaxed sm:text-lg ${
          dark ? "text-white/90" : "text-nx-muted"
        }`}
      >
        {lede}
      </p>
    )}
  </Reveal>
)

SectionHeading.propTypes = {
  eyebrow: PropTypes.node,
  title: PropTypes.node.isRequired,
  lede: PropTypes.node,
  align: PropTypes.oneOf(["center", "left"]),
  dark: PropTypes.bool,
  id: PropTypes.string,
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nx-teal active:scale-[0.98]"

/** Primary CTA button — filled teal pill. */
export const PrimaryButton = ({ children, onClick, className = "", ariaLabel }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    className={`${BUTTON_BASE} bg-nx-teal text-white shadow-md shadow-teal-500/25 hover:bg-nx-teal-deep ${className}`}
  >
    {children}
  </button>
)

/** Secondary button — thin outlined pill; `dark` variant for forest grounds. */
export const SecondaryButton = ({ children, onClick, dark = false, className = "", ariaLabel }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    className={`${BUTTON_BASE} ${
      dark
        ? "border border-white/40 bg-transparent text-white hover:bg-white/10"
        : "border border-gray-800 bg-transparent text-black hover:bg-gray-900 hover:text-white"
    } ${className}`}
  >
    {children}
  </button>
)

const buttonProps = {
  children: PropTypes.node,
  onClick: PropTypes.func,
  className: PropTypes.string,
  ariaLabel: PropTypes.string,
}
PrimaryButton.propTypes = buttonProps
SecondaryButton.propTypes = { ...buttonProps, dark: PropTypes.bool }

/** Rounded icon container used across feature/use-case cards. */
export const IconTile = ({ name, dark = false, size = "md" }) => (
  <span
    className={`inline-flex flex-none items-center justify-center rounded-xl ${
      size === "lg" ? "h-12 w-12" : "h-10 w-10"
    } ${dark ? "bg-white/15 text-white" : "bg-nx-teal/8 text-nx-teal"}`}
  >
    <Icon name={name} className={size === "lg" ? "h-6 w-6" : "h-5 w-5"} />
  </span>
)

IconTile.propTypes = {
  name: PropTypes.string.isRequired,
  dark: PropTypes.bool,
  size: PropTypes.oneOf(["md", "lg"]),
}
