import { useEffect, useState } from "react"

const DEFAULT_THRESHOLD = 48

/**
 * Tracks vertical scroll for UI that should change after the user scrolls (e.g. navbar glass state).
 *
 * @param {object} [options]
 * @param {number} [options.thresholdPx] — scrollY past this value sets `scrolled` to true
 * @returns {{ scrolled: boolean, scrollY: number }}
 */
export const useLandingScrollAnimation = (options = {}) => {
  const thresholdPx = options.thresholdPx ?? DEFAULT_THRESHOLD
  const [scrollY, setScrollY] = useState(0)

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return {
    scrolled: scrollY > thresholdPx,
    scrollY,
  }
}

export const useScrollAnimation = useLandingScrollAnimation
