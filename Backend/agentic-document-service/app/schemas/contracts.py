from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import AliasChoices, BaseModel, Field


class DocumentType(str, Enum):
    intake = "intake"
    pleading = "pleading"
    evidence = "evidence"
    correspondence = "correspondence"
    order = "order"
    contract = "contract"
    affidavit = "affidavit"
    audio_recording = "audio_recording"
    unknown = "unknown"


class QueryIntent(str, Enum):
    summary = "summary"
    timeline = "timeline"
    evidence = "evidence"
    risk = "risk"
    general = "general"


class ProcessingState(str, Enum):
    queued = "queued"
    processing = "processing"
    embedding_pending = "embedding_pending"
    processed = "processed"
    error = "error"


class PromptRecordKind(str, Enum):
    user_query = "user_query"
    preset_execution = "preset_execution"


class DocumentReference(BaseModel):
    document_name: str
    mime_type: str = "application/pdf"
    document_uri: str | None = None
    inline_text: str | None = None
    declared_doc_type: DocumentType | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class IntakeRequest(BaseModel):
    user_id: str
    schema_name: str = "case_intake"
    case_id: str | None = None
    document: DocumentReference


class ExtractedField(BaseModel):
    name: str
    value: Any
    confidence: float
    auto_filled: bool


class IntakeResponse(BaseModel):
    case_id: str
    stored_document_uri: str
    schema_name: str
    extracted_fields: list[ExtractedField]
    form_data: dict[str, Any]
    requires_review: bool
    created_at: datetime


class IngestDocumentsRequest(BaseModel):
    user_id: str
    case_id: str
    documents: list[DocumentReference]


class DocumentProcessResult(BaseModel):
    document_id: str
    document_name: str
    doc_type: DocumentType
    stored_document_uri: str
    extracted_text_chars: int
    chunk_count: int
    quality_score: float
    metadata: dict[str, Any] = Field(default_factory=dict)


class IngestDocumentsResponse(BaseModel):
    case_id: str
    processed_documents: list[DocumentProcessResult]
    total_chunks_indexed: int
    completed_at: datetime


class QueryRequest(BaseModel):
    user_id: str
    case_id: str
    query: str
    top_k: int | None = None
    required_doc_types: list[DocumentType] = Field(default_factory=list)
    date_range: dict[str, str] | None = None


class QueryCitation(BaseModel):
    document_id: str
    document_name: str
    chunk_id: str
    quote: str
    score: float


class AnswerSegment(BaseModel):
    statement: str
    confidence: float
    citations: list[QueryCitation]


class QueryResponse(BaseModel):
    case_id: str
    intent: QueryIntent
    answer: str
    answer_segments: list[AnswerSegment]
    hallucination_check_passed: bool
    retrieved_chunk_count: int
    generated_at: datetime


class PresetPrompt(BaseModel):
    id: str
    name: str
    prompt_template: str
    required_doc_types: list[DocumentType] = Field(default_factory=list)
    output_format: str = "structured"
    allowed_roles: list[str] = Field(default_factory=list)
    allowed_plan_ids: list[int] = Field(default_factory=list)


class PresetExecutionRequest(BaseModel):
    user_id: str
    case_id: str
    preset_id: str
    additional_context: str | None = None


class PresetExecutionResponse(BaseModel):
    preset_id: str
    preset_name: str
    case_id: str
    output_format: str
    rendered_prompt: str | None = None
    result: QueryResponse


class QueuedDocumentStatus(BaseModel):
    id: str | None = None
    file_id: str | None = None
    document_id: str
    document_name: str
    status: ProcessingState
    processing_progress: float = 0.0
    current_operation: str | None = None
    error: str | None = None
    doc_type: DocumentType | None = None
    stored_document_uri: str | None = None
    chunk_count: int = 0
    quality_score: float | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    updated_at: datetime


class UploadBatchResponse(BaseModel):
    success: bool
    folderName: str
    case_id: str
    job_id: str
    queued_count: int
    uploadedFiles: list[QueuedDocumentStatus]
    message: str


class FolderProcessingStatusResponse(BaseModel):
    folderName: str
    case_id: str
    job_id: str | None = None
    status: ProcessingState | str
    progress: float
    total_documents: int
    processed_documents: int
    failed_documents: int
    documents: list[QueuedDocumentStatus]
    updated_at: datetime


class ExtractCaseFieldsResponse(BaseModel):
    success: bool
    folderName: str
    case_id: str
    extractedData: dict[str, Any]
    requiresReview: bool
    sourceDocuments: list[str] = Field(default_factory=list)
    chronology: dict[str, Any] = Field(default_factory=dict)
    message: str


class ChatMessage(BaseModel):
    id: str
    role: str
    content: str
    created_at: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChatSession(BaseModel):
    id: str
    case_id: str
    folderName: str
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[ChatMessage] = Field(default_factory=list)


class LearningQuestionAnswerPayload(BaseModel):
    question_id: str
    selected_answer: str
    session_id: str | None = None
    time_taken: float | None = None


class LearningQuestionGeneratePayload(BaseModel):
    session_id: str | None = None
    concept: str = ""
    difficulty: str = "intermediate"
    question_type: str = Field(
        default="comprehension",
        validation_alias=AliasChoices("question_type", "questionType"),
    )


class FolderChatRequest(BaseModel):
    question: str | None = None
    session_id: str | None = None
    llm_name: str | None = None
    prompt_label: str | None = None
    secret_id: str | None = None
    learning_mode: bool = False
    research_mode: bool = False
    # This conversation neither reads nor writes Memory files.
    incognito: bool = False
    # Deep Research: bounded agentic web-research loop (plan → search rounds → synthesize)
    # with a hard rupee budget. Supersedes research_mode/learning_mode when set.
    deep_research: bool = False
    adversarial_mode: bool = False
    # Draft-from-template mode: fill an uploaded template (attached to the model as a file) from the
    # case's supporting documents. template_gcs_path is the gs:// object the browser PUT via the
    # existing signed-upload flow; the template is NOT ingested into RAG.
    draft_mode: bool = False
    template_gcs_path: str | None = None
    template_mimetype: str | None = None
    # Per-draft engine selector (frontend dropdown, shown only when a template is attached).
    # Allowed: gemini-3.1-pro-preview (default), claude-opus-4-8, claude-sonnet-5. Anything else
    # falls back to the .env default. Only affects the DRAFT task.
    draft_model: str | None = None
    # Per-draft STRUCTURE model selector (Stage A: template layout analysis). Allowed:
    # gemini-3.1-pro-preview (default), gemini-2.5-flash, claude-opus-4-8, claude-sonnet-5,
    # gemma-4-31b-it, gemma-4-26b-a4b-it. Anything else falls back to gemini-3.1-pro-preview.
    analysis_model: str | None = None
    # Per-draft GUARDIAN model selector (Stage D/E: grounding audit, format audit, section
    # repair, slot recovery). Same allowlist as the structure model. Empty → DRAFT_GUARDIAN_MODEL
    # from .env → the auto default (Opus when an Anthropic key is set, else gemini-3.1-pro).
    # This is the model that CHECKS the draft, so it is worth being able to A/B it against the
    # engine that WROTE the draft.
    guardian_model: str | None = None
    document_context: str | None = None
    context_page: int | None = None
    context_selection: str | None = None
    max_output_tokens: int | None = Field(
        default=None,
        validation_alias=AliasChoices("max_output_tokens", "maxOutputTokens"),
    )
    model_temperature: float | None = Field(
        default=None,
        validation_alias=AliasChoices("model_temperature", "temperature"),
    )


class FolderChatResponse(BaseModel):
    success: bool
    folderName: str
    case_id: str
    session_id: str
    answer: str
    learning_response: dict[str, Any] | None = None
    citations: list[QueryCitation] = Field(default_factory=list)
    answer_segments: list[AnswerSegment] = Field(default_factory=list)
    stored_chat_count: int = 0
    prompt_stored: bool = True
    generated_at: datetime


class PromptAuditRecord(BaseModel):
    id: str
    case_id: str
    user_id: str
    kind: PromptRecordKind
    prompt_text: str | None = None
    stored: bool
    redacted: bool
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    adk_runtime_enabled: bool
    timestamp: datetime
