from __future__ import annotations

from datetime import datetime, timezone

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
    merged = _merged_samples(sid)
    return {"samples": merged}


@router.delete("/api/data/{sid}/samples")
async def delete_samples(sid: str):
    """Clear all user overrides, returning to parsed names only."""
    _get_session(sid)  # validate session exists
    sample_name_store.pop(sid, None)
    unified = sessions[sid]
    parsed = dict(unified.sample_names) if unified.sample_names else {}
    return {"samples": parsed}


@router.get("/api/sessions")
async def list_sessions():
    """Return a list of all active sessions with summary info."""
    result = []
    now_str = datetime.now(timezone.utc).isoformat()
    for sid, unified in sessions.items():
        result.append(
            {
                "session_id": sid,
                "instrument": unified.instrument,
                "num_wells": len(unified.wells),
                "num_cycles": len(unified.cycles),
                "uploaded_at": now_str,
            }
        )
    return result
