"""Committed synthetic stand-ins for the real two-marker hexaploid plate
(qSwet5.3 / qTotal11.1). CI-safe: no .pcrd file / decryption key needed.

Values are fixed and deterministic (no per-run randomness) so tests are
reproducible. Point dicts follow the ``{"well", "norm_fam", "norm_allele2"}``
contract used throughout ``app.processing.clustering``, with
``ratio = norm_fam / (norm_fam + norm_allele2)`` mirroring the real fam-fraction.

qSwet5.3 (wide dosage gradient, genuinely 3 dosage classes):
    ratios span ~0.145-0.875 across 3 well-separated clusters near
    0.20 / 0.50 / 0.80 (dosages AAAAAB / AAABBB / ABBBBB at ploidy=6),
    plus a few NTC wells.

qTotal11.1 (narrow single distribution, genuinely monomorphic):
    ratios cluster tightly around ~0.74 (observed range ~0.69-0.79), plus a
    couple of NTC wells and a couple of failed wells stuck at the ratio
    extremes (~0.0 / ~1.0) -- present at normal signal level so they are NOT
    NTC, just failed/ambiguous calls.
"""
from __future__ import annotations

_NORMAL_TOTAL = 1000.0
_NTC_TOTAL = 10.0  # well below _NTC_SIGNAL_FRAC * median of ~1000


def _make_points(ratios: list[float], prefix: str, total: float = _NORMAL_TOTAL) -> list[dict]:
    return [
        {
            "well": f"{prefix}{i}",
            "norm_fam": r * total,
            "norm_allele2": (1.0 - r) * total,
        }
        for i, r in enumerate(ratios)
    ]


def qswet_points() -> list[dict]:
    """~24 wells: 3 real, well-separated dosage clusters (~0.20/0.50/0.80),
    each with small jitter, spanning ~0.155-0.845, plus 3 NTC wells."""
    cluster_low = [0.155, 0.17, 0.185, 0.20, 0.215, 0.23, 0.245]
    cluster_mid = [0.455, 0.47, 0.485, 0.50, 0.515, 0.53, 0.545]
    cluster_high = [0.755, 0.77, 0.785, 0.80, 0.815, 0.83, 0.845]

    points = (
        _make_points(cluster_low, "QSW_L")
        + _make_points(cluster_mid, "QSW_M")
        + _make_points(cluster_high, "QSW_H")
    )
    points += [
        {"well": f"QSW_NTC{i}", "norm_fam": 5.0, "norm_allele2": 5.0} for i in range(3)
    ]
    return points


def qtotal_points() -> list[dict]:
    """~16 wells: one tight, genuinely monomorphic cluster (ratios ~0.67-0.81,
    centred ~0.74), plus 2 NTC wells and 2 failed wells stuck at the ratio
    extremes."""
    # A single true dosage class, but replicate noise clumps unevenly around
    # its mean (0.67-0.72 and 0.76-0.81) rather than smoothly filling the
    # range -- exactly the kind of real-world noise shape that can fool a
    # naive fixed-fraction merge threshold into calling it 2 dosages.
    cluster = [0.67, 0.68, 0.69, 0.70, 0.71, 0.72, 0.76, 0.77, 0.78, 0.79, 0.80, 0.81]

    points = _make_points(cluster, "QT_C")
    points += [
        {"well": f"QT_NTC{i}", "norm_fam": 5.0, "norm_allele2": 5.0} for i in range(2)
    ]
    # Failed wells: normal total signal, but stuck at the ratio extremes.
    points += _make_points([0.005, 0.995], "QT_FAIL")
    return points
