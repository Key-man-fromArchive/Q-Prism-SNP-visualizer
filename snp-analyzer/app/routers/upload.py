import logging
import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException

from app.auth import CurrentUser
from app.config import (
    MAX_UPLOAD_SIZE_BYTES,
    SUPPORTED_EXTENSIONS,
    SUPPORTED_UPLOAD_CONTENT_TYPES,
    UPLOAD_CHUNK_SIZE,
)
from app.models import UploadPreviewRequiredResponse, UploadResponse
from app.parsers.detector import detect_and_parse
from app.parsers.errors import UploadParseError
from app.parsers.registry import PREVIEW_REQUIRED_EXTENSIONS, requires_preview_for_extension
from app.services.import_session import create_session_from_import, ensure_session_capacity
from app.upload_limits import UNREADABLE_FILE_DETAIL, run_parse_limited

router = APIRouter()

logger = logging.getLogger(__name__)

# Prefix of the spooled upload files in the system temp dir; the periodic
# cleanup (app.services.maintenance) removes leftovers that carry it.
UPLOAD_TEMP_PREFIX = "qprism_upload_"

# In-memory session store: session_id -> UnifiedData
sessions: dict = {}


def _log_rejection(user_id, filename: str, reason: str) -> None:
    """One line per rejected upload: who, which file name, why. Never file content."""
    logger.warning("Upload rejected: user=%s file=%r reason=%s", user_id, filename, reason.replace("\n", " ")[:300])


def _validate_upload_metadata(file: UploadFile) -> str:
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type: {ext}")

    content_type = (getattr(file, "content_type", "") or "").split(";", 1)[0].strip().lower()
    if content_type and content_type not in SUPPORTED_UPLOAD_CONTENT_TYPES.get(ext, set()):
        raise HTTPException(400, f"Unsupported content type for {ext}: {content_type}")

    return ext


async def _write_upload_to_temp(file: UploadFile, ext: str) -> str:
    fd, tmp_path = tempfile.mkstemp(suffix=ext, prefix=UPLOAD_TEMP_PREFIX)
    total_bytes = 0

    try:
        with os.fdopen(fd, "wb") as tmp:
            while True:
                chunk = await file.read(UPLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_SIZE_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File is larger than the {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB upload limit",
                    )
                tmp.write(chunk)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise

    return tmp_path


def _parse_failure(user_id, filename: str, exc: Exception) -> HTTPException:
    """Map a parse failure to a client response.

    Messages the app raises on purpose (``ValueError`` and its subclasses) are
    written for the user and are passed on. Anything else is logged with its
    traceback and answered with a fixed message.
    """
    if isinstance(exc, UploadParseError):
        _log_rejection(user_id, filename, f"{type(exc).__name__}: {exc}")
        # Structured so the UI can explain the cause instead of a generic
        # "request rejected"; `message` keeps the old text for any reader.
        return HTTPException(400, {"code": exc.code, "message": f"Failed to parse file: {exc}"})
    if isinstance(exc, ValueError):
        _log_rejection(user_id, filename, f"{type(exc).__name__}: {exc}")
        return HTTPException(400, f"Failed to parse file: {exc}")
    logger.exception("Upload could not be read: user=%s file=%r", user_id, filename)
    _log_rejection(user_id, filename, type(exc).__name__)
    return HTTPException(400, UNREADABLE_FILE_DETAIL)


def _parse_spooled(tmp_path: str, filename: str, user_id: str):
    """Blocking part of an upload: parse the spooled file.

    Runs in a worker thread; removes ``tmp_path`` when parsing fails. The
    session itself is created back on the event loop, where every other
    database write happens.
    """
    try:
        return detect_and_parse(tmp_path, original_filename=filename)
    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise _parse_failure(user_id, filename, e)


@router.post("/api/upload", response_model=UploadResponse | UploadPreviewRequiredResponse)
async def upload_file(current_user: CurrentUser, file: UploadFile = File(...)):
    filename = file.filename or ""
    try:
        ext = _validate_upload_metadata(file)
    except HTTPException as exc:
        _log_rejection(current_user.user_id, filename, str(exc.detail))
        raise

    if requires_preview_for_extension(filename):
        return UploadPreviewRequiredResponse(
            filename=filename,
            message=(
                "This file type requires import preview and channel-to-role mapping "
                "before an analysis session can be created."
            ),
            supported_extensions=sorted(PREVIEW_REQUIRED_EXTENSIONS),
        )

    ensure_session_capacity(current_user.user_id)

    try:
        tmp_path = await _write_upload_to_temp(file, ext)
    except HTTPException as exc:
        _log_rejection(current_user.user_id, filename, str(exc.detail))
        raise
    except Exception as e:
        raise _parse_failure(current_user.user_id, filename, e)

    # Parsing runs in a worker thread so one slow file does not stall every
    # other request, and at most a couple of files are parsed at once.
    try:
        unified = await run_parse_limited(_parse_spooled, tmp_path, filename, current_user.user_id)
        # tmp_path must still exist on disk here -- store_raw_file() (P32,
        # best-effort) copies it into durable storage before the `finally`
        # below removes this temp file.
        return create_session_from_import(
            unified=unified,
            filename=filename,
            user_id=current_user.user_id,
            session_store=sessions,
            raw_source_path=Path(tmp_path),
        )
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
