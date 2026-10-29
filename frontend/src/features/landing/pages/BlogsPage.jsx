import { useMemo, useState } from "react"
import PropTypes from "prop-types"
import { useNavigate } from "react-router-dom"
import PublicPageShell from "../components/PublicPageShell"
import { Icon, Reveal } from "../components/primitives"
import { BLOG_POSTS } from "../utils/landingConstants"
import { coverFor } from "../utils/blogCovers"

/* ------------------------------------------------------------------ */
/* /blogs — a quiet editorial index: masthead with search, topic tabs, */
/* then one ruled list of articles, newest first. Rows open           */
/* /blogs/:slug.                                                      */
/* ------------------------------------------------------------------ */

const CATEGORIES = Array.from(new Set(BLOG_POSTS.map((p) => p.category)))

const matches = (post, query) => {
  if (!query) return true
  const haystack = `${post.title} ${post.excerpt} ${post.category}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

/* Story row: thumbnail, kicker, headline, standfirst, byline. */
const StoryRow = ({ post, onOpen }) => (
  <li className="group">
    <button
      type="button"
      onClick={() => onOpen(post)}
      className="grid w-full grid-cols-1 gap-4 py-7 text-left sm:grid-cols-[16rem_minmax(0,1fr)] sm:gap-8"
      aria-label={post.title}
    >
      <span className="block aspect-[16/10] overflow-hidden rounded-md">
        <img
          src={coverFor(post)}
          alt=""
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          loading="lazy"
        />
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 text-[11px] font-semibold uppercase tracking-[0.16em]">
          <span className="text-nx-teal">{post.category}</span>
          <span aria-hidden="true" className="text-nx-faint">|</span>
          <span className="font-medium normal-case tracking-normal text-nx-faint">{post.date}</span>
        </span>
        <span className="mt-2 block font-display text-[1.35rem] font-semibold leading-snug text-nx-ink transition-colors group-hover:text-nx-teal-ink">
          {post.title}
        </span>
        <span className="mt-2 block max-w-3xl text-[0.95rem] leading-relaxed text-nx-muted line-clamp-2">{post.excerpt}</span>
        <span className="mt-3 block text-xs text-nx-faint">
          By <span className="font-semibold text-nx-ink">{post.author}</span>
          <span aria-hidden="true"> · </span>
          {post.readTime}
        </span>
      </span>
    </button>
  </li>
)

StoryRow.propTypes = { post: PropTypes.object.isRequired, onOpen: PropTypes.func.isRequired }

const BlogsPage = () => {
  const navigate = useNavigate()
  const [category, setCategory] = useState("All")
  const [query, setQuery] = useState("")
  const open = (post) => navigate(`/blogs/${post.slug}`)

  const posts = useMemo(
    () => BLOG_POSTS.filter((p) => (category === "All" || p.category === category) && matches(p, query)),
    [category, query],
  )

  return (
    <PublicPageShell>
      {/* ----------------------------- masthead --------------------- */}
      <section className="sticky top-20 z-30 border-b border-nx-line bg-white/95 backdrop-blur" aria-labelledby="blogs-heading">
        <div className="mx-auto max-w-7xl px-5 pt-7 sm:px-8 sm:pt-8">
          <Reveal className="flex flex-col gap-5 border-b-2 border-nx-ink pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-nx-teal">Jurinex Blog</p>
              <h1 id="blogs-heading" className="mt-2 font-display text-3xl font-semibold leading-[1.08] tracking-tight text-nx-ink sm:text-[2.5rem]">
                Notes from the Jurinex team
              </h1>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-nx-muted">
                Practical writing on legal AI, research, drafting, litigation, compliance and running a modern Indian practice.
              </p>
            </div>
            <label className="relative block w-full lg:w-64">
              <span className="sr-only">Search articles</span>
              <Icon name="Search" className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-nx-faint" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search articles"
                className="h-10 w-full border-b border-nx-line bg-transparent pl-7 pr-2 text-sm text-nx-ink outline-none transition-colors placeholder:text-nx-faint focus:border-nx-ink"
              />
            </label>
          </Reveal>

          {/* Topic tabs */}
          <Reveal className="overflow-x-auto">
            <div role="tablist" aria-label="Filter by topic" className="flex min-w-max items-center">
              {["All", ...CATEGORIES].map((c) => {
                const active = c === category
                return (
                  <button
                    key={c}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setCategory(c)}
                    className={`relative whitespace-nowrap px-4 py-3 text-[13px] font-semibold uppercase tracking-[0.12em] transition-colors first:pl-0 ${
                      active ? "text-nx-teal" : "text-nx-muted hover:text-nx-ink"
                    }`}
                  >
                    {c}
                    <span
                      aria-hidden="true"
                      className={`absolute inset-x-4 bottom-0 h-0.5 bg-nx-teal transition-opacity first:inset-x-0 ${active ? "opacity-100" : "opacity-0"}`}
                    />
                  </button>
                )
              })}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ----------------------------- list ------------------------- */}
      <section className="bg-white pb-16" aria-label="Articles">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          {posts.length === 0 ? (
            <div className="py-20 text-center">
              <p className="font-display text-xl font-semibold text-nx-ink">No articles match</p>
              <p className="mt-2 text-sm text-nx-muted">Try another word, or clear the filters.</p>
              <button
                type="button"
                onClick={() => {
                  setCategory("All")
                  setQuery("")
                }}
                className="mt-5 text-sm font-semibold text-nx-teal hover:underline"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <>
              <p className="pt-6 text-xs text-nx-faint">
                <span className="font-semibold text-nx-ink">{posts.length}</span> {posts.length === 1 ? "article" : "articles"}
                {category !== "All" && <> in {category}</>}
              </p>
              <ul className="divide-y divide-nx-line">
                {posts.map((post) => (
                  <StoryRow key={post.slug} post={post} onOpen={open} />
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </PublicPageShell>
  )
}

export default BlogsPage
