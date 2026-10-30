"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";
import { Icon } from "@/components/site/Icon";
import { FEATURE_IMAGES, NAV_LINKS, toReactHref, type NavChild, type NavLink } from "@/components/site/constants";

/**
 * Port of frontend/src/features/landing/components/Navbar.jsx so the Bare Acts
 * pages look identical to the rest of the site: same brand, mega menus,
 * Login / Start Free Trial, mobile drawer and the "Schedule a demo" tab.
 *
 * Differences by necessity:
 *  - Every link is a real <a href> that leaves for the React app (a different
 *    app on the same domain); only "Bare Acts" stays inside Next.js.
 *  - The bar is always in its solid state. The React Navbar is transparent
 *    only over the landing hero, which these pages never show.
 *  - Framer-motion transitions are replaced by CSS keyframes (globals.css).
 */

const BARE_ACTS_HREF = "/acts";
const isBareActs = (href: string) => href === BARE_ACTS_HREF || href.startsWith(`${BARE_ACTS_HREF}/`);

function twoColumns<T>(links: T[]): T[][] {
  const half = Math.ceil(links.length / 2);
  return [links.slice(0, half), links.slice(half)];
}

/** Anchor that goes to the React app, or a Next <Link> for Bare Acts. */
function NavAnchor({
  href,
  className,
  children,
  onClick,
  role,
  tabIndex,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  role?: string;
  tabIndex?: number;
}) {
  if (isBareActs(href)) {
    return (
      <Link href={href.slice(BARE_ACTS_HREF.length) || "/"} className={className} onClick={onClick} role={role} tabIndex={tabIndex}>
        {children}
      </Link>
    );
  }
  return (
    <a href={toReactHref(href)} className={className} onClick={onClick} role={role} tabIndex={tabIndex}>
      {children}
    </a>
  );
}

const MenuEntry = ({ entry, onGo }: { entry: NavChild; onGo: () => void }) => (
  <NavAnchor
    role="menuitem"
    href={entry.href}
    onClick={onGo}
    className="group flex w-full items-start gap-3.5 rounded-xl px-3 py-3 text-left transition-colors hover:bg-teal-50/80 focus-visible:outline-2 focus-visible:outline-nx-teal"
  >
    {entry.icon && (
      <span className="mt-0.5 inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-teal-50 text-nx-teal ring-1 ring-teal-100 transition-colors group-hover:bg-nx-teal group-hover:text-white group-hover:ring-nx-teal">
        <Icon name={entry.icon} className="h-4.5 w-4.5" strokeWidth={1.8} />
      </span>
    )}
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-1.5 text-sm font-semibold text-nx-ink group-hover:text-teal-700">
        {entry.label}
        <Icon
          name="ArrowRight"
          className="h-3.5 w-3.5 -translate-x-1 text-nx-teal opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
        />
      </span>
      {entry.desc && <span className="mt-1 block max-w-xs text-[13px] leading-snug text-nx-muted">{entry.desc}</span>}
    </span>
  </NavAnchor>
);

const CompactMenu = ({ link, onGo }: { link: NavLink; onGo: () => void }) => (
  <div className="nx-menu-enter absolute right-0 top-full z-50 w-[22rem] pt-2" role="menu" aria-label={`${link.label} menu`}>
    <div className="overflow-hidden rounded-2xl border border-teal-100 bg-white p-2 shadow-[0_24px_48px_-24px_rgba(13,60,55,0.28)]">
      {(link.children ?? []).map((entry) => (
        <MenuEntry key={entry.label} entry={entry} onGo={onGo} />
      ))}
    </div>
  </div>
);

const MegaMenu = ({ link, onGo }: { link: NavLink; onGo: () => void }) => {
  const columns = link.sections
    ? link.sections.map((s) => ({ heading: s.heading, links: s.links }))
    : twoColumns(link.children ?? []).map((links) => ({ heading: undefined, links }));
  const feature = link.feature;

  return (
    <div
      className="nx-menu-enter hidden overflow-hidden rounded-b-[2rem] border-t border-teal-100 bg-white shadow-[0_24px_48px_-24px_rgba(13,60,55,0.28)] xl:block"
      role="menu"
      aria-label={`${link.label} menu`}
    >
      <div className={`mx-auto grid max-w-7xl gap-10 px-5 py-9 sm:px-8 ${feature ? "lg:grid-cols-[1fr_1fr_minmax(0,22rem)]" : "lg:grid-cols-2"}`}>
        {columns.map((col, i) => (
          <div key={col.heading ?? i}>
            {col.heading && <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-nx-faint">{col.heading}</p>}
            <div className="space-y-0.5">
              {col.links.map((entry) => (
                <MenuEntry key={entry.label} entry={entry} onGo={onGo} />
              ))}
            </div>
          </div>
        ))}

        {feature && (
          <NavAnchor role="menuitem" href={feature.href} onClick={onGo} className="group text-left lg:border-l lg:border-nx-line lg:pl-10">
            <span className="relative block overflow-hidden rounded-2xl border border-nx-line shadow-[0_16px_36px_-20px_rgba(6,52,44,0.35)]">
              {/* Plain <img>: the menu is hidden until opened and next/image would add layout logic for nothing. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${BARE_ACTS_HREF}${FEATURE_IMAGES[feature.image]}`}
                alt=""
                className="aspect-[16/10] w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                loading="lazy"
              />
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-nx-forest/70 via-nx-forest/10 to-transparent" aria-hidden="true" />
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
              <Icon name="ArrowRight" className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </span>
          </NavAnchor>
        )}
      </div>
    </div>
  );
};

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false); // mobile drawer
  const [openDropdown, setOpenDropdown] = useState<string | null>(null); // desktop mega menu label
  const headerRef = useRef<HTMLElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openMenu = (label: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpenDropdown(label);
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenDropdown(null), 120);
  };
  const closeAll = () => {
    setOpenDropdown(null);
    setMenuOpen(false);
  };

  // Close the mobile menu when resizing up to desktop (Tailwind `xl`)
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1280) setMenuOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Lock body scroll while the drawer is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  // Close menus on outside click / Escape
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) setOpenDropdown(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menuPanelRef.current?.contains(document.activeElement)) {
        headerRef.current?.querySelector<HTMLElement>('nav [aria-expanded="true"]')?.focus();
      }
      setOpenDropdown(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const openLink = NAV_LINKS.find((l) => l.label === openDropdown);

  return (
    <>
      <header
        ref={headerRef}
        onMouseLeave={scheduleClose}
        className={`fixed inset-x-0 top-0 z-50 border border-t-0 border-teal-200 bg-white/95 font-body shadow-[0_1px_12px_rgba(8,163,147,0.12)] backdrop-blur transition-[border-radius] duration-300 ${
          menuOpen ? "rounded-none" : "rounded-b-[2rem]"
        }`}
      >
        <nav className="mx-auto flex h-20 w-full max-w-7xl items-center gap-6 px-5 sm:px-8" aria-label="Primary">
          {/* Brand */}
          <a href="/" className="flex shrink-0 items-center transition-opacity hover:opacity-85" aria-label="Jurinex.ai home">
            <BrandLogo />
          </a>

          {/* Desktop links, left-aligned next to the brand */}
          <ul className="mx-auto hidden h-full items-center gap-0.5 pl-2 xl:flex 2xl:gap-4 2xl:pl-4">
            {NAV_LINKS.map((link) => {
              const hasMenu = Boolean(link.sections?.length || link.children?.length);
              const isActive = isBareActs(link.href);
              const isOpen = openDropdown === link.label;

              return (
                <li
                  key={link.label}
                  className="relative flex h-full items-center"
                  onMouseEnter={() => (hasMenu ? openMenu(link.label) : scheduleClose())}
                >
                  <NavAnchor
                    href={link.href}
                    onClick={hasMenu ? () => setOpenDropdown(isOpen ? null : link.label) : closeAll}
                    className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-2 text-[15px] font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-nx-teal 2xl:px-3 ${
                      isActive || isOpen ? "text-teal-700" : "text-nx-ink hover:text-teal-700"
                    }`}
                  >
                    {link.lines ? (
                      <span className="flex flex-col items-start text-[13px] leading-[1.15]">
                        {link.lines.map((line) => (
                          <span key={line}>{line}</span>
                        ))}
                      </span>
                    ) : (
                      link.label
                    )}
                    {hasMenu && (
                      <Icon name="ChevronDown" className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                    )}
                  </NavAnchor>
                  {hasMenu && (
                    <button
                      type="button"
                      className="sr-only"
                      aria-expanded={isOpen}
                      aria-haspopup="menu"
                      onClick={() => setOpenDropdown(isOpen ? null : link.label)}
                      onKeyDown={(e) => {
                        if (e.key !== "ArrowDown") return;
                        e.preventDefault();
                        openMenu(link.label);
                        requestAnimationFrame(() => menuPanelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
                      }}
                    >
                      Open {link.label} menu
                    </button>
                  )}
                  {/* Underline for the open menu */}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-3.5 bottom-0 h-0.5 rounded-full bg-teal-700 transition-opacity ${isOpen ? "opacity-100" : "opacity-0"}`}
                  />
                  {isOpen && link.menu === "compact" && <CompactMenu link={link} onGo={closeAll} />}
                </li>
              );
            })}
          </ul>

          {/* Desktop actions */}
          <div className="ml-auto hidden items-center gap-3 xl:flex">
            <a
              href="/login"
              aria-label="Log in to your account"
              className="whitespace-nowrap rounded-lg border border-nx-ink/30 px-5 py-2 text-sm font-semibold text-black transition-colors hover:border-teal-600 hover:text-teal-700"
            >
              Login
            </a>
            <a
              href="/register"
              aria-label="Start your free trial"
              className="whitespace-nowrap rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-teal-500/25 transition-all duration-200 hover:bg-teal-700 active:scale-[0.98]"
            >
              Start Free Trial
            </a>
          </div>

          {/* Mobile hamburger */}
          <button
            type="button"
            className="ml-auto flex h-10 w-10 items-center justify-center rounded-lg text-black transition-colors hover:bg-teal-200/60 xl:hidden"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            <span className="relative flex h-4 w-5 flex-col justify-between" aria-hidden="true">
              <span className={`block h-0.5 w-full rounded-full bg-current transition-transform duration-200 ${menuOpen ? "translate-y-[7px] rotate-45" : ""}`} />
              <span className={`block h-0.5 w-full rounded-full bg-current transition-all duration-150 ${menuOpen ? "scale-x-0 opacity-0" : ""}`} />
              <span className={`block h-0.5 w-full rounded-full bg-current transition-transform duration-200 ${menuOpen ? "-translate-y-[7px] -rotate-45" : ""}`} />
            </span>
          </button>
        </nav>

        {/* Desktop mega menu */}
        {openLink && openLink.menu !== "compact" && (
          <div ref={menuPanelRef} onMouseEnter={() => openMenu(openLink.label)}>
            <MegaMenu link={openLink} onGo={closeAll} />
          </div>
        )}

        {/* Mobile drawer */}
        {menuOpen && (
          <div className="nx-drawer-enter max-h-[calc(100dvh-5rem)] overflow-y-auto border-t border-nx-line bg-white xl:hidden">
            <div className="flex flex-col gap-0.5 px-5 py-4">
              {NAV_LINKS.map((link, i) => (
                <div key={link.label} className="nx-drawer-item" style={{ animationDelay: `${i * 40}ms` }}>
                  <NavAnchor
                    href={link.href}
                    onClick={closeAll}
                    className={`block w-full rounded-lg px-4 py-3 text-left text-sm font-semibold transition-colors ${
                      isBareActs(link.href) ? "bg-teal-500/10 text-teal-700" : "text-black hover:bg-teal-200/60 hover:text-teal-700"
                    }`}
                  >
                    {link.label}
                  </NavAnchor>
                  {link.children && (
                    <div className="mb-1 ml-4 border-l border-teal-200 pl-2">
                      {link.children.map((child) => (
                        <NavAnchor
                          key={child.label}
                          href={child.href}
                          onClick={closeAll}
                          className="block w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-teal-200/60 hover:text-teal-700"
                        >
                          {child.label}
                        </NavAnchor>
                      ))}
                    </div>
                  )}
                  {link.sections && (
                    <div className="mb-1 ml-4 border-l border-teal-200 pl-2">
                      {link.sections.map((section) => (
                        <div key={section.heading}>
                          <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-nx-faint">{section.heading}</p>
                          {section.links.map((child) => (
                            <NavAnchor
                              key={child.label}
                              href={child.href}
                              onClick={closeAll}
                              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-teal-200/60 hover:text-teal-700"
                            >
                              {child.label}
                            </NavAnchor>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              <div className="mt-3 flex flex-col gap-2.5 border-t border-teal-200 pt-4">
                <a href="/login" className="w-full rounded-lg border border-nx-ink/30 py-2.5 text-center text-sm font-medium text-black transition-colors hover:bg-white">
                  Login
                </a>
                <a
                  href="/register"
                  className="w-full rounded-lg bg-teal-600 py-2.5 text-center text-sm font-semibold text-white shadow-md shadow-teal-500/25 transition-transform hover:bg-teal-700 active:scale-[0.99]"
                >
                  Start Free Trial
                </a>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Right-edge "Schedule a demo" tab, as on every public page of the React app */}
      <a
        href="/contact"
        className="fixed right-0 top-1/3 z-40 flex items-center justify-center rounded-l-lg border border-r-0 border-white/20 bg-gradient-to-b from-nx-teal to-nx-teal-ink px-1.5 py-5 text-sm font-semibold tracking-wide text-white shadow-[-4px_4px_18px_rgba(8,163,147,0.25)] transition-colors hover:from-nx-teal-deep hover:to-nx-teal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nx-teal"
        aria-label="Schedule a demo"
      >
        <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>Schedule a demo</span>
      </a>
    </>
  );
}
