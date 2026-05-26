import os
import tempfile

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
from app.parsers.registry import PREVIEW_REQUIRED_EXTENSIONS, requires_preview_for_extension
from app.services.import_session import create_session_from_import

router = APIRouter()

# In-memory session store: session_id -> UnifiedData
sessions: dict = {}


def _validate_upload_metadata(file: UploadFile) -> str:
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type: {ext}")

    content_type = (getattr(file, "content_type", "") or "").split(";", 1)[0].strip().lower()
    if content_type and content_type not in SUPPORTED_UPLOAD_CONTENT_TYPES.get(ext, set()):
        raise HTTPException(400, f"Unsupported content type for {ext}: {content_type}")

    return ext


async def _write_upload_to_temp(file: UploadFile, ext: str) -> str:
    fd, tmp_path = tempfile.mkstemp(suffix=ext)
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


@router.post("/api/upload", response_model=UploadResponse | UploadPreviewRequiredResponse)
async def upload_file(current_user: CurrentUser, file: UploadFile = File(...)):
    ext = _validate_upload_metadata(file)

    if requires_preview_for_extension(file.filename or ""):
        return UploadPreviewRequiredResponse(
            filename=file.filename or "",
            message=(
                "This file type requires import preview and channel-to-role mapping "
                "before an analysis session can be created."
            ),
            supported_extensions=sorted(PREVIEW_REQUIRED_EXTENSIONS),
        )

    tmp_path = ""
    try:
        tmp_path = await _write_upload_to_temp(file, ext)
        unified = detect_and_parse(tmp_path, original_filename=file.filename or "")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Failed to parse file: {e}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

    return create_session_from_import(
        unified=unified,
        filename=file.filename or "",
        user_id=current_user.user_id,
        session_store=sessions,
    )
