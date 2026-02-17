"""NTC-based suggested cycle detection.

Auto-detect NTC wells via signal delta gap analysis, then use 2nd derivative
of the amplification curve to find when non-specific amplification begins.
The suggested display cycle is set just before NTC amplification starts.
"""
from __future__ import annotations

from app.models import UnifiedData, DataWindow


def compute_suggested_cycle(unified: UnifiedData) -> int | None:
    """Compute suggested display cycle based on NTC amplification onset.

    Algorithm:
    1. Find the amplification window
    2. Auto-detect NTC wells using signal delta gap analysis
    3. For each NTC well, compute 2nd derivative Ct
    4. If any NTC shows real amplification, return earliest Ct - 1
    5. Otherwise return last amplification cycle (no contamination)

    Returns:
        Suggested cycle number (absolute), or None if no amplification window
    """
    amp_window = _get_amplification_window(unified.data_windows)
    if not amp_window:
        return None

    amp_cycles = list(range(amp_window.start_cycle, amp_window.end_cycle + 1))
    if len(amp_cycles) < 5:
        return amp_window.end_cycle

    # Build per-well signal curves (raw FAM + allele2, no normalization)
    well_curves = _build_well_curves(unified, amp_cycles)
    if len(well_curves) < 3:
        return amp_window.end_cycle

    # Detect NTC wells via gap analysis
    ntc_wells = _detect_ntc_wells(well_curves, amp_cycles)
    if not ntc_wells:
        return amp_window.end_cycle

    # Compute 2nd derivative Ct for each NTC well
    earliest_ct = None
    for well in ntc_wells:
        curve = well_curves[well]
        ct = _second_derivative_ct(curve, amp_cycles)
        if ct is not None and (earliest_ct is None or ct < earliest_ct):
            earliest_ct = ct

    if earliest_ct is None:
        return amp_window.end_cycle

    # Suggested cycle = one before NTC amplification starts
    suggested = earliest_ct - 1
    return max(amp_window.start_cycle, min(suggested, amp_window.end_cycle))


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
