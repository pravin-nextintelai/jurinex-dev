import { Link, useSearchParams } from "react-router-dom"
import ContentHubLayout, { HubEmptyState } from "../components/content-hub/ContentHubLayout"
import { StoryCard, StoryLead } from "../components/content-hub/StoryCards"
import { Icon } from "../components/primitives"
import { HUB_TOPICS, courtName, filterStories, topicLabel } from "../utils/contentHubData"

const chipClass = (active) =>
  `inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${
    active
      ? "border-teal-700 bg-teal-700 text-white shadow-[0_8px_18px_-10px_rgba(8,163,147,0.9)]"
      : "border-nx-line bg-white text-nx-ink hover:border-teal-300 hover:bg-teal-50"
  }`

const countClass = (active) =>
  `rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${active ? "bg-white/20 text-white" : "bg-nx-pale text-nx-muted"}`

/** "Read all" listing: /content-hub/stories?court=…&topic=… */
const ContentHubStoriesPage = () => {
  const [params] = useSearchParams()
  const court = params.get("court") || undefined
  const topic = params.get("topic") || undefined
  const stories = filterStories({ court, topic })
  const showLead = stories.length === 1 || stories.length >= 4
  const [lead, ...rest] = stories
  const gridStories = showLead ? rest : stories

  const courtTitle = court === "high-courts" ? "High Courts" : court && courtName(court)
  const title = [topic && topicLabel(topic), courtTitle].filter(Boolean).join(" · ") || "All Stories"
  const place = courtTitle ? `the ${courtTitle}` : "the Supreme Court and the High Courts"
  const subtitle = topic
    ? `${topicLabel(topic)} from ${place}.`
    : court
      ? `Stories from ${place}.`
      : "Judgments, news and practitioner explainers from the Supreme Court and the High Courts."

  const countFor = (nextTopic) => filterStories({ court, topic: nextTopic }).length

  const hrefFor = (nextTopic) => {
    const next = new URLSearchParams()
    if (court) next.set("court", court)
    if (nextTopic) next.set("topic", nextTopic)
    const qs = next.toString()
    return `/content-hub/stories${qs ? `?${qs}` : ""}`
  }

  const topics = HUB_TOPICS.filter((t) => countFor(t.slug) > 0 || t.slug === topic)

  return (
    <ContentHubLayout>
      <header className="flex flex-col gap-5 border-b border-nx-line pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-700">Content Hub</p>
          <h1 className="mt-2 font-display text-[2rem] font-bold leading-none tracking-tight text-nx-ink sm:text-4xl">
            {title}
          </h1>
          <span className="mt-4 block h-0.5 w-12 rounded-full bg-teal-600" aria-hidden="true" />
          <p className="mt-3 text-sm leading-relaxed text-nx-muted sm:text-[15px]">{subtitle}</p>
        </div>
        <Link
          to="/content-hub"
          className="inline-flex flex-none items-center gap-1 self-start rounded-full border border-nx-line bg-white px-3.5 py-1.5 text-sm font-semibold text-nx-ink transition-colors hover:border-teal-300 hover:text-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 sm:self-auto"
        >
          Top Stories
          <Icon name="ChevronRight" className="h-4 w-4" />
        </Link>
      </header>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Filter by topic" className="flex flex-wrap gap-2">
          <Link to={hrefFor()} className={chipClass(!topic)} aria-current={!topic ? "page" : undefined}>
            All
            <span className={countClass(!topic)}>{countFor()}</span>
          </Link>
          {topics.map((t) => (
            <Link
              key={t.slug}
              to={hrefFor(t.slug)}
              className={chipClass(topic === t.slug)}
              aria-current={topic === t.slug ? "page" : undefined}
            >
              {t.label}
              <span className={countClass(topic === t.slug)}>{countFor(t.slug)}</span>
            </Link>
          ))}
        </nav>
        <p className="text-sm text-nx-muted">
          <span className="font-semibold text-nx-ink">{stories.length}</span>{" "}
          {stories.length === 1 ? "story" : "stories"}
        </p>
      </div>

      {stories.length === 0 ? (
        <HubEmptyState message="No stories match this filter yet." />
      ) : (
        <>
          {showLead && (
            <div className="mt-8">
              <StoryLead story={lead} />
            </div>
          )}
          {gridStories.length > 0 && (
            <div
              className={`grid items-stretch gap-5 sm:grid-cols-2 ${
                gridStories.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3"
              } ${showLead ? "mt-6" : "mt-8"}`}
            >
              {gridStories.map((s) => (
                <StoryCard key={s.slug} story={s} elevated />
              ))}
            </div>
          )}
        </>
      )}
    </ContentHubLayout>
  )
}

export default ContentHubStoriesPage
