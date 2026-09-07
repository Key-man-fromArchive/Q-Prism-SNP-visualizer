from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from app.processing.cycle_selection import CycleMode, resolve_cycle
from pydantic import BaseModel, TypeAdapter, ValidationError

from app.models import (
    UnifiedData,
    ClusteringResult,
    NormalizedPoint,
    RatioOrigin,
    RegionResult,
    AnalysisContext,
)
from app.processing.background import BackgroundMode
from app.processing.genotype_vocab import label_by_ratio
from app.processing.normalize import normalize_for_cycle, normalization_applies
from app.processing.ratio_origin import shift_points_to_origin
from app.routers.upload import sessions
from app.routers.clustering import cluster_store, effective_well_types_for
from app.processing.analysis_state import input_lock, analysis_status
from app.auth import CurrentUser, check_session_access

router = APIRouter()

# All QC thresholds are scale-invariant (a fraction of the plate's own median
# signal), never an absolute magnitude — ROX concentration varies between kits.
# An NTC well is contamination-flagged when its signal reaches this fraction of
# the plate's median total signal:
_NTC_HOT_FRAC = 0.3
# Fallback (no clustering) undetermined cutoff, as a fraction of median signal:
_UNDETERMINED_FRAC = 0.2


class NtcWell(BaseModel):
    well: str
    signal: float | None
    flagged: bool | None
    reason: Literal[
        "none",
        "signal_above_threshold",
        "missing_signal",
        "missing_reference",
        "insufficient_points",
    ]


class NtcCheck(BaseModel):
    ok: bool
    wells: list[NtcWell]
    status: Literal["ok", "warning", "no_ntc", "insufficient"]
    scope: Literal["plate"] = "plate"
    cycle: int
    use_rox: bool
    normalization_applied: bool
    background: str


class QcResult(BaseModel):
    call_rate: float
    n_called: int
    n_total: int
    ntc_check: NtcCheck
    cluster_separation: float | None
    warnings: list[str] = []


class MarkerQc(BaseModel):
    """Per-marker QC (A2): a flat, plate-level cluster_separation mixes
    unrelated markers' dosage classes into one grouping and is meaningless once
    a plate holds multiple independently-genotyped markers -- each marker gets
    its own metrics here, scoped to its own wells/assignments/ploidy."""

    id: str
    name: str
    ploidy: int
    n_total: int
    n_called: int
    call_rate: float
    cluster_separation: float | None
    # Phase 1 diagnostics carried through from RegionResult (e.g. "low_n",
    # "relative_ntc") so a status-badge UI can read them without re-clustering.
    # None (not []) when the marker's run was clean.
    warnings: list[str] | None = None


def _get_session(sid: str) -> UnifiedData:
    if sid not in sessions:
        raise HTTPException(404, "Session not found")
    return sessions[sid]


def _determine_genotype(
    well: str,
    norm_fam: float,
    norm_allele2: float,
    cluster_assignments: dict[str, str],
    manual_assignments: dict[str, str],
    undetermined_min: float = 0.0,
    ploidy: int = 2,
) -> str:
    """Determine effective genotype for a well.

    Priority: manual_type > auto_cluster > ratio-based fallback. The fallback is
    ploidy-aware (dosage by fam-fraction via the central vocabulary) and only
    reached when a well has neither a manual nor an auto call. ``undetermined_min``
    is a scale-relative low-signal cutoff supplied by the caller.
    """
    if well in manual_assignments:
        return manual_assignments[well]

    if well in cluster_assignments:
        return cluster_assignments[well]

    total = norm_fam + norm_allele2
    if total <= undetermined_min:
        return "Undetermined"
    return label_by_ratio(norm_fam / total, ploidy)


def _cluster_separation_for(assignments: dict[str, str], points: list) -> float | None:
    """Cluster separation metric for an arbitrary well->label assignment map,
    scoped to whichever ``points`` are passed in (the whole plate, or a single
    marker's own wells). For each pair of cluster centroids, compute Euclidean
    distance. Return min inter-cluster distance / max within-cluster spread.
    Returns None if fewer than 2 clusters.
    """
    # Build per-cluster point lists
    clusters: dict[str, list[tuple[float, float]]] = {}
    for p in points:
        label = assignments.get(p.well)
        if label is None:
            continue
        if label not in clusters:
            clusters[label] = []
        clusters[label].append((p.norm_fam, p.norm_allele2))

    if len(clusters) < 2:
        return None

    # Compute centroids
    centroids: dict[str, tuple[float, float]] = {}
    for label, pts in clusters.items():
        cx = sum(x for x, _ in pts) / len(pts)
        cy = sum(y for _, y in pts) / len(pts)
        centroids[label] = (cx, cy)

    # Min inter-cluster distance (between all centroid pairs)
    labels = list(centroids.keys())
    min_inter = float("inf")
    for i in range(len(labels)):
        for j in range(i + 1, len(labels)):
            c1 = centroids[labels[i]]
            c2 = centroids[labels[j]]
            dist = math.sqrt((c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2)
            if dist < min_inter:
                min_inter = dist

    # Max within-cluster spread (max distance from any point to its centroid)
    max_spread = 0.0
    for label, pts in clusters.items():
        cx, cy = centroids[label]
        for x, y in pts:
            dist = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            if dist > max_spread:
                max_spread = dist

    if max_spread == 0:
        return round(min_inter, 6) if min_inter != float("inf") else None

    separation = min_inter / max_spread
    return round(separation, 6)


def _compute_cluster_separation(sid: str, points: list) -> float | None:
    """Compute cluster separation metric.

    Returns None if no clustering or fewer than 2 clusters.
    """
    if sid not in cluster_store:
        return None
    return _cluster_separation_for(cluster_store[sid].assignments, points)


def _marker_qc(
    region: RegionResult,
    points: list[NormalizedPoint],
    manual_assignments: dict[str, str],
    undetermined_min: float,
    excluded: frozenset[str] = frozenset(),
) -> "MarkerQc":
    """Per-marker QC (A2): call rate + cluster separation scoped to a single
    region's own wells/assignments/ploidy, instead of the flat plate-level
    pool (which would mix unrelated markers' dosage classes together)."""
    region_wells = set(region.wells)
    region_points = [p for p in points if p.well in region_wells]

    n_total = len(region_points)
    n_called = 0
    effective_assignments: dict[str, str] = {}
    for p in region_points:
        genotype = _determine_genotype(
            p.well,
            p.norm_fam,
            p.norm_allele2,
            region.assignments,
            manual_assignments,
            undetermined_min,
            region.ploidy,
        )
        effective_assignments[p.well] = genotype
        if genotype not in ("Undetermined", "NTC"):
            n_called += 1

    call_rate = n_called / n_total if n_total > 0 else 0.0
    separation = _cluster_separation_for(
        effective_assignments, [p for p in region_points if p.well not in excluded]
    )

    return MarkerQc(
        id=region.id,
        name=region.name,
        ploidy=region.ploidy,
        n_total=n_total,
        n_called=n_called,
        call_rate=round(call_rate, 4),
        cluster_separation=separation,
        warnings=region.warnings,
    )


@dataclass(frozen=True)
class QcSnapshot:
    unified: UnifiedData
    result: ClusteringResult | None
    types: dict[str, str]
    status: dict[str, object]


def _capture_qc(sid: str) -> QcSnapshot:
    with input_lock:
        unified = _get_session(sid)
        result = cluster_store.get(sid)
        return QcSnapshot(
            unified.model_copy(deep=True),
            result.model_copy(deep=True) if result else None,
            effective_well_types_for(sid, unified),
            analysis_status(sid),
        )


def _median_signal(points: list[NormalizedPoint]) -> float:
    signals = sorted(
        p.norm_fam + p.norm_allele2
        for p in points
        if math.isfinite(p.norm_fam + p.norm_allele2)
    )
    return signals[len(signals) // 2] if signals else 0.0


def _ntc_well(well: str, point: NormalizedPoint | None, median: float) -> NtcWell:
    if point is None:
        return NtcWell(well=well, signal=None, flagged=None, reason="missing_signal")
    signal = point.norm_fam + point.norm_allele2
    if not math.isfinite(signal):
        return NtcWell(well=well, signal=None, flagged=None, reason="missing_signal")
    if median <= 0:
        return NtcWell(
            well=well, signal=round(signal, 6), flagged=None, reason="missing_reference"
        )
    flagged = signal >= _NTC_HOT_FRAC * median
    return NtcWell(
        well=well,
        signal=round(signal, 6),
        flagged=flagged,
        reason="signal_above_threshold" if flagged else "none",
    )


def _ntc_status(
    wells: list[NtcWell],
) -> Literal["ok", "warning", "no_ntc", "insufficient"]:
    if any(w.flagged is True for w in wells):
        return "warning"
    if any(w.flagged is None for w in wells):
        return "insufficient"
    return "ok" if wells else "no_ntc"


def _normalization_used(unified: UnifiedData, cycle: int, use_rox: bool) -> bool:
    if not normalization_applies(unified, use_rox=use_rox):
        return False
    return any(
        (d.normalization_value if d.normalization_value is not None else d.rox or 0) > 0
        for d in unified.data
        if d.cycle == cycle
    )


def _plate_check(
    snapshot: QcSnapshot,
    points: list[NormalizedPoint],
    cycle: int,
    use_rox: bool,
    background: str,
) -> NtcCheck:
    by_well = {p.well: p for p in points}
    median = _median_signal(points)
    wells = [
        _ntc_well(w, by_well.get(w), median)
        for w, kind in sorted(snapshot.types.items())
        if kind == "NTC"
    ]
    status = _ntc_status(wells)
    return NtcCheck(
        ok=status != "warning",
        wells=wells,
        status=status,
        cycle=cycle,
        use_rox=use_rox,
        background=background,
        normalization_applied=_normalization_used(snapshot.unified, cycle, use_rox),
    )


def _control_warnings(
    points: list[NormalizedPoint], types: dict[str, str], check: NtcCheck
) -> list[str]:
    median = _median_signal(points)
    warnings = [
        f"NTC {w.well} shows genotype-level signal "
        f"({round((w.signal or 0) / median * 100)}% of median) — possible contamination."
        for w in check.wells
        if w.flagged is True
    ]
    warnings.extend(
        f"Positive control {p.well} shows no amplification — check the run."
        for p in points
        if types.get(p.well) == "Positive Control"
        and p.norm_fam + p.norm_allele2 <= _UNDETERMINED_FRAC * median
    )
    return warnings


def _judgment_metadata(snapshot: QcSnapshot) -> dict[str, object]:
    result = snapshot.result
    context = result.analysis_context if result else None
    if result is None:
        status, reason = "missing", "no_completed_result"
    elif context is None or _judgment_inputs(context) is None:
        status, reason = "legacy_unknown", "context_missing"
    elif context.input_revision != snapshot.unified.input_revision:
        status, reason = "stale", "input_changed"
    else:
        status, reason = "verified", "none"
    return {
        "judgment_status": status,
        "judgment_reason": reason,
        "input_revision": context.input_revision if context else None,
        "current_input_revision": snapshot.unified.input_revision,
        "context_status": "verified" if context else "legacy_unknown",
        "result_revision": str(context.result_revision) if context else None,
        "analysis_context": context.model_dump() if context else None,
        **snapshot.status,
    }


def _assignment_counts(
    assignments: dict[str, str], wells: list[str]
) -> dict[str, object]:
    called = sum(
        assignments.get(w, "Undetermined") not in ("Undetermined", "NTC") for w in wells
    )
    total = len(wells)
    return {
        "n_called": called,
        "n_total": total,
        "call_rate": round(called / total, 4) if total else 0.0,
        "cluster_separation": None,
    }


def _unknown_judgment(snapshot: QcSnapshot) -> dict[str, object]:
    result = snapshot.result
    metrics = _assignment_counts(
        result.assignments if result else {}, snapshot.unified.wells
    )
    if result and result.regions:
        metrics["authoritative"] = "markers"
        metrics["markers"] = [
            {
                "id": r.id,
                "name": r.name,
                "ploidy": r.ploidy,
                "warnings": r.warnings,
                **_assignment_counts(r.assignments, r.wells),
            }
            for r in result.regions
        ]
    return metrics


@dataclass(frozen=True)
class JudgmentInputs:
    origin: RatioOrigin
    types: dict[str, str]
    excluded: frozenset[str]


def _captured_origin(value: object) -> RatioOrigin | None:
    if not isinstance(value, dict) or not {"fam", "allele2", "source"}.issubset(value):
        return None
    try:
        origin = RatioOrigin.model_validate(value, strict=True)
    except ValidationError:
        return None
    return (
        origin if math.isfinite(origin.fam) and math.isfinite(origin.allele2) else None
    )


def _judgment_inputs(context: AnalysisContext) -> JudgmentInputs | None:
    origin = _captured_origin(context.parameters.get("ratio_origin"))
    if origin is None:
        return None
    try:
        types = TypeAdapter(dict[str, str]).validate_python(
            context.parameters["effective_well_types"], strict=True
        )
        manual_types = TypeAdapter(dict[str, str]).validate_python(
            context.parameters["manual_well_types"], strict=True
        )
        excluded = TypeAdapter(list[str]).validate_python(
            context.parameters["excluded_wells"], strict=True
        )
    except (KeyError, ValidationError):
        return None
    # Imported Unknown is an ordinary sample, not an operator override.
    overrides = {well: kind for well, kind in types.items() if kind != "Unknown"}
    overrides.update(manual_types)
    return JudgmentInputs(origin, overrides, frozenset(excluded))


def _verified_judgment(
    snapshot: QcSnapshot, result: ClusteringResult
) -> dict[str, object]:
    context = result.analysis_context
    if context is None:
        return _unknown_judgment(snapshot)
    inputs = _judgment_inputs(context)
    if inputs is None:
        return _unknown_judgment(snapshot)
    points = normalize_for_cycle(
        snapshot.unified,
        context.cycle,
        use_rox=context.use_rox,
        background=context.background,
    )
    called = shift_points_to_origin(points, inputs.origin)
    types = inputs.types
    cutoff = _UNDETERMINED_FRAC * _median_signal(called)
    effective = {
        p.well: _determine_genotype(
            p.well,
            p.norm_fam,
            p.norm_allele2,
            result.assignments,
            types,
            cutoff,
            result.ploidy,
        )
        for p in called
    }
    metrics = _assignment_counts(effective, [p.well for p in points])
    excluded = inputs.excluded
    eligible = [p for p in points if p.well not in excluded]
    if result.regions:
        metrics["authoritative"] = "markers"
        metrics["markers"] = [
            _marker_qc(r, called, types, cutoff, excluded).model_dump()
            for r in result.regions
        ]
    else:
        metrics["cluster_separation"] = _cluster_separation_for(
            result.assignments, eligible
        )
    return metrics


@router.get("/api/data/{sid}/qc")
async def qc_metrics(
    sid: str,
    current_user: CurrentUser,
    cycle: int = Query(default=0),
    cycle_mode: CycleMode = Query(default="legacy_latest"),
    use_rox: bool = Query(default=True),
    background: BackgroundMode = Query(default="none"),
) -> dict[str, object]:
    """Current plate controls and separately labeled historical judgment QC."""
    check_session_access(sid, current_user)
    snapshot = _capture_qc(sid)
    unified = snapshot.unified
    cycle = resolve_cycle(unified.cycles, cycle, cycle_mode)
    if cycle not in unified.cycles:
        raise HTTPException(400, f"Cycle {cycle} not available")
    points = normalize_for_cycle(unified, cycle, use_rox=use_rox, background=background)
    ntc = _plate_check(snapshot, points, cycle, use_rox, background)
    metrics = (
        _verified_judgment(snapshot, snapshot.result)
        if snapshot.result
        else _unknown_judgment(snapshot)
    )
    return {
        **metrics,
        "ntc_check": ntc.model_dump(),
        "warnings": _control_warnings(points, snapshot.types, ntc),
        **_judgment_metadata(snapshot),
    }
