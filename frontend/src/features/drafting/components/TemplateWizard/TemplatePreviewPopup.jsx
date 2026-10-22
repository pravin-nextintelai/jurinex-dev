import React, { useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { DocumentTextIcon } from '@heroicons/react/24/solid';

const isImageUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (u.startsWith('data:text/html')) return false;
  if (u.startsWith('data:') && !u.startsWith('data:image/')) return false;
  if (u.startsWith('<') || u.includes('</')) return false;
  return u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:image/');
};

/**
 * Modal that shows a template's preview image. Used when user clicks the preview icon on a card.
 */
const TemplatePreviewPopup = ({ template, onClose }) => {
  const [imageError, setImageError] = useState(false);
  if (!template) return null;

  const name = template.name || template.title || 'Template preview';
  const previewUrl = template.preview_image_url || template.image_url;
  const showImage = previewUrl && isImageUrl(previewUrl) && !imageError;

  return (
    <div
      className="template-wizard-gallery__popup-overlay"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Template preview"
    >
      <div
        className="template-wizard-gallery__popup"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="template-wizard-gallery__popup-close"
          aria-label="Close"
        >
          <XMarkIcon className="w-6 h-6" />
        </button>
        <h3 className="template-wizard-gallery__popup-title">{name}</h3>
        <div className="template-wizard-gallery__popup-body">
          {showImage ? (
            <img
              src={previewUrl}
              alt={name}
              className="template-wizard-gallery__popup-img"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="template-wizard-gallery__popup-placeholder">
              <DocumentTextIcon className="template-wizard-gallery__popup-placeholder-icon" aria-hidden />
              <p className="text-gray-500 text-sm mt-2">No preview available</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TemplatePreviewPopup;
