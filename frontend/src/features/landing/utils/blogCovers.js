/* Each post has its own cover in assets/landing/blog, named after the   */
/* post's slug. The same image is used on the index, in related cards   */
/* and in the reader. A post without a cover falls back to the first    */
/* one in the folder so the layout never breaks.                        */

const files = import.meta.glob("@/assets/landing/blog/*.png", { eager: true, import: "default" })

const COVERS = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [path.split("/").pop().replace(/\.png$/, ""), url]),
)

const FALLBACK = Object.values(COVERS)[0]

export const coverFor = (post) => COVERS[post.slug] || FALLBACK
