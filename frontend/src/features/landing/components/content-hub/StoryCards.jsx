import PropTypes from "prop-types"
import { Link } from "react-router-dom"
import { Icon } from "../primitives"
import { courtName, formatStoryDate, storyHref, topicLabel } from "../../utils/contentHubData"

const storyShape = PropTypes.shape({
  slug: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  excerpt: PropTypes.string,
  image: PropTypes.string.isRequired,
  imageAlt: PropTypes.string,
  imageFit: PropTypes.oneOf(["cover", "contain", "video"]),
  court: PropTypes.string.isRequired,
  topic: PropTypes.string,
  date: PropTypes.string.isRequired,
  readMins: PropTypes.number,
})

const FOCUS_RING = "rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-600"

/** Designed graphics keep their full frame; photographs fill the card. */
const imageFrameClass = (story) => {
  if (story.imageFit === "contain") return "aspect-[73/40] object-contain"
  if (story.imageFit === "video") return "aspect-video object-cover"
  return "aspect-[16/10] object-cover"
}

/** Red accent heading with a right-aligned "Read all" link and a rule beneath. */
export const HubSectionHeading = ({ title, href, linkLabel = "Read all", as = "h2" }) => {
  const Heading = as
  return (
    <div className="flex items-end justify-between gap-4 border-b-2 border-nx-ink pb-2">
      <Heading className="text-2xl font-bold tracking-tight text-nx-ink sm:text-[28px]">{title}</Heading>
      {href && (
        <Link
          to={href}
          className="group inline-flex flex-none items-center gap-0.5 pb-1 text-sm font-semibold text-nx-ink transition-colors hover:text-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        >
          {linkLabel}
          <Icon name="ChevronRight" className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  )
}

HubSectionHeading.propTypes = {
  title: PropTypes.string.isRequired,
  href: PropTypes.string,
  linkLabel: PropTypes.string,
  as: PropTypes.elementType,
}

const StoryMeta = ({ story, className = "", accent = false }) => (
  <p className={`flex flex-wrap items-center gap-x-2 text-[11px] font-semibold uppercase tracking-[0.08em] ${className}`}>
    <span className={accent ? "text-teal-800" : "text-nx-ink"}>{courtName(story.court)}</span>
    <span className="text-nx-faint" aria-hidden="true">
      •
    </span>
    <time dateTime={story.date} className="font-medium normal-case tracking-normal text-nx-faint">
      {formatStoryDate(story.date)}
    </time>
  </p>
)

StoryMeta.propTypes = { story: storyShape.isRequired, className: PropTypes.string, accent: PropTypes.bool }

const TopicBadge = ({ topic }) => {
  const label = topicLabel(topic)
  if (!label) return null
  return (
    <span className="absolute bottom-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-800 shadow-sm ring-1 ring-black/5">
      {label}
    </span>
  )
}

TopicBadge.propTypes = { topic: PropTypes.string }

const CARD_SURFACE =
  "group flex h-full flex-col overflow-hidden rounded-xl border border-nx-line bg-white shadow-[0_1px_2px_rgba(16,20,19,0.04),0_10px_28px_-18px_rgba(16,20,19,0.28)] transition duration-300 hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-[0_18px_40px_-22px_rgba(8,163,147,0.45)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"

/** Same frame for every elevated card so the grid lines up. */
const elevatedImageClass = (story) =>
  story.imageFit === "contain" ? "aspect-[16/10] bg-nx-pale object-contain p-3" : "aspect-[16/10] object-cover"

const ReadAffordance = ({ mins }) => (
  <span className="flex items-center justify-between border-t border-nx-line pt-3 text-[12px]">
    <span className="inline-flex items-center gap-1.5 text-nx-faint">
      {mins ? (
        <>
          <Icon name="Clock" className="h-3.5 w-3.5" />
          {mins} min read
        </>
      ) : (
        <span>Read the story</span>
      )}
    </span>
    <span className="inline-flex items-center gap-1 font-semibold text-teal-700">
      Read
      <Icon name="ArrowRight" className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
    </span>
  </span>
)

ReadAffordance.propTypes = { mins: PropTypes.number }

/** Vertical card: image, meta, headline, excerpt. `featured` is the large lead story. */
export const StoryCard = ({ story, featured = false, elevated = false }) => {
  if (elevated) {
    return (
      <Link to={storyHref(story)} className={CARD_SURFACE}>
        <span className="relative block overflow-hidden bg-nx-pale">
          <img
            src={story.image}
            alt={story.imageAlt || ""}
            loading="lazy"
            className={`${elevatedImageClass(story)} w-full transition-transform duration-500 group-hover:scale-[1.04]`}
          />
          <TopicBadge topic={story.topic} />
        </span>
        <span className="flex flex-1 flex-col px-4 pb-4 pt-3.5">
          <StoryMeta story={story} accent />
          <h3 className="mt-2 line-clamp-3 font-display text-[17px] font-semibold leading-snug text-nx-ink transition-colors group-hover:text-teal-800">
            {story.title}
          </h3>
          {story.excerpt && (
            <p className="mt-2 line-clamp-3 text-[13.5px] leading-relaxed text-nx-muted">{story.excerpt}</p>
          )}
          <span className="mt-auto pt-4">
            <ReadAffordance mins={story.readMins} />
          </span>
        </span>
      </Link>
    )
  }

  return (
    <Link to={storyHref(story)} className={`group block ${FOCUS_RING}`}>
      <span className="block overflow-hidden rounded-md bg-nx-pale ring-1 ring-nx-line">
        <img
          src={story.image}
          alt={story.imageAlt || ""}
          loading={featured ? "eager" : "lazy"}
          className={`${imageFrameClass(story)} w-full transition-transform duration-500 group-hover:scale-[1.04]`}
        />
      </span>
      <StoryMeta story={story} className="mt-3" />
      <h3
        className={`mt-1.5 font-bold leading-snug text-nx-ink transition-colors group-hover:text-teal-700 ${
          featured ? "text-lg sm:text-xl" : "line-clamp-3 text-[15px]"
        }`}
      >
        {story.title}
      </h3>
      {story.excerpt && (
        <p className={`mt-2 text-sm leading-relaxed text-nx-muted ${featured ? "line-clamp-5" : "line-clamp-4"}`}>
          {story.excerpt}
        </p>
      )}
    </Link>
  )
}

StoryCard.propTypes = { story: storyShape.isRequired, featured: PropTypes.bool, elevated: PropTypes.bool }

/** Wide lead used at the top of the stories listing. */
export const StoryLead = ({ story }) => (
  <Link
    to={storyHref(story)}
    className="group grid overflow-hidden rounded-2xl border border-nx-line bg-white shadow-[0_12px_40px_-24px_rgba(16,20,19,0.35)] transition duration-300 hover:border-teal-200 hover:shadow-[0_20px_48px_-24px_rgba(8,163,147,0.4)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 md:grid-cols-[1.15fr_1fr]"
  >
    <span className="relative block overflow-hidden bg-nx-pale md:min-h-[320px]">
      <img
        src={story.image}
        alt={story.imageAlt || ""}
        loading="eager"
        className={`aspect-[16/10] h-full w-full transition-transform duration-500 group-hover:scale-[1.03] md:absolute md:inset-0 md:aspect-auto md:h-full ${
          story.imageFit === "contain" ? "object-contain p-6 md:p-10" : "object-cover"
        }`}
      />
      <TopicBadge topic={story.topic} />
    </span>
    <span className="flex flex-col justify-center px-5 py-6 sm:px-8 sm:py-8">
      <StoryMeta story={story} accent />
      <h2 className="mt-3 font-display text-2xl font-semibold leading-snug text-nx-ink transition-colors group-hover:text-teal-800 sm:text-[1.7rem]">
        {story.title}
      </h2>
      {story.excerpt && <p className="mt-3 line-clamp-4 text-[15px] leading-relaxed text-nx-muted">{story.excerpt}</p>}
      <span className="mt-6">
        <ReadAffordance mins={story.readMins} />
      </span>
    </span>
  </Link>
)

StoryLead.propTypes = { story: storyShape.isRequired }

/** Compact row: thumbnail on the left, headline on the right. */
export const StoryListItem = ({ story }) => (
  <Link to={storyHref(story)} className={`group flex gap-3 ${FOCUS_RING}`}>
    <span className="block w-28 flex-none overflow-hidden rounded bg-nx-pale ring-1 ring-nx-line sm:w-32">
      <img
        src={story.image}
        alt=""
        loading="lazy"
        className={`${imageFrameClass(story)} h-full w-full transition-transform duration-500 group-hover:scale-[1.06]`}
      />
    </span>
    <span className="min-w-0">
      <span className="line-clamp-3 text-[13.5px] font-medium leading-snug text-nx-ink transition-colors group-hover:text-teal-700">
        {story.title}
      </span>
      <span className="mt-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-nx-ink">
        {courtName(story.court)}
      </span>
    </span>
  </Link>
)

StoryListItem.propTypes = { story: storyShape.isRequired }
