import { useEffect } from "react"

/**
 * Timed "Book a demo" prompts for first-time visitors.
 *
 * The visitor's arrival is stamped once per browser session, so the
 * clock keeps running as they move between public pages. The modal is
 * opened at each delay in PROMPT_DELAYS_MS, measured from arrival, and
 * each prompt fires at most once per session. Nothing fires once the
 * visitor has submitted the form.
 *
 * @param {(open: boolean) => void} setOpen  setter for the modal's open state
 * @param {boolean} [enabled=true]           pass false to opt a page out
 */
export const PROMPT_DELAYS_MS = [2 * 60 * 1000, 5 * 60 * 1000]
/** Minimum gap between two prompts when both are already due. */
const MIN_GAP_MS = 30 * 1000

const ARRIVED_KEY = "jx-demo-arrived"
const SHOWN_KEY = "jx-demo-shown"
const DONE_KEY = "jx-demo-done"

const read = (key) => {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key, value) => {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    /* private mode or storage disabled: prompts simply won't persist across pages */
  }
}

/** Call after a successful submission so no further prompts appear this session. */
export const markDemoDone = () => write(DONE_KEY, "1")

export const useDemoPrompt = (setOpen, enabled = true) => {
  useEffect(() => {
    if (!enabled || read(DONE_KEY)) return undefined

    let arrived = Number(read(ARRIVED_KEY))
    if (!arrived) {
      arrived = Date.now()
      write(ARRIVED_KEY, String(arrived))
    }
    const shown = new Set((read(SHOWN_KEY) || "").split(",").filter(Boolean))
    const elapsed = Date.now() - arrived

    // Prompts that are already overdue fire now, but staggered so a
    // visitor never sees two open on top of each other.
    let overdue = 0
    const timers = PROMPT_DELAYS_MS.map((delay, i) => {
      const id = String(i)
      if (shown.has(id)) return null
      let wait = delay - elapsed
      if (wait <= 0) wait = overdue++ * MIN_GAP_MS
      return setTimeout(() => {
        if (read(DONE_KEY)) return
        shown.add(id)
        write(SHOWN_KEY, [...shown].join(","))
        setOpen(true)
      }, wait)
    })

    return () => timers.forEach((t) => t && clearTimeout(t))
  }, [setOpen, enabled])
}
