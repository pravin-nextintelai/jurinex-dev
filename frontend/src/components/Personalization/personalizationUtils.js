/** Shared non-component helpers for the Personalization UI (kept out of the
 *  component files so React Fast Refresh keeps working). */

export const fmtDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

const SECTION_TITLES = new Set([
  'personalized working instructions',
  'tone',
  'response shape',
  'depth and detail',
  'depth & detail',
  'language',
  'citations and jurisdiction',
  'citations & jurisdiction',
  'avoid',
  'from your past prompts',
  'this session',
  'from this case',
]);

const AMP_SECTION = {
  'depth & detail': 'Depth and detail',
  'citations & jurisdiction': 'Citations and jurisdiction',
};

/** Strip leftover markdown so instructions display as structured plain text. */
export const toPlainInstruction = (text) => {
  let s = String(text || '').trim();
  if (!s) return '';
  s = s.replace(/^```(?:\w+)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  s = s.replace(/```(?:\w+)?\s*\n?/g, '').replace(/```/g, '');
  const lines = s.split('\n').map((raw) => {
    let line = raw.replace(/\s+$/, '');
    if (/^\s*[-*_]{3,}\s*$/.test(line)) return '';
    line = line.replace(/^\s{0,3}#{1,6}\s+/, '');
    line = line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
    line = line.replace(/`([^`]+)`/g, '$1');
    line = line.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1');
    const key = line.trim().toLowerCase();
    if (AMP_SECTION[key]) return AMP_SECTION[key];
    return line;
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

export const parseInstructionBlocks = (text) => {
  const plain = toPlainInstruction(text);
  if (!plain) return [];
  const blocks = [];
  const bullets = [];
  const flush = () => {
    if (!bullets.length) return;
    blocks.push({ type: 'ul', items: [...bullets] });
    bullets.length = 0;
  };
  for (const raw of plain.split('\n')) {
    const t = raw.trim();
    if (!t) {
      flush();
      continue;
    }
    const bullet = t.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    const snap = t.match(/^user snapshot:\s*(.*)$/i);
    if (snap) {
      blocks.push({ type: 'snapshot', text: snap[1] });
      continue;
    }
    const key = t.toLowerCase().replace(/\s+/g, ' ');
    if (SECTION_TITLES.has(key)) {
      blocks.push({
        type: key === 'personalized working instructions' ? 'title' : 'h',
        text: AMP_SECTION[key] || t,
      });
      continue;
    }
    blocks.push({ type: 'p', text: t });
  }
  flush();
  return blocks;
};
