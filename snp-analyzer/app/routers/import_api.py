from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import logging
import os
import threading
import time

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.auth import CurrentUser
from app.import_errors import ImportErrorCode, ImportValidationError, make_issue
from app.import_models import AssayModeId, ImportPreview, ImportRun, MappingConfig, ValidationIssue
from app.models import UploadResponse
from app.parsers.generic_table import table_read_scope
from app.parsers.registry import ParserContract, build_default_parser_registry
from app.routers import upload
from app.services.import_session import create_session_from_import
from app.upload_limits import UNREADABLE_FILE_DETAIL, run_parse_limited


PREVIEW_TTL_SECONDS = 30 * 60
# Live previews kept per user; a newer one replaces that user's oldest.
MAX_PREVIEWS_PER_USER = 10

logger = logging.getLogger(__name__)

router = APIRouter()
parser_registry = build_default_parser_registry()


@dataclass
class PreviewRecord:
    preview_id: str
    owner_user_id: str
    file_path: Path
    filename: str
    parser_id: str
    expires_at: float


preview_store: dict[str, PreviewRecord] = {}
_preview_store_lock = threading.Lock()


class ImportParseRequest(BaseModel):
    preview_id: str
    mapping: MappingConfig


def _preview_blocking(path: Path, filename: str):
    """Blocking part of a preview: sniff the file and build the preview.

    Runs in a worker thread. On any failure the spooled file is removed.
    """
    try:
        with table_read_scope():
            parser = parser_registry.match(path, filename)
            if parser is None:
                raise HTTPException(status_code=400, detail="Unsupported import content")
            return parser, parser.preview(path, filename)
    except BaseException:
        _remove_file(path)
        raise


def _keep_preview(parser, preview: ImportPreview, path: Path, filename: str, user_id: str) -> ImportPreview:
    """Register a built preview so it can be parsed later (event loop only)."""
    try:
        preview_id = _new_preview_id()
        preview.preview_id = preview_id
        _store_preview(
            PreviewRecord(
                preview_id=preview_id,
                owner_user_id=user_id,
                file_path=path,
                filename=filename,
                parser_id=parser.parser_id,
                expires_at=time.time() + PREVIEW_TTL_SECONDS,
            )
        )
        return preview
    except BaseException:
        _remove_file(path)
        raise


@router.post("/api/import/preview", response_model=ImportPreview)
async def import_preview(current_user: CurrentUser, file: UploadFile = File(...)) -> ImportPreview | JSONResponse:
    _cleanup_expired_previews()
    filename = file.filename or ""
    ext = upload._validate_upload_metadata(file)
    try:
        tmp_path = await upload._write_upload_to_temp(file, ext)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Import preview could not be read: user=%s file=%r", current_user.user_id, filename)
        raise HTTPException(status_code=400, detail=UNREADABLE_FILE_DETAIL)

    try:
        parser, preview = await run_parse_limited(_preview_blocking, Path(tmp_path), filename)
        return _keep_preview(parser, preview, Path(tmp_path), filename, current_user.user_id)
    except HTTPException:
        _remove_file(Path(tmp_path))
        raise
    except ImportValidationError as exc:
        return _validation_error_response(exc.issues)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Failed to preview import: {exc}")
    except Exception:
        logger.exception("Import preview could not be read: user=%s file=%r", current_user.user_id, filename)
        raise HTTPException(status_code=400, detail=UNREADABLE_FILE_DETAIL)


def _parse_blocking(record: PreviewRecord, request: ImportParseRequest):
    """Blocking part of an import: parse with the mapping (worker thread).

    Returns the unified run, or a JSONResponse for a mapping the analysis
    cannot take.
    """
    parser = _parser_by_id(record.parser_id)
    if parser is None:
        _delete_preview(record.preview_id)
        raise HTTPException(status_code=400, detail="Stored preview parser is no longer available")

    try:
        import_run = parser.parse(record.file_path, record.filename, request.mapping)
        assay_mode = _assay_mode_for_run(import_run, request.mapping)
        if assay_mode != AssayModeId.WT_MT:
            return JSONResponse(
                status_code=409,
                content={
                    "status": "unsupported_analysis_mode",
                    "reason_code": "analysis_mode_preview_only",
                    "assay_mode": assay_mode.value,
                    "message": (
                        "WT/MT1/MT2 and WT/MT1/MT2/MT3 imports are preview-only "
                        "until role-aware analysis support is available."
                    ),
                },
            )
        return parser.to_unified(import_run)
    except ImportValidationError as exc:
        return _validation_error_response(exc.issues)
    except ValueError as exc:
        return _validation_error_response(
            [
                make_issue(
                    ImportErrorCode.MISSING_REQUIRED_ROLE,
                    message=str(exc),
                )
            ]
        )


@router.post("/api/import/parse", response_model=UploadResponse)
async def import_parse(current_user: CurrentUser, request: ImportParseRequest) -> UploadResponse | JSONResponse:
    record = _get_preview_for_parse(request.preview_id, current_user.user_id)
    unified = await run_parse_limited(_parse_blocking, record, request)
    if isinstance(unified, JSONResponse):
        return unified
    user_id = current_user.user_id
    response = create_session_from_import(
        unified=unified,
        filename=record.filename,
        user_id=user_id,
        session_store=upload.sessions,
        # record.file_path still exists on disk -- _delete_preview() below
        # removes it right after (P32 raw-file storage copies it first).
        raw_source_path=record.file_path,
    )
    _delete_preview(record.preview_id)
    return response


def _get_preview_for_parse(preview_id: str, user_id: str) -> PreviewRecord:
    record = preview_store.get(preview_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Preview id not found")
    if record.expires_at <= time.time():
        _delete_preview(preview_id)
        raise HTTPException(status_code=410, detail="Preview id expired")
    if record.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="Preview id belongs to another user")
    return record


def _parser_by_id(parser_id: str) -> ParserContract | None:
    for spec in parser_registry.specs():
        if spec.parser_id == parser_id:
            return spec.parser
    return None


def _assay_mode_for_run(import_run: ImportRun, mapping: MappingConfig) -> AssayModeId:
    raw_mode = import_run.metadata.get("assay_mode") or mapping.assay_mode.value
    return AssayModeId(raw_mode)


def _validation_error_response(issues: list[ValidationIssue]) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "status": "validation_failed",
            "issues": [issue.model_dump(mode="json") for issue in issues],
        },
    )


def _store_preview(record: PreviewRecord) -> None:
    """Add ``record``, dropping the owner's oldest previews beyond the cap."""
    with _preview_store_lock:
        preview_store[record.preview_id] = record
        owned = [r for r in preview_store.values() if r.owner_user_id == record.owner_user_id]
        owned.sort(key=lambda r: (r.expires_at, r is record))
        for stale in owned[: max(0, len(owned) - MAX_PREVIEWS_PER_USER)]:
            _delete_preview(stale.preview_id)


def _cleanup_expired_previews() -> None:
    now = time.time()
    for preview_id, record in list(preview_store.items()):
        if record.expires_at <= now:
            _delete_preview(preview_id)


def _delete_preview(preview_id: str) -> None:
    record = preview_store.pop(preview_id, None)
    if record is not None:
        _remove_file(record.file_path)


def _remove_file(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def _new_preview_id() -> str:
    return os.urandom(16).hex()
