// import React, { useEffect, useRef } from 'react';
// import { motion, AnimatePresence } from 'framer-motion';
// import {
//     CpuChipIcon,
//     SparklesIcon,
//     ClockIcon,
//     ChevronDownIcon,
//     CheckCircleIcon,
//     ArrowPathIcon
// } from '@heroicons/react/24/outline';

// const AgentActivityFeed = ({ activities = [] }) => {
//     const scrollRef = useRef(null);

//     useEffect(() => {
//         if (scrollRef.current) {
//             scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
//         }
//     }, [activities]);

//     // Mock data if none provided
//     const displayActivities = activities.length > 0 ? activities : [
//         {
//             id: 1,
//             agentName: 'Linguistic Agent',
//             type: 'LLM',
//             timestamp: '12:15:30',
//             action: 'Analyzing case facts for jurisdictional relevance...',
//             status: 'completed',
//         },
//         {
//             id: 2,
//             agentName: 'Legal Researcher',
//             type: 'Search',
//             timestamp: '12:15:45',
//             action: 'Searching precedents in Supreme Court database...',
//             status: 'in-progress',
//         },
//         {
//             id: 3,
//             agentName: 'Drafter Agent',
//             type: 'GenAI',
//             timestamp: '12:16:10',
//             action: 'Generating "Statement of Facts" section...',
//             status: 'pending',
//         }
//     ];

//     return (
//         <div className="w-[350px] h-full bg-[#0d1117] border-l border-white/5 flex flex-col">
//             <div className="p-6 border-b border-white/5 flex items-center justify-between">
//                 <div className="flex items-center gap-2">
//                     <CpuChipIcon className="w-5 h-5 text-[#21C1B6]" />
//                     <h2 className="text-lg font-bold text-white tracking-tight">AGENT ACTIVITY</h2>
//                 </div>
//                 <div className="px-2 py-1 bg-[#21C1B6]/10 rounded-md">
//                     <span className="text-[10px] font-bold text-[#21C1B6] uppercase tracking-wider">Live</span>
//                 </div>
//             </div>

//             <div
//                 ref={scrollRef}
//                 className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4"
//             >
//                 <AnimatePresence mode="popLayout">
//                     {displayActivities.map((activity) => (
//                         <motion.div
//                             key={activity.id}
//                             initial={{ opacity: 0, y: 20, scale: 0.95 }}
//                             animate={{ opacity: 1, y: 0, scale: 1 }}
//                             exit={{ opacity: 0, scale: 0.95 }}
//                             className={`p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 transition-all group relative overflow-hidden`}
//                         >
//                             {/* Status Glow Background */}
//                             {activity.status === 'in-progress' && (
//                                 <div className="absolute inset-0 bg-[#21C1B6]/5 animate-pulse" />
//                             )}

//                             <div className="flex gap-3 relative z-10">
//                                 <div className="flex-shrink-0">
//                                     <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${activity.status === 'completed' ? 'bg-green-500/20 text-green-400' :
//                                         activity.status === 'in-progress' ? 'bg-[#21C1B6]/20 text-[#21C1B6]' :
//                                             'bg-white/5 text-gray-500'
//                                         }`}>
//                                         {activity.status === 'completed' ? <CheckCircleIcon className="w-6 h-6" /> :
//                                             activity.status === 'in-progress' ? <ArrowPathIcon className="w-6 h-6 animate-spin" /> :
//                                                 <SparklesIcon className="w-6 h-6" />}
//                                     </div>
//                                 </div>

//                                 <div className="flex-1 min-w-0">
//                                     <div className="flex items-center justify-between gap-2">
//                                         <span className="text-xs font-bold text-white truncate">{activity.agentName}</span>
//                                         <div className="flex items-center gap-1 text-gray-500 shrink-0">
//                                             <ClockIcon className="w-3 h-3" />
//                                             <span className="text-[10px]">{activity.timestamp}</span>
//                                         </div>
//                                     </div>

//                                     <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
//                                         {activity.action}
//                                     </p>

//                                     <div className="mt-3 flex items-center justify-between">
//                                         <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${activity.status === 'completed' ? 'text-green-400 bg-green-500/10' :
//                                             activity.status === 'in-progress' ? 'text-[#21C1B6] bg-[#21C1B6]/10' :
//                                                 'text-gray-500 bg-white/5'
//                                             }`}>
//                                             {activity.status.replace('-', ' ')}
//                                         </span>

//                                         <button className="text-gray-500 hover:text-white transition-colors group-hover:bg-white/5 p-1 rounded">
//                                             <ChevronDownIcon className="w-3.5 h-3.5" />
//                                         </button>
//                                     </div>
//                                 </div>
//                             </div>
//                         </motion.div>
//                     ))}
//                 </AnimatePresence>
//             </div>

//             <div className="p-4 bg-gradient-to-t from-[#11131a] to-transparent border-t border-white/5">
//                 <div className="p-3 bg-white/5 rounded-xl flex items-center justify-between">
//                     <div className="flex items-center gap-2">
//                         <div className="w-2 h-2 rounded-full bg-[#21C1B6] animate-ping" />
//                         <span className="text-[10px] text-gray-400 font-medium">Listening for updates...</span>
//                     </div>
//                     <span className="text-[10px] text-gray-500">v2.4.0</span>
//                 </div>
//             </div>
//         </div>
//     );
// };

// export default AgentActivityFeed;


import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    CpuChipIcon,
    SparklesIcon,
    ClockIcon,
    ChevronDownIcon,
    CheckCircleIcon,
    ArrowPathIcon,
    XMarkIcon
} from '@heroicons/react/24/outline';

const AgentActivityFeed = ({ activities = [], isOpen = true, onToggle }) => {
    const scrollRef = useRef(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [activities]);

    // Mock data if none provided
    const displayActivities = activities.length > 0 ? activities : [
        {
            id: 1,
            agentName: 'Linguistic Agent',
            type: 'LLM',
            timestamp: '12:15:30',
            action: 'Analyzing case facts for jurisdictional relevance...',
            status: 'completed',
        },
        {
            id: 2,
            agentName: 'Legal Researcher',
            type: 'Search',
            timestamp: '12:15:45',
            action: 'Searching precedents in Supreme Court database...',
            status: 'in-progress',
        },
        {
            id: 3,
            agentName: 'Drafter Agent',
            type: 'GenAI',
            timestamp: '12:16:10',
            action: 'Generating "Statement of Facts" section...',
            status: 'pending',
        }
    ];

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ x: 350, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: 350, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    className="w-[350px] h-full bg-gray-100 border-l border-gray-200 flex flex-col relative"
                >
                    {/* Header with Close Button */}
                    <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <CpuChipIcon className="w-5 h-5 text-[#21C1B6]" />
                            <h2 className="text-lg font-bold text-gray-900 tracking-tight">AGENT ACTIVITY</h2>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="px-2 py-1 bg-[#21C1B6]/10 rounded-md">
                                <span className="text-[10px] font-bold text-[#21C1B6] uppercase tracking-wider">Live</span>
                            </div>
                            <button
                                onClick={onToggle}
                                className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-900 transition-all"
                                aria-label="Close agent activity"
                            >
                                <XMarkIcon className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    <div
                        ref={scrollRef}
                        className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4"
                    >
                        <AnimatePresence mode="popLayout">
                            {displayActivities.map((activity) => (
                                <motion.div
                                    key={activity.id}
                                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    className={`p-2.5 rounded-xl bg-white border border-gray-100 hover:border-[#21C1B6]/20 transition-all group relative overflow-hidden`}
                                >
                                    {/* Status Glow Background */}
                                    {activity.status === 'in-progress' && (
                                        <div className="absolute inset-0 bg-[#21C1B6]/5 animate-pulse" />
                                    )}

                                    <div className="flex gap-2.5 relative z-10">
                                        <div className="flex-shrink-0">
                                            <div className={`w-7 h-7 rounded flex items-center justify-center ${activity.status === 'completed' ? 'bg-green-50 text-green-500' :
                                                activity.status === 'in-progress' ? 'bg-[#21C1B6]/5 text-[#21C1B6]' :
                                                    'bg-gray-50 text-gray-400'
                                                }`}>
                                                {activity.status === 'completed' ? <CheckCircleIcon className="w-4 h-4" /> :
                                                    activity.status === 'in-progress' ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> :
                                                        <SparklesIcon className="w-4 h-4" />}
                                            </div>
                                        </div>

                                        <div className="flex-1 min-w-0 pt-0.5">
                                            <div className="flex items-center justify-between gap-2 mb-0.5">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[10px] font-bold text-gray-800">{activity.agentName}</span>
                                                    <span className={`text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                                        activity.type === 'LLM' || activity.type === 'GenAI' ? 'bg-purple-100 text-purple-600' :
                                                        activity.type === 'Search' ? 'bg-blue-100 text-blue-600' :
                                                        activity.type === 'Assembly' ? 'bg-amber-100 text-amber-700' :
                                                        'bg-gray-100 text-gray-600'
                                                    }`}>
                                                        {activity.type || 'Agent'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1 text-gray-400 shrink-0">
                                                    <ClockIcon className="w-2.5 h-2.5" />
                                                    <span className="text-[9px] font-medium uppercase tracking-tighter">{activity.timestamp}</span>
                                                </div>
                                            </div>

                                            <p className="text-[11px] text-gray-700 leading-snug mt-0.5">
                                                {activity.action}
                                            </p>
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>

                    <div className="p-4 bg-gradient-to-t from-gray-100 to-transparent border-t border-gray-200">
                        <div className="p-3 bg-white rounded-xl flex items-center justify-between border border-gray-200">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-[#21C1B6] animate-ping" />
                                <span className="text-[10px] text-gray-600 font-medium">Listening for agent updates...</span>
                            </div>
                            <span className="text-[9px] text-gray-400 font-medium">Gemini · Cursor-like</span>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default AgentActivityFeed;