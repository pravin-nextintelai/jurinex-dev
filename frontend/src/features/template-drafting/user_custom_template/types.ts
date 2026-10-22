import type { TemplateListItem } from '../types';

export interface CustomTemplateCardProps {
    template: TemplateListItem;
    onClick: (template: TemplateListItem) => void;
    onDelete: (templateId: string) => void;
    onUpdate: () => void;
}

export interface CustomTemplateUploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onUploadSuccess: () => void;
}

export interface UploadTemplateResponse {
    status: string;
    template_id: string;
    image_url?: string;
    message: string;
}
