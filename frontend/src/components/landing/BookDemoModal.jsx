import { useState } from "react"
import PropTypes from "prop-types"
import { motion as Motion, AnimatePresence } from "framer-motion"
import gavelIcon from "../../assets/jurinex-mark.png"
import { markDemoDone } from "../../hooks/useDemoPrompt"

const COUNTRY_CODES = [
  { code: "+91", flag: "🇮🇳", iso: "IN" },
  { code: "+1",  flag: "🇺🇸", iso: "US" },
  { code: "+44", flag: "🇬🇧", iso: "GB" },
  { code: "+61", flag: "🇦🇺", iso: "AU" },
  { code: "+971",flag: "🇦🇪", iso: "AE" },
]

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.25 } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
}

const modalVariants = {
  hidden: { opacity: 0, y: 60, scale: 0.94 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 340, damping: 28, mass: 0.9 },
  },
  exit: {
    opacity: 0,
    y: 40,
    scale: 0.95,
    transition: { duration: 0.2, ease: "easeIn" },
  },
}

const BookDemoModal = ({ isOpen, onClose }) => {
  const [countryCode, setCountryCode] = useState(COUNTRY_CODES[0])
  const [showCountryList, setShowCountryList] = useState(false)
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    org: "",
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    markDemoDone()
    onClose()
  }

  const handleChange = (field) => (e) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }))

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <Motion.div
            key="backdrop"
            className="fixed inset-0 z-50 bg-teal-900/35"
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 pointer-events-none">
            <Motion.div
              key="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="demo-modal-heading"
              className="pointer-events-auto relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden"
              variants={modalVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {/* Animated top accent bar */}
              <Motion.div
                className="h-1 w-full bg-gradient-to-r from-teal-500 via-teal-400 to-teal-300"
                initial={{ scaleX: 0, originX: 0 }}
                animate={{ scaleX: 1, transition: { duration: 0.5, delay: 0.15, ease: "easeOut" } }}
              />

              <div className="px-8 pb-8 pt-6">
                {/* Close button */}
                <button
                  type="button"
                  onClick={onClose}
                  className="absolute top-4 right-4 rounded-full p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                  aria-label="Close popup"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                {/* Icon */}
                <Motion.div
                  className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl overflow-hidden shadow-md"
                  initial={{ scale: 0, rotate: -15 }}
                  animate={{ scale: 1, rotate: 0, transition: { type: "spring", stiffness: 400, damping: 20, delay: 0.1 } }}
                >
                  <img src={gavelIcon} alt="JuriNex" className="h-full w-full object-cover" />
                </Motion.div>

                {/* Heading */}
                <Motion.div
                  className="mb-5 text-center"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: 0.18, duration: 0.35 } }}
                >
                  <h2
                    id="demo-modal-heading"
                    className="font-playfair text-2xl font-bold text-teal-700"
                  >
                    Book a Demo
                  </h2>
                  <p className="mt-1 text-sm text-juri-muted font-dmSans">
                    Fill in your details and we&apos;ll get back to you shortly.
                  </p>
                </Motion.div>

                {/* Form */}
                <Motion.form
                  onSubmit={handleSubmit}
                  className="space-y-4"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { delay: 0.25, duration: 0.3 } }}
                >
                  {/* Full Name */}
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-teal-700 font-dmSans" htmlFor="demo-name">
                      Full Name
                    </label>
                    <input
                      id="demo-name"
                      type="text"
                      required
                      placeholder="Enter your full name"
                      value={form.fullName}
                      onChange={handleChange("fullName")}
                      className="w-full rounded-xl border border-teal-300/60 bg-white px-4 py-2.5 text-sm text-teal-700 placeholder-juri-subtle outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 font-dmSans"
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-teal-700 font-dmSans" htmlFor="demo-email">
                      Email Address
                    </label>
                    <input
                      id="demo-email"
                      type="email"
                      required
                      placeholder="Enter your email address"
                      value={form.email}
                      onChange={handleChange("email")}
                      className="w-full rounded-xl border border-teal-300/60 bg-white px-4 py-2.5 text-sm text-teal-700 placeholder-juri-subtle outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 font-dmSans"
                    />
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-teal-700 font-dmSans" htmlFor="demo-phone">
                      Phone Number
                    </label>
                    <div className="flex rounded-xl border border-teal-300/60 bg-white focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20 transition overflow-hidden">
                      {/* Country selector */}
                      <div className="relative">
                        <button
                          type="button"
                          className="flex h-full items-center gap-1.5 border-r border-teal-300/60 px-3 text-sm text-teal-700 hover:bg-gray-50 transition font-dmSans"
                          onClick={() => setShowCountryList((v) => !v)}
                          aria-label="Select country code"
                        >
                          <span>{countryCode.flag}</span>
                          <svg className="h-3 w-3 text-juri-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        <AnimatePresence>
                          {showCountryList && (
                            <Motion.ul
                              className="absolute top-full left-0 z-10 mt-1 min-w-[130px] rounded-xl border border-teal-300/60 bg-white shadow-lg text-sm font-dmSans overflow-hidden"
                              initial={{ opacity: 0, y: -6 }}
                              animate={{ opacity: 1, y: 0, transition: { duration: 0.15 } }}
                              exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
                            >
                              {COUNTRY_CODES.map((c) => (
                                <li key={c.iso}>
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 px-3 py-2 hover:bg-gray-50 transition text-teal-700"
                                    onClick={() => {
                                      setCountryCode(c)
                                      setShowCountryList(false)
                                    }}
                                  >
                                    <span>{c.flag}</span>
                                    <span>{c.code}</span>
                                    <span className="text-juri-muted text-xs">{c.iso}</span>
                                  </button>
                                </li>
                              ))}
                            </Motion.ul>
                          )}
                        </AnimatePresence>
                      </div>
                      <div className="flex flex-1 items-center gap-2 px-3">
                        <span className="text-sm text-teal-700 font-dmSans whitespace-nowrap">{countryCode.code}</span>
                        <input
                          id="demo-phone"
                          type="tel"
                          placeholder="Phone number"
                          value={form.phone}
                          onChange={handleChange("phone")}
                          className="flex-1 bg-transparent py-2.5 text-sm text-teal-700 placeholder-juri-subtle outline-none font-dmSans"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Organization */}
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-teal-700 font-dmSans" htmlFor="demo-org">
                      Organization Name <span className="font-normal text-juri-muted">(optional)</span>
                    </label>
                    <input
                      id="demo-org"
                      type="text"
                      placeholder="Enter your organization name"
                      value={form.org}
                      onChange={handleChange("org")}
                      className="w-full rounded-xl border border-teal-300/60 bg-white px-4 py-2.5 text-sm text-teal-700 placeholder-juri-subtle outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 font-dmSans"
                    />
                  </div>

                  {/* Submit */}
                  <Motion.button
                    type="submit"
                    className="w-full rounded-xl bg-teal-600 py-3 text-sm font-bold text-white shadow-md font-dmSans"
                    whileHover={{ scale: 1.02, boxShadow: "0 8px 24px rgba(13,148,136,0.35)" }}
                    whileTap={{ scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  >
                    Book a Demo
                  </Motion.button>


                </Motion.form>
              </div>
            </Motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}

BookDemoModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
}

export default BookDemoModal

