import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, FunnelIcon } from '@heroicons/react/24/outline';
import { DocumentTextIcon } from '@heroicons/react/24/solid';
import { fetchTemplates } from '../../components/TemplateWizard/templateWizardApi';
import TemplateWizardCard from '../../components/TemplateWizard/TemplateWizardCard';
import TemplatePreviewPopup from '../../components/TemplateWizard/TemplatePreviewPopup';
import { customTemplateApi, CustomTemplateUploadModal } from '@/features/template-drafting';
import '../../components/TemplateWizard/TemplateWizardGallery.css';
import { createDraft } from '../../api/draftFormApi';
import { toast } from 'react-toastify';

const ALL_CATEGORIES_VALUE = '';

/**
 * All templates page with category filter.
 * Fetches templates from agent-draft API; filter by category refetches with that category.
 */
const AllTemplatesPage = () => {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [customTemplates, setCustomTemplates] = useState([]);
  const [customLoading, setCustomLoading] = useState(true);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORIES_VALUE);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState(null);
  const [error, setError] = useState(null);

  const loadCustomTemplates = useCallback(async () => {
    setCustomLoading(true);
    try {
      const list = await customTemplateApi.getUserTemplates();
      setCustomTemplates(Array.isArray(list) ? list : []);
    } catch (err) {
      console.warn('Failed to load custom templates:', err);
      setCustomTemplates([]);
    } finally {
      setCustomLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCustomTemplates();
  }, [loadCustomTemplates]);

  const loadTemplates = useCallback(async (category) => {
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetchTemplates({
        category: category || '',
        is_active: true,
        limit: 100,
        offset: 0,
        include_preview_url: true,
      });
      if (res?.success && Array.isArray(res.templates)) {
        setTemplates(res.templates);
        if (category === ALL_CATEGORIES_VALUE) {
          const unique = [...new Set(res.templates.map((t) => t.category).filter(Boolean))].sort();
          setCategories(unique);
        }
      } else {
        setTemplates([]);
      }
    } catch (err) {
      setError(err.message || 'Failed to load templates');
      setTemplates([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates(selectedCategory);
  }, [selectedCategory, loadTemplates]);

  const handleTemplateClick = async (template) => {
    const templateId = template.id ?? template.template_id;
    const templateName = template.name ?? template.title;
    if (!templateId) return;
    try {
      setIsCreatingDraft(true);
      // Always create a new draft from the templates list so the user gets a clean form (no case, no field values).
      const res = await createDraft(templateId, templateName ? `${templateName} - Draft` : '');
      const draftId = res?.draft?.draft_id;
      if (draftId) {
        navigate(`/draft-form/${draftId}`);
      } else {
        toast.error('Draft created but no draft ID returned.');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to open template. Please try again.');
    } finally {
      setIsCreatingDraft(false);
    }
  };

  const handleCardClick = (template) => {
    const normalized = { ...template, id: template.template_id || template.id };
    handleTemplateClick(normalized);
  };

  const toGalleryItem = (t) => ({
    ...t,
    id: t.id,
    template_id: t.id,
    name: t.name,
    title: t.name,
    preview_image_url: t.imageUrl,
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100/80">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <button
          type="button"
          onClick={() => navigate('/draft-selection')}
          className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-[#21C1B6] mb-8 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#21C1B6] rounded-md"
        >
          <ArrowLeftIcon className="w-4 h-4 mr-1.5" />
          Back to Document Drafting
        </button>

        {/* My templates (custom) */}
        <div className="mb-10 p-6 rounded-2xl bg-white border border-gray-200/80 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">My templates</h2>
              <p className="text-sm text-gray-600 mt-0.5">Templates you created. Upload a document or generate one with AI.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => navigate('/build-template')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 shadow-sm"
              >
                <span>✨</span>
                Generate with AI
              </button>
              <button
                type="button"
                onClick={() => setUploadModalOpen(true)}
                className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#21C1B6] hover:bg-[#1AA49B] focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#21C1B6]"
              >
                Upload custom template
              </button>
            </div>
          </div>
          {customLoading ? (
            <div className="flex gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex-shrink-0 w-64 h-48 bg-gray-100 animate-pulse rounded-lg" />
              ))}
            </div>
          ) : customTemplates.length === 0 ? (
            <div className="py-6 flex flex-col items-center gap-4 text-center">
              <p className="text-sm text-gray-500">No custom templates yet.</p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => navigate('/build-template')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm"
                >
                  <span>✨</span> Generate with AI
                </button>
                <span className="text-xs text-gray-400">or</span>
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-[#21C1B6] border border-[#21C1B6] hover:bg-teal-50"
                >
                  Upload a file
                </button>
              </div>
            </div>
          ) : (
            <div className="template-wizard-gallery__uniform-grid">
              {customTemplates.map((t) => (
                <TemplateWizardCard
                  key={`custom-${t.id}`}
                  template={toGalleryItem(t)}
                  onClick={handleCardClick}
                  onPreviewClick={(tmpl) => setPreviewTemplate(tmpl)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">All templates</h1>
          <p className="text-sm text-gray-600 mt-1">Filter by category to find the template you need.</p>
        </div>

        {/* Category filter */}
        <div className="mb-8 flex flex-wrap items-center gap-3 p-4 rounded-xl bg-white border border-gray-200/80 shadow-sm">
          <label htmlFor="category-filter" className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
            <FunnelIcon className="w-4 h-4 text-[#21C1B6]" />
            Filter by category
          </label>
          <select
            id="category-filter"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-[#21C1B6] focus:ring-2 focus:ring-[#21C1B6]/20 min-w-[200px]"
          >
            <option value={ALL_CATEGORIES_VALUE}>All categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 rounded-2xl bg-white/80 border border-gray-200/80 shadow-sm">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-gray-200 border-t-[#21C1B6]" />
            <p className="text-sm font-medium text-gray-500 mt-4">Loading templates…</p>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center shadow-sm">
            <DocumentTextIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600">{error}</p>
          </div>
        ) : templates.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center shadow-sm">
            <DocumentTextIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600">
              {selectedCategory ? `No templates in category "${selectedCategory}".` : 'No templates available.'}
            </p>
          </div>
        ) : (
          <div className="template-wizard-gallery__uniform-grid">
            {templates.map((template) => (
              <TemplateWizardCard
                key={template.template_id || template.id}
                template={template}
                onClick={handleCardClick}
                onPreviewClick={(t) => setPreviewTemplate(t)}
              />
            ))}
          </div>
        )}

        <TemplatePreviewPopup
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
        />

        <CustomTemplateUploadModal
          isOpen={uploadModalOpen}
          onClose={() => setUploadModalOpen(false)}
          onUploadSuccess={() => {
            toast.success('Custom template created.');
            loadCustomTemplates();
          }}
        />

        {isCreatingDraft && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl p-6 flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#21C1B6] border-t-transparent" />
              <p className="text-sm font-medium text-gray-700">Opening template…</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AllTemplatesPage;
