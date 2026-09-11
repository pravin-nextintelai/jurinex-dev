import { useState, useEffect } from "react"
import PropTypes from "prop-types"
import Navbar from "../components/landing/Navbar"
import HeroSection from "../components/landing/HeroSection"
import StatsSection from "../components/landing/StatsSection"
import TrustSection from "../components/landing/TrustSection"
import ProblemSolutionSection from "../components/landing/ProblemSolutionSection"
import FeaturesSection from "../components/landing/FeaturesSection"
import WorkflowSection from "../components/landing/WorkflowSection"
import IndianCourtsSection from "../components/landing/IndianCourtsSection"
import UseCasesSection from "../components/landing/UseCasesSection"
import AICapabilitiesSection from "../components/landing/AICapabilitiesSection"
import SecuritySection from "../components/landing/SecuritySection"
import BenefitsSection from "../components/landing/BenefitsSection"
import WhyChooseSection from "../components/landing/WhyChooseSection"
import TestimonialsSection from "../components/landing/TestimonialsSection"
import ThreeStepsSection from "../components/landing/ThreeStepsSection"
import PricingSection from "../components/landing/PricingSection"
import CTASection from "../components/landing/CTASection"
import Footer from "../components/landing/Footer"
import BookDemoModal from "../components/landing/BookDemoModal"
import { useDemoPrompt } from "../hooks/useDemoPrompt"
import PolicyModal from "../components/landing/PolicyModal"
import ChatbotWidget from "../components/landing/ChatbotWidget"

/**
 * Marketing landing page composition.
 *
 * Section rhythm: hero → trust → problem/solution → features →
 * showcase → workflow → use cases → AI capabilities → security →
 * benefits → why NexIntel → testimonials → pricing → CTA → footer.
 * Team, Community, FAQs, Blogs and Help live on their own /pages.
 */
const HomePage = ({ onNavigateLogin, onNavigateContact, pendingSection, onPendingSectionConsumed }) => {
  const [promoVisible, setPromoVisible] = useState(false)
  const [demoOpen, setDemoOpen] = useState(false)
  const [policyKey, setPolicyKey] = useState(null) // "terms" | "dpdpa" | null
  useDemoPrompt(setDemoOpen)

  // Scroll to a section requested from another page (e.g. Contact nav links)
  useEffect(() => {
    if (!pendingSection) return
    const el = document.getElementById(pendingSection)
    if (el) el.scrollIntoView({ behavior: "smooth" })
    onPendingSectionConsumed?.()
  }, [pendingSection]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = () => {
    setDemoOpen(false)
  }

  const openDemo = () => setDemoOpen(true)

  const handleLogin = (loginState) => {
    onNavigateLogin?.(loginState)
  }

  return (
    <div className="min-h-screen bg-white font-body text-nx-ink antialiased">
      <Navbar onRequestDemo={openDemo} onLogin={handleLogin} onPromoVisibilityChange={setPromoVisible} />
      <main className={promoVisible ? "pt-[72px] sm:pt-10" : ""}>
        <HeroSection onLogin={handleLogin} />
        <StatsSection />
        <TrustSection />
        <ProblemSolutionSection />
        <FeaturesSection />
        <WorkflowSection />
        <IndianCourtsSection />
        <UseCasesSection />
        <AICapabilitiesSection />
        <SecuritySection />
        <BenefitsSection />
        <WhyChooseSection />
        <TestimonialsSection />
        <ThreeStepsSection />
        <PricingSection
          onNavigateLogin={onNavigateLogin}
          onNavigateContact={onNavigateContact}
        />
        <CTASection onBookDemo={openDemo} />
      </main>
      <Footer onOpenPolicy={setPolicyKey} onGetInTouch={onNavigateContact} onRequestDemo={openDemo} />

      <BookDemoModal isOpen={demoOpen} onClose={handleClose} />

      {policyKey && (
        <PolicyModal policyKey={policyKey} onClose={() => setPolicyKey(null)} />
      )}

      <ChatbotWidget />
    </div>
  )
}

HomePage.propTypes = {
  onNavigateLogin: PropTypes.func,
  onNavigateContact: PropTypes.func,
  pendingSection: PropTypes.string,
  onPendingSectionConsumed: PropTypes.func,
}

export default HomePage
