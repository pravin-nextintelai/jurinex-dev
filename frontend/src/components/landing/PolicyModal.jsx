import { useCallback, useEffect, useRef, useState } from "react"
import { motion as Motion } from "framer-motion"
import { CONTACT_INFO } from "../../utils/landingConstants"

const POLICIES = {
  terms: {
    title: "Terms & Conditions",
    companyName: "JuriNex",
    subtitle: "AI-Powered Legal Operating System",
    docTitle: "TERMS AND CONDITIONS OF USE",
    lastUpdated: "December 7, 2025",
    sections: [
      {
        heading: "1. INTRODUCTION AND ACCEPTANCE",
        paragraphs: [
          `Welcome to JuriNex, a product of NexIntel AI Pvt Ltd ("Company", "We", "Us", or "Our"), a company incorporated under the laws of India with its registered office in Chhatrapati Sambhaji Nagar (Aurangabad), Maharashtra.`,
          `By accessing or using our website at jurinex.in, mobile applications, desktop applications, or any AI-powered legal services (collectively, the "Platform" or "Service"), you ("User", "You", or "Your") acknowledge that you have read, understood, and agree to be legally bound by these Terms and Conditions ("Terms"), our Privacy Policy, and any additional terms incorporated by reference.`,
        ],
        important: `IMPORTANT: If you do not agree to these Terms in their entirety, you must not access or use the Platform. Your continued use of the Platform constitutes ongoing acceptance of these Terms as they may be modified from time to time.`,
      },
      {
        heading: "2. DEFINITIONS",
        paragraphs: [`For the purposes of these Terms, the following definitions shall apply:`],
        bullets: [
          `"AI Services" means all artificial intelligence-powered features including document analysis, legal research assistance, drafting tools, timeline generation, and any other AI-generated outputs.`,
          `"Case Project" means a collection of documents, files, and associated metadata uploaded by a User for analysis within a single matter or case.`,
          `"Document AI" means our optical character recognition (OCR) and document processing technology used to digitize scanned documents.`,
          `"Subscription" means a paid or trial plan granting access to specific features of the Platform.`,
          `"User Data" means any content, documents, case files, or information uploaded by You to the Platform.`,
        ],
      },
      {
        heading: "3. ELIGIBILITY AND ACCOUNT REGISTRATION",
        paragraphs: [
          `You must be at least 18 years of age and a licensed legal professional, law student, or authorized representative of a law firm or legal department to use the Platform.`,
          `By registering, you represent and warrant that all information you provide is accurate, current, and complete. You are solely responsible for maintaining the confidentiality of your login credentials.`,
        ],
      },
      {
        heading: "4. USE OF THE PLATFORM",
        paragraphs: [`You agree to use the Platform only for lawful purposes and in accordance with these Terms. You agree NOT to:`],
        bullets: [
          `Use the Platform for any unlawful purpose or in violation of applicable laws and Bar Council regulations.`,
          `Upload false, misleading, or fabricated legal documents.`,
          `Attempt to reverse-engineer, decompile, or extract source code from the Platform.`,
          `Share your login credentials with any third party.`,
          `Use AI-generated outputs as final legal advice without independent professional verification.`,
        ],
      },
      {
        heading: "5. AI DISCLAIMER",
        paragraphs: [
          `JuriNex is a legal productivity tool and NOT a substitute for professional legal advice. All AI-generated outputs — including summaries, drafted documents, research results, or timeline suggestions — are provided for informational and productivity purposes only.`,
        ],
        important: `You must independently verify all AI-generated content before relying on it for any legal, judicial, or client-facing purpose. NexIntel AI Pvt Ltd shall not be liable for any errors, omissions, or outcomes resulting from reliance on AI-generated outputs.`,
      },
      {
        heading: "6. INTELLECTUAL PROPERTY",
        paragraphs: [
          `All rights, title, and interest in the Platform, including but not limited to software, design, trademarks, and proprietary AI models, are and shall remain the exclusive property of NexIntel AI Pvt Ltd.`,
          `You retain ownership of your User Data. By uploading User Data, you grant us a limited, non-exclusive license to process such data solely for the purpose of delivering our Services.`,
        ],
      },
      {
        heading: "7. GOVERNING LAW AND DISPUTE RESOLUTION",
        paragraphs: [
          `These Terms shall be governed by and construed in accordance with the laws of India. Any disputes shall be subject to the exclusive jurisdiction of the courts of Chhatrapati Sambhaji Nagar (Aurangabad), Maharashtra.`,
        ],
      },
    ],
  },
  consent: {
    title: "Consent & Communication",
    companyName: "NexIntel AI Pvt. Ltd.",
    subtitle: "How we use the details you send us",
    docTitle: "CONSENT & COMMUNICATION POLICY",
    lastUpdated: "September 10, 2026",
    sections: [
      {
        heading: "1. RESPONDING TO YOUR ENQUIRY",
        paragraphs: [
          `By submitting this form, you agree that NexIntel AI Pvt. Ltd. may use the information you provide to respond to your enquiry and contact you regarding your request.`,
        ],
      },
      {
        heading: "2. MARKETING COMMUNICATIONS",
        paragraphs: [
          `If you separately opt in to marketing communications, you agree to receive updates, offers, product information and promotional messages from NexIntel AI Pvt. Ltd. through phone calls, SMS, WhatsApp and/or email, based on the options you select.`,
          `Marketing consent is optional and is not required to submit an enquiry.`,
        ],
      },
      {
        heading: "3. WITHDRAWING CONSENT",
        paragraphs: [`You may withdraw your marketing consent at any time by:`],
        bullets: [
          `Replying STOP to applicable SMS or WhatsApp messages.`,
          `Using the Unsubscribe link in marketing emails.`,
          `Informing our representative during a call.`,
          `Contacting us directly using the details below.`,
        ],
      },
      {
        heading: "4. SHARING OF INFORMATION",
        paragraphs: [
          `We may share your information only with authorised service providers such as CRM, email, SMS, telecom and WhatsApp service providers where necessary to provide these communications. We do not sell your personal data to third parties.`,
          `Your information will be handled in accordance with applicable Indian data protection and telecom communication requirements.`,
        ],
      },
      {
        heading: "5. CONTACT",
        subSections: [
          {
            infoLines: [
              { label: "Company", value: "NexIntel AI Pvt. Ltd." },
              { label: "Address", value: "B-11, Near Railway Station Road, MIDC, Chhatrapati Sambhajinagar, Maharashtra – 431010, India" },
              { label: "Email", value: CONTACT_INFO.email },
              { label: "Phone", value: CONTACT_INFO.phone },
            ],
          },
        ],
        important: `By submitting this form, you acknowledge that you have read our Privacy Policy and this Consent & Communication Policy.`,
      },
    ],
  },
  dpdpa: {
    title: "Privacy Policy",
    companyName: "JuriNex AI-Powered Legal Operating System",
    subtitle: null,
    docTitle: "PRIVACY POLICY",
    docSubtitle: "(Data Processing Notice under DPDPA 2023)",
    lastUpdated: "December 7, 2025",
    sections: [
      {
        heading: "1. INTRODUCTION AND SCOPE",
        subSections: [
          {
            subHeading: "1.1 About This Policy",
            paragraphs: [
              `NexIntel AI Pvt Ltd ("Company", "We", "Us", "JuriNex") is committed to protecting your privacy and personal data. This Privacy Policy serves as the mandatory "Notice" required under Section 5 of the Digital Personal Data Protection Act (DPDPA), 2023.`,
              `This Policy explains how we collect, use, store, share, and protect your personal data when you use the JuriNex platform, including our website (jurinex.in), mobile applications, and AI-powered legal services.`,
            ],
          },
          {
            subHeading: "1.2 Data Fiduciary Information",
            infoLines: [
              { label: "Data Fiduciary:", value: "NexIntel AI Pvt Ltd" },
              { label: "Registered Address:", value: "Chhatrapati Sambhaji Nagar (Aurangabad), Maharashtra, India" },
              { label: "Contact Email:", value: "privacy@jurinex.in" },
            ],
          },
          {
            subHeading: "1.3 Consent",
            paragraphs: [null],
            important: `BY SIGNING UP OR USING JURINEX, YOU CONSENT TO THE COLLECTION AND PROCESSING OF YOUR DATA AS DESCRIBED IN THIS POLICY.`,
            extraParagraphs: [
              `If you do not agree with this Policy, please do not use our Platform. You may withdraw consent at any time, subject to the consequences described in Section 9.`,
            ],
          },
        ],
      },
      {
        heading: "2. PERSONAL DATA WE COLLECT",
        paragraphs: [`We collect different categories of personal data depending on how you interact with JuriNex:`],
        bullets: [
          `Identity Data: Full name, Bar Enrollment Number, professional designation.`,
          `Contact Data: Email address, phone number, office address.`,
          `Account Data: Username, encrypted password, account preferences.`,
          `Professional Data: Law firm name, practice areas, court affiliations.`,
          `Usage Data: Login times, features accessed, search queries, AI interactions.`,
          `Device Data: IP address, browser type, operating system.`,
          `Document Data: Case files, legal documents uploaded by you (processed but not stored beyond session unless saved).`,
        ],
      },
      {
        heading: "3. YOUR RIGHTS UNDER DPDPA 2023",
        paragraphs: [`As a Data Principal under the Digital Personal Data Protection Act 2023, you have the right to:`],
        bullets: [
          `Access your personal data held by us.`,
          `Correct inaccurate or incomplete personal data.`,
          `Erase your personal data (right to be forgotten), subject to legal retention requirements.`,
          `Nominate a person to exercise rights on your behalf in case of death or incapacity.`,
          `Withdraw consent at any time, without affecting the lawfulness of prior processing.`,
          `Grievance redressal — contact our Data Protection Officer at privacy@jurinex.in.`,
        ],
      },
      {
        heading: "4. DATA RETENTION",
        paragraphs: [
          `We retain your personal data only as long as necessary to fulfill the purpose of collection or as required by applicable law. Account data is retained for the duration of your subscription plus 2 years. Upon account deletion, personal data is purged within 30 days unless legal retention obligations apply.`,
        ],
      },
    ],
  },
}

const PolicyBody = ({ policy }) => (
  <div className="space-y-5">
    <div className="pb-4 border-b border-teal-300/60">
      <h3 className="font-playfair text-xl font-bold text-teal-700">{policy.companyName}</h3>
      {policy.subtitle && <p className="mt-0.5 font-dmSans text-sm font-semibold text-teal-700">{policy.subtitle}</p>}
      <p className="mt-2 font-dmSans text-sm font-bold text-teal-700">{policy.docTitle}</p>
      {policy.docSubtitle && <p className="font-dmSans text-sm text-juri-muted">{policy.docSubtitle}</p>}
      <p className="mt-1 font-dmSans text-sm text-juri-muted">
        <span className="font-semibold text-teal-700">Last Updated:</span> {policy.lastUpdated}
      </p>
    </div>

    {policy.sections.map((sec) => (
      <div key={sec.heading} className="space-y-2">
        <p className="font-dmSans text-sm font-bold text-teal-700">{sec.heading}</p>

        {sec.subSections?.map((sub) => (
          <div key={sub.subHeading} className="space-y-1.5 pl-1">
            <p className="font-dmSans text-sm font-semibold text-teal-700">{sub.subHeading}</p>
            {sub.paragraphs?.filter(Boolean).map((p, i) => (
              <p key={i} className="font-dmSans text-sm leading-relaxed text-juri-muted">{p}</p>
            ))}
            {sub.important && (
              <p className="font-dmSans text-sm font-semibold leading-relaxed text-nx-teal-deep">
                {sub.important}
              </p>
            )}
            {sub.extraParagraphs?.map((p, i) => (
              <p key={i} className="font-dmSans text-sm leading-relaxed text-juri-muted">{p}</p>
            ))}
            {sub.infoLines?.map(({ label, value }) => (
              <p key={label} className="font-dmSans text-sm text-juri-muted">
                <span className="font-semibold text-teal-700">{label}</span> {value}
              </p>
            ))}
          </div>
        ))}

        {sec.paragraphs?.map((p, i) => (
          <p key={i} className="font-dmSans text-sm leading-relaxed text-juri-muted">{p}</p>
        ))}

        {sec.important && (
          <p className="font-dmSans text-sm font-semibold leading-relaxed text-nx-teal-deep">
            {sec.important}
          </p>
        )}

        {sec.bullets?.map((b) => (
          <div key={b} className="flex items-start gap-2 pl-1">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-juri-muted" />
            <p className="font-dmSans text-sm leading-relaxed text-juri-muted">{b}</p>
          </div>
        ))}
      </div>
    ))}
  </div>
)

/**
 * Props:
 *   policyKey  — "terms" | "dpdpa" | "consent"
 *   onClose    — called on X or backdrop click
 *   onAccept   — called on "Accept & Close" (optional — omit for view-only mode)
 */
const PolicyModal = ({ policyKey, onClose, onAccept }) => {
  const policy = POLICIES[policyKey]
  const bodyRef = useRef(null)
  // Accept unlocks once the reader has scrolled to the end. Bodies that
  // fit without scrolling unlock straight away.
  const [readToEnd, setReadToEnd] = useState(false)

  const checkScroll = useCallback(() => {
    const el = bodyRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 24) setReadToEnd(true)
  }, [])

  useEffect(() => {
    setReadToEnd(false)
    const id = requestAnimationFrame(checkScroll)
    return () => cancelAnimationFrame(id)
  }, [policyKey, checkScroll])

  if (!policy) return null
  const gated = Boolean(onAccept) && !readToEnd

  return (
    <>
      <Motion.div
        className="fixed inset-0 z-50 bg-teal-900/35"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 pointer-events-none">
        <Motion.div
          className="pointer-events-auto relative flex w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden"
          style={{ maxHeight: "85vh" }}
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 340, damping: 28 } }}
          exit={{ opacity: 0, y: 20, scale: 0.97 }}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-teal-300/60 px-6 py-4">
            <h2 className="font-playfair text-lg font-bold text-teal-700">{policy.title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Scrollable body */}
          <div ref={bodyRef} onScroll={checkScroll} className="flex-1 overflow-y-auto px-6 py-5 sm:px-8">
            <PolicyBody policy={policy} />
          </div>

          {/* Footer */}
          <div className="flex shrink-0 flex-col gap-3 border-t border-teal-300/60 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-dmSans text-xs text-nx-muted" aria-live="polite">
              {gated ? "Scroll to the end of the document to enable Accept." : onAccept ? "You have read the full document." : ""}
            </p>
            <Motion.button
              type="button"
              onClick={onAccept ?? onClose}
              disabled={gated}
              aria-disabled={gated}
              className="rounded-lg bg-nx-teal px-8 py-2.5 font-dmSans text-sm font-bold text-white shadow-md shadow-teal-500/25 transition-opacity disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              whileHover={gated ? undefined : { scale: 1.02, boxShadow: "0 6px 20px rgba(8,163,147,0.4)" }}
              whileTap={gated ? undefined : { scale: 0.97 }}
            >
              {onAccept ? "Accept & Close" : "Close"}
            </Motion.button>
          </div>
        </Motion.div>
      </div>
    </>
  )
}

export default PolicyModal
