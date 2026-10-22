/**
 * Template Drafting Component - Category Filter
 */

import React from 'react';

interface TemplateCategoryFilterProps {
    categories: string[];
    selectedCategory: string | null;
    onCategoryChange: (category: string | null) => void;
}

export const TemplateCategoryFilter: React.FC<TemplateCategoryFilterProps> = ({
    categories,
    selectedCategory,
    onCategoryChange
}) => {
    if (categories.length === 0) {
        return null;
    }

    return (
        <div className="category-filter">
            <button
                className={`category-filter__item ${selectedCategory === null ? 'category-filter__item--active' : ''}`}
                onClick={() => onCategoryChange(null)}
            >
                All
            </button>

            {categories.map((category) => (
                <button
                    key={category}
                    className={`category-filter__item ${selectedCategory === category ? 'category-filter__item--active' : ''}`}
                    onClick={() => onCategoryChange(category)}
                >
                    {category}
                </button>
            ))}
        </div>
    );
};
