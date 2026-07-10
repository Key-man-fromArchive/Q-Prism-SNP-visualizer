from __future__ import annotations

import math

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.models import UnifiedData
from app.processing.genotype_vocab import label_by_ratio
from app.processing.normalize import normalize_for_cycle
from app.routers.upload import sessions
from app.routers.clustering import cluster_store, welltype_store
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
    signal: float


class NtcCheck(BaseModel):
    ok: bool
    wells: list[NtcWell]


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
    region,
    points: list,
    manual_assignments: dict[str, str],
    undetermined_min: float,
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
        manual = manual_assignments.get(p.well)
        auto = region.assignments.get(p.well)
        if manual is not None:
            genotype = manual
        elif auto is not None:
            genotype = auto
        else:
            total = p.norm_fam + p.norm_allele2
            genotype = (
                "Undetermined"
                if total <= undetermined_min
                else label_by_ratio(p.norm_fam / total, region.ploidy)
            )
        effective_assignments[p.well] = genotype
        if genotype not in ("Undetermined", "NTC"):
            n_called += 1

    call_rate = n_called / n_total if n_total > 0 else 0.0
    separation = _cluster_separation_for(effective_assignments, region_points)

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


@router.get("/api/data/{sid}/qc")
async def qc_metrics(
    sid: str,
    current_user: CurrentUser,
    cycle: int = Query(default=0),
    use_rox: bool = Query(default=True),
):
    """Compute quality-control metrics for the current dataset."""
    check_session_access(sid, current_user)
    unified = _get_session(sid)

    if cycle <= 0:
        cycle = max(unified.cycles)

    if cycle not in unified.cycles:
        raise HTTPException(
            400,
            f"Cycle {cycle} not available. Range: {unified.cycles[0]}-{unified.cycles[-1]}",
        )

    points = normalize_for_cycle(unified, cycle, use_rox=use_rox)

    cluster_assignments: dict[str, str] = {}
    if sid in cluster_store:
        cluster_assignments = cluster_store[sid].assignments
    manual_assignments = welltype_store.get(sid, {})

    # Scale reference: the plate's own median total signal. Every threshold below
    # is a fraction of this, so a low-ROX kit (large magnitudes) works unchanged.
    signals = sorted(p.norm_fam + p.norm_allele2 for p in points)
    median_signal = signals[len(signals) // 2] if signals else 0.0
    undetermined_min = _UNDETERMINED_FRAC * median_signal
    ntc_hot = _NTC_HOT_FRAC * median_signal

    # --- Call rate ---
    n_total = len(points)
    n_called = 0
    ploidy = getattr(unified, "ploidy", 2)
    for p in points:
        genotype = _determine_genotype(
            p.well, p.norm_fam, p.norm_allele2,
            cluster_assignments, manual_assignments, undetermined_min, ploidy,
        )
        if genotype not in ("Undetermined", "NTC"):
            n_called += 1

    call_rate = n_called / n_total if n_total > 0 else 0.0

    # --- NTC check + control QC warnings ---
    ntc_flagged: list[NtcWell] = []
    ntc_ok = True
    warnings: list[str] = []

    for p in points:
        effective_type = manual_assignments.get(p.well) or cluster_assignments.get(p.well)
        signal = p.norm_fam + p.norm_allele2
        if effective_type == "NTC":
            ntc_flagged.append(NtcWell(well=p.well, signal=round(signal, 6)))
            # Contamination / NTC-overlap: an NTC well as bright as real samples.
            if median_signal > 0 and signal >= ntc_hot:
                ntc_ok = False
                warnings.append(
                    f"NTC {p.well} shows genotype-level signal "
                    f"({round(signal / median_signal * 100)}% of median) — possible contamination."
                )
        elif effective_type == "Positive Control":
            # A positive control should amplify; near-NTC signal means it failed.
            if signal <= undetermined_min:
                warnings.append(
                    f"Positive control {p.well} shows no amplification — check the run."
                )

    ntc_check = NtcCheck(ok=ntc_ok, wells=ntc_flagged)

    # --- Cluster separation ---
    cluster_separation = _compute_cluster_separation(sid, points)

    result = QcResult(
        call_rate=round(call_rate, 4),
        n_called=n_called,
        n_total=n_total,
        ntc_check=ntc_check,
        cluster_separation=cluster_separation,
        warnings=warnings,
    ).model_dump()

    # A2: multi-marker plate -- the plate-level cluster_separation above pools
    # every marker's wells into one grouping, which is meaningless once
    # unrelated markers (different ploidy/dosage vocabularies) share the plate.
    # Add a per-marker breakdown; single-marker (regions is None) sessions
    # never get this key, so their JSON is unchanged.
    ca = cluster_store.get(sid)
    if ca is not None and ca.regions:
        # The plate-level cluster_separation above is NOT authoritative once
        # multiple independently-genotyped markers share this plate -- tell
        # the client so it can prefer the per-marker breakdown for display.
        result["authoritative"] = "markers"
        result["markers"] = [
            _marker_qc(r, points, manual_assignments, undetermined_min).model_dump()
            for r in ca.regions
        ]

    return result
