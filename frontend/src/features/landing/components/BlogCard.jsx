import PropTypes from "prop-types"
import { useNavigate } from "react-router-dom"
import { Icon } from "./primitives"
import { coverFor } from "../utils/blogCovers"

/* ------------------------------------------------------------------ */
/* Blog cards shared by the /blogs index and the article reader.       */
/* ------------------------------------------------------------------ */

const CATEGORY_TONE = {
  "Legal AI": "bg-teal-50 text-nx-teal-ink ring-teal-200",
  "Legal Research": "bg-sky-50 text-sky-800 ring-sky-200",
  Drafting: "bg-amber-50 text-amber-800 ring-amber-200",
  Litigation: "bg-stone-100 text-stone-800 ring-stone-300",
  Compliance: "bg-rose-50 text-rose-800 ring-rose-200",
  "Practice Management": "bg-violet-50 text-violet-800 ring-violet-200",
  "Product Updates": "bg-emerald-50 text-emerald-800 ring-emerald-200",
}

export const CategoryChip = ({ category, className = "" }) => (
  <span
    className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ring-1 ring-inset ${
      CATEGORY_TONE[category] || "bg-nx-pale text-nx-muted ring-nx-line"
    } ${className}`}
  >
    {category}
  </span>
)

CategoryChip.propTypes = { category: PropTypes.string.isRequired, className: PropTypes.string }

export const Meta = ({ post, className = "" }) => (
  <div className={`flex flex-wrap items-center gap-x-2 text-xs text-nx-faint ${className}`}>
    <span className="font-medium text-nx-muted">{post.author}</span>
    <span aria-hidden="true">·</span>
    <span>{post.date}</span>
    <span aria-hidden="true">·</span>
    <span>{post.readTime}</span>
  </div>
)

Meta.propTypes = { post: PropTypes.object.isRequired, className: PropTypes.string }

/** Standard grid card: photograph, category, title, excerpt, byline. */
export const BlogCard = ({ post, compact = false }) => {
  const navigate = useNavigate()
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-nx-line bg-white transition-all duration-200 hover:-translate-y-1 hover:border-nx-teal/40 hover:shadow-[0_28px_56px_-32px_rgba(6,52,44,0.4)]">
      <button
        type="button"
        onClick={() => navigate(`/blogs/${post.slug}`)}
        className="flex h-full flex-col text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-nx-teal"
        aria-label={post.title}
      >
        <span className={`relative block overflow-hidden ${compact ? "aspect-[16/9]" : "aspect-[16/10]"}`}>
          <img
            src={coverFor(post)}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            loading="lazy"
          />
          <span className="absolute inset-0 bg-gradient-to-t from-nx-ink/50 via-transparent to-transparent" aria-hidden="true" />
          <CategoryChip category={post.category} className="absolute left-4 top-4 bg-white/95" />
        </span>
        <span className="flex flex-1 flex-col p-6">
          <span className="block font-display text-xl font-semibold leading-snug text-nx-ink transition-colors group-hover:text-nx-teal-ink">
            {post.title}
          </span>
          {!compact && <span className="mt-3 block flex-1 text-sm leading-relaxed text-nx-muted line-clamp-3">{post.excerpt}</span>}
          <span className="mt-5 flex items-center justify-between gap-3 border-t border-nx-line pt-4">
            <Meta post={post} />
            <Icon name="ArrowRight" className="h-4 w-4 flex-none text-nx-teal transition-transform group-hover:translate-x-1" />
          </span>
        </span>
      </button>
    </article>
  )
}

BlogCard.propTypes = { post: PropTypes.object.isRequired, compact: PropTypes.bool }

/** Large lead card for the newest article on the index page. */
export const FeaturedCard = ({ post }) => {
  const navigate = useNavigate()
  return (
    <article className="group overflow-hidden rounded-3xl border border-nx-line bg-white shadow-[0_32px_72px_-40px_rgba(6,52,44,0.45)]">
      <button
        type="button"
        onClick={() => navigate(`/blogs/${post.slug}`)}
        className="grid w-full grid-cols-1 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-nx-teal lg:grid-cols-12"
        aria-label={post.title}
      >
        <span className="relative block aspect-[16/10] overflow-hidden lg:col-span-7 lg:aspect-auto lg:min-h-[420px]">
          <img
            src={coverFor(post)}
            alt=""
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
          />
          <span className="absolute inset-0 bg-gradient-to-r from-nx-ink/30 to-transparent" aria-hidden="true" />
        </span>
        <span className="flex flex-col justify-between p-7 sm:p-9 lg:col-span-5 lg:p-11">
          <span>
            <span className="flex items-center gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-nx-teal">Featured</span>
              <span className="h-px w-8 bg-nx-teal" aria-hidden="true" />
              <CategoryChip category={post.category} />
            </span>
            <span className="mt-5 block font-display text-[1.75rem] font-semibold leading-[1.2] text-nx-ink transition-colors group-hover:text-nx-teal-ink sm:text-[2.1rem]">
              {post.title}
            </span>
            <span className="mt-4 block text-base leading-relaxed text-nx-muted">{post.excerpt}</span>
          </span>
          <span className="mt-8 flex items-center justify-between gap-4 border-t border-nx-line pt-5">
            <Meta post={post} />
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-nx-teal">
              Read article
              <Icon name="ArrowRight" className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </span>
          </span>
        </span>
      </button>
    </article>
  )
}

FeaturedCard.propTypes = { post: PropTypes.object.isRequired }
