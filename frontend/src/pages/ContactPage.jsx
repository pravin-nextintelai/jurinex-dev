import { motion as Motion } from "framer-motion"
import PropTypes from "prop-types"
import Navbar from "../components/landing/Navbar"
import Footer from "../components/landing/Footer"
import PolicyModal from "../components/landing/PolicyModal"
import ChatbotWidget from "../components/landing/ChatbotWidget"
import BookDemoModal from "../components/landing/BookDemoModal"
import { useDemoPrompt } from "../hooks/useDemoPrompt"
import { useState } from "react"

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] },
  }),
}

const CARDS = [
  {
    key: "office",
    icon: (
      <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    title: "Our Office",
    lines: [
      { text: "NexIntel AI Pvt Ltd", bold: true },
      { text: "B-11, Near Railway Station Road," },
      { text: "MIDC, Chhatrapati Sambhaji Nagar," },
      { text: "Maharashtra 431005" },
    ],
  },
  {
    key: "phone",
    icon: (
      <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
      </svg>
    ),
    title: "Phone",
    lines: [
      { text: "+91 9684027372", highlight: true },
      { text: "Mon-Fri, 9 AM - 6 PM IST" },
    ],
  },
  {
    key: "email",
    icon: (
      <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
    title: "Email",
    lines: [
      { text: "info@nexintelai.com", highlight: true },
    ],
  },
]

const ContactPage = ({ onBackToHome, onNavigateLogin, onSectionNav }) => {
  const [demoOpen, setDemoOpen] = useState(false)
  useDemoPrompt(setDemoOpen)
  const [policyKey, setPolicyKey] = useState(null)

  return (
    <div className="min-h-screen bg-white">
      <Navbar solid onRequestDemo={() => setDemoOpen(true)} onLogin={onNavigateLogin} onSectionNav={onSectionNav} />

      <main className="mx-auto max-w-4xl px-6 pb-20 pt-32 sm:px-10">
        {/* Back */}
        <Motion.button
          type="button"
          onClick={onBackToHome}
          className="mb-10 inline-flex items-center gap-1.5 font-dmSans text-sm text-juri-muted transition hover:text-teal-700"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0, transition: { duration: 0.3 } }}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back
        </Motion.button>

        {/* Heading */}
        <Motion.div
          className="mb-12 text-center"
          custom={0}
          variants={fadeUp}
          initial="hidden"
          animate="show"
        >
          <h1 className="font-playfair text-4xl font-bold text-teal-700 sm:text-5xl">
            Contact Us
          </h1>
          <p className="mt-3 font-dmSans text-base text-juri-muted">
            Have questions? We&apos;re here to help.
          </p>
        </Motion.div>

        {/* Cards */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {CARDS.map((card, i) => (
            <Motion.div
              key={card.key}
              custom={i + 1}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="flex flex-col items-center rounded-2xl border border-teal-300/60 bg-teal-50/50 px-6 py-8 text-center shadow-[0_8px_24px_rgba(13,148,136,0.10)]"
            >
              {/* Icon */}
              <div
                className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl shadow-md"
                style={{ backgroundColor: "#0D9488" }}
              >
                {card.icon}
              </div>

              <p className="mb-3 font-dmSans text-base font-semibold text-teal-700">
                {card.title}
              </p>

              <div className="space-y-0.5">
                {card.lines.map((line, j) => (
                  <p
                    key={j}
                    className={`font-dmSans text-sm leading-relaxed ${
                      line.highlight
                        ? "font-semibold"
                        : line.bold
                        ? "font-medium text-teal-700"
                        : "text-juri-muted"
                    }`}
                    style={line.highlight ? { color: "#0D9488" } : {}}
                  >
                    {line.text}
                  </p>
                ))}
              </div>
            </Motion.div>
          ))}
        </div>
      </main>

      <Footer onOpenPolicy={setPolicyKey} />

      {policyKey && (
        <PolicyModal
          policyKey={policyKey}
          onClose={() => setPolicyKey(null)}
        />
      )}

      <BookDemoModal isOpen={demoOpen} onClose={() => setDemoOpen(false)} />
      <ChatbotWidget />
    </div>
  )
}

ContactPage.propTypes = {
  onBackToHome: PropTypes.func,
  onNavigateLogin: PropTypes.func,
}

export default ContactPage
