import { PROBLEMS, SOLUTION_COPY } from "../../utils/landingConstants"
import { Eyebrow, Icon, Reveal } from "./primitives"

/**
 * Problem → solution narrative. The pains are an editorial numbered
 * list beside a sticky heading (no cards); the pivot into the unified
 * workspace is a dark band with the three promises as a checklist.
 */
const ProblemSolutionSection = () => (
  <section className="bg-nx-pale py-20 sm:py-28" aria-labelledby="problem-heading">
    <div className="mx-auto max-w-7xl px-5 sm:px-8">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        {/* Sticky heading */}
        <Reveal className="lg:sticky lg:top-28 lg:self-start">
          <Eyebrow>The Problem</Eyebrow>
          <h2
            id="problem-heading"
            className="mt-3 font-display text-3xl font-semibold leading-[1.15] tracking-tight text-nx-ink sm:text-4xl"
          >
            Legal Work Shouldn't Be Slowed Down by Information Overload
          </h2>
          <p className="mt-5 max-w-md text-base leading-relaxed text-nx-muted sm:text-lg">
            The practice of law is judgment and strategy. Yet most of a legal professional's week
            disappears into reading, searching, and re-typing.
          </p>
          <p className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-nx-teal-deep">
            <span className="h-px w-8 bg-nx-teal-deep" aria-hidden="true" />
            Six places the week goes
          </p>
        </Reveal>

        {/* Numbered list */}
        <ol className="border-t border-nx-ink/20">
          {PROBLEMS.map((problem, i) => (
            <Reveal
              key={problem.title}
              as="li"
              delay={i * 0.05}
              className="group grid grid-cols-[3rem_1fr] items-start gap-x-4 border-b border-nx-ink/20 py-6 transition-colors sm:grid-cols-[4rem_1fr_2.5rem]"
            >
              <span className="pt-1 font-display text-2xl font-semibold text-nx-faint transition-colors group-hover:text-nx-teal">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="text-lg font-semibold text-nx-ink">{problem.title}</h3>
                <p className="mt-1.5 max-w-xl text-[15px] leading-relaxed text-nx-muted">
                  {problem.text}
                </p>
              </div>
              <Icon
                name={problem.icon}
                className="hidden h-5 w-5 justify-self-end text-nx-faint transition-colors group-hover:text-nx-teal sm:block"
              />
            </Reveal>
          ))}
        </ol>
      </div>

      {/* Pivot into the solution */}
      <Reveal className="mt-20" y={30}>
        <div className="relative overflow-hidden rounded-3xl bg-nx-forest px-7 py-12 sm:px-12 lg:px-16 lg:py-16">
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
            style={{
              background:
                "radial-gradient(ellipse 60% 80% at 85% 20%, rgba(13,148,136,0.25), transparent 60%)",
            }}
          />
          <div className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-200">
                The Solution
              </p>
              <h3 className="mt-3 font-display text-2xl font-semibold leading-snug text-white sm:text-3xl lg:text-4xl">
                {SOLUTION_COPY.headline}
              </h3>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-white/90">
                {SOLUTION_COPY.text}
              </p>
            </div>
            <ol className="divide-y divide-white/25 border-y border-white/25">
              {SOLUTION_COPY.points.map((point, i) => (
                <li key={point} className="flex items-start gap-4 py-4">
                  <span className="mt-0.5 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-nx-teal text-[11px] font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="text-[15px] leading-relaxed text-white/95">{point}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Reveal>
    </div>
  </section>
)

export default ProblemSolutionSection
