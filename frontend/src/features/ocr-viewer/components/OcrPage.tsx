import React, { useMemo } from 'react';
import type { OcrPage } from '../types/ocr';
import type { OcrConfidenceFilter } from '../hooks/useOcrDocumentViewer';
import OcrWordBox from './OcrWord';
import { pageRenderHeight } from './constants';

export interface OcrPageProps {
  page: OcrPage;
  zoom: number;
  confidenceFilter: OcrConfidenceFilter;
}

const OcrPageView: React.FC<OcrPageProps> = ({
  page,
  zoom,
  confidenceFilter,
}) => {
  const { width, height, words } = page;

  const wordBoxes = useMemo(
    () => {
      return words.map((word, idx) => {
        const { bbox } = word;

        // Size the word to its bbox height, but never wider than its bbox: CSS font-size is an em
        // size and our fallback font is wider than the source PDF's, so height alone renders text
        // past bbox.w — it then wraps inside the box (a word breaking onto two stacked lines) and
        // bleeds over its neighbours. At ~0.5em average glyph advance, `text.length` glyphs fit
        // bbox.w at font-size 2*bbox.w/length; take whichever constraint binds first.
        const glyphCount = Math.max(1, (word.text || '').trim().length);
        const fitByWidth = (2 * bbox.w) / glyphCount;
        const sourceFontSize = Math.min(bbox.h, fitByWidth);

        const style: React.CSSProperties = {
          position: 'absolute',
          left: `${(bbox.x / width) * 100}%`,
          top: `${(bbox.y / height) * 100}%`,
          width: `${(bbox.w / width) * 100}%`,
          height: `${(bbox.h / height) * 100}%`,
          // Container-width units, so glyphs scale with the page box at any panel size or zoom. An
          // absolute px size cannot work: the boxes are sized as a % of the container, so fixed-size
          // text overflows and collides. (x/width)*100cqw === x * (renderedWidth / sourceWidth).
          fontSize: `${(sourceFontSize / width) * 100}cqw`,
          lineHeight: '1',
          whiteSpace: 'nowrap',
        };
        return (
          <OcrWordBox
            key={`${word.text}-${idx}-${bbox.x}-${bbox.y}`}
            word={word}
            confidenceFilter={confidenceFilter}
            style={style}
          />
        );
      });
    },
    [words, width, height, confidenceFilter, page.page],
  );

  return (
    <div className="w-full h-full flex items-center justify-center">
      {/* Height-driven from pageRenderHeight (the SAME number the PDF panel sizes its page with), so
          the two pages are the same rect and a word sits at the same y on both sides. The width must
          stay derived from aspectRatio: an explicit width (`w-full`) plus a stretched height resolves
          both axes, at which point CSS drops aspectRatio and the page fills the panel instead.
          Zoom is real layout height, not `transform: scale` — a transform does not reflow, so the
          scaled page kept its unscaled box and drifted out of alignment above 100%. */}
      <div
        className="relative bg-white border border-gray-200 rounded-md shadow-sm overflow-hidden shrink-0"
        style={{
          height: pageRenderHeight(zoom),
          aspectRatio: `${width} / ${height}`,
          // Makes 1cqw == 1% of this box's width, which is what the word font sizes are expressed in.
          containerType: 'inline-size',
        }}
      >
        <div className="absolute inset-0 bg-white/90">{wordBoxes}</div>
      </div>
    </div>
  );
};

export default OcrPageView;

