from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os
import time

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.auth import CurrentUser
from app.import_errors import ImportErrorCode, ImportValidationError, make_issue
from app.import_models import AssayModeId, ImportPreview, ImportRun, MappingConfig, ValidationIssue
from app.models import UploadResponse
from app.parsers.registry import ParserContract, build_default_parser_registry
from app.routers import upload
from app.services.import_session import create_session_from_import


PREVIEW_TTL_SECONDS = 30 * 60

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


class ImportParseRequest(BaseModel):
    preview_id: str
    mapping: MappingConfig


@router.post("/api/import/preview", response_model=ImportPreview)
async def import_preview(current_user: CurrentUser, file: UploadFile = File(...)) -> ImportPreview | JSONResponse:
    _cleanup_expired_previews()
    ext = upload._validate_upload_metadata(file)
    tmp_path = ""
    try:
        tmp_path = await upload._write_upload_to_temp(file, ext)
        path = Path(tmp_path)
        parser = parser_registry.match(path, file.filename or "")
        if parser is None:
            _remove_file(path)
            raise HTTPException(status_code=400, detail="Unsupported import content")

        preview = parser.preview(path, file.filename or "")
        preview_id = _new_preview_id()
        preview.preview_id = preview_id
        preview_store[preview_id] = PreviewRecord(
            preview_id=preview_id,
            owner_user_id=current_user.user_id,
            file_path=path,
            filename=file.filename or "",
            parser_id=parser.parser_id,
            expires_at=time.time() + PREVIEW_TTL_SECONDS,
        )
        return preview
    except HTTPException:
        raise
    except ImportValidationError as exc:
        if tmp_path:
            _remove_file(Path(tmp_path))
        return _validation_error_response(exc.issues)
    except Exception as exc:
        if tmp_path:
            _remove_file(Path(tmp_path))
        raise HTTPException(status_code=400, detail=f"Failed to preview import: {exc}")


@router.post("/api/import/parse", response_model=UploadResponse)
async def import_parse(current_user: CurrentUser, request: ImportParseRequest) -> UploadResponse | JSONResponse:
    record = _get_preview_for_parse(request.preview_id, current_user.user_id)
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
        unified = parser.to_unified(import_run)
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

    response = create_session_from_import(
        unified=unified,
        filename=record.filename,
        user_id=current_user.user_id,
        session_store=upload.sessions,
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
