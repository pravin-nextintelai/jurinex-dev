// /**
//  * Template Drafting Component - Block Renderer
//  * Renders individual draft blocks within A4 pages
//  * Overlays mutable field values onto immutable layout structure
//  */

// import React from 'react';
// import { useDraftStore } from '../../store/draftStore';
// import { getBlockElementId, getFieldValueId } from '../../utils/domAnchors';
// import type { LayoutBlock } from '../../types';

// interface BlockRendererProps {
//     block: LayoutBlock;
//     pageNo: number;
// }

// /**
//  * Replaces runs of 3+ underscores with a styled blank line span.
//  */
// function renderWithBlankLines(text: string) {
//     const parts: React.ReactNode[] = [];
//     const re = /_{3,}/g;

//     let last = 0;
//     let m: RegExpExecArray | null;

//     while ((m = re.exec(text)) !== null) {
//         const start = m.index;
//         const end = start + m[0].length;

//         if (start > last) {
//             parts.push(<span key={`text-${last}`}>{text.slice(last, start)}</span>);
//         }

//         const runLen = m[0].length;
//         const width = Math.min(320, Math.max(60, runLen * 6));
//         parts.push(
//             <span
//                 key={`blank-${start}`}
//                 className="draft-blank-line"
//                 style={{ width: `${width}px` }}
//                 aria-hidden="true"
//             />
//         );

//         last = end;
//     }

//     if (last < text.length) {
//         parts.push(<span key={`text-${last}`}>{text.slice(last)}</span>);
//     }
//     return parts;
// }

// export const BlockRenderer: React.FC<BlockRendererProps> = React.memo(({ block, pageNo }) => {
//     const { key, content, id } = block;

//     // Subscribe to the specific field value for this block
//     const fieldValue = useDraftStore(state => state.fieldMap.get(key));

//     const blockId = getBlockElementId(key, pageNo);
//     const valueId = getFieldValueId(key, pageNo);

//     // 1. Layout Text (Static)
//     // Always prefer top-level block.text as per DB shape
//     const layoutText = (block.text ?? content.text ?? '').toString();

//     // 2. Field Text (Mutable)
//     const fieldText = fieldValue !== undefined && fieldValue !== null
//         ? String(fieldValue)
//         : null;

//     const isAiGenerated = content.aiGenerated === true;
//     const blockType = content.type || 'paragraph';

//     // Meta styles
//     const isAllCap = block.meta?.isAllCap || false;
//     const isBold = block.meta?.isBold || false;

//     const getBlockClassName = () => {
//         const classes = ['draft-block', `draft-block--${blockType}`];
//         if (isAiGenerated) classes.push('draft-block--ai-generated');
//         if (isAllCap) classes.push('text-uppercase');
//         if (isBold) classes.push('font-bold');
//         return classes.join(' ');
//     };

//     /**
//      * Renders the mutable field value span.
//      */
//     const renderFieldOverlay = () => {
//         if (fieldText === null) return null;

//         return (
//             <span
//                 id={valueId}
//                 className="draft-block__value"
//                 data-field-key={key}
//                 data-block-id={id}
//                 style={{ marginLeft: '4px', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
//             >
//                 {fieldText}
//             </span>
//         );
//     };

//     // Render logic
//     return (
//         <div id={blockId} className={getBlockClassName()}>
//             <span className="draft-block__layout-text">
//                 {content.label && blockType !== 'paragraph' && (
//                     <span className="draft-block__label-prefix">{content.label}: </span>
//                 )}
//                 {renderWithBlankLines(layoutText)}
//             </span>
//             {renderFieldOverlay()}

//             {blockType === 'signature' && content.label && (
//                 <div className="draft-block__label" style={{ marginTop: '4px' }}>{content.label}</div>
//             )}
//         </div>
//     );
// });

// BlockRenderer.displayName = 'BlockRenderer';





import React from 'react';
import { useDraftStore } from '../../store/draftStore';
import { getBlockElementId, getFieldValueId } from '../../utils/domAnchors';
import type { LayoutBlock } from '../../types';

interface BlockRendererProps {
    block: LayoutBlock;
    pageNo: number;
}

/**
 * INTEGRATED CSS STRATEGY:
 * These styles ensure the "Deed of Rent" looks like a document
 * rather than a basic web list.
 */
const documentStyles = `
    .draft-block {
        position: relative;
        width: 100%;
        transition: background-color 0.2s ease;
        word-wrap: break-word;
    }
    .draft-block:hover {
        background-color: rgba(0, 0, 0, 0.02);
    }
    .draft-blank-line {
        display: inline-block;
        border-bottom: 1px solid #333;
        margin: 0 2px;
        vertical-align: baseline;
    }
    .draft-block__value {
        color: #1a73e8;
        font-weight: 600;
        border-bottom: 2px solid #1a73e8;
        cursor: pointer;
        padding: 0 4px;
        display: inline-block;
    }
    .text-uppercase { text-transform: uppercase; }
    .font-bold { font-weight: bold; }
    .draft-block--ai-generated { border-left: 2px solid #8e24aa; padding-left: 8px; }
`;

function renderWithBlankLines(text: string) {
    const parts: React.ReactNode[] = [];
    const re = /_{3,}/g;
    let last = 0;
    let m: RegExpExecArray | null;

    while ((m = re.exec(text)) !== null) {
        const start = m.index;
        if (start > last) {
            parts.push(<span key={`text-${last}`}>{text.slice(last, start)}</span>);
        }
        const width = Math.min(320, Math.max(60, m[0].length * 6));
        parts.push(
            <span
                key={`blank-${start}`}
                className="draft-blank-line"
                style={{ width: `${width}px` }}
            />
        );
        last = start + m[0].length;
    }
    if (last < text.length) {
        parts.push(<span key={`text-${last}`}>{text.slice(last)}</span>);
    }
    return parts;
}

export const BlockRenderer: React.FC<BlockRendererProps> = React.memo(({ block, pageNo }) => {
    const { key, content, id, meta } = block;

    const fieldValue = useDraftStore(state => state.fieldMap.get(key));
    const blockId = getBlockElementId(key, pageNo);
    const valueId = getFieldValueId(key, pageNo);

    const layoutText = (block.text ?? content.text ?? '').toString();
    const fieldText = fieldValue !== undefined && fieldValue !== null ? String(fieldValue) : null;
    const blockType = content.type || 'paragraph';

    /**
     * DYNAMIC STYLE MAPPING:
     * Pulls the 'textAlign' and 'lineHeight' injected by our SQL update.
     */
    const containerStyle: React.CSSProperties = {
        textAlign: (meta?.textAlign as any) || 'left',
        marginBottom: meta?.marginBottom || '12px',
        paddingLeft: meta?.paddingLeft || '0px',
        lineHeight: meta?.lineHeight || '1.5',
        fontSize: '12pt' // Standard legal drafting size
    };

    const getBlockClassName = () => {
        const classes = ['draft-block', `draft-block--${blockType}`];
        if (content.aiGenerated) classes.push('draft-block--ai-generated');
        if (meta?.isAllCap) classes.push('text-uppercase');
        if (meta?.isBold || meta?.fontWeight === 'bold') classes.push('font-bold');
        return classes.join(' ');
    };

    return (
        <>
            {/* Scoped CSS for the document feel */}
            <style>{documentStyles}</style>
            
            <div id={blockId} className={getBlockClassName()} style={containerStyle}>
                <span className="draft-block__layout-text">
                    {content.label && blockType !== 'paragraph' && (
                        <span className="draft-block__label-prefix" style={{ fontWeight: 'bold' }}>
                            {content.label}: 
                        </span>
                    )}
                    {renderWithBlankLines(layoutText)}
                </span>

                {fieldText !== null && (
                    <span
                        id={valueId}
                        className="draft-block__value"
                        data-field-key={key}
                    >
                        {fieldText}
                    </span>
                )}

                {blockType === 'signature' && content.label && (
                    <div className="draft-block__label" style={{ marginTop: '20px', borderTop: '1px solid #000', display: 'inline-block', minWidth: '150px' }}>
                        {content.label}
                    </div>
                )}
            </div>
        </>
    );
});

BlockRenderer.displayName = 'BlockRenderer';