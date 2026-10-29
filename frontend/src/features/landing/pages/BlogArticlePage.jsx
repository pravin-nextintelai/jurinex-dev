import { useEffect, useMemo, useState } from "react"
import PropTypes from "prop-types"
import { useNavigate, useParams } from "react-router-dom"
import PublicPageShell from "../components/PublicPageShell"
import { Icon } from "../components/primitives"
import { CategoryChip } from "../components/BlogCard"
import { BLOG_POSTS } from "../utils/landingConstants"
import { coverFor } from "../utils/blogCovers"

/* ------------------------------------------------------------------ */
/* Article reader: table of contents, related posts and categories on */
/* the left, the article on the right.                                */
/* ------------------------------------------------------------------ */

const STEP_MARK = /(^|(?<=\.\s))(First|Second|Third|Fourth|Fifth|Sixth|Seventh),\s+/g
const NAV_OFFSET = 112 // fixed navbar + breadcrumb strip
const PROSE = "font-display text-[1.06rem] leading-[1.85] text-[#1a2422]"

const splitChecklist = (paragraph) => {
  const marks = [...paragraph.matchAll(STEP_MARK)]
  if (marks.length < 2) return null
  const intro = paragraph.slice(0, marks[0].index).trim()
  const items = marks.map((mark, index) => {
    const from = mark.index + mark[0].length
    const to = index + 1 < marks.length ? marks[index + 1].index : paragraph.length
    return paragraph.slice(from, to).replace(/\s+$/, "").replace(/\.$/, "")
  })
  return { intro, items }
}

const sentence = (text) => {
  const trimmed = text.trim().replace(/\.$/, "")
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`
}

const tocId = (heading, index) =>
  `section-${index}-${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`

const sectionsFor = (post) => {
  const headings = post.outline?.length === post.body.length
    ? post.outline
    : post.body.map((_, index) => `Part ${index + 1}`)
  return headings.map((heading, index) => ({
    id: tocId(heading, index),
    heading,
    paragraphs: [post.body[index]],
  }))
}

const scrollToId = (id) => {
  const target = document.getElementById(id)
  if (!target) return
  const top = target.getBoundingClientRect().top + window.scrollY - NAV_OFFSET
  window.scrollTo({ top, behavior: "smooth" })
}

/* ---------------------------------- body --------------------------- */

const Paragraphs = ({ paragraphs }) => (
  <div className={`mt-4 space-y-5 ${PROSE}`}>
    {paragraphs.map((paragraph) => {
      const checklist = splitChecklist(paragraph)
      if (!checklist) return <p key={paragraph.slice(0, 40)}>{paragraph}</p>
      return (
        <div key={paragraph.slice(0, 40)} className="space-y-4">
          {checklist.intro ? <p>{checklist.intro}</p> : null}
          <ol className="space-y-3 rounded-xl border border-nx-line bg-nx-pale/60 px-5 py-4">
            {checklist.items.map((item, step) => (
              <li key={item.slice(0, 24)} className="flex gap-3">
                <span className="mt-1 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-nx-teal font-body text-[11px] font-semibold text-white">
                  {step + 1}
                </span>
                <span>{sentence(item)}</span>
              </li>
            ))}
          </ol>
        </div>
      )
    })}
  </div>
)

Paragraphs.propTypes = { paragraphs: PropTypes.arrayOf(PropTypes.string).isRequired }

const SectionHeading = ({ id, children }) => (
  <h2 id={id} className="scroll-mt-28 font-display text-[1.45rem] font-bold leading-snug text-nx-ink">
    {children}
  </h2>
)

SectionHeading.propTypes = { id: PropTypes.string, children: PropTypes.node }

/* ------------------------------- sidebar --------------------------- */

const SidebarCard = ({ title, children }) => (
  <div className="rounded-2xl border border-nx-line bg-white p-5">
    <p className="font-display text-lg font-bold text-nx-ink">{title}</p>
    {children}
  </div>
)

SidebarCard.propTypes = { title: PropTypes.string.isRequired, children: PropTypes.node }

const TableOfContents = ({ items, activeId, onSelect }) => (
  <SidebarCard title="Table of Contents">
    <nav aria-label="Table of contents" className="mt-4">
      <ol className="space-y-0.5">
        {items.map((item, index) => {
          const active = item.id === activeId
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={active ? "true" : undefined}
                className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-[0.92rem] leading-snug transition-colors ${
                  active
                    ? "bg-teal-50 font-semibold text-nx-teal"
                    : "text-[#1f4fb8] hover:bg-nx-pale hover:text-nx-teal"
                }`}
              >
                <span className={`mt-0.5 font-body text-[11px] font-semibold tabular-nums ${active ? "text-nx-teal" : "text-nx-faint"}`}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{item.label}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  </SidebarCard>
)

TableOfContents.propTypes = {
  items: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string, label: PropTypes.string })).isRequired,
  activeId: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
}

/* --------------------------------- page ---------------------------- */

const BlogArticlePage = () => {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [activeId, setActiveId] = useState("")
  const [copied, setCopied] = useState(false)
  const post = BLOG_POSTS.find((item) => item.slug === slug)

  const sections = useMemo(() => (post ? sectionsFor(post) : []), [post])
  const toc = useMemo(() => sections.map((section) => ({ id: section.id, label: section.heading })), [sections])

  useEffect(() => {
    setActiveId("")
    setCopied(false)
  }, [slug])

  /* Scroll-spy: the heading nearest the top of the viewport is active. */
  useEffect(() => {
    if (!post) return undefined
    const headings = toc.map((item) => document.getElementById(item.id)).filter(Boolean)
    if (!headings.length) return undefined
    const update = () => {
      const line = NAV_OFFSET + 24
      let current = headings[0].id
      headings.forEach((heading) => {
        if (heading.getBoundingClientRect().top <= line) current = heading.id
      })
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
      setActiveId(atBottom ? headings[headings.length - 1].id : current)
    }
    update()
    window.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [toc, post])

  if (!post) {
    return (
      <PublicPageShell>
        <section className="bg-nx-pale px-5 py-24 text-center sm:px-8">
          <h1 className="font-display text-3xl font-semibold text-nx-ink">Article not found</h1>
          <button
            type="button"
            onClick={() => navigate("/blogs")}
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-nx-teal hover:text-teal-800"
          >
            <Icon name="ArrowLeft" className="h-4 w-4" />
            Back to all articles
          </button>
        </section>
      </PublicPageShell>
    )
  }

  const related = [
    ...BLOG_POSTS.filter((item) => item.slug !== post.slug && item.category === post.category),
    ...BLOG_POSTS.filter((item) => item.slug !== post.slug && item.category !== post.category),
  ].slice(0, 3)
  const categories = [...new Set(BLOG_POSTS.map((item) => item.category))].map((category) => ({
    category,
    count: BLOG_POSTS.filter((item) => item.category === category).length,
  }))

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard unavailable: nothing to do */
    }
  }

  return (
    <PublicPageShell>
      <article className="bg-[#f7f9f8]">
        <div className="mx-auto grid max-w-7xl items-start gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10 lg:py-10">
          {/* ------------------------------ left ----------------------- */}
          <aside className="space-y-5 lg:sticky lg:top-24">
            <button
              type="button"
              onClick={() => navigate("/blogs")}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-nx-line bg-white px-4 py-3 text-sm font-semibold text-nx-ink transition-colors hover:border-nx-teal hover:text-nx-teal"
            >
              <Icon name="ArrowLeft" className="h-4 w-4" />
              Back to Blog
            </button>
            <TableOfContents items={toc} activeId={activeId} onSelect={scrollToId} />

            <div className="hidden space-y-5 lg:block">
              <SidebarCard title="Related posts">
                <ul className="mt-4 space-y-2.5">
                  {related.map((item) => (
                    <li key={item.slug}>
                      <button
                        type="button"
                        onClick={() => navigate(`/blogs/${item.slug}`)}
                        className="block w-full rounded-xl border border-nx-line px-4 py-3 text-left text-sm font-semibold leading-snug text-nx-ink transition-colors hover:border-teal-200 hover:bg-teal-50/60 hover:text-nx-teal"
                      >
                        {item.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </SidebarCard>

              <SidebarCard title="Categories">
                <ul className="mt-4 space-y-1.5">
                  {categories.map(({ category, count }) => (
                    <li key={category}>
                      <button
                        type="button"
                        onClick={() => navigate("/blogs")}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-nx-pale ${
                          category === post.category ? "font-semibold text-nx-teal" : "text-nx-ink"
                        }`}
                      >
                        <span>{category}</span>
                        <span className="text-xs tabular-nums text-nx-faint">{count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </SidebarCard>
            </div>
          </aside>

          {/* ------------------------------ right ---------------------- */}
          <div className="min-w-0 overflow-hidden rounded-2xl border border-nx-line bg-white">
            <header className="border-b border-nx-line px-5 pb-7 pt-7 sm:px-10 sm:pt-9">
              <div className="flex flex-wrap items-center justify-end gap-3">
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]">
                  <span className="text-nx-teal">{post.category}</span>
                  <span aria-hidden="true" className="text-nx-faint">|</span>
                  <span className="font-medium normal-case tracking-normal text-nx-faint">Updated {post.date}</span>
                </p>
              </div>

              <h1 className="mt-6 font-display text-[clamp(1.6rem,2.4vw,2.15rem)] font-semibold leading-[1.22] text-nx-ink">
                {post.title}
              </h1>
              <p className="mt-3 max-w-3xl text-[1.02rem] leading-relaxed text-nx-muted">{post.excerpt}</p>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-nx-line pt-4">
                <p className="text-sm text-nx-faint">
                  By <span className="font-semibold text-nx-ink">{post.author}</span>
                  <span aria-hidden="true"> · </span>
                  {post.readTime}
                </p>
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex items-center gap-1.5 rounded-md border border-nx-line px-3 py-1.5 text-xs font-semibold text-nx-ink hover:border-nx-teal hover:text-nx-teal"
                >
                  <Icon name={copied ? "Check" : "Link"} className="h-3.5 w-3.5" />
                  {copied ? "Link copied" : "Copy link"}
                </button>
              </div>
            </header>

            <div className="px-5 py-7 sm:px-10 sm:py-9">
              {sections.map((section, index) => (
                <section key={section.id} className={index === 0 ? "" : "mt-10"}>
                  <SectionHeading id={section.id}>{section.heading}</SectionHeading>
                  <Paragraphs paragraphs={section.paragraphs} />
                </section>
              ))}
            </div>
          </div>
        </div>

        <section className="border-t border-nx-line bg-white" aria-label="More articles">
          <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-nx-teal">Keep reading</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((item) => (
                <button
                  key={item.slug}
                  type="button"
                  onClick={() => navigate(`/blogs/${item.slug}`)}
                  className="group overflow-hidden rounded-2xl border border-nx-line bg-white text-left transition-all hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-[0_24px_48px_-32px_rgba(6,52,44,0.4)]"
                >
                  <span className="block aspect-[16/10] overflow-hidden">
                    <img src={coverFor(item)} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" loading="lazy" />
                  </span>
                  <span className="block p-5">
                    <CategoryChip category={item.category} />
                    <span className="mt-3 block font-display text-lg font-bold leading-snug text-nx-ink group-hover:text-nx-teal">
                      {item.title}
                    </span>
                    <span className="mt-2 block text-xs text-nx-faint">
                      {item.date}
                      <span aria-hidden="true"> · </span>
                      {item.readTime}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      </article>
    </PublicPageShell>
  )
}

export default BlogArticlePage
