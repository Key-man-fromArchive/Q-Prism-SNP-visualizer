"""NTC-based suggested cycle detection.

Auto-detect NTC wells via signal delta gap analysis, then use 2nd derivative
of the amplification curve to find when non-specific amplification begins.
The suggested display cycle is set just before NTC amplification starts.
"""
from __future__ import annotations

import math

from app.models import UnifiedData, DataWindow
from app.processing.normalize import normalize_for_cycle


def compute_suggested_cycle(unified: UnifiedData) -> int | None:
    """Lightweight suggestion for the initial display cycle (used at upload).

    Returns the cycle just before NTC amplification onset, or the last
    amplification cycle when there is no contamination. This is cheap (no
    clustering) so it stays fast on the upload path.
    """
    info = _analyze_amplification(unified)
    if info is None:
        return None
    if info["ntc_onset_cycle"] is not None:
        return max(info["amp_start"], min(info["ntc_onset_cycle"] - 1, info["amp_end"]))
    return info["amp_end"]


def compute_cycle_suggestion(unified: UnifiedData) -> dict:
    """Suggest the best analysis cycle, with the reasoning behind it.

    The cycle where NTC background starts rising is used as an upper boundary
    (reading past it lets contamination creep in). Within that boundary — and
    skipping early baseline cycles — the recommended cycle is the one where the
    genotype clusters are most cleanly separated (max silhouette). This is the
    heavy path used by the Analyze button.

    Returns a dict with:
        suggested_cycle: int | None  — recommended cycle (absolute)
        ntc_onset_cycle: int | None  — cycle where NTC begins amplifying
        ntc_wells: list[str]         — auto-detected NTC wells
        amp_start / amp_end: int | None — amplification window bounds
    """
    result: dict = {
        "suggested_cycle": None,
        "ntc_onset_cycle": None,
        "ntc_wells": [],
        "amp_start": None,
        "amp_end": None,
    }

    info = _analyze_amplification(unified)
    if info is None:
        return result

    result["amp_start"] = info["amp_start"]
    result["amp_end"] = info["amp_end"]
    result["ntc_wells"] = info["ntc_wells"]
    result["ntc_onset_cycle"] = info["ntc_onset_cycle"]

    # Upper boundary: don't read past where NTC background starts rising.
    if info["ntc_onset_cycle"] is not None:
        cap = max(info["amp_start"], info["ntc_onset_cycle"] - 1)
    else:
        cap = info["amp_end"]

    # Lower boundary: skip early baseline cycles (amplification not yet meaningful).
    wlen = info["amp_end"] - info["amp_start"] + 1
    floor = info["amp_start"] + math.ceil(0.4 * wlen)
    if floor > cap:
        floor = info["amp_start"]

    best = _best_separation_cycle(unified, floor, cap, set(info["ntc_wells"]))
    result["suggested_cycle"] = best if best is not None else cap
    return result


def _analyze_amplification(unified: UnifiedData) -> dict | None:
    """Shared analysis: amplification window, NTC wells, and NTC onset cycle."""
    amp_window = _get_amplification_window(unified.data_windows)
    if not amp_window:
        return None

    info: dict = {
        "amp_start": amp_window.start_cycle,
        "amp_end": amp_window.end_cycle,
        "ntc_wells": [],
        "ntc_onset_cycle": None,
    }

    amp_cycles = list(range(amp_window.start_cycle, amp_window.end_cycle + 1))
    if len(amp_cycles) < 5:
        return info

    # Per-well signal curves (raw FAM + allele2, no normalization)
    well_curves = _build_well_curves(unified, amp_cycles)
    if len(well_curves) < 3:
        return info

    ntc_wells = _detect_ntc_wells(well_curves, amp_cycles)
    info["ntc_wells"] = ntc_wells
    if not ntc_wells:
        return info

    earliest_ct = None
    for well in ntc_wells:
        ct = _second_derivative_ct(well_curves[well], amp_cycles)
        if ct is not None and (earliest_ct is None or ct < earliest_ct):
            earliest_ct = ct
    info["ntc_onset_cycle"] = earliest_ct
    return info


def _best_separation_cycle(
    unified: UnifiedData, floor: int, cap: int, ntc_set: set[str]
) -> int | None:
    """Cycle in [floor, cap] with the cleanest genotype cluster separation.

    Scores each cycle by the silhouette of a KMeans clustering on the
    ROX-normalized (fam, allele2) points, excluding NTC wells. Returns the
    highest-scoring cycle, or None if no cycle can be scored.
    """
    if cap < floor:
        return None
    try:
        import numpy as np
        from sklearn.cluster import KMeans
        from sklearn.metrics import silhouette_score
    except Exception:
        return None

    best_cycle: int | None = None
    best_score: float | None = None
    for c in range(floor, cap + 1):
        pts = [
            p
            for p in normalize_for_cycle(unified, c, use_rox=unified.has_rox)
            if p.well not in ntc_set
        ]
        if len(pts) < 6:
            continue
        coords = np.array([[p.norm_fam, p.norm_allele2] for p in pts])
        n_unique = len(np.unique(coords, axis=0))
        if n_unique < 2:
            continue
        k = 3 if n_unique >= 3 else 2
        try:
            labels = KMeans(n_clusters=k, n_init=3, random_state=42).fit_predict(coords)
            if len(set(labels)) < 2:
                continue
            score = silhouette_score(coords, labels)
        except Exception:
            continue
        if best_score is None or score > best_score:
            best_score, best_cycle = score, c

    return best_cycle


def _get_amplification_window(windows: list[DataWindow] | None) -> DataWindow | None:
    """Find the Amplification data window."""
    if not windows:
        return None
    for w in windows:
        if w.name == "Amplification":
            return w
    # Fallback: largest window
    return max(windows, key=lambda w: w.end_cycle - w.start_cycle)


def _build_well_curves(
    unified: UnifiedData, amp_cycles: list[int]
) -> dict[str, list[float]]:
    """Build per-well total signal curves for the amplification window.

    Uses raw FAM + allele2 (no ROX normalization) to avoid artifacts.
    """
    cycle_set = set(amp_cycles)
    well_data: dict[str, dict[int, float]] = {}

    for d in unified.data:
        if d.cycle not in cycle_set:
            continue
        if d.well not in well_data:
            well_data[d.well] = {}
        well_data[d.well][d.cycle] = d.fam + d.allele2

    # Convert to ordered lists, only wells with complete data
    result = {}
    for well, cycle_map in well_data.items():
        if len(cycle_map) == len(amp_cycles):
            result[well] = [cycle_map[c] for c in amp_cycles]

    return result


def _detect_ntc_wells(
    well_curves: dict[str, list[float]], amp_cycles: list[int]
) -> list[str]:
    """Detect NTC wells using signal delta gap analysis.

    For each well, compute delta = last_signal - first_signal.
    Sort deltas ascending. If there's a >3x jump between consecutive values,
    wells below the gap are NTC candidates.
    Limit to at most 4 NTC wells.
    """
    deltas = {}
    for well, curve in well_curves.items():
        deltas[well] = curve[-1] - curve[0]

    sorted_wells = sorted(deltas.keys(), key=lambda w: deltas[w])
    sorted_deltas = [deltas[w] for w in sorted_wells]

    # Need at least some wells with positive delta to have a reference
    max_delta = max(sorted_deltas)
    if max_delta <= 0:
        return []

    # Find gap: look for >3x jump in absolute delta values
    # Only consider wells in the bottom portion as NTC candidates
    gap_idx = None
    for i in range(len(sorted_deltas) - 1):
        curr = abs(sorted_deltas[i])
        next_val = abs(sorted_deltas[i + 1])
        # Gap detection: next value is >3x current AND current is small relative to max
        if next_val > 3 * max(curr, 1) and curr < max_delta * 0.15:
            gap_idx = i
            break

    if gap_idx is None:
        # No clear gap — try percentage-based fallback
        # Wells with delta < 5% of median are NTC candidates
        abs_deltas = sorted(abs(d) for d in sorted_deltas)
        median_delta = abs_deltas[len(abs_deltas) // 2]
        if median_delta <= 0:
            return []
        ntc_candidates = [w for w in sorted_wells if abs(deltas[w]) < median_delta * 0.05]
        return ntc_candidates[:4]

    ntc_candidates = sorted_wells[: gap_idx + 1]
    return ntc_candidates[:4]


def _second_derivative_ct(
    curve: list[float], cycles: list[int],
    baseline_cycles: int = 5, n_sigma: float = 5.0,
    min_consecutive_up: int = 3,
) -> int | None:
    """Detect NTC amplification onset using 2nd derivative threshold.

    Instead of finding max d2 (which lands at the end for exponential curves),
    find the first cycle where d2 exceeds baseline_d2 + n_sigma * std(d2).
    Then validate with consecutive increasing signal cycles.

    Returns:
        Absolute cycle number of the onset, or None if no real amplification.
    """
    n = len(curve)
    if n < 5:
        return None

    # Compute 2nd derivative: d2[j] = curve[j+1] - 2*curve[j] + curve[j-1]
    # d2[j] corresponds to curve index j+1, cycle cycles[j+1]
    d2 = []
    for j in range(1, n - 1):
        d2.append(curve[j + 1] - 2 * curve[j] + curve[j - 1])

    if len(d2) < baseline_cycles + 2:
        return None

    # Baseline d2 statistics (first few points)
    bl_n = min(baseline_cycles, len(d2) // 2)
    bl = d2[:bl_n]
    mean_d2 = sum(bl) / len(bl)
    var_d2 = sum((v - mean_d2) ** 2 for v in bl) / len(bl)
    std_d2 = var_d2 ** 0.5

    threshold_d2 = mean_d2 + n_sigma * max(std_d2, 1e-6)

    # Find first d2 exceeding threshold (skip first 2 for noise)
    onset_d2_idx = None
    for i in range(2, len(d2)):
        if d2[i] > threshold_d2:
            onset_d2_idx = i
            break

    if onset_d2_idx is None:
        return None

    # Map back to curve index: d2[j] → curve[j+1]
    onset_curve_idx = onset_d2_idx + 1

    # Validate: consecutive increasing signal cycles from the onset
    consecutive_up = 0
    for i in range(onset_curve_idx, n - 1):
        if curve[i + 1] > curve[i]:
            consecutive_up += 1
        else:
            break

    if consecutive_up < min_consecutive_up:
        return None

    return cycles[onset_curve_idx]
