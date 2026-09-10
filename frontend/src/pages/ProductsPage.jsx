import { useEffect, useState } from "react"
import PropTypes from "prop-types"
import { useLocation, useNavigate } from "react-router-dom"
import { AnimatePresence, motion as Motion, useReducedMotion } from "framer-motion"
import PublicPageShell from "../components/landing/PublicPageShell"
import BookDemoModal from "../components/landing/BookDemoModal"
import CTASection from "../components/landing/CTASection"
import { ProductMock } from "../components/landing/ProductMocks"
import { EASE } from "../components/landing/motionTokens"
import { Eyebrow, Icon, Reveal, SectionHeading } from "../components/landing/primitives"
import {
  PRODUCTS,
  PRODUCTS_HERO,
  PRODUCT_MATRIX,
  PRODUCT_PRESETS,
  PRODUCT_PRESETS_COPY,
  STATS,
} from "../utils/landingConstants"

/** Scroll a product section into view, allowing for the fixed navbar. */
const scrollToProduct = (id, smooth) => {
  const el = document.getElementById(id)
  if (el) el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" })
}

/* ------------------------------------------------------------------ */
/* Hero: copy on a dark ground, then an interactive product switcher   */
/* ------------------------------------------------------------------ */

const ProductSwitcher = ({ onGo }) => {
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const [active, setActive] = useState(PRODUCTS[0].id)
  const product = PRODUCTS.find((p) => p.id === active)

  return (
    <div className="overflow-hidden rounded-3xl border border-nx-line bg-white shadow-[0_40px_90px_-40px_rgba(6,52,44,0.35)]">
      <div className="grid grid-cols-1 lg:grid-cols-[19rem_1fr]">
        {/* Product list */}
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label="Products"
          className="flex overflow-x-auto border-b border-nx-line bg-nx-pale/70 lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r"
        >
          {PRODUCTS.map((p) => {
            const selected = p.id === active
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(p.id)}
                onMouseEnter={() => setActive(p.id)}
                onFocus={() => setActive(p.id)}
                className={`relative flex min-w-[11rem] flex-1 items-start gap-3 px-5 py-4 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-nx-teal lg:min-w-0 lg:flex-none ${
                  selected ? "bg-white" : "hover:bg-white/60"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 w-[3px] bg-nx-teal transition-opacity ${
                    selected ? "opacity-100" : "opacity-0"
                  }`}
                />
                <span
                  className={`mt-0.5 inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg transition-colors ${
                    selected ? "bg-nx-teal text-white" : "bg-white text-nx-teal ring-1 ring-nx-line"
                  }`}
                >
                  <Icon name={p.icon} className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="font-display text-[11px] font-semibold text-nx-faint">{p.num}</span>
                    <span className={`text-sm font-semibold ${selected ? "text-nx-ink" : "text-nx-muted"}`}>
                      {p.name}
                    </span>
                  </span>
                  <span className="mt-1 hidden text-xs leading-snug text-nx-muted lg:block">{p.short}</span>
                </span>
              </button>
            )
          })}
          <div className="hidden flex-1 items-end px-5 pb-4 lg:flex">
            <p className="text-[11px] text-nx-faint">{PRODUCTS_HERO.hint}</p>
          </div>
        </div>

        {/* Preview */}
        <div className="relative bg-[radial-gradient(ellipse_at_top,rgba(13,148,136,0.10),transparent_60%)] p-5 sm:p-8">
          <AnimatePresence mode="wait" initial={false}>
            <Motion.div
              key={active}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: EASE }}
            >
              <ProductMock id={active} />
            </Motion.div>
          </AnimatePresence>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-nx-muted">
              <span className="font-semibold text-nx-ink">{product.name}.</span> {product.tagline}
            </p>
            <span className="flex flex-none items-center gap-5">
              <button
                type="button"
                onClick={() => onGo(product.id)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-nx-muted transition-colors hover:text-nx-ink"
              >
                Overview
                <Icon name="ArrowDown" className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => navigate(`/products/${product.id}`)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-nx-teal transition-colors hover:text-nx-teal-deep"
              >
                Full guide
                <Icon name="ArrowRight" className="h-4 w-4" />
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

ProductSwitcher.propTypes = { onGo: PropTypes.func.isRequired }

/* ------------------------------------------------------------------ */
/* Sticky jump bar under the navbar                                    */
/* ------------------------------------------------------------------ */

const JumpBar = ({ activeId, onGo }) => (
  <div className="sticky top-16 z-30 border-b border-nx-line bg-white/85 backdrop-blur">
    <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-5 py-2 sm:px-8 [scrollbar-width:none]">
      <span className="mr-3 hidden text-[11px] font-semibold uppercase tracking-[0.16em] text-nx-faint sm:block">
        Products
      </span>
      {PRODUCTS.map((p) => {
        const active = activeId === p.id
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onGo(p.id)}
            aria-current={active ? "true" : undefined}
            className={`inline-flex flex-none items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-nx-teal text-white" : "text-nx-muted hover:bg-nx-pale hover:text-nx-ink"
            }`}
          >
            <span className="font-display text-[11px] opacity-70">{p.num}</span>
            {p.name}
          </button>
        )
      })}
    </div>
  </div>
)

JumpBar.propTypes = { activeId: PropTypes.string, onGo: PropTypes.func.isRequired }

/* ------------------------------------------------------------------ */
/* One product section                                                 */
/* ------------------------------------------------------------------ */

const ProductSection = ({ product, index }) => {
  const navigate = useNavigate()
  const flip = index % 2 === 1

  return (
    <section
      id={product.id}
      className={`scroll-mt-28 py-20 sm:py-28 ${flip ? "bg-nx-pale" : "bg-white"}`}
      aria-labelledby={`${product.id}-heading`}
    >
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        {/* Header row */}
        <Reveal className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_minmax(0,28rem)] lg:items-end">
          <div>
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-nx-teal text-white shadow-md shadow-teal-500/25">
                <Icon name={product.icon} className="h-4.5 w-4.5" />
              </span>
              <Eyebrow>
                {product.num} · {product.name}
              </Eyebrow>
            </div>
            <h2
              id={`${product.id}-heading`}
              className="mt-4 max-w-2xl font-display text-3xl font-semibold leading-[1.12] tracking-tight text-nx-ink sm:text-[2.6rem]"
            >
              {product.tagline}
            </h2>
          </div>
          <p className="text-base leading-relaxed text-nx-muted lg:pb-1">{product.text}</p>
        </Reveal>

        {/* Facts strip */}
        <Reveal delay={0.05} className="mt-10 grid grid-cols-1 divide-y divide-nx-line overflow-hidden rounded-2xl border border-nx-line bg-white shadow-[0_12px_32px_-24px_rgba(13,60,55,0.25)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {product.facts.map((f) => (
            <div key={f.label} className="px-6 py-4">
              <p className="font-display text-xl font-semibold text-nx-ink">{f.value}</p>
              <p className="mt-0.5 text-xs uppercase tracking-[0.12em] text-nx-faint">{f.label}</p>
            </div>
          ))}
        </Reveal>

        {/* Body */}
        <div
          className={`mt-12 grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-14 ${
            flip ? "lg:[&>*:first-child]:order-2" : ""
          }`}
        >
          <Reveal className="lg:col-span-5">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-nx-faint">
              {product.stepsHeading}
            </h3>
            <ol className="mt-5 space-y-6">
              {product.steps.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <span className="mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-teal-50 font-display text-xs font-semibold text-nx-teal-deep ring-1 ring-teal-200">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-[15px] font-semibold text-nx-ink">{step.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-nx-muted">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>

            <h3 className="mt-10 text-[11px] font-semibold uppercase tracking-[0.16em] text-nx-faint">
              {product.outputsHeading}
            </h3>
            <ul className="mt-4 flex flex-wrap gap-2">
              {product.outputs.map((item) => (
                <li
                  key={item}
                  className="inline-flex items-center gap-1.5 rounded-full border border-nx-line bg-white px-3 py-1.5 text-[13px] text-nx-ink"
                >
                  <Icon name="Check" className="h-3.5 w-3.5 text-nx-teal" strokeWidth={2.4} />
                  {item}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => navigate(`/products/${product.id}`)}
              className="mt-8 inline-flex items-center gap-2 rounded-full border border-nx-teal px-5 py-2.5 text-sm font-semibold text-nx-teal-deep transition-colors hover:bg-nx-teal hover:text-white"
            >
              Read the full {product.name} guide
              <Icon name="ArrowRight" className="h-4 w-4" />
            </button>
          </Reveal>

          <Reveal delay={0.1} y={30} className="lg:sticky lg:top-32 lg:col-span-7">
            <ProductMock id={product.id} />
            <p className="mt-5 flex items-start gap-2.5 rounded-xl border border-teal-100 bg-teal-50 px-5 py-3.5 text-sm font-medium text-nx-teal-ink">
              <Icon name="Sparkles" className="mt-0.5 h-4 w-4 flex-none text-nx-teal" />
              <span>{product.highlight}</span>
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

ProductSection.propTypes = {
  product: PropTypes.object.isRequired,
  index: PropTypes.number.isRequired,
}

/* ------------------------------------------------------------------ */
/* Comparison matrix                                                   */
/* ------------------------------------------------------------------ */

const Cell = ({ value }) => {
  if (value === true)
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-teal-50 text-nx-teal">
        <Icon name="Check" className="h-3.5 w-3.5" strokeWidth={2.6} />
      </span>
    )
  if (value === false) return <span className="text-nx-faint">—</span>
  return <span className="text-xs font-semibold text-nx-teal-ink">{value}</span>
}

Cell.propTypes = { value: PropTypes.oneOfType([PropTypes.bool, PropTypes.string]) }

const MatrixSection = () => (
  <section className="border-t border-nx-line bg-white py-20 sm:py-28" aria-labelledby="matrix-heading">
    <div className="mx-auto max-w-7xl px-5 sm:px-8">
      <SectionHeading
        id="matrix-heading"
        eyebrow="At a glance"
        title="Which product does what"
        lede="Every product reads the same case memory. Here is what each one needs from you and what it gives back."
      />
      <Reveal className="mt-12 overflow-x-auto rounded-2xl border border-nx-line shadow-[0_12px_32px_-24px_rgba(13,60,55,0.25)]">
        <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
          <thead>
            <tr className="bg-nx-pale text-nx-ink">
              <th scope="col" className="px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-nx-faint">
                Capability
              </th>
              {PRODUCTS.map((p) => (
                <th key={p.id} scope="col" className="px-4 py-4 text-center">
                  <span className="inline-flex flex-col items-center gap-1.5">
                    <Icon name={p.icon} className="h-4 w-4 text-nx-teal" />
                    <span className="text-xs font-semibold">{p.name}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-nx-line">
            {PRODUCT_MATRIX.rows.map((row, i) => (
              <tr key={row.label} className={i % 2 ? "bg-nx-pale/60" : "bg-white"}>
                <th scope="row" className="px-5 py-3.5 font-medium text-nx-ink">
                  {row.label}
                </th>
                {row.values.map((v, j) => (
                  <td key={PRODUCTS[j].id} className="px-4 py-3.5 text-center">
                    <Cell value={v} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Reveal>
    </div>
  </section>
)

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

const PresetsSection = () => (
  <section className="bg-nx-pale py-20 sm:py-28" aria-labelledby="presets-heading">
    <div className="mx-auto max-w-7xl px-5 sm:px-8">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-16">
        <SectionHeading
          id="presets-heading"
          eyebrow={PRODUCT_PRESETS_COPY.eyebrow}
          title={PRODUCT_PRESETS_COPY.title}
          lede={PRODUCT_PRESETS_COPY.lede}
          align="left"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PRODUCT_PRESETS.map((group, i) => (
            <Reveal key={group.group} delay={i * 0.04}>
              <div className="h-full rounded-2xl border border-nx-line bg-white p-5 shadow-[0_12px_32px_-24px_rgba(13,60,55,0.2)]">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-nx-pale text-nx-teal">
                    <Icon name={group.icon} className="h-4 w-4" />
                  </span>
                  <p className="text-sm font-semibold text-nx-ink">{group.group}</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {group.items.map((item) => (
                    <span
                      key={item}
                      className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-nx-teal-ink ring-1 ring-teal-200"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
          <Reveal delay={0.25} className="sm:col-span-2">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-dashed border-nx-teal/40 px-5 py-4 text-sm text-nx-muted">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-nx-faint">
                Also proposed from the case
              </span>
              {PRODUCT_PRESETS_COPY.extras.map((x) => (
                <span key={x} className="inline-flex items-center gap-1.5 text-nx-ink">
                  <Icon name="Sparkles" className="h-3.5 w-3.5 text-nx-teal" />
                  {x}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  </section>
)

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

/**
 * Standalone /products page. A dark hero with an interactive product
 * switcher, a sticky jump bar, one section per product (facts, steps,
 * outputs and a miniature screen), a capability matrix, the preset
 * workflows and the shared call to action. Deep links such as
 * /products#ai-drafting scroll to the matching section.
 */
const ProductsPage = () => {
  const navigate = useNavigate()
  const { hash } = useLocation()
  const reduceMotion = useReducedMotion()
  const [demoOpen, setDemoOpen] = useState(false)
  const [activeId, setActiveId] = useState("")

  // Deep-link scrolling. The shell scrolls to top on mount, so wait a beat.
  useEffect(() => {
    const id = hash.replace("#", "")
    if (!id) return undefined
    const t = setTimeout(() => scrollToProduct(id, !reduceMotion), 80)
    return () => clearTimeout(t)
  }, [hash, reduceMotion])

  // Track which product section is in view for the jump bar.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveId(entry.target.id)
        })
      },
      { rootMargin: "-35% 0px -55% 0px", threshold: 0 }
    )
    PRODUCTS.forEach((p) => {
      const el = document.getElementById(p.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  const go = (id) => {
    scrollToProduct(id, !reduceMotion)
    window.history.replaceState(null, "", `#${id}`)
  }

  return (
    <PublicPageShell title="Products">
      {/* Hero */}
      <section className="relative overflow-hidden bg-nx-pale" aria-labelledby="products-heading">
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse 55% 60% at 15% 0%, rgba(13,148,136,0.14), transparent 60%), radial-gradient(ellipse 40% 50% at 90% 10%, rgba(153,246,228,0.35), transparent 65%)",
          }}
        />
        <div className="relative mx-auto max-w-7xl px-5 pb-0 pt-20 sm:px-8 sm:pt-24">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_minmax(0,24rem)] lg:items-end">
            <Reveal>
              <Eyebrow>{PRODUCTS_HERO.eyebrow}</Eyebrow>
              <h1
                id="products-heading"
                className="mt-4 max-w-3xl font-display text-4xl font-semibold leading-[1.08] tracking-tight text-nx-ink sm:text-5xl lg:text-[3.5rem]"
              >
                {PRODUCTS_HERO.title}
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-relaxed text-nx-muted sm:text-lg">
                {PRODUCTS_HERO.lede}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => navigate("/register")}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-nx-teal px-7 py-3 text-sm font-semibold text-white shadow-md shadow-teal-500/25 transition-all hover:bg-nx-teal-deep active:scale-[0.98]"
                >
                  Start Free Trial
                  <Icon name="ArrowRight" className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setDemoOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-nx-ink/30 bg-white px-7 py-3 text-sm font-semibold text-nx-ink transition-all hover:border-nx-teal hover:text-nx-teal-deep active:scale-[0.98]"
                >
                  Book a demo
                </button>
              </div>
            </Reveal>

            <Reveal delay={0.1} className="grid grid-cols-3 divide-x divide-nx-line rounded-2xl border border-nx-line bg-white shadow-[0_16px_40px_-24px_rgba(13,60,55,0.25)] lg:grid-cols-1 lg:divide-x-0 lg:divide-y">
              {STATS.map((s) => (
                <div key={s.label} className="px-4 py-4 sm:px-5">
                  <p className="font-display text-xl font-semibold text-nx-teal-deep sm:text-2xl">{s.value}</p>
                  <p className="mt-0.5 text-[11px] uppercase tracking-[0.12em] text-nx-faint">{s.label}</p>
                </div>
              ))}
            </Reveal>
          </div>

          <Reveal delay={0.15} y={30} className="relative z-10 mt-14 translate-y-16">
            <ProductSwitcher onGo={go} />
          </Reveal>
        </div>
      </section>

      {/* Spacer for the overlapping switcher, then the tagline */}
      <div className="bg-white pb-8 pt-24 sm:pt-28">
        <p className="mx-auto max-w-7xl px-5 text-center text-sm font-medium text-nx-muted sm:px-8">
          {PRODUCTS_HERO.tagline}
        </p>
      </div>

      <JumpBar activeId={activeId} onGo={go} />

      {PRODUCTS.map((p, i) => (
        <ProductSection key={p.id} product={p} index={i} />
      ))}

      <MatrixSection />
      <PresetsSection />
      <CTASection onBookDemo={() => setDemoOpen(true)} />

      <BookDemoModal isOpen={demoOpen} onClose={() => setDemoOpen(false)} />
    </PublicPageShell>
  )
}

export default ProductsPage
