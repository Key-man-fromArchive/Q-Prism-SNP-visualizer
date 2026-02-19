"""Batch / Project workflow router.

A "project" groups multiple sessions (runs/plates) together for batch analysis.
Projects are stored in the DB (projects + project_sessions tables).
All endpoints require authentication; regular users see only their own projects.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, check_project_access
from app.db import get_db
from app.processing.genotype import count_genotypes, get_effective_types
from app.processing.quality import score_all_wells
from app.routers.clustering import cluster_store, welltype_store
from app.routers.upload import sessions

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class Project(BaseModel):
    id: str
    name: str
    user_id: str
    created_at: str
    session_ids: list[str] = []


class ProjectCreate(BaseModel):
    name: str
    session_ids: list[str] = []


class ProjectUpdate(BaseModel):
    name: str | None = None
    session_ids: list[str] | None = None


class BulkSessionsRequest(BaseModel):
    session_ids: list[str]


# ---------------------------------------------------------------------------
# DB helper functions
# ---------------------------------------------------------------------------

def _get_project_or_404(project_id: str) -> dict:
    """Load a project row from DB or raise 404."""
    conn = get_db()
    row = conn.execute("SELECT id, name, user_id, created_at FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Project not found")
    return dict(row)


def _get_session_ids(project_id: str) -> list[str]:
    """Get ordered session_ids for a project."""
    conn = get_db()
    rows = conn.execute(
        "SELECT session_id FROM project_sessions WHERE project_id = ? ORDER BY position",
        (project_id,),
    ).fetchall()
    return [r["session_id"] for r in rows]


def _set_session_ids(project_id: str, session_ids: list[str]) -> None:
    """Replace all project_sessions for a project with the given ordered list."""
    conn = get_db()
    conn.execute("DELETE FROM project_sessions WHERE project_id = ?", (project_id,))
    for pos, sid in enumerate(session_ids):
        conn.execute(
            "INSERT INTO project_sessions (project_id, session_id, position) VALUES (?, ?, ?)",
            (project_id, sid, pos),
        )
    conn.commit()


def _get_raw_filenames(sids_list: list[str]) -> dict[str, str]:
    """Batch-load raw_filename from the sessions DB table."""
    if not sids_list:
        return {}
    conn = get_db()
    placeholders = ",".join("?" * len(sids_list))
    rows = conn.execute(
        f"SELECT session_id, raw_filename FROM sessions WHERE session_id IN ({placeholders})",
        sids_list,
    ).fetchall()
    return {r["session_id"]: r["raw_filename"] or "" for r in rows}


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------

@router.get("/api/projects")
async def list_projects(current_user: CurrentUser):
    """List all projects (id, name, created_at, session count).
    Regular users see only their own; admin sees all.
    """
    conn = get_db()
    if current_user.role == "admin":
        rows = conn.execute("SELECT id, name, user_id, created_at FROM projects ORDER BY created_at DESC").fetchall()
    else:
        rows = conn.execute(
            "SELECT id, name, user_id, created_at FROM projects WHERE user_id = ? ORDER BY created_at DESC",
            (current_user.user_id,),
        ).fetchall()

    projects = []
    for r in rows:
        count = conn.execute(
            "SELECT COUNT(*) as cnt FROM project_sessions WHERE project_id = ?", (r["id"],)
        ).fetchone()["cnt"]
        projects.append({
            "id": r["id"],
            "name": r["name"],
            "created_at": r["created_at"],
            "session_count": count,
        })

    return {"projects": projects}


@router.post("/api/projects")
async def create_project(body: ProjectCreate, current_user: CurrentUser):
    """Create a new project with auto-generated id and timestamp."""
    conn = get_db()
    project_id = uuid.uuid4().hex[:12]
    created_at = datetime.now(timezone.utc).isoformat()

    conn.execute(
        "INSERT INTO projects (id, name, user_id, created_at) VALUES (?, ?, ?, ?)",
        (project_id, body.name, current_user.user_id, created_at),
    )
    conn.commit()

    # Add initial sessions if provided
    if body.session_ids:
        _set_session_ids(project_id, body.session_ids)

    return {
        "id": project_id,
        "name": body.name,
        "user_id": current_user.user_id,
        "created_at": created_at,
        "session_ids": body.session_ids,
    }


@router.get("/api/projects/{project_id}")
async def get_project(project_id: str, current_user: CurrentUser):
    """Get project detail with per-session summary info."""
    check_project_access(project_id, current_user)
    project = _get_project_or_404(project_id)
    sids_list = _get_session_ids(project_id)
    db_info = _get_raw_filenames(sids_list)

    # Build per-session summaries (only for sessions that still exist in memory)
    session_summaries = []
    for sid in sids_list:
        if sid in sessions:
            unified = sessions[sid]
            session_summaries.append({
                "session_id": sid,
                "instrument": unified.instrument,
                "num_wells": len(unified.wells),
                "num_cycles": len(unified.cycles),
                "raw_filename": db_info.get(sid, ""),
            })
        else:
            session_summaries.append({
                "session_id": sid,
                "instrument": "unknown",
                "num_wells": 0,
                "num_cycles": 0,
                "raw_filename": db_info.get(sid, ""),
                "missing": True,
            })

    return {
        "id": project["id"],
        "name": project["name"],
        "user_id": project["user_id"],
        "created_at": project["created_at"],
        "session_ids": sids_list,
        "sessions": session_summaries,
    }


@router.put("/api/projects/{project_id}")
async def update_project(project_id: str, body: ProjectUpdate, current_user: CurrentUser):
    """Update project name and/or session_ids."""
    check_project_access(project_id, current_user)
    project = _get_project_or_404(project_id)

    conn = get_db()
    if body.name is not None:
        conn.execute("UPDATE projects SET name = ? WHERE id = ?", (body.name, project_id))
        conn.commit()
        project["name"] = body.name

    if body.session_ids is not None:
        _set_session_ids(project_id, body.session_ids)

    sids = body.session_ids if body.session_ids is not None else _get_session_ids(project_id)
    return {
        "id": project["id"],
        "name": project["name"],
        "user_id": project["user_id"],
        "created_at": project["created_at"],
        "session_ids": sids,
    }


@router.delete("/api/projects/{project_id}")
async def delete_project(project_id: str, current_user: CurrentUser):
    """Delete a project (CASCADE removes project_sessions rows)."""
    check_project_access(project_id, current_user)
    _get_project_or_404(project_id)  # raises 404 if not found

    conn = get_db()
    conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    conn.commit()
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Session membership endpoints
# ---------------------------------------------------------------------------

@router.post("/api/projects/{project_id}/sessions/bulk-add")
async def bulk_add_sessions_to_project(project_id: str, body: BulkSessionsRequest, current_user: CurrentUser):
    """Add multiple sessions to a project at once."""
    check_project_access(project_id, current_user)
    _get_project_or_404(project_id)

    sids = _get_session_ids(project_id)
    existing = set(sids)
    added = []
    for sid in body.session_ids:
        if sid not in sessions:
            continue  # skip missing sessions silently
        if sid not in existing:
            sids.append(sid)
            existing.add(sid)
            added.append(sid)

    _set_session_ids(project_id, sids)
    return {"status": "ok", "added": len(added), "session_ids": sids}


@router.post("/api/projects/{project_id}/sessions/bulk-remove")
async def bulk_remove_sessions_from_project(project_id: str, body: BulkSessionsRequest, current_user: CurrentUser):
    """Remove multiple sessions from a project at once."""
    check_project_access(project_id, current_user)
    _get_project_or_404(project_id)

    remove_set = set(body.session_ids)
    old_sids = _get_session_ids(project_id)
    new_sids = [s for s in old_sids if s not in remove_set]
    removed = len(old_sids) - len(new_sids)

    _set_session_ids(project_id, new_sids)
    return {"status": "ok", "removed": removed, "session_ids": new_sids}


@router.post("/api/projects/{project_id}/sessions/{sid}")
async def add_session_to_project(project_id: str, sid: str, current_user: CurrentUser):
    """Add a session to a project."""
    if sid not in sessions:
        raise HTTPException(404, "Session not found")

    check_project_access(project_id, current_user)
    _get_project_or_404(project_id)

    sids = _get_session_ids(project_id)
    if sid in sids:
        raise HTTPException(400, "Session already in project")
    sids.append(sid)

    _set_session_ids(project_id, sids)
    return {"status": "ok", "session_ids": sids}


@router.delete("/api/projects/{project_id}/sessions/{sid}")
async def remove_session_from_project(project_id: str, sid: str, current_user: CurrentUser):
    """Remove a session from a project."""
    check_project_access(project_id, current_user)
    _get_project_or_404(project_id)

    sids = _get_session_ids(project_id)
    if sid not in sids:
        raise HTTPException(404, "Session not in project")
    sids.remove(sid)

    _set_session_ids(project_id, sids)
    return {"status": "ok", "session_ids": sids}


# ---------------------------------------------------------------------------
# Batch summary endpoint
# ---------------------------------------------------------------------------

@router.get("/api/projects/{project_id}/summary")
async def project_summary(project_id: str, current_user: CurrentUser):
    """Batch summary: per-plate genotype counts, quality scores, cross-plate concordance."""
    check_project_access(project_id, current_user)
    project = _get_project_or_404(project_id)
    sids_list = _get_session_ids(project_id)
    db_info = _get_raw_filenames(sids_list)

    plate_summaries: list[dict] = []
    # For concordance: well_id -> list of genotypes across plates
    well_genotypes: dict[str, list[str]] = {}

    for sid in sids_list:
        if sid not in sessions:
            plate_summaries.append({
                "session_id": sid,
                "instrument": "unknown",
                "num_wells": 0,
                "genotypes": {"AA": 0, "BB": 0, "AB": 0, "excluded": 0},
                "ntc_count": 0,
                "unknown_count": 0,
                "mean_quality": 0.0,
                "raw_filename": db_info.get(sid, ""),
                "missing": True,
            })
            continue

        unified = sessions[sid]

        # Get effective genotype assignments
        cluster_assignments = {}
        if sid in cluster_store:
            cluster_assignments = cluster_store[sid].assignments
        manual_assignments = welltype_store.get(sid, {})
        effective = get_effective_types(
            cluster_assignments, manual_assignments, unified.wells
        )

        # Count genotypes
        counts = count_genotypes(effective)

        # Count NTC and Unknown separately
        ntc_count = sum(1 for gt in effective.values() if gt == "NTC")
        unknown_count = sum(
            1 for gt in effective.values() if gt in ("Unknown", "Undetermined")
        )

        # Quality scores
        try:
            quality_scores = score_all_wells(unified, use_rox=unified.has_rox)
            scores = [v["score"] for v in quality_scores.values()]
            mean_quality = round(sum(scores) / len(scores), 1) if scores else 0.0
        except Exception:
            mean_quality = 0.0

        plate_summaries.append({
            "session_id": sid,
            "instrument": unified.instrument,
            "num_wells": len(unified.wells),
            "genotypes": counts,
            "ntc_count": ntc_count,
            "unknown_count": unknown_count,
            "mean_quality": mean_quality,
            "raw_filename": db_info.get(sid, ""),
        })

        # Collect genotypes per well for concordance
        for well, gt in effective.items():
            well_genotypes.setdefault(well, []).append(gt)

    # Calculate concordance: for wells present in 2+ sessions,
    # what % have the same genotype across all appearances
    concordant = 0
    total_compared = 0
    for well, gts in well_genotypes.items():
        if len(gts) < 2:
            continue
        total_compared += 1
        # All genotypes for this well are the same
        if len(set(gts)) == 1:
            concordant += 1

    concordance_pct = (
        round(concordant / total_compared * 100, 1) if total_compared > 0 else None
    )

    return {
        "project_id": project_id,
        "project_name": project["name"],
        "plates": plate_summaries,
        "concordance": {
            "concordant_wells": concordant,
            "total_compared": total_compared,
            "percentage": concordance_pct,
        },
    }
