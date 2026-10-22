import { useState, useEffect } from "react"
import PropTypes from "prop-types"
import Navbar from "../components/Navbar"
import HeroSection from "../components/HeroSection"
import StatsSection from "../components/StatsSection"
import TrustSection from "../components/TrustSection"
import ProblemSolutionSection from "../components/ProblemSolutionSection"
import FeaturesSection from "../components/FeaturesSection"
import WorkflowSection from "../components/WorkflowSection"
import IndianCourtsSection from "../components/IndianCourtsSection"
import UseCasesSection from "../components/UseCasesSection"
import AICapabilitiesSection from "../components/AICapabilitiesSection"
import SecuritySection from "../components/SecuritySection"
import BenefitsSection from "../components/BenefitsSection"
import WhyChooseSection from "../components/WhyChooseSection"
import TestimonialsSection from "../components/TestimonialsSection"
import ThreeStepsSection from "../components/ThreeStepsSection"
import PricingSection from "../components/PricingSection"
import CTASection from "../components/CTASection"
import Footer from "../components/Footer"
import BookDemoModal from "../components/BookDemoModal"
import { useDemoPrompt } from "../hooks/useDemoPrompt"
import PolicyModal from "../components/PolicyModal"
import ChatbotWidget from "../components/ChatbotWidget"

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
