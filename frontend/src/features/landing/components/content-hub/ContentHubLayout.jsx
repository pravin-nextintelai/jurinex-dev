import PropTypes from "prop-types"
import { Link } from "react-router-dom"
import PublicPageShell from "../PublicPageShell"
import ContentHubNav from "./ContentHubNav"
import { Icon } from "../primitives"

/** Site Navbar + dark Content Hub bar + a centred content column. */
const ContentHubLayout = ({ children }) => (
  <PublicPageShell>
    <ContentHubNav />
    <div className="mx-auto max-w-6xl px-5 pb-20 pt-6 sm:px-8">{children}</div>
  </PublicPageShell>
)

ContentHubLayout.propTypes = { children: PropTypes.node }

export const HubEmptyState = ({ message, href = "/content-hub", linkLabel = "Back to Top Stories" }) => (
  <div className="mt-8 rounded-md border border-dashed border-nx-line bg-nx-pale/60 px-6 py-14 text-center">
    <Icon name="Newspaper" className="mx-auto h-8 w-8 text-nx-faint" />
    <p className="mt-3 text-nx-muted">{message}</p>
    <Link
      to={href}
      className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-nx-ink hover:text-teal-700"
    >
      {linkLabel}
      <Icon name="ChevronRight" className="h-4 w-4" />
    </Link>
  </div>
)

HubEmptyState.propTypes = {
  message: PropTypes.string.isRequired,
  href: PropTypes.string,
  linkLabel: PropTypes.string,
}

export default ContentHubLayout
