/**
 * ConversationalBuilder - Main page for the AI Template Builder.
 *
 * Lives inside MainLayout (JuriNex sidebar + MainContent).
 * Two-column layout:
 *   LEFT (sticky)  -> Step progress sidebar
 *   RIGHT (flex-1) -> One-question-at-a-time Q&A OR GeneratedTemplateView
 */
import React from 'react';
import { useTemplateBuilderStore } from './templateBuilderStore';
import { RequirementsSidebar } from './RequirementsSidebar';
import { BuilderChat } from './BuilderChat';
import { GeneratedTemplateView } from './GeneratedTemplateView';

export const ConversationalBuilder: React.FC = () => {
  const { phase } = useTemplateBuilderStore();

  const showPreview = phase === 'preview' || phase === 'saving' || phase === 'saved';

  return (
    <div className="flex min-h-screen bg-gray-50 items-start">
      <aside
        className="w-56 shrink-0 bg-white border-r border-gray-100 sticky top-0 self-start overflow-y-auto"
        style={{ minHeight: '100vh' }}
      >
        <RequirementsSidebar />
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        {showPreview ? <GeneratedTemplateView /> : <BuilderChat />}
      </main>
    </div>
  );
};

export default ConversationalBuilder;
