import React from 'react';
import {
    CheckCircleIcon,
    CircleStackIcon,
    PencilSquareIcon,
    ShieldCheckIcon,
    RocketLaunchIcon,
    Squares2X2Icon,
    ChevronLeftIcon
} from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';

const STEPS = [
    {
        id: 'initialization',
        number: '01',
        title: 'Initialization',
        description: 'Setting up project context',
        icon: CircleStackIcon,
    },
    {
        id: 'form_inputs',
        number: '02',
        title: 'Form Inputs',
        description: 'Providing document details',
        icon: PencilSquareIcon,
    },
    {
        id: 'section_config',
        number: '03',
        title: 'Section Config',
        description: 'Structuring document parts',
        icon: Squares2X2Icon,
    },
    {
        id: 'validation',
        number: '04',
        title: 'Validation',
        description: 'Legal logic verification',
        icon: ShieldCheckIcon,
    },
    {
        id: 'review',
        number: '05',
        title: 'Review',
        description: 'Final human verification',
        icon: ShieldCheckIcon,
    },
    {
        id: 'assembly',
        number: '06',
        title: 'Assembly',
        description: 'Final document compilation',
        icon: RocketLaunchIcon,
    },
];

const containerVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: {
        opacity: 1,
        x: 0,
        transition: {
            staggerChildren: 0.1,
            when: "beforeChildren"
        }
    }
};

const stepVariants = {
    hidden: { opacity: 0, x: -10 },
    visible: { opacity: 1, x: 0 }
};

const WorkflowSidebar = ({ currentStepId, completedSteps = [], isOpen = true, onToggle }) => {
    const currentStepIndex = STEPS.findIndex(s => s.id === currentStepId);

    // Calculate progress for connector line
    const progressHeight = STEPS.length > 0
        ? `${((currentStepIndex) / (STEPS.length - 1)) * 100}%`
        : '0%';

    return (
        <AnimatePresence mode="wait">
            {isOpen && (
                <motion.div
                    initial={{ x: -300, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: -300, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    className="w-[300px] h-full bg-gray-100 text-gray-900 flex flex-col overflow-y-auto border-r border-gray-200 relative z-20"
                >
                    {/* Close Button */}
                    <button
                        onClick={onToggle}
                        className="absolute top-4 right-4 z-50 p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-900 transition-all focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/30"
                        aria-label="Close workflow sidebar"
                    >
                        <ChevronLeftIcon className="w-4 h-4" />
                    </button>

                    <motion.div
                        className="p-6 h-full flex flex-col"
                        variants={containerVariants}
                        initial="hidden"
                        animate="visible"
                    >
                        <div className="mb-10">
                            <h2 className="text-xl font-bold bg-gradient-to-r from-[#21C1B6] to-gray-900 bg-clip-text text-transparent italic tracking-tight">
                                JuriNex <span className="text-xs align-top ml-1 opacity-50 not-italic">AI</span>
                            </h2>
                            <p className="text-[10px] text-gray-500 mt-1 uppercase tracking-[0.2em] font-black">
                                DRAFTING WORKFLOW
                            </p>
                        </div>

                        <div className="flex-1 space-y-4 relative">
                            {/* Background Connector Line */}
                            <div className="absolute left-[23px] top-6 bottom-6 w-[2px] bg-gray-100 z-0 rounded-full" />

                            {/* Animated Progress Connector */}
                            <motion.div
                                className="absolute left-[23px] top-6 w-[2px] bg-[#21C1B6] z-0 rounded-full shadow-[0_0_8px_rgba(33,193,182,0.4)]"
                                initial={{ height: 0 }}
                                animate={{ height: progressHeight }}
                                transition={{ duration: 0.8, ease: "easeInOut" }}
                            />

                            {STEPS.map((step, index) => {
                                const isActive = currentStepId === step.id;
                                const isCompleted = completedSteps.includes(step.id);
                                const isPast = STEPS.findIndex(s => s.id === currentStepId) > index;
                                const Icon = step.icon;

                                return (
                                    <motion.div
                                        key={step.id}
                                        className="relative z-10"
                                        variants={stepVariants}
                                    >
                                        <motion.div
                                            whileHover={{ x: 6 }}
                                            className={`flex gap-4 p-3 rounded-2xl transition-all duration-500 border-2 ${isActive
                                                ? 'bg-white border-[#21C1B6]/20 shadow-[0_8px_30px_rgb(0,0,0,0.04)]'
                                                : 'bg-transparent border-transparent hover:bg-gray-50/50'
                                                }`}
                                        >
                                            <div className="flex flex-col items-center relative">
                                                <motion.div
                                                    animate={isActive ? {
                                                        scale: [1, 1.05, 1],
                                                        boxShadow: [
                                                            "0 0 0px rgba(33,193,182,0.4)",
                                                            "0 0 15px rgba(33,193,182,0.4)",
                                                            "0 0 0px rgba(33,193,182,0.4)"
                                                        ]
                                                    } : {}}
                                                    transition={{ repeat: Infinity, duration: 2 }}
                                                    className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-700 ${isActive
                                                        ? 'bg-[#21C1B6] text-white'
                                                        : isCompleted || isPast
                                                            ? 'bg-green-100 text-green-600'
                                                            : 'bg-gray-100 text-gray-400'
                                                        }`}
                                                >
                                                    <AnimatePresence mode="wait">
                                                        {isCompleted || isPast ? (
                                                            <motion.div
                                                                key="check"
                                                                initial={{ scale: 0, rotate: -45 }}
                                                                animate={{ scale: 1, rotate: 0 }}
                                                                className="w-6 h-6"
                                                            >
                                                                <CheckCircleIcon />
                                                            </motion.div>
                                                        ) : (
                                                            <motion.div
                                                                key="icon"
                                                                initial={{ scale: 0.8 }}
                                                                animate={{ scale: 1 }}
                                                                className="w-6 h-6"
                                                            >
                                                                <Icon />
                                                            </motion.div>
                                                        )}
                                                    </AnimatePresence>
                                                </motion.div>

                                                {/* Active dot glow indicator */}
                                                {isActive && (
                                                    <motion.div
                                                        layoutId="active-dot"
                                                        className="absolute -left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-[#21C1B6] rounded-full"
                                                        initial={{ opacity: 0 }}
                                                        animate={{ opacity: 1 }}
                                                    />
                                                )}
                                            </div>

                                            <div className="flex flex-col justify-center overflow-hidden">
                                                <motion.p
                                                    animate={{ color: isActive ? "#21C1B6" : "#94a3b8" }}
                                                    className="text-[10px] uppercase tracking-[0.1em] font-black"
                                                >
                                                    Step {step.number}
                                                </motion.p>
                                                <h3 className={`text-sm font-bold transition-colors duration-300 ${isActive ? 'text-gray-900' : 'text-gray-500'
                                                    }`}>
                                                    {step.title}
                                                </h3>
                                                <p className={`text-[11px] mt-0.5 line-clamp-1 transition-colors duration-300 ${isActive ? 'text-gray-500' : 'text-gray-400'}`}>
                                                    {step.description}
                                                </p>
                                            </div>

                                            {isActive && (
                                                <motion.div
                                                    layoutId="active-indicator-side"
                                                    className="absolute right-0 top-3 bottom-3 w-[3px] bg-[#21C1B6] rounded-full"
                                                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                                />
                                            )}
                                        </motion.div>
                                    </motion.div>
                                );
                            })}
                        </div>

                        <div className="mt-auto pt-6 border-t border-gray-100">
                            <motion.div
                                whileHover={{ scale: 1.02 }}
                                className="flex items-center gap-3 p-3 bg-gray-50/80 rounded-2xl border border-gray-100 transition-all"
                            >
                                <div className="relative">
                                    <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                                    <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-green-500 animate-ping opacity-40" />
                                </div>
                                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">System Ready</p>
                            </motion.div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default WorkflowSidebar;