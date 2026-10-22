import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { DocumentTextIcon } from '@heroicons/react/24/solid';
import { toast } from 'react-toastify';
import { fetchTemplates } from './templateWizardApi';
import TemplateWizardCard from './TemplateWizardCard';
import TemplatePreviewPopup from './TemplatePreviewPopup';
import { createDraft } from '../../api/draftFormApi';
import { customTemplateApi, CustomTemplateUploadModal } from '@/features/template-drafting';
import './TemplateWizardGallery.css';

// Module-level caches — persist across navigation until page refresh
let _templatesCache = null;
let _templatesFetchPromise = null; // deduplicates StrictMode double-invoke
let _customTemplatesCache = null;
let _customFetchPromise = null;

/**
 * Template Gallery: horizontal cards (uniform size, name below, no category).
 * First card: "Custom Template" – opens upload modal to create a user template.
 * Then user's custom templates, then system templates.
 * Each card has a preview icon; clicking the card uses the template (opens draft).
 */
const TemplateWizardGallery = ({ onTemplateClick }) => {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState(_templatesCache ?? []);
  const [customTemplates, setCustomTemplates] = useState(_customTemplatesCache ?? []);
  const [isLoading, setIsLoading] = useState(_templatesCache === null);
  const [customLoading, setCustomLoading] = useState(_customTemplatesCache === null);
  const [error, setError] = useState(null);
  const [previewTemplate, setPreviewTemplate] = useState(null);
  const scrollContainerRef = useRef(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  const loadCustomTemplates = useCallback(async (force = false) => {
    if (!force && _customTemplatesCache !== null) {
      setCustomTemplates(_customTemplatesCache);
      setCustomLoading(false);
      return;
    }
    // Reuse in-flight fetch (StrictMode double-invoke guard)
    if (!force && _customFetchPromise) {
      try { setCustomTemplates((await _customFetchPromise) ?? []); } catch { /* service may be offline */ }
      setCustomLoading(false);
      return;
    }
    setCustomLoading(true);
    // Assign before first await so the second StrictMode invocation sees it
    _customFetchPromise = customTemplateApi.getUserTemplates(true);
    try {
      const list = await _customFetchPromise;
      const result = Array.isArray(list) ? list : [];
      _customTemplatesCache = result;
      setCustomTemplates(result);
    } catch (err) {
      // Template analyzer service may not be running locally — fail silently
      setCustomTemplates(_customTemplatesCache ?? []);
    } finally {
      _customFetchPromise = null;
      setCustomLoading(false);
    }
  }, []);

  useEffect(() => {
    if (_templatesCache !== null) {
      setTemplates(_templatesCache);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    // Start the fetch only if none is in-flight; otherwise share the promise.
    // This prevents React StrictMode from firing two identical network requests.
    if (!_templatesFetchPromise) {
      _templatesFetchPromise = fetchTemplates({
        category: '', is_active: true, limit: 50, offset: 0,
        include_preview_url: true, finalized_only: true,
      }).then(res => {
        const tpls = res?.success && Array.isArray(res.templates) ? res.templates : [];
        _templatesCache = tpls;
        return tpls;
      }).catch(err => {
        throw err;
      }).finally(() => { _templatesFetchPromise = null; });
    }

    _templatesFetchPromise
      .then(tpls => { if (!cancelled) { setTemplates(tpls); setIsLoading(false); } })
      .catch(err => { if (!cancelled) { setError(err.message || 'Failed to load templates'); setTemplates(_templatesCache ?? []); setIsLoading(false); } });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    loadCustomTemplates(false);
  }, [loadCustomTemplates]);

  const checkScrollButtons = () => {
    if (!scrollContainerRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
    setShowLeftArrow(scrollLeft > 0);
    setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
  };

  useEffect(() => {
    checkScrollButtons();
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', checkScrollButtons);
      window.addEventListener('resize', checkScrollButtons);
      return () => {
        container.removeEventListener('scroll', checkScrollButtons);
        window.removeEventListener('resize', checkScrollButtons);
      };
    }
  }, [templates, customTemplates]);

  const scroll = (direction) => {
    if (!scrollContainerRef.current) return;
    const scrollAmount = 200;
    const currentScroll = scrollContainerRef.current.scrollLeft;
    scrollContainerRef.current.scrollTo({
      left: currentScroll + (direction === 'right' ? scrollAmount : -scrollAmount),
      behavior: 'smooth',
    });
  };

  const handleCardClick = (template) => {
    const normalized = {
      ...template,
      id: template.template_id || template.id,
    };
    onTemplateClick?.(normalized);
  };

  const handlePreviewClick = (template) => {
    setPreviewTemplate(template);
  };

  const handleDeleteCustomTemplate = async (template) => {
    const name = template.name || template.title || 'this template';
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await customTemplateApi.deleteTemplate(template.id);
      _customTemplatesCache = null;
      toast.success('Template deleted.');
      loadCustomTemplates(true);
    } catch (err) {
      toast.error('Failed to delete template. Please try again.');
      console.error('Delete custom template failed:', err);
    }
  };

  const handleCustomTemplateUploadSuccess = () => {
    toast.success('Custom template created. It will appear in the gallery.');
    _customTemplatesCache = null; // invalidate cache so fresh list is fetched
    loadCustomTemplates(true);
  };

  /** Normalize custom template for TemplateWizardCard (expects preview_image_url / name / title) */
  const toGalleryItem = (t) => ({
    ...t,
    id: t.id,
    template_id: t.id,
    name: t.name,
    title: t.name,
    preview_image_url: t.imageUrl,
  });


  if (error) {
    return (
      <div className="template-wizard-gallery template-wizard-gallery__empty">
        <DocumentTextIcon className="template-wizard-gallery__empty-icon" />
        <p className="text-gray-600">{error}</p>
      </div>
    );
  }

  return (
    <>
      <div className="template-wizard-gallery template-wizard-gallery--has-items">
        {showLeftArrow && (
          <button
            type="button"
            onClick={() => scroll('left')}
            className="template-wizard-gallery__arrow template-wizard-gallery__arrow--left"
            aria-label="Scroll left"
          >
            <ChevronLeftIcon className="w-6 h-6 text-gray-700" />
          </button>
        )}

        <div
          ref={scrollContainerRef}
          className="template-wizard-gallery__scroll template-wizard-gallery__scroll--hide-bar"
        >
          {/* Custom Template: open upload modal to create your own template */}
          <button
            type="button"
            onClick={() => setUploadModalOpen(true)}
            className="template-wizard-card template-wizard-card--blank group flex-shrink-0 w-full h-full min-h-0 bg-white rounded-lg border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.08)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.1)] hover:border-gray-300 transition-all duration-300 cursor-pointer overflow-hidden flex flex-col text-left focus:outline-none"
          >
            <div className="relative flex-1 min-h-0 w-full overflow-hidden bg-white flex items-center justify-center">
              <svg className="w-16 h-16 group-hover:scale-110 transition-transform duration-300" viewBox="0 0 36 36">
                <path fill="#34A853" d="M16 16v14h4V20z" />
                <path fill="#4285F4" d="M30 16H20l-4 4h14z" />
                <path fill="#FBBC05" d="M6 16v4h10l4-4z" />
                <path fill="#EA4335" d="M20 16V6h-4v14z" />
              </svg>
            </div>
            <div className="p-2.5 flex-shrink-0 bg-white border-t border-gray-100 text-center">
              <h3 className="text-sm font-medium text-gray-800 truncate tracking-tight block w-full">
                Custom Template
              </h3>
            </div>
          </button>

          {/* Generate with AI card */}
          <button
            type="button"
            onClick={() => navigate('/build-template')}
            className="template-wizard-card template-wizard-card--blank group flex-shrink-0 w-full h-full min-h-0 rounded-lg border border-blue-200 shadow-[0_2px_8px_rgba(66,99,235,0.10)] hover:shadow-[0_6px_20px_rgba(66,99,235,0.18)] hover:border-blue-400 transition-all duration-300 cursor-pointer overflow-hidden flex flex-col text-left focus:outline-none"
            style={{ background: 'linear-gradient(145deg, #EBF4FF 0%, #EDE9FE 100%)' }}
          >
            <div className="relative flex-1 min-h-0 w-full overflow-hidden flex items-center justify-center">
              <div className="flex flex-col items-center gap-1">
                <span className="text-3xl group-hover:scale-110 transition-transform duration-300 leading-none">✨</span>
                <span className="text-xs font-semibold text-indigo-600 opacity-80">AI</span>
              </div>
            </div>
            <div className="p-2.5 flex-shrink-0 border-t border-blue-100 text-center" style={{ background: 'rgba(255,255,255,0.7)' }}>
              <h3 className="text-sm font-semibold text-indigo-700 truncate tracking-tight block w-full">
                Generate Template
              </h3>
            </div>
          </button>

          {/* User's custom templates */}
          {customLoading ? (
            [1].map((i) => (
              <div key={`custom-skel-${i}`} className="template-wizard-gallery__skeleton" />
            ))
          ) : (
            customTemplates.map((t) => (
              <TemplateWizardCard
                key={`custom-${t.id}`}
                template={toGalleryItem(t)}
                onClick={handleCardClick}
                onPreviewClick={handlePreviewClick}
                onDelete={handleDeleteCustomTemplate}
              />
            ))
          )}

          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-8 px-4 min-w-[200px]">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-gray-200 border-t-[#21C1B6]" aria-hidden="true" />
              <p className="text-sm font-medium text-gray-500">Loading templates…</p>
            </div>
          ) : templates.length === 0 ? (
            <div className="flex items-center px-4 text-gray-500 text-sm">
              No templates available.
            </div>
          ) : (
            templates.map((template) => (
              <TemplateWizardCard
                key={template.template_id || template.id}
                template={template}
                onClick={handleCardClick}
                onPreviewClick={handlePreviewClick}
              />
            ))
          )}
        </div>

        {showRightArrow && (
          <button
            type="button"
            onClick={() => scroll('right')}
            className="template-wizard-gallery__arrow template-wizard-gallery__arrow--right"
            aria-label="Scroll right"
          >
            <ChevronRightIcon className="w-6 h-6 text-gray-700" />
          </button>
        )}
      </div>

      {/* Preview popup — only when user clicks the preview icon on a card */}
      <TemplatePreviewPopup
        template={previewTemplate}
        onClose={() => setPreviewTemplate(null)}
      />

      {/* Upload custom template modal */}
      <CustomTemplateUploadModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onUploadSuccess={handleCustomTemplateUploadSuccess}
      />
    </>
  );
};

export default TemplateWizardGallery;
