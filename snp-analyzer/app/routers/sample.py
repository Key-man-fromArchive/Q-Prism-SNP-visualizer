from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.auth import CurrentUser, check_session_access
from app.config import is_asg_launch_mode
from app.processing.background import available_background_modes
from app.routers.upload import sessions
from app.services import raw_file_storage
from app.services.session_restore import get_session as _get_session, restore_session, forget_session

router = APIRouter()


def _raw_file_payload(status: raw_file_storage.RawFileStatus) -> dict:
    """JSON shape shared by the list/detail/status endpoints below -- see
    ``raw_file_storage.RawFileStatus`` for what each ``status`` value means."""
    return {
        "status": status.status,
        "original_filename": status.original_filename,
        "size_bytes": status.size_bytes,
        "sha256": status.sha256,
        "stored_at": status.stored_at,
        "expires_at": status.expires_at,
        "deleted_at": status.deleted_at,
    }

# In-memory store for user-edited sample names (overrides parsed names)
# session_id -> {well: name}
sample_name_store: dict[str, dict[str, str]] = {}


class SampleNamesUpdate(BaseModel):
    samples: dict[str, str]


def _merged_samples(sid: str) -> dict[str, str]:
    """Return merged sample names: parsed names from UnifiedData + user overrides."""
    unified = _get_session(sid)
    parsed = dict(unified.sample_names) if unified.sample_names else {}
    overrides = sample_name_store.get(sid, {})
    parsed.update(overrides)
    return parsed


@router.get("/api/data/{sid}/samples")
async def get_samples(sid: str, current_user: CurrentUser):
    """Return merged sample names (parsed + user overrides) for all wells."""
    check_session_access(sid, current_user)
    merged = _merged_samples(sid)
    unified = _get_session(sid)
    return {"samples": merged, "imported_samples": unified.sample_names or {}}


@router.put("/api/data/{sid}/samples")
async def update_samples(sid: str, body: SampleNamesUpdate, current_user: CurrentUser):
    """Merge user-provided sample names into the override store.

    Only the wells specified in the request body are updated; existing
    overrides for other wells are preserved.
    """
    _get_session(sid)  # validate session exists
    check_session_access(sid, current_user)
    if sid not in sample_name_store:
        sample_name_store[sid] = {}
    sample_name_store[sid].update(body.samples)

    from app.db import save_sample_override
    for well, name in body.samples.items():
        save_sample_override(sid, well, name)

    merged = _merged_samples(sid)
    unified = _get_session(sid)
    return {"samples": merged, "imported_samples": unified.sample_names or {}}


@router.delete("/api/data/{sid}/samples")
async def delete_samples(sid: str, current_user: CurrentUser):
    """Clear all user overrides, returning to parsed names only."""
    unified = _get_session(sid)  # validate session exists (and restore it if cold)
    check_session_access(sid, current_user)
    sample_name_store.pop(sid, None)

    from app.db import delete_sample_overrides
    delete_sample_overrides(sid)

    parsed = dict(unified.sample_names) if unified.sample_names else {}
    return {"samples": parsed, "imported_samples": parsed}


@router.get("/api/sessions")
async def list_sessions(current_user: CurrentUser):
    """Return a list of all sessions with summary info, read straight from the DB.

    Deliberately does NOT touch the in-memory ``sessions`` cache or the
    (potentially ~100k-row) ``well_cycle_data`` table: a session that has
    never been reopened since the process started (or that aged out of the
    bounded cache) must still show up here, and listing must stay cheap no
    matter how many wells x cycles a session holds (see P28 evidence).
    ``num_wells``/``num_cycles`` are the columns app.db.save_session wrote at
    upload time from the SAME ``len(unified.wells)``/``len(unified.cycles)``
    values the in-memory object would report, and are never rewritten after
    that -- there is no discrepancy to reconcile.
    """
    from app.db import get_db
    conn = get_db()
    if current_user.role == "admin" and not is_asg_launch_mode():
        db_rows = conn.execute(
            "SELECT session_id, instrument, num_wells, num_cycles, created_at, raw_filename "
            "FROM sessions ORDER BY created_at DESC"
        ).fetchall()
    else:
        db_rows = conn.execute(
            "SELECT session_id, instrument, num_wells, num_cycles, created_at, raw_filename "
            "FROM sessions WHERE user_id = ? ORDER BY created_at DESC",
            (current_user.user_id,),
        ).fetchall()
    # One bulk lookup (+ one bulk sweep of anything that just expired) for
    # the whole page, instead of a query per row -- see
    # raw_file_storage.bulk_raw_file_status.
    raw_statuses = raw_file_storage.bulk_raw_file_status([row["session_id"] for row in db_rows])
    return [
        {
            "session_id": row["session_id"],
            "instrument": row["instrument"],
            "num_wells": row["num_wells"],
            "num_cycles": row["num_cycles"],
            "uploaded_at": row["created_at"] or "",
            "raw_filename": row["raw_filename"] or "",
            "raw_file": _raw_file_payload(raw_statuses[row["session_id"]]),
        }
        for row in db_rows
    ]


class BulkDeleteRequest(BaseModel):
    session_ids: list[str]


def _delete_sessions_impl(sids_to_delete: list[str]) -> None:
    """Commit deletion before clearing caches; no partially deleted memory."""
    from app.routers.clustering import cluster_store, welltype_store, group_store, marker_store
    from app.routers.data import protocol_store
    from app.db import get_db
    from app.asg_session import forget_session_asg_launch
    from app.processing.analysis_state import input_lock, forget_analysis

    with input_lock:
        conn = get_db()
        placeholders = ",".join("?" * len(sids_to_delete))
        try:
            conn.execute(f"DELETE FROM project_sessions WHERE session_id IN ({placeholders})", sids_to_delete)
            conn.execute(f"DELETE FROM sessions WHERE session_id IN ({placeholders})", sids_to_delete)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        # The DB row (and any session_raw_files row) is already gone via ON
        # DELETE CASCADE; this removes the actual bytes on disk.
        raw_file_storage.delete_raw_files_for_sessions(sids_to_delete)
        stores = (sessions, cluster_store, welltype_store, sample_name_store, protocol_store, group_store, marker_store)
        for sid in sids_to_delete:
            for cache in stores:
                cache.pop(sid, None)
            forget_session_asg_launch(sid)
            forget_analysis(sid)
            forget_session(sid)

# NOTE: bulk-delete MUST be registered before {sid} to avoid path conflict
@router.post("/api/sessions/bulk-delete")
async def bulk_delete_sessions(body: BulkDeleteRequest, current_user: CurrentUser):
    """Delete multiple sessions in one transaction."""
    if not body.session_ids:
        return {"status": "ok", "deleted": 0}

    # Filter to only sessions the user owns (admin can delete all)
    if current_user.role == "admin" and not is_asg_launch_mode():
        sids_to_delete = body.session_ids
    else:
        sids_to_delete = []
        for sid in body.session_ids:
            try:
                check_session_access(sid, current_user)
            except HTTPException:
                continue
            sids_to_delete.append(sid)
    if not sids_to_delete:
        return {"status": "ok", "deleted": 0}

    _delete_sessions_impl(sids_to_delete)
    return {"status": "ok", "deleted": len(sids_to_delete)}


@router.get("/api/sessions/{sid}")
async def get_session_info(sid: str, current_user: CurrentUser):
    """Return UploadResponse-compatible info for a session (for re-loading).

    Restores the session (and its clustering result / manual overrides /
    markers / manual well groups) from the DB first if the process-local
    cache does not have it -- see app.services.session_restore. This is the
    endpoint the frontend calls to reopen a plate; it must work regardless
    of whether the session was ever touched since the process started.
    """
    unified = restore_session(sid)
    if unified is None:
        raise HTTPException(404, "Session not found")
    check_session_access(sid, current_user)

    from app.processing.ntc_detection import compute_suggested_cycle
    suggested = compute_suggested_cycle(unified)
    from app.processing.analysis_state import analysis_status

    from app.db import get_db

    row = get_db().execute(
        "SELECT raw_filename FROM sessions WHERE session_id = ?", (sid,)
    ).fetchone()

    return {
        "session_id": sid,
        "raw_filename": (row["raw_filename"] or "") if row else "",
        "raw_file": _raw_file_payload(raw_file_storage.get_raw_file_status(sid)),
        "input_revision": unified.input_revision,
        **analysis_status(sid),
        "instrument": unified.instrument,
        "allele2_dye": unified.allele2_dye,
        "num_wells": len(unified.wells),
        "well_ids": list(unified.wells),
        "num_cycles": len(unified.cycles),
        "cycles": list(unified.cycles),
        "has_rox": unified.has_rox,
        "data_windows": [
            {"name": w.name, "start_cycle": w.start_cycle, "end_cycle": w.end_cycle}
            for w in unified.data_windows
        ] if unified.data_windows else None,
        "suggested_cycle": suggested,
        "well_groups": unified.well_groups,
        "background_modes": available_background_modes(unified),
    }


@router.delete("/api/sessions/{sid}")
async def delete_session(sid: str, current_user: CurrentUser):
    """Completely delete a single session."""
    check_session_access(sid, current_user)
    _delete_sessions_impl([sid])
    return {"status": "ok"}


@router.get("/api/sessions/{sid}/raw-file")
async def get_raw_file_info(sid: str, current_user: CurrentUser):
    """Report whether the ORIGINAL uploaded file is still available for this
    session, and why not when it isn't (see raw_file_storage.RawFileStatus:
    ``none`` / ``available`` / ``expired`` / ``missing``). Always 200 -- this
    is a status read, not the download itself -- so the frontend can render
    all four states without special-casing an error response.
    """
    check_session_access(sid, current_user)
    return _raw_file_payload(raw_file_storage.get_raw_file_status(sid))


@router.get("/api/sessions/{sid}/raw-file/download")
async def download_raw_file(sid: str, current_user: CurrentUser):
    """Stream back the exact bytes originally uploaded for this session.

    Reuses check_session_access -- the same ownership rule as every other
    per-session endpoint -- so a raw file can never be downloaded by anyone
    but the session's owner (or an admin outside ASG launch mode).
    """
    check_session_access(sid, current_user)
    result = raw_file_storage.open_raw_file_path(sid)
    if result is None:
        status = raw_file_storage.get_raw_file_status(sid)
        code = 410 if status.status == raw_file_storage.STATUS_EXPIRED else 404
        raise HTTPException(status_code=code, detail=_raw_file_payload(status))
    path, original_filename = result
    return FileResponse(path, filename=original_filename, media_type="application/octet-stream")
