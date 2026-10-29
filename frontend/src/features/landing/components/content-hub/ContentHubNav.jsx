import { useEffect, useRef, useState } from "react"
import PropTypes from "prop-types"
import { Link, useLocation } from "react-router-dom"
import { Icon } from "../primitives"
import { HUB_NAV } from "../../utils/contentHubData"

const LINK_BASE =
  "whitespace-nowrap rounded px-2 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600"

const useIsActive = () => {
  const { pathname, search } = useLocation()
  return (href) => {
    const [path, query] = href.split("?")
    if (query) return pathname === path && search === `?${query}`
    if (path === "/content-hub") return pathname === path && !search
    return pathname === path || pathname.startsWith(`${path}/`)
  }
}

/** Move focus through a list of elements, wrapping at both ends. */
const focusSibling = (list, current, step) => {
  const items = Array.from(list)
  if (!items.length) return
  items[(items.indexOf(current) + step + items.length) % items.length].focus()
}

/** One hub-bar item with a hover / click dropdown, keyboard accessible. */
const HubNavDropdown = ({ item, active, alignRight }) => {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const closeTimer = useRef(null)
  const menuId = `hub-menu-${item.label.replace(/\s+/g, "-").toLowerCase()}`

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  const show = () => {
    clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const hide = () => {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }
  const focusFirst = () => requestAnimationFrame(() => menuRef.current?.querySelector("a")?.focus())

  const onButtonKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      show()
      focusFirst()
    } else if (e.key === "Escape") {
      setOpen(false)
    }
  }

  const onMenuKey = (e) => {
    const links = menuRef.current?.querySelectorAll("a") || []
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      focusSibling(links, document.activeElement, e.key === "ArrowDown" ? 1 : -1)
    } else if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
    }
  }

  return (
    <li
      className="relative"
      onMouseEnter={show}
      onMouseLeave={hide}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onButtonKey}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={menuId}
        className={`${LINK_BASE} inline-flex items-center gap-1 ${
          active || open ? "text-teal-700" : "text-nx-ink hover:text-teal-700"
        }`}
      >
        {item.label}
        <Icon
          name="ChevronDown"
          className={`h-3 w-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          id={menuId}
          ref={menuRef}
          onKeyDown={onMenuKey}
          className={`absolute top-full z-50 pt-1.5 ${alignRight ? "right-0" : "left-0"}`}
        >
          <ul
            className={`max-h-[70vh] overflow-y-auto rounded-lg border border-teal-200 bg-teal-50 p-2 shadow-[0_18px_40px_-16px_rgba(13,60,55,0.3)] ${
              item.columns ? "w-[46rem] columns-3 gap-x-4" : "w-60"
            }`}
          >
            {item.menu.map((entry) => (
              <li key={entry.href + entry.label} className="break-inside-avoid">
                <Link
                  to={entry.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-3 py-2 text-[13.5px] text-nx-ink transition-colors hover:bg-teal-100 hover:text-teal-700 focus-visible:bg-teal-100 focus-visible:text-teal-700 focus-visible:outline-none"
                >
                  {entry.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}

HubNavDropdown.propTypes = {
  item: PropTypes.shape({
    label: PropTypes.string.isRequired,
    href: PropTypes.string.isRequired,
    columns: PropTypes.number,
    menu: PropTypes.arrayOf(PropTypes.shape({ label: PropTypes.string, href: PropTypes.string })).isRequired,
  }).isRequired,
  active: PropTypes.bool,
  alignRight: PropTypes.bool,
}

/** Full Topics panel: every section, topic and High Court in one place. */
const TopicsPanel = ({ id, onClose }) => (
  <div
    id={id}
    className="absolute inset-x-0 top-full z-40 max-h-[calc(100dvh-8rem)] overflow-y-auto border-y border-teal-200 bg-teal-50 shadow-[0_24px_48px_-24px_rgba(13,60,55,0.3)]"
  >
    <div className="mx-auto grid max-w-6xl gap-8 px-5 py-6 sm:grid-cols-2 sm:px-8 lg:grid-cols-[1fr_1fr_2fr]">
      <div>
        <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-700/70">Sections</p>
        {HUB_NAV.filter((item) => !item.menu).map((item) => (
          <Link
            key={item.href}
            to={item.href}
            onClick={onClose}
            className="block rounded-md px-3 py-2 text-sm text-nx-ink transition-colors hover:bg-teal-100 hover:text-teal-700 focus-visible:outline-2 focus-visible:outline-teal-600"
          >
            {item.label}
          </Link>
        ))}
      </div>
      {HUB_NAV.filter((item) => !item.columns).map((item) =>
        item.menu ? (
          <div key={item.label}>
            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-700/70">
              {item.label}
            </p>
            {item.menu.map((entry) => (
              <Link
                key={entry.href + entry.label}
                to={entry.href}
                onClick={onClose}
                className="block rounded-md px-3 py-2 text-sm text-nx-ink transition-colors hover:bg-teal-100 hover:text-teal-700 focus-visible:outline-2 focus-visible:outline-teal-600"
              >
                {entry.label}
              </Link>
            ))}
          </div>
        ) : null
      )}
      {HUB_NAV.filter((item) => item.columns).map((item) => (
        <div key={item.label} className="sm:col-span-2 lg:col-span-1">
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-700/70">
            {item.label}
          </p>
          <div className="sm:columns-2">
            {item.menu.map((entry) => (
              <Link
                key={entry.href}
                to={entry.href}
                onClick={onClose}
                className="block break-inside-avoid rounded-md px-3 py-2 text-sm text-nx-ink transition-colors hover:bg-teal-100 hover:text-teal-700 focus-visible:outline-2 focus-visible:outline-teal-600"
              >
                {entry.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
)

TopicsPanel.propTypes = {
  id: PropTypes.string.isRequired,
  onClose: PropTypes.func.isRequired,
}

/**
 * Light-teal Content Hub bar under the site Navbar. Desktop shows every item with
 * dropdowns; below `lg` the items scroll sideways and the Topics panel
 * carries the full menu.
 */
const ContentHubNav = () => {
  const isActive = useIsActive()
  const [topicsOpen, setTopicsOpen] = useState(false)
  const barRef = useRef(null)

  useEffect(() => {
    if (!topicsOpen) return undefined
    const onDown = (e) => {
      if (barRef.current && !barRef.current.contains(e.target)) setTopicsOpen(false)
    }
    const onKey = (e) => {
      if (e.key === "Escape") setTopicsOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [topicsOpen])

  return (
    <div ref={barRef} className="sticky top-20 z-40 border-b border-teal-200 bg-teal-50 font-body text-nx-ink">
      <nav aria-label="Content Hub" className="mx-auto flex h-11 max-w-6xl items-center gap-2 px-3 sm:px-6">
        <button
          type="button"
          onClick={() => setTopicsOpen((o) => !o)}
          aria-expanded={topicsOpen}
          aria-controls="hub-topics-panel"
          className={`${LINK_BASE} inline-flex flex-none items-center gap-1.5 ${
            topicsOpen ? "text-teal-700" : "text-nx-ink hover:text-teal-700"
          }`}
        >
          <Icon name={topicsOpen ? "X" : "Menu"} className="h-4 w-4" />
          Topics
        </button>

        <ul className="hidden flex-1 items-center gap-0.5 lg:flex">
          {HUB_NAV.map((item, i) =>
            item.menu ? (
              <HubNavDropdown
                key={item.label}
                item={item}
                active={isActive(item.href)}
                alignRight={i === HUB_NAV.length - 1}
              />
            ) : (
              <li key={item.label}>
                <Link
                  to={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={`${LINK_BASE} block ${
                    isActive(item.href) ? "text-teal-700" : "text-nx-ink hover:text-teal-700"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            )
          )}
        </ul>

        <ul className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
          {HUB_NAV.map((item) => (
            <li key={item.label} className="flex-none">
              <Link
                to={item.href}
                onClick={() => setTopicsOpen(false)}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`${LINK_BASE} block ${
                  isActive(item.href) ? "text-teal-700" : "text-nx-ink hover:text-teal-700"
                }`}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {topicsOpen && <TopicsPanel id="hub-topics-panel" onClose={() => setTopicsOpen(false)} />}
    </div>
  )
}

export default ContentHubNav
