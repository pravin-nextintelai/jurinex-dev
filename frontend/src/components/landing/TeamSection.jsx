import { useState } from "react"
import PropTypes from "prop-types"
import { AnimatePresence, motion as Motion, useReducedMotion } from "framer-motion"
import {
  ADVISORY_BOARD,
  EXECUTIVE_CORE,
  MENTOR,
  TEAM_INTRO,
} from "../../utils/landingConstants"
import { Icon, Reveal, SectionHeading } from "./primitives"
import { EASE } from "./motionTokens"
import santoshPhoto from "../../assets/team/santosh.jpg"
import saurabhPhoto from "../../assets/team/saurabh.jpg"
import milindPhoto from "../../assets/team/milind.jpg"
import amitPhoto from "../../assets/team/amit.jpg"
import amarPhoto from "../../assets/team/amar.jpg"
import anoopPhoto from "../../assets/team/anoop.jpg"

const PHOTOS = {
  santosh: santoshPhoto,
  saurabh: saurabhPhoto,
  milind: milindPhoto,
  amit: amitPhoto,
  amar: amarPhoto,
  anoop: anoopPhoto,
}

const TABS = [
  { key: "core", label: "Executive Core" },
  { key: "advisory", label: "Advisory Board" },
]

// Advisory cards stack under the 4rem fixed navbar; each sits a little lower so the edges peek out.
const STACK_TOP = 88
const STACK_STEP = 24

const FACT_ICONS = {
  "High Court Advocate": "Scale",
  Experience: "Landmark",
  Education: "BookOpen",
  Expertise: "Briefcase",
  Legacy: "Award",
  "Client Work": "Users",
}

/** Executive profile: ringed circular portrait, identity block and a journey timeline. */
const Profile = ({ person, flip = false }) => (
  <article
    className={`grid grid-cols-1 items-center gap-10 py-14 first:pt-0 last:pb-0 lg:gap-16 ${
      flip ? "lg:grid-cols-[1fr_340px]" : "lg:grid-cols-[340px_1fr]"
    }`}
  >
    <div className={`relative mx-auto h-64 w-64 sm:h-72 sm:w-72 lg:h-80 lg:w-80 ${flip ? "lg:order-2" : ""}`}>
      <span
        aria-hidden="true"
        className="absolute -inset-4 rounded-full bg-[radial-gradient(circle,rgba(13,148,136,0.18),rgba(13,148,136,0)_70%)]"
      />
      <span aria-hidden="true" className="absolute inset-0 rounded-full ring-1 ring-nx-teal/30" />
      <img
        src={PHOTOS[person.photo]}
        alt={person.name}
        className="relative h-full w-full rounded-full border-[6px] border-white bg-white object-contain object-center shadow-[0_0_0_2px_rgba(13,148,136,0.25),0_30px_60px_-30px_rgba(6,52,44,0.45)]"
        loading="lazy"
      />
      {person.linkedin && (
        <a
          href={person.linkedin}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${person.name} on LinkedIn`}
          className="absolute bottom-3 right-3 grid h-11 w-11 place-items-center rounded-full bg-nx-teal text-white shadow-lg ring-4 ring-white transition-colors hover:bg-nx-teal-deep"
        >
          <Icon name="Linkedin" className="h-5 w-5" />
        </a>
      )}
    </div>

    <div>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-nx-teal">Executive Core</p>
      <h3 className="mt-2 text-3xl font-extrabold uppercase leading-none tracking-tight text-nx-ink sm:text-4xl">
        {person.name}
      </h3>
      <p className="mt-2 text-xs font-bold uppercase tracking-[0.2em] text-nx-faint">{person.role}</p>
      {person.summary && (
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-nx-muted">{person.summary}</p>
      )}

      <div className="mt-7 border-t border-nx-line pt-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-nx-faint">Journey</p>
        <ol className="relative mt-4 space-y-6 border-l border-nx-line pl-6">
          {person.journey.map((step) => (
            <li key={step.title} className="relative">
              <span
                aria-hidden="true"
                className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full bg-nx-teal ring-4 ring-white"
              />
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-nx-teal">
                {step.tag}
              </p>
              <p className="mt-1 text-sm font-semibold text-nx-ink">{step.title}</p>
              {step.text && <p className="mt-1 text-sm leading-relaxed text-nx-muted">{step.text}</p>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  </article>
)

Profile.propTypes = {
  flip: PropTypes.bool,
  person: PropTypes.shape({
    name: PropTypes.string.isRequired,
    role: PropTypes.string.isRequired,
    photo: PropTypes.string.isRequired,
    bio: PropTypes.string,
    summary: PropTypes.string,
    linkedin: PropTypes.string,
    journey: PropTypes.arrayOf(
      PropTypes.shape({
        tag: PropTypes.string.isRequired,
        title: PropTypes.string.isRequired,
        text: PropTypes.string,
      })
    ).isRequired,
  }).isRequired,
}

/**
 * "Engineers and lawyers, building together." — executive core,
 * advisory board, and the mentor behind Jurinex (from jurinex.ai).
 */
const TeamSection = () => {
  const reduce = useReducedMotion()
  const [tab, setTab] = useState("core")

  return (
    <section id="team" className="scroll-mt-20 bg-white py-20 sm:py-28" aria-labelledby="team-heading">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <SectionHeading
            id="team-heading"
            eyebrow={TEAM_INTRO.eyebrow}
            title={TEAM_INTRO.title}
            lede={TEAM_INTRO.lede}
            align="left"
          />
          <Reveal delay={0.05} className="flex flex-none">
            <span className="flex gap-1 rounded-xl border border-nx-line bg-nx-pale p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-pressed={tab === t.key}
                className={`rounded-lg px-5 py-2 text-xs font-bold uppercase tracking-wider transition-all duration-200 ${
                  tab === t.key
                    ? "bg-nx-teal text-white shadow"
                    : "text-nx-muted hover:text-nx-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
            </span>
          </Reveal>
        </div>

        <AnimatePresence mode="wait">
          <Motion.div
            key={tab}
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="mt-12"
          >
            {tab === "core" ? (
              <div className="divide-y divide-nx-line">
                {EXECUTIVE_CORE.map((person, i) => (
                  <Profile key={person.name} person={person} flip={i % 2 === 1} />
                ))}
              </div>
            ) : (
              <div className="space-y-8">
                {ADVISORY_BOARD.map((person, i) => (
                  <div
                    key={person.name}
                    className="lg:sticky"
                    style={{ top: `${STACK_TOP + i * STACK_STEP}px` }}
                  >
                    <article className="rounded-[28px] border border-nx-line bg-white px-7 pb-9 pt-7 shadow-[0_30px_70px_-30px_rgba(6,52,44,0.35)] sm:px-10 sm:pb-11 sm:pt-9">
                      <p className="flex items-center gap-4 text-[11px] font-bold uppercase tracking-[0.28em] text-nx-muted">
                        <span aria-hidden="true" className="h-px flex-1 bg-nx-line" />
                        <span className="flex items-center gap-2">
                          Jurinex Advisory Board
                          <span aria-hidden="true" className="h-1.5 w-1.5 rotate-45 bg-nx-teal" />
                        </span>
                        <span aria-hidden="true" className="h-px flex-1 bg-nx-line" />
                      </p>

                      <div className="mt-9 grid grid-cols-1 gap-8 md:grid-cols-[300px_1fr] md:gap-10">
                        <img
                          src={PHOTOS[person.photo]}
                          alt={person.name}
                          className="aspect-square w-full max-w-[300px] rounded-2xl bg-nx-pale object-cover object-[center_top]"
                          loading="lazy"
                        />
                        <div>
                          <h3 className="font-display text-[2rem] font-semibold leading-tight tracking-tight text-nx-ink sm:text-[2.35rem]">
                            {person.name}
                          </h3>
                          <p className="mt-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-nx-teal-ink">
                            {person.role}
                          </p>
                          <p className="mt-5 text-[15px] leading-[1.85] text-nx-muted">{person.bio}</p>
                        </div>
                      </div>

                      <dl className="mt-9 grid grid-cols-1 gap-8 border-t border-nx-line pt-8 sm:grid-cols-2 lg:grid-cols-4">
                        {person.facts.map(([label, value]) => (
                          <div key={label}>
                            <span className="grid h-9 w-9 place-items-center rounded-full bg-nx-pale text-nx-teal">
                              <Icon name={FACT_ICONS[label] || "Sparkles"} className="h-4 w-4" />
                            </span>
                            <dt className="mt-4 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-nx-ink">
                              {label}
                            </dt>
                            <dd className="mt-1.5 text-sm leading-snug text-nx-muted">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </article>
                  </div>
                ))}
              </div>
            )}
          </Motion.div>
        </AnimatePresence>

        {/* Mentor & Advisor */}
        <Reveal className="mt-16" y={26}>
          <div className="grid grid-cols-1 items-center gap-10 rounded-3xl bg-nx-pale p-7 sm:p-12 lg:grid-cols-[260px_1fr]">
            <img
              src={PHOTOS[MENTOR.photo]}
              alt={MENTOR.name}
              className="mx-auto aspect-[3/4] w-full max-w-[260px] rounded-2xl object-cover object-top"
              loading="lazy"
            />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-nx-teal">
                {MENTOR.eyebrow}
              </p>
              <blockquote className="mt-4 border-l-4 border-nx-teal pl-5 font-display text-xl font-medium italic leading-relaxed text-nx-teal-ink sm:text-2xl">
                “{MENTOR.quote}”
              </blockquote>
              <p className="mt-4 text-sm font-semibold text-nx-ink">{MENTOR.name}</p>
              <p className="text-xs text-nx-muted">{MENTOR.role}</p>
              <p className="mt-5 text-sm leading-relaxed text-nx-muted">{MENTOR.text}</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

export default TeamSection
