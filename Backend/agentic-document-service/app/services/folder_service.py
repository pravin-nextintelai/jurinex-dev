from __future__ import annotations

import json
import logging
import queue
import re
import threading
import time
import uuid
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor
from concurrent.futures import wait as futures_wait
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx

from app.schemas.contracts import (
    ChatMessage,
    ChatSession,
    DocumentReference,
    ExtractCaseFieldsResponse,
    FolderChatRequest,
    FolderChatResponse,
    FolderProcessingStatusResponse,
    ProcessingState,
    PromptAuditRecord,
    PromptRecordKind,
    QueryCitation,
    QueryRequest,
    QueuedDocumentStatus,
    UploadBatchResponse,
)
from app.core.config import get_settings
from app.services.db import get_db_connection, is_db_available
from app.services.llm_chat_config import get_summarization_chat_config, merge_folder_chat_request_llm_overrides
from app.services.legal_system_prompt import build_document_qa_system_prompt, build_legal_system_prompt, fetch_full_profile
from app.services.pipeline_service import LegalCasePipelineService, StoredCase
from app.services.secret_prompt_display import (
    post_process_secret_prompt_response,
    resolve_query_and_display,
    resolve_secret_prompt_llm_name,
)
from app.services.adapters.speech_to_text import is_audio_filename, is_audio_mime
from app.services.chronology import (
    delete_tree,
    empty_tree,
    load_or_empty,
    merge_into_tree,
    rebind_tree,
    refresh_tree,
    report_from_extraction,
    save_tree,
)
from app.services.chronology.console import log_progress, log_run_report


logger = logging.getLogger("agentic_document_service.folder")

# folder_chats.session_id is PostgreSQL uuid — must be dashed RFC form for INSERT.
_UUID_DASHED = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_UUID_HEX32 = re.compile(r"^[0-9a-fA-F]{32}$")


def normalize_folder_chat_session_uuid(session_id: str | None) -> str:
    """Return a valid dashed lowercase UUID for folder_chats.session_id."""
    s = (session_id or "").strip()
    if _UUID_DASHED.match(s):
        return s.lower()
    if _UUID_HEX32.match(s):
        h = s.lower()
        return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"
    return str(uuid.uuid4())


settings = get_settings()


@dataclass(slots=True)
class ProcessingJobRecord:
    job_id: str
    case_id: str
    folder_name: str
    user_id: str
    status: ProcessingState
    submitted_at: datetime
    updated_at: datetime
    documents: dict[str, QueuedDocumentStatus] = field(default_factory=dict)


@dataclass(slots=True)
class ChatSessionRecord:
    id: str
    case_id: str
    user_id: str
    folder_name: str
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[ChatMessage] = field(default_factory=list)


class DocumentProcessingQueue:
    """
    Persistent background worker queue for document processing jobs.

    Unlike a plain ThreadPoolExecutor, worker threads stay alive between
    submissions and pick up new jobs as soon as they arrive.  This lets
    multiple concurrent file-upload batches be processed without spinning
    up new threads on every request.
    """

    def __init__(self, num_workers: int = 4) -> None:
        self._num_workers = num_workers
        self._task_queue: queue.Queue = queue.Queue()
        self._workers: list[threading.Thread] = []
        self._shutdown_event = threading.Event()
        self._pending_count = 0
        self._count_lock = threading.Lock()
        self._start_workers()
        logger.info(
            "[DocumentProcessingQueue] started num_workers=%d",
            self._num_workers,
        )

    def _start_workers(self) -> None:
        for i in range(self._num_workers):
            t = threading.Thread(
                target=self._worker_loop,
                name=f"doc-queue-worker-{i}",
                daemon=True,
            )
            t.start()
            self._workers.append(t)

    def _worker_loop(self) -> None:
        while not self._shutdown_event.is_set():
            try:
                fn, args, kwargs = self._task_queue.get(timeout=1.0)
            except queue.Empty:
                continue
            try:
                fn(*args, **kwargs)
            except Exception as exc:
                logger.exception("[DocumentProcessingQueue] worker crashed: %s", exc)
                # Best-effort: if _run_job crashed before updating documents,
                # mark any documents still at 20% (processing) as failed via the
                # FolderWorkflowService callback stored in kwargs.
                _on_crash = kwargs.get("_on_crash")
                if callable(_on_crash):
                    try:
                        _on_crash(exc)
                    except Exception:
                        pass
            finally:
                self._task_queue.task_done()
                with self._count_lock:
                    self._pending_count = max(0, self._pending_count - 1)

    def submit(self, fn, *args, **kwargs) -> None:
        with self._count_lock:
            self._pending_count += 1
        self._task_queue.put((fn, args, kwargs))

    def status(self) -> dict:
        return {
            "num_workers": self._num_workers,
            "queued_jobs": self._task_queue.qsize(),
            "pending_count": self._pending_count,
        }

    def shutdown(self) -> None:
        self._shutdown_event.set()


class FolderWorkflowService:
    def __init__(self, pipeline: LegalCasePipelineService) -> None:
        self._pipeline = pipeline
        self._lock = threading.RLock()
        self._jobs: dict[str, ProcessingJobRecord] = {}
        self._latest_job_by_case: dict[str, str] = {}
        # ALL job ids per case, oldest first. The signed-URL upload flow enqueues
        # ONE job per file, so folder status must aggregate across every job —
        # the latest job alone would report just the last uploaded file.
        self._jobs_by_case: dict[str, list[str]] = {}
        self._sessions: dict[str, dict[str, ChatSessionRecord]] = {}
        self._prompt_audit: list[PromptAuditRecord] = []
        self._extracted_by_case: dict[str, dict[str, Any]] = {}
        self._chronology_by_case: dict[str, Any] = {}
        # Guards _extracted_by_case / chronology merges now that documents finalize in parallel.
        self._autofill_lock = threading.Lock()
        num_workers = getattr(settings, "processing_queue_workers", 4)
        self._job_queue = DocumentProcessingQueue(num_workers=num_workers)
        # Recover documents orphaned by a restart (uvicorn --reload kills the worker
        # threads mid-batch): rows still marked in-flight but not updated within the
        # per-document timeout can never be finished by anyone — fail them so the UI
        # stops polling an eternally-"processing" batch. Age-gated so a multi-instance
        # deployment never kills another instance's live work. Background thread so a
        # slow DB can't delay startup.
        threading.Thread(
            target=self._fail_orphaned_processing_rows,
            name="orphaned-doc-recovery",
            daemon=True,
        ).start()

    def _fail_orphaned_processing_rows(self) -> None:
        if not is_db_available():
            return
        try:
            timeout_s = int(getattr(settings, "document_processing_timeout_seconds", 600))
            with get_db_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE user_files
                    SET status = %s,
                        processing_progress = 100.0,
                        current_operation = 'interrupted',
                        updated_at = NOW()
                    WHERE status IN ('processing', 'embedding_pending')
                      AND (is_folder IS NULL OR is_folder = FALSE)
                      AND COALESCE(updated_at, created_at) < NOW() - make_interval(secs => %s)
                    """,
                    [ProcessingState.error.value, timeout_s],
                )
                recovered = cur.rowcount or 0
                conn.commit()
            if recovered:
                logger.warning(
                    "[FolderService] startup recovery: marked %d orphaned in-flight document(s) as failed",
                    recovered,
                )
        except Exception as exc:
            logger.warning("[FolderService] startup recovery failed: %s", exc)

    def queue_documents(
        self,
        user_id: str,
        folder_name: str,
        documents: list[DocumentReference],
    ) -> UploadBatchResponse:
        case_id = folder_name
        self._ensure_case(user_id, case_id)
        now = datetime.now(tz=UTC)
        job_id = f"job-{uuid.uuid4().hex[:12]}"
        statuses: dict[str, QueuedDocumentStatus] = {}
        uploaded_files: list[QueuedDocumentStatus] = []

        db_ready_documents: list[DocumentReference] = []
        int_user_id: int | None = None
        try:
            int_user_id = int(user_id)
        except (TypeError, ValueError):
            int_user_id = None

        if is_db_available() and int_user_id is not None:
            try:
                with get_db_connection() as conn, conn.cursor() as cur:
                    for document in documents:
                        db_file_id = self._create_db_file_record(
                            cur,
                            user_id=str(user_id),
                            folder_name=folder_name,
                            document=document,
                        )
                        document_metadata = dict(document.metadata)
                        if db_file_id:
                            document_metadata["db_file_id"] = db_file_id
                        document_metadata.setdefault(
                            "gcs_path",
                            self._build_file_storage_key(user_id, folder_name, document.document_name),
                        )
                        db_ready_documents.append(document.model_copy(update={"metadata": document_metadata}))
                    conn.commit()
            except Exception as exc:
                logger.warning(
                    "[FolderService] task=queue_documents status=db_error user_id=%s folder=%s error=%s",
                    user_id,
                    folder_name,
                    exc,
                )
                db_ready_documents = list(documents)
        else:
            db_ready_documents = list(documents)

        for document in db_ready_documents:
            document_id = f"doc-{uuid.uuid4().hex[:12]}"
            metadata = dict(document.metadata)
            persisted_file_id = str(
                metadata.get("db_file_id")
                or metadata.get("file_id")
                or metadata.get("id")
                or document_id
            )
            status = QueuedDocumentStatus(
                id=persisted_file_id,
                file_id=persisted_file_id,
                document_id=document_id,
                document_name=document.document_name,
                status=ProcessingState.queued,
                processing_progress=0.0,
                current_operation="queued",
                metadata=metadata,
                updated_at=now,
            )
            statuses[document_id] = status
            uploaded_files.append(status)

        with self._lock:
            self._jobs[job_id] = ProcessingJobRecord(
                job_id=job_id,
                case_id=case_id,
                folder_name=folder_name,
                user_id=user_id,
                status=ProcessingState.queued,
                submitted_at=now,
                updated_at=now,
                documents=statuses,
            )
            self._latest_job_by_case[case_id] = job_id
            self._jobs_by_case.setdefault(case_id, []).append(job_id)

        logger.info(
            "[Agent:DocumentClassificationAgent] status=queued task=parallel_document_processing case_id=%s job_id=%s queued_documents=%s",
            case_id,
            job_id,
            len(db_ready_documents),
        )
        self._job_queue.submit(self._run_job, job_id, case_id, db_ready_documents)
        return UploadBatchResponse(
            success=True,
            folderName=folder_name,
            case_id=case_id,
            job_id=job_id,
            queued_count=len(db_ready_documents),
            uploadedFiles=uploaded_files,
            message="Documents queued successfully for parallel processing.",
        )

    def store_documents(
        self,
        user_id: str,
        folder_name: str,
        documents: list[DocumentReference],
    ) -> dict[str, Any]:
        """Persist uploaded files as plain storage — no OCR/chunking/embedding pipeline.

        Used by the Case Storage flow: files land in GCS + user_files with status
        'uploaded' and never enter the processing queue, so they stay invisible to
        case chat / extraction and cost nothing to store.
        """
        uploaded_files: list[dict[str, Any]] = []
        if is_db_available():
            try:
                with get_db_connection() as conn, conn.cursor() as cur:
                    for document in documents:
                        db_file_id = self._create_db_file_record(
                            cur,
                            user_id=str(user_id),
                            folder_name=folder_name,
                            document=document,
                            status="uploaded",
                            processing_progress=100,
                        )
                        uploaded_files.append(
                            {
                                "id": db_file_id,
                                "file_id": db_file_id,
                                "document_name": document.document_name,
                                "originalname": document.document_name,
                                "mimetype": document.mime_type,
                                "size": int(document.metadata.get("size") or 0),
                                "status": "uploaded",
                                "processing_progress": 100,
                            }
                        )
                    conn.commit()
            except Exception as exc:
                logger.warning(
                    "[FolderService] task=store_documents status=db_error user_id=%s folder=%s error=%s",
                    user_id,
                    folder_name,
                    exc,
                )
        logger.info(
            "[FolderService] task=store_documents status=saved user_id=%s folder=%s files=%s",
            user_id,
            folder_name,
            len(uploaded_files),
        )
        return {
            "success": True,
            "folderName": folder_name,
            "uploadedFiles": uploaded_files,
            "documents": uploaded_files,
            "message": "Documents uploaded to storage (no processing).",
        }

    def create_external_document(
        self,
        user_id: str,
        folder_name: str,
        provider: str,
        external_id: str,
        title: str,
        mimetype: str,
        extra_metadata: dict[str, Any] | None = None,
        gcs_path: str | None = None,
        size: int = 0,
    ) -> dict[str, Any]:
        """Link an editor-backed document (Google Docs / Zoho Writer) into a Case
        Storage folder. Google docs are pointers (gcs_path 'external://…', which
        delete_file skips); Zoho docs pass a real gs:// path since their DOCX
        lives in our bucket and editor sessions/saves go through it.
        """
        if not is_db_available():
            raise ValueError("Database unavailable")
        file_id = str(uuid.uuid4())
        doc_metadata = {"provider": provider, "external_id": str(external_id), **(extra_metadata or {})}
        with get_db_connection() as conn, conn.cursor() as cur:
            file_columns = self._get_table_columns(cur, "user_files")
            payload: dict[str, Any] = {
                "id": file_id,
                "user_id": str(user_id),
                "originalname": title,
                "gcs_path": gcs_path or f"external://{provider}/{external_id}",
                "folder_path": (folder_name or "").strip().strip("/") or None,
                "mimetype": mimetype,
                "size": int(size or 0),
                "is_folder": False,
                "status": "external",
                "processing_progress": 100,
            }
            if "metadata" in file_columns:
                payload["metadata"] = json.dumps(doc_metadata)
            insert_columns = [column for column in payload if column in file_columns]
            if "created_at" in file_columns:
                insert_columns.append("created_at")
            placeholders = ["NOW()" if column == "created_at" else "%s" for column in insert_columns]
            values = [payload[column] for column in insert_columns if column != "created_at"]
            cur.execute(
                f"INSERT INTO user_files ({', '.join(insert_columns)}) VALUES ({', '.join(placeholders)})",
                values,
            )
            conn.commit()
        logger.info(
            "[FolderService] task=create_external_document user_id=%s folder=%s provider=%s id=%s",
            user_id, folder_name, provider, file_id,
        )
        return {
            "success": True,
            "file": {
                "id": file_id,
                "name": title,
                "originalname": title,
                "mimetype": mimetype,
                "size": int(size or 0),
                "status": "external",
                "processing_progress": 100,
                "metadata": doc_metadata,
                "created_at": datetime.now(tz=UTC).isoformat(),
            },
        }

    def get_external_document(self, file_id: str, user_id: str | None) -> dict[str, Any]:
        """Fetch an external-document row (with metadata) for the editor-session endpoint."""
        if not is_db_available():
            raise ValueError("Database unavailable")
        accessible_user_ids = self._get_accessible_user_ids(user_id) if user_id else []
        if not accessible_user_ids:
            raise ValueError("File not found or access denied.")
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, originalname, mimetype, status, metadata, gcs_path, user_id
                FROM user_files
                WHERE id::text = %s AND is_folder = false
                  AND user_id::text = ANY(%s::text[])
                LIMIT 1
                """,
                [str(file_id), [str(u) for u in accessible_user_ids]],
            )
            row = cur.fetchone()
        if not row:
            raise ValueError("File not found or access denied.")
        if (row.get("status") or "") != "external" or not row.get("metadata"):
            raise ValueError("Not an external editor document.")
        return {
            "id": str(row["id"]),
            "name": row.get("originalname"),
            "mimetype": row.get("mimetype"),
            "metadata": row.get("metadata"),
            "gcs_path": row.get("gcs_path"),
            "user_id": str(row.get("user_id")),
        }

    def get_external_document_by_id(self, file_id: str) -> dict[str, Any]:
        """Unauthenticated lookup for the Zoho save-callback (Zoho's servers call it;
        the unguessable UUID is the credential, and writes only touch the row's own object)."""
        if not is_db_available():
            raise ValueError("Database unavailable")
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, originalname, gcs_path, status, metadata
                FROM user_files
                WHERE id::text = %s AND is_folder = false AND status = 'external'
                LIMIT 1
                """,
                [str(file_id)],
            )
            row = cur.fetchone()
        if not row:
            raise ValueError("External document not found")
        return {
            "id": str(row["id"]),
            "name": row.get("originalname"),
            "gcs_path": row.get("gcs_path"),
            "metadata": row.get("metadata"),
        }

    def prepare_chat_snapshot(self, file_id: str, user_id: str) -> dict[str, Any]:
        """Make an editor-backed document (Google Doc / Zoho DOCX) chattable.

        The chat service reads user_files.gcs_path raw bytes, which works only
        for formats the LLM ingests (PDF/text). Google Docs live in Drive and
        Zoho files are DOCX, so we snapshot: export/convert the CURRENT content
        into a hidden sibling user_files row (folder_path NULL keeps it out of
        every folder listing) and refresh it on each call. Returns
        {chat_file_id, name} — chat history keys off the stable snapshot row.
        """
        from app.services.adapters import external_editors, gcs

        record = self.get_external_document(file_id, user_id)
        metadata = record.get("metadata") or {}
        provider = (metadata.get("provider") or "").lower()

        if provider == "google":
            google_file_id = metadata.get("google_file_id") or metadata.get("external_id")
            if not google_file_id:
                raise ValueError("Missing Google file id on document")
            content = external_editors.export_google_doc_pdf(record["user_id"], google_file_id)
            ext, mimetype = "pdf", "application/pdf"
        elif provider == "zoho":
            gcs_path = record.get("gcs_path") or ""
            if not gcs_path.startswith("gs://"):
                raise ValueError("Zoho document has no storage object")
            docx_bytes = gcs.download_bytes(gcs_path)
            text = external_editors.extract_docx_text(docx_bytes)
            if not text.strip():
                text = "(The document is currently empty.)"
            content = text.encode("utf-8")
            ext, mimetype = "txt", "text/plain"
        else:
            raise ValueError(f"Unknown provider '{provider}'")

        snapshot_key = f"{record['user_id']}/documents/.chat-snapshots/{file_id}.{ext}"
        gcs.upload_bytes(content, snapshot_key, content_type=mimetype)

        snapshot_id = metadata.get("chat_snapshot_id")
        with get_db_connection() as conn, conn.cursor() as cur:
            existing = None
            if snapshot_id:
                cur.execute("SELECT id FROM user_files WHERE id::text = %s", [str(snapshot_id)])
                existing = cur.fetchone()
            if existing:
                cur.execute(
                    "UPDATE user_files SET size = %s, mimetype = %s, gcs_path = %s, updated_at = NOW() WHERE id::text = %s",
                    [len(content), mimetype, snapshot_key, str(snapshot_id)],
                )
            else:
                snapshot_id = str(uuid.uuid4())
                cur.execute(
                    """
                    INSERT INTO user_files
                        (id, user_id, originalname, gcs_path, folder_path, mimetype, size,
                         is_folder, status, processing_progress, metadata, created_at)
                    VALUES (%s, %s, %s, %s, NULL, %s, %s, false, 'uploaded', 100, %s, NOW())
                    """,
                    [
                        snapshot_id,
                        str(record["user_id"]),
                        f"{record.get('name') or 'document'}",
                        snapshot_key,
                        mimetype,
                        len(content),
                        json.dumps({"snapshot_of": str(file_id)}),
                    ],
                )
                new_meta = {**metadata, "chat_snapshot_id": snapshot_id}
                cur.execute(
                    "UPDATE user_files SET metadata = %s WHERE id::text = %s",
                    [json.dumps(new_meta), str(file_id)],
                )
            conn.commit()
        logger.info(
            "[FolderService] task=prepare_chat_snapshot file=%s provider=%s snapshot=%s bytes=%d",
            file_id, provider, snapshot_id, len(content),
        )
        return {"chat_file_id": str(snapshot_id), "name": record.get("name")}

    def update_external_document_content(self, file_id: str, size: int) -> None:
        """After a Zoho save-callback overwrote the GCS object, record the new size."""
        if not is_db_available():
            return
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE user_files SET size = %s, updated_at = NOW() WHERE id::text = %s",
                [int(size), str(file_id)],
            )
            conn.commit()

    def rename_storage_folder(self, user_id: str, folder_id: str, new_name: str) -> dict[str, Any]:
        """Rename a Case Storage folder (folder_path='case-storage') and re-point its files.

        Files store the short folder name in folder_path, so they must follow the rename
        or the folder's listing goes empty. GCS objects are NOT moved — file-level
        gcs_path stays valid and is what signed view/download URLs use.
        """
        safe_new = re.sub(r"[^a-zA-Z0-9._-]", "_", (new_name or "").strip().strip("/"))
        if not safe_new:
            raise ValueError("Folder name cannot be empty")
        if not is_db_available():
            raise ValueError("Database unavailable")
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, originalname FROM user_files
                WHERE id = %s AND user_id::text = %s AND is_folder = true AND folder_path = 'case-storage'
                """,
                [folder_id, str(user_id)],
            )
            row = cur.fetchone()
            if not row:
                raise ValueError("Storage folder not found")
            old_name = row["originalname"]
            if old_name != safe_new:
                cur.execute(
                    """
                    SELECT 1 FROM user_files
                    WHERE user_id::text = %s AND is_folder = true
                      AND folder_path = 'case-storage' AND originalname = %s
                    """,
                    [str(user_id), safe_new],
                )
                if cur.fetchone():
                    raise ValueError("A folder with this name already exists")
                cur.execute("UPDATE user_files SET originalname = %s WHERE id = %s", [safe_new, folder_id])
                cur.execute(
                    """
                    UPDATE user_files SET folder_path = %s
                    WHERE user_id::text = %s AND is_folder = false AND folder_path = %s
                    """,
                    [safe_new, str(user_id), old_name],
                )
                conn.commit()
        logger.info(
            "[FolderService] task=rename_storage_folder user_id=%s folder_id=%s old=%s new=%s",
            user_id, folder_id, old_name, safe_new,
        )
        return {"success": True, "folder": {"id": folder_id, "name": safe_new, "previous_name": old_name}}

    def get_queue_status(self) -> dict:
        """Return current processing queue depth and worker count."""
        return self._job_queue.status()

    def create_folder(self, user_id: str, folder_name: str, parent_path: str = "") -> dict[str, Any]:
        # Sanitize folder name — same logic as document-service sanitizeName()
        safe_folder_name = re.sub(r"[^a-zA-Z0-9._-]", "_", folder_name.strip().strip("/"))
        clean_parent_path = parent_path.strip("/") if parent_path else ""

        # Build GCS path like document-service createFolderInternal
        folder_path_for_gcs = (
            f"{clean_parent_path}/{safe_folder_name}".strip("/")
            if clean_parent_path
            else safe_folder_name
        )
        gcs_path = f"{user_id}/documents/{folder_path_for_gcs}/"
        folder_id = str(uuid.uuid4())

        if is_db_available():
            try:
                with get_db_connection() as conn, conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO user_files
                            (id, user_id, originalname, gcs_path, folder_path,
                             mimetype, size, is_folder, status, processing_progress, created_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                        """,
                        [
                            folder_id,
                            user_id,
                            safe_folder_name,
                            gcs_path,
                            clean_parent_path or None,  # store parent path (not full path) — matches document-service
                            "folder/x-directory",
                            0,
                            True,
                            "processed",
                            100,
                        ],
                    )
                    conn.commit()
                logger.info(
                    "[FolderService] task=create_folder status=saved user_id=%s folder=%s id=%s",
                    user_id,
                    safe_folder_name,
                    folder_id,
                )
            except Exception as exc:
                logger.warning(
                    "[FolderService] task=create_folder status=db_error user_id=%s folder=%s error=%s",
                    user_id,
                    safe_folder_name,
                    exc,
                )

        # Also ensure in-memory entry for current session — but never for Case Storage
        # folders: the in-memory record doubles as a "case" in the no-DB fallbacks of
        # list_folders/list_cases, and storage folders must never surface as cases.
        if clean_parent_path != "case-storage":
            self._ensure_case(user_id, folder_name)

        return {
            "success": True,
            "folder": {
                "id": folder_id,
                "name": safe_folder_name,
                "originalname": safe_folder_name,
                "path": folder_path_for_gcs,
                "case_title": folder_name,
                "gcs_path": gcs_path,
                "created_at": datetime.now(tz=UTC).isoformat(),
                "document_count": 0,
            },
        }

    def _truncate_case_value(self, value: Any, limit: int = 100) -> str | None:
        if value is None:
            return None
        text = str(value)
        return text[:limit] if len(text) > limit else text

    @staticmethod
    def _normalize_date(value: Any) -> str | None:
        """
        Normalize any date string to YYYY-MM-DD for PostgreSQL.

        Handles:
          YYYY-MM-DD  → returned as-is
          DD/MM/YYYY  → converted  (Indian / European format)
          DD-MM-YYYY  → converted
          MM/DD/YYYY  → converted when day part > 12 (unambiguous)
          ISO 8601 with time component → date part extracted
          None / empty / unparseable  → None
        """
        if not value:
            return None
        raw = str(value).strip()
        if not raw:
            return None

        # Already ISO format YYYY-MM-DD (possibly with time)
        if len(raw) >= 10 and raw[4] == "-":
            return raw[:10]  # truncate time component if present

        # Try DD/MM/YYYY or DD-MM-YYYY
        for sep in ("/", "-"):
            if sep in raw:
                parts = raw.split(sep)
                if len(parts) == 3:
                    a, b, c = parts[0].strip(), parts[1].strip(), parts[2].strip()
                    # Detect YYYY at position 0 (YYYY/MM/DD)
                    if len(a) == 4 and a.isdigit():
                        return f"{a}-{b.zfill(2)}-{c.zfill(2)}"
                    # Detect YYYY at position 2 (DD/MM/YYYY or MM/DD/YYYY)
                    if len(c) == 4 and c.isdigit():
                        day_or_month = int(a) if a.isdigit() else 0
                        # If first part > 12 it must be the day (DD/MM/YYYY)
                        # For Indian dates always treat as DD/MM/YYYY
                        return f"{c}-{b.zfill(2)}-{a.zfill(2)}"

        # Last resort: let Python's datetime parse it
        try:
            from datetime import datetime as _dt
            return _dt.strptime(raw, "%d %b %Y").strftime("%Y-%m-%d")
        except Exception:
            pass

        logger.warning("[FolderService] Could not normalize date value=%r — storing NULL", raw)
        return None

    def _get_table_columns(self, cur: Any, table_name: str) -> set[str]:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            """,
            [table_name],
        )
        return {row["column_name"] for row in cur.fetchall()}

    def _build_case_db_payload(self, case_data: dict[str, Any], *, default_status: str = "Active") -> dict[str, Any]:
        nd = self._normalize_date
        return {
            "case_title": self._truncate_case_value(case_data.get("case_title") or "Untitled Case", 255),
            "case_number": self._truncate_case_value(case_data.get("case_number"), 255),
            "filing_date": nd(case_data.get("filing_date")),
            "case_type": self._truncate_case_value(case_data.get("case_type") or "", 100),
            "sub_type": self._truncate_case_value(case_data.get("sub_type"), 100),
            "court_name": self._truncate_case_value(case_data.get("court_name") or "", 255),
            "court_level": self._truncate_case_value(case_data.get("court_level"), 100),
            "bench_division": self._truncate_case_value(case_data.get("bench_division"), 100),
            "jurisdiction": self._truncate_case_value(case_data.get("jurisdiction"), 100),
            "state": self._truncate_case_value(case_data.get("state"), 100),
            "judges": json.dumps(case_data["judges"]) if case_data.get("judges") else None,
            "court_room_no": self._truncate_case_value(case_data.get("court_room_no"), 50),
            "petitioners": json.dumps(case_data["petitioners"]) if case_data.get("petitioners") else None,
            "respondents": json.dumps(case_data["respondents"]) if case_data.get("respondents") else None,
            "category_type": self._truncate_case_value(case_data.get("category_type"), 100),
            "primary_category": self._truncate_case_value(case_data.get("primary_category"), 100),
            "sub_category": self._truncate_case_value(case_data.get("sub_category"), 100),
            "complexity": self._truncate_case_value(case_data.get("complexity"), 50),
            "monetary_value": case_data.get("monetary_value"),
            "priority_level": self._truncate_case_value(case_data.get("priority_level"), 50),
            "status": self._truncate_case_value(case_data.get("status") or default_status, 50),
            "case_prefix": self._truncate_case_value(case_data.get("case_prefix"), 100),
            "case_year": int(case_data["case_year"]) if case_data.get("case_year") else None,
            "case_nature": self._truncate_case_value(case_data.get("case_nature"), 100),
            "next_hearing_date": nd(case_data.get("next_hearing_date")),
            "document_type": self._truncate_case_value(case_data.get("document_type"), 100),
            "filed_by": self._truncate_case_value(case_data.get("filed_by"), 100),
        }

    def _migrate_temp_files_to_case_folder(
        self,
        cur: Any,
        *,
        user_id: str,
        temp_folder_name: str | None,
        target_folder_path: str,
        target_gcs_prefix: str,
    ) -> int:
        temp_name = (temp_folder_name or "").strip().strip("/")
        if not temp_name:
            return 0

        legacy_temp_gcs_prefix = f"{user_id}/documents/{temp_name}/"
        cur.execute(
            """
            UPDATE user_files
            SET
                folder_path = CASE
                    WHEN folder_path = %s THEN %s
                    WHEN folder_path LIKE %s THEN %s || substring(folder_path FROM %s)
                    ELSE folder_path
                END,
                gcs_path = CASE
                    WHEN gcs_path LIKE %s THEN %s || substring(gcs_path FROM %s)
                    ELSE gcs_path
                END,
                updated_at = NOW()
            WHERE user_id::text = %s
              AND is_folder = false
              AND (
                  folder_path = %s
                  OR folder_path LIKE %s
                  OR gcs_path LIKE %s
              )
            """,
            [
                temp_name,
                target_folder_path,
                f"{temp_name}/%",
                target_folder_path,
                len(temp_name) + 1,
                f"{legacy_temp_gcs_prefix}%",
                target_gcs_prefix,
                len(legacy_temp_gcs_prefix) + 1,
                user_id,
                temp_name,
                f"{temp_name}/%",
                f"{legacy_temp_gcs_prefix}%",
            ],
        )
        return cur.rowcount or 0

    def _build_file_storage_key(self, user_id: str, folder_name: str, document_name: str) -> str:
        safe_file_name = document_name.replace("\\", "_").replace("/", "_")
        clean_folder_name = (folder_name or "").strip().strip("/")

        # Strip leading "{user_id}/" if folder_name already includes it
        if clean_folder_name.startswith(f"{user_id}/"):
            clean_folder_name = clean_folder_name[len(user_id) + 1:]

        # Strip leading "cases/" or "documents/" prefix — the builder adds
        # "documents/" itself; "cases/" is a Node.js-service internal prefix
        for prefix in ("cases/", "documents/"):
            if clean_folder_name.startswith(prefix):
                clean_folder_name = clean_folder_name[len(prefix):]
                break

        return f"{user_id}/documents/{clean_folder_name}/{safe_file_name}"

    def _build_text_summary(self, text: str | None, limit: int = 500) -> str | None:
        if not text:
            return None
        clean = " ".join(str(text).split())
        if len(clean) <= limit:
            return clean
        return clean[: limit - 3].rstrip() + "..."

    def _create_db_file_record(
        self,
        cur: Any,
        *,
        user_id: str,
        folder_name: str,
        document: DocumentReference,
        status: str = "queued",
        processing_progress: int = 0,
    ) -> str | None:
        file_columns = self._get_table_columns(cur, "user_files")
        if not file_columns:
            return None

        file_id = str(uuid.uuid4())
        # Legacy convention: user_files.gcs_path holds the RELATIVE object key —
        # consumers (e.g. the chat service) build gs://{bucket}/{gcs_path} themselves,
        # so a full gs:// URI here doubles the prefix and 404s.
        raw_gcs_path = document.metadata.get("gcs_path") or self._build_file_storage_key(
            str(user_id), folder_name, document.document_name
        )
        if raw_gcs_path.startswith("gs://"):
            raw_gcs_path = raw_gcs_path.split("/", 3)[3] if raw_gcs_path.count("/") >= 3 else raw_gcs_path
        insert_payload: dict[str, Any] = {
            "id": file_id,
            "user_id": user_id,
            "originalname": document.document_name,
            "gcs_path": raw_gcs_path,
            "folder_path": (folder_name or "").strip().strip("/") or None,
            "mimetype": document.mime_type or "application/octet-stream",
            "size": int(document.metadata.get("size") or 0),
            "is_folder": False,
            "status": status,
            "processing_progress": processing_progress,
        }
        insert_columns = [column for column in insert_payload.keys() if column in file_columns]
        if "created_at" in file_columns:
            insert_columns.append("created_at")
        placeholders = ["NOW()" if column == "created_at" else "%s" for column in insert_columns]
        values = [insert_payload[column] for column in insert_columns if column != "created_at"]
        cur.execute(
            f"""
            INSERT INTO user_files ({", ".join(insert_columns)})
            VALUES ({", ".join(placeholders)})
            """,
            values,
        )
        return file_id

    def _update_db_file_processing_state(
        self,
        *,
        file_id: str | None,
        status: str,
        processing_progress: float,
        stored_document_uri: str | None = None,
        extracted_text: str | None = None,
        summary: str | None = None,
        metadata: dict[str, Any] | None = None,
        current_operation: str | None = None,
    ) -> None:
        if not file_id or not is_db_available():
            return

        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                file_columns = self._get_table_columns(cur, "user_files")
                update_payload: dict[str, Any] = {
                    "status": status,
                    "processing_progress": processing_progress,
                }
                if current_operation is not None and "current_operation" in file_columns:
                    update_payload["current_operation"] = current_operation
                if stored_document_uri and "gcs_path" in file_columns:
                    update_payload["gcs_path"] = stored_document_uri
                if extracted_text is not None and "full_text_content" in file_columns:
                    update_payload["full_text_content"] = extracted_text
                if summary is not None and "summary" in file_columns:
                    update_payload["summary"] = summary
                if metadata is not None and "metadata" in file_columns:
                    update_payload["metadata"] = json.dumps(metadata)
                if "updated_at" in file_columns:
                    update_payload["updated_at"] = "__NOW__"

                assignments: list[str] = []
                params: list[Any] = []
                for column, value in update_payload.items():
                    if column not in file_columns:
                        continue
                    if value == "__NOW__":
                        assignments.append(f"{column} = NOW()")
                    else:
                        assignments.append(f"{column} = %s")
                        params.append(value)
                if not assignments:
                    return
                params.append(file_id)
                cur.execute(f"UPDATE user_files SET {', '.join(assignments)} WHERE id = %s", params)
                conn.commit()
        except Exception as exc:
            logger.warning(
                "[FolderService] task=update_db_file_processing_state status=warning file_id=%s error=%s",
                file_id,
                exc,
            )

    def _insert_case_row(self, cur: Any, insert_payload: dict[str, Any]) -> dict[str, Any]:
        """Insert one row into `cases`, guarding against a legacy CHECK constraint on
        `category_type` (which historically restricted it to Civil/Criminal/Commercial).

        The canonical schema drops that constraint so the free-text classifier value
        (e.g. "Revenue") persists like its sibling columns. This retry is defence-in-depth:
        if the constraint is still present on a given database, we roll back to a savepoint
        and retry once with `category_type` nulled, so case creation can never hard-fail on it.
        """
        def _execute(payload: dict[str, Any]) -> dict[str, Any]:
            columns = list(payload.keys())
            placeholders = ", ".join(["%s"] * len(columns))
            cur.execute(
                f"""
                INSERT INTO cases ({", ".join(columns)})
                VALUES ({placeholders})
                RETURNING *
                """,
                [payload[column] for column in columns],
            )
            return cur.fetchone()

        cur.execute("SAVEPOINT before_case_insert")
        try:
            row = _execute(insert_payload)
        except Exception as exc:
            constraint = getattr(getattr(exc, "diag", None), "constraint_name", None)
            if constraint != "cases_category_type_check":
                raise
            cur.execute("ROLLBACK TO SAVEPOINT before_case_insert")
            logger.warning(
                "[FolderService] cases.category_type=%r rejected by legacy CHECK %s; "
                "retrying with category_type=NULL (drop this constraint to persist the value)",
                insert_payload.get("category_type"), constraint,
            )
            row = _execute({**insert_payload, "category_type": None})
        cur.execute("RELEASE SAVEPOINT before_case_insert")
        return row

    def create_case(self, user_id: str, case_data: dict[str, Any]) -> dict[str, Any]:
        """Create a case record + linked user_files folder using document-service-compatible storage."""
        int_user_id: int | None = None
        try:
            int_user_id = int(user_id)
        except (TypeError, ValueError):
            raise ValueError(f"Invalid user_id: {user_id}")

        case_payload = self._build_case_db_payload(case_data)
        case_title = case_payload["case_title"]

        if not is_db_available():
            folder_result = self.create_folder(user_id, case_title or "Untitled Case")
            case_id = str(uuid.uuid4())
            self._ensure_case(user_id, case_id)
            self._rebind_intake_chronology(
                temp_folder_name=str(case_data.get("temp_folder_name") or ""),
                case_id=case_id,
                folder_name=case_title,
            )
            return {
                "message": "Case created successfully with folder",
                "case": {"id": case_id, "case_title": case_title, "user_id": user_id},
                "folder": folder_result.get("folder", {}),
            }

        with get_db_connection() as conn, conn.cursor() as cur:
            case_columns = self._get_table_columns(cur, "cases")
            insert_payload = {"user_id": int_user_id}
            insert_payload.update({key: value for key, value in case_payload.items() if key in case_columns})
            new_case = self._insert_case_row(cur, insert_payload)
            case_id = str(new_case["id"])

            safe_case_name = re.sub(r"[^a-zA-Z0-9._-]", "_", (case_title or "Untitled_Case").strip())
            parent_path = f"{user_id}/cases"
            folder_path_for_gcs = f"{parent_path}/{safe_case_name}"
            gcs_path = f"{user_id}/documents/{folder_path_for_gcs}/"
            folder_id = str(uuid.uuid4())
            cur.execute(
                """
                INSERT INTO user_files
                    (id, user_id, originalname, gcs_path, folder_path,
                     mimetype, size, is_folder, status, processing_progress, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                """,
                [
                    folder_id, int_user_id, safe_case_name, gcs_path, parent_path,
                    "folder/x-directory", 0, True, "processed", 100,
                ],
            )

            cur.execute(
                "UPDATE cases SET folder_id = %s WHERE id = %s RETURNING *",
                [folder_id, case_id],
            )
            updated_case = cur.fetchone()

            migrated_count = self._migrate_temp_files_to_case_folder(
                cur,
                user_id=str(user_id),
                temp_folder_name=case_data.get("temp_folder_name"),
                target_folder_path=folder_path_for_gcs,
                target_gcs_prefix=gcs_path,
            )
            conn.commit()

        self._rebind_intake_chronology(
            temp_folder_name=str(case_data.get("temp_folder_name") or ""),
            case_id=case_id,
            folder_name=safe_case_name,
        )

        # Controlled memory: anything written while this was still an intake
        # folder moves onto the real case key, then the case is seeded from what
        # creation established — the case form the advocate just confirmed, the
        # grounded chronology, and the migrated documents. Best-effort: a memory
        # failure must never fail case creation.
        try:
            from app.services.memory import repository as memory_repository
            from app.services.memory.seed import seed_case_memory

            temp_name = str(case_data.get("temp_folder_name") or "").strip().strip("/")
            if temp_name:
                memory_repository.rebind_case_key(temp_name, case_id, safe_case_name)
            case_documents = (self.get_documents_in_folder(safe_case_name, str(user_id)) or {}).get(
                "documents"
            ) or []
            seed_case_memory(
                case_id,
                folder_name=safe_case_name,
                user_id=str(user_id),
                case_row=dict(updated_case or new_case or {}),
                tree=self.get_chronology(case_id, folder_name=safe_case_name),
                files=case_documents,
            )
        except Exception as memory_exc:  # noqa: BLE001
            logger.warning(
                "[FolderService] task=create_case memory bind/seed skipped case_id=%s error=%s",
                case_id,
                memory_exc,
            )

        folder_dict = {
            "id": folder_id,
            "name": safe_case_name,
            "originalname": safe_case_name,
            "folder_path": parent_path,
            "gcs_path": gcs_path,
            "created_at": datetime.now(tz=UTC).isoformat(),
        }
        logger.info(
            "[FolderService] task=create_case status=created user_id=%s case_id=%s folder_id=%s migrated_files=%s",
            user_id, case_id, folder_id, migrated_count,
        )
        return {
            "message": "Case created successfully with folder",
            "case": self._get_case_from_db(case_id, user_id) or self._serialize_case_row(updated_case),
            "folder": folder_dict,
            "migrated_files": migrated_count,
        }

    def update_case(self, case_id: str, user_id: str, case_data: dict[str, Any]) -> dict[str, Any]:
        if not is_db_available():
            raise ValueError("Case updates require database connectivity.")

        accessible_user_ids = self._get_accessible_user_ids(user_id)
        text_user_ids = [str(value) for value in accessible_user_ids if value is not None]
        if not text_user_ids:
            raise ValueError(f"Case '{case_id}' not found.")

        case_payload = self._build_case_db_payload(case_data, default_status=case_data.get("status") or "Active")
        with get_db_connection() as conn, conn.cursor() as cur:
            case_columns = self._get_table_columns(cur, "cases")
            update_columns = [
                column for column, value in case_payload.items()
                if column in case_columns and value is not None
            ]
            if not update_columns:
                existing_case = self._get_case_from_db(case_id, user_id)
                if not existing_case:
                    raise ValueError(f"Case '{case_id}' not found.")
                return existing_case

            assignments = ", ".join(f"{column} = %s" for column in update_columns)
            values = [case_payload[column] for column in update_columns]
            if "updated_at" in case_columns:
                assignments = f"{assignments}, updated_at = NOW()"
            values.extend([case_id, text_user_ids])
            cur.execute(
                f"""
                UPDATE cases
                SET {assignments}
                WHERE id::text = %s
                  AND user_id::text = ANY(%s::text[])
                RETURNING *
                """,
                values,
            )
            updated_case = cur.fetchone()
            conn.commit()

        if not updated_case:
            raise ValueError(f"Case '{case_id}' not found.")
        return self._get_case_from_db(case_id, user_id) or self._serialize_case_row(updated_case)

    def _case_storage_summary(self, user_id: str | None, folders: list[dict[str, Any]]) -> dict[str, Any]:
        """Aggregate storage across ALL of the user's cases: uploaded files + case chat text."""
        files_bytes = sum(int(f.get("storage_bytes") or 0) for f in folders)
        file_count = sum(int(f.get("document_count") or 0) for f in folders)
        chat_bytes = 0
        if user_id:
            try:
                with get_db_connection() as conn, conn.cursor() as cur:
                    cur.execute(
                        """SELECT COALESCE(SUM(
                               OCTET_LENGTH(COALESCE(question, '')) +
                               OCTET_LENGTH(COALESCE(answer, ''))
                           ), 0)::bigint AS chat_bytes
                           FROM folder_chats WHERE user_id::text = %s""",
                        [str(user_id)],
                    )
                    row = cur.fetchone() or {}
                    chat_bytes = int(row.get("chat_bytes") or 0)
            except Exception as exc:
                logger.warning("[FolderService] case chat storage lookup failed: %s", exc)
        return {
            "files_bytes": files_bytes,
            "chat_bytes": chat_bytes,
            "total_bytes": files_bytes + chat_bytes,
            "case_count": len(folders),
            "file_count": file_count,
        }

    def list_folders(self, user_id: str | None = None, scope: str = "cases") -> dict[str, Any]:
        if is_db_available():
            db_folders = self._list_folders_from_db(user_id, scope=scope)
            logger.info(
                "[FolderService] task=list_folders source=db user_id=%s folder_count=%s",
                user_id,
                len(db_folders),
            )
            if db_folders:
                return {
                    "folders": db_folders,
                    "storage_summary": self._case_storage_summary(user_id, db_folders),
                }
            # Storage scope has no cases-table or in-memory equivalent — empty means empty.
            if scope == "storage":
                return {"folders": []}
            # Fallback: if user_files folders are missing, derive folder cards from cases table.
            case_folders = self._list_folders_from_cases_db(user_id)
            logger.info(
                "[FolderService] task=list_folders source=db-cases-fallback user_id=%s folder_count=%s",
                user_id,
                len(case_folders),
            )
            if case_folders:
                return {"folders": case_folders}
        folders: list[dict[str, Any]] = []
        for case_id, stored_case in self._pipeline._cases.items():
            folders.append(
                {
                    "id": case_id,
                    "name": case_id,
                    "case_title": stored_case.form_data.get("case_title") or case_id,
                    "folder_path": "",
                    "created_at": stored_case.created_at.isoformat(),
                    "children": [],
                }
            )
        folders.sort(key=lambda item: item["created_at"], reverse=True)
        logger.info(
            "[FolderService] task=list_folders source=memory user_id=%s folder_count=%s",
            user_id,
            len(folders),
        )
        return {"folders": folders}

    def list_cases(self, user_id: str | None = None) -> dict[str, Any]:
        if is_db_available():
            db_cases = self._list_cases_from_db(user_id)
            return {
                "message": "Cases fetched successfully.",
                "cases": db_cases,
                "totalCases": len(db_cases),
            }
        cases: list[dict[str, Any]] = []
        for case_id, stored_case in self._pipeline._cases.items():
            extracted = self._extracted_by_case.get(case_id, {})
            case_title = extracted.get("caseTitle") or stored_case.form_data.get("case_title") or case_id
            cases.append(
                {
                    "id": case_id,
                    "folder_id": case_id,
                    "case_title": case_title,
                    "case_number": extracted.get("caseNumber") or stored_case.form_data.get("case_number"),
                    "case_type": extracted.get("caseType") or stored_case.form_data.get("case_type"),
                    "court_name": extracted.get("courtName") or stored_case.form_data.get("court_details"),
                    "jurisdiction": extracted.get("jurisdiction"),
                    "petitioners": [{"fullName": item} for item in extracted.get("petitioners", [])],
                    "respondents": [{"fullName": item} for item in extracted.get("respondents", [])],
                    "status": self._get_case_status(case_id),
                    "created_at": stored_case.created_at.isoformat(),
                }
            )
        cases.sort(key=lambda item: item["created_at"], reverse=True)
        return {
            "message": "Cases fetched successfully.",
            "cases": cases,
            "totalCases": len(cases),
        }

    def get_case(self, case_id: str, user_id: str | None = None) -> dict[str, Any]:
        if is_db_available():
            db_case = self._get_case_from_db(case_id, user_id)
            if db_case:
                db_case["chronology"] = self.get_chronology(
                    case_id, folder_name=str(db_case.get("folder_name") or "")
                ).as_dict()
                return db_case
        stored_case = self._pipeline._cases.get(case_id)
        if not stored_case:
            raise ValueError(f"Case '{case_id}' not found.")
        extracted = self._extracted_by_case.get(case_id, {})
        return {
            "id": case_id,
            "folder_id": case_id,
            "case_title": extracted.get("caseTitle") or stored_case.form_data.get("case_title") or case_id,
            "case_number": extracted.get("caseNumber") or stored_case.form_data.get("case_number"),
            "case_type": extracted.get("caseType") or stored_case.form_data.get("case_type"),
            "court_name": extracted.get("courtName") or stored_case.form_data.get("court_details"),
            "jurisdiction": extracted.get("jurisdiction"),
            "petitioners": [{"fullName": item} for item in extracted.get("petitioners", [])],
            "respondents": [{"fullName": item} for item in extracted.get("respondents", [])],
            "status": self._get_case_status(case_id),
            "chronology": self.get_chronology(case_id).as_dict(),
            "documents": [
                {
                    "document_id": document.document_id,
                    "document_name": document.document_name,
                    "doc_type": document.doc_type.value,
                    "stored_document_uri": document.stored_document_uri,
                }
                for document in stored_case.documents
            ],
            "created_at": stored_case.created_at.isoformat(),
        }

    def delete_case(self, case_id: str, user_id: str | None = None) -> dict[str, Any]:
        db_deleted = False
        db_counts: dict[str, int] = {}
        resolved_folder_name = case_id

        if is_db_available():
            accessible_user_ids = self._get_accessible_user_ids(user_id) if user_id else []
            text_user_ids = [str(value) for value in accessible_user_ids if value is not None]
            try:
                with get_db_connection() as conn, conn.cursor() as cur:
                    case_row = None
                    if text_user_ids:
                        cur.execute(
                            """
                            SELECT c.id, c.folder_id, uf.originalname AS folder_name, uf.folder_path, uf.gcs_path
                            FROM cases c
                            LEFT JOIN user_files uf ON uf.id = c.folder_id
                            WHERE c.id::text = %s AND c.user_id::text = ANY(%s::text[])
                            LIMIT 1
                            """,
                            [str(case_id), text_user_ids],
                        )
                    else:
                        cur.execute(
                            """
                            SELECT c.id, c.folder_id, uf.originalname AS folder_name, uf.folder_path, uf.gcs_path
                            FROM cases c
                            LEFT JOIN user_files uf ON uf.id = c.folder_id
                            WHERE c.id::text = %s
                            LIMIT 1
                            """,
                            [str(case_id)],
                        )
                    case_row = cur.fetchone()

                    folder_row = None
                    if case_row and case_row.get("folder_id"):
                        folder_row = {
                            "id": str(case_row.get("folder_id")),
                            "originalname": case_row.get("folder_name"),
                            "folder_path": case_row.get("folder_path") or "",
                            "gcs_path": case_row.get("gcs_path"),
                        }
                    else:
                        if text_user_ids:
                            cur.execute(
                                """
                                SELECT id, originalname, folder_path, gcs_path
                                FROM user_files
                                WHERE is_folder = true
                                  AND originalname = %s
                                  AND user_id::text = ANY(%s::text[])
                                ORDER BY created_at DESC
                                LIMIT 1
                                """,
                                [str(case_id), text_user_ids],
                            )
                        else:
                            cur.execute(
                                """
                                SELECT id, originalname, folder_path, gcs_path
                                FROM user_files
                                WHERE is_folder = true
                                  AND originalname = %s
                                ORDER BY created_at DESC
                                LIMIT 1
                                """,
                                [str(case_id)],
                            )
                        folder_row = cur.fetchone()
                        if folder_row:
                            if text_user_ids:
                                cur.execute(
                                    "SELECT id FROM cases WHERE folder_id::text = %s AND user_id::text = ANY(%s::text[]) LIMIT 1",
                                    [str(folder_row.get("id")), text_user_ids],
                                )
                            else:
                                cur.execute(
                                    "SELECT id FROM cases WHERE folder_id::text = %s LIMIT 1",
                                    [str(folder_row.get("id"))],
                                )
                            linked_case = cur.fetchone()
                            if linked_case:
                                case_row = {"id": linked_case.get("id"), "folder_id": folder_row.get("id")}

                    if not folder_row and not case_row:
                        raise ValueError(f"Case or folder '{case_id}' not found.")

                    folder_name = str((folder_row or {}).get("originalname") or case_id)
                    resolved_folder_name = folder_name
                    stored_path = str((folder_row or {}).get("folder_path") or "")
                    if folder_name and stored_path and not stored_path.endswith(folder_name):
                        full_folder_path = f"{stored_path}/{folder_name}".strip("/")
                    else:
                        full_folder_path = (stored_path or folder_name).strip("/")
                    gcs_prefix = (folder_row or {}).get("gcs_path")

                    file_query = """
                        SELECT id
                        FROM user_files
                        WHERE is_folder = false
                    """
                    file_params: list[Any] = []
                    path_conditions = [
                        "folder_path = %s",
                        "folder_path LIKE %s",
                    ]
                    file_params.extend([full_folder_path, f"{full_folder_path}/%"])
                    if gcs_prefix:
                        path_conditions.append("gcs_path LIKE %s")
                        file_params.append(f"{gcs_prefix}%")
                    file_query += f" AND ({' OR '.join(path_conditions)})"
                    if text_user_ids:
                        file_query += " AND user_id::text = ANY(%s::text[])"
                        file_params.append(text_user_ids)
                    cur.execute(file_query, file_params)
                    file_ids = [str(row["id"]) for row in cur.fetchall()]

                    if file_ids:
                        # file_chats has no ON DELETE CASCADE on user_files —
                        # clear per-file chats first or the row delete 500s.
                        cur.execute("DELETE FROM file_chats WHERE file_id::text = ANY(%s::text[])", [file_ids])
                        cur.execute("DELETE FROM chunk_vectors WHERE file_id::text = ANY(%s::text[])", [file_ids])
                        db_counts["chunk_vectors"] = cur.rowcount or 0
                        cur.execute("DELETE FROM file_chunks WHERE file_id::text = ANY(%s::text[])", [file_ids])
                        db_counts["file_chunks"] = cur.rowcount or 0
                        cur.execute("DELETE FROM user_files WHERE id::text = ANY(%s::text[])", [file_ids])
                        db_counts["files"] = cur.rowcount or 0
                    else:
                        db_counts["chunk_vectors"] = 0
                        db_counts["file_chunks"] = 0
                        db_counts["files"] = 0

                    cur.execute("DELETE FROM folder_chats WHERE folder_name = %s", [folder_name])
                    db_counts["folder_chats"] = cur.rowcount or 0

                    if folder_row and folder_row.get("id"):
                        cur.execute("DELETE FROM user_files WHERE id::text = %s", [str(folder_row.get("id"))])
                        db_counts["folder"] = cur.rowcount or 0
                    else:
                        db_counts["folder"] = 0

                    if case_row and case_row.get("id"):
                        cur.execute("DELETE FROM cases WHERE id::text = %s", [str(case_row.get("id"))])
                        db_counts["cases"] = cur.rowcount or 0
                    else:
                        db_counts["cases"] = 0

                    # Case memory is sensitive case data, so it goes with the case,
                    # in the same transaction. The keys cover every form this case's
                    # memory can sit under: the case id, the folder key, and a temp-*
                    # intake name. A plain folder name is never a memory key, so it is
                    # deliberately not used. Each table is purged under its own
                    # savepoint inside purge_case_keys, so a database without the
                    # memory tables still deletes the case.
                    memory_keys: list[str] = []
                    if case_row and case_row.get("id"):
                        memory_keys.append(str(case_row.get("id")))
                    if folder_row and folder_row.get("id"):
                        memory_keys.append(f"folder:{folder_row.get('id')}")
                    for intake_name in {str(case_id or "").strip(), str(resolved_folder_name or "").strip()}:
                        if intake_name.lower().startswith("temp-"):
                            memory_keys.append(intake_name)
                    if memory_keys:
                        try:
                            from app.services.memory.repository import purge_case_keys

                            for table, count in purge_case_keys(cur, memory_keys).items():
                                db_counts[f"memory_{table}"] = count
                        except Exception as memory_exc:  # noqa: BLE001
                            # Rows left under a deleted case id or folder key cannot
                            # be reached again (neither is ever reused), so a failed
                            # purge is logged rather than allowed to block the delete.
                            logger.warning(
                                "[FolderService] task=delete_case memory purge failed keys=%s error=%s",
                                memory_keys,
                                memory_exc,
                            )

                    conn.commit()
                    db_deleted = any(value > 0 for value in db_counts.values())
            except Exception as exc:
                logger.exception("[FolderService] task=delete_case status=db_error case_id=%s error=%s", case_id, exc)
                raise

        with self._lock:
            existed = self._pipeline._cases.pop(case_id, None)
            self._pipeline._cases.pop(resolved_folder_name, None)
            self._extracted_by_case.pop(case_id, None)
            self._extracted_by_case.pop(resolved_folder_name, None)
            self._chronology_by_case.pop(case_id, None)
            self._chronology_by_case.pop(resolved_folder_name, None)
            self._sessions.pop(case_id, None)
            self._sessions.pop(resolved_folder_name, None)
        delete_tree(case_id, resolved_folder_name)

        return {
            "success": True,
            "deleted": bool(existed) or db_deleted,
            "deleted_counts": db_counts,
            "folder_name": resolved_folder_name,
        }

    @staticmethod
    def _parse_dt(value: Any) -> datetime:
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=UTC)
        text = str(value or "").strip()
        if not text:
            return datetime.now(tz=UTC)
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00"))
        except Exception:
            return datetime.now(tz=UTC)

    def _build_processing_status_from_db(
        self,
        folder_name: str,
        user_id: str | None = None,
    ) -> FolderProcessingStatusResponse | None:
        if not is_db_available():
            return None
        rows = self._get_documents_in_folder_from_db(folder_name, user_id)
        if rows is None:
            return None

        documents: list[QueuedDocumentStatus] = []
        for row in rows:
            raw_status = str(row.get("status") or ProcessingState.queued.value).strip().lower()
            try:
                status = ProcessingState(raw_status)
            except Exception:
                status = ProcessingState.queued
            documents.append(
                QueuedDocumentStatus(
                    id=str(row.get("id") or ""),
                    file_id=str(row.get("id") or ""),
                    document_id=str(row.get("id") or ""),
                    document_name=str(row.get("originalname") or row.get("name") or "document"),
                    status=status,
                    processing_progress=float(row.get("processing_progress") or 0.0),
                    current_operation=None,
                    metadata={},
                    updated_at=self._parse_dt(row.get("updated_at") or row.get("created_at")),
                )
            )

        documents = sorted(documents, key=lambda item: item.document_name.lower())
        total = len(documents)
        processed = sum(1 for item in documents if item.status == ProcessingState.processed)
        failed = sum(1 for item in documents if item.status == ProcessingState.error)
        processing = sum(1 for item in documents if item.status in {ProcessingState.processing, ProcessingState.embedding_pending})
        queued = sum(1 for item in documents if item.status == ProcessingState.queued)
        progress = round(sum(item.processing_progress for item in documents) / total, 2) if total else 0.0

        if processing > 0 or queued > 0:
            folder_status: ProcessingState | str = ProcessingState.processing
        elif total > 0 and processed > 0:
            folder_status = ProcessingState.processed
        elif total > 0 and failed == total:
            folder_status = ProcessingState.error
        else:
            folder_status = ProcessingState.queued

        updated_at = max((item.updated_at for item in documents), default=datetime.now(tz=UTC))
        return FolderProcessingStatusResponse(
            folderName=folder_name,
            case_id=folder_name,
            job_id=None,
            status=folder_status,
            progress=progress,
            total_documents=total,
            processed_documents=processed,
            failed_documents=failed,
            documents=documents,
            updated_at=updated_at,
        )

    def get_processing_status(self, folder_name: str, user_id: str | None = None) -> FolderProcessingStatusResponse:
        case_id = folder_name
        with self._lock:
            latest_job_id = self._latest_job_by_case.get(case_id)
            job_ids = list(self._jobs_by_case.get(case_id) or ([latest_job_id] if latest_job_id else []))
            jobs = [self._jobs[jid] for jid in job_ids if jid in self._jobs]
        if not jobs:
            db_status = self._build_processing_status_from_db(folder_name, user_id=user_id)
            if db_status is not None:
                return db_status
            return FolderProcessingStatusResponse(
                folderName=folder_name,
                case_id=case_id,
                job_id=None,
                status=ProcessingState.queued,
                progress=0.0,
                total_documents=0,
                processed_documents=0,
                failed_documents=0,
                documents=[],
                updated_at=datetime.now(tz=UTC),
            )

        # Aggregate documents across ALL of the case's jobs — the signed-URL
        # upload flow enqueues one single-document job per file, so the latest
        # job alone would report only the last uploaded file. Dedupe by file id,
        # freshest update wins; then let DB rows fill in any files the memory
        # jobs don't know about (e.g. queued before a service restart).
        merged: dict[str, QueuedDocumentStatus] = {}
        for job in jobs:
            for doc in job.documents.values():
                key = str(doc.file_id or doc.document_id)
                existing = merged.get(key)
                if existing is None or doc.updated_at >= existing.updated_at:
                    merged[key] = doc
        db_status = self._build_processing_status_from_db(folder_name, user_id=user_id)
        if db_status is not None:
            for doc in db_status.documents:
                merged.setdefault(str(doc.file_id or doc.document_id), doc)

        documents = sorted(merged.values(), key=lambda item: item.document_name.lower())
        total = len(documents)
        processed = sum(1 for item in documents if item.status == ProcessingState.processed)
        failed = sum(1 for item in documents if item.status == ProcessingState.error)
        in_flight = any(
            item.status in {ProcessingState.queued, ProcessingState.processing, ProcessingState.embedding_pending}
            for item in documents
        )
        if in_flight:
            folder_status = ProcessingState.processing
        elif total > 0 and failed == total:
            folder_status = ProcessingState.error
        elif total > 0:
            folder_status = ProcessingState.processed
        else:
            folder_status = ProcessingState.queued
        progress = round(sum(item.processing_progress for item in documents) / total, 2) if total else 0.0
        updated_at = max(
            (item.updated_at for item in documents),
            default=max(job.updated_at for job in jobs),
        )
        return FolderProcessingStatusResponse(
            folderName=folder_name,
            case_id=case_id,
            job_id=latest_job_id,
            status=folder_status,
            progress=progress,
            total_documents=total,
            processed_documents=processed,
            failed_documents=failed,
            documents=documents,
            updated_at=updated_at,
        )

    def _ocr_structured_pages(self, file_id: str) -> dict[str, Any] | None:
        if not file_id or not is_db_available():
            return None
        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT structured_schema, raw_response
                    FROM document_ai_extractions
                    WHERE file_id::text = %s
                    ORDER BY processed_at DESC NULLS LAST
                    LIMIT 1
                    """,
                    [file_id],
                )
                row = cur.fetchone()
        except Exception:
            return None
        if not row:
            return None
        for key in ("structured_schema", "raw_response"):
            payload = row.get(key) if isinstance(row, dict) else None
            if isinstance(payload, str):
                try:
                    payload = json.loads(payload)
                except json.JSONDecodeError:
                    payload = None
            if isinstance(payload, dict) and payload.get("pages"):
                return payload
        return None

    def _paged_document_text(self, doc: Any) -> str:
        from app.services.chronology.pages import split_into_pages, text_with_page_markers

        text = str(getattr(doc, "text", "") or "")
        if split_into_pages(text):
            return text
        metadata = getattr(doc, "metadata", None) or {}
        file_id = str(
            metadata.get("db_file_id")
            or metadata.get("file_id")
            or getattr(doc, "document_id", "")
            or ""
        )
        marked = text_with_page_markers(self._ocr_structured_pages(file_id))
        return marked or text

    def extract_case_fields(self, folder_name: str) -> ExtractCaseFieldsResponse:
        from app.services.adapters.document_ai import _call_gemini_for_extraction
        case_id = folder_name
        stored_case = self._pipeline._cases.get(case_id)
        if not stored_case:
            raise ValueError(f"Case '{case_id}' does not exist.")
        extracted = dict(self._extracted_by_case.get(case_id, {}))
        tree = self.get_chronology(case_id, folder_name=folder_name)

        meaningful_fields = {"caseTitle", "caseNumber", "caseType", "courtName", "jurisdiction",
                             "filingDate", "petitioners", "respondents"}
        has_rich_data = len([k for k in extracted if k in meaningful_fields and extracted[k]]) >= 2
        needs_chronology = not tree.dates
        did_rebuild = False

        parts = []
        for doc in stored_case.documents:
            body = self._paged_document_text(doc)
            if body and len(body) > 50:
                parts.append(f"[Document: {doc.document_name}]\n{body}")
        combined_text = "\n\n---\n\n".join(parts)
        missing_pages = any(
            not event.sourcePage
            for node in tree.dates
            for event in node.events
        )
        from app.services.chronology.pages import split_into_pages

        if combined_text and split_into_pages(combined_text) and missing_pages:
            needs_chronology = True

        if (not has_rich_data or needs_chronology) and combined_text:
            started = time.perf_counter()
            from app.services.chronology.console import log_note

            log_progress(1, 5, "Rebuild from combined OCR", case=case_id, chars=f"{len(combined_text):,}")
            log_note(
                "[FolderService] extract-case-fields will re-read the full OCR "
                f"({len(combined_text):,} chars) so later pages are not missed"
            )
            log_progress(2, 5, "Send OCR to form_population_agent")
            gemini_data = _call_gemini_for_extraction(combined_text)
            if gemini_data:
                normalized = self._normalize_entities(gemini_data)
                for key, value in normalized.items():
                    if value and not extracted.get(key):
                        extracted[key] = value
                self._extracted_by_case[case_id] = extracted
                log_progress(3, 5, "Keep only dates and quotes that appear in the OCR")
                report = report_from_extraction(
                    gemini_data,
                    source_text=combined_text,
                    document_name="combined",
                )
                log_progress(
                    4, 5, "OCR majority vote + pin cites",
                    corrected=len(report.corrections),
                    cited=f"{report.pages_cited}/{report.kept}",
                )
                tree = merge_into_tree(tree, report.events)
                tree = refresh_tree(tree, combined_text)
                self._store_chronology(case_id, tree, folder_name=folder_name)
                did_rebuild = True
                log_progress(5, 5, "Merge unique dates + persist")
                log_run_report(
                    stage="extract-case-fields rebuild",
                    case_id=case_id,
                    document_name="combined",
                    chars=len(combined_text),
                    elapsed_s=time.perf_counter() - started,
                    fields_filled=len([k for k in extracted if extracted.get(k) and k != "chronology"]),
                    field_names=[k for k in extracted if extracted.get(k) and k != "chronology"],
                    kept_events=report.kept,
                    dropped_events=report.dropped,
                    drop_reasons=report.reasons,
                    tree=tree,
                    proposed_events=report.proposed,
                    corrections=report.corrections,
                    pages_cited=report.pages_cited,
                    pages_missing=report.pages_missing,
                    ocr_pages=report.ocr_pages,
                    swept_events=report.swept,
                )

        if not did_rebuild:
            if combined_text and tree.dates:
                tree = refresh_tree(tree, combined_text)
                self._store_chronology(case_id, tree, folder_name=folder_name)
            log_progress(4, 4, "Using stored chronology", dates=len(tree.dates), fields=len(extracted))
            log_run_report(
                stage="extract-case-fields cached",
                case_id=case_id,
                document_name="(stored)",
                chars=len(combined_text),
                elapsed_s=0.0,
                fields_filled=len([k for k in extracted if extracted.get(k)]),
                field_names=[k for k in extracted if extracted.get(k)],
                kept_events=tree.eventCount,
                dropped_events=0,
                drop_reasons=None,
                tree=tree,
                usage={
                    "model": "(no new LLM call)",
                    "provider": "-",
                    "inputTokens": 0,
                    "outputTokens": 0,
                    "totalTokens": 0,
                },
            )

        extracted = dict(extracted)
        extracted["chronology"] = tree.as_dict()
        return ExtractCaseFieldsResponse(
            success=True,
            folderName=folder_name,
            case_id=case_id,
            extractedData=extracted,
            requiresReview=not bool(extracted.get("caseNumber") or extracted.get("caseType")),
            sourceDocuments=[document.document_name for document in stored_case.documents],
            chronology=tree.as_dict(),
            message="Extracted case fields and chronology generated from processed folder documents.",
        )

    def get_chronology(self, case_key: str, folder_name: str | None = None) -> Any:
        key = str(case_key or "").strip()
        folder = str(folder_name or key).strip()
        tree = self._chronology_by_case.get(key) or self._chronology_by_case.get(folder)
        if tree is not None and getattr(tree, "dates", None):
            return tree
        loaded = load_or_empty(key, folder)
        if loaded.dates:
            self._chronology_by_case[key] = loaded
            return loaded
        return tree or empty_tree()

    def _store_chronology(self, case_key: str, tree: Any, folder_name: str | None = None) -> None:
        self._chronology_by_case[case_key] = tree
        if folder_name and folder_name != case_key:
            self._chronology_by_case[folder_name] = tree
        save_tree(case_key, tree, folder_name=folder_name or case_key)

    def _rebind_intake_chronology(
        self,
        *,
        temp_folder_name: str,
        case_id: str,
        folder_name: str | None,
    ) -> None:
        temp = str(temp_folder_name or "").strip().strip("/")
        if not temp or not case_id:
            return
        tree = self._chronology_by_case.get(temp) or load_or_empty(temp, temp)
        if tree.dates:
            self._chronology_by_case[case_id] = tree
            if folder_name:
                self._chronology_by_case[folder_name] = tree
            save_tree(case_id, tree, folder_name=folder_name or case_id)
        rebind_tree(temp, case_id, folder_name=folder_name or case_id)
        self._chronology_by_case.pop(temp, None)

    def _resolve_file_ids_for_folder_case(self, folder_name: str, user_id: str | None) -> list[str]:
        """
        When get_documents_in_folder returns no file ids, recover UUIDs so vector
        search still includes all indexed materials (PDFs, audio transcripts, etc.).
        """
        merged: list[str] = []

        stored_case = self._pipeline._cases.get(folder_name)
        if stored_case:
            for doc in stored_case.documents:
                did = str(getattr(doc, "document_id", "") or "").strip()
                if did and len(did) >= 32:
                    merged.append(did)

        if is_db_available() and user_id:
            accessible = self._get_accessible_user_ids(user_id)
            if accessible:
                try:
                    with get_db_connection() as conn, conn.cursor() as cur:
                        api_fn = ((folder_name or "").strip().strip("/") or None)
                        gcs_seg = f"/{api_fn}/" if api_fn else None
                        extra = ""
                        extra_vals: list[Any] = []
                        if api_fn and gcs_seg:
                            extra = """
                                  OR uf.folder_path = %s::text
                                  OR strpos(COALESCE(uf.gcs_path, ''), %s::text) > 0
                            """
                            extra_vals = [api_fn, gcs_seg]
                        cur.execute(
                            f"""
                            SELECT DISTINCT ON (uf.id) uf.id::text
                            FROM user_files uf
                            WHERE uf.user_id::text = ANY(%s::text[])
                              AND uf.is_folder = false
                              AND (
                                  uf.folder_path = %s
                                  OR uf.folder_path LIKE %s
                                  {extra}
                              )
                            ORDER BY uf.id ASC, uf.originalname ASC
                            """,
                            [
                                accessible,
                                folder_name,
                                f"{folder_name}/%",
                                *extra_vals,
                            ],
                        )
                        merged.extend([str(r["id"]) for r in cur.fetchall() if r.get("id")])
                except Exception as exc:
                    logger.warning(
                        "[FolderService] task=_resolve_file_ids_for_folder_case db_error folder=%s error=%s",
                        folder_name,
                        exc,
                    )

        # Stable de-dupe
        return list(dict.fromkeys([x for x in merged if x]))

    def get_documents_in_folder(self, folder_name: str, user_id: str | None = None) -> dict[str, Any]:
        if is_db_available():
            documents = self._get_documents_in_folder_from_db(folder_name, user_id)
            if documents is not None:
                return {
                    "message": f"Documents in folder '{folder_name}' fetched successfully.",
                    "folderName": folder_name,
                    "files": documents,
                    "documents": documents,
                    "totalDocuments": len(documents),
                }

        stored_case = self._pipeline._cases.get(folder_name)
        if not stored_case:
            return {
                "message": f"Documents in folder '{folder_name}' fetched successfully.",
                "folderName": folder_name,
                "documents": [],
                "totalDocuments": 0,
            }
        documents = [
            {
                "id": document.document_id,
                "name": document.document_name,
                "originalname": document.document_name,
                "mimetype": "application/octet-stream",
                "size": 0,
                "created_at": stored_case.created_at.isoformat(),
                "status": "processed",
                "processing_progress": 100.0,
                "folder_path": folder_name,
            }
            for document in stored_case.documents
        ]
        return {
            "message": f"Documents in folder '{folder_name}' fetched successfully.",
            "folderName": folder_name,
            "files": documents,
            "documents": documents,
            "totalDocuments": len(documents),
        }

    def answer_folder_chat(
        self,
        user_id: str,
        folder_name: str,
        request: FolderChatRequest,
        authorization: str | None = None,
    ) -> FolderChatResponse:
        case_id = folder_name
        secret_id = (request.secret_id or "").strip() or None
        query_text, display_question = resolve_query_and_display(
            question=request.question,
            secret_id=secret_id,
            prompt_label=request.prompt_label,
            authorization=authorization,
        )
        if not query_text:
            raise ValueError("question is required")
        llm_config = get_summarization_chat_config(user_id=user_id, force_refresh=False)
        llm_config = merge_folder_chat_request_llm_overrides(llm_config, request)
        requested_model = str(request.llm_name or "").strip()
        if requested_model.lower() in {"", "gemini", "claude", "deepseek", "kimi", "default"}:
            requested_model = ""
        selected_model = resolve_secret_prompt_llm_name(secret_id) or requested_model or None
        user_profile = fetch_full_profile(user_id, authorization)
        system_instruction = build_document_qa_system_prompt(user_profile)

        # Controlled memory (JRNX-ENG-2026-008): the same layers the streaming
        # route assembles, so both chat surfaces answer with identical context.
        # Best-effort throughout — an unavailable memory store must not stop an
        # answer.
        memory_bundle = None
        try:
            from app.services.memory.assembly import build_context_layers
            from app.services.memory.scope import resolve_case_scope

            memory_scope = resolve_case_scope(folder_name, user_id, authorization=authorization)
            if memory_scope is not None:
                memory_bundle = build_context_layers(
                    memory_scope,
                    question_raw=request.question or "",
                    session_id=request.session_id,
                    mode="preset" if secret_id else "chat",
                    model_name=selected_model,
                    preset_ref={"secret_id": secret_id, "prompt_label": request.prompt_label},
                )
                if memory_bundle.system_suffix:
                    system_instruction = f"{system_instruction}{memory_bundle.system_suffix}"
        except Exception as memory_exc:  # noqa: BLE001
            logger.warning(
                "[FolderService] task=answer_folder_chat memory skipped folder=%s error=%s",
                folder_name,
                memory_exc,
            )

        logger.info(
            "[FolderService] task=answer_folder_chat system_prompt_chars=%s user_id=%s folder=%s memory=%s",
            len(system_instruction),
            user_id,
            folder_name,
            (memory_bundle.metadata() if memory_bundle else None),
        )
        effective_query_text = self._build_query_with_recent_history(
            user_id=user_id,
            folder_name=folder_name,
            session_id=request.session_id,
            query_text=query_text,
            max_history=int(llm_config.get("max_conversation_history") or 0),
        )
        # Past-session recall goes ahead of the history, as on the streaming route.
        if memory_bundle is not None and memory_bundle.recall_block:
            from app.services.memory.recall import merge_recall_into_query

            effective_query_text = merge_recall_into_query(effective_query_text, memory_bundle.recall_block)
        self._record_prompt(
            case_id=case_id,
            user_id=user_id,
            kind=PromptRecordKind.user_query,
            prompt_text=None if secret_id else query_text,
            metadata={
                "session_id": request.session_id or "",
                "prompt_label": display_question if secret_id else (request.prompt_label or ""),
                "secret_id": secret_id or "",
            },
            secret_prompt=bool(secret_id),
        )
        file_ids: list[str] = []
        try:
            db_docs = self.get_documents_in_folder(folder_name, user_id)
            records = db_docs.get("documents") or db_docs.get("files") or []
            file_ids = [str(item.get("id")) for item in records if item.get("id")]
        except Exception as exc:
            logger.warning("[FolderService] task=answer_folder_chat status=file_list_fallback folder=%s error=%s", folder_name, exc)
        if not file_ids:
            file_ids = self._resolve_file_ids_for_folder_case(folder_name, user_id)
            if file_ids:
                logger.info(
                    "[FolderService] task=answer_folder_chat recovered file_ids=%s folder=%s",
                    len(file_ids),
                    folder_name,
                )
        query_response = self._pipeline.answer_query_for_files(
            # IMPORTANT: use the history-augmented query text when configured,
            # so the assistant can correctly follow up on previous turns.
            QueryRequest(user_id=user_id, case_id=case_id, query=effective_query_text),
            file_ids,
            system_instruction=system_instruction,
            summarization_llm_config=llm_config,
            agent_name="grounded_retrieval_agent",
            model_name_override=selected_model,
        )
        if secret_id:
            # Secret/preset prompts are expected to produce machine-readable JSON.
            # Wrap/normalize the output so the frontend renderer can parse reliably.
            query_response.answer = post_process_secret_prompt_response(query_response.answer)
        session = self._get_or_create_session(user_id, folder_name, request.session_id, display_question)
        self._append_message(session, "user", display_question)
        self._append_message(session, "assistant", query_response.answer)
        citations = [citation for segment in query_response.answer_segments for citation in segment.citations]
        self._save_folder_chat_to_db(
            user_id=user_id,
            folder_name=folder_name,
            question=display_question,
            answer=query_response.answer,
            session_id=session.id,
            citations=citations,
            used_secret_prompt=bool(secret_id),
            prompt_label=display_question if secret_id else None,
            secret_id=secret_id,
        )
        if memory_bundle is not None and memory_bundle.log_entry:
            try:
                from app.services.memory import repository as memory_repository

                entry = dict(memory_bundle.log_entry)
                entry.update({"session_id": session.id, "model": selected_model})
                memory_repository.write_assembly_log(entry)
            except Exception as memory_log_exc:  # noqa: BLE001
                logger.debug(
                    "[FolderService] task=answer_folder_chat assembly log skipped: %s", memory_log_exc
                )
        return FolderChatResponse(
            success=True,
            folderName=folder_name,
            case_id=case_id,
            session_id=session.id,
            answer=query_response.answer,
            citations=citations,
            answer_segments=query_response.answer_segments,
            stored_chat_count=len(session.messages),
            prompt_stored=True,
            generated_at=query_response.generated_at,
        )

    def clean_existing_chunk_text(self, user_id: str, folder_name: str, *, use_llm: bool = True) -> dict[str, Any]:
        """
        Re-clean the text of ALREADY-stored chunks for a case, IN PLACE.

        No PDF re-OCR, no re-embedding — it rewrites only `file_chunks.content`, so
        the existing embeddings and chat history are preserved. Two passes per chunk:
          1. deterministic OCR-artefact repair (free) — dictionary + numbers + dates.
          2. when `use_llm` and the chunk still LOOKS fragmented, an LLM reconstruction
             pass repairs arbitrary fragments (names/places, "p .a .", "18 %") that no
             dictionary can cover. The LLM never loses content (returns original on error).
        Fixes documents indexed before the OCR work so garbled chunks render clean.
        """
        from app.services.adapters.document_ai import (
            normalize_ocr_artifacts,
            _looks_fragmented,
            reconstruct_chunk_text,
        )

        if not is_db_available():
            return {"success": False, "message": "Database unavailable.", "updated": 0}

        # Resolve the case's file_ids the same way the chat path does.
        file_ids: list[str] = []
        try:
            db_docs = self.get_documents_in_folder(folder_name, user_id)
            records = db_docs.get("documents") or db_docs.get("files") or []
            file_ids = [str(item.get("id")) for item in records if item.get("id")]
        except Exception:
            file_ids = []
        if not file_ids:
            file_ids = self._resolve_file_ids_for_folder_case(folder_name, user_id)
        if not file_ids:
            return {"success": False, "message": "No documents found for this case.", "updated": 0}

        scanned = 0
        updated = 0
        llm_reconstructed = 0
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, content FROM file_chunks WHERE file_id::text = ANY(%s)",
                [file_ids],
            )
            rows = cur.fetchall() or []
            for row in rows:
                scanned += 1
                chunk_id = row.get("id")
                content = row.get("content") or ""
                # Pass 1: deterministic (free).
                cleaned = normalize_ocr_artifacts(content)
                # Pass 2: LLM reconstruction only for chunks still fragmented.
                if use_llm and _looks_fragmented(cleaned):
                    reconstructed = reconstruct_chunk_text(cleaned)
                    if reconstructed and reconstructed != cleaned:
                        cleaned = reconstructed
                        llm_reconstructed += 1
                if cleaned and cleaned != content:
                    cur.execute(
                        "UPDATE file_chunks SET content = %s, updated_at = NOW() WHERE id = %s",
                        [cleaned, chunk_id],
                    )
                    updated += 1
            conn.commit()

        logger.info(
            "[FolderService] task=clean_existing_chunk_text folder=%s files=%d scanned=%d updated=%d llm=%d use_llm=%s",
            folder_name, len(file_ids), scanned, updated, llm_reconstructed, use_llm,
        )
        return {
            "success": True,
            "folderName": folder_name,
            "file_count": len(file_ids),
            "chunks_scanned": scanned,
            "chunks_updated": updated,
            "llm_reconstructed": llm_reconstructed,
            "message": (
                f"Cleaned {updated} of {scanned} chunk(s) in place "
                f"({llm_reconstructed} via LLM reconstruction; embeddings kept)."
            ),
        }

    def _build_query_with_recent_history(
        self,
        *,
        user_id: str,
        folder_name: str,
        session_id: str | None,
        query_text: str,
        max_history: int,
    ) -> str:
        history_limit = max(0, int(max_history or 0))
        if history_limit <= 0:
            return query_text
        history = self._get_recent_chat_history(
            user_id=user_id,
            folder_name=folder_name,
            session_id=session_id,
            max_history=history_limit,
        )
        if not history:
            return query_text
        history_lines: list[str] = []
        for item in history:
            question = str(item.get("question") or "").strip()
            answer = str(item.get("answer") or "").strip()
            if question:
                history_lines.append(f"User: {question}")
            if answer:
                history_lines.append(f"Assistant: {answer}")
        if not history_lines:
            return query_text
        return (
            "Use the prior conversation only as supporting context. If the latest question narrows or changes the issue, "
            "prioritize the latest question.\n\n"
            f"Conversation history:\n{chr(10).join(history_lines)}\n\n"
            f"Current question:\n{query_text}"
        )

    def _get_recent_chat_history(
        self,
        *,
        user_id: str,
        folder_name: str,
        session_id: str | None,
        max_history: int,
    ) -> list[dict[str, Any]]:
        if max_history <= 0:
            return []
        # A new chat sends no session_id, and it must start from a CLEAN slate. This used to fall back
        # to the folder's most recent Q/A pairs across ALL sessions for "case-wise continuity", which
        # made a new chat inherit up to max_history (default 25) turns of unrelated conversations:
        # typing "hi" replayed an earlier "summary in text as well as in tabular format" ask, so the
        # model answered that OLD question and opened with a full case summary. History is
        # session-scoped only; continuity across chats comes from the case documents, not stale turns.
        if not session_id:
            return []
        history: list[dict[str, Any]] = []
        if is_db_available():
            try:
                with get_db_connection() as conn, conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT question, answer, created_at
                        FROM folder_chats
                        WHERE folder_name = %s
                          AND user_id::text = %s
                          AND session_id::text = %s
                        ORDER BY created_at DESC
                        LIMIT %s
                        """,
                        [folder_name, str(user_id), str(session_id), max_history],
                    )
                    rows = list(cur.fetchall())
                history = [{"question": row.get("question"), "answer": row.get("answer")} for row in reversed(rows)]
            except Exception as exc:
                logger.warning(
                    "[FolderService] task=recent_chat_history status=db_fallback folder=%s session_id=%s error=%s",
                    folder_name,
                    session_id,
                    exc,
                )
        if history:
            return history
        with self._lock:
            session = self._sessions.get(folder_name, {}).get(session_id or "")
            if not session:
                return []
            pairs: list[dict[str, Any]] = []
            current_question: str | None = None
            for message in session.messages[-(max_history * 2) :]:
                if message.role == "user":
                    current_question = message.content
                elif message.role == "assistant":
                    pairs.append({"question": current_question or "", "answer": message.content})
                    current_question = None
            return pairs[-max_history:]

    def list_sessions(self, folder_name: str) -> list[ChatSession]:
        sessions = self._sessions.get(folder_name, {})
        ordered = sorted(sessions.values(), key=lambda item: item.updated_at, reverse=True)
        return [self._to_session_model(item) for item in ordered]

    def get_session(self, folder_name: str, session_id: str) -> ChatSession:
        session = self._sessions.get(folder_name, {}).get(session_id)
        if not session:
            raise ValueError(f"Session '{session_id}' was not found for folder '{folder_name}'.")
        return self._to_session_model(session)

    def delete_file(self, file_id: str, user_id: str | None = None) -> dict[str, Any]:
        """
        Delete a single file by its DB id.

        Steps:
        1. Fetch the file record (auth check via user_id / firm members).
        2. Delete chunk_vectors + file_chunks rows.
        3. Delete the user_files row.
        4. Delete the GCS object (best-effort).
        5. Remove from in-memory vector store.
        """
        from app.services.adapters.gcs import delete_blob

        if not is_db_available():
            raise ValueError("Database unavailable — cannot delete file.")

        accessible_user_ids = self._get_accessible_user_ids(user_id) if user_id else []

        with get_db_connection() as conn, conn.cursor() as cur:
            # Fetch file record
            if accessible_user_ids:
                cur.execute(
                    """
                    SELECT id, originalname, gcs_path, folder_path, user_id, metadata
                    FROM user_files
                    WHERE id::text = %s AND is_folder = false
                      AND user_id::text = ANY(%s::text[])
                    LIMIT 1
                    """,
                    [str(file_id), [str(u) for u in accessible_user_ids]],
                )
            else:
                cur.execute(
                    """
                    SELECT id, originalname, gcs_path, folder_path, user_id, metadata
                    FROM user_files
                    WHERE id::text = %s AND is_folder = false
                    LIMIT 1
                    """,
                    [str(file_id)],
                )
            row = cur.fetchone()
            if not row:
                raise ValueError(f"File '{file_id}' not found or access denied.")

            gcs_path = row.get("gcs_path") or ""
            file_name = row.get("originalname") or file_id

            # Cascade: an editor-backed doc may carry a hidden chat-snapshot row.
            snapshot_gcs_path = None
            row_meta = row.get("metadata") or {}
            snapshot_id = row_meta.get("chat_snapshot_id") if isinstance(row_meta, dict) else None
            if snapshot_id:
                cur.execute("SELECT gcs_path FROM user_files WHERE id::text = %s", [str(snapshot_id)])
                snap = cur.fetchone()
                if snap:
                    snapshot_gcs_path = snap.get("gcs_path")
                # file_chats has no ON DELETE CASCADE — remove chats keyed to the
                # snapshot (Ask Jurinex history for editor-backed docs) first.
                cur.execute("DELETE FROM file_chats WHERE file_id::text = %s", [str(snapshot_id)])
                cur.execute("DELETE FROM user_files WHERE id::text = %s", [str(snapshot_id)])

            # Delete chats + vectors + chunks (file_chats is the only FK on
            # user_files without ON DELETE CASCADE; the rest cascade in the DB).
            cur.execute("DELETE FROM file_chats WHERE file_id::text = %s", [str(file_id)])
            cur.execute("DELETE FROM chunk_vectors WHERE file_id::text = %s", [str(file_id)])
            cur.execute("DELETE FROM file_chunks WHERE file_id::text = %s", [str(file_id)])
            cur.execute("DELETE FROM user_files WHERE id::text = %s", [str(file_id)])
            conn.commit()

        # Delete GCS object(s) (best-effort — don't fail if missing).
        # gcs_path may be a full gs:// URI, a relative object key (legacy convention),
        # or an external:// pointer (no object of ours to delete).
        for path in (gcs_path, snapshot_gcs_path):
            if path and not path.startswith("external://"):
                if path.startswith("gs://"):
                    gcs_uri = path
                else:
                    bucket = settings.gcs_input_bucket_name or settings.gcs_bucket_name or "fileinputbucket"
                    gcs_uri = f"gs://{bucket}/{path.lstrip('/')}"
                delete_blob(gcs_uri)

        # Remove from in-memory vector store across all cases
        self._pipeline._vector_store.delete_document(file_id)

        logger.info("[FolderService] file deleted file_id=%s name=%s", file_id, file_name)
        return {"success": True, "deleted": file_id, "name": file_name}

    def delete_session(self, folder_name: str, session_id: str) -> dict[str, Any]:
        """
        Delete a chat session from memory AND from folder_chats in the DB.

        Sessions are listed from the DB, so an in-memory-only delete made every
        session from a previous server process undeletable (404 → "Failed to
        delete session." in the UI).
        """
        with self._lock:
            session = self._sessions.get(folder_name, {}).pop(session_id, None)

        db_deleted = 0
        raw = (session_id or "").strip()
        is_uuid_like = bool(_UUID_DASHED.match(raw) or _UUID_HEX32.match(raw))
        if is_db_available() and is_uuid_like:
            try:
                norm = normalize_folder_chat_session_uuid(raw)
                with get_db_connection() as conn, conn.cursor() as cur:
                    # The UI may pass either a session_id OR a folder_chats row id
                    # (older rows / some surfaces). Accept both: a row id deletes
                    # its whole session; a sessionless row is deleted directly.
                    cur.execute(
                        """
                        DELETE FROM folder_chats
                         WHERE folder_name = %s
                           AND (
                                session_id = %s::uuid
                                OR id = %s::uuid
                                OR session_id = (
                                    SELECT session_id FROM folder_chats
                                     WHERE folder_name = %s AND id = %s::uuid
                                )
                           )
                        """,
                        [folder_name, norm, norm, folder_name, norm],
                    )
                    db_deleted = cur.rowcount or 0
                    conn.commit()
            except Exception as exc:
                logger.warning(
                    "[FolderService] delete_session DB delete failed folder=%s session=%s error=%s",
                    folder_name,
                    session_id,
                    exc,
                )

        if not session and db_deleted == 0:
            raise ValueError(f"Session '{session_id}' was not found for folder '{folder_name}'.")
        return {"success": True, "deleted": session_id, "db_rows_deleted": db_deleted}

    def delete_all_sessions(self, folder_name: str) -> dict[str, Any]:
        with self._lock:
            deleted_count = len(self._sessions.get(folder_name, {}))
            self._sessions[folder_name] = {}

        db_deleted = 0
        if is_db_available():
            try:
                with get_db_connection() as conn, conn.cursor() as cur:
                    cur.execute("DELETE FROM folder_chats WHERE folder_name = %s", [folder_name])
                    db_deleted = cur.rowcount or 0
                    conn.commit()
            except Exception as exc:
                logger.warning(
                    "[FolderService] delete_all_sessions DB delete failed folder=%s error=%s",
                    folder_name,
                    exc,
                )
        return {"success": True, "deleted_count": deleted_count, "db_rows_deleted": db_deleted}

    def list_prompt_audit(self, case_id: str) -> list[PromptAuditRecord]:
        return [record for record in self._prompt_audit if record.case_id == case_id]

    def record_secret_preset_use(self, user_id: str, case_id: str, preset_id: str, preset_name: str) -> None:
        self._record_prompt(
            case_id=case_id,
            user_id=user_id,
            kind=PromptRecordKind.preset_execution,
            prompt_text=None,
            metadata={"preset_id": preset_id, "preset_name": preset_name},
            secret_prompt=True,
        )

    def _run_job(self, job_id: str, case_id: str, documents: list[DocumentReference]) -> None:
        with self._lock:
            job = self._jobs[job_id]
            job.status = ProcessingState.processing
            job.updated_at = datetime.now(tz=UTC)
            document_ids = list(job.documents.keys())

        # Re-create the case in memory if service restarted and case was lost
        stored_case = self._pipeline._cases.get(case_id)
        if stored_case is None:
            with self._lock:
                job_ref = self._jobs.get(job_id)
                user_id = job_ref.user_id if job_ref else "unknown"
            stored_case = self._ensure_case(user_id, case_id)
            logger.warning(
                "[FolderService] _run_job: case_id=%s not in memory — re-created (service may have restarted)",
                case_id,
            )

        try:
            self._run_job_inner(job_id, case_id, documents, stored_case, document_ids)
        except Exception as exc:
            # Catch-all: if _run_job_inner crashes before processing futures, mark every
            # document that is still at 20% (processing) as failed so they never get stuck.
            logger.exception(
                "[FolderService] _run_job crashed before completing case_id=%s job_id=%s: %s",
                case_id, job_id, exc,
            )
            with self._lock:
                job_ref = self._jobs.get(job_id)
                if job_ref:
                    for doc_id, doc_status in job_ref.documents.items():
                        if doc_status.status == ProcessingState.processing and doc_status.processing_progress <= 20.0:
                            db_file_id = str(doc_status.metadata.get("db_file_id") or doc_status.file_id or "")
                            self._update_db_file_processing_state(
                                file_id=db_file_id or None,
                                status=ProcessingState.error.value,
                                processing_progress=100.0,
                                current_operation="failed",
                            )
                            self._update_document(job_id, doc_id, ProcessingState.error, 100.0, "failed", error=str(exc))
                    job_ref.status = ProcessingState.error
                    job_ref.updated_at = datetime.now(tz=UTC)

    def _run_job_inner(
        self,
        job_id: str,
        case_id: str,
        documents: list[DocumentReference],
        stored_case: Any,
        document_ids: list[str],
    ) -> None:
        max_workers = max(1, min(self._pipeline._settings.max_parallel_document_workers, len(documents) or 1))
        # NOT a `with` block: ThreadPoolExecutor.__exit__ joins worker threads
        # (shutdown(wait=True)), so a single hung OCR/embedding call would block
        # this job — and the queue worker running it — forever. The deadline loop
        # below marks stragglers failed and shutdown(wait=False) lets the job end.
        executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="doc-worker")
        try:
            future_map = {}
            for document, document_id in zip(documents, document_ids, strict=False):
                db_file_id = document.metadata.get("db_file_id") if isinstance(document.metadata, dict) else None
                step1_op = (
                    "transcribing_audio"
                    if is_audio_mime(document.mime_type or "") or is_audio_filename(document.document_name or "")
                    else "ocr_and_validation"
                )
                self._update_db_file_processing_state(
                    file_id=db_file_id,
                    status=ProcessingState.processing.value,
                    processing_progress=20.0,
                    current_operation=step1_op,
                )
                self._update_document(job_id, document_id, ProcessingState.processing, 20.0, step1_op)

                # Build a real-time progress callback for audio STT polling.
                # Captures db_file_id / document_id / job_id by closure.
                def _make_progress_callback(_db_file_id=db_file_id, _doc_id=document_id, _job_id=job_id):
                    def _cb(pct: float) -> None:
                        try:
                            self._update_db_file_processing_state(
                                file_id=_db_file_id,
                                status=ProcessingState.processing.value,
                                processing_progress=round(pct, 1),
                                current_operation="transcribing_audio",
                            )
                            self._update_document(
                                _job_id,
                                _doc_id,
                                ProcessingState.processing,
                                round(pct, 1),
                                "transcribing_audio",
                            )
                        except Exception:
                            pass  # progress update is best-effort
                    return _cb

                future_map[executor.submit(
                    self._process_and_finalize_document,
                    job_id,
                    case_id,
                    document,
                    document_id,
                    stored_case,
                    _make_progress_callback(),
                )] = {
                    "document_id": document_id,
                    "source_document": document,
                }

            # Per-document timeout (env-overridable via DOCUMENT_PROCESSING_TIMEOUT_SECONDS).
            # Covers large PDFs with many Document AI OCR batches + embedding.
            _doc_timeout = int(settings.document_processing_timeout_seconds)

            def _mark_timed_out(future) -> None:
                future_context = future_map[future]
                document_id = future_context["document_id"]
                source_document = future_context["source_document"]
                db_file_id = source_document.metadata.get("db_file_id") if isinstance(source_document.metadata, dict) else None
                logger.error(
                    "[Agent:DocumentClassificationAgent] status=timeout task=parallel_document_processing "
                    "case_id=%s document_id=%s timeout=%ss — marking as failed",
                    case_id,
                    document_id,
                    _doc_timeout,
                )
                self._update_db_file_processing_state(
                    file_id=db_file_id,
                    status=ProcessingState.error.value,
                    processing_progress=100.0,
                    current_operation="timeout",
                )
                self._update_document(
                    job_id, document_id, ProcessingState.error, 100.0, "timeout",
                    error=f"Processing timed out after {_doc_timeout}s",
                )

            def _handle_completed(future) -> None:
                # The worker task (_process_and_finalize_document) does ALL the
                # per-document work — including persistence and the final DB
                # status updates — so 8 documents finalize concurrently instead
                # of queueing behind this thread. Here we only surface failures.
                future_context = future_map[future]
                document_id = future_context["document_id"]
                source_document = future_context["source_document"]
                db_file_id = source_document.metadata.get("db_file_id") if isinstance(source_document.metadata, dict) else None
                try:
                    future.result()
                except Exception as exc:
                    logger.exception(
                        "[Agent:DocumentClassificationAgent] status=fail task=parallel_document_processing case_id=%s document_id=%s error=%s",
                        case_id,
                        document_id,
                        exc,
                    )
                    self._update_db_file_processing_state(
                        file_id=db_file_id,
                        status=ProcessingState.error.value,
                        processing_progress=100.0,
                        current_operation="failed",
                    )
                    self._update_document(job_id, document_id, ProcessingState.error, 100.0, "failed", error=str(exc))

            # The batch runs in waves of max_workers documents, so the overall budget
            # is per-doc timeout × number of waves. Each future is handled the moment
            # it finishes; once the deadline passes, whatever is still running gets
            # marked failed instead of wedging the batch at 20% forever. (The old
            # as_completed(timeout=None) + future.result(timeout=...) pattern could
            # never fire: as_completed only yields futures that are ALREADY done.)
            waves = max(1, -(-len(future_map) // max_workers))
            deadline = time.monotonic() + _doc_timeout * waves
            pending = set(future_map)
            while pending:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                done, pending = futures_wait(pending, timeout=remaining, return_when=FIRST_COMPLETED)
                for future in done:
                    _handle_completed(future)
            for future in pending:
                future.cancel()
                _mark_timed_out(future)
        finally:
            # wait=False: never join a hung worker thread — the timed-out documents are
            # already marked failed and the queue worker must move on to the next job.
            executor.shutdown(wait=False, cancel_futures=True)

        with self._lock:
            job = self._jobs[job_id]
            job.status = ProcessingState.processed
            if any(item.status == ProcessingState.error for item in job.documents.values()):
                if all(item.status == ProcessingState.error for item in job.documents.values()):
                    job.status = ProcessingState.error
            job.updated_at = datetime.now(tz=UTC)

    def _process_and_finalize_document(
        self,
        job_id: str,
        case_id: str,
        document: DocumentReference,
        document_id: str,
        stored_case: Any,
        progress_callback,
    ) -> None:
        """Full per-document pipeline INCLUDING persistence and finalization.

        Runs inside the doc-worker pool so chunk persistence, vector indexing,
        autofill extraction, and the final DB update all happen concurrently
        across documents. Previously everything after OCR+embedding ran serially
        in the job thread, which dominated multi-document wall-clock time.
        """
        db_file_id = document.metadata.get("db_file_id") if isinstance(document.metadata, dict) else None
        bundle = self._pipeline._process_single_document(case_id, document, progress_callback=progress_callback)
        self._update_db_file_processing_state(
            file_id=db_file_id,
            status=ProcessingState.embedding_pending.value,
            processing_progress=80.0,
            current_operation="vector_indexing",
        )
        self._update_document(job_id, document_id, ProcessingState.embedding_pending, 80.0, "vector_indexing")
        persisted_chunks = self._pipeline.persist_chunks_to_db(db_file_id, bundle.chunks)
        self._pipeline._vector_store.upsert_chunks(case_id, persisted_chunks)
        logger.info(
            "[Upload] Step 4/4: Storing — in-memory vector index updated case_id=%s document=%s chunks=%d",
            case_id,
            document.document_name,
            len(persisted_chunks),
        )
        stored_case.documents.append(bundle.stored_document)
        if self._should_collect_autofill(case_id):
            self._merge_extracted_case_data(case_id, bundle.process_result.metadata, bundle.stored_document.text)
        self._update_db_file_processing_state(
            file_id=db_file_id,
            status=ProcessingState.processed.value,
            processing_progress=100.0,
            stored_document_uri=bundle.process_result.stored_document_uri,
            extracted_text=bundle.stored_document.text,
            summary=self._build_text_summary(bundle.stored_document.text),
            metadata={
                **bundle.process_result.metadata,
                "doc_type": bundle.process_result.doc_type.value,
                "chunk_count": bundle.process_result.chunk_count,
                "quality_score": bundle.process_result.quality_score,
            },
            current_operation="completed",
        )
        self._update_document(
            job_id,
            document_id,
            ProcessingState.processed,
            100.0,
            "completed",
            doc_type=bundle.process_result.doc_type,
            stored_document_uri=bundle.process_result.stored_document_uri,
            chunk_count=bundle.process_result.chunk_count,
            quality_score=bundle.process_result.quality_score,
            metadata=bundle.process_result.metadata,
        )

    def _ensure_case(self, user_id: str, case_id: str) -> StoredCase:
        stored_case = self._pipeline._cases.get(case_id)
        if stored_case:
            return stored_case
        stored_case = StoredCase(case_id=case_id, user_id=user_id, created_at=datetime.now(tz=UTC))
        self._pipeline._cases[case_id] = stored_case
        self._extracted_by_case.setdefault(case_id, {})
        return stored_case

    @staticmethod
    def _should_collect_autofill(case_id: str) -> bool:
        # Auto-population is only needed during create-case intake flow.
        # Intake folders are created via /upload-for-processing as temp-xxxx.
        return str(case_id or "").strip().startswith("temp-")

    # Fields that make the intake auto-fill "rich enough" to stop paying for
    # more per-document LLM extraction (extract_case_fields uses the same set).
    _AUTOFILL_KEY_FIELDS = (
        "caseTitle", "caseNumber", "caseType", "courtName", "jurisdiction",
        "filingDate", "petitioners", "respondents",
    )

    def _merge_extracted_case_data(self, case_id: str, metadata: dict[str, Any], text: str) -> None:
        # Always run the form_population_agent call so chronology events are collected
        # from every intake document. Form fields stay first-wins; events always merge.
        started = time.perf_counter()
        document_name = str(metadata.get("original_name") or metadata.get("document_name") or "document")
        chars = len(text or "")
        from app.services.chronology.console import log_note
        from app.services.chronology.pages import split_into_pages

        pages = split_into_pages(text or "")
        log_progress(
            1, 5, "Read OCR text",
            document=document_name,
            chars=f"{chars:,}",
            pages=len(pages) or "unstamped",
        )
        if pages:
            log_note(
                f"Page stamps present: [PAGE {pages[0].number}] … [PAGE {pages[-1].number}] "
                "(pin cites use these numbers, not model guesses)"
            )
        log_progress(2, 5, "Send OCR to form_population_agent")
        extraction = self._pipeline._document_ai.extract(
            DocumentReference(document_name=document_name, inline_text=text)
        )
        log_progress(3, 5, "Keep only dates and quotes that appear in the OCR")
        normalized = self._normalize_entities(extraction.entities)
        report = report_from_extraction(
            extraction.entities,
            source_text=text,
            document_name=document_name,
        )
        log_progress(
            4, 5, "OCR majority vote + pin cites",
            corrected=len(report.corrections),
            cited=f"{report.pages_cited}/{report.kept}",
        )
        log_progress(5, 5, "Merge unique dates + persist")
        with self._autofill_lock:
            extracted_data = self._extracted_by_case.setdefault(case_id, {})
            for key, value in normalized.items():
                if value and not extracted_data.get(key):
                    extracted_data[key] = value
            existing = self._chronology_by_case.get(case_id)
            tree = merge_into_tree(existing, report.events)
            self._chronology_by_case[case_id] = tree
            field_names = [k for k in extracted_data if extracted_data.get(k)]
        save_tree(case_id, tree, folder_name=case_id)
        log_run_report(
            stage="intake document",
            case_id=case_id,
            document_name=document_name,
            chars=chars,
            elapsed_s=time.perf_counter() - started,
            fields_filled=len(field_names),
            field_names=field_names,
            kept_events=report.kept,
            dropped_events=report.dropped,
            drop_reasons=report.reasons,
            tree=tree,
            proposed_events=report.proposed,
            corrections=report.corrections,
            pages_cited=report.pages_cited,
            pages_missing=report.pages_missing,
            ocr_pages=report.ocr_pages,
            swept_events=report.swept,
        )

    @classmethod
    def _flatten_extract_value(cls, value: Any) -> Any:
        """LLM shape-drift guard: some prompt/model combinations wrap each
        extracted field as {value, status, evidence} (or similar) instead of
        the plain value. Unwrap recursively so consumers — the create-case
        auto-fill form renders these directly — always get plain strings/
        lists. Party dicts ({fullName, role, …}) have no 'value' key and pass
        through untouched."""
        if isinstance(value, dict):
            if "value" in value:
                return cls._flatten_extract_value(value.get("value"))
            return {k: cls._flatten_extract_value(v) for k, v in value.items()}
        if isinstance(value, list):
            return [cls._flatten_extract_value(v) for v in value]
        return value

    def _normalize_entities(self, entities: dict[str, Any]) -> dict[str, Any]:
        """
        Pass through all camelCase fields from Gemini extraction as-is, and map
        any legacy snake_case fields from the old regex extractor for backward compat.
        """
        entities = {k: self._flatten_extract_value(v) for k, v in (entities or {}).items()}
        # Direct camelCase fields that Gemini returns — just copy them through
        camel_case_fields = {
            "caseTitle", "caseNumber", "casePrefix", "caseYear", "caseType", "caseNature",
            "subType", "courtName", "courtLevel", "benchDivision", "jurisdiction", "state",
            "filingDate", "judges", "courtRoom", "petitioners", "respondents",
            "categoryType", "primaryCategory", "subCategory", "complexity",
            "monetaryValue", "priorityLevel", "currentStatus", "nextHearingDate",
            "documentType", "filedBy",
        }
        normalized: dict[str, Any] = {}
        for field in camel_case_fields:
            val = entities.get(field)
            if val is not None and val != "" and val != [] and val != {}:
                normalized[field] = val

        # Legacy snake_case mappings (from old regex extractor fallback)
        if entities.get("case_number") and not normalized.get("caseNumber"):
            normalized["caseNumber"] = entities["case_number"]
        if entities.get("case_type") and not normalized.get("caseType"):
            normalized["caseType"] = entities["case_type"]
        if entities.get("court_details") and not normalized.get("courtName"):
            normalized["courtName"] = entities["court_details"]
            normalized.setdefault("jurisdiction", entities["court_details"])
        if entities.get("important_dates") and not normalized.get("filingDate"):
            normalized["filingDate"] = entities["important_dates"].split(",")[0].strip()
        if entities.get("party_names") and not normalized.get("caseTitle"):
            normalized["caseTitle"] = entities["party_names"]
            lowered = entities["party_names"].lower()
            if " vs " in lowered:
                idx = lowered.index(" vs ")
                left = entities["party_names"][:idx].strip()
                right = entities["party_names"][idx + 4:].strip()
                normalized.setdefault("petitioners", [{"fullName": left, "role": "Individual", "advocateName": "", "barRegistration": "", "contact": ""}] if left else [])
                normalized.setdefault("respondents", [{"fullName": right, "role": "Individual", "advocateName": "", "barRegistration": "", "contact": ""}] if right else [])
        return normalized

    def _get_case_status(self, case_id: str) -> str:
        job_id = self._latest_job_by_case.get(case_id)
        job = self._jobs.get(job_id) if job_id else None
        if not job:
            return "Active"
        if job.status == ProcessingState.error:
            return "Error"
        if job.status == ProcessingState.processed:
            return "Active"
        return "Processing"

    def _list_folders_from_db(self, user_id: str | None, scope: str = "cases") -> list[dict[str, Any]]:
        if not user_id:
            return []
        accessible_user_ids = self._get_accessible_user_ids(user_id)
        if not accessible_user_ids:
            return []
        limited_firm_user = self._is_limited_firm_user(str(user_id))

        # Case Storage folders live under the reserved parent path 'case-storage' and are
        # plain document storage — they must never surface as cases (Projects page,
        # create-case flow), and vice versa.
        scope_filter = (
            "AND uf.folder_path = 'case-storage'"
            if scope == "storage"
            else "AND COALESCE(uf.folder_path, '') <> 'case-storage'"
        )

        # Fetch only folder records joined with cases — same logic as document-service
        folder_query = f"""
            SELECT
                uf.id,
                uf.user_id,
                uf.originalname,
                uf.folder_path,
                uf.gcs_path,
                uf.created_at,
                c.case_title
            FROM user_files uf
            LEFT JOIN cases c ON uf.id = c.folder_id
            WHERE uf.user_id::text = ANY(%s::text[])
              AND uf.is_folder = true
              {scope_filter}
              AND (
                    %s = FALSE
                    OR EXISTS (
                        SELECT 1
                        FROM cases c2
                        INNER JOIN case_assignments ca
                          ON ca.case_id = c2.id
                        WHERE c2.folder_id = uf.id
                          AND ca.user_id::text = %s::text
                    )
                  )
            ORDER BY uf.created_at DESC
        """
        # Fetch all files (non-folders) in one query for children matching
        files_query = """
            SELECT
                id, user_id, originalname, folder_path, gcs_path,
                mimetype, size, status, processing_progress, created_at
            FROM user_files
            WHERE user_id::text = ANY(%s::text[])
              AND is_folder = false
            ORDER BY originalname ASC
        """
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(folder_query, [accessible_user_ids, limited_firm_user, str(user_id)])
            folder_rows = list(cur.fetchall())
            cur.execute(files_query, [accessible_user_ids])
            file_rows = list(cur.fetchall())

        folders = []
        for row in folder_rows:
            folder_path = row.get("folder_path") or ""
            folder_name = row.get("originalname") or ""
            # Mirror document-service File.js logic: robustPath = storedPath/folderName
            # folder_path stores the PARENT path; full path = parent/folderName
            if folder_name and not folder_path.endswith(folder_name):
                full_folder_path = f"{folder_path}/{folder_name}".strip("/") if folder_path else folder_name
            else:
                full_folder_path = folder_path or folder_name

            folder_children = [
                {
                    "id": str(f["id"]),
                    "name": f.get("originalname"),
                    "size": f.get("size") or 0,
                    "mimetype": f.get("mimetype"),
                    "created_at": f["created_at"].isoformat() if f.get("created_at") else "",
                    "folder_path": f.get("folder_path"),
                    "status": f.get("status"),
                    "processing_progress": float(f.get("processing_progress") or 0),
                    "url": f.get("gcs_path"),
                }
                for f in file_rows
                if (
                    f.get("folder_path") == full_folder_path
                    or str(f.get("folder_path") or "").startswith(f"{full_folder_path}/")
                )
            ]
            folders.append(
                {
                    "id": str(row["id"]),
                    "name": folder_name,
                    "case_title": row.get("case_title"),
                    "folder_path": row.get("folder_path") or "",
                    "created_at": row["created_at"].isoformat() if row.get("created_at") else "",
                    "children": folder_children,
                    "document_count": len(folder_children),
                    # Per-case storage: sum of this folder's file sizes (bytes).
                    "storage_bytes": sum(int(c.get("size") or 0) for c in folder_children),
                }
            )
        logger.info(
            "[FolderService] task=list_folders_db user_id=%s limited_firm_user=%s folder_count=%s",
            user_id,
            limited_firm_user,
            len(folders),
        )
        return folders

    def _get_documents_in_folder_from_db(self, folder_name: str, user_id: str | None) -> list[dict[str, Any]] | None:
        if not user_id:
            return []
        accessible_user_ids = self._get_accessible_user_ids(user_id)
        if not accessible_user_ids:
            return []
        limited_firm_user = self._is_limited_firm_user(str(user_id))

        # Select gcs_path too so we can use it for GCS-based file matching below
        folder_query = """
            SELECT id, user_id, folder_path, originalname, gcs_path
            FROM user_files
            WHERE user_id::text = ANY(%s::text[])
              AND is_folder = true
              AND originalname = %s
              AND (
                    %s = FALSE
                    OR EXISTS (
                        SELECT 1
                        FROM cases c2
                        INNER JOIN case_assignments ca
                          ON ca.case_id = c2.id
                        WHERE c2.folder_id = user_files.id
                          AND ca.user_id::text = %s::text
                    )
                  )
            ORDER BY created_at DESC
            LIMIT 1
        """
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(folder_query, [accessible_user_ids, folder_name, limited_firm_user, str(user_id)])
            folder = cur.fetchone()
            if not folder:
                if limited_firm_user:
                    logger.info(
                        "[FolderService] task=get_documents_in_folder status=restricted_no_folder user_id=%s folder=%s",
                        user_id,
                        folder_name,
                    )
                    return []
                # No folder record found — try matching files directly by folder_path or folder path pattern
                # (mirrors document-service File.js findByUserIdAndFolderPath fallback)
                fallback_query = """
                    SELECT *
                    FROM user_files
                    WHERE user_id::text = ANY(%s::text[])
                      AND is_folder = false
                      AND (
                          folder_path = %s
                          OR folder_path LIKE %s
                      )
                    ORDER BY originalname ASC
                """
                cur.execute(fallback_query, [accessible_user_ids, folder_name, f"{folder_name}/%"])
                rows = list(cur.fetchall())
                if not rows:
                    # No folder record and no files found — return None so caller can
                    # fall back to in-memory pipeline storage (e.g. freshly uploaded docs)
                    return None
            else:
                # Mirror document-service File.js findByUserIdAndFolderPath logic:
                # robustPath = storedPath ? `${storedPath}/${folder.originalname}` : folder.originalname
                stored_path = folder.get("folder_path") or ""
                if folder.get("originalname") and not stored_path.endswith(folder["originalname"]):
                    robust_path = f"{stored_path}/{folder['originalname']}".strip("/") if stored_path else folder["originalname"]
                else:
                    robust_path = stored_path or folder.get("originalname") or folder_name

                # queue_documents / _create_db_file_record store folder_path as the API case name only
                # (e.g. PETITIONER_vs_...), while robust_path may be user_id/cases/PETITIONER_vs_...
                # Include both so PDFs (legacy paths / gcs prefix) and agentic uploads (short folder_path) match.
                # API folder name (agentic uploads store folder_path as this string only).
                api_folder_name = ((folder_name or "").strip().strip("/") or None)
                gcs_folder_segment = f"/{api_folder_name}/" if api_folder_name else None

                # Use ANY(%s::text[]) for firm/multi-user support — NOT a single user_id
                gcs_prefix = f"{folder.get('gcs_path')}%" if folder.get("gcs_path") else None
                # Avoid `(%s IS NOT NULL AND ...)` with NULL binds — PostgreSQL reports
                # IndeterminateDatatype for untyped NULL parameters (psycopg3).
                extra_api_match = ""
                extra_params: list[Any] = []
                if api_folder_name and gcs_folder_segment:
                    extra_api_match = """
                              OR folder_path = %s::text
                              OR strpos(COALESCE(gcs_path, ''), %s::text) > 0
                    """
                    extra_params = [api_folder_name, gcs_folder_segment]

                if gcs_prefix:
                    file_query = f"""
                        SELECT DISTINCT ON (id) *
                        FROM user_files
                        WHERE user_id::text = ANY(%s::text[])
                          AND is_folder = false
                          AND (
                              folder_path = %s
                              OR folder_path LIKE %s
                              OR gcs_path LIKE %s
                              {extra_api_match}
                          )
                        ORDER BY id ASC, originalname ASC
                    """
                    cur.execute(
                        file_query,
                        [
                            accessible_user_ids,
                            robust_path,
                            f"{robust_path}/%",
                            gcs_prefix,
                            *extra_params,
                        ],
                    )
                else:
                    file_query = f"""
                        SELECT DISTINCT ON (id) *
                        FROM user_files
                        WHERE user_id::text = ANY(%s::text[])
                          AND is_folder = false
                          AND (
                              folder_path = %s
                              OR folder_path LIKE %s
                              {extra_api_match}
                          )
                        ORDER BY id ASC, originalname ASC
                    """
                    cur.execute(
                        file_query,
                        [
                            accessible_user_ids,
                            robust_path,
                            f"{robust_path}/%",
                            *extra_params,
                        ],
                    )
                rows = list(cur.fetchall())

        return [
            {
                "id": str(row["id"]),
                "name": row.get("originalname"),
                "originalname": row.get("originalname"),
                "size": row.get("size") or 0,
                "mimetype": row.get("mimetype"),
                "created_at": row["created_at"].isoformat() if row.get("created_at") else "",
                "status": row.get("status"),
                "processing_progress": float(row.get("processing_progress") or 0),
                "folder_path": row.get("folder_path"),
                "gcs_path": row.get("gcs_path"),
                "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else "",
                "summary": row.get("summary"),
                "full_text_content": row.get("full_text_content"),
                "metadata": row.get("metadata"),
            }
            for row in rows
            if not row.get("is_folder")
        ]

    def _list_folders_from_cases_db(self, user_id: str | None) -> list[dict[str, Any]]:
        if not user_id:
            return []
        accessible_user_ids = self._get_accessible_user_ids(user_id)
        text_user_ids = [str(value) for value in accessible_user_ids if value is not None]
        if not text_user_ids:
            return []
        limited_firm_user = self._is_limited_firm_user(str(user_id))

        query = """
            SELECT
                c.id AS case_id,
                c.case_title,
                c.created_at,
                c.folder_id,
                uf.originalname AS folder_name,
                uf.folder_path,
                uf.gcs_path
            FROM cases c
            LEFT JOIN user_files uf ON uf.id = c.folder_id
            WHERE c.user_id::text = ANY(%s::text[])
              AND (%s = FALSE OR EXISTS (
                    SELECT 1
                    FROM case_assignments ca
                    WHERE ca.case_id = c.id
                      AND ca.user_id::text = %s::text
                  ))
            ORDER BY c.created_at DESC
        """
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(query, [text_user_ids, limited_firm_user, str(user_id)])
            rows = list(cur.fetchall())

        folders: list[dict[str, Any]] = []
        for row in rows:
            folder_name = row.get("folder_name") or row.get("case_title")
            if not folder_name:
                continue
            folders.append(
                {
                    "id": str(row.get("folder_id") or row.get("case_id")),
                    "name": folder_name,
                    "case_title": row.get("case_title") or folder_name,
                    "folder_path": row.get("folder_path") or "",
                    "gcs_path": row.get("gcs_path"),
                    "created_at": row["created_at"].isoformat() if row.get("created_at") else "",
                    "children": [],
                }
            )
        logger.info(
            "[FolderService] task=list_folders_from_cases_db user_id=%s limited_firm_user=%s folder_count=%s",
            user_id,
            limited_firm_user,
            len(folders),
        )
        return folders

    def _get_accessible_user_ids(self, user_id: str) -> list[str]:
        normalized_user_id = str(user_id)
        candidate_bases = [settings.auth_service_url, settings.api_gateway_url]
        attempted_sources: list[str] = []
        for base_url in candidate_bases:
            normalized_base = str(base_url or "").rstrip("/")
            if not normalized_base or normalized_base in attempted_sources:
                continue
            attempted_sources.append(normalized_base)
            try:
                response = httpx.get(
                    f"{normalized_base}/api/auth/internal/user/{normalized_user_id}/firm-member-ids",
                    timeout=3.0,
                )
                response.raise_for_status()
                user_ids = response.json().get("user_ids", [])
                if isinstance(user_ids, list) and user_ids:
                    normalized_ids = [str(value) for value in user_ids if value is not None]
                    logger.info(
                        "[FolderService] task=resolve_accessible_users user_id=%s source=%s resolved_ids=%s",
                        normalized_user_id,
                        normalized_base,
                        normalized_ids,
                    )
                    return normalized_ids
            except Exception as exc:
                logger.warning(
                    "[FolderService] task=resolve_accessible_users status=retry user_id=%s source=%s error=%s",
                    normalized_user_id,
                    normalized_base,
                    exc,
                )
        logger.warning(
            "[FolderService] task=resolve_accessible_users status=fallback user_id=%s resolved_ids=%s",
            normalized_user_id,
            [normalized_user_id],
        )
        return [normalized_user_id]

    def _get_firm_context(self, user_id: str) -> dict[str, Any] | None:
        normalized_user_id = str(user_id)
        candidate_bases = [settings.auth_service_url, settings.api_gateway_url]
        attempted_sources: list[str] = []
        for base_url in candidate_bases:
            normalized_base = str(base_url or "").rstrip("/")
            if not normalized_base or normalized_base in attempted_sources:
                continue
            attempted_sources.append(normalized_base)
            try:
                response = httpx.get(
                    f"{normalized_base}/api/auth/internal/user/{normalized_user_id}/firm-context",
                    timeout=3.0,
                )
                response.raise_for_status()
                payload = response.json() if isinstance(response.json(), dict) else {}
                logger.info(
                    "[FolderService] task=resolve_firm_context user_id=%s source=%s accountType=%s isFirmAdmin=%s",
                    normalized_user_id,
                    normalized_base,
                    payload.get("accountType"),
                    payload.get("isFirmAdmin"),
                )
                return payload
            except Exception as exc:
                logger.warning(
                    "[FolderService] task=resolve_firm_context status=retry user_id=%s source=%s error=%s",
                    normalized_user_id,
                    normalized_base,
                    exc,
                )
        logger.warning(
            "[FolderService] task=resolve_firm_context status=fallback user_id=%s",
            normalized_user_id,
        )
        return None

    def _is_limited_firm_user(self, user_id: str) -> bool:
        context = self._get_firm_context(user_id) or {}
        account_type = str(context.get("accountType") or "").strip().upper()
        is_firm_admin = bool(context.get("isFirmAdmin"))
        return account_type == "FIRM_USER" and not is_firm_admin

    def _get_assigned_case_ids_for_user(self, user_id: str) -> list[str]:
        if not is_db_available():
            return []
        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT case_id::text AS case_id
                    FROM case_assignments
                    WHERE user_id::text = %s::text
                    """,
                    [str(user_id)],
                )
                rows = list(cur.fetchall())
            case_ids = [str(row.get("case_id")) for row in rows if row.get("case_id") is not None]
            logger.info(
                "[FolderService] task=resolve_assigned_cases user_id=%s assigned_case_ids=%s",
                user_id,
                case_ids,
            )
            return case_ids
        except Exception as exc:
            logger.warning(
                "[FolderService] task=resolve_assigned_cases status=warning user_id=%s error=%s",
                user_id,
                exc,
            )
            return []

    def _list_cases_from_db(self, user_id: str | None) -> list[dict[str, Any]]:
        if not user_id:
            return []
        accessible_user_ids = self._get_accessible_user_ids(user_id)
        text_user_ids = [str(value) for value in accessible_user_ids if value is not None]
        if not text_user_ids:
            return []
        limited_firm_user = self._is_limited_firm_user(str(user_id))
        assigned_case_ids = self._get_assigned_case_ids_for_user(str(user_id)) if limited_firm_user else []
        if limited_firm_user and not assigned_case_ids:
            logger.info(
                "[FolderService] task=list_cases status=restricted_empty user_id=%s reason=no_assigned_cases",
                user_id,
            )
            return []
        query = """
            SELECT
                c.*,
                ct.name AS case_type_name,
                st.name AS sub_type_name,
                co.court_name AS court_name_name,
                uf.originalname AS folder_name
            FROM cases c
            LEFT JOIN case_types ct ON
                CASE
                    WHEN c.case_type ~ '^[0-9]+$' THEN c.case_type::integer = ct.id
                    ELSE false
                END
            LEFT JOIN sub_types st ON
                CASE
                    WHEN c.sub_type ~ '^[0-9]+$' THEN c.sub_type::integer = st.id
                    ELSE false
                END
            LEFT JOIN courts co ON
                CASE
                    WHEN c.court_name ~ '^[0-9]+$' THEN c.court_name::integer = co.id
                    ELSE false
                END
            LEFT JOIN user_files uf ON uf.id = c.folder_id
            WHERE c.user_id::text = ANY(%s::text[])
              AND (%s = FALSE OR c.id::text = ANY(%s::text[]))
            ORDER BY c.created_at DESC
        """
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(query, [text_user_ids, limited_firm_user, assigned_case_ids])
            rows = list(cur.fetchall())
        logger.info(
            "[FolderService] task=list_cases source=db user_id=%s limited_firm_user=%s accessible_user_ids=%s assigned_case_ids=%s result_count=%s",
            user_id,
            limited_firm_user,
            text_user_ids,
            assigned_case_ids,
            len(rows),
        )
        return [self._serialize_case_row(row) for row in rows]

    def _get_case_from_db(self, case_id: str, user_id: str | None) -> dict[str, Any] | None:
        conditions = ["c.id::text = %s"]
        params: list[Any] = [case_id]
        if user_id:
            accessible_user_ids = self._get_accessible_user_ids(user_id)
            text_user_ids = [str(value) for value in accessible_user_ids if value is not None]
            if not text_user_ids:
                return None
            conditions.append("c.user_id::text = ANY(%s::text[])")
            params.append(text_user_ids)
            limited_firm_user = self._is_limited_firm_user(str(user_id))
            if limited_firm_user:
                assigned_case_ids = self._get_assigned_case_ids_for_user(str(user_id))
                if not assigned_case_ids:
                    logger.info(
                        "[FolderService] task=get_case status=restricted_denied user_id=%s case_id=%s reason=no_assigned_cases",
                        user_id,
                        case_id,
                    )
                    return None
                conditions.append("c.id::text = ANY(%s::text[])")
                params.append(assigned_case_ids)
                logger.info(
                    "[FolderService] task=get_case scope user_id=%s case_id=%s limited_firm_user=%s assigned_case_ids=%s",
                    user_id,
                    case_id,
                    limited_firm_user,
                    assigned_case_ids,
                )
        where_clause = " AND ".join(conditions)
        query = f"""
            SELECT
                c.*,
                ct.name AS case_type_name,
                st.name AS sub_type_name,
                co.court_name AS court_name_name,
                uf.originalname AS folder_name
            FROM cases c
            LEFT JOIN case_types ct ON
                CASE
                    WHEN c.case_type ~ '^[0-9]+$' THEN c.case_type::integer = ct.id
                    ELSE false
                END
            LEFT JOIN sub_types st ON
                CASE
                    WHEN c.sub_type ~ '^[0-9]+$' THEN c.sub_type::integer = st.id
                    ELSE false
                END
            LEFT JOIN courts co ON
                CASE
                    WHEN c.court_name ~ '^[0-9]+$' THEN c.court_name::integer = co.id
                    ELSE false
                END
            LEFT JOIN user_files uf ON uf.id = c.folder_id
            WHERE {where_clause}
            LIMIT 1
        """
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(query, params)
            row = cur.fetchone()
        return self._serialize_case_row(row) if row else None

    def _serialize_case_row(self, row: dict[str, Any]) -> dict[str, Any]:
        petitioners = self._parse_jsonish_list(row.get("petitioners"))
        respondents = self._parse_jsonish_list(row.get("respondents"))
        judges = self._parse_jsonish_list(row.get("judges"))
        return {
            "id": str(row["id"]),
            "folder_id": str(row["folder_id"]) if row.get("folder_id") else row.get("folder_name") or str(row["id"]),
            "folder_name": row.get("folder_name") or row.get("case_title"),
            "name": row.get("case_title") or row.get("folder_name"),
            "case_title": row.get("case_title"),
            "case_number": row.get("case_number"),
            "filing_date": row.get("filing_date").isoformat() if row.get("filing_date") else None,
            "case_type": row.get("case_type_name") or row.get("case_type"),
            "sub_type": row.get("sub_type_name") or row.get("sub_type"),
            "court_name": row.get("court_name_name") or row.get("court_name"),
            "court_level": row.get("court_level"),
            "bench_division": row.get("bench_division"),
            "jurisdiction": row.get("jurisdiction"),
            "state": row.get("state"),
            "court_room_no": row.get("court_room_no"),
            "category_type": row.get("category_type"),
            "primary_category": row.get("primary_category"),
            "sub_category": row.get("sub_category"),
            "complexity": row.get("complexity"),
            "monetary_value": row.get("monetary_value"),
            "priority_level": row.get("priority_level"),
            "status": row.get("status") or "Active",
            "case_prefix": row.get("case_prefix"),
            "case_year": row.get("case_year"),
            "case_nature": row.get("case_nature"),
            "next_hearing_date": row.get("next_hearing_date").isoformat() if row.get("next_hearing_date") else None,
            "document_type": row.get("document_type"),
            "filed_by": row.get("filed_by"),
            "judges": judges,
            "petitioners": petitioners,
            "respondents": respondents,
            "created_at": row["created_at"].isoformat() if row.get("created_at") else "",
            "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else "",
        }

    def _parse_jsonish_list(self, value: Any) -> list[Any]:
        if value is None:
            return []
        if isinstance(value, list):
            return value
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            try:
                parsed = json.loads(text)
            except Exception:
                return []
            return parsed if isinstance(parsed, list) else []
        return []

    def _update_document(
        self,
        job_id: str,
        document_id: str,
        status: ProcessingState,
        progress: float,
        operation: str,
        *,
        error: str | None = None,
        doc_type: Any = None,
        stored_document_uri: str | None = None,
        chunk_count: int | None = None,
        quality_score: float | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        with self._lock:
            job = self._jobs[job_id]
            current = job.documents[document_id]
            job.documents[document_id] = current.model_copy(
                update={
                    "status": status,
                    "processing_progress": progress,
                    "current_operation": operation,
                    "error": error,
                    "doc_type": doc_type if doc_type is not None else current.doc_type,
                    "stored_document_uri": stored_document_uri or current.stored_document_uri,
                    "chunk_count": chunk_count if chunk_count is not None else current.chunk_count,
                    "quality_score": quality_score if quality_score is not None else current.quality_score,
                    "metadata": metadata if metadata is not None else current.metadata,
                    "updated_at": datetime.now(tz=UTC),
                }
            )
            job.updated_at = datetime.now(tz=UTC)

    def _get_or_create_session(
        self,
        user_id: str,
        folder_name: str,
        session_id: str | None,
        question: str,
    ) -> ChatSessionRecord:
        key = (session_id or "").strip() or None
        if key and _UUID_HEX32.match(key):
            h = key.lower()
            key = f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"
        elif key and _UUID_DASHED.match(key):
            key = key.lower()
        with self._lock:
            folder_sessions = self._sessions.setdefault(folder_name, {})
            if key and key in folder_sessions:
                return folder_sessions[key]
            now = datetime.now(tz=UTC)
            session = ChatSessionRecord(
                id=key or str(uuid.uuid4()),
                case_id=folder_name,
                user_id=user_id,
                folder_name=folder_name,
                title=(question[:60] or "Case chat").strip(),
                created_at=now,
                updated_at=now,
            )
            folder_sessions[session.id] = session
            return session

    def _save_folder_chat_to_db(
        self,
        *,
        user_id: str,
        folder_name: str,
        question: str,
        answer: str,
        session_id: str,
        citations: list[Any],
        used_secret_prompt: bool = False,
        prompt_label: str | None = None,
        secret_id: str | None = None,
        raise_on_error: bool = False,
        chat_id: str | None = None,
    ) -> bool | None:
        if not is_db_available():
            if raise_on_error:
                raise RuntimeError("folder chat database is unavailable")
            return None
        chunk_ids = []
        summarized_file_ids = []
        normalized_citations = []
        uuid_re = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
        for citation in citations or []:
            as_dict = citation.model_dump(mode="json") if hasattr(citation, "model_dump") else dict(citation)
            normalized_citations.append(as_dict)
            cid = as_dict.get("chunk_id")
            fid = as_dict.get("document_id")
            if cid and uuid_re.match(str(cid)):
                chunk_ids.append(str(cid))
            if fid and uuid_re.match(str(fid)):
                summarized_file_ids.append(str(fid))
        secret_uuid = None
        if secret_id and uuid_re.match(str(secret_id)):
            secret_uuid = str(secret_id)
        # A caller may pre-mint the row id so that memory written about this turn
        # can point back at the exact chat row (source_ref.chat_id). Anything that
        # is not a well-formed UUID is ignored and a fresh id is minted as before.
        row_id = str(chat_id) if chat_id and uuid_re.match(str(chat_id)) else str(uuid.uuid4())
        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO folder_chats
                      (id, user_id, folder_name, question, answer, summarized_file_ids, used_chunk_ids, session_id,
                       used_secret_prompt, prompt_label, secret_id, chat_history, citations, created_at)
                    VALUES
                      (%s::uuid, %s, %s, %s, %s, %s::uuid[], %s::uuid[], %s::uuid,
                       %s, %s, %s::uuid, %s::jsonb, %s::jsonb, NOW())
                    """,
                    (
                        row_id,
                        str(user_id),
                        folder_name,
                        question,
                        answer,
                        [item for item in summarized_file_ids if item],
                        [item for item in chunk_ids if item],
                        normalize_folder_chat_session_uuid(session_id),
                        used_secret_prompt,
                        prompt_label if used_secret_prompt else None,
                        secret_uuid,
                        json.dumps([]),
                        json.dumps(normalized_citations),
                    ),
                )
                conn.commit()
            return True if raise_on_error else None
        except Exception as exc:
            logger.exception(
                "[FolderService] task=save_folder_chat_db status=error folder=%s session_id=%s error=%s",
                folder_name,
                session_id,
                exc,
            )
            if raise_on_error:
                raise
            return None

    def update_latest_chat_answer(
        self,
        *,
        user_id: str,
        folder_name: str,
        session_id: str,
        answer: str,
    ) -> bool:
        """Overwrite the `answer` of the most-recent chat row for this session — used to
        persist edits made in Draft Studio's editor (saved as MARKDOWN). Targets the newest
        row for (user_id, folder_name, session_id) since the client has no row id. Returns
        True when a row was updated."""
        if not is_db_available():
            return False
        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE folder_chats
                       SET answer = %s
                     WHERE id = (
                         SELECT id FROM folder_chats
                          WHERE user_id = %s AND folder_name = %s AND session_id = %s::uuid
                          ORDER BY created_at DESC
                          LIMIT 1
                     )
                    """,
                    (answer, str(user_id), folder_name, normalize_folder_chat_session_uuid(session_id)),
                )
                updated = cur.rowcount > 0
                conn.commit()
                return updated
        except Exception as exc:
            logger.exception(
                "[FolderService] task=update_chat_answer status=error folder=%s session_id=%s error=%s",
                folder_name, session_id, exc,
            )
            return False

    def _append_message(self, session: ChatSessionRecord, role: str, content: str) -> None:
        with self._lock:
            session.messages.append(
                ChatMessage(
                    id=f"msg-{uuid.uuid4().hex[:12]}",
                    role=role,
                    content=content,
                    created_at=datetime.now(tz=UTC),
                    metadata={},
                )
            )
            session.updated_at = datetime.now(tz=UTC)

    def _to_session_model(self, session: ChatSessionRecord) -> ChatSession:
        return ChatSession(
            id=session.id,
            case_id=session.case_id,
            folderName=session.folder_name,
            title=session.title,
            created_at=session.created_at,
            updated_at=session.updated_at,
            messages=session.messages,
        )

    def _record_prompt(
        self,
        *,
        case_id: str,
        user_id: str,
        kind: PromptRecordKind,
        prompt_text: str | None,
        metadata: dict[str, Any],
        secret_prompt: bool,
    ) -> None:
        with self._lock:
            self._prompt_audit.append(
                PromptAuditRecord(
                    id=f"prompt-{uuid.uuid4().hex[:12]}",
                    case_id=case_id,
                    user_id=user_id,
                    kind=kind,
                    prompt_text=None if secret_prompt else prompt_text,
                    stored=not secret_prompt,
                    redacted=secret_prompt,
                    metadata=metadata,
                    created_at=datetime.now(tz=UTC),
                )
            )
