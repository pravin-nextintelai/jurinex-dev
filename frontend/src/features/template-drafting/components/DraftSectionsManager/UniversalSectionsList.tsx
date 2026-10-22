
import React, { useState, useEffect } from 'react';
import { UniversalSection, SectionCustomization } from '../constants';
import { getUniversalSections } from '../../services/universalSectionsApi';
import { Edit2, Trash2, RotateCcw, Save, X } from 'lucide-react';

interface UniversalSectionsListProps {
    customizations: Record<string, SectionCustomization>;
    onUpdateCustomization: (sectionId: string, customization: SectionCustomization) => void;
}

export const UniversalSectionsList: React.FC<UniversalSectionsListProps> = ({ customizations, onUpdateCustomization }) => {
    const [sections, setSections] = useState<UniversalSection[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editPrompt, setEditPrompt] = useState('');

    useEffect(() => {
        getUniversalSections().then(setSections);
    }, []);

    const handleEditStart = (section: UniversalSection) => {
        const currentCustom = customizations[section.id];
        setEditPrompt(currentCustom?.customPrompt || section.defaultPrompt);
        setEditingId(section.id);
    };

    const handleEditSave = (sectionId: string) => {
        const current = customizations[sectionId] || { sectionId, isDeleted: false };
        onUpdateCustomization(sectionId, {
            ...current,
            customPrompt: editPrompt
        });
        setEditingId(null);
    };

    const handleEditCancel = () => {
        setEditingId(null);
        setEditPrompt('');
    };

    const handleDeleteToggle = (sectionId: string) => {
        const current = customizations[sectionId] || { sectionId, customPrompt: undefined, isDeleted: false };
        onUpdateCustomization(sectionId, {
            ...current,
            isDeleted: !current.isDeleted
        });
    };

    return (
        <div className="space-y-4 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Universal Legal Sections</h3>
            <div className="space-y-3">
                {sections.map((section) => {
                    const custom = customizations[section.id];
                    const isDeleted = custom?.isDeleted;
                    const displayPrompt = custom?.customPrompt || section.defaultPrompt;
                    const isEditing = editingId === section.id;

                    return (
                        <div
                            key={section.id}
                            className={`p-3 border rounded-md transition-colors ${isDeleted ? 'bg-gray-50 border-gray-200 opacity-60' : 'bg-white border-gray-200 hover:border-blue-300'
                                }`}
                        >
                            <div className="flex justify-between items-start mb-2">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className={`font-medium ${isDeleted ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                                            {section.title}
                                        </span>
                                        {isDeleted && <span className="text-xs text-red-500 font-semibold">(Skipped)</span>}
                                        {custom?.customPrompt && !isEditing && !isDeleted && (
                                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">Custom Prompt</span>
                                        )}
                                    </div>
                                    <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>
                                </div>
                                <div className="flex gap-2">
                                    {!isDeleted && !isEditing && (
                                        <button
                                            onClick={() => handleEditStart(section)}
                                            className="p-1 text-gray-400 hover:text-blue-600 rounded transition-colors"
                                            title="Edit Prompt"
                                        >
                                            ✏️
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleDeleteToggle(section.id)}
                                        className={`p-1 rounded transition-colors ${isDeleted ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:text-red-600'
                                            }`}
                                        title={isDeleted ? "Restore Section" : "Remove Section"}
                                    >
                                        {isDeleted ? '↩️' : '🗑️'}
                                    </button>
                                </div>
                            </div>

                            {/* Sub-items List */}
                            {!isDeleted && section.subItems.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-2">
                                    {section.subItems.map((item, idx) => (
                                        <span key={idx} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                                            {item}
                                        </span>
                                    ))}
                                </div>
                            )}

                            {/* Prompt Display or Edit Mode */}
                            {!isDeleted && (
                                <div className="mt-3 text-sm">
                                    {isEditing ? (
                                        <div className="space-y-2">
                                            <label className="block text-xs font-semibold text-gray-700">Content Generation Prompt</label>
                                            <textarea
                                                value={editPrompt}
                                                onChange={(e) => setEditPrompt(e.target.value)}
                                                className="w-full p-2 border border-blue-300 rounded focus:ring-2 focus:ring-blue-100 focus:outline-none text-sm"
                                                rows={3}
                                            />
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={handleEditCancel}
                                                    className="px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    onClick={() => handleEditSave(section.id)}
                                                    className="px-3 py-1 text-xs bg-blue-600 text-white hover:bg-blue-700 rounded"
                                                >
                                                    Save Prompt
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="bg-gray-50 p-2 rounded text-gray-600 italic border border-gray-100">
                                            "{displayPrompt}"
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
