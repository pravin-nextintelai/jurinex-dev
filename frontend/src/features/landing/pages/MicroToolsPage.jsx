import { Navigate, useParams } from "react-router-dom"
import PublicPageShell from "../components/PublicPageShell"
import CitationCheck from "../components/micro-tools/CitationCheck"
import LimitationCalculator from "../components/micro-tools/LimitationCalculator"
import SectionMapper from "../components/micro-tools/SectionMapper"
import TextSandbox from "../components/micro-tools/TextSandbox"
import ToolCards from "../components/micro-tools/ToolCards"
import { MICRO_TOOLS } from "../utils/microToolsData"

const PANELS = {
  "bns-mapper": SectionMapper,
  "fir-text": TextSandbox,
  "citation-check": CitationCheck,
  limitation: LimitationCalculator,
}

const MicroToolsPage = () => {
  const { toolSlug } = useParams()
  const slug = toolSlug || "bns-mapper"
  if (toolSlug && !PANELS[toolSlug]) return <Navigate to="/legal-tools" replace />
  const Panel = PANELS[slug]

  return (
    <PublicPageShell title="Free Legal Micro-Tools">
      <div className="bg-nx-pale">
        <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
          <ToolCards tools={MICRO_TOOLS} active={slug} />
          <Panel />
        </div>
      </div>
    </PublicPageShell>
  )
}

export default MicroToolsPage
