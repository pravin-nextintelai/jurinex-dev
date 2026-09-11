import { useCallback, useEffect, useRef, useState } from "react"
import PropTypes from "prop-types"
import { AnimatePresence, motion as Motion, useReducedMotion } from "framer-motion"
import { Icon, Reveal, SectionHeading } from "./primitives"
import { EASE } from "./motionTokens"

/* ------------------------------------------------------------------ */
/* JuriNex Community — interactive demo.                              */
/* Announce → Engage → Feedback → Improve, shown on a live phone      */
/* simulator. All numbers and messages are simulated demo data.       */
/* ------------------------------------------------------------------ */

const WA = {
  green: "#128C7E",
  dark: "#075E54",
  bg: "#ECE5DD",
  out: "#DCF8C6",
  pin: "#FFF4D6",
}

const STAGES = [
  { key: "channel", num: 1, title: "Channel announces", sub: "Broadcast · admins post" },
  { key: "community", num: 2, title: "Community gathers", sub: "Five focused groups" },
  { key: "group", num: 3, title: "Users vote & report", sub: "Polls, requests, replies" },
  { key: "landing", num: 4, title: "Site brings new members", sub: "Two buttons on jurinex.ai" },
  { key: "loop", num: 5, title: "Team ships, loop repeats", sub: "“You asked, we built”" },
]

const CHANNEL_POSTS = [
  {
    when: "Mon 9:00",
    base: 96,
    body: (
      <>
        <b>New:</b> Citation Research now finds Indian Kanoon authorities matched to
        your pleaded grounds.
        <br />
        Try it inside any case → Citation tab.
      </>
    ),
  },
  {
    when: "Wed 9:00",
    base: 41,
    body: (
      <>
        <b>Tip of the week</b>
        <br />
        Upload the scanned brief once — Auto Fill reads court, bench, parties and next
        hearing for you.
      </>
    ),
  },
  {
    when: "Fri 6:00",
    base: 73,
    body: (
      <>
        <b>Shipped this week</b>
        <br />• Cross Examination preset
        <br />• Marathi drafts in Conveyancing
        <br />• Faster OCR on 100+ page files
      </>
    ),
  },
  {
    when: "Sat 11:00",
    base: 12,
    body: (
      <>
        <b>Offer:</b> first 100 firms get the Teams plan at District Court price till 30
        Sept.
      </>
    ),
  },
]

const GROUPS = [
  { initial: "A", name: "Announcements", sub: "Same posts as the Channel", badge: "3" },
  { initial: "A", name: "Ask for a feature", sub: "Poll: Which feature next?", badge: "12" },
  { initial: "B", name: "Beta testers", sub: "New module preview — Thu", badge: "5" },
  { initial: "H", name: "Help & questions", sub: "Adv. Patil: How to add a party?", badge: "2" },
  { initial: "G", name: "General chat", sub: "Off-topic and networking", badge: "" },
]

const INITIAL_THREAD = [
  {
    who: "Adv. Sunil Goyal, Jalna",
    text: "Auto Fill missed the prayer clause in a 482 application yesterday. Can it read that too?",
    when: "10:14",
  },
  {
    who: "Pravin · Jurinex",
    text: "Thanks — logged as a quick win. Fix ships in the next release.",
    when: "10:31",
    out: true,
  },
  {
    who: "Jurinex team",
    text: "You asked, we built: Chronology now updates when you add papers.",
    when: "Fri",
    out: true,
  },
]

const EXPLAINERS = {
  channel: {
    heading: "WhatsApp Channel — Jurinex AI",
    intro:
      "One-way. Only NexIntel posts; followers read and react but cannot reply or see each other. This is the newsletter for people who never open email.",
    tags: ["Release notes", "Tips", "Offers", "Court-holiday reminders"],
    points: [
      "Two posts a week, fixed days. More and people mute.",
      "English first, one Marathi line below — partners and investors will follow it too.",
      "Owner: marketing writes, Santosh approves.",
    ],
    tryIt: (
      <>
        <b>Try it:</b> tap <b>Follow</b> in the app bar, then react to a post.
      </>
    ),
  },
  community: {
    heading: "WhatsApp Community — Jurinex Users",
    intro:
      "Two-way. Advocates talk to us and to each other. Splitting it into five groups keeps requests from drowning in “good morning” messages.",
    tags: [],
    points: [
      "Announcements — mirror of the channel, so members never miss a release.",
      "Ask for a feature — polls and requests. Our research pipe.",
      "Beta testers — 15–20 active advocates get modules a week early.",
      "Help & questions — answered within one working day.",
      "General chat — networking, so the other four stay on-topic.",
    ],
    tryIt: (
      <>
        <b>Try it:</b> open <b>Ask for a feature</b> to jump into the group.
      </>
    ),
  },
  group: {
    heading: "Inside “Ask for a feature”",
    intro:
      "This is where the loop earns its keep. A pinned rule keeps client papers out. A weekly poll decides what we build. Every request gets a tagged reply: bug / quick win / big feature / no.",
    tags: [],
    points: [
      "Rule 1, pinned: no case papers, no party names. Use Quick Chat or support.",
      "Pravin replies to product questions; support handles “how do I”.",
      "When a voted feature ships, we post “You asked, we built” with the original request.",
    ],
    tryIt: (
      <>
        <b>Try it:</b> vote in the poll, then type a request in the composer — watch the
        reply and the feedback log.
      </>
    ),
  },
  landing: {
    heading: "Landing page — “Join the NexIntel AI Community”",
    intro:
      "Two buttons on jurinex.ai, the Help page, and the welcome email. New sign-ups feed the loop from day one; no separate onboarding campaign needed.",
    tags: [],
    points: [
      "Join button opens the Community invite; Follow button opens the Channel.",
      "Below the buttons: what members get, in five plain lines.",
      "Stats strip shows real numbers once we have them — social proof for a cautious profession.",
    ],
    tryIt: (
      <>
        <b>Try it:</b> press either button — the member counters on the right move.
      </>
    ),
  },
  loop: {
    heading: "Why this becomes product improvement",
    intro:
      "Each stage produces something the next one consumes. The Channel makes news; the Community turns news into conversation; conversation turns into votes and requests; the team turns those into releases; releases become the next Channel post.",
    tags: [],
    points: [
      "Weekly: Pravin pulls votes and requests into one list and tags them.",
      "Two weeks: quick wins ship. Big features enter the roadmap with the vote count attached.",
      "Monthly: report followers, members, replies per post, requests received vs shipped.",
    ],
    tryIt: (
      <>
        <b>What you've done in this demo</b> is logged in the live numbers panel — that
        log is exactly what the weekly product review reads from.
      </>
    ),
  },
}

const fmt = (n) => n.toLocaleString("en-IN")

/* ---------------------------- phone parts -------------------------- */

const AppBar = ({ avatar, name, meta, bg = WA.dark, avatarColor = WA.dark, children }) => (
  <div className="flex items-center gap-2.5 px-3.5 pb-3 pt-8" style={{ background: bg }}>
    <span
      className="grid h-9 w-9 flex-none place-items-center rounded-full bg-white text-sm font-bold"
      style={{ color: avatarColor }}
    >
      {avatar}
    </span>
    <div className="min-w-0 flex-1">
      <p className="truncate text-[14px] font-semibold leading-tight text-white">{name}</p>
      <p className="truncate text-[11px] text-white/85">{meta}</p>
    </div>
    {children}
  </div>
)

AppBar.propTypes = {
  avatar: PropTypes.node,
  name: PropTypes.string,
  meta: PropTypes.node,
  bg: PropTypes.string,
  avatarColor: PropTypes.string,
  children: PropTypes.node,
}

const Bubble = ({ out, who, when, children }) => (
  <div
    className="relative mb-2 max-w-[92%] rounded-xl px-2.5 pb-4 pt-2 text-[12.5px] leading-snug shadow-[0_1px_0_rgba(0,0,0,0.06)]"
    style={{ background: out ? WA.out : "#fff", marginLeft: out ? "auto" : undefined }}
  >
    {who && <p className="mb-0.5 text-[11px] font-semibold text-nx-teal-ink">{who}</p>}
    {children}
    <span className="absolute bottom-1 right-2 text-[9px] text-slate-400">{when}</span>
  </div>
)

Bubble.propTypes = {
  out: PropTypes.bool,
  who: PropTypes.string,
  when: PropTypes.string,
  children: PropTypes.node,
}

/* ----------------------------- section ----------------------------- */

const CommunitySection = () => {
  const reduce = useReducedMotion()
  const [stage, setStage] = useState("channel")
  const [followed, setFollowed] = useState(false)
  const [joined, setJoined] = useState(false)
  const [followers, setFollowers] = useState(1240)
  const [members, setMembers] = useState(380)
  const [votes, setVotes] = useState(142)
  const [requests, setRequests] = useState(18)
  const [reacted, setReacted] = useState({})
  const [poll, setPoll] = useState([
    { t: "Hearing reminders on WhatsApp", v: 82 },
    { t: "Marathi voice notes to draft", v: 38 },
    { t: "Bulk upload from email", v: 22 },
  ])
  const [myVote, setMyVote] = useState(null)
  const [thread, setThread] = useState(INITIAL_THREAD)
  const [feed, setFeed] = useState([
    { when: "Mon", msg: <>Request: Auto Fill missed prayer clause (482) — <b>quick win</b></> },
    { when: "Tue", msg: <>Vote: Hearing reminders on WhatsApp leading, 58%</> },
    { when: "Thu", msg: <>Beta: 5 advocates testing Cross Examination preset</> },
  ])
  const [toast, setToast] = useState(null)
  const [draft, setDraft] = useState("")
  const toastTimer = useRef(null)
  const replyTimer = useRef(null)
  const bodyRef = useRef(null)

  useEffect(() => () => {
    clearTimeout(toastTimer.current)
    clearTimeout(replyTimer.current)
  }, [])

  const say = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1800)
  }, [])

  const log = useCallback((when, msg) => {
    setFeed((prev) => [{ when, msg }, ...prev])
  }, [])

  const toggleFollow = () => {
    const next = !followed
    setFollowed(next)
    setFollowers((f) => f + (next ? 1 : -1))
    say(next ? "Following Jurinex AI" : "Unfollowed")
    if (next) log("Now", "New channel follower (you)")
  }

  const toggleJoin = () => {
    const next = !joined
    setJoined(next)
    setMembers((m) => m + (next ? 1 : -1))
    say(next ? "Opening Community invite…" : "Left the Community")
    if (next) log("Now", "New member via landing page")
  }

  const castVote = (i) => {
    if (myVote === i) return
    setPoll((prev) =>
      prev.map((o, j) => ({
        ...o,
        v: o.v + (j === i ? 1 : 0) - (j === myVote ? 1 : 0),
      }))
    )
    if (myVote === null) setVotes((v) => v + 1)
    setMyVote(i)
    log("Now", `Vote: ${poll[i].t}`)
    say("Vote counted")
  }

  const sendRequest = () => {
    const value = draft.trim()
    if (!value) return
    const now = new Date()
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    setThread((prev) => [...prev, { who: "You", text: value, when: time }])
    setDraft("")
    setRequests((r) => r + 1)
    log("Now", <>Request: {value.slice(0, 60)} — <b>to triage</b></>)
    clearTimeout(replyTimer.current)
    replyTimer.current = setTimeout(() => {
      setThread((prev) => [
        ...prev,
        {
          who: "Pravin · Jurinex",
          text: "Got it — added to this week's list. We tag every request bug / quick win / big feature, and reply with the tag within a working day.",
          when: time,
          out: true,
        },
      ])
    }, 900)
  }

  // Keep the group chat scrolled to the newest message
  useEffect(() => {
    if (stage === "group" && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [thread, stage])

  const explainer = EXPLAINERS[stage]
  const pollTotal = poll.reduce((a, o) => a + o.v, 0)

  /* --------------------------- screens --------------------------- */

  const renderScreen = () => {
    switch (stage) {
      case "channel":
        return (
          <div className="flex h-full flex-col" style={{ background: WA.bg }}>
            <AppBar avatar="J" name="Jurinex AI" meta={<>Channel · {fmt(followers)} followers</>}>
              <button
                type="button"
                onClick={toggleFollow}
                className="rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors"
                style={{
                  background: followed ? "#e8f5f2" : "#fff",
                  color: WA.dark,
                }}
              >
                {followed ? "Following" : "Follow"}
              </button>
            </AppBar>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <p className="mb-2.5 text-center text-[10.5px] text-slate-500">
                <span className="rounded-md bg-white px-2 py-0.5">This week</span>
              </p>
              {CHANNEL_POSTS.map((post, i) => (
                <Bubble key={post.when} when={post.when}>
                  {post.body}
                  <div className="mt-1.5">
                    <button
                      type="button"
                      aria-pressed={!!reacted[i]}
                      onClick={() => setReacted((r) => ({ ...r, [i]: !r[i] }))}
                      className="rounded-full border px-2 py-px text-[11.5px] transition-colors"
                      style={{
                        borderColor: reacted[i] ? WA.green : "#e2e8f0",
                        background: reacted[i] ? "#e8f5f2" : "#fff",
                      }}
                    >
                      👍 {post.base + (reacted[i] ? 1 : 0)}
                    </button>
                  </div>
                </Bubble>
              ))}
            </div>
            <div className="bg-[#f0f0f0] px-3 py-3 text-center text-[11px] text-slate-500">
              Only admins can post · followers can react
            </div>
          </div>
        )

      case "community":
        return (
          <div className="flex h-full flex-col bg-white">
            <AppBar avatar="J" name="Jurinex Users" meta={<>Community · {fmt(members)} members</>} />
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <p className="mb-2.5 text-[13px] font-semibold text-nx-ink">Groups you're in</p>
              {GROUPS.map((group, i) => (
                <button
                  key={group.name}
                  type="button"
                  onClick={() => {
                    if (i === 1) setStage("group")
                    else say(`${group.name} — demo shows the feature group only`)
                  }}
                  className="mb-2 flex w-full items-center gap-3 rounded-xl border border-nx-line bg-nx-pale p-3 text-left transition-colors hover:border-slate-300"
                >
                  <span
                    className="grid h-9 w-9 flex-none place-items-center rounded-full text-sm font-bold text-white"
                    style={{ background: WA.green }}
                  >
                    {group.initial}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-nx-ink">
                      {group.name}
                    </span>
                    <span className="block truncate text-[11.5px] text-slate-500">{group.sub}</span>
                  </span>
                  {group.badge && (
                    <span
                      className="grid h-5 min-w-5 flex-none place-items-center rounded-full px-1.5 text-[10.5px] font-bold text-white"
                      style={{ background: WA.green }}
                    >
                      {group.badge}
                    </span>
                  )}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setMembers((m) => m + 1)
                  log("Now", "Member invited an advocate")
                  say("Invite link copied")
                }}
                className="mt-1 w-full rounded-lg py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: WA.green }}
              >
                + Invite an advocate
              </button>
              <p
                className="mt-3 rounded-lg px-2.5 py-2 text-[11.5px]"
                style={{ background: WA.pin, color: "#6B4F0E" }}
              >
                Pinned: Rules · No client papers in any group
              </p>
            </div>
          </div>
        )

      case "group":
        return (
          <div className="flex h-full flex-col" style={{ background: WA.bg }}>
            <AppBar avatar="A" name="Ask for a feature" meta="Jurinex Users · 214 members" />
            <div ref={bodyRef} className="flex-1 overflow-y-auto px-3 py-3">
              <p
                className="mb-2.5 rounded-lg px-2.5 py-2 text-[11.5px]"
                style={{ background: WA.pin, color: "#6B4F0E" }}
              >
                Pinned: No case papers or party names here. Use Quick Chat or support.
              </p>

              {/* Poll */}
              <div className="mb-2.5 rounded-xl px-3 pb-2 pt-2.5" style={{ background: WA.out }}>
                <p className="text-[9.5px] font-bold tracking-wider" style={{ color: WA.dark }}>
                  POLL · JURINEX TEAM
                </p>
                <p className="mb-2 mt-1 text-[13px] font-semibold text-nx-ink">
                  Which feature should we build next?
                </p>
                {poll.map((option, i) => {
                  const pct = Math.round((option.v / pollTotal) * 100)
                  const mine = myVote === i
                  return (
                    <button
                      key={option.t}
                      type="button"
                      aria-pressed={mine}
                      onClick={() => castVote(i)}
                      className="block w-full pb-2 pt-1 text-left"
                    >
                      <span className="flex items-center justify-between text-[12.5px] text-nx-ink">
                        <span>
                          {mine && (
                            <span className="font-bold" style={{ color: WA.green }}>
                              ✓{" "}
                            </span>
                          )}
                          {option.t}
                        </span>
                        <span
                          className="text-[11.5px] font-bold tabular-nums"
                          style={{ color: WA.dark }}
                        >
                          {pct}%
                        </span>
                      </span>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[#c6dcc9]">
                        <span
                          className="block h-full rounded-full transition-[width] duration-500"
                          style={{ width: `${pct}%`, background: WA.green }}
                        />
                      </span>
                    </button>
                  )
                })}
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {fmt(pollTotal)} votes · ends Friday
                </p>
              </div>

              {thread.map((m, i) => (
                <Bubble key={`${m.who}-${i}`} out={m.out} who={m.who} when={m.when}>
                  {m.text}
                </Bubble>
              ))}
            </div>
            <div className="flex items-center gap-2 bg-[#f0f0f0] px-3 py-2.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendRequest()
                }}
                placeholder="Ask for a feature…"
                aria-label="Ask for a feature"
                className="min-w-0 flex-1 rounded-full border border-nx-line bg-white px-3.5 py-2 text-[12.5px] outline-none focus-visible:border-slate-400"
              />
              <button
                type="button"
                onClick={sendRequest}
                aria-label="Send"
                className="grid h-9 w-9 flex-none place-items-center rounded-full text-white transition-opacity hover:opacity-90"
                style={{ background: WA.green }}
              >
                <Icon name="SendHorizontal" className="h-4 w-4" />
              </button>
            </div>
          </div>
        )

      case "landing":
        return (
          <div className="flex h-full flex-col bg-white">
            <AppBar avatar="J" name="jurinex.ai" meta="Landing page section" bg="#08a393" avatarColor="#08a393" />
            <div className="flex-1 overflow-y-auto px-4 py-3.5">
              <p className="mb-3.5 rounded-md border border-nx-line bg-nx-pale px-2.5 py-1.5 text-[10.5px] text-slate-400">
                jurinex.ai/#/community
              </p>
              <h4 className="font-display text-[22px] font-semibold leading-tight text-nx-ink">
                Join the NexIntel AI Community
              </h4>
              <p className="mb-3.5 mt-1.5 text-[12.5px] text-slate-500">
                Vote on features, test new modules first, and talk to the team and other
                advocates.
              </p>
              <button
                type="button"
                aria-pressed={joined}
                onClick={toggleJoin}
                className="mb-2 w-full rounded-lg border-2 py-3 text-[13.5px] font-semibold transition-colors"
                style={
                  joined
                    ? { background: "#e8f5f2", color: WA.dark, borderColor: "#bfe0d9" }
                    : { background: WA.green, color: "#fff", borderColor: WA.green }
                }
              >
                {joined ? "✓ Joined the Community" : "Join our WhatsApp Community"}
              </button>
              <button
                type="button"
                aria-pressed={followed}
                onClick={toggleFollow}
                className="w-full rounded-lg border-2 py-3 text-[13.5px] font-semibold transition-colors"
                style={
                  followed
                    ? { background: "#e8f5f2", color: WA.dark, borderColor: "#bfe0d9" }
                    : { background: "#fff", color: WA.green, borderColor: WA.green }
                }
              >
                {followed ? "✓ Following the Channel" : "Follow our WhatsApp Channel"}
              </button>
              <ul className="mt-3.5 space-y-0.5">
                {[
                  "Vote for the next feature",
                  "Request new features",
                  "Early access to beta modules",
                  "Help from the team within a day",
                  "Release notes and offers first",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2 py-1 text-[12.5px] text-nx-ink">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-nx-teal" />
                    {line}
                  </li>
                ))}
              </ul>
              <p className="mt-4 rounded-xl bg-nx-pale px-3 py-2.5 text-[11.5px] text-slate-500">
                {fmt(followers)} followers · {fmt(members)} members · 18 features shipped from
                votes
              </p>
            </div>
          </div>
        )

      case "loop": {
        const steps = [
          ["Channel announced", "4 posts this week", true],
          ["You followed the channel", "+1 follower", followed],
          ["You joined the community", "+1 member", joined],
          ["You voted in the poll", "counted toward the roadmap", myVote !== null],
          ["You sent a request", "tagged for weekly triage", requests > 18],
          ["Team ships → next announcement", "“You asked, we built”", true],
        ]
        return (
          <div className="flex h-full flex-col bg-white">
            <AppBar
              avatar="J"
              name="The loop, one cycle"
              meta="What happened in this demo"
              bg="#0d9488"
              avatarColor="#0d9488"
            />
            <div className="flex-1 overflow-y-auto px-4 py-2">
              {steps.map(([title, sub, done], i) => (
                <div
                  key={title}
                  className="flex gap-3 border-b border-nx-line py-3 last:border-b-0"
                >
                  <span
                    className={`grid h-7 w-7 flex-none place-items-center rounded-lg text-[11.5px] font-bold ${
                      done
                        ? "bg-nx-teal text-white"
                        : "border border-nx-line bg-nx-pale text-slate-400"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span>
                    <span
                      className={`block text-[13px] font-semibold ${
                        done ? "text-nx-ink" : "text-slate-400"
                      }`}
                    >
                      {title}
                    </span>
                    <span className="block text-[11.5px] text-slate-500">{sub}</span>
                  </span>
                </div>
              ))}
              <p className="mb-3 mt-4 rounded-xl bg-nx-pale px-3 py-2.5 text-[11.5px] leading-relaxed text-slate-500">
                Weekly review reads the feedback log. Quick wins ship in two weeks; big
                features enter the roadmap with their vote count.
              </p>
            </div>
          </div>
        )
      }

      default:
        return null
    }
  }

  /* --------------------------- layout ---------------------------- */

  return (
    <section
      id="resources"
      className="scroll-mt-20 bg-white py-20 sm:py-28"
      aria-labelledby="community-heading"
    >
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeading
          id="community-heading"
          eyebrow="Community · Interactive Demo"
          title="Announce → Engage → Feedback → Improve"
          lede="Click each stage of the loop to see the screen an advocate will actually use. The screens are live: follow the channel, vote in the poll, send a message — the counters update as you go. All numbers here are simulated."
        />

        {/* Stage selector */}
        <Reveal className="mt-12" y={16}>
          <nav
            className="grid grid-cols-1 overflow-hidden rounded-2xl border border-nx-ink/75 bg-nx-pale sm:grid-cols-2 lg:grid-cols-5"
            aria-label="Community loop stages"
          >
            {STAGES.map((s) => {
              const current = stage === s.key
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-current={current}
                  onClick={() => setStage(s.key)}
                  className={`relative flex items-start gap-3 border-b border-nx-line px-4 py-4 text-left transition-colors last:border-b-0 sm:border-r lg:border-b-0 ${
                    current ? "bg-white" : "hover:bg-white/60"
                  }`}
                >
                  <span
                    className={`grid h-7 w-7 flex-none place-items-center rounded-lg text-xs font-bold transition-colors ${
                      current
                        ? "bg-nx-teal text-white"
                        : "border border-nx-line bg-white text-nx-teal"
                    }`}
                  >
                    {s.num}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-nx-ink">{s.title}</span>
                    <span className="block text-xs text-nx-muted">{s.sub}</span>
                  </span>
                  {current && (
                    <span
                      className="absolute inset-x-0 bottom-0 h-0.5 bg-nx-teal"
                      aria-hidden="true"
                    />
                  )}
                </button>
              )
            })}
          </nav>
        </Reveal>

        <div className="mt-10 grid grid-cols-1 items-start gap-10 lg:grid-cols-[1.1fr_auto_1fr] lg:gap-9">
          {/* Explainer */}
          <AnimatePresence mode="wait">
            <Motion.div
              key={stage}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="mx-auto w-full max-w-xl lg:mx-0"
            >
              <h3 className="font-display text-2xl font-semibold text-nx-ink">
                {explainer.heading}
              </h3>
              <p className="mt-2.5 leading-relaxed text-nx-muted">{explainer.intro}</p>
              {explainer.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {explainer.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-nx-teal/8 px-2.5 py-1 text-xs font-semibold text-nx-teal"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <ul className="mt-4">
                {explainer.points.map((point) => (
                  <li
                    key={point}
                    className="flex gap-2.5 border-t border-nx-line py-2.5 text-sm leading-relaxed text-nx-ink"
                  >
                    <span className="mt-[7px] h-2 w-2 flex-none rounded-sm bg-nx-teal" />
                    {point}
                  </li>
                ))}
              </ul>
              <p className="mt-4 rounded-xl border border-dashed border-nx-teal/60 bg-white px-4 py-3 text-sm leading-relaxed text-nx-muted [&>b]:text-nx-teal">
                {explainer.tryIt}
              </p>
            </Motion.div>
          </AnimatePresence>

          {/* Phone */}
          <div
            className="relative mx-auto w-full max-w-[350px] rounded-[38px] bg-slate-900 p-2.5 shadow-[0_30px_60px_-30px_rgba(2,8,23,0.55)]"
            role="region"
            aria-label="Phone preview"
          >
            <span
              className="absolute left-1/2 top-2.5 z-10 h-5 w-24 -translate-x-1/2 rounded-b-xl bg-slate-900"
              aria-hidden="true"
            />
            <div className="h-[640px] overflow-hidden rounded-[30px]">{renderScreen()}</div>
          </div>

          {/* Live numbers */}
          <aside className="mx-auto w-full max-w-xl rounded-2xl border border-nx-ink/75 bg-nx-pale p-5 lg:mx-0">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-nx-muted">
              Live numbers
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {[
                [followers, "Channel followers"],
                [members, "Community members"],
                [votes, "Poll votes this week"],
                [requests, "Requests logged"],
              ].map(([value, label]) => (
                <div key={label} className="rounded-xl border border-nx-line bg-white p-3">
                  <p className="font-display text-2xl font-semibold leading-none text-nx-ink tabular-nums">
                    {fmt(value)}
                  </p>
                  <p className="mt-1 text-xs text-nx-muted">{label}</p>
                </div>
              ))}
            </div>
            <h3 className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-nx-muted">
              Feedback log → product review
            </h3>
            <div className="mt-2.5 max-h-52 min-h-28 overflow-y-auto rounded-xl border border-nx-line bg-white px-3 py-1.5 text-[13px]">
              {feed.map((entry, i) => (
                <p
                  key={`${entry.when}-${i}`}
                  className="border-b border-nx-line py-1.5 leading-snug text-nx-muted last:border-b-0"
                >
                  <span className="mr-2 text-nx-faint tabular-nums">{entry.when}</span>
                  {entry.msg}
                </p>
              ))}
            </div>
          </aside>
        </div>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <Motion.p
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.22 }}
            className="fixed bottom-7 left-1/2 z-50 -translate-x-1/2 rounded-full bg-nx-ink px-4.5 py-2.5 text-sm text-white shadow-lg"
            role="status"
          >
            {toast}
          </Motion.p>
        )}
      </AnimatePresence>
    </section>
  )
}

export default CommunitySection
