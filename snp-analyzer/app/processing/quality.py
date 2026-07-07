"""Per-well signal quality scoring (0-100)."""
from __future__ import annotations


def _linear_score(value: float, low: float, high: float, max_points: float) -> float:
    """Linear interpolation between low (0 points) and high (max_points)."""
    if value <= low:
        return 0.0
    if value >= high:
        return max_points
    return max_points * (value - low) / (high - low)


def _well_stats(
    fam_values: list[float], allele2_values: list[float], baseline_cycles: int
) -> dict:
    """Peak signal, amplitude above baseline, and baseline noise fraction."""
    max_fam = max(fam_values)
    max_allele2 = max(allele2_values) if allele2_values else 0
    dominant = fam_values if max_fam >= max_allele2 else allele2_values
    max_signal = max(dominant)

    bl_n = min(baseline_cycles, len(dominant) // 2) or 1
    baseline = dominant[:bl_n]
    bl_mean = sum(baseline) / len(baseline)
    bl_std = (sum((v - bl_mean) ** 2 for v in baseline) / len(baseline)) ** 0.5

    signal_range = max_signal - bl_mean
    noise_frac = bl_std / max(abs(signal_range), 1e-9)
    return {"max_signal": max_signal, "signal_range": signal_range, "noise_frac": noise_frac}


def score_well(
    fam_values: list[float],
    allele2_values: list[float],
    signal_ref: float,
    noise_ref: float,
    baseline_cycles: int = 5,
) -> dict:
    """Score a single well's signal quality — scale-invariant and chemistry-agnostic.

    Genotyping runs on many chemistries: real-time amplification (ASG-PCR) AND
    single low-temperature endpoint reads (LGC / 3CR), where the amplification
    curve is intentionally flat. So quality is judged on the SIGNAL AMPLITUDE
    above baseline and baseline cleanliness relative to that amplitude — never on
    a last/first "rise ratio" (meaningless for endpoint data, and unstable when
    the normalized baseline sits near zero). All thresholds are fractions of the
    plate's own typical signal (``signal_ref``) or dimensionless ratios, so a
    low-ROX kit that rescales every axis works unchanged.

    Args:
        fam_values / allele2_values: normalized per-cycle values
        signal_ref: plate-wide reference signal level (median of per-well max)
        noise_ref: plate-wide typical baseline noise fraction (median). Noise is
            scored/flagged RELATIVE to this — so a uniform normalization artifact
            (e.g. a near-zero baseline that is noisy across the whole plate) does
            not falsely flag every well; only genuine outliers are flagged.
        baseline_cycles: number of early cycles used for the baseline estimate
    """
    if not fam_values or len(fam_values) < 3:
        return {
            "score": 0,
            "magnitude_score": 0,
            "noise_score": 0,
            "rise_score": 0,
            "flags": ["insufficient_data"],
        }

    stats = _well_stats(fam_values, allele2_values, baseline_cycles)
    max_signal = stats["max_signal"]
    signal_range = stats["signal_range"]
    noise_frac = stats["noise_frac"]

    ref = signal_ref if signal_ref > 0 else max(max_signal, 1e-9)
    nref = noise_ref if noise_ref > 0 else max(noise_frac, 1e-9)
    noise_ratio = noise_frac / nref  # how noisy this well is vs the plate's norm

    # 1. Signal magnitude, relative to the plate's typical signal (0-40).
    magnitude_score = _linear_score(max_signal, 0.1 * ref, ref, 40)
    # 2. Baseline cleanliness, relative to the plate's typical baseline noise (0-30).
    noise_score = 30 - _linear_score(noise_ratio, 1.0, 3.0, 30)
    # 3. Signal amplitude above baseline, relative to the plate (0-30).
    amplitude_score = _linear_score(signal_range, 0.1 * ref, 0.6 * ref, 30)

    score = round(max(0.0, min(100.0, magnitude_score + noise_score + amplitude_score)))

    # Flags fire only when a well is a genuine outlier vs the rest of the plate.
    flags: list[str] = []
    if max_signal < 0.15 * ref:
        flags.append("low_signal")
    if noise_ratio > 2.0:
        flags.append("noisy_baseline")
    if signal_range < 0.15 * ref:
        flags.append("weak_amplification")

    return {
        "score": score,
        "magnitude_score": round(magnitude_score, 1),
        "noise_score": round(noise_score, 1),
        "rise_score": round(amplitude_score, 1),
        "flags": flags,
    }


def score_all_wells(unified_data, use_rox: bool = True) -> dict[str, dict]:
    """Score all wells in a session.

    Returns: dict[well] -> quality score dict
    """
    from app.processing.normalize import normalize

    all_norm = normalize(unified_data, use_rox=use_rox)

    # Group by well
    well_data: dict[str, list] = {}
    for p in all_norm:
        well_data.setdefault(p.well, []).append(p)

    # Plate-wide references (median peak signal + median baseline noise). Every
    # threshold is a fraction of these, so the score is invariant to the plate's
    # absolute scale (low-ROX kits) AND to a uniform normalization artifact.
    per_well_curves: dict[str, tuple[list[float], list[float]]] = {}
    peaks: list[float] = []
    noise_fracs: list[float] = []
    for well, points in well_data.items():
        points.sort(key=lambda p: p.cycle)
        fam_values = [p.norm_fam for p in points]
        allele2_values = [p.norm_allele2 for p in points]
        per_well_curves[well] = (fam_values, allele2_values)
        if fam_values and len(fam_values) >= 3:
            st = _well_stats(fam_values, allele2_values, baseline_cycles=5)
            peaks.append(st["max_signal"])
            noise_fracs.append(st["noise_frac"])

    peaks.sort()
    noise_fracs.sort()
    signal_ref = peaks[len(peaks) // 2] if peaks else 0.0
    noise_ref = noise_fracs[len(noise_fracs) // 2] if noise_fracs else 0.0

    results = {}
    for well, (fam_values, allele2_values) in per_well_curves.items():
        results[well] = score_well(fam_values, allele2_values, signal_ref, noise_ref)
        results[well]["well"] = well

    return results
