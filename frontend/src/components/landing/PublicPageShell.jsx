import { useEffect, useState } from "react"
import PropTypes from "prop-types"
import { useNavigate } from "react-router-dom"
import Navbar from "./Navbar"
import Footer from "./Footer"
import PolicyModal from "./PolicyModal"
import BookDemoModal from "./BookDemoModal"
import { useDemoPrompt } from "../../hooks/useDemoPrompt"
import ChatbotWidget from "./ChatbotWidget"
import { Icon } from "./primitives"

/**
 * Shell for standalone public pages (Blogs, FAQs, Team, Community, Help…).
 * Renders the same landing Navbar and Footer around the page body, wires
 * Login / Book a Demo / policy modals, and scrolls to the top on mount.
 *
 * The Navbar is fixed and 5rem tall, so the body starts with a matching
 * top offset. An optional breadcrumb strip sits under the bar.
 */
const PublicPageShell = ({ title, children, className = "" }) => {
  const navigate = useNavigate()
  const [demoOpen, setDemoOpen] = useState(false)
  const [policyKey, setPolicyKey] = useState(null)
  useDemoPrompt(setDemoOpen)

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" })
  }, [])

  return (
    <div className="min-h-screen bg-white font-body text-nx-ink antialiased">
      <Navbar
        onRequestDemo={() => setDemoOpen(true)}
        onLogin={(loginState) =>
          navigate("/login", loginState ? { state: loginState } : undefined)
        }
      />

      <main className={`pt-20 ${className}`}>
        {title && (
          <nav
            aria-label="Breadcrumb"
            className="border-b border-nx-line bg-nx-pale/60"
          >
            <ol className="mx-auto flex max-w-7xl items-center gap-2 px-5 py-3 text-sm sm:px-8">
              <li>
                <button
                  type="button"
                  onClick={() => navigate("/")}
                  className="inline-flex items-center gap-1.5 text-nx-muted transition-colors hover:text-teal-700"
                >
                  <Icon name="ArrowLeft" className="h-3.5 w-3.5" />
                  Home
                </button>
              </li>
              <li aria-hidden="true" className="text-nx-faint">
                /
              </li>
              <li aria-current="page" className="font-medium text-nx-ink">
                {title}
              </li>
            </ol>
          </nav>
        )}
        {children}
      </main>

      <Footer
        onOpenPolicy={setPolicyKey}
        onGetInTouch={() => navigate("/contact")}
        onRequestDemo={() => setDemoOpen(true)}
      />

      <BookDemoModal isOpen={demoOpen} onClose={() => setDemoOpen(false)} />
      {policyKey && <PolicyModal policyKey={policyKey} onClose={() => setPolicyKey(null)} />}

      <ChatbotWidget />
    </div>
  )
}

PublicPageShell.propTypes = {
  title: PropTypes.string,
  children: PropTypes.node,
  className: PropTypes.string,
}

export default PublicPageShell
