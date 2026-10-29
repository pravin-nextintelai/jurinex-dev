import PropTypes from "prop-types"
import { Link, Navigate, useParams } from "react-router-dom"
import ContentHubLayout, { HubEmptyState } from "../components/content-hub/ContentHubLayout"
import HubPromoBanner from "../components/content-hub/HubPromoBanner"
import { HubSectionHeading, StoryCard, StoryListItem } from "../components/content-hub/StoryCards"
import { HIGH_COURTS } from "../utils/landingConstants"
import { HUB_PROMOS, SUPREME_COURT, courtName, filterStories } from "../utils/contentHubData"

/** Fewer stories than this and the three-column front page looks sparse. */
const MIN_FRONT_PAGE_STORIES = 4

/**
 * Content Hub front page, LiveLaw-style: leaderboard promo, Top Stories
 * heading, then a lead story, a column of thumbnails and a right rail with
 * a promo tile. Also serves /supreme-court and /high-courts[/:courtSlug].
 */
const ContentHubPage = ({ section }) => {
  const { courtSlug } = useParams()
  if (courtSlug && !HIGH_COURTS.some((c) => c.slug === courtSlug)) {
    return <Navigate to="/content-hub/high-courts" replace />
  }

  const court = section === "supreme-court" ? SUPREME_COURT.slug : section === "high-courts" ? courtSlug || "high-courts" : undefined
  const title = !court ? "Top Stories" : court === "high-courts" ? "High Courts" : courtName(court)
  const readAllHref = court ? `/content-hub/stories?court=${court}` : "/content-hub/stories"
  const stories = filterStories({ court })
  const [featured, ...rest] = stories
  const middle = rest.slice(0, 4)
  const rail = rest.slice(4, 6)
  const latest = rest.slice(6)

  return (
    <ContentHubLayout>
      <HubPromoBanner {...HUB_PROMOS.leaderboard} />

      <section className="mt-8" aria-label={title}>
        <HubSectionHeading title={title} href={stories.length ? readAllHref : undefined} as="h1" />

        {stories.length === 0 && (
          <HubEmptyState message={`No stories from the ${title} yet. Check back soon.`} />
        )}

        {stories.length > 0 && stories.length < MIN_FRONT_PAGE_STORIES && (
          <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {stories.map((s) => (
              <StoryCard key={s.slug} story={s} />
            ))}
          </div>
        )}

        {stories.length >= MIN_FRONT_PAGE_STORIES && (
          <div className="mt-8 grid gap-8 md:grid-cols-2 lg:grid-cols-[1.25fr_1fr_1fr]">
            <StoryCard story={featured} featured />

            <ul className="space-y-5">
              {middle.map((s) => (
                <li key={s.slug}>
                  <StoryListItem story={s} />
                </li>
              ))}
            </ul>

            <div className="grid gap-5 md:col-span-2 md:grid-cols-2 lg:col-span-1 lg:grid-cols-1 lg:content-start">
              {rail.length > 0 && (
                <ul className="space-y-5">
                  {rail.map((s) => (
                    <li key={s.slug}>
                      <StoryListItem story={s} />
                    </li>
                  ))}
                </ul>
              )}
              <HubPromoBanner variant="tile" {...HUB_PROMOS.tile} />
            </div>
          </div>
        )}
      </section>

      {latest.length > 0 && (
        <section className="mt-14" aria-label="Latest updates">
          <HubSectionHeading title="Latest Updates" href={readAllHref} />
          <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {latest.map((s) => (
              <StoryCard key={s.slug} story={s} />
            ))}
          </div>
        </section>
      )}

      {section === "high-courts" && !courtSlug && (
        <section className="mt-14" aria-label="Browse by High Court">
          <HubSectionHeading title="Browse by High Court" />
          <ul className="mt-6 gap-x-8 rounded-md bg-nx-ink p-4 sm:columns-2 sm:p-6 lg:columns-3">
            {HIGH_COURTS.map((c) => (
              <li key={c.slug} className="break-inside-avoid">
                <Link
                  to={`/content-hub/high-courts/${c.slug}`}
                  className="block rounded-md px-3 py-2.5 text-[15px] font-medium text-white/90 transition-colors hover:bg-white/10 hover:text-nx-mint focus-visible:outline-2 focus-visible:outline-nx-mint"
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </ContentHubLayout>
  )
}

ContentHubPage.propTypes = {
  section: PropTypes.oneOf(["high-courts", "supreme-court"]),
}

export default ContentHubPage
