import { useState, useRef, useEffect, useCallback } from "react"
import { motion as Motion, AnimatePresence } from "framer-motion"
import gavelIcon from "../../assets/jurinex-mark.png"

const AI_CHATBOT_DIRECT_URL = (
  import.meta.env.VITE_APP_AI_CHATBOT_URL || "http://localhost:8095"
).replace(/\/$/, "")

const AI_CHATBOT_DIRECT_WS_URL = AI_CHATBOT_DIRECT_URL.replace(/^http/, "ws")
const CHATBOT_DEBUG = false
const INITIAL_PLAYBACK_LEAD_SEC = 0.30
const RECOVERY_PLAYBACK_LEAD_SEC = 0.18

const chatbotLog = (...args) => {
  if (CHATBOT_DEBUG) console.log("[JuriNexChatbot]", ...args)
}
const chatbotError = (...args) => {
  console.error("[JuriNexChatbot]", ...args)
}

// ── motion variants ──────────────────────────────────────────────────────────

const panelVariants = {
  hidden: { opacity: 0, y: 40, scale: 0.92, filter: "blur(4px)" },
  visible: {
    opacity: 1, y: 0, scale: 1, filter: "blur(0px)",
    transition: { type: "spring", stiffness: 340, damping: 28, mass: 0.85 },
  },
  exit: {
    opacity: 0, y: 24, scale: 0.93, filter: "blur(2px)",
    transition: { duration: 0.22, ease: [0.4, 0, 1, 1] },
  },
}

const msgVariants = {
  hidden: { opacity: 0, y: 10, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
}

const fabVariants = {
  rest:  { scale: 1 },
  hover: { scale: 1.08 },
  tap:   { scale: 0.91 },
}

// ── Voice waveform bars (shown while mic is live) ────────────────────────────

const VoiceWave = () => (
  <div className="flex items-center gap-[3px] h-4">
    {[0.4, 0.7, 1, 0.8, 0.5, 0.9, 0.6].map((h, i) => (
      <Motion.span
        key={i}
        className="w-[3px] rounded-full"
        style={{ background: "rgba(255,255,255,0.85)" }}
        animate={{ scaleY: [h * 0.5, h, h * 0.6, h * 0.9, h * 0.5] }}
        transition={{ duration: 0.9 + i * 0.08, repeat: Infinity, ease: "easeInOut", delay: i * 0.07 }}
        initial={{ scaleY: h * 0.5, height: "16px", originY: "50%" }}
      />
    ))}
  </div>
)

// ── Bot avatar ───────────────────────────────────────────────────────────────

const BotAvatar = () => (
  <div
    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mr-2.5 mt-0.5"
    style={{
      background: "linear-gradient(135deg, #0f766e 0%, #0d9488 100%)",
      boxShadow: "0 2px 8px rgba(13,148,136,0.35)",
    }}
  >
    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="16" y1="2" x2="16" y2="6" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
      <circle cx="16" cy="2" r="1.5" fill="white"/>
      <rect x="5" y="6" width="22" height="16" rx="4" fill="white"/>
      <rect x="2" y="11" width="3" height="6" rx="1.5" fill="white"/>
      <rect x="27" y="11" width="3" height="6" rx="1.5" fill="white"/>
      <circle cx="11.5" cy="13" r="2.5" fill="#0d9488"/>
      <circle cx="11.5" cy="13" r="1" fill="white"/>
      <circle cx="20.5" cy="13" r="2.5" fill="#0d9488"/>
      <circle cx="20.5" cy="13" r="1" fill="white"/>
      <path d="M11 19.5 Q16 22.5 21 19.5" stroke="#0d9488" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
    </svg>
  </div>
)

// ── Typing indicator ─────────────────────────────────────────────────────────

const TypingIndicator = () => (
  <div className="flex justify-start items-end">
    <BotAvatar />
    <div
      className="px-4 py-3 rounded-2xl rounded-tl-sm flex gap-1.5 items-center"
      style={{ background: "#fff", border: "1px solid #e2e8f0", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
    >
      {[0, 1, 2].map(i => (
        <Motion.span
          key={i}
          className="w-2 h-2 rounded-full"
          style={{ background: "#14b8a6" }}
          animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.75, repeat: Infinity, delay: i * 0.16, ease: "easeInOut" }}
        />
      ))}
    </div>
  </div>
)

// ── Lead capture inline form ─────────────────────────────────────────────────

const LeadCaptureForm = ({ apiBase, onSaved }) => {
  const [form, setForm]         = useState({ name: "", email: "", phone: "" })
  const [emailErr, setEmailErr] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]       = useState("")

  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

  const set = (k) => (e) => {
    setForm(prev => ({ ...prev, [k]: e.target.value }))
    if (k === "email") setEmailErr("")
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) return
    if (!validEmail(form.email)) { setEmailErr("That email doesn't look right."); return }
    setSubmitting(true); setError("")
    try {
      const res = await fetch(`${apiBase}/api/save-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || "Failed")
      onSaved(form.name.trim())
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle = {
    width: "100%", padding: "8px 10px", borderRadius: "8px", fontSize: "12.5px",
    border: "1.5px solid #e2e8f0", background: "#f8fafc", color: "#1a202c",
    outline: "none", fontFamily: "inherit",
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <p style={{ fontSize: "11px", color: "#64748b", margin: 0, fontWeight: 600 }}>
        One form. We won&apos;t ask again.
      </p>
      <input
        style={inputStyle} placeholder="Your name" value={form.name}
        onChange={set("name")}
        onFocus={e => { e.target.style.borderColor = "#0d9488"; e.target.style.boxShadow = "0 0 0 2px rgba(13,148,136,0.12)" }}
        onBlur={e => { e.target.style.borderColor = "#e2e8f0"; e.target.style.boxShadow = "none" }}
      />
      <div>
        <input
          style={{ ...inputStyle, borderColor: emailErr ? "#e53e3e" : "#e2e8f0" }}
          placeholder="Email address" type="email" value={form.email}
          onChange={set("email")}
          onFocus={e => { e.target.style.borderColor = emailErr ? "#e53e3e" : "#0d9488"; e.target.style.boxShadow = "0 0 0 2px rgba(13,148,136,0.12)" }}
          onBlur={e => { e.target.style.borderColor = emailErr ? "#e53e3e" : "#e2e8f0"; e.target.style.boxShadow = "none" }}
        />
        {emailErr && <p style={{ fontSize: "11px", color: "#e53e3e", margin: "3px 0 0", fontWeight: 500 }}>{emailErr}</p>}
      </div>
      <input
        style={inputStyle} placeholder="Mobile number (optional)" type="tel" value={form.phone}
        onChange={set("phone")}
        onFocus={e => { e.target.style.borderColor = "#0d9488"; e.target.style.boxShadow = "0 0 0 2px rgba(13,148,136,0.12)" }}
        onBlur={e => { e.target.style.borderColor = "#e2e8f0"; e.target.style.boxShadow = "none" }}
      />
      {error && <p style={{ fontSize: "11px", color: "#e53e3e", margin: 0 }}>{error}</p>}
      <button
        onClick={handleSubmit}
        disabled={submitting || !form.name.trim() || !form.email.trim()}
        style={{
          padding: "9px", borderRadius: "8px", fontWeight: 700, fontSize: "12.5px",
          background: submitting || !form.name.trim() || !form.email.trim()
            ? "#cbd5e0" : "linear-gradient(135deg,#dc2626,#b91c1c)",
          color: "#fff", border: "none", cursor: submitting ? "wait" : "pointer",
          letterSpacing: "0.01em", transition: "background 0.2s",
        }}
      >
        {submitting ? "Saving…" : "Request callback"}
      </button>
    </div>
  )
}

// ── Suggestions quick chips ───────────────────────────────────────────────────

const SUGGESTIONS = [
  "What does JuriNex offer?",
  "How does Case Summarizer work?",
  "Is there a free trial?",
]

// ── Main widget ───────────────────────────────────────────────────────────────

const ChatbotWidget = () => {
  const [open, setOpen]               = useState(false)
  const [leadSaved, setLeadSaved]     = useState(false)
  const [leadFormShown, setLeadFormShown] = useState(false)
  const [messages, setMessages]       = useState([
    {
      role: "assistant",
      text: "Hi — I'm the JuriNex assistant. Ask me about plans, features, drafting, or Indian legal workflows.",
    },
  ])
  const [input, setInput]             = useState("")
  const [textLoading, setTextLoading] = useState(false)
  const [sessionId, setSessionId]     = useState(null)
  const [micStatus, setMicStatus]     = useState("idle")
  const [showSuggestions, setShowSuggestions] = useState(true)

  // Demo booking state
  const [demoSlots, setDemoSlots]         = useState([])
  const [showSlotModal, setShowSlotModal] = useState(false)
  const [selectedSlot, setSelectedSlot]   = useState(null)
  const [bookingForm, setBookingForm]     = useState({ name: "", email: "", phone: "", company: "" })
  const [bookingStep, setBookingStep]     = useState("slots") // slots | form | confirming | done | error
  const [bookingMsg, setBookingMsg]       = useState("")
  const [bookingLoading, setBookingLoading] = useState(false)

  const wsRef                  = useRef(null)
  const audioCtxRef            = useRef(null)
  const playCtxRef             = useRef(null)
  const nextPlayTimeRef        = useRef(0)
  const sourceRef              = useRef(null)
  const processorRef           = useRef(null)
  const streamRef              = useRef(null)
  const voiceTurnFinishedRef   = useRef(false)
  const awaitingFinalResponseRef = useRef(false)
  const voiceHadSuccessfulTurnRef = useRef(false)
  const stopTimeoutRef         = useRef(null)
  const voiceReplyBufferRef    = useRef("")
  const voiceInputBufferRef    = useRef("")
  const userClosedDemoRef      = useRef(false)
  const bottomRef              = useRef(null)
  const inputRef               = useRef(null)
  const pendingQuestionRef     = useRef(null)  // first question, answered after lead form is submitted

  useEffect(() => {
    chatbotLog("mounted", {
      textUrl: `${AI_CHATBOT_DIRECT_URL}/api/chat`,
      wsUrl:   `${AI_CHATBOT_DIRECT_WS_URL}/ws/audio`,
    })
    return () => chatbotLog("unmounted")
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, textLoading, micStatus])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120)
  }, [open])

  // ── lead form ───────────────────────────────────────────────────────────────

  const isConvertIntent = (text) =>
    /(contact|reach out|call me|demo|sales|connect|speak to|talk to|team|callback|get in touch)/i.test(text)

  const isLeadTopic = (text) =>
    /(trial|free|price|pricing|cost|plan|feature|offer|discount|subscription)/i.test(text)

  const showLeadForm = () => {
    if (leadSaved) {
      setMessages(prev => [...prev, { role: "assistant", text: "You're all set — our team already has your details and will be in touch shortly." }])
      return
    }
    if (leadFormShown) return
    setLeadFormShown(true)
    setMessages(prev => [
      // Remove any nudge messages
      ...prev.filter(m => !m.nudge),
      {
        role: "assistant",
        text: "Happy to connect you with the team. Drop your details below — one quick form and that's the last I'll ask.",
        leadCard: true,
      },
    ])
  }

  const handleLeadSaved = (name) => {
    setLeadSaved(true)
    setLeadFormShown(true)
    const pending = pendingQuestionRef.current
    pendingQuestionRef.current = null
    setMessages(prev => [
      ...prev,
      {
        role: "assistant",
        text: pending
          ? `Thanks, ${name.split(" ")[0]}! Here's the answer to your question:`
          : `Thanks, ${name.split(" ")[0]} — you're all set. Ask me anything!`,
      },
    ])
    // Now answer the question the user originally asked (only once we have their details)
    if (pending) sendText(pending, { skipEcho: true })
  }

  // ── text ────────────────────────────────────────────────────────────────────

  const sendText = async (overrideText, opts = {}) => {
    const text = (typeof overrideText === "string" ? overrideText : input).trim()
    if (!text || textLoading || micStatus === "live") return
    setInput("")
    setShowSuggestions(false)

    // First-time gate: greet and collect name/email/mobile once, before answering
    // the very first question. The question is stored and answered after the form
    // is submitted. `leadFormShown` flips to true here so the gate never fires again.
    if (!leadSaved && !leadFormShown) {
      setLeadFormShown(true)
      pendingQuestionRef.current = text
      setMessages(prev => [
        ...prev,
        { role: "user", text },
        {
          role: "assistant",
          text: "Hello, and welcome to JuriNex! 👋 I'd be glad to help with that. First, could you share a few quick details below? I'll only ask this once — then I'll answer your question right away.",
          leadForm: true,
        },
      ])
      return
    }

    if (!opts.skipEcho) {
      setMessages(prev => [...prev, { role: "user", text }])
    }
    setTextLoading(true)
    try {
      chatbotLog("text request", { url: `${AI_CHATBOT_DIRECT_URL}/api/chat`, text, sessionId })
      const res = await fetch(`${AI_CHATBOT_DIRECT_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionId }),
      })
      chatbotLog("text response status", { status: res.status, ok: res.ok })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const data = await res.json()
      chatbotLog("text response body", data)
      setSessionId(data.session_id)

      // Detect slot_selection response (plain JSON or embedded in text)
      let slotPayload = null
      const rawAnswer = data.answer || ""
      try {
        const parsed = JSON.parse(rawAnswer)
        if (parsed?.type === "slot_selection" && Array.isArray(parsed.slots)) slotPayload = parsed
      } catch {}
      if (!slotPayload) {
        const m = rawAnswer.match(/\{[\s\S]*?"type"\s*:\s*"slot_selection"[\s\S]*?\}/)
        if (m) { try { const p = JSON.parse(m[0]); if (p?.type === "slot_selection") slotPayload = p } catch {} }
      }

      if (slotPayload) {
        setDemoSlots(slotPayload.slots || [])
        if (!userClosedDemoRef.current) setShowSlotModal(true)
        setBookingStep("slots")
        setSelectedSlot(null)
        setMessages(prev => [...prev, { role: "assistant", text: slotPayload.message || "Please select a demo slot:" }])
      } else {
        setMessages(prev => [...prev, { role: "assistant", text: rawAnswer }])
      }
    } catch (err) {
      chatbotError("text request failed", err)
      setMessages(prev => [...prev, {
        role: "assistant",
        text: "I'm having trouble connecting right now. Please try again in a moment.",
        error: true,
      }])
    } finally {
      setTextLoading(false)
    }
  }

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText() }
  }

  // ── audio helpers (mirrors AppAssistant pattern exactly) ────────────────────

  const cleanupAudio = useCallback(() => {
    sourceRef.current?.disconnect()
    processorRef.current?.disconnect()
    audioCtxRef.current?.close().catch(() => {})
    streamRef.current?.getTracks().forEach(t => t.stop())
    audioCtxRef.current = null; sourceRef.current = null
    processorRef.current = null; streamRef.current = null
    nextPlayTimeRef.current = 0
  }, [])

  const stopAudio = useCallback(() => {
    voiceTurnFinishedRef.current = true
    awaitingFinalResponseRef.current = true
    try { wsRef.current?.send(JSON.stringify({ type: "end" })) } catch {}
    cleanupAudio()
    setMicStatus("connecting")
    clearTimeout(stopTimeoutRef.current)
    stopTimeoutRef.current = setTimeout(() => {
      try { wsRef.current?.close() } catch {}
      wsRef.current = null
      awaitingFinalResponseRef.current = false
      setMicStatus("idle")
    }, 45000)
  }, [cleanupAudio])

  const forceCloseAudio = useCallback(() => {
    clearTimeout(stopTimeoutRef.current)
    voiceTurnFinishedRef.current = true
    awaitingFinalResponseRef.current = false
    try { wsRef.current?.send(JSON.stringify({ type: "end" })) } catch {}
    try { wsRef.current?.close() } catch {}
    wsRef.current = null
    cleanupAudio()
    playCtxRef.current?.close().catch(() => {})
    playCtxRef.current = null
    nextPlayTimeRef.current = 0
    setMicStatus("idle")
  }, [cleanupAudio])

  useEffect(() => {
    if (micStatus === "live" || micStatus === "idle" || micStatus === "error") {
      setBookingLoading(false)
    }
  }, [micStatus])

  const getPlayCtx = useCallback(() => {
    if (!playCtxRef.current || playCtxRef.current.state === "closed") {
      playCtxRef.current = new AudioContext({ sampleRate: 24000 })
      nextPlayTimeRef.current = 0
    }
    if (playCtxRef.current.state === "suspended") {
      playCtxRef.current.resume().catch(() => {})
    }
    return playCtxRef.current
  }, [])

  const resample = useCallback((input, from, to) => {
    if (!input?.length || from === to) return input
    const ratio = from / to
    const out = new Float32Array(Math.max(1, Math.round(input.length / ratio)))
    for (let i = 0; i < out.length; i++) {
      const idx = Math.floor(i * ratio)
      const frac = i * ratio - idx
      out[i] = (input[idx] ?? 0) + ((input[Math.min(idx + 1, input.length - 1)] ?? input[idx] ?? 0) - (input[idx] ?? 0)) * frac
    }
    return out
  }, [])

  const pcm16ToBase64 = useCallback((samples) => {
    const bytes = new Uint8Array(samples.buffer)
    let bin = ""
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(bin)
  }, [])

  const scheduleAudio = useCallback((b64, mime) => {
    try {
      const sr = mime?.includes("24000") ? 24000 : 16000
      const raw = atob(b64)
      const int16 = new Int16Array(raw.length / 2)
      for (let i = 0; i < int16.length; i++)
        int16[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8)
      let f32 = new Float32Array(int16.length)
      for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768
      const ctx = getPlayCtx()
      if (ctx.sampleRate !== sr) f32 = resample(f32, sr, ctx.sampleRate)
      const buf = ctx.createBuffer(1, f32.length, ctx.sampleRate)
      buf.copyToChannel(f32, 0)
      const src = ctx.createBufferSource()
      src.buffer = buf; src.connect(ctx.destination)
      const now = ctx.currentTime
      if (!nextPlayTimeRef.current) nextPlayTimeRef.current = now + INITIAL_PLAYBACK_LEAD_SEC
      else if (nextPlayTimeRef.current < now + RECOVERY_PLAYBACK_LEAD_SEC) nextPlayTimeRef.current = now + RECOVERY_PLAYBACK_LEAD_SEC
      src.start(nextPlayTimeRef.current)
      nextPlayTimeRef.current += buf.duration
    } catch (err) {
      chatbotError("scheduleAudio error:", err)
    }
  }, [getPlayCtx, resample])

  useEffect(() => () => {
    clearTimeout(stopTimeoutRef.current)
    forceCloseAudio()
    playCtxRef.current?.close()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const startAudio = useCallback(async (bookingMode = false) => {
    chatbotLog("audio start requested", { bookingMode })
    if (wsRef.current) {
      try { wsRef.current.close() } catch {}
      wsRef.current = null
    }
    clearTimeout(stopTimeoutRef.current)
    // Always allow the slot popup to appear in a new audio session
    userClosedDemoRef.current = false
    setMicStatus("connecting")
    voiceTurnFinishedRef.current = false
    voiceHadSuccessfulTurnRef.current = false
    voiceReplyBufferRef.current = ""
    voiceInputBufferRef.current = ""
    setShowSuggestions(false)
    if (playCtxRef.current && playCtxRef.current.state !== "closed") {
      playCtxRef.current.close().catch(() => {})
      playCtxRef.current = null
      nextPlayTimeRef.current = 0
    }
    // Create playback AudioContext synchronously within user-gesture before any await
    getPlayCtx()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })
      chatbotLog("microphone stream granted", stream.getAudioTracks().map(t => ({ label: t.label, state: t.readyState })))
      streamRef.current = stream
      const ctx = new AudioContext()
      if (ctx.state === "suspended") await ctx.resume()
      chatbotLog("recording audio context", { sampleRate: ctx.sampleRate, state: ctx.state })
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      sourceRef.current = source
      const processor = ctx.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor
      const silent = ctx.createGain(); silent.gain.value = 0

      const wsUrl = bookingMode
        ? `${AI_CHATBOT_DIRECT_WS_URL}/ws/audio?mode=booking`
        : `${AI_CHATBOT_DIRECT_WS_URL}/ws/audio`
      chatbotLog("opening voice websocket", wsUrl)
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        chatbotLog("voice websocket open", { bookingMode })
        setMicStatus("live")
        setMessages(prev => [
          ...prev.filter(m => m.role !== "system"),
          {
            role: "system",
            text: bookingMode ? "Agent is connecting — please wait…" : "Listening — speak naturally",
          },
        ])
        // Stream mic audio — Gemini Live VAD handles turn detection automatically
        processor.onaudioprocess = (e) => {
          if (voiceTurnFinishedRef.current || ws.readyState !== WebSocket.OPEN) return
          const raw = e.inputBuffer.getChannelData(0)
          const ratio = ctx.sampleRate / 16000
          const out = new Float32Array(Math.max(1, Math.round(raw.length / ratio)))
          for (let i = 0; i < out.length; i++) {
            const start = Math.floor(i * ratio)
            const end = Math.min(Math.floor((i + 1) * ratio), raw.length)
            let sum = 0
            for (let j = start; j < end; j++) sum += raw[j]
            out[i] = sum / Math.max(end - start, 1)
          }
          const int16 = new Int16Array(out.length)
          for (let i = 0; i < out.length; i++) int16[i] = Math.max(-32768, Math.min(32767, out[i] * 32768))
          ws.send(JSON.stringify({ type: "audio", data: pcm16ToBase64(int16) }))
        }
        source.connect(processor); processor.connect(silent); silent.connect(ctx.destination)
      }

      ws.onmessage = (ev) => {
        if (wsRef.current !== ws) return
        try {
          const msg = JSON.parse(ev.data)
          chatbotLog("voice websocket message", msg.type === "audio" ? { ...msg, data: `<base64 ${msg.data?.length || 0} chars>` } : msg)
          if (msg.type === "audio" && msg.data) scheduleAudio(msg.data, msg.mime_type)
          if (msg.type === "slot_selection" && Array.isArray(msg.slots)) {
            setDemoSlots(msg.slots)
            if (!userClosedDemoRef.current) setShowSlotModal(true)
            setBookingStep("slots")
            setSelectedSlot(null)
          }
          if (msg.type === "booking_confirmed") {
            setBookingStep("done")
            setBookingMsg(msg.message || "Demo booked successfully!")
            setShowSlotModal(true)
            setTimeout(closeDemoModal, 4000)
          }
          if (msg.type === "text" && msg.content) {
            const chunk = String(msg.content || "").trim()
            if (chunk) {
              const current = voiceReplyBufferRef.current
              if (chunk.startsWith(current)) {
                voiceReplyBufferRef.current = chunk
              } else if (!current.endsWith(chunk)) {
                voiceReplyBufferRef.current = `${current} ${chunk}`.trim().replace(/\s+/g, " ")
              }
              const fullText = voiceReplyBufferRef.current
              setMessages(prev => {
                const cleaned = prev.filter(m => m.role !== "system")
                const last = cleaned[cleaned.length - 1]
                if (last?.role === "assistant" && last.voiceStreaming)
                  return [...cleaned.slice(0, -1), { ...last, text: fullText }]
                return [...cleaned, { role: "assistant", text: fullText, voiceStreaming: true }]
              })
            }
          }
          if (msg.type === "input_transcript" && msg.content) {
            chatbotLog("voice input transcript", msg.content)
            const chunk = String(msg.content || "").trim()
            if (chunk) {
              const cur = voiceInputBufferRef.current
              if (chunk.startsWith(cur)) {
                voiceInputBufferRef.current = chunk
              } else if (!cur.endsWith(chunk)) {
                voiceInputBufferRef.current = `${cur} ${chunk}`.trim().replace(/\s+/g, " ")
              }
              const fullTranscript = voiceInputBufferRef.current
              setMessages(prev => {
                const withoutSystem = prev.filter(m => m.role !== "system")
                const last = withoutSystem[withoutSystem.length - 1]
                if (last?.role === "user" && last.voiceInput) {
                  return [...withoutSystem.slice(0, -1), { ...last, text: fullTranscript }]
                }
                return [...withoutSystem, { role: "user", text: fullTranscript, voiceInput: true }]
              })
            }
          }
          if (msg.type === "turn_complete") {
            if (awaitingFinalResponseRef.current) {
              nextPlayTimeRef.current = 0
              clearTimeout(stopTimeoutRef.current)
              awaitingFinalResponseRef.current = false
              chatbotLog("voice turn complete after stop: closing websocket")
              try { wsRef.current?.close() } catch {}
              wsRef.current = null
              setMicStatus("idle")
              setMessages(prev => prev
                .filter(m => m.role !== "system")
                .map(m => {
                  if (m.voiceStreaming) return { role: m.role, text: m.text, error: m.error }
                  if (m.voiceInput) return { role: m.role, text: m.text }
                  return m
                })
              )
            } else if (!voiceTurnFinishedRef.current) {
              voiceInputBufferRef.current = ""
              voiceReplyBufferRef.current = ""
              voiceHadSuccessfulTurnRef.current = true
              setMicStatus("live")
              setMessages(prev => [
                ...prev.filter(m => m.role !== "system").map(m => m.voiceInput ? { role: m.role, text: m.text } : m),
                { role: "system", text: "Listening — ask another question" },
              ])
            }
          }
          if (msg.type === "error") {
            if (voiceHadSuccessfulTurnRef.current) {
              // Session ended after successful exchange (e.g. post-booking teardown) — close silently
              forceCloseAudio()
              return
            }
            const errText = msg.message || "Voice service error. Please try again."
            setMessages(prev => {
              const cleaned = prev.filter(m => m.role !== "system")
              const last = cleaned[cleaned.length - 1]
              if (last?.role === "assistant" && last.error && last.text === errText) return cleaned
              return [...cleaned, { role: "assistant", text: errText, error: true }]
            })
            forceCloseAudio()
          }
        } catch {
          chatbotError("Ignoring malformed voice service message.", ev.data)
        }
      }

      ws.onerror = (event) => {
        chatbotError("voice websocket error", event)
        if (voiceHadSuccessfulTurnRef.current) {
          forceCloseAudio()
          return
        }
        const errText = "Voice connection lost. Please check that the AI service is running and try again."
        setMessages(prev => {
          const cleaned = prev.filter(m => m.role !== "system")
          const last = cleaned[cleaned.length - 1]
          if (last?.role === "assistant" && last.error && last.text === errText) return cleaned
          return [...cleaned, { role: "assistant", text: errText, error: true }]
        })
        forceCloseAudio()
      }

      ws.onclose = () => {
        chatbotLog("voice websocket close")
        clearTimeout(stopTimeoutRef.current)
        awaitingFinalResponseRef.current = false
        setMessages(prev => prev.filter(m => m.role !== "system"))
        setMicStatus("idle")
      }
    } catch (err) {
      voiceTurnFinishedRef.current = true
      chatbotError("audio start failed", err)
      setMessages(prev => [...prev, {
        role: "assistant",
        text: err?.message || "Microphone access denied. Please allow permissions and try again.",
        error: true,
      }])
      setMicStatus("error")
      setTimeout(() => setMicStatus("idle"), 2000)
    }
  }, [stopAudio, forceCloseAudio, scheduleAudio, pcm16ToBase64, getPlayCtx])

  const toggleMic = () => {
    if (micStatus === "connecting") return  // prevent double-session while previous is still tearing down
    if (micStatus === "live") stopAudio()
    else startAudio()
  }

  // ── demo booking ─────────────────────────────────────────────────────────────

  const closeDemoModal = () => {
    userClosedDemoRef.current = true
    setShowSlotModal(false)
    setBookingStep("slots")
    setSelectedSlot(null)
    setBookingForm({ name: "", email: "", phone: "", company: "" })
    setBookingMsg("")
  }

  const handleBookDemoClick = async () => {
    userClosedDemoRef.current = false
    setBookingLoading(true)
    try {
      const res = await fetch(`${AI_CHATBOT_DIRECT_URL}/api/demo-slots`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const slots = await res.json()
      if (slots.length > 0) {
        setDemoSlots(slots)
        setShowSlotModal(true)
        setBookingStep("slots")
        setSelectedSlot(null)
        setMessages(prev => [...prev, {
          role: "assistant",
          text: "Great! Here are the available demo slots. Select a time that works for you and I'll confirm your booking.",
        }])
      } else {
        setMessages(prev => [...prev, {
          role: "assistant",
          text: "I'm sorry, no demo slots are available right now. Please check back tomorrow or email us at demo@jurinex.com.",
        }])
      }
    } catch (err) {
      chatbotError("demo slots fetch failed", err)
      setMessages(prev => [...prev, {
        role: "assistant",
        text: "I couldn't load available slots right now. Please try again in a moment.",
        error: true,
      }])
    } finally {
      setBookingLoading(false)
    }
  }

  const handleBookDemo = async () => {
    if (!selectedSlot || !bookingForm.name.trim() || !bookingForm.email.trim() || !bookingForm.phone.trim()) return
    setBookingStep("confirming")
    try {
      const res = await fetch(`${AI_CHATBOT_DIRECT_URL}/api/book-demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: bookingForm.name.trim(),
          email: bookingForm.email.trim(),
          phone: bookingForm.phone.trim(),
          company: bookingForm.company.trim() || undefined,
          slot_id: selectedSlot.id,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setBookingStep("done")
        setBookingMsg(data.message || "Demo booked successfully!")
        setMessages(prev => [...prev, {
          role: "assistant",
          text: `Demo booked! ${data.message}`,
        }])
        setTimeout(closeDemoModal, 4000)
      } else {
        setBookingStep("error")
        setBookingMsg(data.error || "Booking failed. Please try again.")
      }
    } catch {
      setBookingStep("error")
      setBookingMsg("Network error. Please try again.")
    }
  }

  // ── render ───────────────────────────────────────────────────────────────────

  const isLive  = micStatus === "live"
  const isBusy  = textLoading
  const canSend = input.trim().length > 0 && !isBusy

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">

      {/* ── Chat panel ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <Motion.div
            key="panel"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="flex flex-col rounded-3xl overflow-hidden"
            style={{
              width: "390px",
              height: "600px",
              background: "#ffffff",
              boxShadow: "0 32px 80px rgba(0,0,0,0.18), 0 8px 24px rgba(13,148,136,0.14), 0 0 0 1px rgba(13,148,136,0.12)",
            }}
          >

            {/* ── Header ───────────────────────────────────────────────────── */}
            <div
              className="relative flex-shrink-0 overflow-hidden"
              style={{ background: "linear-gradient(150deg, #0f172a 0%, #134e4a 55%, #0d9488 100%)" }}
            >
              {/* Decorative pattern */}
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.07]"
                style={{
                  backgroundImage: "radial-gradient(circle, #fff 1.5px, transparent 1.5px)",
                  backgroundSize: "22px 22px",
                }}
              />
              {/* Glow orb */}
              <div
                className="pointer-events-none absolute -top-6 -right-6 w-32 h-32 rounded-full"
                style={{ background: "radial-gradient(circle, rgba(20,184,166,0.25) 0%, transparent 70%)" }}
              />

              {/* Top row */}
              <div className="relative z-10 flex items-center justify-between px-4 pt-4 pb-3">
                <div className="flex items-center gap-3">
                  {/* Logo badge */}
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                    style={{
                      background: "linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.06) 100%)",
                      border: "1px solid rgba(255,255,255,0.22)",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.15)",
                    }}
                  >
                    <img src={gavelIcon} alt="JuriNex" className="w-5 h-5 object-contain brightness-[10]" />
                  </div>

                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-playfair text-[15px] font-bold text-white tracking-tight leading-none">
                        JuriNex
                      </span>
                      <span
                        className="text-white/50 font-semibold"
                        style={{ fontSize: "7px", verticalAlign: "super", lineHeight: 1 }}
                      >TM</span>
                      <span
                        className="text-white/70 font-dmSans font-medium"
                        style={{ fontSize: "11px" }}
                      >
                        AI Legal Assistant
                      </span>
                    </div>

                    {/* Status line */}
                    <div className="flex items-center gap-2 mt-1">
                      {isLive ? (
                        <>
                          <VoiceWave />
                          <span className="text-[10px] text-emerald-300 font-dmSans font-medium">Listening…</span>
                        </>
                      ) : micStatus === "connecting" ? (
                        <>
                          <Motion.span
                            className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"
                            animate={{ opacity: [1, 0.3, 1] }}
                            transition={{ duration: 0.6, repeat: Infinity }}
                          />
                          <span className="text-[10px] text-amber-300 font-dmSans">Connecting…</span>
                        </>
                      ) : (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                          <span className="text-[10px] text-white/55 font-dmSans">Online · Powered by Gemini AI</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => { setOpen(false); forceCloseAudio() }}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                  style={{
                    background: "rgba(255,255,255,0.1)",
                    border: "1px solid rgba(255,255,255,0.15)",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.18)"}
                  onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
                >
                  <svg className="w-3.5 h-3.5 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

            </div>

            {/* ── Messages ─────────────────────────────────────────────────── */}
            <div
              className="flex-1 overflow-y-auto px-4 py-4 space-y-3 custom-scrollbar"
              style={{ background: "linear-gradient(180deg, #f8fafc 0%, #ffffff 40%)" }}
            >
              {messages.map((m, i) => {
                // System pill
                if (m.role === "system") return (
                  <div key={i} className="flex justify-center">
                    <Motion.span
                      initial={{ opacity: 0, scale: 0.88, y: 4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      className="text-[10px] font-dmSans font-medium px-3.5 py-1.5 rounded-full flex items-center gap-2"
                      style={{
                        background: "rgba(20,184,166,0.08)",
                        border: "1px solid rgba(20,184,166,0.2)",
                        color: "#0f766e",
                      }}
                    >
                      <Motion.span
                        className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block"
                        animate={{ opacity: [1, 0.25, 1] }}
                        transition={{ duration: 0.9, repeat: Infinity }}
                      />
                      {m.text}
                    </Motion.span>
                  </div>
                )

                const isUser = m.role === "user"
                return (
                  <Motion.div
                    key={i}
                    variants={msgVariants}
                    initial="hidden"
                    animate="visible"
                    className={`flex ${isUser ? "justify-end" : "justify-start"} items-end`}
                  >
                    {!isUser && <BotAvatar />}

                    <div
                      className={`max-w-[80%] text-sm leading-relaxed font-dmSans ${
                        isUser ? "px-4 py-2.5 whitespace-pre-wrap" : "px-3.5 py-2.5"
                      }`}
                      style={
                        isUser
                          ? {
                              background: "linear-gradient(135deg, #0d9488 0%, #0f766e 100%)",
                              color: "#ffffff",
                              borderRadius: "18px 18px 4px 18px",
                              boxShadow: "0 4px 16px rgba(13,148,136,0.30)",
                            }
                          : m.error
                          ? {
                              background: "#fff5f5",
                              color: "#c53030",
                              border: "1px solid #fed7d7",
                              borderRadius: "4px 18px 18px 18px",
                              boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
                            }
                          : {
                              background: "#ffffff",
                              color: "#1a202c",
                              border: "1px solid #e8edf2",
                              borderRadius: "4px 18px 18px 18px",
                              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                              borderLeft: "3px solid #0d9488",
                            }
                      }
                    >
                      <span className="whitespace-pre-wrap">{m.text}</span>

                      {/* Inline lead capture form on the first bot message */}
                      {m.leadForm && !leadSaved && (
                        <div style={{ marginTop: "12px" }}>
                          <LeadCaptureForm
                            apiBase={AI_CHATBOT_DIRECT_URL}
                            onSaved={handleLeadSaved}
                          />
                        </div>
                      )}
                    </div>
                  </Motion.div>
                )
              })}

              {/* Quick suggestion chips (shown only at the start) */}
              {showSuggestions && messages.length === 1 && !textLoading && (
                <Motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3, duration: 0.3 }}
                  className="flex flex-col gap-2 mt-2"
                >
                  <span className="text-[10px] text-gray-400 font-dmSans font-medium ml-10">Quick questions</span>
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => sendText(s)}
                      className="self-start ml-10 text-[11.5px] font-dmSans text-left px-3 py-1.5 rounded-xl transition-all"
                      style={{
                        background: "rgba(13,148,136,0.06)",
                        border: "1px solid rgba(13,148,136,0.18)",
                        color: "#0f766e",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(13,148,136,0.12)"; e.currentTarget.style.borderColor = "rgba(13,148,136,0.35)" }}
                      onMouseLeave={e => { e.currentTarget.style.background = "rgba(13,148,136,0.06)"; e.currentTarget.style.borderColor = "rgba(13,148,136,0.18)" }}
                    >
                      {s}
                    </button>
                  ))}
                </Motion.div>
              )}

              {textLoading && <TypingIndicator />}
              <div ref={bottomRef} />
            </div>

            {/* ── Demo Booking Modal ───────────────────────────────────────── */}
            <AnimatePresence>
              {showSlotModal && (
                <Motion.div
                  key="demo-modal"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.22 }}
                  className="flex-shrink-0 overflow-hidden"
                  style={{
                    borderTop: "1.5px solid rgba(13,148,136,0.18)",
                    background: "linear-gradient(180deg,#f0fdfa 0%,#ffffff 100%)",
                    maxHeight: "290px",
                  }}
                >
                  {/* Modal header */}
                  <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
                    <div className="flex items-center gap-2">
                      {bookingStep === "form" && (
                        <button
                          onClick={() => { setBookingStep("slots"); setSelectedSlot(null) }}
                          className="w-6 h-6 rounded-lg flex items-center justify-center"
                          style={{ background: "rgba(13,148,136,0.10)", color: "#0f766e" }}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                      )}
                      <span className="text-[12px] font-dmSans font-semibold" style={{ color: "#0f766e" }}>
                        {bookingStep === "done" ? "Booking Confirmed!" : bookingStep === "error" ? "Booking Failed" : "Book a Demo"}
                      </span>
                    </div>
                    <button onClick={closeDemoModal} className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,0,0,0.05)" }}>
                      <svg className="w-3 h-3 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="overflow-y-auto px-4 pb-3" style={{ maxHeight: "230px" }}>

                    {/* Step: slot list */}
                    {bookingStep === "slots" && (
                      <div className="flex flex-col gap-1.5 pt-1">
                        <p className="text-[10.5px] text-gray-500 font-dmSans mb-1">Select an available time slot:</p>
                        {demoSlots.length === 0 ? (
                          <p className="text-[11px] text-gray-400 font-dmSans py-2">No slots available. Please try again tomorrow.</p>
                        ) : demoSlots.map(slot => (
                          <button
                            key={slot.id}
                            onClick={() => {
                              setSelectedSlot(slot)
                              if (micStatus === "live" || micStatus === "connecting") {
                                // Voice mode — inject the exact slot_id into the AI session
                                // so it uses the correct numeric ID, then let AI collect
                                // name/email verbally. Close the modal.
                                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                                  wsRef.current.send(JSON.stringify({
                                    type: "text",
                                    content: `The user tapped and selected slot_id=${slot.id} (${slot.label}). Now ask for their full name, email address, and mobile number to complete the booking.`,
                                  }))
                                }
                                setShowSlotModal(false)
                              } else {
                                // Text mode — proceed to form
                                setBookingStep("form")
                              }
                            }}
                            className="text-left text-[11.5px] font-dmSans px-3 py-2 rounded-xl transition-all"
                            style={{
                              background: "rgba(13,148,136,0.07)",
                              border: "1px solid rgba(13,148,136,0.20)",
                              color: "#134e4a",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "rgba(13,148,136,0.15)"; e.currentTarget.style.borderColor = "rgba(13,148,136,0.40)" }}
                            onMouseLeave={e => { e.currentTarget.style.background = "rgba(13,148,136,0.07)"; e.currentTarget.style.borderColor = "rgba(13,148,136,0.20)" }}
                          >
                            {slot.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Step: details form */}
                    {bookingStep === "form" && selectedSlot && (
                      <div className="flex flex-col gap-2 pt-1">
                        <div className="text-[10.5px] font-dmSans font-medium px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(13,148,136,0.10)", color: "#0f766e" }}>
                          {selectedSlot.label}
                        </div>
                        {[
                          { key: "name",    label: "Full Name *",     type: "text",  ph: "John Doe" },
                          { key: "email",   label: "Email *",         type: "email", ph: "john@company.com" },
                          { key: "phone",   label: "Mobile Number *", type: "tel",   ph: "+91 98765 43210" },
                          { key: "company", label: "Company",         type: "text",  ph: "Optional" },
                        ].map(({ key, label, type, ph }) => (
                          <div key={key}>
                            <label className="text-[10px] font-dmSans font-medium text-gray-500 block mb-0.5">{label}</label>
                            <input
                              type={type}
                              value={bookingForm[key]}
                              onChange={e => setBookingForm(prev => ({ ...prev, [key]: e.target.value }))}
                              placeholder={ph}
                              className="w-full text-[12px] font-dmSans px-3 py-1.5 rounded-xl outline-none transition-all"
                              style={{ border: "1.5px solid #e2e8f0", background: "#f8fafc", color: "#1a202c" }}
                              onFocus={e => { e.target.style.borderColor = "#0d9488"; e.target.style.boxShadow = "0 0 0 2px rgba(13,148,136,0.12)" }}
                              onBlur={e => { e.target.style.borderColor = "#e2e8f0"; e.target.style.boxShadow = "none" }}
                            />
                          </div>
                        ))}
                        <button
                          onClick={handleBookDemo}
                          disabled={!bookingForm.name.trim() || !bookingForm.email.trim() || !bookingForm.phone.trim()}
                          className="w-full text-[12px] font-dmSans font-semibold py-2 rounded-xl mt-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ background: "linear-gradient(135deg,#0d9488,#0f766e)", color: "#fff", boxShadow: "0 3px 10px rgba(13,148,136,0.35)" }}
                        >
                          Confirm Booking
                        </button>
                      </div>
                    )}

                    {/* Step: confirming */}
                    {bookingStep === "confirming" && (
                      <div className="flex flex-col items-center gap-2 py-4">
                        <Motion.svg
                          className="w-7 h-7" style={{ color: "#0d9488" }}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                          animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        >
                          <path strokeLinecap="round" d="M12 3a9 9 0 010 18" />
                        </Motion.svg>
                        <p className="text-[11px] font-dmSans text-gray-500">Confirming your booking…</p>
                      </div>
                    )}

                    {/* Step: done */}
                    {bookingStep === "done" && (
                      <div className="flex flex-col items-center gap-2 py-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(13,148,136,0.12)" }}>
                          <svg className="w-5 h-5" style={{ color: "#0d9488" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <p className="text-[11px] font-dmSans font-medium text-center" style={{ color: "#0f766e" }}>{bookingMsg}</p>
                      </div>
                    )}

                    {/* Step: error */}
                    {bookingStep === "error" && (
                      <div className="flex flex-col items-center gap-2 py-3">
                        <p className="text-[11px] font-dmSans text-red-500 text-center">{bookingMsg}</p>
                        <button
                          onClick={() => setBookingStep(selectedSlot ? "form" : "slots")}
                          className="text-[11px] font-dmSans font-semibold px-4 py-1.5 rounded-xl"
                          style={{ background: "rgba(13,148,136,0.10)", color: "#0f766e" }}
                        >
                          Try Again
                        </button>
                      </div>
                    )}
                  </div>
                </Motion.div>
              )}
            </AnimatePresence>

            {/* ── Input bar ────────────────────────────────────────────────── */}
            <div
              className="flex-shrink-0 px-3 pb-3 pt-2"
              style={{
                background: "#ffffff",
                borderTop: "1px solid #f0f4f8",
              }}
            >
              <div
                className="flex items-end gap-2 rounded-2xl px-3 py-2.5 transition-all duration-200"
                style={
                  isLive
                    ? { background: "#fff5f5", border: "1.5px solid #fc8181", boxShadow: "0 0 0 3px rgba(252,129,129,0.12)" }
                    : { background: "#f8fafc", border: "1.5px solid #e2e8f0" }
                }
                onFocusCapture={e => {
                  if (!isLive) {
                    e.currentTarget.style.borderColor = "#0d9488"
                    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(13,148,136,0.10)"
                  }
                }}
                onBlurCapture={e => {
                  if (!isLive) {
                    e.currentTarget.style.borderColor = "#e2e8f0"
                    e.currentTarget.style.boxShadow = "none"
                  }
                }}
              >
                {/* Mic button */}
                <Motion.button
                  onClick={toggleMic}
                  disabled={textLoading || micStatus === "connecting"}
                  title={isLive ? "Stop recording" : "Start voice input"}
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.90 }}
                  className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 disabled:opacity-40"
                  style={
                    isLive
                      ? { background: "linear-gradient(135deg,#ef4444,#dc2626)", boxShadow: "0 3px 10px rgba(239,68,68,0.40)" }
                      : micStatus === "connecting"
                      ? { background: "#0d9488", boxShadow: "0 3px 10px rgba(13,148,136,0.35)" }
                      : { background: "linear-gradient(135deg,#ccfbf1,#99f6e4)", boxShadow: "0 2px 6px rgba(13,148,136,0.15)" }
                  }
                >
                  {isLive ? (
                    <Motion.svg
                      className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"
                      animate={{ scale: [1, 0.85, 1] }} transition={{ duration: 0.7, repeat: Infinity }}
                    >
                      <rect x="5" y="5" width="10" height="10" rx="2.5" />
                    </Motion.svg>
                  ) : micStatus === "connecting" ? (
                    <Motion.svg
                      className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24"
                      stroke="currentColor" strokeWidth={2}
                      animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    >
                      <path strokeLinecap="round" d="M12 3a9 9 0 010 18" />
                    </Motion.svg>
                  ) : (
                    <svg className="w-4 h-4 text-teal-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  )}
                </Motion.button>

                {/* Textarea */}
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={isLive ? "Listening via microphone…" : "Ask a legal question…"}
                  disabled={isBusy || isLive}
                  className="flex-1 bg-transparent text-[13.5px] text-gray-800 placeholder-gray-400 resize-none outline-none max-h-28 overflow-y-auto custom-scrollbar disabled:cursor-default font-dmSans leading-relaxed"
                />

                {/* Send button */}
                <Motion.button
                  onClick={sendText}
                  disabled={!canSend}
                  whileHover={canSend ? { scale: 1.06 } : {}}
                  whileTap={canSend ? { scale: 0.90 } : {}}
                  className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
                  style={
                    canSend
                      ? {
                          background: "linear-gradient(135deg, #0d9488 0%, #0f766e 100%)",
                          boxShadow: "0 3px 10px rgba(13,148,136,0.40)",
                        }
                      : { background: "#e8edf2" }
                  }
                >
                  <svg className={`w-4 h-4 ${canSend ? "text-white" : "text-gray-400"}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </Motion.button>
              </div>

              {/* Footer caption */}
              <div className="flex items-center justify-center gap-1.5 mt-2">
                <svg className="w-3 h-3 text-gray-300" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                <p className="text-[10px] text-gray-350 font-dmSans" style={{ color: "#b0bec5" }}>
                  {isLive
                    ? "Tap ■ to stop recording · Answers from JuriNex knowledge base"
                    : "End-to-end secured · Answers sourced from official JuriNex docs"
                  }
                </p>
              </div>
            </div>
          </Motion.div>
        )}
      </AnimatePresence>

      {/* ── FAB ─────────────────────────────────────────────────────────────── */}
      <Motion.button
        onClick={() => setOpen(v => !v)}
        variants={fabVariants}
        initial="rest"
        whileHover="hover"
        whileTap="tap"
        className="relative w-14 h-14 rounded-full flex items-center justify-center text-white overflow-visible"
        style={{
          background: open
            ? "linear-gradient(135deg, #0f172a 0%, #134e4a 100%)"
            : "linear-gradient(135deg, #0d9488 0%, #0f766e 100%)",
          boxShadow: open
            ? "0 4px 20px rgba(15,23,42,0.45)"
            : "0 4px 24px rgba(13,148,136,0.50)",
          transition: "background 0.3s, box-shadow 0.3s",
        }}
        aria-label="Open JuriNex support chat"
      >
        {/* Pulse ring (only when closed) */}
        {!open && (
          <Motion.span
            className="absolute inset-0 rounded-full"
            animate={{ scale: [1, 1.5, 1.5], opacity: [0.5, 0, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
            style={{ background: "rgba(13,148,136,0.35)", zIndex: -1 }}
          />
        )}

        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <Motion.span key="x"
              initial={{ rotate: -90, opacity: 0, scale: 0.7 }}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              exit={{ rotate: 90, opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.2 }}
            >
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Motion.span>
          ) : (
            <Motion.span key="bot"
              initial={{ rotate: 90, opacity: 0, scale: 0.7 }}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              exit={{ rotate: -90, opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.2 }}
              className="flex items-center justify-center"
            >
              {/* AI Chatbot icon */}
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Antenna */}
                <line x1="16" y1="2" x2="16" y2="6" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
                <circle cx="16" cy="2" r="1.5" fill="white"/>
                {/* Head */}
                <rect x="5" y="6" width="22" height="16" rx="4" fill="white"/>
                {/* Left ear */}
                <rect x="2" y="11" width="3" height="6" rx="1.5" fill="white"/>
                {/* Right ear */}
                <rect x="27" y="11" width="3" height="6" rx="1.5" fill="white"/>
                {/* Left eye */}
                <circle cx="11.5" cy="13" r="2.5" fill="#0d9488"/>
                <circle cx="11.5" cy="13" r="1" fill="white"/>
                {/* Right eye */}
                <circle cx="20.5" cy="13" r="2.5" fill="#0d9488"/>
                <circle cx="20.5" cy="13" r="1" fill="white"/>
                {/* Smile */}
                <path d="M11 19.5 Q16 22.5 21 19.5" stroke="#0d9488" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
              </svg>
            </Motion.span>
          )}
        </AnimatePresence>
      </Motion.button>
    </div>
  )
}

export default ChatbotWidget
