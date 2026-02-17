import os
import tempfile
import uuid

from fastapi import APIRouter, UploadFile, File, HTTPException

from app.config import SUPPORTED_EXTENSIONS
from app.models import UploadResponse
from app.parsers.detector import detect_and_parse

router = APIRouter()

# In-memory session store: session_id -> UnifiedData
sessions: dict = {}


@router.post("/api/upload", response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type: {ext}")

    # Save to temp file
    fd, tmp_path = tempfile.mkstemp(suffix=ext)
    try:
        content = await file.read()
        os.write(fd, content)
        os.close(fd)

        unified = detect_and_parse(tmp_path, original_filename=file.filename or "")
    except Exception as e:
        raise HTTPException(400, f"Failed to parse file: {e}")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    session_id = uuid.uuid4().hex[:12]
    sessions[session_id] = unified

    # Write-through to SQLite
    from app.db import save_session
    save_session(session_id, unified, filename=file.filename or "")

    return UploadResponse(
        session_id=session_id,
        instrument=unified.instrument,
        allele2_dye=unified.allele2_dye,
        num_wells=len(unified.wells),
        num_cycles=len(unified.cycles),
        has_rox=unified.has_rox,
        data_windows=[{"name": w.name, "start_cycle": w.start_cycle, "end_cycle": w.end_cycle} for w in unified.data_windows] if unified.data_windows else None,
    )
