import React, { useState, useEffect } from "react";
import {
  Edit3,
  Scale,
  Briefcase,
  Shield,
  Loader,
  FileText,
  AlertCircle,
  Check,
} from "lucide-react";
import ApiService from "@/shared/api/api";

const Templates = ({ onSelectTemplate, query = "" }) => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [processingTemplateId, setProcessingTemplateId] = useState(null);
  const [previews, setPreviews] = useState({});

  const getCategoryIcon = (category) => {
    switch ((category || "").toLowerCase()) {
      case "legal":
        return <Scale className="w-3 h-3 text-blue-600" />;
      case "business":
        return <Briefcase className="w-3 h-3 text-purple-600" />;
      case "confidentiality":
        return <Shield className="w-3 h-3 text-emerald-600" />;
      default:
        return <FileText className="w-3 h-3 text-slate-600" />;
    }
  };

  const getCategoryColor = (category) => {
    switch ((category || "").toLowerCase()) {
      case "legal":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "business":
        return "bg-purple-50 text-purple-700 border-purple-200";
      case "confidentiality":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      default:
        return "bg-slate-50 text-slate-700 border-slate-200";
    }
  };

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        setLoading(true);
        const data = await ApiService.getDraftingTemplates();
        const templatesArray = Array.isArray(data)
          ? data
          : data.templates || data.data || [];
        const transformed = templatesArray.map((template) => ({
          ...template,
          icon: getCategoryIcon(template.category),
          isEditable: true,
          isBackendTemplate: true,
        }));
        setTemplates(transformed);
      } catch (err) {
        console.error("Fetch error:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchTemplates();
  }, []);

  const fetchPreview = async (templateId) => {
    if (previews[templateId]) return;
    try {
      const res = await ApiService.openTemplateForEditing(templateId);
      setPreviews((prev) => ({
        ...prev,
        [templateId]: res.html || "<p>No preview available</p>",
      }));
    } catch (err) {
      console.error("Preview fetch error:", err);
      setPreviews((prev) => ({
        ...prev,
        [templateId]:
          "<p style='color: red; padding: 0.5rem;'>Failed to load preview</p>",
      }));
    }
  };

  const handleTemplateSelection = async (template) => {
    try {
      setProcessingTemplateId(template.id);
      const result = await ApiService.openTemplateForEditing(template.id);
      const enhancedTemplate = {
        ...template,
        content: result.html || "",
        fileName: result.name || template.name,
        isBackendTemplate: true,
      };
      onSelectTemplate(enhancedTemplate);
    } catch (error) {
      console.error("Template open error:", error);
      setError(`Failed to open template: ${error.message}`);
      onSelectTemplate({ ...template, content: template.content || "" });
    } finally {
      setProcessingTemplateId(null);
    }
  };

  const filteredTemplates = templates.filter((template) => {
    if (!query) return true;
    const search = query.toLowerCase();
    return (
      (template.name || "").toLowerCase().includes(search) ||
      (template.category || "").toLowerCase().includes(search) ||
      (template.type || "").toLowerCase().includes(search) ||
      (template.description || "").toLowerCase().includes(search)
    );
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl">
        <div className="relative">
          <Loader className="animate-spin w-8 h-8 text-blue-600" />
          <div className="absolute inset-0 w-8 h-8 border-2 border-blue-200 rounded-full animate-ping"></div>
        </div>
        <p className="mt-4 text-slate-600 font-medium">Loading templates...</p>
        <div className="mt-2 w-32 h-1 bg-slate-200 rounded-full overflow-hidden">
          <div className="w-full h-full bg-gradient-to-r from-blue-500 to-purple-500 animate-pulse"></div>
        </div>
      </div>
    );
  }

  if (error && filteredTemplates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-16 bg-gradient-to-br from-red-50 to-orange-50 rounded-xl border border-red-100">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8 text-red-600" />
        </div>
        <h3 className="text-lg font-semibold text-red-800 mb-2">Unable to Load Templates</h3>
        <p className="text-red-600 text-center mb-6 max-w-md">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-3 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-lg font-medium hover:from-red-700 hover:to-red-800 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredTemplates.map((template) => (
          <div
            key={template.id}
            className={`group relative bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-300 hover:shadow-xl hover:shadow-slate-200/50 hover:-translate-y-1 cursor-pointer ${
              processingTemplateId === template.id
                ? "opacity-60 pointer-events-none"
                : ""
            }`}
            onMouseEnter={() => fetchPreview(template.id)}
            onClick={() => handleTemplateSelection(template)}
          >
            {processingTemplateId === template.id && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center">
                <div className="flex flex-col items-center space-y-3">
                  <Loader className="animate-spin w-6 h-6 text-blue-600" />
                  <span className="text-sm font-medium text-slate-600">Opening...</span>
                </div>
              </div>
            )}

            {template.isBackendTemplate && (
              <div className="absolute top-3 right-3 z-20">
                <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg">
                  <Check className="w-4 h-4 text-white" />
                </div>
              </div>
            )}

            <div className="p-3 pb-2">
              <h3 className="font-semibold text-slate-800 text-xs leading-tight line-clamp-2 group-hover:text-blue-600 transition-colors">
                {template.fileName || template.name}
              </h3>
            </div>

            <div className="relative overflow-hidden bg-slate-50 mx-3 rounded-lg">
              <iframe
                title={template.name}
                srcDoc={
                  previews[template.id] ||
                  `<div style='display: flex; align-items: center; justify-content: center; height: 100%; padding: 1rem; color: #64748b; font-family: system-ui; text-align: center; font-size: 12px;'>
                    <div>
                      <div style='width: 32px; height: 32px; background: #f1f5f9; border-radius: 50%; margin: 0 auto 8px; display: flex; align-items: center; justify-content: center; font-size: 14px;'>📄</div>
                      <p>Loading preview...</p>
                    </div>
                  </div>`
                }
                className="w-full h-80 border-none bg-white rounded-lg"
                sandbox="allow-same-origin"
                scrolling="no"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            </div>

            <div className="p-3 pt-2">
              <div className="flex items-center gap-1 flex-wrap mb-2">
                {template.category && (
                  <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-medium ${getCategoryColor(template.category)}`}>
                    {getCategoryIcon(template.category)}
                    <span className="capitalize">{template.category}</span>
                  </div>
                )}
                {template.type && (
                  <div className="inline-flex items-center px-1.5 py-0.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-md text-[10px] font-medium">
                    {template.type}
                  </div>
                )}
              </div>

              {template.description && (
                <p className="text-[10px] text-slate-500 line-clamp-2">
                  {template.description}
                </p>
              )}
            </div>

            <div className="absolute inset-0 border-2 border-transparent group-hover:border-blue-200 rounded-2xl pointer-events-none transition-all duration-300"></div>
          </div>
        ))}
      </div>

      {filteredTemplates.length === 0 && !loading && !error && (
        <div className="flex flex-col items-center justify-center p-16 bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl">
          <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mb-4">
            <FileText className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-700 mb-2">No Templates Found</h3>
          <p className="text-slate-500 text-center max-w-md">
            {query ? `No templates match "${query}". Try adjusting your search.` : "No templates are available at the moment."}
          </p>
        </div>
      )}
    </div>
  );
};

export default Templates;