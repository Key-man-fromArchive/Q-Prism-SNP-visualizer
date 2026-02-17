"""Per-well signal quality scoring (0-100)."""
from __future__ import annotations


def _linear_score(value: float, low: float, high: float, max_points: float) -> float:
    """Linear interpolation between low (0 points) and high (max_points)."""
    if value <= low:
        return 0.0
    if value >= high:
        return max_points
    return max_points * (value - low) / (high - low)


def score_well(
    fam_values: list[float],
    allele2_values: list[float],
    baseline_cycles: int = 5,
) -> dict:
    """Score a single well's signal quality.

    Args:
        fam_values: normalized FAM values per cycle
        allele2_values: normalized allele2 values per cycle
        baseline_cycles: number of early cycles used for baseline noise calc

    Returns:
        dict with: score (0-100), magnitude_score, noise_score, rise_score, flags
    """
    if not fam_values or len(fam_values) < 3:
        return {
            "score": 0,
            "magnitude_score": 0,
            "noise_score": 0,
            "rise_score": 0,
            "flags": ["insufficient_data"],
        }

    # Determine dominant channel (the one with higher max)
    max_fam = max(fam_values)
    max_allele2 = max(allele2_values) if allele2_values else 0
    dominant = fam_values if max_fam >= max_allele2 else allele2_values
    max_signal = max(dominant)

    # 1. Signal Magnitude (0-40)
    magnitude_score = _linear_score(max_signal, 0.1, 2.0, 40)

    # 2. Baseline Noise (0-30)
    bl_n = min(baseline_cycles, len(dominant) // 2) or 1
    baseline = dominant[:bl_n]
    bl_mean = sum(baseline) / len(baseline)
    bl_var = sum((v - bl_mean) ** 2 for v in baseline) / len(baseline)
    bl_std = bl_var ** 0.5
    cv = bl_std / bl_mean if bl_mean > 0 else 1.0
    noise_score = 30 - _linear_score(cv, 0.05, 0.5, 30)

    # 3. Amplification Rise (0-30)
    first_val = dominant[0] if dominant[0] > 0 else 0.001
    last_val = dominant[-1]
    rise_ratio = last_val / first_val
    rise_score = _linear_score(rise_ratio, 1.5, 5.0, 30)

    # Total score
    score = round(magnitude_score + noise_score + rise_score)
    score = max(0, min(100, score))

    # Flags
    flags: list[str] = []
    if max_signal < 0.2:
        flags.append("low_signal")
    if cv > 0.3:
        flags.append("noisy_baseline")
    if rise_ratio < 2.0:
        flags.append("weak_amplification")

    return {
        "score": score,
        "magnitude_score": round(magnitude_score, 1),
        "noise_score": round(noise_score, 1),
        "rise_score": round(rise_score, 1),
        "flags": flags,
    }


def score_all_wells(unified_data, use_rox: bool = True) -> dict[str, dict]:
    """Score all wells in a session.

    Returns: dict[well] -> quality score dict
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
        fam_values = [p.norm_fam for p in points]
        allele2_values = [p.norm_allele2 for p in points]
        results[well] = score_well(fam_values, allele2_values)
        results[well]["well"] = well

    return results
