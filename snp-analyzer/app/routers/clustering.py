from fastapi import APIRouter, HTTPException

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

router = APIRouter()

# In-memory stores
cluster_store: dict[str, ClusteringResult] = {}
welltype_store: dict[str, dict[str, str]] = {}


def _get_session(sid: str):
    if sid not in sessions:
        raise HTTPException(404, "Session not found")
    return sessions[sid]


@router.post("/api/data/{sid}/cluster")
async def run_clustering(sid: str, req: ClusteringRequest):
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
    return result


@router.get("/api/data/{sid}/cluster")
async def get_clustering(sid: str):
    _get_session(sid)
    if sid not in cluster_store:
        return {"algorithm": None, "cycle": 0, "assignments": {}}
    return cluster_store[sid]


@router.post("/api/data/{sid}/welltypes")
async def set_well_types(sid: str, update: ManualWellTypeUpdate):
    _get_session(sid)
    if sid not in welltype_store:
        welltype_store[sid] = {}
    for well in update.wells:
        welltype_store[sid][well] = update.well_type.value
    return {"status": "ok", "assignments": welltype_store[sid]}


@router.get("/api/data/{sid}/welltypes")
async def get_well_types(sid: str):
    _get_session(sid)
    return {"assignments": welltype_store.get(sid, {})}


@router.delete("/api/data/{sid}/welltypes")
async def clear_well_types(sid: str):
    _get_session(sid)
    welltype_store.pop(sid, None)
    return {"status": "ok"}
