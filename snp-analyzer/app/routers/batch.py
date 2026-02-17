"""Batch / Project workflow router.

A "project" groups multiple sessions (runs/plates) together for batch analysis.
Projects are stored in /app/data/projects.json (JSON file, same pattern as presets).
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.processing.genotype import count_genotypes, get_effective_types
from app.processing.quality import score_all_wells
from app.routers.clustering import cluster_store, welltype_store
from app.routers.upload import sessions

router = APIRouter()

PROJECTS_FILE = Path(__file__).resolve().parent.parent / "data" / "projects.json"


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class Project(BaseModel):
    id: str
    name: str
    created_at: str
    session_ids: list[str] = []


class ProjectCreate(BaseModel):
    name: str
    session_ids: list[str] = []


class ProjectUpdate(BaseModel):
    name: str | None = None
    session_ids: list[str] | None = None


# ---------------------------------------------------------------------------
# JSON persistence helpers (same pattern as presets.py)
# ---------------------------------------------------------------------------

def _load_projects() -> list[dict]:
    """Load all projects from the JSON file."""
    if PROJECTS_FILE.exists():
        try:
            return json.loads(PROJECTS_FILE.read_text())
        except (json.JSONDecodeError, IOError):
            return []
    return []


def _save_projects(projects: list[dict]) -> None:
    """Write projects list to JSON file."""
    PROJECTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROJECTS_FILE.write_text(json.dumps(projects, indent=2))


def _find_project(projects: list[dict], project_id: str) -> dict:
    """Find a project by id or raise 404."""
    for p in projects:
        if p["id"] == project_id:
            return p
    raise HTTPException(404, "Project not found")


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------

@router.get("/api/projects")
async def list_projects():
    """List all projects (id, name, created_at, session count)."""
    projects = _load_projects()
    return {
        "projects": [
            {
                "id": p["id"],
                "name": p["name"],
                "created_at": p["created_at"],
                "session_count": len(p.get("session_ids", [])),
            }
            for p in projects
        ]
    }


@router.post("/api/projects")
async def create_project(body: ProjectCreate):
    """Create a new project with auto-generated id and timestamp."""
    projects = _load_projects()
    new_project = {
        "id": uuid.uuid4().hex[:12],
        "name": body.name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "session_ids": body.session_ids,
    }
    projects.append(new_project)
    _save_projects(projects)
    return new_project


@router.get("/api/projects/{project_id}")
async def get_project(project_id: str):
    """Get project detail with per-session summary info."""
    projects = _load_projects()
    project = _find_project(projects, project_id)

    # Build per-session summaries (only for sessions that still exist)
    session_summaries = []
    for sid in project.get("session_ids", []):
        if sid in sessions:
            unified = sessions[sid]
            session_summaries.append({
                "session_id": sid,
                "instrument": unified.instrument,
                "num_wells": len(unified.wells),
                "num_cycles": len(unified.cycles),
            })
        else:
            session_summaries.append({
                "session_id": sid,
                "instrument": "unknown",
                "num_wells": 0,
                "num_cycles": 0,
                "missing": True,
            })

    return {
        **project,
        "sessions": session_summaries,
    }


@router.put("/api/projects/{project_id}")
async def update_project(project_id: str, body: ProjectUpdate):
    """Update project name and/or session_ids."""
    projects = _load_projects()
    project = _find_project(projects, project_id)
    if body.name is not None:
        project["name"] = body.name
    if body.session_ids is not None:
        project["session_ids"] = body.session_ids
    _save_projects(projects)
    return project


@router.delete("/api/projects/{project_id}")
async def delete_project(project_id: str):
    """Delete a project."""
    projects = _load_projects()
    _find_project(projects, project_id)  # raises 404 if not found
    projects = [p for p in projects if p["id"] != project_id]
    _save_projects(projects)
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Session membership endpoints
# ---------------------------------------------------------------------------

@router.post("/api/projects/{project_id}/sessions/{sid}")
async def add_session_to_project(project_id: str, sid: str):
    """Add a session to a project."""
    if sid not in sessions:
        raise HTTPException(404, "Session not found")

    projects = _load_projects()
    project = _find_project(projects, project_id)
    sids = project.get("session_ids", [])
    if sid in sids:
        raise HTTPException(400, "Session already in project")
    sids.append(sid)
    project["session_ids"] = sids
    _save_projects(projects)
    return {"status": "ok", "session_ids": sids}


@router.delete("/api/projects/{project_id}/sessions/{sid}")
async def remove_session_from_project(project_id: str, sid: str):
    """Remove a session from a project."""
    projects = _load_projects()
    project = _find_project(projects, project_id)
    sids = project.get("session_ids", [])
    if sid not in sids:
        raise HTTPException(404, "Session not in project")
    sids.remove(sid)
    project["session_ids"] = sids
    _save_projects(projects)
    return {"status": "ok", "session_ids": sids}


# ---------------------------------------------------------------------------
# Batch summary endpoint
# ---------------------------------------------------------------------------

@router.get("/api/projects/{project_id}/summary")
async def project_summary(project_id: str):
    """Batch summary: per-plate genotype counts, quality scores, cross-plate concordance."""
    projects = _load_projects()
    project = _find_project(projects, project_id)

    plate_summaries: list[dict] = []
    # For concordance: well_id -> list of genotypes across plates
    well_genotypes: dict[str, list[str]] = {}

    for sid in project.get("session_ids", []):
        if sid not in sessions:
            plate_summaries.append({
                "session_id": sid,
                "instrument": "unknown",
                "num_wells": 0,
                "genotypes": {"AA": 0, "BB": 0, "AB": 0, "excluded": 0},
                "ntc_count": 0,
                "unknown_count": 0,
                "mean_quality": 0.0,
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
