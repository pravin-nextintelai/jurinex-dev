import { useEffect, useRef, useState } from "react"
import PropTypes from "prop-types"
import { useLocation, useNavigate } from "react-router-dom"
import { motion as Motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { isModifiedClick, toPublicHref } from "../seo/site"
import { NAV_LINKS } from "../utils/landingConstants"
import { useLandingScrollAnimation } from "../hooks/useLandingScrollAnimation"
import { EASE } from "./motionTokens"
import { Icon } from "./primitives"
import BrandLogo from "./BrandLogo"
import PromotionBanner from "./PromotionBanner"
import productPhoto from "@/assets/landing/menu-product.jpg"
import solutionsPhoto from "@/assets/landing/menu-solutions.jpg"
import resourcesPhoto from "@/assets/landing/menu-resources.jpg"

const FEATURE_IMAGES = { product: productPhoto, solutions: solutionsPhoto, resources: resourcesPhoto }

const SECTION_IDS = NAV_LINKS.filter((l) => l.href.startsWith("#")).map((l) =>
  l.href.replace("#", "")
)

const useActiveSection = () => {
  const [active, setActive] = useState("")

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id)
        })
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: 0 }
    )

    SECTION_IDS.forEach((id) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [])

  return active
}

/** Split a flat list of links into two balanced columns. */
const twoColumns = (links) => {
  const half = Math.ceil(links.length / 2)
  return [links.slice(0, half), links.slice(half)]
}

/** One entry in the mega menu: title on top, one-line description below. */
const MenuEntry = ({ entry, onGo, active = false }) => (
  <a
    role="menuitem"
    href={toPublicHref(entry.href)}
    onClick={(event) => {
      if (isModifiedClick(event)) return
      event.preventDefault()
      onGo(entry.href)
    }}
    className={`group flex w-full items-start gap-3.5 rounded-xl px-3 py-3 text-left transition-colors hover:bg-teal-50/80 focus-visible:outline-2 focus-visible:outline-nx-teal ${
      active ? "bg-teal-50/80" : ""
    }`}
  >
    {entry.icon && (
      <span className="mt-0.5 inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-teal-50 text-nx-teal ring-1 ring-teal-100 transition-colors group-hover:bg-nx-teal group-hover:text-white group-hover:ring-nx-teal">
        <Icon name={entry.icon} className="h-4.5 w-4.5" strokeWidth={1.8} />
      </span>
    )}
    <span className="min-w-0 flex-1">
      <span
        className={`flex items-center gap-1.5 text-sm font-semibold group-hover:text-teal-700 ${
          active ? "text-teal-700" : "text-nx-ink"
        }`}
      >
        {entry.label}
        <Icon
          name="ArrowRight"
          className="h-3.5 w-3.5 -translate-x-1 text-nx-teal opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
        />
      </span>
      {entry.desc && (
        <span className="mt-1 block max-w-xs text-[13px] leading-snug text-nx-muted">{entry.desc}</span>
      )}
    </span>
  </a>
)

MenuEntry.propTypes = {
  entry: PropTypes.shape({
    label: PropTypes.string,
    href: PropTypes.string,
    desc: PropTypes.string,
    icon: PropTypes.string,
  }).isRequired,
  onGo: PropTypes.func.isRequired,
  active: PropTypes.bool,
}

/**
 * Short list anchored to one nav item. Same type, teal hover and card
 * shadow as the mega menu, without the full-width feature panel.
 */
const CompactMenu = ({ link, onGo, reduceMotion, activeHref, panelRef }) => (
  <Motion.div
    ref={panelRef}
    key={link.label}
    initial={reduceMotion ? false : { opacity: 0, y: -6 }}
    animate={{ opacity: 1, y: 0 }}
    exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
    transition={{ duration: 0.18, ease: EASE }}
    className="absolute right-0 top-full z-50 w-[22rem] pt-2"
    role="menu"
    aria-label={`${link.label} menu`}
  >
    <div className="overflow-hidden rounded-2xl border border-teal-100 bg-white p-2 shadow-[0_24px_48px_-24px_rgba(13,60,55,0.28)]">
      {link.children.map((entry) => (
        <MenuEntry key={entry.label} entry={entry} onGo={onGo} active={entry.href === activeHref} />
      ))}
    </div>
  </Motion.div>
)

CompactMenu.propTypes = {
  link: PropTypes.object.isRequired,
  onGo: PropTypes.func.isRequired,
  reduceMotion: PropTypes.bool,
  activeHref: PropTypes.string,
  panelRef: PropTypes.oneOfType([PropTypes.func, PropTypes.shape({ current: PropTypes.any })]),
}

/**
 * Full-width panel under the bar: two or more columns of titled entries
 * on the left and a featured card with image on the right.
 */
const MegaMenu = ({ link, onGo, reduceMotion }) => {
  const columns = link.sections
    ? link.sections.map((s) => ({ heading: s.heading, links: s.links }))
    : twoColumns(link.children).map((links) => ({ links }))
  const feature = link.feature

  return (
    <Motion.div
      key={link.label}
      initial={reduceMotion ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
      transition={{ duration: 0.18, ease: EASE }}
      className="hidden overflow-hidden rounded-b-[2rem] border-t border-teal-100 bg-white shadow-[0_24px_48px_-24px_rgba(13,60,55,0.28)] xl:block"
      role="menu"
      aria-label={`${link.label} menu`}
    >
      <div
        className={`mx-auto grid max-w-7xl gap-10 px-5 py-9 sm:px-8 ${
          feature ? "lg:grid-cols-[1fr_1fr_minmax(0,22rem)]" : "lg:grid-cols-2"
        }`}
      >
        {columns.map((col, i) => (
          <div key={col.heading || i}>
            {col.heading && (
              <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-nx-faint">
                {col.heading}
              </p>
            )}
            <div className="space-y-0.5">
              {col.links.map((entry) => (
                <MenuEntry key={entry.label} entry={entry} onGo={onGo} />
              ))}
            </div>
          </div>
        ))}

        {feature && (
          <a
            role="menuitem"
            href={toPublicHref(feature.href)}
            onClick={(event) => {
              if (isModifiedClick(event)) return
              event.preventDefault()
              onGo(feature.href)
            }}
            className="group text-left lg:border-l lg:border-nx-line lg:pl-10"
          >
            <span className="relative block overflow-hidden rounded-2xl border border-nx-line shadow-[0_16px_36px_-20px_rgba(6,52,44,0.35)]">
              <img
                src={FEATURE_IMAGES[feature.image]}
                alt=""
                className="aspect-[16/10] w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                loading="lazy"
              />
              <span
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-nx-forest/70 via-nx-forest/10 to-transparent"
                aria-hidden="true"
              />
              {feature.badge && (
                <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-nx-teal-deep shadow-sm">
                  {feature.badge}
                </span>
              )}
              <span className="absolute bottom-3 left-4 right-4 font-display text-lg font-semibold leading-tight text-white drop-shadow">
                {feature.eyebrow}
              </span>
            </span>
            <span className="mt-3.5 block text-[13px] leading-snug text-nx-muted">{feature.text}</span>
            <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-nx-teal-deep">
              {feature.cta || "Learn more"}
              <Icon
                name="ArrowRight"
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1"
              />
            </span>
          </a>
        )}
      </div>
    </Motion.div>
  )
}

MegaMenu.propTypes = {
  link: PropTypes.object.isRequired,
  onGo: PropTypes.func.isRequired,
  reduceMotion: PropTypes.bool,
}

/**
 * Brevo-style top bar: solid light-teal ground, brand + left-aligned nav
 * with full-width mega menus, a pill Login link and a teal trial button.
 * Used on the landing page and all public pages. The demo modal opens
 * on a timer or from the right-edge Schedule a demo tab.
 */
const Navbar = ({ onLogin, onSectionNav, onRequestDemo, onPromoVisibilityChange } = {}) => {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const reduceMotion = useReducedMotion()
  const { scrolled } = useLandingScrollAnimation({ thresholdPx: 8 })
  const activeSection = useActiveSection()
  const isLinkActive = (href) => {
    if (!href.startsWith("/")) return activeSection === href.replace("#", "")
    const [path, query] = href.split("?")
    if (query) return pathname === path && search === `?${query}`
    return pathname === path || pathname.startsWith(`${path}/`)
  }
  const isItemActive = (link) =>
    isLinkActive(link.href) ||
    (link.children || []).some((child) => child.href?.startsWith("/") && isLinkActive(child.href))

  /** Longest matching child wins, so a specific item beats its section home. */
  const activeChildHref = (children = []) => {
    const matches = children.filter((child) => {
      const href = child.href || ""
      if (href.startsWith("#")) return activeSection === href.slice(1)
      const [path, query] = href.split("?")
      if (query) return pathname === path && search === `?${query}`
      return pathname === path || pathname.startsWith(`${path}/`)
    })
    return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href
  }
  const [menuOpen, setMenuOpen] = useState(false) // mobile drawer
  const [openDropdown, setOpenDropdown] = useState(null) // desktop mega menu label
  const headerRef = useRef(null)
  const menuPanelRef = useRef(null)
  const closeTimer = useRef(null)

  const openMenu = (label) => {
    clearTimeout(closeTimer.current)
    setOpenDropdown(label)
  }
  const scheduleClose = () => {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpenDropdown(null), 120)
  }

  // Close the mobile menu when resizing up to desktop (Tailwind `xl`)
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1280) setMenuOpen(false)
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // Lock body scroll while the drawer is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [menuOpen])

  // Close menus on outside click / Escape
  useEffect(() => {
    const onDown = (e) => {
      if (headerRef.current && !headerRef.current.contains(e.target)) setOpenDropdown(null)
    }
    const onKey = (e) => {
      if (e.key !== "Escape") return
      if (menuPanelRef.current?.contains(document.activeElement)) {
        headerRef.current?.querySelector('nav [aria-expanded="true"]')?.focus()
      }
      setOpenDropdown(null)
    }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
      clearTimeout(closeTimer.current)
    }
  }, [])

  /** Follow any nav href: external URL, route, in-page anchor, or cross-page section. */
  const go = (href, { fromDrawer = false } = {}) => {
    setOpenDropdown(null)
    if (fromDrawer) setMenuOpen(false)

    if (/^(https?:|mailto:)/.test(href)) {
      window.open(href, "_blank", "noopener,noreferrer")
      return
    }
    if (href.startsWith("/#") || href.startsWith("#")) {
      const id = href.replace(/^\/?#/, "")
      if (onSectionNav) {
        onSectionNav(id)
        return
      }
      const scroll = () => {
        const el = document.getElementById(id)
        if (el) el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" })
        else navigate("/", { state: { scrollTo: id } })
      }
      // Wait for the drawer to close and body overflow to restore before scrolling
      if (fromDrawer) setTimeout(scroll, 320)
      else scroll()
      return
    }
    if (href.startsWith("/")) navigate(href)
  }

  const openLink = NAV_LINKS.find((l) => l.label === openDropdown)
  /**
   * The bar is transparent with white type only over the home hero at the
   * very top of the page. Everywhere else, and once scrolled or a menu is
   * open, it is white with dark type.
   */
  const onDarkHero = pathname === "/"
  const solidBar = !onDarkHero || scrolled || menuOpen || Boolean(openDropdown)

  return (
    <>
    <header
      ref={headerRef}
      onMouseLeave={scheduleClose}
      className={`fixed inset-x-0 top-0 z-50 border border-t-0 font-body transition-[background-color,box-shadow,border-color,border-radius] duration-300 ${
        menuOpen ? "rounded-none" : "rounded-b-[2rem]"
      } ${
        solidBar
          ? "border-teal-200 bg-white/95 shadow-[0_1px_12px_rgba(8,163,147,0.12)] backdrop-blur"
          : "border-transparent bg-transparent"
      }`}
    >
      {onDarkHero && <PromotionBanner onVisibilityChange={onPromoVisibilityChange} />}
      <nav
        className={`mx-auto flex h-20 w-full max-w-7xl items-center gap-6 px-5 transition-transform duration-300 sm:px-8 ${
          solidBar ? "translate-y-0" : "translate-y-2.5"
        }`}
        aria-label="Primary"
      >
        {/* Brand */}
        <a
          href="/"
          onClick={(e) => {
            if (isModifiedClick(e)) return
            e.preventDefault()
            go("/")
          }}
          className="flex shrink-0 items-center transition-opacity hover:opacity-85"
          aria-label="Jurinex.ai — home"
        >
          <BrandLogo light={!solidBar} />
        </a>

        {/* Desktop links, left-aligned next to the brand */}
        <ul className="mx-auto hidden h-full items-center gap-0.5 pl-2 xl:flex">
          {NAV_LINKS.map((link) => {
            const hasMenu =
              (Array.isArray(link.sections) && link.sections.length > 0) ||
              (Array.isArray(link.children) && link.children.length > 0)
            const isActive = isItemActive(link)
            const isOpen = openDropdown === link.label

            return (
              <li
                key={link.label}
                className="relative flex h-full items-center"
                onMouseEnter={() => (hasMenu ? openMenu(link.label) : scheduleClose())}
              >
                <a
                  href={toPublicHref(link.href)}
                  onClick={(event) => {
                    if (isModifiedClick(event)) return
                    event.preventDefault()
                    if (hasMenu) setOpenDropdown(isOpen ? null : link.label)
                    else go(link.href)
                  }}
                  onKeyDown={(e) => {
                    if (!hasMenu || e.key !== "ArrowDown") return
                    e.preventDefault()
                    openMenu(link.label)
                    requestAnimationFrame(() =>
                      menuPanelRef.current?.querySelector('[role="menuitem"]')?.focus()
                    )
                  }}
                  aria-expanded={hasMenu ? isOpen : undefined}
                  aria-haspopup={hasMenu ? "menu" : undefined}
                  className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-2 text-[15px] font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-nx-teal ${
                    isActive || isOpen
                      ? solidBar ? "text-teal-700" : "text-nx-mint"
                      : solidBar ? "text-nx-ink hover:text-teal-700" : "text-white hover:text-nx-mint"
                  }`}
                >
                  {link.label}
                  {hasMenu && (
                    <Icon
                      name="ChevronDown"
                      className={`h-3.5 w-3.5 transition-transform duration-200 ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                  )}
                </a>
                {/* Underline for the open menu, Harvey-style */}
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-3.5 bottom-0 h-0.5 rounded-full bg-teal-700 transition-opacity ${
                    isOpen ? "opacity-100" : "opacity-0"
                  }`}
                />
                <AnimatePresence>
                  {isOpen && link.menu === "compact" && (
                    <CompactMenu
                      link={link}
                      onGo={go}
                      reduceMotion={reduceMotion}
                      activeHref={activeChildHref(link.children)}
                      panelRef={menuPanelRef}
                    />
                  )}
                </AnimatePresence>
              </li>
            )
          })}
        </ul>

        {/* Desktop actions */}
        <div className="ml-auto hidden items-center gap-3 xl:flex">
          <a
            href="/login"
            onClick={(event) => {
              if (!onLogin || isModifiedClick(event)) return
              event.preventDefault()
              onLogin()
            }}
            aria-label="Log in to your account"
            className={`whitespace-nowrap rounded-lg border px-5 py-2 text-sm font-semibold transition-colors ${
              solidBar
                ? "border-nx-ink/30 text-black hover:border-teal-600 hover:text-teal-700"
                : "border-white/70 text-white hover:border-white hover:bg-white/10"
            }`}
          >
            Login
          </a>
          <a
            href="/register"
            onClick={(event) => {
              if (isModifiedClick(event)) return
              event.preventDefault()
              navigate("/register")
            }}
            aria-label="Start your free trial"
            className="whitespace-nowrap rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-teal-500/25 transition-all duration-200 hover:bg-teal-700 active:scale-[0.98]"
          >
            Start Free Trial
          </a>
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          className={`ml-auto flex h-10 w-10 items-center justify-center rounded-lg transition-colors xl:hidden ${
            solidBar ? "text-black hover:bg-teal-200/60" : "text-white hover:bg-white/10"
          }`}
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
        >
          <span className="relative flex h-4 w-5 flex-col justify-between" aria-hidden="true">
            <Motion.span
              animate={menuOpen ? { rotate: 45, y: 7 } : { rotate: 0, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.22 }}
              className="block h-0.5 w-full rounded-full bg-current"
            />
            <Motion.span
              animate={menuOpen ? { opacity: 0, scaleX: 0 } : { opacity: 1, scaleX: 1 }}
              transition={{ duration: reduceMotion ? 0 : 0.16 }}
              className="block h-0.5 w-full rounded-full bg-current"
            />
            <Motion.span
              animate={menuOpen ? { rotate: -45, y: -7 } : { rotate: 0, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.22 }}
              className="block h-0.5 w-full rounded-full bg-current"
            />
          </span>
        </button>
      </nav>

      {/* Desktop mega menu */}
      <AnimatePresence>
        {openLink && openLink.menu !== "compact" && (
          <div ref={menuPanelRef} onMouseEnter={() => openMenu(openLink.label)}>
            <MegaMenu link={openLink} onGo={go} reduceMotion={reduceMotion} />
          </div>
        )}
      </AnimatePresence>

      {/* Mobile drawer */}
      <AnimatePresence>
        {menuOpen && (
          <Motion.div
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className={`${onDarkHero ? "max-h-[calc(100dvh-9.5rem)] sm:max-h-[calc(100dvh-7.5rem)]" : "max-h-[calc(100dvh-5rem)]"} overflow-y-auto border-t border-nx-line bg-white xl:hidden`}
          >
            <div className="flex flex-col gap-0.5 px-5 py-4">
              {NAV_LINKS.map((link, i) => (
                <Motion.div
                  key={link.label}
                  initial={reduceMotion ? false : { opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.22 }}
                >
                  <a
                    href={toPublicHref(link.href)}
                    onClick={(event) => {
                      if (isModifiedClick(event)) return
                      event.preventDefault()
                      go(link.href, { fromDrawer: true })
                    }}
                    className={`block w-full rounded-lg px-4 py-3 text-left text-sm font-semibold transition-colors ${
                      isItemActive(link)
                        ? "bg-teal-500/10 text-teal-700"
                        : "text-black hover:bg-teal-200/60 hover:text-teal-700"
                    }`}
                  >
                    {link.label}
                  </a>
                  {link.children && (
                    <div className="mb-1 ml-4 border-l border-teal-200 pl-2">
                      {link.children.map((child) => (
                        <a
                          key={child.label}
                          href={toPublicHref(child.href)}
                          onClick={(event) => {
                            if (isModifiedClick(event)) return
                            event.preventDefault()
                            go(child.href, { fromDrawer: true })
                          }}
                          className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-teal-200/60 hover:text-teal-700 ${
                            isLinkActive(child.href)
                              ? "bg-teal-500/10 font-semibold text-teal-700"
                              : "text-gray-700"
                          }`}
                        >
                          {child.label}
                        </a>
                      ))}
                    </div>
                  )}
                  {link.sections && (
                    <div className="mb-1 ml-4 border-l border-teal-200 pl-2">
                      {link.sections.map((section) => (
                        <div key={section.heading}>
                          <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-nx-faint">
                            {section.heading}
                          </p>
                          {section.links.map((child) => (
                            <a
                              key={child.label}
                              href={toPublicHref(child.href)}
                              onClick={(event) => {
                                if (isModifiedClick(event)) return
                                event.preventDefault()
                                go(child.href, { fromDrawer: true })
                              }}
                              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-teal-200/60 hover:text-teal-700"
                            >
                              {child.label}
                            </a>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </Motion.div>
              ))}

              <div className="mt-3 flex flex-col gap-2.5 border-t border-teal-200 pt-4">
                <a
                  href="/login"
                  onClick={(event) => {
                    if (isModifiedClick(event)) return
                    event.preventDefault()
                    setMenuOpen(false)
                    onLogin?.()
                  }}
                  className="w-full rounded-lg border border-nx-ink/30 py-2.5 text-center text-sm font-medium text-black transition-colors hover:bg-white"
                >
                  Login
                </a>
                <a
                  href="/register"
                  onClick={(event) => {
                    if (isModifiedClick(event)) return
                    event.preventDefault()
                    setMenuOpen(false)
                    navigate("/register")
                  }}
                  className="w-full rounded-lg bg-teal-600 py-2.5 text-center text-sm font-semibold text-white shadow-md shadow-teal-500/25 transition-transform hover:bg-teal-700 active:scale-[0.99]"
                >
                  Start Free Trial
                </a>
              </div>
            </div>
          </Motion.div>
        )}
      </AnimatePresence>
    </header>
    <a
      href="/contact"
      onClick={(event) => {
        if (isModifiedClick(event)) return
        event.preventDefault()
        setMenuOpen(false)
        setOpenDropdown(null)
        if (onRequestDemo) onRequestDemo()
        else navigate("/contact")
      }}
      className="fixed right-0 top-1/3 z-40 flex items-center justify-center rounded-l-lg border border-r-0 border-white/20 bg-gradient-to-b from-nx-teal to-nx-teal-ink px-1.5 py-5 text-sm font-semibold tracking-wide text-white shadow-[-4px_4px_18px_rgba(8,163,147,0.25)] transition-colors hover:from-nx-teal-deep hover:to-nx-teal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nx-teal"
      aria-label="Schedule a demo"
    >
      <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>Schedule a demo</span>
    </a>
    </>
  )
}

Navbar.propTypes = {
  onRequestDemo: PropTypes.func,
  onPromoVisibilityChange: PropTypes.func,
  onLogin: PropTypes.func,
  onSectionNav: PropTypes.func,
  solid: PropTypes.bool,
}

export default Navbar
