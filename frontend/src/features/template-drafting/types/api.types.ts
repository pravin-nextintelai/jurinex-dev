/**
 * Template Drafting Component - Type Definitions
 * Evidence and API-related interfaces
 */

export interface EvidenceFile {
    id: string;
    originalName?: string; // Display name (from user upload)
    original_name?: string; // DB raw column (snake_case)
    fileName: string; // Internal/GCS filename
    mimeType: string;
    fileSize: number;
    extractMethod?: string;
    extractCharacterCount?: number;
    extractMeta?: {
        pageCount?: number;
        status?: string;
        [key: string]: any;
    };
    createdAt: string;
}

export interface EvidenceUploadResponse {
    success: boolean;
    evidence: EvidenceFile;
}

export interface EvidenceListResponse {
    success: boolean;
    count: number;
    evidence: EvidenceFile[];
}

export interface ExportResponse {
    success: boolean;
    downloadUrl: string;
    fileName: string;
    expiresIn: string;
    renderId: string;
}

export interface FinalizeResponse {
    success: boolean;
    message: string;
    draftId: string;
}

export interface ApiError {
    success: false;
    code: string;
    message: string;
    details?: any;
}

export enum ErrorCategory {
    API_FAILURE = 'API_FAILURE',
    RENDER_ERROR = 'RENDER_ERROR',
    MISSING_BLOCK = 'MISSING_BLOCK',
    BACKEND_MISMATCH = 'BACKEND_MISMATCH',
    PERFORMANCE_THRESHOLD = 'PERFORMANCE_THRESHOLD',
    VALIDATION_ERROR = 'VALIDATION_ERROR'
}

export interface AppError {
    category: ErrorCategory;
    message: string;
    code?: string;
    details?: any;
    recoverable: boolean;
}
