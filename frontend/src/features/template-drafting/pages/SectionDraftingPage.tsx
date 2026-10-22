/**
 * Section Drafting Page
 *
 * Advanced drafting flow: sections come ONLY from user-fetched and selected or added
 * sections (dt_draft_section_prompts). Supports custom sections, reordering, and CRUD.
 *
 * 1. Load sections from dt_draft_section_prompts (no full universal catalog)
 * 2. Generate each section separately
 * 3. View Critic validation (confidence score & accuracy)
 * 4. Edit generated content, update via prompt
 * 5. Reorder, add, delete sections (CRUD)
 * 6. Assemble all sections into final document
 */

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeftIcon,
    CheckCircleIcon,
    XCircleIcon,
    SparklesIcon,
    PencilIcon,
    DocumentCheckIcon,
    ExclamationTriangleIcon,
    PlusIcon,
    ArrowUpIcon,
    ArrowDownIcon,
    TrashIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    Squares2X2Icon,
    ArrowsPointingOutIcon,
    ArrowUturnLeftIcon,
    ArrowUturnRightIcon
} from '@heroicons/react/24/outline';
import { draftApi } from '../services';
import { getUniversalSections } from '../services/universalSectionsApi';
import { getErrorMessage, isTimeoutError } from '../services/api';
import type { UniversalSection } from '../components/constants';
import { toast } from 'react-toastify';
import { useTokenQuota } from '@/features/billing/context/TokenQuotaContext';

/** Convert an Axios 429/503 error to a quota error that showQuotaError() understands. */
function toQuotaError(error: unknown): Error | null {
    const axErr = error as any;
    const status: number = axErr?.response?.status;
    const data = axErr?.response?.data || {};
    const code: string = data?.code || '';
    if ((status === 429 || status === 503) && code) {
        const err = new Error(data.message || 'Token limit reached.');
        (err as any).code = code;
        (err as any).isQuotaError = true;
        (err as any).details = data.details || {};
        (err as any).status = status;
        (err as any).response = { status, data };
        return err;
    }
    return null;
}

interface SectionState {
    sectionId: string;
    content: string;
    isGenerated: boolean;
    isGenerating: boolean;
    criticReview: {
        status: 'PASS' | 'FAIL' | null;
        score: number;
        feedback: string;
        issues: Array<string | { type?: string; text?: string }>;
        suggestions: string[];
        sources?: string[];
    } | null;
    versionId: string | null;
}

const formatCriticIssue = (issue: string | { type?: string; text?: string }) => {
    if (typeof issue === 'string') return issue;
    if (!issue || typeof issue !== 'object') return String(issue ?? '');
    const issueType = issue.type?.replace(/_/g, ' ');
    const issueText = issue.text?.trim();
    if (issueType && issueText) return `${issueType}: ${issueText}`;
    return issueText || issueType || JSON.stringify(issue);
};

interface SectionDraftingPageProps {
    draftIdProp?: string;
    /** Language code for the entire draft (e.g. 'hi', 'en'). Overrides per-section DB language. */
    draftLanguage?: string;
    /** Called after successful assemble; receives the same response shown in preview (so preview can use it without re-calling assemble). */
    onAssembleComplete?: (response: { success: boolean; final_document: string; template_css?: string; google_docs?: any; metadata?: any }) => void;
    onBack?: () => void;
    addActivity?: (agent: string, action: string, status?: 'in-progress' | 'completed' | 'pending') => void;
}

export const SectionDraftingPage: React.FC<SectionDraftingPageProps> = ({ draftIdProp, draftLanguage, onAssembleComplete, onBack, addActivity }) => {
    const params = useParams<{ draftId: string }>();
    const draftId = draftIdProp || params.draftId;
    const navigate = useNavigate();
    const { showQuotaError } = useTokenQuota();

    const [loading, setLoading] = useState(true);
    const [selectedSections, setSelectedSections] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState<string>('');
    const [sectionStates, setSectionStates] = useState<Record<string, SectionState>>({});
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState('');
    const [updatePrompt, setUpdatePrompt] = useState('');
    const [showPromptInput, setShowPromptInput] = useState(false);
    const [isAssembling, setIsAssembling] = useState(false);
    const [draftTitle, setDraftTitle] = useState('');

    // Universal list: used to mark isCustom and to resolve display names when section_name is empty
    const [universalSectionIds, setUniversalSectionIds] = useState<Set<string>>(new Set());
    const [universalSectionsMap, setUniversalSectionsMap] = useState<Map<string, { title: string; description: string; defaultPrompt: string }>>(new Map());
    // Sections for this draft: only from dt_draft_section_prompts (user selected + added)
    const [allSections, setAllSections] = useState<any[]>([]);
    const [showAddSection, setShowAddSection] = useState(false);
    const [newSectionData, setNewSectionData] = useState({ name: '', type: 'clause' });
    const [templateCss, setTemplateCss] = useState<string>('');
    const [showSectionPopup, setShowSectionPopup] = useState(false);
    const [showEnlargePopup, setShowEnlargePopup] = useState(false);
    /** Section IDs for which the user has dismissed the validation box (so generated content is shown without it). */
    const [dismissedCriticSectionIds, setDismissedCriticSectionIds] = useState<Record<string, boolean>>({});
    /** Ref for the contentEditable area in Edit Content mode (used for undo/redo). */
    const editContentRef = useRef<HTMLDivElement>(null);
    /** When we enter Edit Content we store versionId here so Save always uses the correct version (avoids stale state). */
    const editSessionVersionIdRef = useRef<string | null>(null);


    // Build section list from dt_draft_section_prompts only (user selected + added sections)
    const promptsToSections = (
        prompts: any[],
        universalIds: Set<string>,
        universalMap: Map<string, { title: string; description: string; defaultPrompt: string }>
    ): any[] => {
        return prompts
            .filter((p: any) => !p.is_deleted)
            .map((p: any) => {
                const isCustom = !universalIds.has(p.section_id);
                const resolvedTitle = p.section_name?.trim() || universalMap.get(p.section_id)?.title || (isCustom ? 'Custom Section' : 'Untitled Section');
                const resolvedDesc = p.section_type?.trim() || universalMap.get(p.section_id)?.description || (isCustom ? 'Custom' : 'Section');
                const universalEntry = universalMap.get(p.section_id);
                // Prefer real prompt from section_prompts (default_prompt). If custom_prompt equals section_intro, show default_prompt instead.
                const customTrim = p.custom_prompt?.trim();
                const introTrim = p.section_intro?.trim();
                const useCustom = customTrim && customTrim !== introTrim;
                const defaultPrompt = useCustom ? customTrim : (p.default_prompt?.trim()) || (isCustom
                    ? `Generate the content for the section titled '${resolvedTitle}'. Ensure it is professionally drafted, legally sound, and formatted in clean HTML.`
                    : (universalEntry?.defaultPrompt || ''));
                return {
                    id: p.section_id,
                    title: resolvedTitle,
                    description: resolvedDesc,
                    defaultPrompt,
                    isCustom,
                    sortOrder: p.sort_order ?? 999
                };
            })
            .sort((a: any, b: any) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
    };

    // Load draft: sections ONLY from dt_draft_section_prompts (user-fetched, selected, or added)
    useEffect(() => {
        const loadDraftData = async () => {
            if (!draftId) return;

            try {
                setLoading(true);

                // Prompts = source of truth for this draft's sections. Universal only to mark isCustom.
                const [universalSections, prompts] = await Promise.all([
                    getUniversalSections(),
                    draftApi.getSectionPrompts(draftId),
                ]);

                const universalIds = new Set((universalSections || []).map((u: UniversalSection) => u.id));
                const universalMap = new Map((universalSections || []).map((u: UniversalSection) => [u.id, { title: u.title || '', description: u.description || '', defaultPrompt: u.defaultPrompt || '' }]));
                setUniversalSectionIds(universalIds);
                setUniversalSectionsMap(universalMap);

                const sections = Array.isArray(prompts) ? promptsToSections(prompts, universalIds, universalMap) : [];
                setAllSections(sections);

                const activeSections = sections.map((s: any) => s.id);
                setSelectedSections(activeSections);

                if (activeSections.length > 0 && !activeTab) {
                    setActiveTab(activeSections[0]);
                }

                const initialStates: Record<string, SectionState> = {};
                activeSections.forEach((sectionId: string) => {
                    initialStates[sectionId] = {
                        sectionId,
                        content: '',
                        isGenerated: false,
                        isGenerating: false,
                        criticReview: null,
                        versionId: null
                    };
                });
                setSectionStates(initialStates);

                const sectionsResponse = await draftApi.getSections(draftId);
                try {
                    const cssRes = await draftApi.getTemplateCss(draftId);
                    if (cssRes.success && cssRes.template_css) setTemplateCss(cssRes.template_css);
                } catch {
                    // optional: section preview works without template CSS
                }

                if (sectionsResponse.success && sectionsResponse.sections) {
                    const updatedStates = { ...initialStates };
                    const idByLowerKey = new Map<string, string>();
                    Object.keys(initialStates).forEach(id => {
                        const lower = id.toLowerCase();
                        idByLowerKey.set(lower, id);
                        idByLowerKey.set(lower.replace(/\s+/g, '_'), id);
                    });
                    sectionsResponse.sections.forEach((section: any) => {
                        const sk = (section.section_key || '').trim();
                        const skLower = sk.toLowerCase();
                        const skNorm = skLower.replace(/\s+/g, '_');
                        const targetId = idByLowerKey.get(skLower) ?? idByLowerKey.get(skNorm) ?? (initialStates[sk] ? sk : null);
                        if (targetId) {
                            const html = section.content_html || '';
                            updatedStates[targetId] = {
                                ...updatedStates[targetId],
                                content: html,
                                isGenerated: true,
                                versionId: section.version_id
                            };
                        }
                    });
                    setSectionStates(updatedStates);
                }

            } catch (error) {
                console.error('Failed to load draft data:', error);
                toast.error('Failed to load draft data');
            } finally {
                setLoading(false);
            }
        };

        loadDraftData();
    }, [draftId]);

    const refetchSectionContent = async (sectionId: string) => {
        if (!draftId) return;
        try {
            const res = await draftApi.getSection(draftId, sectionId);
            if (res.success && res.version?.content_html) {
                setSectionStates(prev => ({
                    ...prev,
                    [sectionId]: {
                        ...prev[sectionId],
                        content: res.version.content_html,
                        isGenerated: true,
                        versionId: res.version.version_id
                    }
                }));
            }
        } catch (e) {
            console.warn('Refetch section content failed:', e);
        }
    };

    useEffect(() => {
        if (!activeTab || !draftId) return;
        const state = sectionStates[activeTab];
        if (state?.isGenerated && (!state.content || state.content.trim() === '')) {
            refetchSectionContent(activeTab);
        }
    }, [activeTab, draftId]);

    // Close Update Instructions box when switching to another section so it doesn't appear on every section
    useEffect(() => {
        setShowPromptInput(false);
        setUpdatePrompt('');
    }, [activeTab]);

    const handleAddSection = async () => {
        if (!newSectionData.name.trim() || !draftId) return;

        const sectionId = `custom_${Date.now()}`;
        const newSection = {
            sectionId,
            sectionName: newSectionData.name,
            sectionType: newSectionData.type,
            customPrompt: undefined,
            isDeleted: false
            // sortOrder will be handled by backend or next fetch? 
            // Better to assign sortOrder locally:
        };

        try {
            // Save to DB
            await draftApi.saveSectionPrompt(draftId, sectionId, newSection);

            // Refresh from dt_draft_section_prompts only
            const prompts = await draftApi.getSectionPrompts(draftId);
            const sections = Array.isArray(prompts) ? promptsToSections(prompts, universalSectionIds, universalSectionsMap) : [];
            setAllSections(sections);
            setSelectedSections(sections.map((s: any) => s.id));

            // Init state
            setSectionStates(prev => ({
                ...prev,
                [sectionId]: {
                    sectionId,
                    content: '',
                    isGenerated: false,
                    isGenerating: false,
                    criticReview: null,
                    versionId: null
                }
            }));

            setActiveTab(sectionId);
            setShowAddSection(false);
            setNewSectionData({ name: '', type: 'clause' });
            toast.success('Section added');
        } catch (error) {
            console.error(error);
            toast.error('Failed to add section');
        }
    };

    const handleReorder = async (index: number, direction: 'up' | 'down') => {
        if (!draftId) return;
        const newSections = [...allSections];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;

        if (targetIndex < 0 || targetIndex >= newSections.length) return;

        // Swap
        [newSections[index], newSections[targetIndex]] = [newSections[targetIndex], newSections[index]];

        // Update local sortOrders to match index
        newSections.forEach((s, idx) => s.sortOrder = idx);

        setAllSections(newSections);
        setSelectedSections(newSections.map(s => s.id));

        // Save order to backend
        try {
            await draftApi.saveSectionOrder(draftId, newSections.map(s => s.id));
        } catch (err) {
            toast.error('Failed to save order');
        }
    };

    const handleDeleteSection = async (sectionId: string) => {
        if (!draftId || !window.confirm('Are you sure you want to remove this section?')) return;

        try {
            // Mark as deleted in DB
            await draftApi.saveSectionPrompt(draftId, sectionId, { isDeleted: true });

            const prompts = await draftApi.getSectionPrompts(draftId);
            const sections = Array.isArray(prompts) ? promptsToSections(prompts, universalSectionIds, universalSectionsMap) : [];
            setAllSections(sections);
            setSelectedSections(sections.map((s: any) => s.id));

            if (activeTab === sectionId && sections.length > 0) {
                setActiveTab(sections[0].id);
            }
        } catch (err) {
            toast.error('Failed to remove section');
        }
    };

    const getPromptForSection = (sectionId: string): string | undefined => {
        const section = allSections.find(s => s.id === sectionId);
        const prompt = section?.defaultPrompt?.trim();
        return prompt || undefined;
    };


    const POLL_INTERVAL_MS = 5000;
    const POLL_MAX_ATTEMPTS = 120;

    const applyGeneratedSectionResult = (
        sectionId: string,
        response: { version?: any; critic_review?: any },
        sectionTitle: string,
        isRegenerate: boolean
    ) => {
        const { version, critic_review } = response;
        if (!version?.content_html) {
            throw new Error(`Section "${sectionTitle}" finished without generated content.`);
        }

        setSectionStates(prev => ({
            ...prev,
            [sectionId]: {
                ...prev[sectionId],
                content: version.content_html,
                isGenerated: true,
                isGenerating: false,
                versionId: version.version_id,
                criticReview: critic_review ? {
                    status: critic_review.status,
                    score: critic_review.score,
                    feedback: critic_review.feedback,
                    issues: critic_review.issues || [],
                    suggestions: critic_review.suggestions || [],
                    sources: critic_review.sources || []
                } : null
            }
        }));

        toast.success(`Section "${sectionTitle}" ${isRegenerate ? 'regenerated' : 'generated'} successfully!`);
    };

    const pollForSectionJob = async (
        draftId: string,
        sectionId: string,
        jobId: string,
        sectionTitle: string,
        isRegenerate: boolean,
        addActivity?: (agent: string, message: string, status: 'in-progress' | 'completed') => void,
        setSectionStates?: React.Dispatch<React.SetStateAction<Record<string, SectionState>>>
    ) => {
        for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            try {
                const res = await draftApi.getSectionGenerationJob(draftId, sectionId, jobId);
                if (res?.version?.content_html) {
                    applyGeneratedSectionResult(sectionId, res, sectionTitle, isRegenerate);
                    if (addActivity) {
                        addActivity('Critic', 'Validation complete', 'completed');
                        addActivity('Drafter', `${sectionTitle} drafted and verified.`, 'completed');
                    }
                    return;
                }
                if (res?.failed || res?.status === 'failed') {
                    const message = res?.error || `Section "${sectionTitle}" generation failed.`;
                    if (setSectionStates) {
                        setSectionStates(prev => ({
                            ...prev,
                            [sectionId]: { ...prev[sectionId], isGenerating: false }
                        }));
                    }
                    toast.error(message);
                    if (addActivity) {
                        addActivity('System', message.length > 60 ? `Failed: ${message.slice(0, 57)}...` : `Failed: ${message}`, 'completed');
                    }
                    return;
                }
            } catch (_) {
                // ignore transient fetch errors during poll
            }
        }
        if (setSectionStates) {
            setSectionStates(prev => ({
                ...prev,
                [sectionId]: { ...prev[sectionId], isGenerating: false }
            }));
        }
        toast.warning('Generation may still be in progress. Refresh the page to check.');
        if (addActivity) {
            addActivity('System', 'No result yet. Refresh the page to check.', 'completed');
        }
    };

    const handleGenerateSection = async (sectionId: string, options?: { regenerate?: boolean }) => {
        if (!draftId) return;

        const section = allSections.find(s => s.id === sectionId);
        const sectionTitle = section?.title || 'section';
        const sectionPrompt = getPromptForSection(sectionId);
        const isRegenerate = !!options?.regenerate;

        setSectionStates(prev => ({
            ...prev,
            [sectionId]: {
                ...prev[sectionId],
                isGenerating: true,
                criticReview: isRegenerate ? null : prev[sectionId]?.criticReview ?? null
            }
        }));

        const timeouts: ReturnType<typeof setTimeout>[] = [];
        try {

            if (addActivity) {
                addActivity('Librarian', 'Fetching case chunks via vector search (Gemini embeddings)...', 'in-progress');
                timeouts.push(setTimeout(() => {
                    addActivity('Librarian', 'Retrieved top 80 chunks from case files', 'completed');
                    addActivity('Drafter', 'Sending prompt to Gemini Flash model...', 'in-progress');
                }, 1500));
                timeouts.push(setTimeout(() => {
                    addActivity('Gemini', 'Generating 2-10 pages of legal content...', 'in-progress');
                }, 3500));
                timeouts.push(setTimeout(() => {
                    addActivity('Citation', 'Adding formal references and footnotes...', 'in-progress');
                }, 5500));
                timeouts.push(setTimeout(() => {
                    addActivity('Critic', 'Validating legal logic and accuracy...', 'in-progress');
                }, 7000));
            }

            const response = await draftApi.generateSection(draftId, sectionId, {
                ...(sectionPrompt ? { section_prompt: sectionPrompt } : {}),
                auto_validate: false,
                ...(draftLanguage ? { language: draftLanguage } : {}),
                wait_for_completion: false,
            });

            timeouts.forEach(t => clearTimeout(t));

            if (response.success && response.version?.content_html) {

                if (addActivity) {
                    addActivity('Critic', 'Validation complete', 'completed');
                    addActivity('Drafter', `${sectionTitle} drafted and verified.`, 'completed');
                }

                applyGeneratedSectionResult(sectionId, response, sectionTitle, isRegenerate);
                return;
            }

            if (response.success && response.job_id) {
                toast.info(`Section "${sectionTitle}" queued. You can keep working while it generates.`);
                if (addActivity) {
                    addActivity('System', `Queued "${sectionTitle}" for background drafting.`, 'completed');
                }
                void pollForSectionJob(
                    draftId,
                    sectionId,
                    response.job_id,
                    sectionTitle,
                    isRegenerate,
                    addActivity,
                    setSectionStates
                );
                return;
            }

            throw new Error(response.error || response.message || 'Failed to queue section generation');
        } catch (error) {
            timeouts.forEach(t => clearTimeout(t));
            setSectionStates(prev => ({
                ...prev,
                [sectionId]: { ...prev[sectionId], isGenerating: false }
            }));

            // Show quota upgrade popup for 429/503 token-limit errors
            const quotaErr = toQuotaError(error);
            if (quotaErr && showQuotaError(quotaErr)) return;

            if (isTimeoutError(error)) {
                toast.info('Request timed out. Checking backend for result…');
                if (addActivity) {
                    addActivity('System', 'Request timed out. Checking for completed section…', 'in-progress');
                }
                void refetchSectionContent(sectionId);
                return;
            }
            const message = getErrorMessage(error) || 'Failed to generate section';
            console.error('Failed to generate section:', message, error);
            toast.error(message);
            if (addActivity) {
                addActivity('System', message.length > 60 ? `Failed: ${message.slice(0, 57)}…` : `Failed: ${message}`, 'completed');
            }
        }
    };


    const handleEditUndo = () => {
        const el = editContentRef.current;
        if (!el) return;
        el.focus();
        document.execCommand('undo');
        // Do not update React state — keeps contentEditable uncontrolled so browser undo stack works
    };

    const handleEditRedo = () => {
        const el = editContentRef.current;
        if (!el) return;
        el.focus();
        document.execCommand('redo');
        // Do not update React state — keeps contentEditable uncontrolled so browser redo stack works
    };

    const handleEditSection = () => {
        const currentSection = sectionStates[activeTab];
        setEditContent(currentSection.content ?? '');
        editSessionVersionIdRef.current = currentSection?.versionId ?? null;
        setIsEditing(true);
    };

    /** Set contentEditable content once when entering edit mode so React doesn't overwrite on re-renders (fixes editing + undo/redo). */
    useEffect(() => {
        if (!isEditing || !editContentRef.current) return;
        editContentRef.current.innerHTML = editContent || '<p></p>';
    }, [isEditing]); // Only when entering edit mode; editContent is set in handleEditSection before isEditing becomes true

    const handleSaveEdit = async () => {
        if (!draftId) return;

        try {
            const htmlContent = editContentRef.current?.innerHTML ?? editContent;

            // Use versionId captured when we opened Edit Content (avoids stale state from closure)
            let versionIdToUse = editSessionVersionIdRef.current ?? sectionStates[activeTab]?.versionId;
            if (!versionIdToUse) {
                const res = await draftApi.getSection(draftId, activeTab);
                if (res?.version?.version_id) {
                    versionIdToUse = res.version.version_id;
                    setSectionStates(prev => ({
                        ...prev,
                        [activeTab]: { ...prev[activeTab], versionId: versionIdToUse }
                    }));
                }
            }

            if (versionIdToUse) {
                await draftApi.updateSectionVersion(draftId, activeTab, versionIdToUse, htmlContent);
            } else {
                toast.error('Cannot save: no section version found. Generate the section first.');
                return;
            }

            setSectionStates(prev => ({
                ...prev,
                [activeTab]: { ...prev[activeTab], content: htmlContent }
            }));
            editSessionVersionIdRef.current = null;
            setIsEditing(false);
            toast.success('Content updated successfully');
        } catch (error) {
            console.error('Failed to save edited content:', error);
            toast.error('Failed to save changes');
        }
    };

    const handleUpdateWithPrompt = async () => {
        if (!draftId || !updatePrompt.trim()) return;

        setSectionStates(prev => ({
            ...prev,
            [activeTab]: { ...prev[activeTab], isGenerating: true }
        }));

        try {
            // Generate RAG query automatically to fetch context from uploaded files/cases
            const section = allSections.find(s => s.id === activeTab);
            const sectionName = section?.title || activeTab;
            const autoRagQuery = `Provide all relevant factual details, case information, and context for updating the section: ${sectionName}. User request: ${updatePrompt}`;

            if (addActivity) {
                addActivity('Drafter', `Refining ${sectionName} with feedback...`, 'in-progress');
                addActivity('Gemini', 'Processing refinement prompt...', 'in-progress');
            }

            const response = await draftApi.refineSection(draftId, activeTab, {
                user_feedback: updatePrompt,
                rag_query: autoRagQuery,
                auto_validate: false,
                ...(draftLanguage ? { language: draftLanguage } : {}),
            });

            if (response.success) {
                const { version, critic_review } = response;

                if (addActivity) {
                    addActivity('Gemini', 'Refinement complete', 'completed');
                    addActivity('Drafter', `${sectionName} section successfully updated.`, 'completed');
                }

                setSectionStates(prev => ({
                    ...prev,
                    [activeTab]: {
                        ...prev[activeTab],
                        content: version.content_html,
                        isGenerating: false,
                        versionId: version.version_id,
                        criticReview: critic_review ? {
                            status: critic_review.status,
                            score: critic_review.score,
                            feedback: critic_review.feedback,
                            issues: critic_review.issues || [],
                            suggestions: critic_review.suggestions || [],
                            sources: critic_review.sources || []
                        } : null
                    }
                }));

                setUpdatePrompt('');
                setShowPromptInput(false);
                toast.success('Section updated successfully with context!');
            }
        } catch (error) {
            console.error('Failed to update section:', error);
            toast.error('Failed to update section');
            setSectionStates(prev => ({
                ...prev,
                [activeTab]: { ...prev[activeTab], isGenerating: false }
            }));
        }
    };

    const handleAssemble = async () => {
        if (!draftId) return;

        // Check if all sections are generated
        const allGenerated = selectedSections.every(
            sectionId => sectionStates[sectionId]?.isGenerated
        );

        if (!allGenerated) {
            toast.warning('Please generate all sections before assembling');
            return;
        }

        setIsAssembling(true);

        try {
            if (addActivity) {
                addActivity('Assembler', 'Combining sections into final document...', 'in-progress');
                addActivity('Assembler', 'Applying A4 page breaks and template format...', 'in-progress');
            }

            // Call assembler agent
            const response = await draftApi.assemble(draftId, selectedSections);

            if (response.success) {
                if (addActivity) {
                    addActivity('Assembler', 'Document assembly complete. Preparing preview.', 'completed');
                }
                toast.success('Document assembled successfully!');

                // Pass the same response to preview so it shows exact content + Google Doc (no second assemble call)
                if (onAssembleComplete) {
                    onAssembleComplete(response);
                } else {
                    navigate(`/template-drafting/drafts/${draftId}/preview`);
                }
            }
        } catch (error) {
            console.error('Failed to assemble document:', error);
            if (addActivity) {
                addActivity('Assembler', 'Assembly failed. Check logs.', 'completed');
            }
            toast.error('Failed to assemble document');
        } finally {
            setIsAssembling(false);
        }
    };

    if (loading) {
        return (
            <div className={`flex items-center justify-center ${draftIdProp ? 'py-12' : 'min-h-screen bg-gradient-to-b from-slate-50 to-gray-100'}`}>
                <div className={`bg-white rounded-2xl flex flex-col items-center gap-5 ${draftIdProp ? '' : 'shadow-lg border border-gray-200/80 px-8 py-10'}`}>
                    <div className="animate-spin rounded-full h-9 w-9 border-2 border-gray-200 border-t-[#21C1B6]" />
                    <p className="text-sm font-semibold text-gray-600">Loading sections...</p>
                </div>
            </div>
        );
    }

    const currentSection = sectionStates[activeTab];
    // Find config from allSections instead of UNIVERSAL_SECTIONS directly
    const sectionConfig = allSections.find(s => s.id === activeTab);


    return (
        <div className={draftIdProp ? 'w-full h-full flex flex-col overflow-hidden bg-gradient-to-b from-slate-50 via-gray-50 to-gray-100' : "min-h-screen bg-gradient-to-b from-slate-50 via-gray-50 to-gray-100"}>
            {templateCss && <style dangerouslySetInnerHTML={{ __html: templateCss }} />}
            <style>{`
                .section-preview-a4 { text-align: left; }
                .section-preview-a4-content { text-align: inherit; }
                .section-preview-a4 p, .section-preview-a4-content p { margin: 0 0 0.5em 0; }
                .section-preview-a4 h1, .section-preview-a4 h2, .section-preview-a4 h3,
                .section-preview-a4-content h1, .section-preview-a4-content h2, .section-preview-a4-content h3 { margin: 0.75em 0 0.25em 0; }
                .section-preview-a4, .section-preview-a4-content {
                    font-family: "Times New Roman", Times, serif;
                    font-size: 12pt;
                    line-height: 1.6;
                    color: #111827;
                }
                .section-preview-a4-content,
                .section-preview-a4-content p,
                .section-preview-a4-content li {
                    text-align: justify;
                }
                .section-preview-a4-content h1,
                .section-preview-a4-content h2,
                .section-preview-a4-content h3,
                .section-preview-a4-content h4 {
                    text-align: center;
                    font-weight: 700;
                    line-height: 1.35;
                    letter-spacing: 0.02em;
                }
                .section-preview-a4-content table {
                    width: 100% !important;
                    border-collapse: collapse !important;
                    table-layout: fixed;
                    margin: 0.75em 0 1em;
                }
                .section-preview-a4-content th,
                .section-preview-a4-content td {
                    border: 1px solid #111827;
                    padding: 8px 10px;
                    vertical-align: top;
                    text-align: left;
                    white-space: pre-wrap;
                    word-break: break-word;
                }
                .section-preview-a4-content th {
                    font-weight: 700;
                    text-align: center;
                }
                /* Inner scrollbar in generated content - right edge, slim */
                .section-preview-a4-content::-webkit-scrollbar { width: 5px; }
                .section-preview-a4-content::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 3px; }
                .section-preview-a4-content::-webkit-scrollbar-thumb { background: #b0b0b0; border-radius: 3px; }
                .section-preview-a4-content::-webkit-scrollbar-thumb:hover { background: #8e8e8e; }
                /* Edit content scroll area - slim scrollbar */
                .edit-content-scroll::-webkit-scrollbar { width: 5px; }
                .edit-content-scroll::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 3px; }
                .edit-content-scroll::-webkit-scrollbar-thumb { background: #b0b0b0; border-radius: 3px; }
                .edit-content-scroll::-webkit-scrollbar-thumb:hover { background: #8e8e8e; }
                /* Enlarge popup: A4 pages with page-break lines, no grey */
                .enlarge-popup-pages {
                    width: 210mm;
                    min-height: 297mm;
                    padding: 2.54cm;
                    box-sizing: border-box;
                    font-family: "Times New Roman", Times, serif;
                    font-size: 12pt;
                    line-height: 1.5;
                    background: white;
                    background-image: repeating-linear-gradient(
                        to bottom,
                        transparent 0,
                        transparent calc(297mm - 1px),
                        rgba(0,0,0,0.12) calc(297mm - 1px),
                        rgba(0,0,0,0.12) 297mm
                    );
                    background-origin: padding-box;
                    background-position: 0 0;
                }
            `}</style>
            <div className={`max-w-7xl mx-auto flex-1 flex flex-col min-h-0 overflow-hidden ${draftIdProp ? 'p-4 sm:p-6' : 'px-4 sm:px-6 lg:px-8 py-6 sm:py-8'}`}>
                {/* Header - compact when embedded */}
                {(onBack || !draftIdProp) && (
                    <nav className={draftIdProp ? 'mb-1' : 'mb-4'}>
                        <button
                            type="button"
                            onClick={onBack ? onBack : () => navigate(`/draft-form/${draftId}`)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-[#21C1B6] transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#21C1B6] rounded-lg py-1.5 px-2 -ml-2 hover:bg-white/80"
                        >
                            <ArrowLeftIcon className="w-4 h-4 text-gray-400" />
                            {onBack ? 'Back to Sections' : 'Back to form'}
                        </button>
                    </nav>
                )}

                {/* Title - compact when embedded to maximize content area */}
                <div className={`${draftIdProp ? 'mb-1 flex-shrink-0' : 'mb-3'}`}>
                    <h1 className={draftIdProp ? 'text-lg font-bold text-gray-900' : 'text-2xl font-bold text-gray-900'}>Draft Sections</h1>
                    <p className={`text-gray-500 ${draftIdProp ? 'text-xs mt-0' : 'text-sm mt-0.5'}`}>
                        Generate and refine each section separately, then assemble your document
                    </p>
                </div>

                {/* Layout: Section button + Content (no outer scroll; only inner A4 panel scrolls) */}
                <div className={`flex flex-col ${draftIdProp ? 'gap-1 flex-1 min-h-0 overflow-hidden' : 'gap-2'}`}>
                    {/* Single button: current section name; opens section popup */}
                    <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
                        <button
                            type="button"
                            onClick={() => setShowSectionPopup(true)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border-2 border-[#21C1B6] text-[#21C1B6] rounded-lg font-semibold text-sm hover:bg-[#21C1B6] hover:text-white transition-all shadow-sm"
                            aria-label="Open sections"
                        >
                            <Squares2X2Icon className="w-4 h-4" />
                            <span>
                                {sectionConfig
                                    ? `${selectedSections.indexOf(activeTab) + 1}. ${sectionConfig.title.replace(/^\d+\.\s*/, '')}`
                                    : 'Select section'}
                            </span>
                            <span className="text-xs opacity-80">
                                ({selectedSections.filter(id => sectionStates[id]?.isGenerated).length} of {selectedSections.length} generated)
                            </span>
                        </button>
                    </div>

                    {/* Content Area - A4 section preview; only this inner area scrolls */}
                    <div className={`min-w-0 overflow-hidden ${draftIdProp ? 'flex-1 min-h-0 flex flex-col' : ''}`}>
                        <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${draftIdProp ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : ''}`}>
                            <div className={`${draftIdProp ? 'p-3 flex-1 min-h-0 flex flex-col overflow-hidden' : 'p-4'}`}>
                                {currentSection && sectionConfig && (
                                    <div className={draftIdProp ? 'flex flex-col flex-1 min-h-0 overflow-hidden' : 'space-y-6'}>
                                        {/* Header: section title + Generate button when not generated */}
                                        <div className={draftIdProp ? 'flex-shrink-0 space-y-3' : 'space-y-6'}>
                                        {/* Section Header - compact when embedded; min-w-0 so long description wraps and does not overlap buttons */}
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                <h2 className={`font-bold text-gray-900 ${draftIdProp ? 'text-base' : 'text-xl'}`}>{selectedSections.indexOf(activeTab) + 1}. {sectionConfig.title.replace(/^\d+\.\s*/, '')}</h2>
                                                <p className={`text-gray-500 break-words ${draftIdProp ? 'text-xs mt-0.5' : 'text-sm mt-1'}`}>{sectionConfig.description}</p>
                                            </div>

                                            {!currentSection.isGenerated && (
                                                <button
                                                    onClick={() => handleGenerateSection(activeTab)}
                                                    disabled={currentSection.isGenerating}
                                                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#21C1B6] text-white rounded-lg font-semibold hover:bg-[#1AA49B] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                                                >
                                                    <SparklesIcon className="w-5 h-5" />
                                                    {currentSection.isGenerating ? 'Generating...' : 'Generate Section'}
                                                </button>
                                            )}
                                        </div>
                                        </div>

                                        {/* Generated content FIRST so user always sees the draft; validation appears below */}
                                        {/* Content Display/Edit - inner scroll only; flex-1 so Cancel/Save stay visible when embedded */}
                                        {currentSection.isGenerated && (
                                            <div className={`flex flex-col overflow-hidden ${draftIdProp ? 'space-y-2 flex-1 min-h-0' : 'space-y-4'}`}>
                                                <div className="flex items-center justify-end flex-shrink-0 gap-1.5 mt-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowEnlargePopup(true)}
                                                        className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                                                        title="View full A4 size"
                                                    >
                                                        <ArrowsPointingOutIcon className="w-3.5 h-3.5 shrink-0" />
                                                        Enlarge
                                                    </button>
                                                    <button
                                                        onClick={() => setShowPromptInput(!showPromptInput)}
                                                        className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                                                    >
                                                        <SparklesIcon className="w-3.5 h-3.5 shrink-0" />
                                                        Update with Instruction
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleGenerateSection(activeTab, { regenerate: true })}
                                                        disabled={currentSection.isGenerating}
                                                        className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-[#0F766E] bg-[#ECFDF5] border border-[#99F6E4] rounded-md hover:bg-[#D1FAE5] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                        title="Generate this section again using the same section prompt"
                                                    >
                                                        <SparklesIcon className="w-3.5 h-3.5 shrink-0" />
                                                        {currentSection.isGenerating ? 'Regenerating...' : 'Regenerate'}
                                                    </button>
                                                    <button
                                                        onClick={handleEditSection}
                                                        className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                                                    >
                                                        <PencilIcon className="w-3.5 h-3.5 shrink-0" />
                                                        Edit Content
                                                    </button>
                                                </div>

                                                {/* Prompt Input */}
                                                {showPromptInput && (
                                                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                                                            Update Instructions
                                                        </label>
                                                        <textarea
                                                            value={updatePrompt}
                                                            onChange={(e) => setUpdatePrompt(e.target.value)}
                                                            placeholder="E.g., Make it more formal, add more details about..."
                                                            rows={3}
                                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-[#21C1B6] text-sm"
                                                        />
                                                        <div className="flex justify-end gap-2 mt-2">
                                                            <button
                                                                onClick={() => {
                                                                    setShowPromptInput(false);
                                                                    setUpdatePrompt('');
                                                                }}
                                                                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-white rounded-lg transition-colors"
                                                            >
                                                                Cancel
                                                            </button>
                                                            <button
                                                                onClick={handleUpdateWithPrompt}
                                                                disabled={!updatePrompt.trim() || currentSection.isGenerating}
                                                                className="px-3 py-1.5 text-sm bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                            >
                                                                {currentSection.isGenerating ? 'Updating...' : 'Update'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Content Editor - fills flex parent when embedded; maxHeight on full page so Cancel/Save bar stays visible */}
                                                {isEditing ? (
                                                    <div
                                                        className="flex flex-col min-h-0 min-w-0 flex-1"
                                                        style={draftIdProp ? undefined : { maxHeight: 'calc(100vh - 200px)' }}
                                                    >
                                                        <div className="edit-content-scroll flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
                                                            <div
                                                                ref={editContentRef}
                                                                contentEditable
                                                                suppressContentEditableWarning
                                                                className="section-preview-a4 w-full min-h-[297mm] border-2 border-blue-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-[#21C1B6] focus:outline-none max-w-none bg-white"
                                                                style={{
                                                                    width: '210mm',
                                                                    minHeight: '297mm',
                                                                    fontFamily: '"Times New Roman", Times, serif',
                                                                    fontSize: '12pt',
                                                                    lineHeight: 1.5,
                                                                    padding: '2.54cm',
                                                                    boxSizing: 'border-box',
                                                                }}
                                                            />
                                                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-3">
                                                                <p className="text-xs text-blue-700">
                                                                    <strong>💡 Tip:</strong> You can edit the content directly above. All formatting, fonts, and styles will be preserved exactly as generated.
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <div className="flex-shrink-0 flex items-center justify-between gap-2 py-3 border-t border-gray-200 bg-white">
                                                            <div className="flex items-center gap-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={handleEditUndo}
                                                                    className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 border border-gray-300 transition-colors"
                                                                    title="Undo"
                                                                    aria-label="Undo"
                                                                >
                                                                    <ArrowUturnLeftIcon className="w-5 h-5" />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={handleEditRedo}
                                                                    className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 border border-gray-300 transition-colors"
                                                                    title="Redo"
                                                                    aria-label="Redo"
                                                                >
                                                                    <ArrowUturnRightIcon className="w-5 h-5" />
                                                                </button>
                                                            </div>
                                                            <div className="flex gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setIsEditing(false)}
                                                                    className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-300 transition-colors"
                                                                >
                                                                    Cancel
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={handleSaveEdit}
                                                                    className="px-4 py-2 text-sm font-medium bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] transition-colors"
                                                                >
                                                                    Save Changes
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div
                                                        className={`section-gray-scroll bg-[#dadce0] rounded-lg p-4 flex justify-center w-full flex-1 min-h-0 overflow-hidden ${draftIdProp ? 'flex flex-col items-center' : ''}`}
                                                        style={draftIdProp ? { minHeight: '78vh' } : undefined}
                                                        aria-label="Section content at A4 paper width"
                                                    >
                                                        <div
                                                            className="section-preview-a4 bg-white rounded-lg border border-gray-100 shrink-0 flex flex-col overflow-hidden"
                                                            style={{
                                                                width: '210mm',
                                                                minWidth: '210mm',
                                                                maxHeight: draftIdProp ? '100%' : '80vh',
                                                                ...(draftIdProp ? { minHeight: 0, height: '100%' } : { minHeight: '297mm' }),
                                                                padding: '2.54cm 0 2.54cm 2.54cm',
                                                                fontFamily: '"Times New Roman", Times, serif',
                                                                fontSize: '12pt',
                                                                lineHeight: 1.5,
                                                                boxSizing: 'border-box',
                                                                boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.06)',
                                                            }}
                                                            title="Section preview — A4 (210×297mm)"
                                                        >
                                                            <div
                                                                className="section-preview-a4-content"
                                                                style={{
                                                                    width: '100%',
                                                                    flex: 1,
                                                                    minHeight: 0,
                                                                    overflowY: 'auto',
                                                                    overflowX: 'hidden',
                                                                    paddingRight: '2.54cm',
                                                                    boxSizing: 'border-box',
                                                                }}
                                                                dangerouslySetInnerHTML={{
                                                                    __html: currentSection.content && currentSection.content.trim()
                                                                        ? currentSection.content
                                                                        : '<p class="text-gray-400 italic">Content is loading or empty. If this persists, try regenerating the section.</p>'
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Validation (Critic) — same width as content; constrained so it never resizes the layout */}
                                        {currentSection.criticReview && !dismissedCriticSectionIds[activeTab] && (
                                            <div className={`min-w-0 max-w-full overflow-hidden rounded-xl border-2 p-4 flex-shrink-0 relative ${currentSection.criticReview.status === 'PASS'
                                                ? 'border-green-200 bg-green-50'
                                                : 'border-yellow-200 bg-yellow-50'
                                                }`}>
                                                <button
                                                    type="button"
                                                    onClick={() => setDismissedCriticSectionIds(prev => ({ ...prev, [activeTab]: true }))}
                                                    className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-black/5 transition-colors"
                                                    aria-label="Hide validation"
                                                    title="Hide validation"
                                                >
                                                    <XCircleIcon className="w-5 h-5" />
                                                </button>
                                                <div className="flex items-start gap-3 min-w-0">
                                                    {currentSection.criticReview.status === 'PASS' ? (
                                                        <CheckCircleIcon className="w-6 h-6 text-green-600 flex-shrink-0" />
                                                    ) : (
                                                        <ExclamationTriangleIcon className="w-6 h-6 text-yellow-600 flex-shrink-0" />
                                                    )}
                                                    <div className="flex-1 min-w-0 pr-8 overflow-hidden">
                                                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                                                            <h3 className="font-bold text-gray-900">
                                                                Validation: {currentSection.criticReview.status}
                                                            </h3>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm font-semibold text-gray-700">
                                                                    Confidence Score:
                                                                </span>
                                                                <span className={`text-lg font-bold ${currentSection.criticReview.score >= 70
                                                                    ? 'text-green-600'
                                                                    : 'text-yellow-600'
                                                                    }`}>
                                                                    {currentSection.criticReview.score}%
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <p className="text-sm text-gray-700 mb-3 break-words">
                                                            {currentSection.criticReview.feedback}
                                                        </p>

                                                        {currentSection.criticReview.issues.length > 0 && (
                                                            <div className="mb-3">
                                                                <h4 className="text-xs font-semibold text-gray-700 uppercase mb-1">Issues:</h4>
                                                                <ul className="list-disc list-inside text-sm text-gray-600 space-y-1 break-words">
                                                                    {currentSection.criticReview.issues.map((issue, idx) => (
                                                                        <li key={idx}>{formatCriticIssue(issue)}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}

                                                        {currentSection.criticReview.suggestions.length > 0 && (
                                                            <div className="mb-3">
                                                                <h4 className="text-xs font-semibold text-gray-700 uppercase mb-1">Suggestions:</h4>
                                                                <ul className="list-disc list-inside text-sm text-gray-600 space-y-1 break-words">
                                                                    {currentSection.criticReview.suggestions.map((suggestion, idx) => (
                                                                        <li key={idx}>{suggestion}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}

                                                        {currentSection.criticReview.sources && currentSection.criticReview.sources.length > 0 && (
                                                            <div className="min-w-0 overflow-hidden">
                                                                <h4 className="text-xs font-semibold text-gray-700 uppercase mb-1">Sources Used:</h4>
                                                                <div className="flex flex-wrap gap-2">
                                                                    {currentSection.criticReview.sources.map((source, idx) => (
                                                                        <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200 break-all max-w-full">
                                                                            {source}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Show validation again when user has dismissed it */}
                                        {currentSection.isGenerated && currentSection.criticReview && dismissedCriticSectionIds[activeTab] && (
                                            <div className="flex-shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => setDismissedCriticSectionIds(prev => ({ ...prev, [activeTab]: false }))}
                                                    className="text-xs font-medium text-gray-500 hover:text-[#21C1B6] transition-colors"
                                                >
                                                    Show validation ({currentSection.criticReview.status}, {currentSection.criticReview.score}%)
                                                </button>
                                            </div>
                                        )}

                                        {/* Loading State */}
                                        {currentSection.isGenerating && (
                                            <div className="flex items-center justify-center py-12">
                                                <div className="text-center">
                                                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-[#21C1B6] mx-auto mb-4" />
                                                    <p className="text-sm font-semibold text-gray-600">Generating section content...</p>
                                                    <p className="text-xs text-gray-500 mt-1">This may take a few moments</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Back / Next section bar: Back left, title center, Next or Assemble right */}
                {(() => {
                    const currentIndex = allSections.findIndex(s => s.id === activeTab);
                    const isFirstSection = currentIndex <= 0;
                    const isLastSection = allSections.length > 0 && currentIndex === allSections.length - 1;
                    const prevSection = currentIndex > 0 ? allSections[currentIndex - 1] : null;
                    const nextSection = currentIndex >= 0 && currentIndex < allSections.length - 1 ? allSections[currentIndex + 1] : null;
                    return (
                        <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${draftIdProp ? 'p-3 mt-3 flex-shrink-0' : 'p-6 mt-6'}`}>
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex-shrink-0 w-[180px] flex justify-start">
                                    {!isFirstSection && prevSection ? (
                                        <button
                                            type="button"
                                            onClick={() => setActiveTab(prevSection.id)}
                                            className="inline-flex items-center gap-2 px-4 py-2 text-[#21C1B6] border-2 border-[#21C1B6] bg-white rounded-xl font-bold hover:bg-[#21C1B6] hover:text-white transition-all text-sm"
                                        >
                                            <ChevronLeftIcon className="w-5 h-5" />
                                            {prevSection.title.replace(/^\d+\.\s*/, '')}
                                        </button>
                                    ) : null}
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col items-center justify-center text-center">
                                    <h3 className={`font-semibold text-gray-900 ${draftIdProp ? 'text-base' : 'text-lg'}`}>
                                        {isLastSection ? 'Ready to Assemble?' : 'Go to next section'}
                                    </h3>
                                    <p className={`text-gray-500 ${draftIdProp ? 'text-xs mt-0.5' : 'text-sm mt-1'}`}>
                                        {selectedSections.filter(id => sectionStates[id]?.isGenerated).length} of {selectedSections.length} sections generated
                                    </p>
                                </div>
                                <div className="flex-shrink-0 w-[180px] flex justify-end">
                                    {isLastSection ? (
                                        <button
                                            onClick={handleAssemble}
                                            disabled={isAssembling || !selectedSections.every(id => sectionStates[id]?.isGenerated)}
                                            className="inline-flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-[#21C1B6] to-[#1AA49B] text-white rounded-xl font-bold hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                        >
                                            <DocumentCheckIcon className="w-5 h-5" />
                                            {isAssembling ? 'Assembling...' : 'Assemble Document'}
                                        </button>
                                    ) : nextSection ? (
                                        <button
                                            type="button"
                                            onClick={() => setActiveTab(nextSection.id)}
                                            className="inline-flex items-center gap-2 px-4 py-2 bg-[#21C1B6] text-white rounded-xl font-bold hover:bg-[#1AA49B] transition-all text-sm"
                                        >
                                            Next: {nextSection.title.replace(/^\d+\.\s*/, '')}
                                            <ChevronRightIcon className="w-5 h-5" />
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* Section management popup: page-wise navigation, highlight current, all operations */}
                {showSectionPopup && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowSectionPopup(false)}>
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
                                <div>
                                    <h3 className="text-lg font-bold text-gray-900">Sections</h3>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {selectedSections.filter(id => sectionStates[id]?.isGenerated).length} of {selectedSections.length} generated
                                    </p>
                                </div>
                                <button onClick={() => setShowSectionPopup(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700" aria-label="Close">
                                    <XCircleIcon className="w-5 h-5" />
                                </button>
                            </div>
                            {/* Page-wise: current section index and Prev/Next */}
                            <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                                <span className="text-sm font-medium text-gray-600">
                                    Section {allSections.length ? selectedSections.indexOf(activeTab) + 1 : 0} of {allSections.length}
                                </span>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => {
                                            const idx = allSections.findIndex(s => s.id === activeTab);
                                            if (idx > 0) {
                                                setActiveTab(allSections[idx - 1].id);
                                            }
                                        }}
                                        disabled={!allSections.length || allSections.findIndex(s => s.id === activeTab) <= 0}
                                        className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                        aria-label="Previous section"
                                    >
                                        <ChevronLeftIcon className="w-5 h-5" />
                                    </button>
                                    <button
                                        onClick={() => {
                                            const idx = allSections.findIndex(s => s.id === activeTab);
                                            if (idx >= 0 && idx < allSections.length - 1) {
                                                setActiveTab(allSections[idx + 1].id);
                                            }
                                        }}
                                        disabled={!allSections.length || allSections.findIndex(s => s.id === activeTab) >= allSections.length - 1}
                                        className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                        aria-label="Next section"
                                    >
                                        <ChevronRightIcon className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                            <nav className="p-3 space-y-1 overflow-y-auto flex-1 min-h-0 custom-scrollbar" aria-label="Sections list">
                                {allSections.map((section, index) => {
                                    const sectionId = section.id;
                                    const state = sectionStates[sectionId];
                                    const isActive = activeTab === sectionId;
                                    return (
                                        <div key={sectionId} className="group relative flex items-center">
                                            <button
                                                onClick={() => setActiveTab(sectionId)}
                                                className={`
                                                    w-full text-left px-4 py-3 text-sm font-medium rounded-lg transition-all pr-12
                                                    ${isActive ? 'bg-[#21C1B6] text-white shadow-md' : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'}
                                                `}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="truncate">{index + 1}. {section.title.replace(/^\d+\.\s*/, '')}</span>
                                                    {state?.isGenerated && (
                                                        <CheckCircleIcon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-white' : 'text-green-500'}`} />
                                                    )}
                                                </div>
                                            </button>
                                            <div className={`absolute right-1 flex flex-col gap-0.5 ${isActive ? 'visible' : 'invisible group-hover:visible'}`}>
                                                <button onClick={(e) => { e.stopPropagation(); handleReorder(index, 'up'); }} className={`p-0.5 rounded hover:bg-black/10 ${isActive ? 'text-white' : 'text-gray-400'}`} disabled={index === 0} aria-label="Move up"><ArrowUpIcon className="w-3 h-3" /></button>
                                                <button onClick={(e) => { e.stopPropagation(); handleReorder(index, 'down'); }} className={`p-0.5 rounded hover:bg-black/10 ${isActive ? 'text-white' : 'text-gray-400'}`} disabled={index === allSections.length - 1} aria-label="Move down"><ArrowDownIcon className="w-3 h-3" /></button>
                                                <button onClick={(e) => { e.stopPropagation(); handleDeleteSection(sectionId); }} className={`p-0.5 rounded hover:bg-red-500/20 ${isActive ? 'text-white hover:text-red-100' : 'text-gray-400 hover:text-red-600'}`} aria-label="Delete section"><TrashIcon className="w-3 h-3" /></button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </nav>
                            <div className="p-3 border-t border-gray-200 flex-shrink-0">
                                <button
                                    onClick={() => { setShowAddSection(true); setShowSectionPopup(false); }}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-[#21C1B6] bg-green-50 rounded-lg hover:bg-green-100 transition-colors border border-green-200"
                                >
                                    <PlusIcon className="w-4 h-4" />
                                    Add Section
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Enlarge: A4-size popup, white background, visual page breaks every 297mm */}
                {showEnlargePopup && currentSection?.content && sectionConfig && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowEnlargePopup(false)}>
                        <div className="bg-white rounded-2xl shadow-2xl max-w-[95vw] max-h-[95vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()} style={{ width: 'min(95vw, 230mm)' }}>
                            <div className="flex-shrink-0 px-3 py-2 border-b border-gray-200 flex items-center justify-between">
                                <h3 className="text-base font-bold text-gray-900">
                                    {sectionConfig.title.replace(/^\d+\.\s*/, '')} — A4 view
                                </h3>
                                <button
                                    type="button"
                                    onClick={() => setShowEnlargePopup(false)}
                                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-800"
                                    aria-label="Close"
                                >
                                    <XCircleIcon className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="flex-1 min-h-0 overflow-y-auto flex justify-center bg-white p-4">
                                <div
                                    className="enlarge-popup-pages section-preview-a4 shrink-0"
                                    style={{ textAlign: 'left' }}
                                >
                                    <div
                                        className="section-preview-a4-content"
                                        style={{ width: '100%', boxSizing: 'border-box' }}
                                        dangerouslySetInnerHTML={{
                                            __html: currentSection.content.trim() || '<p class="text-gray-400 italic">No content</p>',
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Add Section Modal */}
                {showAddSection && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-fade-in">
                            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                                <h3 className="text-lg font-bold text-gray-900">Add Custom Section</h3>
                                <button onClick={() => setShowAddSection(false)} className="text-gray-400 hover:text-gray-600">
                                    <XCircleIcon className="w-6 h-6" />
                                </button>
                            </div>
                            <div className="p-6 space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Section Name</label>
                                    <input
                                        type="text"
                                        value={newSectionData.name}
                                        onChange={e => setNewSectionData({ ...newSectionData, name: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-[#21C1B6] focus:border-[#21C1B6]"
                                        placeholder="E.g., Special Provisions"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                                    <select
                                        value={newSectionData.type}
                                        onChange={e => setNewSectionData({ ...newSectionData, type: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-[#21C1B6] focus:border-[#21C1B6]"
                                    >
                                        <option value="clause">Clause</option>
                                        <option value="list">List</option>
                                        <option value="text">Text Block</option>
                                        <option value="definitions">Definitions</option>
                                    </select>
                                </div>
                                {/* Prompts are backend-only - sent to LLM at generation time */}
                            </div>
                            <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3">
                                <button
                                    onClick={() => setShowAddSection(false)}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddSection}
                                    disabled={!newSectionData.name.trim()}
                                    className="px-4 py-2 text-sm font-medium text-white bg-[#21C1B6] hover:bg-[#1AA49B] rounded-lg disabled:opacity-50"
                                >
                                    Add Section
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
