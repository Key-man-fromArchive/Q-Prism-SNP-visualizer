"""Ct/Cq calculation using auto-threshold method."""
from __future__ import annotations


def auto_threshold(values: list[float], baseline_cycles: int = 5, n_sigma: float = 10.0) -> float:
    """Calculate auto-threshold from baseline region.

    Args:
        values: fluorescence values per cycle (0-indexed)
        baseline_cycles: number of initial cycles for baseline
        n_sigma: multiplier for standard deviation

    Returns:
        threshold value
    """
    if len(values) < baseline_cycles:
        baseline_cycles = max(1, len(values) // 2)

    baseline = values[:baseline_cycles]
    mean_bl = sum(baseline) / len(baseline)
    variance = sum((v - mean_bl) ** 2 for v in baseline) / len(baseline)
    std_bl = variance ** 0.5

    return mean_bl + n_sigma * std_bl


def calculate_ct(
    values: list[float],
    cycles: list[int],
    threshold: float | None = None,
    baseline_cycles: int = 5,
    n_sigma: float = 10.0,
) -> dict:
    """Calculate Ct value for a single well/channel.

    Args:
        values: fluorescence values per cycle
        cycles: corresponding cycle numbers
        threshold: explicit threshold (if None, auto-calculated)
        baseline_cycles: cycles for baseline calculation
        n_sigma: sigma multiplier for auto-threshold

    Returns:
        dict with keys: ct (float|None), threshold (float), baseline_mean (float), baseline_std (float)
    """
    if not values or len(values) < 3:
        return {"ct": None, "threshold": 0, "baseline_mean": 0, "baseline_std": 0}

    # Baseline stats
    bl_n = min(baseline_cycles, len(values) // 2) or 1
    baseline = values[:bl_n]
    mean_bl = sum(baseline) / len(baseline)
    variance = sum((v - mean_bl) ** 2 for v in baseline) / len(baseline)
    std_bl = variance ** 0.5

    if threshold is None:
        threshold = mean_bl + n_sigma * std_bl

    # Find crossing point with linear interpolation
    ct = None
    for i in range(len(values) - 1):
        if values[i] < threshold <= values[i + 1]:
            # Linear interpolation
            denom = values[i + 1] - values[i]
            if denom > 0:
                frac = (threshold - values[i]) / denom
                ct = cycles[i] + frac * (cycles[i + 1] - cycles[i])
            else:
                ct = float(cycles[i])
            break

    return {
        "ct": round(ct, 2) if ct is not None else None,
        "threshold": round(threshold, 4),
        "baseline_mean": round(mean_bl, 4),
        "baseline_std": round(std_bl, 4),
    }


def calculate_all_ct(unified_data, use_rox: bool = True) -> dict[str, dict]:
    """Calculate Ct for all wells, both FAM and Allele2 channels.

    Args:
        unified_data: UnifiedData model
        use_rox: whether to apply ROX normalization

    Returns:
        dict[well] -> {fam_ct, allele2_ct, fam_threshold, allele2_threshold, ...}
    """
    from app.processing.normalize import normalize

    all_norm = normalize(unified_data.data, unified_data.has_rox, use_rox)

    # Group by well
    well_data: dict[str, list] = {}
    for p in all_norm:
        well_data.setdefault(p.well, []).append(p)

    results = {}
    for well, points in well_data.items():
        points.sort(key=lambda p: p.cycle)
        cycles = [p.cycle for p in points]
        fam_values = [p.norm_fam for p in points]
        allele2_values = [p.norm_allele2 for p in points]

        fam_result = calculate_ct(fam_values, cycles)
        allele2_result = calculate_ct(allele2_values, cycles)

        results[well] = {
            "well": well,
            "fam_ct": fam_result["ct"],
            "fam_threshold": fam_result["threshold"],
            "fam_baseline_mean": fam_result["baseline_mean"],
            "allele2_ct": allele2_result["ct"],
            "allele2_threshold": allele2_result["threshold"],
            "allele2_baseline_mean": allele2_result["baseline_mean"],
        }

    return results
