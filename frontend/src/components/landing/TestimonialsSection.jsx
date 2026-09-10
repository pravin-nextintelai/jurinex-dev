import { useRef } from "react"
import PropTypes from "prop-types"
import { motion as Motion, useReducedMotion, useScroll, useTransform } from "framer-motion"
import { TESTIMONIALS } from "../../utils/landingConstants"
import { Icon, SectionHeading } from "./primitives"
import akshayPhoto from "../../assets/team/akshay.jpg"
import shaileshPhoto from "../../assets/team/shailesh.jpg"
import prathameshPhoto from "../../assets/team/prathamesh.jpg"

const PHOTOS = { akshay: akshayPhoto, shailesh: shaileshPhoto, prathamesh: prathameshPhoto }

/** One ground for every card: the pale brand tint with teal accents. */
const TONE = {
  card: "bg-[#eaf8f6]",
  text: "text-nx-ink",
  muted: "text-nx-muted",
  ring: "border-teal-200",
  mark: "text-nx-teal/15",
  num: "text-nx-teal-ink",
  line: "border-teal-200",
}

const initials = (name) =>
  name
    .replace(/^Adv\.\s*/, "")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")

const Portrait = ({ person }) => {
  const photo = person.photo ? PHOTOS[person.photo] : null
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        loading="lazy"
        className="h-16 w-16 flex-none rounded-xl object-cover object-top ring-2 ring-white/80 sm:h-20 sm:w-20"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="grid h-16 w-16 flex-none place-items-center rounded-xl bg-nx-teal font-display text-2xl font-semibold text-white ring-2 ring-white/80 sm:h-20 sm:w-20"
    >
      {initials(person.name)}
    </span>
  )
}

Portrait.propTypes = { person: PropTypes.object.isRequired }

/**
 * One wide testimonial card. It sticks near the top of the viewport
 * and, as the next card scrolls over it, shrinks and dims slightly so
 * the stack reads as a deck of cards.
 */
const StackCard = ({ person, index, total, progress }) => {
  const reduce = useReducedMotion()
  const tone = TONE

  // Each card's "range" is the slice of overall progress during which
  // the NEXT card is sliding over it.
  const start = index / total
  const end = (index + 1) / total
  const scale = useTransform(progress, [start, end], [1, 0.96])
  const isLast = index === total - 1

  return (
    <Motion.article
      style={reduce || isLast ? undefined : { scale }}
      className="origin-top"
    >
      <div
        className={`relative overflow-hidden rounded-2xl border ${tone.ring} ${tone.card} px-6 py-7 shadow-[0_20px_50px_-28px_rgba(6,52,44,0.4)] sm:px-9 sm:py-8`}
      >
        <Icon name="Quote" className={`absolute -right-4 -top-6 h-28 w-28 ${tone.mark}`} strokeWidth={1} />

        <div className="relative grid grid-cols-1 gap-6 md:grid-cols-[13rem_1fr] md:gap-10">
          <div className="flex flex-row items-center gap-4 md:flex-col md:items-start">
            <Portrait person={person} />
            <div className="md:mt-3">
              <p className={`text-sm font-semibold ${tone.text}`}>{person.name}</p>
              <p className={`mt-1 text-xs leading-snug ${tone.muted}`}>{person.title}</p>
            </div>
          </div>

          <blockquote className="flex flex-col">
            <p className={`font-display text-lg font-medium leading-[1.5] sm:text-xl ${tone.text}`}>
              “{person.quote}”
            </p>
            <footer className={`mt-6 flex items-center justify-between border-t pt-4 font-mono text-[10px] uppercase tracking-[0.22em] ${tone.line} ${tone.num}`}>
              <span>Voices from the Bench &amp; Bar</span>
              <span>
                {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
              </span>
            </footer>
          </blockquote>
        </div>
      </div>
    </Motion.article>
  )
}

StackCard.propTypes = {
  person: PropTypes.object.isRequired,
  index: PropTypes.number.isRequired,
  total: PropTypes.number.isRequired,
  progress: PropTypes.object.isRequired,
}

/**
 * "Voices from the Bench & Bar" as a scroll-stacked deck: every
 * testimonial is a wide horizontal card; as the reader scrolls, each new
 * card slides up and settles over the previous one.
 */
const TestimonialsSection = () => {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 20%", "end 80%"] })
  const total = TESTIMONIALS.length

  return (
    <section className="bg-white py-20 sm:py-28" aria-labelledby="testimonials-heading">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeading
          id="testimonials-heading"
          eyebrow="Voices from the Bench & Bar"
          title="What advocates say after a week with Jurinex"
          lede="Practising lawyers, in their own words. Scroll through the deck."
          align="left"
        />

        <div ref={ref} className="relative mx-auto mt-12 max-w-5xl space-y-6 sm:space-y-8">
          {TESTIMONIALS.map((t, i) => (
            <div
              key={t.name}
              className="sticky"
              style={{ top: `calc(5.5rem + ${i * 1}rem)` }}
            >
              <StackCard person={t} index={i} total={total} progress={scrollYProgress} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default TestimonialsSection
