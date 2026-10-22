// DraftStreamParser — turns the drafting SSE event stream into per-section
// updates without triggering a React re-render per token.
//
// The backend emits BOTH typed events (section_start / chunk / section_end)
// and inline [START_SECTION_i]…[END_SECTION_i] markers inside the chunk text.
// Typed events are the primary protocol; the marker scanner below is the
// fallback so the parser also works against a plain marker-framed text stream.

const START_RE = /\[START_SECTION[_ ]?(\w+)\]/;
const END_RE = /\[END_SECTION[_ ]?(\w+)\]/;
const ANY_MARKER_RE = /\[(?:START|END)_SECTION[_ ]?\w*\]/g;
export const MONOLITHIC_DOCUMENT_ID = '__document__';

export class DraftStreamParser {
  /**
   * @param {object} handlers
   *   onStatus(evt), onSectionStart({sectionId,index,heading}),
   *   onSectionText(sectionId, fullTextSoFar),
   *   onSectionEnd({sectionId,index,heading,completed,total}),
   *   onSectionError(evt), onUsage(evt), onDone(evt), onError(evt)
   */
  constructor(handlers = {}) {
    this.h = handlers;
    this.buffers = new Map();       // sectionId -> accumulated text
    this.currentSectionId = null;   // used by the marker fallback
    this.markerIndex = 0;
  }

  getText(sectionId) {
    return this.buffers.get(sectionId) || '';
  }

  handleEvent(evt) {
    switch (evt?.type) {
      case 'draft_start':
        if (evt.mode === 'monolithic' || evt.drafting_strategy === 'monolithic') {
          this.buffers.set(MONOLITHIC_DOCUMENT_ID, '');
          this.currentSectionId = MONOLITHIC_DOCUMENT_ID;
          this.h.onDraftStart?.(evt);
        }
        break;
      case 'document_chunk':
        this._append(MONOLITHIC_DOCUMENT_ID, (evt.text || '').replace(ANY_MARKER_RE, ''));
        break;
      case 'document_end':
        // Propagate the final cleaned text the same way document_replace does —
        // the strategy's restart-strip net lands here, and without notifying
        // onSectionText the live UI keeps any duplicated stream that landed
        // via document_chunk (only the saved record would be clean).
        if (evt.text) {
          this.buffers.set(MONOLITHIC_DOCUMENT_ID, evt.text);
          this.h.onSectionText?.(MONOLITHIC_DOCUMENT_ID, evt.text);
        }
        this.h.onDocumentEnd?.(evt);
        break;
      case 'document_replace':
        // Backend revised the whole monolithic document in one pass:
        // replace the single document buffer wholesale.
        this.buffers.set(MONOLITHIC_DOCUMENT_ID, evt.text || '');
        this.h.onSectionText?.(MONOLITHIC_DOCUMENT_ID, evt.text || '');
        this.h.onDocumentReplace?.(evt);
        break;
      case 'status':
        this.h.onStatus?.(evt);
        break;
      case 'section_start':
        this.currentSectionId = evt.section_id;
        if (!this.buffers.has(evt.section_id)) this.buffers.set(evt.section_id, '');
        this.h.onSectionStart?.({
          sectionId: evt.section_id,
          index: evt.index,
          heading: evt.heading,
          headingLevel: evt.heading_level,
        });
        break;
      case 'chunk':
        this._handleChunk(evt);
        break;
      case 'section_end':
        this.currentSectionId = null;
        this.h.onSectionEnd?.({
          sectionId: evt.section_id,
          index: evt.index,
          heading: evt.heading,
          completed: evt.completed,
          total: evt.total,
        });
        break;
      case 'section_error':
        this.currentSectionId = null;
        this.h.onSectionError?.(evt);
        break;
      case 'usage':
        this.h.onUsage?.(evt);
        break;
      case 'section_replace':
        // Backend rewrote a section (coverage expansion / grounding repair):
        // replace the buffer wholesale.
        if (evt.section_id) {
          this.buffers.set(evt.section_id, evt.text || '');
          this.h.onSectionText?.(evt.section_id, evt.text || '');
          this.h.onSectionReplace?.(evt);
        }
        break;
      case 'grounding_report':
        this.h.onGroundingReport?.(evt);
        break;
      case 'ingestion_report':
        this.h.onIngestionReport?.(evt);
        break;
      case 'qa_report':
        this.h.onQaReport?.(evt);
        break;
      case 'discrepancy_report':
        this.h.onDiscrepancyReport?.(evt);
        break;
      case 'review_packet':
        this.h.onReviewPacket?.(evt);
        break;
      case 'cost':
        this.h.onCost?.(evt);
        break;
      case 'scorecard':
        this.h.onScorecard?.(evt);
        break;
      case 'chat_saved':
        this.h.onChatSaved?.(evt);
        break;
      case 'done':
        this.h.onDone?.(evt);
        break;
      case 'error':
        this.h.onError?.(evt);
        break;
      default:
        break;
    }
  }

  _handleChunk(evt) {
    const text = evt.text || '';
    if (!text) return;

    // Typed protocol: the chunk names its section — markers are framing only.
    if (evt.section_id) {
      this._append(evt.section_id, text.replace(ANY_MARKER_RE, ''));
      return;
    }

    // Marker fallback: tokenize the chunk so text and markers apply IN ORDER
    // (an [END_SECTION] may arrive in the same chunk as the section's tail).
    const tokens = text.split(/(\[(?:START|END)_SECTION[_ ]?\w*\])/);
    for (const token of tokens) {
      if (!token) continue;
      const start = token.match(START_RE);
      if (start) {
        if (!this.currentSectionId) {
          this.currentSectionId = `marker_section_${start[1]}`;
          this.markerIndex += 1;
          if (!this.buffers.has(this.currentSectionId)) this.buffers.set(this.currentSectionId, '');
          this.h.onSectionStart?.({
            sectionId: this.currentSectionId,
            index: this.markerIndex - 1,
            heading: `Section ${start[1]}`,
          });
        }
        continue;
      }
      if (END_RE.test(token)) {
        if (this.currentSectionId?.startsWith('marker_section_')) {
          const sid = this.currentSectionId;
          this.currentSectionId = null;
          this.h.onSectionEnd?.({ sectionId: sid, index: this.markerIndex - 1 });
        }
        continue;
      }
      if (this.currentSectionId) this._append(this.currentSectionId, token);
      // else: preamble noise outside any section — dropped
    }
  }

  _append(sectionId, text) {
    if (!text) return;
    const next = (this.buffers.get(sectionId) || '') + text;
    this.buffers.set(sectionId, next);
    this.h.onSectionText?.(sectionId, next);
  }
}

export default DraftStreamParser;
