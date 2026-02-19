from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

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
async def get_samples(sid: str):
    """Return merged sample names (parsed + user overrides) for all wells."""
    merged = _merged_samples(sid)
    return {"samples": merged}


@router.put("/api/data/{sid}/samples")
async def update_samples(sid: str, body: SampleNamesUpdate):
    """Merge user-provided sample names into the override store.

    Only the wells specified in the request body are updated; existing
    overrides for other wells are preserved.
    """
    _get_session(sid)  # validate session exists
    if sid not in sample_name_store:
        sample_name_store[sid] = {}
    sample_name_store[sid].update(body.samples)

    from app.db import save_sample_override
    for well, name in body.samples.items():
        save_sample_override(sid, well, name)

    merged = _merged_samples(sid)
    return {"samples": merged}


@router.delete("/api/data/{sid}/samples")
async def delete_samples(sid: str):
    """Clear all user overrides, returning to parsed names only."""
    _get_session(sid)  # validate session exists
    sample_name_store.pop(sid, None)

    from app.db import delete_sample_overrides
    delete_sample_overrides(sid)

    unified = sessions[sid]
    parsed = dict(unified.sample_names) if unified.sample_names else {}
    return {"samples": parsed}


@router.get("/api/sessions")
async def list_sessions():
    """Return a list of all active sessions with summary info."""
    # Load raw_filename and created_at from DB for all sessions
    from app.db import get_db
    conn = get_db()
    db_rows = conn.execute(
        "SELECT session_id, raw_filename, created_at FROM sessions"
    ).fetchall()
    db_info = {r["session_id"]: dict(r) for r in db_rows}

    result = []
    for sid, unified in sessions.items():
        info = db_info.get(sid, {})
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
    from app.routers.batch import _load_projects, _save_projects

    # Remove from in-memory stores
    for sid in sids_to_delete:
        sessions.pop(sid, None)
        cluster_store.pop(sid, None)
        welltype_store.pop(sid, None)
        sample_name_store.pop(sid, None)
        protocol_store.pop(sid, None)

    # Remove from DB in a single transaction (CASCADE deletes child tables)
    conn = get_db()
    placeholders = ",".join("?" * len(sids_to_delete))
    conn.execute(
        f"DELETE FROM sessions WHERE session_id IN ({placeholders})",
        sids_to_delete,
    )
    conn.commit()

    # Remove from all projects
    delete_set = set(sids_to_delete)
    projects = _load_projects()
    changed = False
    for p in projects:
        old_sids = p.get("session_ids", [])
        new_sids = [s for s in old_sids if s not in delete_set]
        if len(new_sids) != len(old_sids):
            p["session_ids"] = new_sids
            changed = True
    if changed:
        _save_projects(projects)


# NOTE: bulk-delete MUST be registered before {sid} to avoid path conflict
@router.post("/api/sessions/bulk-delete")
async def bulk_delete_sessions(body: BulkDeleteRequest):
    """Delete multiple sessions in one transaction."""
    if not body.session_ids:
        return {"status": "ok", "deleted": 0}
    _delete_sessions_impl(body.session_ids)
    return {"status": "ok", "deleted": len(body.session_ids)}


@router.get("/api/sessions/{sid}")
async def get_session_info(sid: str):
    """Return UploadResponse-compatible info for a session (for re-loading)."""
    if sid not in sessions:
        raise HTTPException(404, "Session not found")
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
async def delete_session(sid: str):
    """Completely delete a single session."""
    _delete_sessions_impl([sid])
    return {"status": "ok"}
