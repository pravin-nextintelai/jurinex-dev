/**
 * Template Drafting Component - Form Field
 * Individual form field with validation
 */

import React from 'react';
import type { TemplateField } from '../../types';

interface FormFieldProps {
    field: TemplateField;
    value: string | number | null;
    error?: string;
    onChange: (key: string, value: string | number | null) => void;
}

export const FormField: React.FC<FormFieldProps> = ({
    field,
    value,
    error,
    onChange
}) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        let newValue: string | number | null = e.target.value;

        // Convert to number for numeric types
        if (field.type === 'number' || field.type === 'integer') {
            if (e.target.value === '') {
                newValue = null;
            } else {
                newValue = field.type === 'integer'
                    ? parseInt(e.target.value)
                    : parseFloat(e.target.value);
            }
        }

        onChange(field.key, newValue);
    };

    const inputClassName = `form-field__input ${error ? 'form-field__input--error' : ''}`;

    const renderInput = () => {
        switch (field.type) {
            case 'textarea':
                return (
                    <textarea
                        id={`field-${field.key}`}
                        className={`${inputClassName} form-field__textarea`}
                        value={value ?? ''}
                        onChange={handleChange}
                        placeholder={`Enter ${field.label.toLowerCase()}`}
                        maxLength={field.maxLength}
                    />
                );

            case 'number':
            case 'integer':
                return (
                    <input
                        id={`field-${field.key}`}
                        type="number"
                        className={inputClassName}
                        value={value ?? ''}
                        onChange={handleChange}
                        placeholder={`Enter ${field.label.toLowerCase()}`}
                        min={field.min}
                        max={field.max}
                        step={field.type === 'integer' ? 1 : 'any'}
                    />
                );

            case 'date':
                return (
                    <input
                        id={`field-${field.key}`}
                        type="date"
                        className={inputClassName}
                        value={value?.toString() ?? ''}
                        onChange={handleChange}
                    />
                );

            case 'string':
            default:
                return (
                    <input
                        id={`field-${field.key}`}
                        type="text"
                        className={inputClassName}
                        value={value ?? ''}
                        onChange={handleChange}
                        placeholder={`Enter ${field.label.toLowerCase()}`}
                        maxLength={field.maxLength}
                    />
                );
        }
    };

    return (
        <div className="form-field">
            <label htmlFor={`field-${field.key}`} className="form-field__label">
                {field.label}
                {field.required && <span className="form-field__required">*</span>}
            </label>

            {renderInput()}

            {error && (
                <p className="form-field__error">
                    ⚠️ {error}
                </p>
            )}

            {field.maxLength && !error && (
                <p className="form-field__help">
                    Max {field.maxLength} characters
                </p>
            )}
        </div>
    );
};
