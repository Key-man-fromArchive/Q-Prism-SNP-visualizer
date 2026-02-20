from fastapi import APIRouter, HTTPException

from pydantic import BaseModel as _BaseModel

from app.models import (
    ClusteringAlgorithm,
    ClusteringRequest,
    ClusteringResult,
    ManualWellTypeUpdate,
    ThresholdConfig,
)
from app.processing.clustering import cluster_kmeans, cluster_threshold
from app.processing.normalize import normalize_for_cycle
from app.routers.upload import sessions
from app.auth import CurrentUser, check_session_access


class BulkWellTypeReplace(_BaseModel):
    assignments: dict[str, str]


class WellGroupCreate(_BaseModel):
    name: str
    wells: list[str]


router = APIRouter()

# In-memory stores
cluster_store: dict[str, ClusteringResult] = {}
welltype_store: dict[str, dict[str, str]] = {}
group_store: dict[str, dict[str, list[str]]] = {}  # sid -> {group_name: [wells]}


def _get_session(sid: str):
    if sid not in sessions:
        raise HTTPException(404, "Session not found")
    return sessions[sid]


@router.post("/api/data/{sid}/cluster")
async def run_clustering(sid: str, req: ClusteringRequest, current_user: CurrentUser):
    check_session_access(sid, current_user)
    unified = _get_session(sid)

    cycle = req.cycle if req.cycle > 0 else max(unified.cycles)
    if cycle not in unified.cycles:
        raise HTTPException(400, f"Cycle {cycle} not available")

    points = normalize_for_cycle(unified.data, cycle, unified.has_rox)
    point_dicts = [
        {"well": p.well, "norm_fam": p.norm_fam, "norm_allele2": p.norm_allele2}
        for p in points
    ]

    if req.algorithm == ClusteringAlgorithm.THRESHOLD:
        config = req.threshold_config or ThresholdConfig()
        assignments = cluster_threshold(point_dicts, config)
    else:
        assignments = cluster_kmeans(point_dicts, req.n_clusters)

    result = ClusteringResult(
        algorithm=req.algorithm.value, cycle=cycle, assignments=assignments
    )
    cluster_store[sid] = result

    from app.db import save_clustering
    save_clustering(sid, result)

    return result


@router.get("/api/data/{sid}/cluster")
async def get_clustering(sid: str, current_user: CurrentUser):
    check_session_access(sid, current_user)
    _get_session(sid)
    if sid not in cluster_store:
        return {"algorithm": None, "cycle": 0, "assignments": {}}
    return cluster_store[sid]


@router.post("/api/data/{sid}/welltypes")
async def set_well_types(sid: str, update: ManualWellTypeUpdate, current_user: CurrentUser):
    check_session_access(sid, current_user)
    _get_session(sid)
    if sid not in welltype_store:
        welltype_store[sid] = {}
    for well in update.wells:
        welltype_store[sid][well] = update.well_type.value

    from app.db import save_welltype
    for well in update.wells:
        save_welltype(sid, well, update.well_type.value)

    return {"status": "ok", "assignments": welltype_store[sid]}


@router.get("/api/data/{sid}/welltypes")
async def get_well_types(sid: str, current_user: CurrentUser):
    check_session_access(sid, current_user)
    _get_session(sid)
    return {"assignments": welltype_store.get(sid, {})}


@router.delete("/api/data/{sid}/welltypes")
async def clear_well_types(sid: str, current_user: CurrentUser):
    check_session_access(sid, current_user)
    _get_session(sid)
    welltype_store.pop(sid, None)

    from app.db import delete_welltypes
    delete_welltypes(sid)

    return {"status": "ok"}


@router.put("/api/data/{sid}/welltypes/bulk")
async def bulk_replace_well_types(sid: str, body: BulkWellTypeReplace, current_user: CurrentUser):
    """Replace all manual welltypes with the given snapshot (for undo/redo)."""
    check_session_access(sid, current_user)
    _get_session(sid)
    welltype_store[sid] = dict(body.assignments)

    from app.db import delete_welltypes, save_welltype
    delete_welltypes(sid)
    for well, wtype in body.assignments.items():
        save_welltype(sid, well, wtype)

    return {"status": "ok", "assignments": welltype_store[sid]}


# ============================================================================
# Well Groups (parsed + manual)
# ============================================================================


@router.get("/api/data/{sid}/groups")
async def get_well_groups(sid: str, current_user: CurrentUser):
    """Return merged well groups: parsed (from file) + manual (user-created)."""
    check_session_access(sid, current_user)
    unified = _get_session(sid)

    groups: dict[str, dict] = {}

    # Parsed groups (read-only)
    if unified.well_groups:
        for name, wells in unified.well_groups.items():
            groups[name] = {"wells": wells, "source": "parsed"}

    # Manual groups (editable)
    manual = group_store.get(sid, {})
    for name, wells in manual.items():
        groups[name] = {"wells": wells, "source": "manual"}

    return {"groups": groups}


@router.post("/api/data/{sid}/groups")
async def create_well_group(sid: str, body: WellGroupCreate, current_user: CurrentUser):
    """Create or update a manual well group."""
    check_session_access(sid, current_user)
    _get_session(sid)

    if sid not in group_store:
        group_store[sid] = {}
    group_store[sid][body.name] = body.wells

    from app.db import save_well_groups
    save_well_groups(sid, group_store[sid])

    return {"status": "ok", "name": body.name, "wells": body.wells}


@router.delete("/api/data/{sid}/groups/{name}")
async def delete_well_group(sid: str, name: str, current_user: CurrentUser):
    """Delete a single manual well group."""
    check_session_access(sid, current_user)
    _get_session(sid)

    if sid in group_store and name in group_store[sid]:
        del group_store[sid][name]
        from app.db import save_well_groups
        save_well_groups(sid, group_store[sid])

    return {"status": "ok"}


@router.delete("/api/data/{sid}/groups")
async def delete_all_well_groups(sid: str, current_user: CurrentUser):
    """Delete all manual well groups."""
    check_session_access(sid, current_user)
    _get_session(sid)

    group_store.pop(sid, None)
    from app.db import delete_well_groups
    delete_well_groups(sid)

    return {"status": "ok"}
