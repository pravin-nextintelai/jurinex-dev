import { useEffect, useState } from "react"
import PropTypes from "prop-types"
import { motion as Motion, useReducedMotion } from "framer-motion"
import { AUTH_SERVICE_URL } from "../../config/apiConfig"

function safeLink(value) {
  if (!value) return null
  try {
    const url = new URL(value, window.location.origin)
    return ["http:", "https:"].includes(url.protocol) ? url.href : null
  } catch { return null }
}

function dateLabel(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return ""
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short",
    year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value)) + " IST"
}

const PromotionBanner = ({ onVisibilityChange }) => {
  const [promos, setPromos] = useState([])
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [details, setDetails] = useState(false)
  const [now, setNow] = useState(Date.now())
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    let disposed = false
    let controller
    const refresh = async () => {
      controller?.abort()
      controller = new AbortController()
      try {
        const response = await fetch(`${AUTH_SERVICE_URL.replace(/\/$/, "")}/api/auth/marketing-promos/header`, {
          credentials: "omit", signal: controller.signal, cache: "no-store",
        })
        const data = await response.json()
        if (!response.ok || data.success !== true || !Array.isArray(data.promos)) throw new Error("Invalid promotion response")
        if (!disposed) setPromos(data.promos)
      } catch (error) {
        if (!disposed && error.name !== "AbortError") setPromos([])
      }
    }
    refresh()
    const refreshTimer = setInterval(refresh, 60000)
    const expiryTimer = setInterval(() => setNow(Date.now()), 1000)
    return () => { disposed = true; controller?.abort(); clearInterval(refreshTimer); clearInterval(expiryTimer) }
  }, [])

  const active = promos.filter((promo) => (!promo.starts_at || new Date(promo.starts_at).getTime() <= now)
    && (!promo.ends_at || new Date(promo.ends_at).getTime() > now))
  const count = active.length
  const promo = active[index % (count || 1)]
  useEffect(() => { onVisibilityChange?.(count > 0) }, [count, onVisibilityChange])
  useEffect(() => {
    if (count < 2 || paused || details || reduceMotion) return
    const timer = setInterval(() => setIndex((value) => (value + 1) % count), 8000)
    return () => clearInterval(timer)
  }, [count, paused, details, reduceMotion])

  if (!promo) return null
  const href = safeLink(promo.cta_url)
  const secondsLeft = promo.ends_at
    ? Math.max(0, Math.ceil((new Date(promo.ends_at).getTime() - now) / 1000))
    : null
  const countdown = secondsLeft !== null && Number.isFinite(secondsLeft) ? [
    [Math.floor(secondsLeft / 86400), "d"],
    [Math.floor(secondsLeft / 3600) % 24, "h"],
    [Math.floor(secondsLeft / 60) % 60, "m"],
    [secondsLeft % 60, "s"],
  ] : null
  const color = (value, fallback) => value && CSS.supports("color", value) ? value : fallback
  const step = (direction) => { setIndex((value) => (value + direction + count) % count); setDetails(false) }
  return (
    <div className="relative text-xs" style={{ backgroundColor: color(promo.background_color, "#06857b"), color: color(promo.text_color, "#ffffff") }}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false) }}
      onKeyDown={(event) => { if (event.key === "Escape") setDetails(false) }}>
      <div className="relative isolate flex h-[72px] items-center justify-center gap-2 overflow-hidden px-2 pb-9 sm:h-10 sm:gap-4 sm:px-6 sm:pb-0" aria-label="Offers and events">
        {!reduceMotion && <Motion.span aria-hidden="true" className="pointer-events-none absolute inset-y-0 -z-10 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent"
          animate={{ left: ["-35%", "110%"] }} transition={{ duration: 4.5, repeat: Infinity, repeatDelay: 3 }} />}
        <span className="hidden shrink-0 rounded-full border border-current/20 bg-white/15 px-2.5 py-1 text-[10px] font-bold uppercase sm:inline-flex">{promo.badge || promo.kind}</span>
        <button type="button" onClick={() => setDetails((value) => !value)} aria-expanded={details} aria-controls="header-promo-details"
          className="min-w-0 truncate text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-current">
          <strong>{promo.title}</strong><span className="hidden lg:inline">{promo.subtitle ? ` · ${promo.subtitle}` : ""}{promo.kind === "event" && promo.location ? ` · ${promo.location}` : ""}</span>
        </button>
        {countdown && (
          <div role="timer" aria-live="off" aria-label={`Ends in ${countdown.map(([value, unit]) => `${value}${unit}`).join(" ")}`}
            title={`Ends ${dateLabel(promo.ends_at)}`}
            className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap sm:static sm:translate-x-0 sm:shrink-0">
            <span className="mr-1 flex items-center gap-2 text-[11px] font-bold">
              <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                {!reduceMotion && <Motion.span
                  className="absolute inset-0 rounded-full bg-current"
                  animate={{ scale: [1, 2.4], opacity: [0.7, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                />}
                <span className="relative h-2.5 w-2.5 rounded-full bg-current shadow-[0_0_10px_currentColor]" />
              </span>
              Ends in
            </span>
            {countdown.map(([value, unit]) => (
              <span key={unit} className="flex min-w-8 flex-col items-center rounded border border-white/60 bg-white px-1 py-0.5 text-nx-teal-ink shadow-sm">
                <span className="font-mono text-sm font-bold leading-4 tabular-nums">{String(value).padStart(2, "0")}</span>
                <span className="text-[7px] font-bold uppercase leading-[9px] tracking-wide">{{ d: "Days", h: "Hours", m: "Mins", s: "Secs" }[unit]}</span>
              </span>
            ))}
          </div>
        )}
        {href && <a href={href} className="shrink-0 rounded-full border border-current/30 bg-white/10 px-2.5 py-1 font-semibold hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current">{promo.cta_label || (promo.kind === "event" ? "Explore event" : "View offer")} <span aria-hidden="true">→</span></a>}
        {count > 1 && <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => step(-1)} aria-label="Previous promotion" className="h-8 w-6 rounded hover:bg-white/20">‹</button>
          <span className="text-[10px]">{index % count + 1}/{count}</span>
          <button type="button" onClick={() => step(1)} aria-label="Next promotion" className="h-8 w-6 rounded hover:bg-white/20">›</button>
        </div>}
      </div>
      {details && <div id="header-promo-details" className="absolute inset-x-2 top-full z-50 mx-auto max-h-[60dvh] max-w-xl overflow-y-auto rounded-b-xl border border-nx-line bg-white p-5 text-nx-ink shadow-xl sm:inset-x-6">
        <div className="flex items-start justify-between gap-4"><h2 className="text-base font-semibold">{promo.title}</h2><button type="button" onClick={() => setDetails(false)} aria-label="Close promotion details" className="p-1">✕</button></div>
        {promo.subtitle && <p className="mt-2 leading-relaxed">{promo.subtitle}</p>}
        {promo.kind === "event" && promo.location && <p className="mt-2">Location: {promo.location}</p>}
        {promo.ends_at && <p className="mt-2">Ends: {dateLabel(promo.ends_at)}</p>}
        {promo.kind === "event" && promo.slots?.length > 0 && <ul className="mt-3 space-y-2">
          {promo.slots.map((slot) => <li key={slot.id} className="rounded-lg bg-nx-pale p-3">
            <p>{dateLabel(slot.starts_at)}{slot.ends_at ? ` – ${dateLabel(slot.ends_at)}` : ""}</p>
            <p className="mt-1 text-nx-muted">{slot.ends_at && new Date(slot.ends_at).getTime() <= now ? "Ended" : slot.seat_capacity == null ? "Contact the team for availability" : `${Math.max(0, Number(slot.seat_capacity) - Number(slot.seats_booked || 0))} seats remaining`}</p>
          </li>)}
        </ul>}
        {href && <a href={href} className="mt-4 inline-block rounded-lg bg-nx-teal px-4 py-2 font-semibold text-white hover:bg-nx-teal-deep">{promo.cta_label || "Learn more"} →</a>}
      </div>}
    </div>
  )
}
PromotionBanner.propTypes = { onVisibilityChange: PropTypes.func }
export default PromotionBanner
