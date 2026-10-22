// import React from 'react';
// import WorkflowSidebar from './WorkflowSidebar';
// import AgentActivityFeed from './AgentActivityFeed';

// const DraftingLayout = ({
//     children,
//     currentStepId,
//     completedSteps = [],
//     activities = [],
//     headerContent
// }) => {
//     return (
//         <div className="flex h-screen w-full bg-[#0f111a] overflow-hidden font-sans text-slate-900">
//             {/* Left Sidebar */}
//             <WorkflowSidebar currentStepId={currentStepId} completedSteps={completedSteps} />

//             {/* Center Content Area */}
//             <main className="flex-1 flex flex-col min-w-0 bg-[#f8fafc] dark:bg-slate-900 overflow-hidden">
//                 {/* Header */}
//                 <header className="h-16 flex-shrink-0 bg-white border-b border-slate-200 px-8 flex items-center justify-between shadow-sm z-10">
//                     <div className="flex items-center gap-4">
//                         {headerContent || (
//                             <div>
//                                 <h1 className="text-lg font-bold text-slate-800">Drafting Canvas</h1>
//                                 <p className="text-xs text-slate-500 font-medium">Draft ID: #12345</p>
//                             </div>
//                         )}
//                     </div>
//                     <div className="flex items-center gap-3">
//                         <div className="flex -space-x-2">
//                             {[1, 2, 3].map(i => (
//                                 <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-slate-200 flex items-center justify-center text-[10px] font-bold">
//                                     {String.fromCharCode(64 + i)}
//                                 </div>
//                             ))}
//                         </div>
//                         <div className="h-6 w-px bg-slate-200 mx-2" />
//                         <button className="px-4 py-1.5 bg-[#21C1B6] hover:bg-[#1da89e] text-white text-xs font-bold rounded-lg transition-all shadow-md shadow-[#21C1B6]/20">
//                             Save Draft
//                         </button>
//                     </div>
//                 </header>

//                 {/* Scrollable Content */}
//                 <div className="flex-1 overflow-y-auto custom-scrollbar relative">
//                     <div className="max-w-6xl mx-auto p-8 h-full">
//                         {children}
//                     </div>
//                 </div>
//             </main>

//             {/* Right Sidebar */}
//             <AgentActivityFeed activities={activities} />

//             <style>{`
//         .custom-scrollbar::-webkit-scrollbar {
//           width: 6px;
//           height: 6px;
//         }
//         .custom-scrollbar::-webkit-scrollbar-track {
//           background: transparent;
//         }
//         .custom-scrollbar::-webkit-scrollbar-thumb {
//           background: rgba(0, 0, 0, 0.1);
//           border-radius: 10px;
//         }
//         .dark .custom-scrollbar::-webkit-scrollbar-thumb {
//           background: rgba(255, 255, 255, 0.1);
//         }
//         .custom-scrollbar::-webkit-scrollbar-thumb:hover {
//           background: rgba(0, 0, 0, 0.2);
//         }
//       `}</style>
//         </div>
//     );
// };

// export default DraftingLayout;



import React, { useState } from 'react';
import { Bars3Icon, CpuChipIcon } from '@heroicons/react/24/outline';
import WorkflowSidebar from './WorkflowSidebar';
import AgentActivityFeed from './AgentActivityFeed';

const DraftingLayout = ({
    children,
    currentStepId,
    completedSteps = [],
    activities = [],
    headerContent,
    hideChrome = false
}) => {
    const [isWorkflowOpen, setIsWorkflowOpen] = useState(true);
    const [isActivityOpen, setIsActivityOpen] = useState(true);

    // When hideChrome is active (e.g. AI chat mode), force both panels closed
    const effectiveWorkflowOpen = hideChrome ? false : isWorkflowOpen;
    const effectiveActivityOpen = hideChrome ? false : isActivityOpen;

    return (
        <div className="flex h-screen w-full bg-gray-50 overflow-hidden font-sans text-gray-900">
            {/* Left Sidebar */}
            {!hideChrome && (
                <WorkflowSidebar
                    currentStepId={currentStepId}
                    completedSteps={completedSteps}
                    isOpen={effectiveWorkflowOpen}
                    onToggle={() => setIsWorkflowOpen(!isWorkflowOpen)}
                />
            )}

            {/* Center Content Area */}
            <main className="flex-1 flex flex-col min-w-0 bg-gray-50 overflow-hidden">
                {/* Header */}
                <header className="h-24 flex-shrink-0 bg-white border-b border-gray-200 px-8 flex items-center shadow-sm z-10 gap-6">
                    {/* Toggle Workflow Button */}
                    {!hideChrome && !effectiveWorkflowOpen && (
                        <button
                            onClick={() => setIsWorkflowOpen(true)}
                            className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-900 transition-all font-bold shrink-0"
                            aria-label="Show workflow"
                        >
                            <Bars3Icon className="w-5 h-5" />
                        </button>
                    )}

                    {/* Main Header Content */}
                    <div className="flex-1 min-w-0">
                        {headerContent || (
                            <div>
                                <h1 className="text-lg font-bold text-gray-800">petition - Draft</h1>
                                <p className="text-xs text-gray-500 font-medium">ID: T03AD01C • Saved 08:12 AM</p>
                            </div>
                        )}
                    </div>

                    {/* Right Side Actions */}
                    <div className="flex items-center gap-3 shrink-0">
                        {/* Toggle Activity Button */}
                        {!hideChrome && !effectiveActivityOpen && (
                            <button
                                onClick={() => setIsActivityOpen(true)}
                                className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-900 transition-all font-bold"
                                aria-label="Show agent activity"
                            >
                                <CpuChipIcon className="w-5 h-5" />
                            </button>
                        )}
                    </div>
                </header>

                {/* Scrollable Content - wider when agent activity is closed so section shows at A4 paper width */}
                <div className="flex-1 overflow-hidden custom-scrollbar relative">
                    <div className={`h-full ${hideChrome ? 'w-full' : `mx-auto p-8 ${effectiveActivityOpen ? 'max-w-6xl' : 'max-w-[min(100%,1200px)]'}`}`}>
                        {children}
                    </div>
                </div>
            </main>

            {/* Right Sidebar */}
            {!hideChrome && (
                <AgentActivityFeed
                    activities={activities}
                    isOpen={effectiveActivityOpen}
                    onToggle={() => setIsActivityOpen(!isActivityOpen)}
                />
            )}

            <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                    height: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(0, 0, 0, 0.1);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(0, 0, 0, 0.2);
                }
            `}</style>
        </div>
    );
};

export default DraftingLayout;