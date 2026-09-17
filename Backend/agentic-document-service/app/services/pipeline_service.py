import hashlib
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
import re
from typing import Any

from app.core.config import Settings, get_settings
from app.schemas.contracts import (
    AnswerSegment,
    DocumentProcessResult,
    DocumentReference,
    DocumentType,
    ExtractedField,
    IngestDocumentsRequest,
    IngestDocumentsResponse,
    IntakeRequest,
    IntakeResponse,
    PresetExecutionRequest,
    PresetExecutionResponse,
    PresetPrompt,
    QueryCitation,
    QueryIntent,
    QueryRequest,
    QueryResponse,
)
from app.services.adapters import chunking, embeddings, gcs, ocr
from app.services.adapters.document_ai import DocumentAIAdapter, _call_gemini_for_qa
from app.services.adapters.vector_store import ChunkRecord, InMemoryVectorStore
from app.services.db import get_db_connection, is_db_available
from app.services.llm_chat_config import get_llm_chat_config
from app.services.prompt_visibility import normalize_role_slug, preset_matches_user

logger = logging.getLogger("agentic_document_service.pipeline")


def _parse_uid_int(user_id: str | None) -> int | None:
    try:
        n = int(str(user_id or "").strip())
        return n if n > 0 else None
    except (ValueError, TypeError):
        return None


_DOMAIN_ROLE_ALIASES: dict[str, str] = {
    "banking_professional": "banking",
    "finance_professional": "banking",
    "legal_professional": "legal",
    "chartered_accountant": "corporate",
    "corporate_advisor": "corporate",
    "tax_consultant": "corporate",
    "compliance_officer": "corporate",
}


def _normalize_user_role(raw_role: str | None) -> str | None:
    if not raw_role:
        return None
    normalized = normalize_role_slug(raw_role)
    if not normalized:
        return None
    return _DOMAIN_ROLE_ALIASES.get(normalized, normalized)


_JSONB_COLUMNS = {"entities", "form_fields", "tables", "metadata", "raw_response", "structured_schema"}


def _get_public_table_columns(cur: Any, table_name: str) -> set[str]:
    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        [table_name],
    )
    return {row["column_name"] for row in cur.fetchall()}


def _json_for_db(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False)


def _count_structured_paragraphs(structured_json: dict[str, Any] | None, fallback_text: str) -> int:
    if isinstance(structured_json, dict):
        pages = structured_json.get("pages")
        if isinstance(pages, list):
            total = 0
            for page in pages:
                if not isinstance(page, dict):
                    continue
                paragraphs = page.get("paragraphs")
                if isinstance(paragraphs, list) and paragraphs:
                    total += len(paragraphs)
            if total:
                return total
    return len([part for part in re.split(r"\n\s*\n", fallback_text or "") if part.strip()])


def _json_placeholder(column: str) -> str:
    if column == "file_id":
        return "%s::uuid"
    if column in _JSONB_COLUMNS:
        return "%s::jsonb"
    return "%s"


def _get_user_role_from_db(uid: int) -> str | None:
    if not is_db_available():
        return None
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT role, domain_role FROM users WHERE id = %s LIMIT 1",
                (uid,),
            )
            row = cur.fetchone()
            if row:
                for key in ("domain_role", "role"):
                    resolved = _normalize_user_role(row.get(key))
                    if resolved:
                        return resolved
    except Exception:
        pass
    return None


def _get_user_plan_id(uid: int, authorization: str | None = None) -> int | None:
    try:
        from app.services.payment_plan_service import get_user_active_plan

        plan = get_user_active_plan(uid, authorization=authorization)
        if plan and plan.get("id") is not None:
            return int(plan["id"])
    except Exception:
        pass
    return None


def _preset_visible(preset: "PresetPrompt", user_role: str | None, user_plan_id: int | None) -> bool:
    return preset_matches_user(
        preset.allowed_roles,
        preset.allowed_plan_ids,
        user_role,
        user_plan_id,
    )


DEFAULT_PRESETS: list[dict[str, Any]] = [
    {
        "id": "case-brief",
        "name": "Case Brief",
        "prompt_template": (
            "Prepare a professional case brief using only the indexed case materials. "
            "Cover procedural posture, material facts, issues, party positions, court reasoning if available, "
            "and the current status. If any part is missing in the record, state that explicitly."
        ),
        "required_doc_types": ["pleading", "order", "affidavit", "correspondence"],
        "output_format": "structured",
    },
    {
        "id": "risk-scan",
        "name": "Risk Scan",
        "prompt_template": (
            "Identify the most important legal, procedural, evidentiary, and case-management risks from the record. "
            "Separate confirmed risks from possible risks, and mention missing documents or gaps that limit confidence."
        ),
        "required_doc_types": ["pleading", "evidence", "order", "affidavit", "correspondence"],
        "output_format": "structured",
    },
]


@dataclass(slots=True)
class StoredDocument:
    document_id: str
    document_name: str
    doc_type: DocumentType
    stored_document_uri: str
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class StoredCase:
    case_id: str
    user_id: str
    created_at: datetime
    documents: list[StoredDocument] = field(default_factory=list)
    form_data: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ProcessedDocumentBundle:
    process_result: DocumentProcessResult
    stored_document: StoredDocument
    chunks: list[ChunkRecord]


class LegalCasePipelineService:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._cases: dict[str, StoredCase] = {}
        self._vector_store = InMemoryVectorStore()
        self._document_ai = DocumentAIAdapter()
        self._chunker = chunking.LegalSemanticChunker(
            target_tokens=self._settings.chunk_size,
            overlap_tokens=self._settings.chunk_overlap,
            min_tokens=self._settings.chunk_min_tokens,
            max_tokens=self._settings.chunk_max_tokens,
        )

    def _normalize_doc_type(self, value: Any) -> DocumentType | None:
        raw = str(value or "").strip().lower()
        if not raw:
            return None
        for item in DocumentType:
            if item.value == raw:
                return item
        return None

    def _coerce_doc_types(self, values: Any) -> list[DocumentType]:
        if values is None:
            return []
        if isinstance(values, str):
            values = [item.strip() for item in values.split(",")]
        result: list[DocumentType] = []
        for value in values:
            normalized = self._normalize_doc_type(value)
            if normalized and normalized not in result:
                result.append(normalized)
        return result

    def _fetch_presets_from_db(self) -> list[PresetPrompt]:
        if not is_db_available():
            return []
        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                      id::text AS id,
                      name,
                      prompt_template,
                      required_doc_types,
                      output_format,
                      COALESCE(allowed_roles,    ARRAY[]::text[])    AS allowed_roles,
                      COALESCE(allowed_plan_ids, ARRAY[]::integer[]) AS allowed_plan_ids
                    FROM preset_prompts
                    WHERE is_active = TRUE
                    ORDER BY name ASC
                    """
                )
                rows = list(cur.fetchall())
        except Exception as exc:
            logger.warning("[Pipeline] preset_prompts lookup failed: %s", exc)
            return []

        presets: list[PresetPrompt] = []
        for row in rows:
            presets.append(
                PresetPrompt(
                    id=str(row.get("id") or ""),
                    name=str(row.get("name") or "Preset"),
                    prompt_template=str(row.get("prompt_template") or "").strip(),
                    required_doc_types=self._coerce_doc_types(row.get("required_doc_types")),
                    output_format=str(row.get("output_format") or "structured").strip() or "structured",
                    allowed_roles=list(row.get("allowed_roles") or []),
                    allowed_plan_ids=[int(x) for x in (row.get("allowed_plan_ids") or []) if x is not None],
                )
            )
        return [preset for preset in presets if preset.prompt_template]

    def _get_default_presets(self) -> list[PresetPrompt]:
        return [
            PresetPrompt(
                id=item["id"],
                name=item["name"],
                prompt_template=item["prompt_template"],
                required_doc_types=self._coerce_doc_types(item.get("required_doc_types")),
                output_format=item.get("output_format") or "structured",
            )
            for item in DEFAULT_PRESETS
        ]

    def _infer_query_context(
        self,
        query: str,
        required_doc_types: list[DocumentType] | None = None,
    ) -> tuple[QueryIntent, list[DocumentType]]:
        raw = str(query or "").lower()
        inferred_types = list(required_doc_types or [])

        def add_doc_type(doc_type: DocumentType) -> None:
            if doc_type not in inferred_types:
                inferred_types.append(doc_type)

        if any(term in raw for term in ["timeline", "chronology", "sequence", "date wise", "procedural history"]):
            intent = QueryIntent.timeline
        elif any(term in raw for term in ["risk", "exposure", "weakness", "defect", "limitation", "vulnerability"]):
            intent = QueryIntent.risk
        elif any(term in raw for term in ["evidence", "exhibit", "proof", "annexure", "document support"]):
            intent = QueryIntent.evidence
        elif any(term in raw for term in ["summary", "summarize", "brief", "gist", "overview"]):
            intent = QueryIntent.summary
        else:
            intent = QueryIntent.general

        if any(term in raw for term in ["pleading", "petition", "plaint", "written statement", "reply", "rejoinder"]):
            add_doc_type(DocumentType.pleading)
        if any(term in raw for term in ["evidence", "exhibit", "annexure", "proof"]):
            add_doc_type(DocumentType.evidence)
        if any(term in raw for term in ["order", "judgment", "direction", "court order"]):
            add_doc_type(DocumentType.order)
        if any(term in raw for term in ["affidavit", "sworn statement"]):
            add_doc_type(DocumentType.affidavit)
        if any(term in raw for term in ["letter", "notice", "email", "correspondence", "communication"]):
            add_doc_type(DocumentType.correspondence)
        if any(term in raw for term in ["agreement", "contract", "clause"]):
            add_doc_type(DocumentType.contract)

        return intent, inferred_types

    def _build_grounded_answer(
        self,
        *,
        query: str,
        doc_texts: list[dict[str, str]],
        citations: list[QueryCitation],
        intent: QueryIntent,
        output_format: str = "plain",
        extra_instructions: str | None = None,
        system_instruction: str | None = None,
        user_id: str | int | None = None,
        summarization_llm_config: dict | None = None,
        agent_name: str | None = None,
        model_name_override: str | None = None,
    ) -> tuple[str, bool]:
        qa_result = _call_gemini_for_qa(
            query,
            doc_texts,
            query_intent=intent.value,
            output_format=output_format,
            extra_instructions=extra_instructions,
            system_instruction=system_instruction,
            user_id=user_id,
            summarization_llm_config=summarization_llm_config,
            agent_name=agent_name,
            model_name_override=model_name_override,
        )
        synthesized_answer = (qa_result.get("answer") or "").strip()
        if synthesized_answer:
            return synthesized_answer, True
        fallback = "\n".join(
            f"{idx}. {citation.quote}" for idx, citation in enumerate(citations, start=1)
        ).strip()
        return fallback, False

    def process_intake(self, request: IntakeRequest) -> IntakeResponse:
        case_id = request.case_id or f"case-{uuid.uuid4().hex[:12]}"
        stored_case = self._cases.get(case_id)
        if not stored_case:
            stored_case = StoredCase(case_id=case_id, user_id=request.user_id, created_at=datetime.now(tz=UTC))
            self._cases[case_id] = stored_case

        extraction = self._document_ai.extract(request.document)
        form_data = dict(extraction.entities)
        stored_case.form_data.update(form_data)

        extracted_fields: list[ExtractedField] = []
        threshold = float(self._settings.auto_fill_confidence_threshold or 0.90)
        for field_name, field_value in form_data.items():
            confidence = float(extraction.confidence_by_field.get(field_name, 0.65))
            extracted_fields.append(
                ExtractedField(
                    name=field_name,
                    value=field_value,
                    confidence=confidence,
                    auto_filled=confidence >= threshold,
                )
            )

        return IntakeResponse(
            case_id=case_id,
            stored_document_uri=request.document.document_uri or "",
            schema_name=request.schema_name,
            extracted_fields=extracted_fields,
            form_data=stored_case.form_data,
            requires_review=any(not item.auto_filled for item in extracted_fields),
            created_at=datetime.now(tz=UTC),
        )

    def ingest_case_documents(self, request: IngestDocumentsRequest) -> IngestDocumentsResponse:
        stored_case = self._cases.get(request.case_id)
        if not stored_case:
            stored_case = StoredCase(case_id=request.case_id, user_id=request.user_id, created_at=datetime.now(tz=UTC))
            self._cases[request.case_id] = stored_case

        processed: list[DocumentProcessResult] = []
        total_chunks = 0
        for document in request.documents:
            bundle = self._process_single_document(request.case_id, document)
            logger.info(
                "[Pipeline] Step 4/4: Storing — case_id=%s chunks=%d (in-memory index)",
                request.case_id,
                len(bundle.chunks),
            )
            self._vector_store.upsert_chunks(request.case_id, bundle.chunks)
            logger.info("[Pipeline] Step 4/4: done — indexed for retrieval")
            stored_case.documents.append(bundle.stored_document)
            processed.append(bundle.process_result)
            total_chunks += len(bundle.chunks)

        return IngestDocumentsResponse(
            case_id=request.case_id,
            processed_documents=processed,
            total_chunks_indexed=total_chunks,
            completed_at=datetime.now(tz=UTC),
        )

    def _process_single_document(self, case_id: str, document: DocumentReference, *, progress_callback=None) -> ProcessedDocumentBundle:
        db_file_id = str(document.metadata.get("db_file_id") or "").strip()
        document_id = db_file_id if db_file_id else str(uuid.uuid4())
        mime_type = document.mime_type or "application/pdf"

        logger.info(
            "[Pipeline] %s | case_id=%s document_id=%s — start (OCR → chunking → embedding)",
            document.document_name,
            case_id,
            document_id,
        )

        text = (document.inline_text or "").strip()
        quality_score = 0.0
        page_count = 0
        structured_ocr_json: dict[str, Any] | None = None
        if not text:
            if document.document_uri and document.document_uri.startswith("gs://"):
                logger.info(
                    "[Pipeline] Step 1/4: OCR / text extraction (GCS) uri=%s mime=%s",
                    document.document_uri,
                    mime_type,
                )
                ocr_result = ocr.extract_text_from_gcs(
                    document.document_uri,
                    mime_type,
                    filename=document.document_name,
                    progress_callback=progress_callback,
                )
            else:
                logger.info("[Pipeline] Step 1/4: OCR / text extraction — no GCS URI, empty text")
                ocr_result = ocr.OcrResult(text="", page_count=0, quality_score=0.0)
            text = (ocr_result.text or "").strip()
            quality_score = float(ocr_result.quality_score or 0.0)
            page_count = int(ocr_result.page_count or 0)
            if isinstance(getattr(ocr_result, "structured_json", None), dict):
                structured_ocr_json = ocr_result.structured_json
            from app.services.chronology.pages import text_with_page_markers

            marked = text_with_page_markers(structured_ocr_json)
            if marked:
                text = marked
                from app.services.chronology.console import log_note
                from app.services.chronology.pages import split_into_pages

                stamped = split_into_pages(text)
                log_note(
                    f"Stamped OCR with [PAGE n] on {len(stamped)} page(s) "
                    "so chronology pin cites are real paper-book pages"
                )
            logger.info(
                "[Pipeline] Step 1/4: done — chars=%d pages=%d quality=%.2f",
                len(text),
                page_count,
                quality_score,
            )
        else:
            quality_score = 0.97 if len(text) > 100 else 0.55
            page_count = max(1, int(document.metadata.get("page_count") or 1))
            logger.info(
                "[Pipeline] Step 1/4: inline text (OCR skipped) — chars=%d",
                len(text),
            )

        # Side-writes (extracted-text upload → OCR-structure DB persist) don't
        # feed chunking/embedding, so they run in the background OVERLAPPING
        # those stages instead of adding several seconds of remote I/O to the
        # critical path. Joined below before the URI is needed for metadata.
        def _side_writes() -> str:
            uri = ""
            if text and document.document_uri and document.document_uri.startswith("gs://"):
                try:
                    output_text_path = self._build_output_text_path(document)
                    uri = gcs.upload_bytes(
                        text.encode("utf-8"),
                        output_text_path,
                        content_type="text/plain; charset=utf-8",
                        bucket_type="output",
                    )
                    logger.info(
                        "[Pipeline] Step 1.5/4: Extracted text uploaded to output bucket uri=%s chars=%d",
                        uri,
                        len(text),
                    )
                except Exception as exc:
                    logger.warning(
                        "[Pipeline] Step 1.5/4: failed to upload extracted text to output bucket document=%s error=%s",
                        document.document_name,
                        exc,
                    )
            # _persist_ocr_extraction stores extracted_text_uri in its metadata,
            # so it must run after the upload — chained here, off the hot path.
            self._persist_ocr_extraction(
                file_id=db_file_id,
                document=document,
                text=text,
                structured_json=structured_ocr_json,
                page_count=page_count,
                quality_score=quality_score,
                extracted_text_uri=uri,
            )
            return uri

        from concurrent.futures import ThreadPoolExecutor as _SidePool
        _side_pool = _SidePool(max_workers=1, thread_name_prefix="doc-side")
        _side_future = _side_pool.submit(_side_writes)
        _side_pool.shutdown(wait=False)

        doc_type = self._document_ai.classify(document, text)
        logger.info("[Pipeline] Document classified as %s", doc_type.value)

        from app.services.adapters.speech_to_text import is_audio_filename, is_audio_mime

        is_audio = is_audio_mime(mime_type) or is_audio_filename(document.document_name or "")

        from app.services.adapters.chunking import ChunkSection

        chunk_rows: list[ChunkRecord] = []

        if is_audio and text.strip():
            # ── Audio-specific chunking: sliding-window RAG strategy ─────────
            # AudioProcessor uses a 750-char window with 10% overlap (75 chars)
            # which maps to 500–1 000 tokens at typical speech cadence.
            # Identical adjacent windows are deduplicated to suppress noise runs.
            logger.info("[Pipeline] Step 2/4: Chunking — audio sliding-window (750 chars / 10% overlap)")
            from app.services.adapters.audio_processor import AudioProcessor
            audio_proc = AudioProcessor()
            audio_chunks = audio_proc.chunk(text)

            if audio_chunks:
                non_empty_sections = [
                    (ac.index, ChunkSection(text=ac.text, heading=ac.heading))
                    for ac in audio_chunks
                ]
            else:
                non_empty_sections = [(0, ChunkSection(text=text.strip(), heading="Audio Transcript"))]

            logger.info("[Pipeline] Step 2/4: done — %d audio sliding-window chunks", len(non_empty_sections))
        else:
            # ── Standard semantic chunking for documents ─────────────────────
            logger.info("[Pipeline] Step 2/4: Chunking — semantic split")
            sections = self._chunker.chunk(text)
            non_empty_sections = [
                (idx, s) for idx, s in enumerate(sections) if (s.text or "").strip()
            ]
            logger.info("[Pipeline] Step 2/4: done — %d raw sections", len(sections))

            # Fallback: very short text that didn't meet min_tokens threshold
            if not non_empty_sections and text.strip():
                non_empty_sections = [(0, ChunkSection(text=text.strip(), heading="Full Text"))]
                logger.info("[Pipeline] Step 2/4: short-text fallback — single chunk %d chars", len(text))

        non_empty = len(non_empty_sections)
        logger.info(
            "[Pipeline] Step 3/4: Embedding — %d non-empty chunks (parallel batches, size=%s)",
            non_empty,
            self._settings.embedding_batch_size,
        )

        if progress_callback:
            try:
                progress_callback(64.0)
            except Exception:
                pass

        if non_empty_sections:
            chunk_texts = [(s.text or "").strip() for _, s in non_empty_sections]
            # Parallel embed_batch: sub-batches sent concurrently via ThreadPoolExecutor.
            # Rate limiter + exponential-backoff retry per sub-batch.
            chunk_embeddings = embeddings.embed_batch(
                chunk_texts,
                progress_callback=progress_callback,
                progress_start=65.0,
                progress_end=78.0,
            )

            for (section_idx, section), chunk_text, chunk_embedding in zip(
                non_empty_sections, chunk_texts, chunk_embeddings
            ):
                chunk_id = str(uuid.uuid4())
                chunk_meta: dict[str, str] = {
                    "heading": section.heading or "",
                    "chunk_index": str(section_idx),
                }
                if is_audio:
                    chunk_meta["source_type"] = "audio"
                    chunk_meta["mime_type"] = mime_type
                    chunk_meta["audio_file"] = document.document_name
                    chunk_meta["total_segments"] = str(non_empty)
                chunk_rows.append(
                    ChunkRecord(
                        chunk_id=chunk_id,
                        case_id=case_id,
                        document_id=document_id,
                        document_name=document.document_name,
                        doc_type=doc_type,
                        text=chunk_text,
                        embedding=chunk_embedding,
                        metadata=chunk_meta,
                    )
                )

        logger.info("[Pipeline] Step 3/4: done — %d vectors stored in bundle", len(chunk_rows))

        # Join the background side-writes; the extracted-text URI goes into the
        # stored-document metadata below. Chunking + embedding usually take
        # longer, so this normally returns immediately.
        try:
            extracted_text_uri = _side_future.result(timeout=180)
        except Exception as exc:
            logger.warning(
                "[Pipeline] side-writes failed/timed out document=%s error=%s",
                document.document_name,
                exc,
            )
            extracted_text_uri = ""

        structured_ocr_available = isinstance(structured_ocr_json, dict)
        stored_document = StoredDocument(
            document_id=document_id,
            document_name=document.document_name,
            doc_type=doc_type,
            # Keep original document URI as the primary storage URI for previews/view.
            # Extracted OCR text is tracked separately via metadata.extracted_text_uri.
            stored_document_uri=document.document_uri or document.metadata.get("gcs_path") or "",
            text=text,
            metadata={
                **dict(document.metadata),
                **({"extracted_text_uri": extracted_text_uri} if extracted_text_uri else {}),
                **({"structured_ocr_available": True, "ocr_page_count": page_count} if structured_ocr_available else {}),
            },
        )
        pr_meta: dict[str, Any] = {
            **dict(document.metadata),
            "original_name": document.metadata.get("original_name") or document.document_name,
            "page_count": page_count,
            "heading_count": len([s for _, s in non_empty_sections if s.heading]),
            **({"extracted_text_uri": extracted_text_uri} if extracted_text_uri else {}),
            **({"structured_ocr_available": True, "ocr_page_count": page_count} if structured_ocr_available else {}),
        }
        if is_audio:
            pr_meta["source_type"] = "audio"
            pr_meta["mime_type"] = mime_type

        process_result = DocumentProcessResult(
            document_id=document_id,
            document_name=document.document_name,
            doc_type=doc_type,
            stored_document_uri=stored_document.stored_document_uri,
            extracted_text_chars=len(text),
            chunk_count=len(chunk_rows),
            quality_score=quality_score,
            metadata=pr_meta,
        )
        return ProcessedDocumentBundle(process_result=process_result, stored_document=stored_document, chunks=chunk_rows)

    def _persist_ocr_extraction(
        self,
        *,
        file_id: str | None,
        document: DocumentReference,
        text: str,
        structured_json: dict[str, Any] | None,
        page_count: int,
        quality_score: float,
        extracted_text_uri: str | None = None,
    ) -> None:
        if not file_id or not is_db_available():
            return
        structured_payload = structured_json if isinstance(structured_json, dict) else None
        extracted_text = text or ""
        if not structured_payload and not extracted_text:
            return

        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                columns = _get_public_table_columns(cur, "document_ai_extractions")
                if not columns or "file_id" not in columns:
                    return

                cur.execute("DELETE FROM document_ai_extractions WHERE file_id::text = %s", [file_id])

                word_count = len(extracted_text.split())
                paragraph_count = _count_structured_paragraphs(structured_payload, extracted_text)
                metadata = {
                    "document_name": document.document_name,
                    "document_uri": document.document_uri,
                    "mime_type": document.mime_type,
                    "extracted_text_uri": extracted_text_uri or "",
                    "source": (structured_payload or {}).get("source") if structured_payload else "text_extraction",
                }
                payload: dict[str, Any] = {
                    "file_id": file_id,
                    "file_type": document.mime_type or "application/octet-stream",
                    "document_ai_processor_id": getattr(self._settings, "document_ai_processor_id", "") or None,
                    "document_ai_processor_version": getattr(self._settings, "document_ai_ocr_processor_version_id", "") or None,
                    "extracted_text": extracted_text,
                    "extracted_text_hash": hashlib.sha256(extracted_text.encode("utf-8")).hexdigest() if extracted_text else None,
                    "page_count": int(page_count or 0),
                    "total_characters": len(extracted_text),
                    "total_words": word_count,
                    "total_paragraphs": paragraph_count,
                    "confidence_score": float(quality_score or 0.0),
                    "average_confidence": float(quality_score or 0.0),
                    "min_confidence": float(quality_score or 0.0),
                    "max_confidence": float(quality_score or 0.0),
                    "processing_status": "processed",
                    "metadata": metadata,
                    "raw_response": structured_payload,
                    "structured_schema": structured_payload,
                    "processed_at": "__NOW__",
                    "updated_at": "__NOW__",
                }

                insert_columns = [column for column in payload if column in columns]
                if not insert_columns:
                    return

                placeholders: list[str] = []
                values: list[Any] = []
                for column in insert_columns:
                    value = payload[column]
                    if value == "__NOW__":
                        placeholders.append("NOW()")
                        continue
                    placeholders.append(_json_placeholder(column))
                    values.append(_json_for_db(value) if column in _JSONB_COLUMNS else value)

                cur.execute(
                    f"""
                    INSERT INTO document_ai_extractions ({", ".join(insert_columns)})
                    VALUES ({", ".join(placeholders)})
                    """,
                    values,
                )
                conn.commit()
                logger.info(
                    "[Pipeline] OCR structure persisted file_id=%s pages=%d chars=%d",
                    file_id, page_count, len(extracted_text),
                )
        except Exception as exc:
            logger.warning("[Pipeline] OCR structure persistence skipped file_id=%s error=%s", file_id, exc)

    def _build_output_text_path(self, document: DocumentReference) -> str:
        source_uri = str(document.document_uri or "").strip()
        if source_uri.startswith("gs://"):
            object_path = source_uri[5:].split("/", 1)[1] if "/" in source_uri[5:] else ""
            if object_path:
                if "." in object_path:
                    object_path = object_path.rsplit(".", 1)[0]
                return f"{object_path}.extracted.txt"
        fallback_name = (document.document_name or "document").replace("\\", "_").replace("/", "_")
        if "." in fallback_name:
            fallback_name = fallback_name.rsplit(".", 1)[0]
        return f"extracted-text/{uuid.uuid4().hex[:10]}_{fallback_name}.txt"

    def persist_chunks_to_db(self, file_id: str | None, chunks: list[ChunkRecord]) -> list[ChunkRecord]:
        if not file_id or not chunks or not is_db_available():
            if file_id and chunks and not is_db_available():
                logger.info(
                    "[Pipeline] Step 4/4: Storing — DB unavailable, skipping persistence file_id=%s chunks=%d",
                    file_id,
                    len(chunks),
                )
            return chunks
        logger.info(
            "[Pipeline] Step 4/4: Storing — PostgreSQL file_chunks + chunk_vectors file_id=%s rows=%d",
            file_id,
            len(chunks),
        )
        persisted: list[ChunkRecord] = []
        # Multi-row statements in slices instead of 2 round-trips per chunk: the
        # DB is remote, so per-chunk execute() was the dominant per-document cost
        # (a 60-chunk doc = 120 sequential round-trips).
        _BATCH_ROWS = 200
        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                id_by_index: dict[int, str] = {}
                for start in range(0, len(chunks), _BATCH_ROWS):
                    batch = chunks[start:start + _BATCH_ROWS]
                    row_placeholders: list[str] = []
                    values: list[Any] = []
                    for offset, chunk in enumerate(batch):
                        row_placeholders.append("(%s::uuid, %s, %s, %s, %s, %s, %s)")
                        values.extend([
                            file_id,
                            start + offset,
                            chunk.text,
                            max(1, int(len(chunk.text.split()) * 1.3)),
                            None,
                            None,
                            chunk.metadata.get("heading") or None,
                        ])
                    cur.execute(
                        f"""
                        INSERT INTO file_chunks (file_id, chunk_index, content, token_count, page_start, page_end, heading)
                        VALUES {", ".join(row_placeholders)}
                        ON CONFLICT (file_id, chunk_index) DO UPDATE
                          SET content = EXCLUDED.content,
                              token_count = EXCLUDED.token_count,
                              page_start = EXCLUDED.page_start,
                              page_end = EXCLUDED.page_end,
                              heading = EXCLUDED.heading
                        RETURNING id, chunk_index
                        """,
                        values,
                    )
                    for row in cur.fetchall():
                        id_by_index[int(row.get("chunk_index"))] = str(row.get("id"))

                for start in range(0, len(chunks), _BATCH_ROWS):
                    batch = chunks[start:start + _BATCH_ROWS]
                    row_placeholders = []
                    values = []
                    for offset, chunk in enumerate(batch):
                        db_chunk_id = id_by_index.get(start + offset) or chunk.chunk_id
                        embedding_pg = f"[{','.join(str(float(v)) for v in chunk.embedding)}]"
                        row_placeholders.append("(%s::uuid, %s::vector, %s::uuid)")
                        values.extend([db_chunk_id, embedding_pg, file_id])
                        persisted.append(
                            ChunkRecord(
                                chunk_id=db_chunk_id,
                                case_id=chunk.case_id,
                                document_id=file_id,
                                document_name=chunk.document_name,
                                doc_type=chunk.doc_type,
                                text=chunk.text,
                                embedding=chunk.embedding,
                                metadata=chunk.metadata,
                            )
                        )
                    cur.execute(
                        f"""
                        INSERT INTO chunk_vectors (chunk_id, embedding, file_id)
                        VALUES {", ".join(row_placeholders)}
                        ON CONFLICT (chunk_id) DO UPDATE
                          SET embedding = EXCLUDED.embedding,
                              file_id = EXCLUDED.file_id,
                              updated_at = NOW()
                        """,
                        values,
                    )
                conn.commit()
        except Exception as exc:
            logger.exception("[Pipeline] DB chunk/vector persistence failed file_id=%s error=%s", file_id, exc)
            return chunks
        logger.info(
            "[Pipeline] Step 4/4: done — persisted %d chunk rows for file_id=%s",
            len(persisted),
            file_id,
        )
        return persisted

    def _resolve_retrieval_params(self, request: QueryRequest, llm_config: dict[str, Any]) -> dict[str, Any]:
        return {
            "top_k": int(request.top_k or llm_config.get("retrieval_top_k") or self._settings.retrieval_top_k or 8),
            "max_context_documents": max(1, int(llm_config.get("max_context_documents") or 8)),
            "use_hybrid_search": bool(llm_config.get("use_hybrid_search")),
            "use_rrf": bool(llm_config.get("use_rrf")),
            "semantic_weight": max(0.0, float(llm_config.get("semantic_weight") or 0.7)),
            "keyword_weight": max(0.0, float(llm_config.get("keyword_weight") or 0.3)),
            "text_search_language": str(llm_config.get("text_search_language") or "english").strip() or "english",
        }

    def _log_retrieval_params(self, request: QueryRequest, llm_config: dict[str, Any], params: dict[str, Any], *, source: str) -> None:
        logger.info(
            "[RetrievalConfig] source=%s case_id=%s query=%s llm_model=%s summarization_model=%s embedding_model=%s "
            "top_k=%s max_context_documents=%s use_hybrid_search=%s use_rrf=%s semantic_weight=%s keyword_weight=%s "
            "text_search_language=%s max_output_tokens=%s max_summarization_output_tokens=%s model_temperature=%s streaming_delay=%s",
            source,
            request.case_id,
            request.query[:120],
            llm_config.get("llm_model"),
            llm_config.get("summarization_model"),
            llm_config.get("embedding_model"),
            params.get("top_k"),
            params.get("max_context_documents"),
            params.get("use_hybrid_search"),
            params.get("use_rrf"),
            params.get("semantic_weight"),
            params.get("keyword_weight"),
            params.get("text_search_language"),
            llm_config.get("max_output_tokens"),
            llm_config.get("max_summarization_output_tokens"),
            llm_config.get("model_temperature"),
            llm_config.get("streaming_delay"),
        )

    def _search_db_chunks(
        self,
        *,
        request: QueryRequest,
        valid_file_ids: list[str],
        query_embedding: list[float],
        params: dict[str, Any],
    ) -> list[dict[str, Any]]:
        top_k = int(params["top_k"])
        semantic_limit = max(top_k * 3, top_k)
        text_search_language = params["text_search_language"]
        keyword_query = self._build_keyword_query(request.query)
        embedding_pg = f"[{','.join(str(float(v)) for v in query_embedding)}]"
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  cv.chunk_id,
                  fc.content,
                  fc.file_id,
                  COALESCE(uf.originalname, fc.file_id::text) AS document_name,
                  fc.page_start,
                  fc.page_end,
                  COALESCE(fc.heading, '') AS section_title,
                  fc.chunk_index,
                  (cv.embedding <=> %s::vector) AS distance,
                  (1 / (1 + (cv.embedding <=> %s::vector))) AS similarity
                FROM chunk_vectors cv
                INNER JOIN file_chunks fc ON cv.chunk_id::text = fc.id::text
                LEFT JOIN user_files uf ON uf.id::text = fc.file_id::text
                WHERE fc.file_id::text = ANY(%s::text[])
                ORDER BY distance ASC
                LIMIT %s
                """,
                (embedding_pg, embedding_pg, valid_file_ids, semantic_limit),
            )
            semantic_rows = list(cur.fetchall())

            keyword_rows: list[dict[str, Any]] = []
            if params["use_hybrid_search"] and keyword_query:
                try:
                    cur.execute(
                        """
                        SELECT
                          fc.id::text AS chunk_id,
                          fc.content,
                          fc.file_id,
                          COALESCE(uf.originalname, fc.file_id::text) AS document_name,
                          fc.page_start,
                          fc.page_end,
                          COALESCE(fc.heading, '') AS section_title,
                          fc.chunk_index,
                          ts_rank_cd(
                            to_tsvector(%s::regconfig, COALESCE(fc.content, '')),
                            websearch_to_tsquery(%s::regconfig, %s)
                          ) AS keyword_score
                        FROM file_chunks fc
                        LEFT JOIN user_files uf ON uf.id::text = fc.file_id::text
                        WHERE fc.file_id::text = ANY(%s::text[])
                          AND to_tsvector(%s::regconfig, COALESCE(fc.content, '')) @@ websearch_to_tsquery(%s::regconfig, %s)
                        ORDER BY keyword_score DESC
                        LIMIT %s
                        """,
                        (
                            text_search_language,
                            text_search_language,
                            keyword_query,
                            valid_file_ids,
                            text_search_language,
                            text_search_language,
                            keyword_query,
                            semantic_limit,
                        ),
                    )
                    keyword_rows = list(cur.fetchall())
                except Exception as exc:
                    logger.warning(
                        "[Pipeline] DB keyword search skipped case_id=%s error=%s keyword_query=%r",
                        request.case_id,
                        exc,
                        keyword_query[:160],
                    )

        if not params["use_hybrid_search"]:
            return self._autoheal_fragmented_rows(semantic_rows[:top_k])

        merged: dict[str, dict[str, Any]] = {}
        if params["use_rrf"]:
            rank_constant = 60.0
            for rank, row in enumerate(semantic_rows, start=1):
                entry = merged.setdefault(str(row.get("chunk_id")), dict(row))
                entry["combined_score"] = float(entry.get("combined_score") or 0.0) + (1.0 / (rank_constant + rank))
            for rank, row in enumerate(keyword_rows, start=1):
                entry = merged.setdefault(str(row.get("chunk_id")), dict(row))
                entry["combined_score"] = float(entry.get("combined_score") or 0.0) + (1.0 / (rank_constant + rank))
                entry["keyword_score"] = float(row.get("keyword_score") or 0.0)
            rows = list(merged.values())
            rows.sort(key=lambda item: float(item.get("combined_score") or 0.0), reverse=True)
            return self._autoheal_fragmented_rows(rows[:top_k])

        semantic_weight = float(params["semantic_weight"])
        keyword_weight = float(params["keyword_weight"])
        for row in semantic_rows:
            entry = merged.setdefault(str(row.get("chunk_id")), dict(row))
            entry["semantic_score"] = float(row.get("similarity") or 0.0)
        for row in keyword_rows:
            entry = merged.setdefault(str(row.get("chunk_id")), dict(row))
            entry["keyword_score"] = float(row.get("keyword_score") or 0.0)
        for entry in merged.values():
            entry["combined_score"] = (float(entry.get("semantic_score") or 0.0) * semantic_weight) + (
                float(entry.get("keyword_score") or 0.0) * keyword_weight
            )
        rows = list(merged.values())
        rows.sort(key=lambda item: float(item.get("combined_score") or 0.0), reverse=True)
        return self._autoheal_fragmented_rows(rows[:top_k])

    def _build_keyword_query(self, raw_query: str) -> str:
        text = str(raw_query or "").strip()
        if not text:
            return ""
        current_question_match = re.search(r"current question:\s*(.+)$", text, flags=re.IGNORECASE | re.DOTALL)
        if current_question_match:
            text = current_question_match.group(1).strip()
        tokens = re.findall(r"[A-Za-z0-9_]{2,}", text.lower())
        deduped: list[str] = []
        seen: set[str] = set()
        for token in tokens:
            if token in seen:
                continue
            seen.add(token)
            deduped.append(token)
            if len(deduped) >= 24:
                break
        return " ".join(deduped)

    def retrieve_learning_chunk_hits(
        self,
        request: QueryRequest,
        file_ids: list[str],
        *,
        top_k: int = 5,
        similarity_floor: float = 0.0,
    ) -> list[dict[str, Any]]:
        """
        Vector (+ optional hybrid) chunk hits for teaching / grounding without running the answer LLM.
        Rows include page_start, page_end, section_title, chunk_index when available from file_chunks.
        """
        valid_file_ids = [str(item) for item in file_ids if item]
        if not valid_file_ids or not is_db_available():
            return []
        llm_config = get_llm_chat_config()
        params = dict(self._resolve_retrieval_params(request, llm_config))
        params["top_k"] = max(1, int(top_k))
        # Learning mode should prefer legal-safe recall over strict semantic-only retrieval.
        # Force hybrid retrieval (semantic + PostgreSQL full-text rank) for chunk grounding.
        params["use_hybrid_search"] = True
        params["use_rrf"] = True
        query_embedding = embeddings.embed_text(request.query)
        try:
            rows = self._search_db_chunks(
                request=request,
                valid_file_ids=valid_file_ids,
                query_embedding=query_embedding,
                params=params,
            )
        except Exception:
            logger.exception(
                "[Pipeline] retrieve_learning_chunk_hits failed case_id=%s",
                request.case_id,
            )
            return []
        scored: list[dict[str, Any]] = []
        for row in rows:
            sim = float(row.get("similarity") or row.get("semantic_score") or row.get("combined_score") or 0.0)
            if similarity_floor > 0 and sim < similarity_floor:
                continue
            item = dict(row)
            item["_retrieval_score"] = sim
            scored.append(item)
        if not scored and rows and similarity_floor > 0:
            for row in rows[: max(1, min(len(rows), top_k))]:
                item = dict(row)
                item["_retrieval_score"] = float(item.get("similarity") or item.get("combined_score") or 0.0)
                scored.append(item)
        return scored[:top_k]

    def retrieve_context_text(
        self,
        case_id: str,
        query: str,
        file_ids: list[str],
        top_k: int = 5,
    ) -> str:
        """Retrieval-only path for audio agent RAG — hybrid search, no LLM generation."""
        valid_file_ids = [str(f) for f in file_ids if f]
        query_embedding = embeddings.embed_text(query)
        if not query_embedding:
            return "Could not generate query embedding."

        if not valid_file_ids or not is_db_available():
            hits = self._vector_store.search(
                case_id=case_id,
                query=query,
                query_embedding=query_embedding,
                top_k=top_k,
                required_doc_types=[],
            )
            if not hits:
                return "No relevant content found."
            return "\n\n".join(
                f"[From: {c.document_name}]\n{c.text}" for c, _ in hits
            )

        audio_request = QueryRequest(user_id="audio", case_id=case_id, query=query)
        llm_config = get_llm_chat_config()
        params = dict(self._resolve_retrieval_params(audio_request, llm_config))
        params["top_k"] = max(1, int(top_k))
        params["use_hybrid_search"] = True
        params["use_rrf"] = True
        try:
            rows = self._search_db_chunks(
                request=audio_request,
                valid_file_ids=valid_file_ids,
                query_embedding=query_embedding,
                params=params,
            )
        except Exception as exc:
            logger.error("[AudioRAG] DB search failed case_id=%s error=%s", case_id, exc)
            return "Document search failed."

        if not rows:
            return "No relevant content found in your documents."

        parts = []
        for row in rows:
            doc_name = str(row.get("document_name") or "document")
            section = (str(row.get("section_title") or "")).strip()
            content = (str(row.get("content") or "")).strip()
            if content:
                header = f"[From: {doc_name}" + (f" — {section}" if section else "") + "]"
                parts.append(f"{header}\n{content}")
        return "\n\n".join(parts) if parts else "No relevant content found."

    def _autoheal_fragmented_rows(self, rows: list[dict]) -> list[dict]:
        """
        Return the retrieved rows at once, and queue any OCR-fragmented ones for repair.

        The repair used to run here, inline: every fragmented hit waited on an LLM
        rewrite (~8 s each), which pushed chat retrieval past its 15 s limit and sent
        the question to the whole-document fallback. It now runs in the background
        (app/services/chunk_autoheal.py) and writes the clean text back, so the next
        question that retrieves the chunk reads it clean. The rows are returned
        unchanged. Never blocks, never raises.
        """
        from app.services import chunk_autoheal

        chunk_autoheal.schedule(rows)
        return rows

    def answer_query_for_files(
        self,
        request: QueryRequest,
        file_ids: list[str],
        *,
        system_instruction: str | None = None,
        summarization_llm_config: dict | None = None,
        agent_name: str | None = "grounded_retrieval_agent",
        model_name_override: str | None = None,
    ) -> QueryResponse:
        valid_file_ids = [str(item) for item in file_ids if item]
        if not valid_file_ids or not is_db_available():
            return self.answer_query(
                request,
                summarization_llm_config=summarization_llm_config,
                agent_name=agent_name,
                model_name_override=model_name_override,
            )

        llm_config = get_llm_chat_config()
        retrieval_params = self._resolve_retrieval_params(request, llm_config)
        self._log_retrieval_params(request, llm_config, retrieval_params, source="db")
        intent, _effective_required_doc_types = self._infer_query_context(request.query, request.required_doc_types)
        query_embedding = embeddings.embed_text(request.query)
        try:
            rows = self._search_db_chunks(
                request=request,
                valid_file_ids=valid_file_ids,
                query_embedding=query_embedding,
                params=retrieval_params,
            )
        except Exception as exc:
            logger.exception("[Pipeline] DB vector search failed case_id=%s error=%s", request.case_id, exc)
            raise ValueError(f"Indexed search failed for case '{request.case_id}'.") from exc

        if not rows:
            raise ValueError(f"No indexed chunks found for case '{request.case_id}'.")
        # (rows are already auto-healed inside _search_db_chunks — universal for every path)

        citations: list[QueryCitation] = []
        answer_lines: list[str] = []
        for rank, row in enumerate(rows, start=1):
            quote = " ".join(str(row.get("content") or "").split())[:320]
            citations.append(
                QueryCitation(
                    document_id=str(row.get("file_id") or ""),
                    document_name=str(row.get("document_name") or "document"),
                    chunk_id=str(row.get("chunk_id") or ""),
                    quote=quote,
                    score=float(row.get("combined_score") or row.get("similarity") or row.get("keyword_score") or 0.0),
                )
            )
            answer_lines.append(f"{rank}. {quote}")

        doc_texts = []
        for row in rows:
            content = str(row.get("content") or "").strip()
            if not content:
                continue
            doc_texts.append(
                {
                    "name": str(row.get("document_name") or "document"),
                    "text": content,
                }
            )
        max_context_documents = int(retrieval_params["max_context_documents"])
        answer_text, grounded = self._build_grounded_answer(
            query=request.query,
            doc_texts=doc_texts[:max_context_documents],
            citations=citations,
            intent=intent,
            output_format="structured",
            system_instruction=system_instruction,
            user_id=request.user_id,
            summarization_llm_config=summarization_llm_config,
            agent_name=agent_name,
            model_name_override=model_name_override,
        )
        segment = AnswerSegment(statement=answer_text, confidence=0.9 if grounded else 0.72, citations=citations)
        return QueryResponse(
            case_id=request.case_id,
            intent=intent,
            answer=answer_text,
            answer_segments=[segment],
            hallucination_check_passed=grounded,
            retrieved_chunk_count=len(rows),
            generated_at=datetime.now(tz=UTC),
        )

    def answer_query(
        self,
        request: QueryRequest,
        *,
        summarization_llm_config: dict | None = None,
        agent_name: str | None = "grounded_retrieval_agent",
        model_name_override: str | None = None,
    ) -> QueryResponse:
        case = self._cases.get(request.case_id)
        if not case:
            raise ValueError(f"Case '{request.case_id}' not found.")

        llm_config = get_llm_chat_config()
        retrieval_params = self._resolve_retrieval_params(request, llm_config)
        self._log_retrieval_params(request, llm_config, retrieval_params, source="memory")
        intent, effective_required_doc_types = self._infer_query_context(request.query, request.required_doc_types)
        query_embedding = embeddings.embed_text(request.query)
        hits = self._vector_store.search(
            case_id=request.case_id,
            query=request.query,
            query_embedding=query_embedding,
            top_k=int(retrieval_params["top_k"]),
            required_doc_types=effective_required_doc_types,
            use_hybrid_search=bool(retrieval_params["use_hybrid_search"]),
            use_rrf=bool(retrieval_params["use_rrf"]),
            semantic_weight=float(retrieval_params["semantic_weight"]),
            keyword_weight=float(retrieval_params["keyword_weight"]),
        )
        if not hits:
            raise ValueError(f"No indexed chunks found for case '{request.case_id}'.")

        citations: list[QueryCitation] = []
        answer_lines: list[str] = []
        for rank, (chunk, score) in enumerate(hits, start=1):
            quote = " ".join(chunk.text.split())[:320]
            citations.append(
                QueryCitation(
                    document_id=chunk.document_id,
                    document_name=chunk.document_name,
                    chunk_id=chunk.chunk_id,
                    quote=quote,
                    score=float(score),
                )
            )
            answer_lines.append(f"{rank}. {quote}")

        doc_texts = [
            {"name": chunk.document_name or "document", "text": chunk.text}
            for chunk, _score in hits
            if (chunk.text or "").strip()
        ]
        max_context_documents = int(retrieval_params["max_context_documents"])
        answer_text, grounded = self._build_grounded_answer(
            query=request.query,
            doc_texts=doc_texts[:max_context_documents],
            citations=citations,
            intent=intent,
            output_format="structured",
            user_id=request.user_id,
            summarization_llm_config=summarization_llm_config,
            agent_name=agent_name,
            model_name_override=model_name_override,
        )
        segment = AnswerSegment(statement=answer_text, confidence=0.9 if grounded else 0.72, citations=citations)
        return QueryResponse(
            case_id=request.case_id,
            intent=intent,
            answer=answer_text,
            answer_segments=[segment],
            hallucination_check_passed=grounded,
            retrieved_chunk_count=len(hits),
            generated_at=datetime.now(tz=UTC),
        )

    def list_presets(
        self,
        user_id: str | None = None,
        authorization: str | None = None,
    ) -> list[PresetPrompt]:
        all_presets = self._fetch_presets_from_db() or self._get_default_presets()
        uid_int = _parse_uid_int(user_id)
        if uid_int is None:
            return []
        user_role = _get_user_role_from_db(uid_int)
        user_plan_id = _get_user_plan_id(uid_int, authorization=authorization)
        logger.debug(
            "[Pipeline] list_presets user_id=%s role=%s plan_id=%s total=%s",
            uid_int, user_role, user_plan_id, len(all_presets),
        )
        return [p for p in all_presets if _preset_visible(p, user_role, user_plan_id)]

    def execute_preset(self, request: PresetExecutionRequest) -> PresetExecutionResponse:
        preset = next((item for item in self.list_presets(user_id=request.user_id) if item.id == request.preset_id), None)
        if not preset:
            raise ValueError(f"Preset '{request.preset_id}' was not found.")
        additional_context = (request.additional_context or "").strip()
        effective_query = preset.prompt_template
        if additional_context:
            effective_query = f"{effective_query}\n\n=== ADDITIONAL USER INSTRUCTIONS ===\n{additional_context}"
        result = self.answer_query(
            QueryRequest(
                user_id=request.user_id,
                case_id=request.case_id,
                query=effective_query,
                required_doc_types=preset.required_doc_types,
            ),
            agent_name="preset_execution_agent",
        )
        return PresetExecutionResponse(
            preset_id=preset.id,
            preset_name=preset.name,
            case_id=request.case_id,
            output_format=preset.output_format,
            rendered_prompt=None,
            result=result,
        )


def get_pipeline_service() -> LegalCasePipelineService:
    return LegalCasePipelineService(get_settings())
