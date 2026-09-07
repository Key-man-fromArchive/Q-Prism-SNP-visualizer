"""Validated, detached whole-run exports shared by format adapters.

Capture on the request thread: SQLite and live stores never enter render workers.
The in-process input lock is the same single-process boundary as publication.
Adapters own these copies and must not mutate them or read live state afterwards.
"""
from copy import deepcopy
from dataclasses import dataclass
import math
from typing import Literal, NoReturn
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, Field, JsonValue, TypeAdapter, ValidationError

from app.auth import TokenData, check_session_access
from app.models import (
    AnalysisContext, AnalysisRegionContext, ClusteringResult, NormalizedPoint,
    ProtocolStep, RatioOrigin, ThresholdConfig, UnifiedData,
)
from app.processing.analysis_state import analysis_status, input_lock
from app.processing.background import BackgroundMode, available_background_modes
from app.processing.normalize import normalize_for_cycle


@dataclass(frozen=True)
class ExportOptions:
    result_revision: UUID | None = None
    cycle: int | None = None
    use_rox: bool | None = None
    background: BackgroundMode | None = None


@dataclass(frozen=True)
class ResultSnapshot:
    session_id: str
    unified: UnifiedData
    result: ClusteringResult
    context: AnalysisContext
    current_input_revision: int
    overrides: dict[str, str]
    sample_names: dict[str, str]
    groups: dict[str, list[str]]
    group_sources: dict[str, str]
    protocol: list[ProtocolStep]
    raw_filename: str
    passive_reference_label: str


@dataclass(frozen=True)
class ResultRow:
    well: str
    sample_name: str
    genotype: str
    confidence: float | None
    point: NormalizedPoint | None
    marker: AnalysisRegionContext | None
    ploidy: int | None
    assignment_status: str
    read_status: str


class _ActualWindow(BaseModel):
    boundaries: list[float] | None
    offset: int
    offset_uncertain: bool
    dosage_max: int | None
    low_separation: bool


class _ResolvedInputs(BaseModel):
    requested_algorithm: Literal["threshold", "auto", "kmeans"]
    ploidy: int = Field(ge=1)
    n_clusters: int
    n_clusters_applied: bool
    threshold_config: ThresholdConfig
    actual_window: _ActualWindow


def _validate_resolved_inputs(parameters: dict[str, JsonValue]) -> None:
    captured = _ResolvedInputs.model_validate(parameters, strict=True)
    if captured.threshold_config.model_fields_set != ThresholdConfig.model_fields.keys():
        raise ValueError("Incomplete captured threshold configuration")


def _validate_region_structure(context: AnalysisContext, result: ClusteringResult, data: UnifiedData) -> None:
    actual = [(r.marker_id, r.name, r.wells, r.ploidy) for r in context.regions]
    stored = [(r.id, r.name, r.wells, r.ploidy) for r in result.regions or []]
    if actual != stored:
        raise ValueError("Inconsistent captured regions")
    _validate_membership(context, data)


def _validate_membership(context: AnalysisContext, data: UnifiedData) -> None:
    ids = [r.marker_id for r in context.regions]
    wells = [well for r in context.regions for well in r.wells]
    if len(set(ids)) != len(ids) or len(set(wells)) != len(wells):
        raise ValueError("Duplicate captured marker membership")
    if not set(wells) <= set(data.wells):
        raise ValueError("Captured marker well is absent")


def _validate_context_structure(context: AnalysisContext, result: ClusteringResult, data: UnifiedData) -> None:
    if context.cycle != result.cycle or context.cycle not in data.cycles:
        raise ValueError("Inconsistent captured cycle")
    _validate_resolved_inputs(context.parameters)
    _validate_region_structure(context, result, data)
    for region in context.regions:
        _validate_resolved_inputs(region.parameters)


def _conflict(code: str, message: str, revision: int) -> NoReturn:
    raise HTTPException(409, detail={
        "code": code, "message": message, "current_input_revision": revision,
    })


def _validate_domain(data: UnifiedData, options: ExportOptions) -> int | None:
    cycle = options.cycle
    if cycle == 0:
        cycle = max(data.cycles)
    if cycle is not None and cycle not in data.cycles:
        raise HTTPException(400, "Cycle not available")
    if options.background is not None and options.background not in available_background_modes(data):
        raise HTTPException(400, "Background mode is not valid for this run")
    return cycle


def _captured_overrides(context: AnalysisContext) -> dict[str, str]:
    """Require explicit provenance; do not backfill historical contexts."""
    parameters = context.parameters
    types = TypeAdapter(dict[str, str]).validate_python(parameters["effective_well_types"], strict=True)
    manual = TypeAdapter(dict[str, str]).validate_python(parameters["manual_well_types"], strict=True)
    TypeAdapter(list[str]).validate_python(parameters["excluded_wells"], strict=True)
    origin_data = parameters["ratio_origin"]
    if not isinstance(origin_data, dict) or not {"fam", "allele2", "source"} <= origin_data.keys():
        raise ValueError("Missing captured origin")
    origin = RatioOrigin.model_validate(origin_data, strict=True)
    if not math.isfinite(origin.fam) or not math.isfinite(origin.allele2):
        raise ValueError("Nonfinite captured origin")
    overrides = {well: kind for well, kind in types.items() if kind != "Unknown"}
    overrides.update(manual)
    return overrides


def _validate_result(
    sid: str, data: UnifiedData, result: ClusteringResult | None,
) -> tuple[AnalysisContext, dict[str, str]]:
    revision = data.input_revision
    if analysis_status(sid)["analysis_pending"]:
        _conflict("ANALYSIS_IN_PROGRESS", "Wait for the active analysis", revision)
    if result is None:
        _conflict("NO_COMPLETED_RESULT", "Analyze before exporting", revision)
    context = result.analysis_context
    if context is None:
        _conflict("LEGACY_CONTEXT_UNKNOWN", "Reanalyze to capture provenance", revision)
    try:
        _validate_context_structure(context, result, data)
        overrides = _captured_overrides(context)
    except (KeyError, ValueError, ValidationError):
        _conflict("LEGACY_CONTEXT_UNKNOWN", "Required captured provenance is incomplete", revision)
    if context.input_revision != revision:
        _conflict("INPUT_REVISION_CONFLICT", "The completed result is stale", revision)
    return context, overrides


def _validate_conditions(
    context: AnalysisContext, options: ExportOptions, cycle: int | None,
) -> None:
    if options.result_revision is not None and options.result_revision != context.result_revision:
        _conflict("RESULT_REVISION_CONFLICT", "The requested result was replaced", context.input_revision)
    comparisons = ((cycle, context.cycle), (options.use_rox, context.use_rox),
                   (options.background, context.background))
    if any(requested is not None and requested != actual for requested, actual in comparisons):
        _conflict("EXPORT_CONDITION_MISMATCH", "Use the stored analysis conditions", context.input_revision)


def capture_result_snapshot(
    sid: str, user: TokenData, options: ExportOptions,
) -> ResultSnapshot:
    from app.db import get_db
    from app.routers.clustering import cluster_store, group_store
    from app.routers.data import protocol_store
    from app.routers.sample import sample_name_store
    from app.routers.upload import sessions

    with input_lock:
        check_session_access(sid, user)
        if sid not in sessions:
            raise HTTPException(404, "Session not found")
        data = sessions[sid]
        cycle = _validate_domain(data, options)
        result = cluster_store.get(sid)
        context, overrides = _validate_result(sid, data, result)
        _validate_conditions(context, options, cycle)
        # _validate_result guarantees presence; fetch within this same lock.
        completed = cluster_store[sid].model_copy(deep=True)
        metadata = get_db().execute(
            "SELECT raw_filename FROM sessions WHERE session_id=?", (sid,),
        ).fetchone()
        return ResultSnapshot(
            sid, data.model_copy(deep=True), completed, context.model_copy(deep=True),
            data.input_revision, overrides,
            {**(data.sample_names or {}), **sample_name_store.get(sid, {})},
            deepcopy({**(data.well_groups or {}), **group_store.get(sid, {})}),
            {**dict.fromkeys(data.well_groups or {}, "parsed"),
             **dict.fromkeys(group_store.get(sid, {}), "manual")},
            deepcopy(protocol_store.get(sid, data.protocol_steps or [])),
            str(metadata["raw_filename"] or "") if metadata else "",
            _reference_label(data, context.cycle),
        )


def _reference_label(data: UnifiedData, cycle: int) -> str:
    explicit = data.normalization_dye or data.normalization_channel
    if explicit:
        return explicit
    unidentified_reference = any(
        reading.normalization_value is not None
        for reading in data.data if reading.cycle == cycle
    )
    if data.has_rox and not unidentified_reference:
        return "ROX"
    return "unknown"


def _row_call(snapshot: ResultSnapshot, well: str, marker: AnalysisRegionContext | None) -> tuple[str, str]:
    if snapshot.context.regions and marker is None:
        return snapshot.overrides.get(well, "Unassigned"), "outside_marker"
    if well in snapshot.overrides:
        return snapshot.overrides[well], "captured_type"
    if well in snapshot.result.assignments:
        return snapshot.result.assignments[well], "stored"
    return "Unknown", "missing"


def snapshot_rows(snapshot: ResultSnapshot) -> list[ResultRow]:
    """No ratio-based inference: unavailable coordinates and calls remain explicit."""
    context = snapshot.context
    points = {p.well: p for p in normalize_for_cycle(
        snapshot.unified, context.cycle, use_rox=context.use_rox, background=context.background,
    )}
    markers = {well: marker for marker in context.regions for well in marker.wells}
    rows = []
    for well in sorted(snapshot.unified.wells, key=lambda w: (w[0], int(w[1:]))):
        marker = markers.get(well)
        genotype, status = _row_call(snapshot, well, marker)
        ploidy = marker.ploidy if marker else (None if context.regions else snapshot.result.ploidy)
        point, read_status = _available_point(points.get(well))
        rows.append(ResultRow(well, snapshot.sample_names.get(well, ""), genotype,
                              (snapshot.result.confidences or {}).get(well), point,
                              marker, ploidy, status, read_status))
    return rows


def _available_point(point: NormalizedPoint | None) -> tuple[NormalizedPoint | None, str]:
    if point is None:
        return None, "missing"
    values = (point.norm_fam, point.norm_allele2, point.raw_fam, point.raw_allele2, point.raw_rox)
    if any(value is not None and not math.isfinite(value) for value in values):
        return None, "unavailable"
    return point, "available"
