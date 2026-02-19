from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, check_session_access
from app.routers.upload import sessions

router = APIRouter()

# In-memory store for user-edited sample names (overrides parsed names)
# session_id -> {well: name}
sample_name_store: dict[str, dict[str, str]] = {}


class SampleNamesUpdate(BaseModel):
    samples: dict[str, str]


def _get_session(sid: str):
    if sid not in sessions:
        raise HTTPException(404, "Session not found")
    return sessions[sid]


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
    return {"samples": merged}


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
    return {"samples": merged}


@router.delete("/api/data/{sid}/samples")
async def delete_samples(sid: str, current_user: CurrentUser):
    """Clear all user overrides, returning to parsed names only."""
    _get_session(sid)  # validate session exists
    check_session_access(sid, current_user)
    sample_name_store.pop(sid, None)

    from app.db import delete_sample_overrides
    delete_sample_overrides(sid)

    unified = sessions[sid]
    parsed = dict(unified.sample_names) if unified.sample_names else {}
    return {"samples": parsed}


@router.get("/api/sessions")
async def list_sessions(current_user: CurrentUser):
    """Return a list of all active sessions with summary info."""
    # Load raw_filename and created_at from DB for all sessions
    from app.db import get_db
    conn = get_db()
    if current_user.role == "admin":
        db_rows = conn.execute(
            "SELECT session_id, raw_filename, created_at FROM sessions"
        ).fetchall()
    else:
        db_rows = conn.execute(
            "SELECT session_id, raw_filename, created_at FROM sessions WHERE user_id = ?",
            (current_user.user_id,),
        ).fetchall()
    db_info = {r["session_id"]: dict(r) for r in db_rows}

    result = []
    for sid, unified in sessions.items():
        if sid not in db_info:
            continue
        info = db_info[sid]
        result.append(
            {
                "session_id": sid,
                "instrument": unified.instrument,
                "num_wells": len(unified.wells),
                "num_cycles": len(unified.cycles),
                "uploaded_at": info.get("created_at") or "",
                "raw_filename": info.get("raw_filename") or "",
            }
        )
    return result


class BulkDeleteRequest(BaseModel):
    session_ids: list[str]


def _delete_sessions_impl(sids_to_delete: list[str]):
    """Delete multiple sessions from memory, DB, and projects in one go."""
    from app.routers.clustering import cluster_store, welltype_store
    from app.routers.data import protocol_store
    from app.db import get_db

    # Remove from in-memory stores
    for sid in sids_to_delete:
        sessions.pop(sid, None)
        cluster_store.pop(sid, None)
        welltype_store.pop(sid, None)
        sample_name_store.pop(sid, None)
        protocol_store.pop(sid, None)

    # Remove from project_sessions
    conn = get_db()
    placeholders = ",".join("?" * len(sids_to_delete))
    conn.execute(
        f"DELETE FROM project_sessions WHERE session_id IN ({placeholders})",
        sids_to_delete,
    )

    # Remove from DB (CASCADE deletes remaining child tables)
    conn.execute(
        f"DELETE FROM sessions WHERE session_id IN ({placeholders})",
        sids_to_delete,
    )
    conn.commit()


# NOTE: bulk-delete MUST be registered before {sid} to avoid path conflict
@router.post("/api/sessions/bulk-delete")
async def bulk_delete_sessions(body: BulkDeleteRequest, current_user: CurrentUser):
    """Delete multiple sessions in one transaction."""
    if not body.session_ids:
        return {"status": "ok", "deleted": 0}

    # Filter to only sessions the user owns (admin can delete all)
    if current_user.role == "admin":
        sids_to_delete = body.session_ids
    else:
        from app.db import get_session_owner
        sids_to_delete = [
            sid for sid in body.session_ids
            if get_session_owner(sid) in (current_user.user_id, None)
        ]
    if not sids_to_delete:
        return {"status": "ok", "deleted": 0}

    _delete_sessions_impl(sids_to_delete)
    return {"status": "ok", "deleted": len(sids_to_delete)}


@router.get("/api/sessions/{sid}")
async def get_session_info(sid: str, current_user: CurrentUser):
    """Return UploadResponse-compatible info for a session (for re-loading)."""
    if sid not in sessions:
        raise HTTPException(404, "Session not found")
    check_session_access(sid, current_user)
    unified = sessions[sid]

    from app.processing.ntc_detection import compute_suggested_cycle
    suggested = compute_suggested_cycle(unified)

    return {
        "session_id": sid,
        "instrument": unified.instrument,
        "allele2_dye": unified.allele2_dye,
        "num_wells": len(unified.wells),
        "num_cycles": len(unified.cycles),
        "has_rox": unified.has_rox,
        "data_windows": [
            {"name": w.name, "start_cycle": w.start_cycle, "end_cycle": w.end_cycle}
            for w in unified.data_windows
        ] if unified.data_windows else None,
        "suggested_cycle": suggested,
    }


@router.delete("/api/sessions/{sid}")
async def delete_session(sid: str, current_user: CurrentUser):
    """Completely delete a single session."""
    check_session_access(sid, current_user)
    _delete_sessions_impl([sid])
    return {"status": "ok"}
