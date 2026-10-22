/**
 * Template Drafting Component - Validation Utilities
 */

import type { TemplateField } from '../types';

export interface ValidationError {
    key: string;
    message: string;
}

export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
}

/**
 * Validate a single field value against its schema
 */
export const validateField = (
    field: TemplateField,
    value: any
): string | null => {
    // Required check
    if (field.required && (value === null || value === undefined || value === '')) {
        return `${field.label} is required`;
    }

    // Skip further validation if empty and not required
    if (value === null || value === undefined || value === '') {
        return null;
    }

    // Type-specific validation
    switch (field.type) {
        case 'string':
        case 'textarea':
            if (typeof value !== 'string') {
                return `${field.label} must be text`;
            }
            if (field.maxLength && value.length > field.maxLength) {
                return `${field.label} must be at most ${field.maxLength} characters`;
            }
            break;

        case 'number':
        case 'integer':
            const numValue = field.type === 'integer' ? parseInt(value) : parseFloat(value);
            if (isNaN(numValue)) {
                return `${field.label} must be a valid number`;
            }
            if (field.type === 'integer' && !Number.isInteger(numValue)) {
                return `${field.label} must be a whole number`;
            }
            if (field.min !== undefined && numValue < field.min) {
                return `${field.label} must be at least ${field.min}`;
            }
            if (field.max !== undefined && numValue > field.max) {
                return `${field.label} must be at most ${field.max}`;
            }
            break;

        case 'date':
            if (isNaN(Date.parse(value))) {
                return `${field.label} must be a valid date`;
            }
            break;
    }

    return null;
};

/**
 * Validate all form fields against schema
 */
export const validateForm = (
    fields: TemplateField[],
    values: Record<string, any>
): ValidationResult => {
    const errors: ValidationError[] = [];

    for (const field of fields) {
        const value = values[field.key];
        const error = validateField(field, value);

        if (error) {
            errors.push({ key: field.key, message: error });
        }
    }

    return {
        isValid: errors.length === 0,
        errors
    };
};

/**
 * Get error for a specific field
 */
export const getFieldError = (
    errors: ValidationError[],
    key: string
): string | undefined => {
    return errors.find(e => e.key === key)?.message;
};
