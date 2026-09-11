import { useEffect, useState } from "react"
import PropTypes from "prop-types"
import { Navigate, useNavigate, useParams } from "react-router-dom"
import PublicPageShell from "../components/landing/PublicPageShell"
import BookDemoModal from "../components/landing/BookDemoModal"
import { ProductMock } from "../components/landing/ProductMocks"
import { Icon, Reveal } from "../components/landing/primitives"
import { PRODUCTS } from "../utils/landingConstants"
import { PRODUCT_DETAILS } from "../utils/productDetails"
/* ------------------------------------------------------------------ */
/* Editorial primitives: paper ground, mono labels, display serif      */
/* ------------------------------------------------------------------ */

const PAPER = "bg-white"
const PAPER_ALT = "bg-nx-pale"
const RULE = "border-nx-line"

const Wrap = ({ children, className = "" }) => (
  <div className={`mx-auto max-w-6xl px-6 sm:px-10 ${className}`}>{children}</div>
)

Wrap.propTypes = { children: PropTypes.node, className: PropTypes.string }

/** "01 · HOW IT WORKS" style label with a hairline under it. */
const SectionLabel = ({ index, children }) => (
  <div className={`border-b ${RULE} pb-4`}>
    <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-nx-faint">
      <span className="text-nx-teal">{index}</span> · {children}
    </p>
  </div>
)

SectionLabel.propTypes = { index: PropTypes.string.isRequired, children: PropTypes.node }

/** Display headline: "A live look <em>at Ask.</em>" */
const Display = ({ children, className = "" }) => (
  <h2
    className={`font-editorial text-[2.9rem] font-normal leading-[1.02] tracking-[-0.02em] text-nx-ink sm:text-6xl lg:text-[4.6rem] [&_em]:italic [&_em]:text-nx-teal-deep ${className}`}
  >
    {children}
  </h2>
)

Display.propTypes = { children: PropTypes.node, className: PropTypes.string }

const Lede = ({ children, className = "" }) => (
  <p className={`font-editorial text-xl italic leading-relaxed text-nx-muted sm:text-2xl ${className}`}>{children}</p>
)

Lede.propTypes = { children: PropTypes.node, className: PropTypes.string }

const BlackButton = ({ children, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-nx-teal px-7 py-3.5 text-[15px] font-semibold text-white shadow-md shadow-teal-500/25 transition-colors hover:bg-nx-teal-deep"
  >
    {children}
  </button>
)

BlackButton.propTypes = { children: PropTypes.node, onClick: PropTypes.func }

/* ------------------------------------------------------------------ */
/* Hero screen: the mirrored app screen, full width                    */
/* ------------------------------------------------------------------ */

const Screen = ({ product }) => (
  <figure className={`overflow-hidden rounded-2xl border ${RULE} bg-white shadow-[0_40px_90px_-40px_rgba(6,52,44,0.4)]`}>
    <div className={`flex items-center justify-between border-b ${RULE} bg-nx-pale px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.28em] text-nx-faint`}>
      <span>Fig. {product.num} · {product.name}</span>
      <span>Illustrative data</span>
    </div>
    <div className="p-3 sm:p-5">
      <ProductMock id={product.id} />
    </div>
    <figcaption className={`border-t ${RULE} px-5 py-3.5 font-editorial text-[15px] italic leading-snug text-nx-muted`}>
      {product.short}
    </figcaption>
  </figure>
)

Screen.propTypes = { product: PropTypes.object.isRequired }

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

const Hero = ({ product, detail }) => {
  return (
    <section className={`${PAPER} overflow-hidden border-b ${RULE}`} aria-labelledby="product-heading">
      <Wrap className="py-16 sm:py-20">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 font-mono text-[11px] uppercase tracking-[0.28em] text-nx-faint">
          <span className="font-semibold text-nx-ink">{product.name}</span>
          <span>
            Product {product.num} of {String(PRODUCTS.length).padStart(2, "0")}
          </span>
          <span>Part of the Jurinex workspace</span>
        </div>

        <div className="mt-12 grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-12">
          <Reveal className="lg:col-span-5">
            <h1
              id="product-heading"
              className="font-editorial text-[4rem] font-normal italic leading-[0.95] tracking-[-0.03em] text-nx-ink sm:text-[5rem] lg:text-[4.75rem] xl:text-[5.25rem]"
            >
              {product.name}.
            </h1>
            <Lede className="mt-7">{product.tagline}</Lede>
            <p className="mt-6 max-w-xl text-[17px] leading-[1.7] text-nx-ink/85">{detail.lede}</p>
            <dl className={`mt-9 grid max-w-xl grid-cols-3 gap-5 border-t ${RULE} pt-6`}>
              {product.facts.map((f) => (
                <div key={f.label}>
                  <dt className="font-mono text-[9.5px] uppercase leading-snug tracking-[0.18em] text-nx-faint">{f.label}</dt>
                  <dd className="mt-1.5 font-editorial text-lg leading-tight text-nx-ink">{f.value}</dd>
                </div>
              ))}
            </dl>
          </Reveal>

          <Reveal delay={0.12} y={24} className="lg:col-span-7 lg:-mr-10 xl:-mr-24">
            <Screen product={product} />
          </Reveal>
        </div>
      </Wrap>
    </section>
  )
}

Hero.propTypes = {
  product: PropTypes.object.isRequired,
  detail: PropTypes.object.isRequired,
}

/* ------------------------------------------------------------------ */
/* Demo video: plays /videos/<id>.mp4 when present, else a placeholder */
/* ------------------------------------------------------------------ */

const VideoSection = ({ product, detail }) => {
  const [missing, setMissing] = useState(false)
  const src = detail.videoUrl || `/videos/${product.id}.mp4`
  const isEmbed = /youtube\.com|youtu\.be|vimeo\.com/.test(src)

  return (
    <section className={`${PAPER_ALT} border-b ${RULE}`} aria-labelledby="video-heading">
      <Wrap className="py-20 sm:py-28">
        <SectionLabel index="00">See {product.name} in action</SectionLabel>
        <Display className="mt-12">
          <span id="video-heading">
            A live look <em>at {product.name}.</em>
          </span>
        </Display>
        <Lede className="mt-8">{detail.liveLede}</Lede>

        <Reveal delay={0.1} y={30} className="mt-14">
          <div className={`overflow-hidden rounded-2xl border ${RULE} bg-white shadow-[0_40px_90px_-40px_rgba(6,52,44,0.4)]`}>
            <div className={`flex items-center justify-between border-b ${RULE} bg-nx-pale px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.28em] text-nx-faint`}>
              <span>Demo · {product.name}</span>
              <span>{missing ? "Recording coming soon" : "Walkthrough"}</span>
            </div>
            <div className="relative aspect-video bg-nx-ink">
              {isEmbed ? (
                <iframe
                  src={src}
                  title={`${product.name} demo video`}
                  className="absolute inset-0 h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : !missing ? (
                <video
                  key={src}
                  className="absolute inset-0 h-full w-full"
                  src={src}
                  controls
                  playsInline
                  preload="metadata"
                  poster={`/videos/${product.id}.jpg`}
                  onError={() => setMissing(true)}
                  aria-label={`${product.name} demo video`}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center p-6 sm:p-10">
                  <div className="w-full max-w-4xl opacity-90">
                    <ProductMock id={product.id} />
                  </div>
                  <span className="pointer-events-none absolute inset-0 bg-nx-ink/45" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => setMissing(false)}
                    aria-label="Try loading the demo video again"
                    className="absolute inline-flex h-20 w-20 items-center justify-center rounded-full bg-white/95 text-nx-teal shadow-xl transition-transform hover:scale-105"
                  >
                    <Icon name="Play" className="ml-1 h-8 w-8" strokeWidth={2} />
                  </button>
                  <span className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/95 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.24em] text-nx-ink">
                    Demo recording coming soon
                  </span>
                </div>
              )}
            </div>
          </div>
        </Reveal>
      </Wrap>
    </section>
  )
}

VideoSection.propTypes = { product: PropTypes.object.isRequired, detail: PropTypes.object.isRequired }

const NUMBER_WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"]

const Steps = ({ detail }) => (
  <section className={`${PAPER} border-b ${RULE}`} aria-labelledby="steps-heading">
    <Wrap className="py-20 sm:py-28">
      <SectionLabel index="01">How it works</SectionLabel>
      <Display className="mt-12">
        <span id="steps-heading">
          {NUMBER_WORDS[detail.steps.length]} steps, <em>start to finish.</em>
        </span>
      </Display>
      <Lede className="mt-8">Each step is a screen in the app. The line under each one lists what you will see there.</Lede>

      <div className={`mt-16 border-t ${RULE}`}>
        {detail.steps.map((step, i) => (
          <Reveal key={step.title} delay={i * 0.03}>
            <div className={`grid grid-cols-[3.5rem_1fr] gap-6 border-b ${RULE} py-10 sm:grid-cols-[6rem_1fr] sm:gap-10`}>
              <span className="font-editorial text-4xl leading-none text-nx-teal sm:text-5xl">{String(i + 1).padStart(2, "0")}</span>
              <div className="max-w-3xl">
                <h3 className="font-editorial text-[1.75rem] leading-tight text-nx-ink sm:text-[2rem]">{step.title}</h3>
                <p className="mt-4 text-[16px] leading-[1.7] text-nx-ink/85">{step.text}</p>
                {step.screen && (
                  <div className={`mt-6 border-y ${RULE} py-4`}>
                    <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-nx-faint">On screen</p>
                    <p className="mt-2 font-editorial text-lg leading-snug text-nx-ink">{step.screen.join("  ·  ")}</p>
                  </div>
                )}
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      {/* Pipeline strip */}
      <div className="mt-14">
        <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-nx-faint">{detail.pipeline.heading}</p>
        {detail.pipeline.note && <p className="mt-3 max-w-3xl font-editorial text-lg italic text-nx-muted">{detail.pipeline.note}</p>}
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
          {detail.pipeline.items.map((item, i, arr) => (
            <span key={item} className="flex items-center gap-5">
              <span className="font-editorial text-2xl text-nx-ink sm:text-[1.7rem]">{item}</span>
              {i < arr.length - 1 && <Icon name="ArrowRight" className="h-4 w-4 text-nx-teal" strokeWidth={1.5} />}
            </span>
          ))}
        </div>
      </div>
    </Wrap>
  </section>
)

Steps.propTypes = { detail: PropTypes.object.isRequired }

const Uses = ({ product, uses }) => (
  <section className={`${PAPER} border-b ${RULE}`} aria-labelledby="uses-heading">
    <Wrap className="py-20 sm:py-28">
      <SectionLabel index="02">What {product.name} does</SectionLabel>
      <Display className="mt-12">
        <span id="uses-heading">
          {NUMBER_WORDS[uses.length]} ways teams <em>use {product.name}</em> today.
        </span>
      </Display>
      <Lede className="mt-8">Workflows from the user guide, with what each one replaced.</Lede>

      <div className={`mt-16 border-t ${RULE}`}>
        {uses.map((u, i) => (
          <Reveal key={u.title} delay={i * 0.03}>
            <div className={`grid grid-cols-[3.5rem_1fr] gap-6 border-b ${RULE} py-12 sm:grid-cols-[6rem_1fr] sm:gap-10`}>
              <span className="font-editorial text-4xl leading-none text-nx-teal sm:text-5xl">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3 className="font-editorial text-[1.75rem] leading-tight text-nx-ink sm:text-[2rem]">{u.title}</h3>
                <p className="mt-4 max-w-2xl text-[16px] leading-[1.7] text-nx-ink/85">{u.text}</p>
                <dl className={`mt-7 grid max-w-lg grid-cols-2 gap-8 border-y ${RULE} py-5`}>
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-[0.28em] text-nx-faint">Before</dt>
                    <dd className="mt-2 font-editorial text-xl leading-snug text-nx-ink">{u.before}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-[0.28em] text-nx-faint">With {product.name}</dt>
                    <dd className="mt-2 font-editorial text-xl leading-snug text-nx-ink">{u.after}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </Wrap>
  </section>
)

Uses.propTypes = { product: PropTypes.object.isRequired, uses: PropTypes.array.isRequired }

const Detail = ({ detail }) => (
  <section className={`${PAPER_ALT} border-b ${RULE}`} aria-labelledby="detail-heading">
    <Wrap className="py-20 sm:py-28">
      <SectionLabel index="03">In detail</SectionLabel>
      <Display className="mt-12">
        <span id="detail-heading">{detail.table.heading}.</span>
      </Display>
      <Lede className="mt-8">{detail.table.lede}</Lede>

      <div className={`mt-14 border-t ${RULE}`}>
        {detail.table.rows.map((row) => (
          <div key={row.label + row.value} className={`grid grid-cols-1 gap-2 border-b ${RULE} py-6 sm:grid-cols-[16rem_1fr] sm:gap-10`}>
            <dt className="font-editorial text-xl text-nx-ink">{row.label}</dt>
            <dd className="text-[15px] leading-[1.7] text-nx-muted">{row.value}</dd>
          </div>
        ))}
      </div>
      {detail.table.note && (
        <p className="mt-8 flex items-start gap-3 text-[15px] font-medium leading-relaxed text-nx-ink">
          <span className="mt-1 h-2 w-2 flex-none bg-nx-teal" aria-hidden="true" />
          {detail.table.note}
        </p>
      )}

      {/* Capabilities as three editorial columns */}
      <div className={`mt-20 grid grid-cols-1 gap-12 border-t ${RULE} pt-14 md:grid-cols-3 md:gap-10`}>
        {detail.columns.map((col) => (
          <div key={col.title}>
            <Icon name={col.icon} className="h-7 w-7 text-nx-ink" strokeWidth={1.25} />
            <h3 className="mt-5 font-editorial text-2xl text-nx-ink">{col.title}</h3>
            <p className="mt-3 text-[15px] leading-[1.7] text-nx-muted">{col.text}</p>
            <ul className={`mt-6 border-t ${RULE}`}>
              {col.bullets.map((b) => (
                <li key={b} className={`flex items-start gap-3 border-b ${RULE} py-3 text-[15px] text-nx-ink`}>
                  <span className="mt-[9px] h-1.5 w-1.5 flex-none bg-nx-teal" aria-hidden="true" />
                  {b}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Wrap>
  </section>
)

Detail.propTypes = { detail: PropTypes.object.isRequired }

const Tips = ({ tips }) => (
  <section className={`${PAPER} border-b ${RULE}`} aria-labelledby="tips-heading">
    <Wrap className="py-20 sm:py-28">
      <SectionLabel index="04">Good to know</SectionLabel>
      <Display className="mt-12">
        <span id="tips-heading">
          Small things that <em>save hours.</em>
        </span>
      </Display>
      <div className={`mt-14 grid grid-cols-1 border-t ${RULE} md:grid-cols-2 md:gap-x-16`}>
        {tips.items.map((tip) => (
          <div key={tip.title} className={`border-b ${RULE} py-7`}>
            <h3 className="font-editorial text-xl text-nx-ink">{tip.title}</h3>
            <p className="mt-2 text-[15px] leading-[1.7] text-nx-muted">{tip.text}</p>
          </div>
        ))}
      </div>
    </Wrap>
  </section>
)

Tips.propTypes = { tips: PropTypes.object.isRequired }

const Faq = ({ product, faqs }) => {
  const [open, setOpen] = useState(-1)
  return (
    <section className={`${PAPER_ALT} border-b ${RULE}`} aria-labelledby="faq-heading">
      <Wrap className="py-20 sm:py-28">
        <SectionLabel index="05">Common questions</SectionLabel>
        <Display className="mt-12">
          <span id="faq-heading">
            Frequently asked <em>about {product.name}.</em>
          </span>
        </Display>
        <div className={`mt-14 max-w-4xl border-t ${RULE}`}>
          {faqs.map((f, i) => {
            const isOpen = open === i
            return (
              <div key={f.q} className={`border-b ${RULE}`}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-6 py-6 text-left font-editorial text-xl text-nx-ink sm:text-[1.35rem]"
                >
                  {f.q}
                  <Icon
                    name="ChevronDown"
                    className={`h-5 w-5 flex-none text-nx-ink transition-transform ${isOpen ? "rotate-180" : ""}`}
                    strokeWidth={1.25}
                  />
                </button>
                {isOpen && <p className="max-w-3xl pb-7 text-[15px] leading-[1.7] text-nx-muted">{f.a}</p>}
              </div>
            )
          })}
        </div>
      </Wrap>
    </section>
  )
}

Faq.propTypes = { product: PropTypes.object.isRequired, faqs: PropTypes.array.isRequired }

const Closing = ({ product, onDemo }) => {
  const navigate = useNavigate()
  const idx = PRODUCTS.findIndex((p) => p.id === product.id)
  const next = PRODUCTS[(idx + 1) % PRODUCTS.length]
  return (
    <section className={PAPER} aria-labelledby="closing-heading">
      <Wrap className="py-24 text-center sm:py-32">
        <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-nx-faint">Start today</p>
        <Display className="mt-6">
          <span id="closing-heading">
            {product.name} is <em>ready when you are.</em>
          </span>
        </Display>
        <p className="mx-auto mt-8 max-w-md text-[16px] leading-[1.7] text-nx-ink/85">
          {product.short} See it on your own matters in a 30-minute walkthrough with the Jurinex team.
        </p>
        <div className="mt-10 flex justify-center">
          <BlackButton onClick={onDemo}>
            Schedule a demo with Jurinex
            <Icon name="ArrowRight" className="h-4 w-4" strokeWidth={1.75} />
          </BlackButton>
        </div>

        <div className={`mt-24 flex flex-col items-center justify-between gap-4 border-t ${RULE} pt-8 font-mono text-[11px] uppercase tracking-[0.28em] text-nx-faint sm:flex-row`}>
          <button type="button" onClick={() => navigate("/products")} className="inline-flex items-center gap-2 transition-colors hover:text-nx-teal-deep">
            <Icon name="ArrowLeft" className="h-3.5 w-3.5" />
            All products
          </button>
          <button type="button" onClick={() => navigate(`/products/${next.id}`)} className="inline-flex items-center gap-2 transition-colors hover:text-nx-teal-deep">
            Next · {next.num} {next.name}
            <Icon name="ArrowRight" className="h-3.5 w-3.5" />
          </button>
        </div>
      </Wrap>
    </section>
  )
}

Closing.propTypes = { product: PropTypes.object.isRequired, onDemo: PropTypes.func.isRequired }

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

/**
 * /products/:productId in an editorial layout: paper ground, display
 * serif with italic accents, monospace section labels, hairline rules.
 * Hero with a blueprint figure, a live look at the screen, numbered
 * steps, numbered use cases with before and after, detail rows and
 * capabilities, tips, FAQ and a closing call to action.
 */
const ProductDetailPage = () => {
  const { productId } = useParams()
  const [demoOpen, setDemoOpen] = useState(false)
  const product = PRODUCTS.find((p) => p.id === productId)
  const detail = PRODUCT_DETAILS[productId]

  useEffect(() => {
    if (!product) return undefined
    const prev = document.title
    document.title = `${product.name} · Jurinex`
    return () => {
      document.title = prev
    }
  }, [product])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" })
  }, [productId])

  if (!product || !detail) return <Navigate to="/products" replace />

  return (
    <PublicPageShell title={product.name} className={PAPER}>
      <Hero product={product} detail={detail} />
      <VideoSection key={product.id} product={product} detail={detail} />
      <Steps detail={detail} />
      {detail.uses && <Uses product={product} uses={detail.uses} />}
      {detail.table && <Detail detail={detail} />}
      <Tips tips={detail.tips} />
      <Faq product={product} faqs={detail.faqs} />
      <Closing product={product} onDemo={() => setDemoOpen(true)} />
      <BookDemoModal isOpen={demoOpen} onClose={() => setDemoOpen(false)} />
    </PublicPageShell>
  )
}

export default ProductDetailPage
