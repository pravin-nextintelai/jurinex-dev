import { Link, Navigate, useParams } from "react-router-dom"
import ContentHubLayout from "../components/content-hub/ContentHubLayout"
import HubPromoBanner from "../components/content-hub/HubPromoBanner"
import { HubSectionHeading, StoryListItem } from "../components/content-hub/StoryCards"
import { Icon } from "../components/primitives"
import {
  HUB_PROMOS,
  HUB_STORIES,
  SUPREME_COURT,
  courtName,
  formatStoryDate,
  topicLabel,
} from "../utils/contentHubData"

const courtHref = (slug) =>
  slug === SUPREME_COURT.slug ? "/content-hub/supreme-court" : `/content-hub/high-courts/${slug}`

/** /content-hub/stories/:storySlug — single story with a related-stories rail. */
const ContentHubStoryPage = () => {
  const { storySlug } = useParams()
  const story = HUB_STORIES.find((s) => s.slug === storySlug)
  if (!story) return <Navigate to="/content-hub" replace />

  const related = HUB_STORIES.filter((s) => s.slug !== story.slug)
    .sort((a, b) => Number(b.court === story.court) - Number(a.court === story.court))
    .slice(0, 5)

  return (
    <ContentHubLayout>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <article>
          <p className="flex flex-wrap items-center gap-x-2 text-[12px] font-semibold uppercase tracking-[0.08em]">
            <Link to={courtHref(story.court)} className="text-nx-ink hover:text-teal-700">
              {courtName(story.court)}
            </Link>
            {story.topic && (
              <>
                <span className="text-nx-faint" aria-hidden="true">
                  /
                </span>
                <Link to={`/content-hub/stories?topic=${story.topic}`} className="text-nx-muted hover:text-teal-700">
                  {topicLabel(story.topic)}
                </Link>
              </>
            )}
          </p>
          <h1 className="mt-3 font-display text-3xl font-bold leading-tight text-nx-ink sm:text-4xl">
            {story.title}
          </h1>
          <p className="mt-3 flex items-center gap-3 text-sm text-nx-faint">
            <time dateTime={story.date}>{formatStoryDate(story.date)}</time>
            {story.readMins && (
              <>
                <span aria-hidden="true">•</span>
                <span>{story.readMins} min read</span>
              </>
            )}
          </p>
          <img
            src={story.image}
            alt={story.imageAlt || ""}
            className={`mt-6 w-full rounded-md ring-1 ring-nx-line ${
              story.imageFit === "contain" ? "aspect-[73/40] object-contain" : "aspect-[16/9] object-cover"
            }`}
          />
          {story.figures?.map((figure) => (
            <img
              key={figure.alt}
              src={figure.src}
              alt={figure.alt}
              className="mt-4 w-full rounded-md bg-white ring-1 ring-nx-line"
            />
          ))}
          <p className="mt-6 text-lg leading-relaxed text-nx-ink">{story.excerpt}</p>
          {story.body?.length > 0 ? (
            <div className="mt-5 space-y-4 text-[17px] leading-relaxed text-nx-ink">
              {story.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-md border-l-4 border-nx-ink bg-nx-pale px-5 py-4 text-sm text-nx-muted">
              This is a preview of the Jurinex Content Hub. The full story will be published here soon.
            </div>
          )}
          <Link
            to="/content-hub"
            className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-nx-ink hover:text-teal-700"
          >
            <Icon name="ArrowLeft" className="h-4 w-4" />
            Back to Top Stories
          </Link>
        </article>

        <aside className="space-y-6" aria-label="More stories">
          <HubSectionHeading title="More Stories" href="/content-hub/stories" />
          <ul className="space-y-5">
            {related.map((s) => (
              <li key={s.slug}>
                <StoryListItem story={s} />
              </li>
            ))}
          </ul>
          <HubPromoBanner variant="tile" {...HUB_PROMOS.tile} />
        </aside>
      </div>
    </ContentHubLayout>
  )
}

export default ContentHubStoryPage
