import React, { useState } from 'react';
import { DocumentTextIcon, EyeIcon, TrashIcon } from '@heroicons/react/24/outline';

/** True if URL is suitable for <img> (not HTML content or data:text/html). */
const isImageUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (u.startsWith('data:text/html')) return false;
  if (u.startsWith('data:') && !u.startsWith('data:image/')) return false;
  if (u.startsWith('<') || u.includes('</')) return false;
  return u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:image/');
};

/**
 * Single template card: preview image, name below (no category).
 * Optional preview icon on the right; clicking it opens preview popup (does not use template).
 * Clicking the card uses the template.
 */
const TemplateWizardCard = ({ template, onClick, onPreviewClick, onDelete }) => {
  const { name, preview_image_url, image_url } = template;
  const imageUrl = preview_image_url || image_url;
  const [imageError, setImageError] = useState(false);
  const showImage = imageUrl && isImageUrl(imageUrl) && !imageError;

  const handleCardClick = () => onClick(template);
  const handlePreviewClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onPreviewClick?.(template);
  };

  const handleDeleteClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete?.(template);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      }}
      className="template-wizard-card group flex-shrink-0 w-full h-full min-h-0 bg-white rounded-lg border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.08)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.1)] hover:border-gray-300 transition-all duration-300 cursor-pointer overflow-hidden flex flex-col text-left focus:outline-none"
    >
      {/* Preview area with preview icon on the right */}
      <div className="relative flex-1 min-h-0 w-full overflow-hidden bg-white">
        {showImage ? (
          <img
            src={imageUrl}
            alt={name || 'Template preview'}
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
            <DocumentTextIcon className="w-14 h-14 text-gray-300" aria-hidden />
          </div>
        )}
        {onPreviewClick && (
          <button
            type="button"
            onClick={handlePreviewClick}
            className="template-wizard-card__preview-btn"
            title="Preview"
            aria-label="Preview template"
          >
            <EyeIcon className="w-5 h-5" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={handleDeleteClick}
            className="absolute bottom-2 left-2 p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-all opacity-0 group-hover:opacity-100 z-10 bg-white/80 border border-gray-100"
            title="Delete template"
            aria-label="Delete template"
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Footer: template name only (no category) */}
      <div className="p-2.5 flex-shrink-0 bg-white border-t border-gray-100 text-center">
        <h3 className="text-sm font-medium text-gray-800 truncate tracking-tight block w-full">
          {name || template.title || 'Untitled template'}
        </h3>
      </div>
    </div>
  );
};

export default TemplateWizardCard;
