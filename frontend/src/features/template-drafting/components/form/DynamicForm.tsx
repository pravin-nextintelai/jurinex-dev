/**
 * Template Drafting Component - Dynamic Form
 * Schema-driven form generator
 */

import React, { useEffect, useMemo, useRef, useCallback } from 'react';
import { FormField } from './FormField';
import { useDraftStore } from '../../store/draftStore';
import { debounce } from '../../utils/debounce';
import { validateForm, getFieldError, type ValidationError } from '../../utils/validation';
import { updateBlockValueInDom } from '../../utils/domAnchors';
import { Logger } from '../../utils/logger';
import { UniversalSectionsList } from '../DraftSectionsManager';
import { draftApi } from '../../services';
import type { SectionCustomization } from '../constants';
import type { TemplateField } from '../../types';

export const DynamicForm: React.FC = () => {
    const schema = useDraftStore(state => state.schema);
    const formData = useDraftStore(state => state.formData);
    const formDirty = useDraftStore(state => state.formDirty);
    const isSaving = useDraftStore(state => state.isSaving);
    const canUndo = useDraftStore(state => state.canUndo);
    const canRedo = useDraftStore(state => state.canRedo);
    const blocks = useDraftStore(state => state.blocks);
    const draftId = useDraftStore(state => state.draftId); // Get draftId

    const updateField = useDraftStore(state => state.updateField);
    const saveFields = useDraftStore(state => state.saveFields);
    const undo = useDraftStore(state => state.undo);
    const redo = useDraftStore(state => state.redo);

    const [validationErrors, setValidationErrors] = React.useState<ValidationError[]>([]);

    // Section Customizations State
    const [sectionCustomizations, setSectionCustomizations] = React.useState<Record<string, SectionCustomization>>({});

    // Load section prompts
    useEffect(() => {
        if (!draftId) return;
        draftApi.getSectionPrompts(draftId).then((prompts) => {
            const map: Record<string, SectionCustomization> = {};
            if (Array.isArray(prompts)) {
                prompts.forEach((p: any) => {
                    map[p.section_id] = {
                        sectionId: p.section_id,
                        customPrompt: p.custom_prompt,
                        isDeleted: p.is_deleted
                    };
                });
            }
            setSectionCustomizations(map);
        }).catch(err => Logger.error('Failed to load section prompts', { error: String(err) }));
    }, [draftId]);

    const handleUpdateCustomization = async (sectionId: string, customization: SectionCustomization) => {
        // Optimistic update
        setSectionCustomizations(prev => ({ ...prev, [sectionId]: customization }));

        if (draftId) {
            try {
                await draftApi.saveSectionPrompt(draftId, sectionId, {
                    customPrompt: customization.customPrompt,
                    isDeleted: customization.isDeleted
                });
            } catch (err) {
                Logger.error('Failed to save section prompt', err);
                // Revert or show error? For now just log.
            }
        }
    };

    // Debounced save function (2 seconds)
    const debouncedSave = useMemo(
        () => debounce(() => {
            saveFields();
        }, 2000),
        [saveFields]
    );

    // Handle field change with DOM update and debounced save
    const handleFieldChange = useCallback((key: string, value: string | number | null) => {
        // 1. Update store (immediate)
        updateField(key, value);

        // 2. Update DOM directly for instant preview (50ms debounce is handled internally)
        const block = blocks.find(b => b.key === key);
        if (block) {
            const pageNo = block.content.pageNo ?? 1;
            updateBlockValueInDom(key, pageNo, value);
        }

        // 3. Trigger debounced save
        debouncedSave();
    }, [updateField, blocks, debouncedSave]);

    // Validate on formData change
    useEffect(() => {
        if (schema?.fields) {
            const result = validateForm(schema.fields, formData);
            setValidationErrors(result.errors);
        }
    }, [formData, schema]);

    // Save on unmount if dirty
    useEffect(() => {
        return () => {
            debouncedSave.flush();
        };
    }, [debouncedSave]);

    // Keyboard shortcuts for undo/redo
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                if (e.shiftKey) {
                    // Redo
                    e.preventDefault();
                    if (canRedo) {
                        redo();
                    }
                } else {
                    // Undo
                    e.preventDefault();
                    if (canUndo) {
                        undo();
                    }
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [canUndo, canRedo, undo, redo]);

    // If no schema fields, still show sections list if available
    const showFields = schema && schema.fields && schema.fields.length > 0;

    const getSaveStatusText = () => {
        if (isSaving) return 'Saving...';
        if (formDirty) return 'Unsaved changes';
        return 'All changes saved';
    };

    const getSaveStatusClass = () => {
        if (isSaving) return 'form-panel__save-status--saving';
        if (formDirty) return 'form-panel__save-status--dirty';
        return 'form-panel__save-status--saved';
    };

    return (
        <div className="form-panel">
            <div className="form-panel__header">
                <h3 className="form-panel__title">Draft Content</h3>
                <p className="form-panel__subtitle">
                    Manage the document sections and fields.
                </p>
            </div>

            <div className="form-panel__content space-y-6">
                {/* Universal Sections Manager */}
                <div className="mb-6">
                    <UniversalSectionsList
                        customizations={sectionCustomizations}
                        onUpdateCustomization={handleUpdateCustomization}
                    />
                </div>

                {/* Form Fields (if any) */}
                {showFields && (
                    <div className="mt-6 border-t pt-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">Template Fields</h4>
                        {schema.fields.map((field: TemplateField) => (
                            <FormField
                                key={field.key}
                                field={field}
                                value={formData[field.key] ?? null}
                                error={getFieldError(validationErrors, field.key)}
                                onChange={handleFieldChange}
                            />
                        ))}
                    </div>
                )}

                {!showFields && (
                    <div className="mt-4 p-4 bg-gray-50 text-gray-500 text-sm text-center rounded">
                        No additional template fields.
                    </div>
                )}
            </div>

            <div className="form-panel__footer">
                <span className={`form-panel__save-status ${getSaveStatusClass()}`}>
                    {isSaving ? (
                        <span className="loading-spinner" style={{ width: 14, height: 14 }} />
                    ) : formDirty ? (
                        '●'
                    ) : (
                        '✓'
                    )}
                    {getSaveStatusText()}
                </span>

                <div className="form-panel__actions">
                    <button
                        className="form-panel__action-btn"
                        onClick={() => undo()}
                        disabled={!canUndo}
                        title="Undo (Ctrl+Z)"
                    >
                        ↩
                    </button>
                    <button
                        className="form-panel__action-btn"
                        onClick={() => redo()}
                        disabled={!canRedo}
                        title="Redo (Ctrl+Shift+Z)"
                    >
                        ↪
                    </button>
                </div>
            </div>
        </div>
    );
};
