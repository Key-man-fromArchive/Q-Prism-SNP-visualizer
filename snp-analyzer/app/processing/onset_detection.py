"""Detect amplification onset cycle for smart initial cycle display."""
from __future__ import annotations

import math
from app.models import WellCycleData, DataWindow


def compute_suggested_cycle(
    data: list[WellCycleData],
    data_windows: list[DataWindow] | None = None,
    baseline_cycles: int = 5,
    threshold_factor: float = 3.0,
) -> int | None:
    """Find the cycle just before amplification starts rising.

    For each well, analyzes the FAM channel to detect the first cycle
    where signal exceeds baseline_mean + threshold_factor * baseline_std.
    Returns the cycle just before the earliest onset across all wells.

    Returns None if fewer than 3 amplification cycles or no onset detected.
    """
    # Determine amplification cycle range
    amp_start = None
    amp_end = None
    if data_windows:
        for w in data_windows:
            if w.name == "Amplification":
                amp_start = w.start_cycle
                amp_end = w.end_cycle
                break

    # Group FAM values by well, filtered to amplification window
    well_curves: dict[str, list[tuple[int, float]]] = {}
    for d in data:
        if amp_start is not None and (d.cycle < amp_start or d.cycle > amp_end):
            continue
        well_curves.setdefault(d.well, []).append((d.cycle, d.fam))

    if not well_curves:
        return None

    onset_cycles: list[int] = []

    for well, curve in well_curves.items():
        curve.sort(key=lambda x: x[0])
        if len(curve) < baseline_cycles + 1:
            continue

        # Baseline from first N cycles
        baseline_vals = [v for _, v in curve[:baseline_cycles]]
        mean = sum(baseline_vals) / len(baseline_vals)
        variance = sum((v - mean) ** 2 for v in baseline_vals) / len(baseline_vals)
        std = math.sqrt(variance) if variance > 0 else 0

        # Find first cycle exceeding threshold
        threshold = mean + threshold_factor * std
        # Ensure minimum threshold to avoid noise triggers on flat curves
        if std < 0.01 * abs(mean) if mean != 0 else std < 1e-6:
            # Very low noise: use a relative increase of 20% above baseline
            threshold = mean * 1.2 if mean > 0 else mean + 1.0

        for cycle, val in curve[baseline_cycles:]:
            if val > threshold:
                onset_cycles.append(cycle)
                break

    if not onset_cycles:
        return None

    # Use earliest onset across all wells, then go 1 cycle before
    earliest = min(onset_cycles)
    suggested = earliest - 1

    # Clamp to valid range
    all_cycles = sorted(set(c for c, _ in next(iter(well_curves.values()))))
    if all_cycles:
        suggested = max(all_cycles[0], min(suggested, all_cycles[-1]))

    return suggested
