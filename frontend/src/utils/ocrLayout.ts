import type { OcrPage, OcrTable, OcrWord, OcrWordBbox } from '../types/ocr';
import type { OcrDisplayMode } from '../hooks/useOcrDocumentViewer';

/** True when the centre of `item` lies inside `box`. */
export const boxContainsCenter = (item: OcrWordBbox, box: OcrWordBbox): boolean => {
  const centerX = item.x + item.w / 2;
  const centerY = item.y + item.h / 2;
  return (
    centerX >= box.x &&
    centerX <= box.x + box.w &&
    centerY >= box.y &&
    centerY <= box.y + box.h
  );
};

/**
 * Swap the items that fall inside a detected table for that table's cells. The OCR processor merges
 * lines across column gaps, so a line-level layer cannot reproduce columns; cells carry the exact
 * column boxes. Items outside every table are kept as they are.
 */
export const replaceWithTableCells = (items: OcrWord[], tables: OcrTable[] | undefined): OcrWord[] => {
  const usable = (tables || []).filter((table) => table.cells.some((cell) => cell.text));
  if (!usable.length) return items;
  const outside = items.filter(
    (item) => !usable.some((table) => boxContainsCenter(item.bbox, table.bbox)),
  );
  const cells = usable.flatMap((table) => table.cells.filter((cell) => cell.text));
  return [...outside, ...cells];
};

/**
 * The layer the viewer draws for a display mode. Falls back to the page's default layer when the
 * requested one was not stored, so switching modes never blanks a page.
 */
export const selectDisplayLayer = (page: OcrPage, mode: OcrDisplayMode): OcrWord[] => {
  if (!page.hasGeometry) return page.words;
  if (mode === 'words') {
    return page.tokens?.length ? page.tokens : page.words;
  }
  if (mode === 'paragraphs') {
    const base = page.paragraphs?.length ? page.paragraphs : page.blocks;
    return base?.length ? replaceWithTableCells(base, page.tables) : page.words;
  }
  return page.lines?.length ? replaceWithTableCells(page.lines, page.tables) : page.words;
};
