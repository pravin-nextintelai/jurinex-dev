import PropTypes from "prop-types"
import { Link } from "react-router-dom"
import { Icon } from "../primitives"

/**
 * Jurinex promotion in two shapes: a wide `leaderboard` centred above the
 * stories, and a portrait `tile` for the right rail.
 */
const HubPromoBanner = ({ variant = "leaderboard", eyebrow, title, text, cta, href, image }) => {
  if (variant === "tile") {
    return (
      <Link
        to={href}
        className="group relative block overflow-hidden rounded-md bg-nx-ink text-white ring-1 ring-nx-line focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-600"
      >
        <img
          src={image}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover opacity-40 transition-transform duration-500 group-hover:scale-[1.05]"
        />
        <span className="absolute inset-0 bg-gradient-to-t from-nx-ink via-nx-ink/70 to-nx-teal-ink/40" aria-hidden="true" />
        <span className="relative flex min-h-[19rem] flex-col p-5">
          <span className="self-start rounded bg-red-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]">
            {eyebrow}
          </span>
          <span className="mt-auto font-display text-[26px] font-bold uppercase leading-[1.05]">{title}</span>
          <span className="mt-2 text-sm text-white/80">{text}</span>
          <span className="mt-4 inline-flex items-center gap-1.5 self-start rounded bg-nx-teal px-3.5 py-2 text-xs font-bold uppercase tracking-wide transition-colors group-hover:bg-nx-teal-deep">
            {cta}
            <Icon name="ArrowRight" className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-1" />
          </span>
        </span>
      </Link>
    )
  }

  return (
    <Link
      to={href}
      className="group mx-auto grid max-w-3xl overflow-hidden rounded-md bg-nx-ink text-white ring-1 ring-nx-line transition-shadow hover:shadow-[0_16px_36px_-20px_rgba(6,52,44,0.6)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-600 sm:grid-cols-[1fr_14rem]"
    >
      <span className="flex flex-col justify-center gap-2 p-5 sm:p-6">
        <span className="self-start rounded bg-red-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]">
          {eyebrow}
        </span>
        <span className="font-display text-xl font-bold leading-tight sm:text-2xl">{title}</span>
        <span className="text-sm text-white/75">{text}</span>
        <span className="mt-1 inline-flex items-center gap-1.5 self-start rounded bg-nx-teal px-4 py-2 text-sm font-semibold transition-colors group-hover:bg-nx-teal-deep">
          {cta}
          <Icon name="ArrowRight" className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
        </span>
      </span>
      <span className="relative hidden overflow-hidden sm:block">
        <img
          src={image}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
        />
        <span className="absolute inset-0 bg-gradient-to-r from-nx-ink to-transparent" aria-hidden="true" />
      </span>
    </Link>
  )
}

HubPromoBanner.propTypes = {
  variant: PropTypes.oneOf(["leaderboard", "tile"]),
  eyebrow: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  text: PropTypes.string.isRequired,
  cta: PropTypes.string.isRequired,
  href: PropTypes.string.isRequired,
  image: PropTypes.string.isRequired,
}

export default HubPromoBanner
