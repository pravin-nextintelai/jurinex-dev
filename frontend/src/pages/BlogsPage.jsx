import { useState } from "react"
import { AnimatePresence, motion as Motion, useReducedMotion } from "framer-motion"
import PublicPageShell from "../components/landing/PublicPageShell"
import { Icon, Reveal, SectionHeading } from "../components/landing/primitives"
import { EASE } from "../components/landing/motionTokens"
import { BLOG_POSTS, SOCIAL_LINKS } from "../utils/landingConstants"

const CATEGORIES = ["All", ...Array.from(new Set(BLOG_POSTS.map((p) => p.category)))]

/**
 * Standalone /blogs page — filterable article cards; each card expands in
 * place to show the full post. Content lives in BLOG_POSTS.
 */
const BlogsPage = () => {
  const reduce = useReducedMotion()
  const [category, setCategory] = useState("All")
  const [openSlug, setOpenSlug] = useState(null)

  const posts = category === "All" ? BLOG_POSTS : BLOG_POSTS.filter((p) => p.category === category)

  return (
    <PublicPageShell title="Blogs">
      <section className="bg-nx-pale py-20 sm:py-24" aria-labelledby="blogs-heading">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHeading
            id="blogs-heading"
            eyebrow="Resource center"
            title="Notes from the Jurinex team"
            lede="Practical writing on legal AI, drafting, research and running a modern Indian practice."
          />

          <Reveal className="mt-10 flex flex-wrap justify-center gap-2">
            {CATEGORIES.map((c) => {
              const active = c === category
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setCategory(c)
                    setOpenSlug(null)
                  }}
                  aria-pressed={active}
                  className={`rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "border-nx-teal bg-nx-teal text-white"
                      : "border-nx-ink/40 bg-white text-nx-ink hover:border-nx-teal hover:text-nx-teal"
                  }`}
                >
                  {c}
                </button>
              )
            })}
          </Reveal>
        </div>
      </section>

      <section className="bg-white py-16 sm:py-20" aria-label="Articles">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post, i) => {
              const isOpen = openSlug === post.slug
              return (
                <Reveal
                  key={post.slug}
                  delay={i * 0.04}
                  className={`flex flex-col rounded-2xl border border-nx-ink/75 bg-white p-6 transition-shadow ${
                    isOpen ? "shadow-[0_16px_40px_-20px_rgba(13,60,55,0.35)] md:col-span-2 lg:col-span-3" : ""
                  }`}
                >
                  <div className="flex items-center gap-3 text-xs text-nx-faint">
                    <span className="rounded-full bg-nx-pale px-2.5 py-1 font-semibold text-nx-teal">
                      {post.category}
                    </span>
                    <span>{post.date}</span>
                    <span aria-hidden="true">·</span>
                    <span>{post.readTime}</span>
                  </div>

                  <h3 className="mt-4 font-display text-xl font-semibold leading-snug text-nx-ink">
                    {post.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-nx-muted">{post.excerpt}</p>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <Motion.div
                        key="body"
                        initial={reduce ? false : { opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={reduce ? undefined : { opacity: 0, height: 0 }}
                        transition={{ duration: 0.28, ease: EASE }}
                        className="overflow-hidden"
                      >
                        <div className="mt-5 max-w-3xl space-y-4 border-t border-nx-line pt-5 text-[15px] leading-relaxed text-nx-ink/90">
                          {post.body.map((para, j) => (
                            <p key={j}>{para}</p>
                          ))}
                          <p className="text-sm text-nx-faint">— {post.author}</p>
                        </div>
                      </Motion.div>
                    )}
                  </AnimatePresence>

                  <button
                    type="button"
                    onClick={() => setOpenSlug(isOpen ? null : post.slug)}
                    aria-expanded={isOpen}
                    className="mt-5 inline-flex items-center gap-1.5 self-start text-sm font-semibold text-nx-teal transition-colors hover:text-teal-800"
                  >
                    {isOpen ? "Show less" : "Read article"}
                    <Icon
                      name="ChevronDown"
                      className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                </Reveal>
              )
            })}
          </div>

          <Reveal className="mt-16 rounded-2xl border border-nx-ink/75 bg-nx-pale p-8 text-center">
            <p className="font-display text-xl font-semibold text-nx-ink">Get new posts where you already are</p>
            <p className="mt-2 text-sm text-nx-muted">We share every article on our social channels.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SOCIAL_LINKS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-nx-ink/40 bg-white px-4 py-1.5 text-sm font-medium text-nx-ink transition-colors hover:border-nx-teal hover:text-nx-teal"
                >
                  {s.label}
                </a>
              ))}
            </div>
          </Reveal>
        </div>
      </section>
    </PublicPageShell>
  )
}

export default BlogsPage
