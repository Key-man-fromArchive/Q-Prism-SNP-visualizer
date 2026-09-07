import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import uuid4
from typing import Literal

from fastapi import APIRouter, HTTPException

from pydantic import BaseModel as _BaseModel, JsonValue
from starlette.concurrency import run_in_threadpool

from app.models import (
    AnalysisContext,
    AnalysisRegionContext,
    RatioOrigin,
    UnifiedData,
    ClusteringAlgorithm,
    ClusteringRequest,
    ClusteringResult,
    ManualWellTypeUpdate,
    MarkerRegion,
    RegionResult,
    ThresholdConfig,
    WellType,
)
from app.processing.clustering import (
    boundary_confidences,
    cluster_auto,
    cluster_kmeans,
    cluster_threshold,
)
from app.processing.genotype_vocab import validate_ploidy
from app.processing.normalize import normalize_for_cycle, normalization_applies
from app.processing.background import available_background_modes, BackgroundModeError
from app.processing.ratio_origin import compute_ratio_origin, shift_to_origin
from app.routers.upload import sessions
from app.auth import CurrentUser, check_session_access
from app.processing.analysis_state import (
    AnalysisTicket, analysis_status, begin_analysis, check_expected, fail_analysis,
    input_lock, mutate_inputs, publish_analysis,
)


class BulkWellTypeReplace(_BaseModel):
    expected_input_revision: int | None = None
    assignments: dict[str, str]


class PloidyUpdate(_BaseModel):
    expected_input_revision: int | None = None
    ploidy: int


class WellGroupCreate(_BaseModel):
    name: str
    wells: list[str]


class MarkerSetCreate(_BaseModel):
    expected_input_revision: int | None = None
    markers: list[MarkerRegion]


class MarkerUpdate(_BaseModel):
    expected_input_revision: int | None = None
    """Partial update for one marker (PUT /markers/{marker_id}).

    Only the fields the client actually sends are applied (``model_dump
    (exclude_unset=True)`` in the handler) -- an omitted field keeps the
    marker's existing value, while an explicit ``null`` (e.g. clearing
    ``color``) is honored."""
    name: str | None = None
    wells: list[str] | None = None
    ploidy: int | None = None
    color: str | None = None
    threshold_config: ThresholdConfig | None = None


router = APIRouter()

# In-memory stores
cluster_store: dict[str, ClusteringResult] = {}
welltype_store: dict[str, dict[str, str]] = {}
group_store: dict[str, dict[str, list[str]]] = {}  # sid -> {group_name: [wells]}
marker_store: dict[str, list[MarkerRegion]] = {}  # sid -> [MarkerRegion, ...]


def _get_session(sid: str):
    if sid not in sessions:
        raise HTTPException(404, "Session not found")
    return sessions[sid]


def effective_well_types_for(sid: str, unified) -> dict[str, str]:
    """Merge instrument metadata with operator overrides for analysis."""
    imported = dict(getattr(unified, "imported_well_types", None) or {})
    for well in getattr(unified, "ntc_wells", None) or []:
        imported.setdefault(well, WellType.NTC.value)
    imported.update(welltype_store.get(sid, {}))
    return imported


def ntc_wells_for(sid: str, unified) -> set[str]:
    """The plate's effective no-template wells, for use as ratio origin."""
    return {
        well for well, well_type in effective_well_types_for(sid, unified).items()
        if well_type == WellType.NTC.value
    }


def ratio_origin_for(sid: str, unified, points):
    """The one ratio origin for this session's cycle, for every caller.

    Both the plot and the clustering measure ratios from this, so they have to
    agree -- a scatter drawing its boundary rays from one origin while the
    calls were made against another is a plot that visibly contradicts its own
    colours.

    Wells the plate setup declares EMPTY are excluded: an empty well holds no
    reaction mix, so it reads BELOW the wells that do, and it is not evidence
    about where this assay's no-signal floor sits. On a partially-filled plate
    -- the 96-well demo plates use 36-64 wells and leave the rest empty -- an
    estimate taken over every well lands on the empty ones instead of on the
    assay, and every ratio measured from it is wrong. An OMITTED well is a
    different claim (that reading is bad, not "background is elsewhere") and
    still informs the origin.
    """
    well_types = effective_well_types_for(sid, unified)
    filled = [
        p for p in points
        if well_types.get(p.well) != WellType.EMPTY.value
    ]
    return compute_ratio_origin(filled or points, ntc_wells_for(sid, unified))


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
    config = threshold_config or ThresholdConfig()

    # B3: a persisted manual boundary override (the user dragged a radial
    # line) is AUTHORITATIVE for this marker -- label by those cuts directly
    # (threshold-style) and echo back EXACTLY the boundaries/offset supplied,
    # instead of running cluster_auto + genotype_window and letting a fresh
    # fit silently recompute (and thus lose) the user's own decision on every
    # re-cluster / tab-switch. Checked ahead of the per-algorithm branch below
    # so it applies regardless of the request's nominal ``algorithm`` (AUTO or
    # THRESHOLD both default here) -- the cuts ARE the decision, not a hint.
    # Confidence has no fitted mixture to score against here, so it is a
    # simple distance-to-cut proxy (see ``boundary_confidences``).
    if config.boundaries:
        fixed_controls = {
            point["well"]: control_wells[point["well"]]
            for point in point_dicts
            if point["well"] in control_wells
        }
        sample_points = [point for point in point_dicts if point["well"] not in fixed_controls]
        assignments = cluster_threshold(sample_points, config, ploidy=ploidy)
        assignments.update(fixed_controls)
        confidences = boundary_confidences(sample_points, config, ploidy=ploidy)
        confidences.update({well: 1.0 for well in fixed_controls})
        window = {
            "boundaries": list(config.boundaries),
            "offset": config.offset,
            "offset_uncertain": False,
            "low_separation": False,
            "dosage_max": config.dosage_max,
        }
        return assignments, confidences, window, None

    if algorithm == ClusteringAlgorithm.AUTO:
        assignments, confidences = cluster_auto(
            point_dicts,
            ntc_threshold=config.ntc_threshold,
            ntc_fam_max=config.ntc_fam_max,
            ntc_allele2_max=config.ntc_allele2_max,
            control_wells=control_wells,
            ploidy=ploidy,
            warnings=warnings,
            anchor_state=anchor_state,
            # The operator's declared dosage ceiling constrains the AUTO fit --
            # it caps the class count and bounds the dosage window. Declaring
            # it up front is what makes this a constraint instead of a
            # correction: a polyploid assay's reachable range is a property of
            # the assay, not something to be guessed from each plate and then
            # nudged.
            dosage_max=config.dosage_max,
        )
    elif algorithm == ClusteringAlgorithm.THRESHOLD:
        fixed_controls = {
            point["well"]: control_wells[point["well"]]
            for point in point_dicts
            if point["well"] in control_wells
        }
        sample_points = [point for point in point_dicts if point["well"] not in fixed_controls]
        assignments = cluster_threshold(sample_points, config, ploidy=ploidy)
        assignments.update(fixed_controls)
        confidences.update({well: 1.0 for well in fixed_controls})
    else:
        assignments = cluster_kmeans(point_dicts, n_clusters)

    # C1: when allele-control anchors successfully resolved the dosage offset
    # in cluster_auto, that offset is DETERMINED (not a guess) -- tell
    # genotype_window to report it as such instead of re-deriving its own
    # (potentially different) offset guess from the sample ratios alone.
    window = genotype_window(
        point_dicts,
        assignments,
        ploidy,
        anchor_resolved=anchor_state.get("resolved", False),
        dosage_max=config.dosage_max,
    )
    # Echo the ceiling that was applied, so the client shows what the calls
    # were actually made under rather than what it last sent.
    window["dosage_max"] = config.dosage_max
    return assignments, confidences, window, (warnings or None)


def _validate_marker_set(markers: list[MarkerRegion], unified) -> None:
    """Validate a full marker (assay) set against the session's own wells.

    Shared by POST (whole-set replace) and PUT (one marker merged against the
    rest of the existing set) so both paths reject the same structural
    problems with the same 400 + field-naming ``detail`` message, instead of
    a duplicate marker_id ever reaching the DB as an IntegrityError."""
    valid_wells = set(unified.wells)
    seen_ids: set[str] = set()
    seen_names: set[str] = set()
    seen_wells: set[str] = set()
    for marker in markers:
        try:
            validate_ploidy(marker.ploidy)
        except ValueError as exc:
            raise HTTPException(400, str(exc))

        if not marker.name or not marker.name.strip():
            raise HTTPException(400, f"Marker name must not be empty (id={marker.id!r})")

        if not marker.wells:
            raise HTTPException(400, f"Marker {marker.id!r} must have at least one well")

        if marker.id in seen_ids:
            raise HTTPException(400, f"Duplicate marker id: {marker.id!r}")
        seen_ids.add(marker.id)

        if marker.name in seen_names:
            raise HTTPException(400, f"Duplicate marker name: {marker.name!r}")
        seen_names.add(marker.name)

        for well in marker.wells:
            if well not in valid_wells:
                raise HTTPException(400, f"Well {well} is not part of this session's plate")
            if well in seen_wells:
                raise HTTPException(400, f"Well {well} is assigned to more than one marker")
            seen_wells.add(well)


def _region_input_hash(
    wells: list[str],
    ploidy: int,
    cycle: int,
    threshold_config: ThresholdConfig | None = None,
    algorithm: ClusteringAlgorithm | str | None = None,
) -> str:
    """Stable hash of (sorted wells, ploidy, cycle, threshold_config,
    algorithm) -- A5 groundwork.

    Lets a future dirty-flag UI detect when a marker's definition (wells/
    ploidy), a manual boundary/offset edit, the effective clustering
    algorithm, or the analyzed cycle has changed since this result was
    computed, without needing to diff full state. ``threshold_config`` is
    serialized deterministically (``model_dump_json``) so a boundaries/
    offset-only edit changes the hash exactly like a wells/ploidy change."""
    cfg_key = (
        threshold_config.model_dump_json() if threshold_config is not None else "null"
    )
    algo_key = algorithm.value if isinstance(algorithm, ClusteringAlgorithm) else algorithm
    key = f"{sorted(wells)}|{ploidy}|{cycle}|{cfg_key}|{algo_key}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


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
        # Region semantics: a marker is ALWAYS genotyped by the model-based AUTO
        # path unless it carries a manual boundary override (handled inside
        # _cluster_point_dicts via threshold_config.boundaries). The plate-level
        # req.algorithm (THRESHOLD/KMEANS) must NOT force a region into diploid
        # threshold labeling -- e.g. a ploidy-6 marker under THRESHOLD would emit
        # only the diploid Allele-Homo/Het labels, mislabeling every well. Only
        # the single-marker (non-region) path honors req.algorithm.
        reg_config = reg.threshold_config or req.threshold_config
        reg_algorithm = (
            req.algorithm
            if (reg_config and reg_config.boundaries)
            else ClusteringAlgorithm.AUTO
        )
        assignments, confidences, window, warnings = _cluster_point_dicts(
            sub_points,
            sub_controls,
            reg_algorithm,
            reg_config,
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
                dosage_max=window["dosage_max"],
                low_separation=window["low_separation"],
                genotype_counts=count_genotypes(assignments, reg.ploidy),
                warnings=warnings,
                input_hash=_region_input_hash(
                    reg.wells, reg.ploidy, cycle, reg_config, reg_algorithm
                ),
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


def _validate_analysis_request(req: ClusteringRequest, stored_markers: list[MarkerRegion]) -> None:
    """Validate actual analysis domain inputs before disclosing revisions."""
    regions = req.regions or stored_markers
    try:
        if not regions and req.ploidy is not None:
            validate_ploidy(req.ploidy)
        seen: set[str] = set()
        for region in regions:
            validate_ploidy(region.ploidy)
            for well in region.wells:
                if well in seen:
                    raise HTTPException(400, f"Well {well} is assigned to more than one marker")
                seen.add(well)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@dataclass(frozen=True)
class CalculationSnapshot:
    unified: UnifiedData
    request: ClusteringRequest
    cycle: int
    welltypes: dict[str, str]
    manual_welltypes: dict[str, str]


def _capture_analysis(sid: str, req: ClusteringRequest) -> tuple[AnalysisTicket, CalculationSnapshot]:
    # No await under this short boundary. Workers receive copies and never use DB.
    with input_lock:
        unified = _get_session(sid)
        resolved = req.model_copy(deep=True)
        resolved.regions = [m.model_copy(deep=True) for m in (req.regions or marker_store.get(sid, []))]
        from app.processing.cycle_selection import resolve_cycle
        cycle = resolve_cycle(unified.cycles, req.cycle, req.cycle_mode)
        if cycle not in unified.cycles:
            raise HTTPException(400, f"Cycle {cycle} not available")
        _validate_analysis_request(resolved, [])
        background = req.background or "none"
        if background not in available_background_modes(unified):
            raise BackgroundModeError(f"Background mode {background!r} is not valid for this run")
        check_expected(unified, req.expected_input_revision)
        if not resolved.regions and req.ploidy is not None:
            mutate_inputs(sid, req.expected_input_revision, ploidy=req.ploidy)
        snapshot = CalculationSnapshot(unified.model_copy(deep=True), resolved, cycle,
                                       effective_well_types_for(sid, unified),
                                       dict(welltype_store.get(sid, {})))
        return begin_analysis(sid, unified), snapshot


def _snapshot_points(snapshot: CalculationSnapshot):
    req, unified = snapshot.request, snapshot.unified
    points = normalize_for_cycle(unified, snapshot.cycle, use_rox=req.use_rox, background=req.background)
    filled = [p for p in points if snapshot.welltypes.get(p.well) != WellType.EMPTY.value]
    ntcs = {well for well, kind in snapshot.welltypes.items() if kind == WellType.NTC.value}
    origin = compute_ratio_origin(filled or points, ntcs)
    excluded = {well for well, kind in snapshot.welltypes.items()
                if kind in (WellType.OMIT.value, WellType.EMPTY.value)}
    point_dicts = shift_to_origin([
        {"well": p.well, "norm_fam": p.norm_fam, "norm_allele2": p.norm_allele2,
         "plot_fam": p.norm_fam, "plot_allele2": p.norm_allele2}
        for p in points if p.well not in excluded
    ], origin)
    return point_dicts, origin, excluded


def _snapshot_controls(snapshot: CalculationSnapshot) -> dict[str, str]:
    return {well: kind for well, kind in snapshot.welltypes.items()
            if kind in (WellType.NTC.value, WellType.POSITIVE_CONTROL.value,
                        WellType.ALLELE1_CONTROL.value, WellType.ALLELE2_CONTROL.value)}


def _single_result(snapshot: CalculationSnapshot, points, controls) -> ClusteringResult:
    req, ploidy = snapshot.request, snapshot.unified.ploidy
    assignments, confidences, window, warnings = _cluster_point_dicts(
        points, controls, req.algorithm, req.threshold_config, req.n_clusters, ploidy)
    return ClusteringResult(
        algorithm=req.algorithm.value, cycle=snapshot.cycle, assignments=assignments,
        confidences=confidences or None, ploidy=ploidy, warnings=warnings, **window)


def _actual_algorithm(requested: ClusteringAlgorithm, config: ThresholdConfig, *, region: bool) -> ClusteringAlgorithm:
    if config.boundaries:
        return ClusteringAlgorithm.THRESHOLD
    return ClusteringAlgorithm.AUTO if region else requested


def _resolved_parameters(req: ClusteringRequest, ploidy: int, config: ThresholdConfig,
                         actual: ClusteringAlgorithm, result: ClusteringResult | RegionResult) -> dict[str, JsonValue]:
    return {
        "requested_algorithm": req.algorithm.value, "ploidy": ploidy,
        "n_clusters": req.n_clusters, "n_clusters_applied": actual == ClusteringAlgorithm.KMEANS,
        "threshold_config": config.model_dump(mode="json"),
        "actual_window": {"boundaries": None if result.boundaries is None else [float(v) for v in result.boundaries], "offset": result.offset,
                          "offset_uncertain": result.offset_uncertain,
                          "dosage_max": result.dosage_max, "low_separation": result.low_separation},
    }


def _region_contexts(snapshot: CalculationSnapshot, result: ClusteringResult) -> list[AnalysisRegionContext]:
    req = snapshot.request
    contexts = []
    for marker, region_result in zip(req.regions or [], result.regions or [], strict=True):
        config = marker.threshold_config or req.threshold_config or ThresholdConfig()
        actual = _actual_algorithm(req.algorithm, config, region=True)
        contexts.append(AnalysisRegionContext(
            marker_id=marker.id, name=marker.name, wells=list(marker.wells), ploidy=marker.ploidy,
            algorithm=actual, parameters=_resolved_parameters(req, marker.ploidy, config, actual, region_result)))
    return contexts


def _normalization_was_applied(snapshot: CalculationSnapshot) -> bool:
    if not normalization_applies(snapshot.unified, use_rox=snapshot.request.use_rox):
        return False
    return any((reading.normalization_value if reading.normalization_value is not None else reading.rox or 0) > 0
               for reading in snapshot.unified.data if reading.cycle == snapshot.cycle)


def _attach_context(snapshot: CalculationSnapshot, result: ClusteringResult, origin: RatioOrigin,
                    excluded: set[str]) -> None:
    req = snapshot.request
    config = req.threshold_config or ThresholdConfig()
    actual = _actual_algorithm(req.algorithm, config, region=False)
    regions = _region_contexts(snapshot, result)
    algorithms = {region.algorithm for region in regions}
    aggregate: ClusteringAlgorithm | Literal["mixed"] = next(iter(algorithms)) if len(algorithms) == 1 else "mixed"
    parameters = _resolved_parameters(req, snapshot.unified.ploidy, config, actual, result)
    parameters["scope"] = "regions" if regions else "whole_plate"
    if regions:
        parameters["n_clusters_applied"] = False
    parameters.update({"effective_well_types": dict(snapshot.welltypes),
                       "manual_well_types": dict(snapshot.manual_welltypes),
                       "ratio_origin": origin.model_dump(mode="json"), "excluded_wells": [well for well in sorted(excluded)]})
    result.analysis_context = AnalysisContext(
        schema_version=1, result_revision=uuid4(), analysed_at=datetime.now(timezone.utc),
        cycle=snapshot.cycle, use_rox=req.use_rox,
        normalization_applied=_normalization_was_applied(snapshot),
        background=req.background or "none", algorithm=aggregate if regions else actual,
        parameters=parameters, regions=regions, input_revision=snapshot.unified.input_revision)


def _calculate_snapshot(snapshot: CalculationSnapshot) -> ClusteringResult:
    """Pure worker: no sessions/stores/DB access, scientific functions unchanged."""
    points, origin, excluded = _snapshot_points(snapshot)
    controls = _snapshot_controls(snapshot)
    if snapshot.request.regions:
        result = _run_regions(snapshot.request, snapshot.unified, snapshot.cycle, points, controls)
    else:
        result = _single_result(snapshot, points, controls)
    _attach_context(snapshot, result, origin, excluded)
    return result


@router.post("/api/data/{sid}/cluster")
async def run_clustering(sid: str, req: ClusteringRequest, current_user: CurrentUser):
    check_session_access(sid, current_user)
    ticket, snapshot = _capture_analysis(sid, req)
    try:
        result = await run_in_threadpool(_calculate_snapshot, snapshot)
        publish_analysis(ticket, result)
    except BaseException:
        fail_analysis(ticket)
        raise
    return {**result.model_dump(exclude_none=True), "input_revision": snapshot.unified.input_revision,
            **analysis_status(sid)}


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
    _get_session(sid)
    try:
        validate_ploidy(body.ploidy)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    revision = mutate_inputs(sid, body.expected_input_revision, ploidy=body.ploidy)
    return {"ploidy": body.ploidy, "input_revision": revision}


@router.get("/api/data/{sid}/cluster")
async def get_clustering(sid: str, current_user: CurrentUser):
    check_session_access(sid, current_user)
    unified = _get_session(sid)
    if sid not in cluster_store:
        return {"algorithm": None, "cycle": 0, "assignments": {}, "input_revision": unified.input_revision, **analysis_status(sid)}
    return {**cluster_store[sid].model_dump(exclude_none=True), "input_revision": unified.input_revision, **analysis_status(sid)}


@router.post("/api/data/{sid}/welltypes")
async def set_well_types(sid: str, update: ManualWellTypeUpdate, current_user: CurrentUser):
    check_session_access(sid, current_user)
    _get_session(sid)
    proposed = {**welltype_store.get(sid, {}),
                **dict.fromkeys(update.wells, update.well_type.value)}
    revision = mutate_inputs(sid, update.expected_input_revision, welltypes=proposed)

    unified = _get_session(sid)
    assignments = dict(unified.imported_well_types or {})
    assignments.update(welltype_store.get(sid, {}))
    return {
        "status": "ok",
        "input_revision": revision,
        "assignments": assignments,
        "imported_assignments": unified.imported_well_types or {},
    }


@router.get("/api/data/{sid}/welltypes")
async def get_well_types(sid: str, current_user: CurrentUser):
    check_session_access(sid, current_user)
    unified = _get_session(sid)
    assignments = dict(unified.imported_well_types or {})
    assignments.update(welltype_store.get(sid, {}))
    return {
        "assignments": assignments,
        "imported_assignments": unified.imported_well_types or {},
    }


@router.delete("/api/data/{sid}/welltypes")
async def clear_well_types(sid: str, current_user: CurrentUser, expected_input_revision: int | None = None):
    check_session_access(sid, current_user)
    _get_session(sid)
    revision = mutate_inputs(sid, expected_input_revision, welltypes={})
    return {"status": "ok", "input_revision": revision}


@router.put("/api/data/{sid}/welltypes/bulk")
async def bulk_replace_well_types(sid: str, body: BulkWellTypeReplace, current_user: CurrentUser):
    """Replace all manual welltypes with the given snapshot (for undo/redo)."""
    check_session_access(sid, current_user)
    _get_session(sid)
    revision = mutate_inputs(sid, body.expected_input_revision, welltypes=dict(body.assignments))

    unified = _get_session(sid)
    assignments = dict(unified.imported_well_types or {})
    assignments.update(welltype_store.get(sid, {}))
    return {
        "status": "ok",
        "assignments": assignments,
        "input_revision": revision,
        "imported_assignments": unified.imported_well_types or {},
    }


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


# ============================================================================
# Marker (assay) definitions — first-class, persisted resource.
#
# A marker OWNS wells/ploidy/color/threshold_config/name. It does NOT store
# well_type or sample_id -- those already live in manual_welltypes /
# sample_name_overrides (per-well, keyed by well) and are never duplicated
# here. Source of truth is the marker_regions table (app/db.py), not
# sessions.metadata_json (which set_session_ploidy rewrites wholesale).
# ============================================================================


@router.get("/api/data/{sid}/markers")
async def get_markers(sid: str, current_user: CurrentUser):
    """Return the session's marker (assay) definitions."""
    check_session_access(sid, current_user)
    _get_session(sid)
    return {"markers": marker_store.get(sid, [])}


@router.post("/api/data/{sid}/markers")
async def create_markers(sid: str, body: MarkerSetCreate, current_user: CurrentUser):
    """Create or replace the session's whole marker set.

    One well may belong to at most one marker (mirrors the one-well-one-marker
    rule already enforced for clustering regions in ``_run_regions``). Every
    marker is also validated (ploidy, non-empty name/wells, no duplicate id/
    name, wells within the plate) before anything is written, so a bad marker
    can never reach the DB as an IntegrityError."""
    check_session_access(sid, current_user)
    unified = _get_session(sid)

    _validate_marker_set(body.markers, unified)

    # DB-before-memory: write the durable copy first so a DB failure cannot
    # leave the in-memory store ahead of what is actually persisted.
    revision = mutate_inputs(sid, body.expected_input_revision, markers=list(body.markers))
    # Preserve prior provenance; its captured revision now identifies stale input.
    return {"markers": marker_store.get(sid, []), "input_revision": revision}


@router.put("/api/data/{sid}/markers/{marker_id}")
async def update_marker(sid: str, marker_id: str, body: MarkerUpdate, current_user: CurrentUser):
    """Update one marker's fields (name/wells/ploidy/color/threshold_config).

    Only fields explicitly present in the request body are changed; anything
    omitted keeps the marker's current value. The merged marker is validated
    against the REST of the session's marker set (same rules as POST)."""
    check_session_access(sid, current_user)
    unified = _get_session(sid)

    markers = marker_store.get(sid, [])
    idx = next((i for i, m in enumerate(markers) if m.id == marker_id), None)
    if idx is None:
        raise HTTPException(404, f"Marker {marker_id!r} not found")

    updates = body.model_dump(exclude_unset=True, exclude={"expected_input_revision"})
    merged = {**markers[idx].model_dump(), **updates}
    updated_marker = MarkerRegion(**merged)

    others = [m for i, m in enumerate(markers) if i != idx]
    _validate_marker_set(others + [updated_marker], unified)

    new_markers = list(markers)
    new_markers[idx] = updated_marker

    # DB-before-memory (dbfix): persist first, then update memory.
    revision = mutate_inputs(sid, body.expected_input_revision, markers=new_markers)
    return {"markers": marker_store[sid], "input_revision": revision}


@router.delete("/api/data/{sid}/markers")
async def delete_markers(sid: str, current_user: CurrentUser, expected_input_revision: int | None = None):
    """Clear the session's marker (assay) definitions."""
    check_session_access(sid, current_user)
    _get_session(sid)

    # DB-before-memory: delete the durable copy first.
    revision = mutate_inputs(sid, expected_input_revision, markers=[])
    return {"status": "ok", "input_revision": revision}
