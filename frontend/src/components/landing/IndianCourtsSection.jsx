import { INDIAN_COURTS } from "../../utils/landingConstants"
import { Reveal } from "./primitives"

/**
 * "Built for Indian courts." — restrained editorial layout in the same
 * language as the contact page: a mono marker over a hairline, a serif
 * heading with an italic teal accent, and the four commitments as a
 * numbered ledger with generous rows. Text only.
 */
const IndianCourtsSection = () => (
  <section
    id="indian-courts"
    className="scroll-mt-20 bg-nx-pale py-20 sm:py-28"
    aria-labelledby="indian-courts-heading"
  >
    <div className="mx-auto max-w-6xl px-6 sm:px-10">
      <Reveal>
        <h2
          id="indian-courts-heading"
          className="max-w-3xl font-editorial text-[2.9rem] font-normal leading-[1.02] tracking-[-0.02em] text-nx-ink sm:text-6xl [&_em]:italic [&_em]:text-nx-teal-deep"
        >
          Built for <em>Indian courts.</em>
        </h2>
        <p className="mt-8 max-w-2xl font-editorial text-xl italic leading-relaxed text-nx-muted sm:text-2xl">
          Not adapted for India as an afterthought. Engineered around the forums, formats and
          languages Indian practice actually runs on.
        </p>
      </Reveal>

      <ol className="mt-16 border-t border-nx-line">
        {INDIAN_COURTS.map((item, i) => (
          <Reveal
            key={item.title}
            as="li"
            delay={i * 0.05}
            className="grid grid-cols-1 gap-4 border-b border-nx-line py-10 md:grid-cols-12 md:gap-8"
          >
            <span
              className="font-editorial text-3xl italic leading-none text-nx-teal-deep md:col-span-1 md:pt-1"
              aria-hidden="true"
            >
              0{i + 1}
            </span>
            <h3 className="font-editorial text-2xl leading-tight text-nx-ink md:col-span-4 sm:text-[1.75rem]">
              {item.title}
            </h3>
            <div className="md:col-span-7">
              <p className="max-w-xl text-[15px] leading-[1.75] text-nx-muted sm:text-base">
                {item.text}
              </p>
              <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.2em] text-nx-faint">
                {item.tags.join("  ·  ")}
              </p>
            </div>
          </Reveal>
        ))}
      </ol>
    </div>
  </section>
)

export default IndianCourtsSection
