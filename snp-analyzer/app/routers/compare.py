"""Multi-run comparison router.

Provides endpoints to compare scatter data and statistics across two
uploaded sessions side-by-side.
"""

from __future__ import annotations

import math

from fastapi import APIRouter, HTTPException, Query

from app.models import ScatterPoint, UnifiedData
from app.processing.normalize import normalize_for_cycle
from app.routers.clustering import cluster_store, welltype_store
from app.routers.upload import sessions

router = APIRouter()


def _get_session(sid: str) -> UnifiedData:
    if sid not in sessions:
        raise HTTPException(404, f"Session not found: {sid}")
    return sessions[sid]


def _resolve_cycle(unified: UnifiedData, cycle: int) -> int:
    """Resolve cycle=0 to max cycle; validate otherwise."""
    if cycle <= 0:
        return max(unified.cycles)
    if cycle not in unified.cycles:
        raise HTTPException(
            400,
            f"Cycle {cycle} not available. "
            f"Range: {unified.cycles[0]}-{unified.cycles[-1]}",
        )
    return cycle


def _build_scatter_points(
    unified: UnifiedData,
    sid: str,
    cycle: int,
    use_rox: bool,
) -> list[dict]:
    """Normalize and annotate scatter points for one session."""
    points = normalize_for_cycle(unified.data, cycle, unified.has_rox, use_rox)

    cluster_assignments = {}
    if sid in cluster_store:
        cluster_assignments = cluster_store[sid].assignments
    manual_assignments = welltype_store.get(sid, {})

    return [
        ScatterPoint(
            well=p.well,
            norm_fam=p.norm_fam,
            norm_allele2=p.norm_allele2,
            raw_fam=p.raw_fam,
            raw_allele2=p.raw_allele2,
            raw_rox=p.raw_rox,
            sample_name=(unified.sample_names or {}).get(p.well),
            auto_cluster=cluster_assignments.get(p.well),
            manual_type=manual_assignments.get(p.well),
        ).model_dump()
        for p in points
    ]


def _pearson_r(xs: list[float], ys: list[float]) -> float | None:
    """Compute Pearson correlation coefficient without numpy.

    Returns None if fewer than 2 matched pairs or zero variance.
    """
    n = len(xs)
    if n < 2:
        return None

    mean_x = sum(xs) / n
    mean_y = sum(ys) / n

    num = 0.0
    den_x = 0.0
    den_y = 0.0
    for x, y in zip(xs, ys):
        dx = x - mean_x
        dy = y - mean_y
        num += dx * dy
        den_x += dx * dx
        den_y += dy * dy

    denom = math.sqrt(den_x * den_y)
    if denom == 0.0:
        return None
    r = num / denom
    return round(r, 6)


@router.get("/api/compare/scatter")
async def compare_scatter(
    sid1: str = Query(..., description="Session ID for run 1"),
    sid2: str = Query(..., description="Session ID for run 2"),
    cycle1: int = Query(default=0, description="Cycle for run 1 (0 = max)"),
    cycle2: int = Query(default=0, description="Cycle for run 2 (0 = max)"),
    use_rox: bool = Query(default=True, description="Apply ROX normalization"),
):
    """Return normalized scatter data for two sessions for side-by-side comparison."""
    unified1 = _get_session(sid1)
    unified2 = _get_session(sid2)

    c1 = _resolve_cycle(unified1, cycle1)
    c2 = _resolve_cycle(unified2, cycle2)

    points1 = _build_scatter_points(unified1, sid1, c1, use_rox)
    points2 = _build_scatter_points(unified2, sid2, c2, use_rox)

    return {
        "run1": {
            "session_id": sid1,
            "instrument": unified1.instrument,
            "allele2_dye": unified1.allele2_dye,
            "cycle": c1,
            "num_wells": len(unified1.wells),
            "points": points1,
        },
        "run2": {
            "session_id": sid2,
            "instrument": unified2.instrument,
            "allele2_dye": unified2.allele2_dye,
            "cycle": c2,
            "num_wells": len(unified2.wells),
            "points": points2,
        },
    }


@router.get("/api/compare/stats")
async def compare_stats(
    sid1: str = Query(..., description="Session ID for run 1"),
    sid2: str = Query(..., description="Session ID for run 2"),
    cycle1: int = Query(default=0, description="Cycle for run 1 (0 = max)"),
    cycle2: int = Query(default=0, description="Cycle for run 2 (0 = max)"),
    use_rox: bool = Query(default=True, description="Apply ROX normalization"),
):
    """Return summary statistics and cross-run Pearson correlation."""
    unified1 = _get_session(sid1)
    unified2 = _get_session(sid2)

    c1 = _resolve_cycle(unified1, cycle1)
    c2 = _resolve_cycle(unified2, cycle2)

    pts1 = normalize_for_cycle(unified1.data, c1, unified1.has_rox, use_rox)
    pts2 = normalize_for_cycle(unified2.data, c2, unified2.has_rox, use_rox)

    def _stats(pts, sid, instrument, cycle):
        n = len(pts)
        if n == 0:
            return {
                "session_id": sid,
                "instrument": instrument,
                "cycle": cycle,
                "mean_fam": 0.0,
                "mean_allele2": 0.0,
                "std_fam": 0.0,
                "std_allele2": 0.0,
                "n_wells": 0,
            }

        fam_vals = [p.norm_fam for p in pts]
        a2_vals = [p.norm_allele2 for p in pts]

        mean_fam = sum(fam_vals) / n
        mean_a2 = sum(a2_vals) / n

        # Population std (all wells in a run)
        var_fam = sum((v - mean_fam) ** 2 for v in fam_vals) / n
        var_a2 = sum((v - mean_a2) ** 2 for v in a2_vals) / n

        return {
            "session_id": sid,
            "instrument": instrument,
            "cycle": cycle,
            "mean_fam": round(mean_fam, 6),
            "mean_allele2": round(mean_a2, 6),
            "std_fam": round(math.sqrt(var_fam), 6),
            "std_allele2": round(math.sqrt(var_a2), 6),
            "n_wells": n,
        }

    run1_stats = _stats(pts1, sid1, unified1.instrument, c1)
    run2_stats = _stats(pts2, sid2, unified2.instrument, c2)

    # Pearson R on matched wells (same well ID in both runs)
    well_map1 = {p.well: p for p in pts1}
    well_map2 = {p.well: p for p in pts2}
    common_wells = sorted(set(well_map1.keys()) & set(well_map2.keys()))

    fam_xs = [well_map1[w].norm_fam for w in common_wells]
    fam_ys = [well_map2[w].norm_fam for w in common_wells]
    a2_xs = [well_map1[w].norm_allele2 for w in common_wells]
    a2_ys = [well_map2[w].norm_allele2 for w in common_wells]

    return {
        "run1": run1_stats,
        "run2": run2_stats,
        "correlation": {
            "fam_r": _pearson_r(fam_xs, fam_ys),
            "allele2_r": _pearson_r(a2_xs, a2_ys),
            "n_matched_wells": len(common_wells),
        },
    }
