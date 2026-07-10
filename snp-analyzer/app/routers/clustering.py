from fastapi import APIRouter, HTTPException

from pydantic import BaseModel as _BaseModel

from app.models import (
    ClusteringAlgorithm,
    ClusteringRequest,
    ClusteringResult,
    ManualWellTypeUpdate,
    RegionResult,
    ThresholdConfig,
    WellType,
)
from app.processing.clustering import cluster_auto, cluster_kmeans, cluster_threshold
from app.processing.genotype_vocab import validate_ploidy
from app.processing.normalize import normalize_for_cycle
from app.routers.upload import sessions
from app.auth import CurrentUser, check_session_access


class BulkWellTypeReplace(_BaseModel):
    assignments: dict[str, str]


class PloidyUpdate(_BaseModel):
    ploidy: int


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


def _cluster_point_dicts(
    point_dicts, control_wells, algorithm, threshold_config, n_clusters, ploidy
):
    """Cluster one set of points (whole plate OR one marker's well subset).

    Returns ``(assignments, confidences, window, warnings)``. Shared by the
    single-marker path and each marker region, so a region is genotyped
    exactly like a plate. ``warnings`` is ``None`` (not an empty list) when
    there is nothing to flag, so a clean run's output is unchanged."""
    from app.processing.clustering import genotype_window

    confidences: dict[str, float] = {}
    warnings: list[str] = []
    anchor_state: dict = {}
    if algorithm == ClusteringAlgorithm.AUTO:
        config = threshold_config or ThresholdConfig()
        assignments, confidences = cluster_auto(
            point_dicts,
            ntc_threshold=config.ntc_threshold,
            control_wells=control_wells,
            ploidy=ploidy,
            warnings=warnings,
            anchor_state=anchor_state,
        )
    elif algorithm == ClusteringAlgorithm.THRESHOLD:
        config = threshold_config or ThresholdConfig()
        assignments = cluster_threshold(point_dicts, config, ploidy=ploidy)
    else:
        assignments = cluster_kmeans(point_dicts, n_clusters)

    # C1: when allele-control anchors successfully resolved the dosage offset
    # in cluster_auto, that offset is DETERMINED (not a guess) -- tell
    # genotype_window to report it as such instead of re-deriving its own
    # (potentially different) offset guess from the sample ratios alone.
    window = genotype_window(
        point_dicts, assignments, ploidy, anchor_resolved=anchor_state.get("resolved", False)
    )
    return assignments, confidences, window, (warnings or None)


def _run_regions(req, unified, cycle, point_dicts, control_wells) -> ClusteringResult:
    """Genotype each marker region independently on its own well subset + ploidy.

    Each region reuses the same clustering path as a whole plate. Results are
    merged into a flat ``assignments`` map (for legacy plate-level consumers)
    plus a per-region ``RegionResult`` list."""
    from app.processing.genotype import count_genotypes

    pd_by_well = {p["well"]: p for p in point_dicts}

    # One well = one marker.
    seen: set[str] = set()
    for reg in req.regions:
        validate_ploidy(reg.ploidy)
        for w in reg.wells:
            if w in seen:
                raise HTTPException(400, f"Well {w} is assigned to more than one marker")
            seen.add(w)

    region_results: list[RegionResult] = []
    merged_assignments: dict[str, str] = {}
    merged_conf: dict[str, float] = {}
    for reg in req.regions:
        reg_wellset = set(reg.wells)
        sub_points = [pd_by_well[w] for w in reg.wells if w in pd_by_well]
        sub_controls = {w: t for w, t in control_wells.items() if w in reg_wellset}
        assignments, confidences, window, warnings = _cluster_point_dicts(
            sub_points,
            sub_controls,
            req.algorithm,
            reg.threshold_config or req.threshold_config,
            req.n_clusters,
            reg.ploidy,
        )
        region_results.append(
            RegionResult(
                id=reg.id,
                name=reg.name,
                wells=reg.wells,
                ploidy=reg.ploidy,
                assignments=assignments,
                confidences=confidences or None,
                boundaries=window["boundaries"],
                offset=window["offset"],
                offset_uncertain=window["offset_uncertain"],
                low_separation=window["low_separation"],
                genotype_counts=count_genotypes(assignments, reg.ploidy),
                warnings=warnings,
            )
        )
        merged_assignments.update(assignments)
        if confidences:
            merged_conf.update(confidences)

    # Top-level ploidy/boundaries are meaningless when markers differ, so they
    # stay neutral; per-marker values live in ``regions``. unified.ploidy is NOT
    # mutated (it is legacy single-marker state).
    return ClusteringResult(
        algorithm=req.algorithm.value,
        cycle=cycle,
        assignments=merged_assignments,
        confidences=merged_conf or None,
        ploidy=getattr(unified, "ploidy", 2),
        regions=region_results,
    )


@router.post("/api/data/{sid}/cluster")
async def run_clustering(sid: str, req: ClusteringRequest, current_user: CurrentUser):
    check_session_access(sid, current_user)
    unified = _get_session(sid)

    cycle = req.cycle if req.cycle > 0 else max(unified.cycles)
    if cycle not in unified.cycles:
        raise HTTPException(400, f"Cycle {cycle} not available")

    points = normalize_for_cycle(unified, cycle)
    # Wells manually marked as "Omit" have data but should not skew clustering
    # (bad/spiked readings would drag kmeans centroids or threshold ratios).
    omitted = {
        well
        for well, wtype in welltype_store.get(sid, {}).items()
        if wtype == WellType.OMIT.value
    }
    point_dicts = [
        {"well": p.well, "norm_fam": p.norm_fam, "norm_allele2": p.norm_allele2}
        for p in points
        if p.well not in omitted
    ]

    # User-marked controls anchor the analysis: they are honored as-is and
    # excluded from the clustering input. Allele-1/Allele-2 controls (C1) are
    # homozygous reference wells that additionally anchor the dosage ladder's
    # extremes (see cluster_auto) -- they are excluded from the fit exactly
    # like NTC/Positive Control, but also feed the offset resolution.
    control_wells = {
        well: wtype
        for well, wtype in welltype_store.get(sid, {}).items()
        if wtype in (
            WellType.NTC.value,
            WellType.POSITIVE_CONTROL.value,
            WellType.ALLELE1_CONTROL.value,
            WellType.ALLELE2_CONTROL.value,
        )
    }

    if req.regions:
        # Multi-marker: per-region ploidy governs; do NOT persist req.ploidy onto
        # the session (that is single-marker state).
        result = _run_regions(req, unified, cycle, point_dicts, control_wells)
    else:
        # Single-marker (whole plate) — unchanged behavior. Ploidy travels with
        # the request; persist it on the session so downstream views/stats/
        # export/ASG can read it. Default (None) keeps the stored value.
        if req.ploidy is not None:
            validate_ploidy(req.ploidy)
            if req.ploidy != getattr(unified, "ploidy", 2):
                unified.ploidy = req.ploidy
                from app.db import set_session_ploidy
                set_session_ploidy(sid, req.ploidy)

        ploidy = getattr(unified, "ploidy", 2)
        assignments, confidences, window, warnings = _cluster_point_dicts(
            point_dicts,
            control_wells,
            req.algorithm,
            req.threshold_config,
            req.n_clusters,
            ploidy,
        )
        result = ClusteringResult(
            algorithm=req.algorithm.value,
            cycle=cycle,
            assignments=assignments,
            confidences=confidences or None,
            ploidy=ploidy,
            boundaries=window["boundaries"],
            offset=window["offset"],
            offset_uncertain=window["offset_uncertain"],
            low_separation=window["low_separation"],
            warnings=warnings,
        )

    cluster_store[sid] = result

    from app.db import save_clustering
    save_clustering(sid, result)

    return result


@router.get("/api/data/{sid}/ploidy")
async def get_ploidy(sid: str, current_user: CurrentUser):
    """Return the session's ploidy (allele copies per locus; 2 = diploid)."""
    check_session_access(sid, current_user)
    unified = _get_session(sid)
    return {"ploidy": getattr(unified, "ploidy", 2)}


@router.post("/api/data/{sid}/ploidy")
async def set_ploidy(sid: str, body: PloidyUpdate, current_user: CurrentUser):
    """Set the session's ploidy (does not re-run clustering)."""
    check_session_access(sid, current_user)
    unified = _get_session(sid)
    try:
        validate_ploidy(body.ploidy)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    unified.ploidy = body.ploidy
    from app.db import set_session_ploidy
    set_session_ploidy(sid, body.ploidy)
    return {"ploidy": body.ploidy}


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
