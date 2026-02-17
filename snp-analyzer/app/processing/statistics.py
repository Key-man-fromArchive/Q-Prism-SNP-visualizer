"""Allele frequency and Hardy-Weinberg equilibrium statistics."""
from __future__ import annotations
import math


def allele_frequencies(n_aa: int, n_ab: int, n_bb: int) -> dict:
    """Calculate allele frequencies p (allele A) and q (allele B).

    Returns dict with: p, q, total_genotyped, n_aa, n_ab, n_bb
    """
    total = n_aa + n_ab + n_bb
    if total == 0:
        return {"p": 0.0, "q": 0.0, "total_genotyped": 0, "n_aa": 0, "n_ab": 0, "n_bb": 0}

    p = (2 * n_aa + n_ab) / (2 * total)
    q = 1.0 - p

    return {
        "p": round(p, 4),
        "q": round(q, 4),
        "total_genotyped": total,
        "n_aa": n_aa,
        "n_ab": n_ab,
        "n_bb": n_bb,
    }


def _chi2_sf_1df(x: float) -> float:
    """Survival function (1 - CDF) for chi-squared distribution with 1 df.
    Uses complementary error function: P(X > x) = erfc(sqrt(x/2))."""
    if x <= 0:
        return 1.0
    return math.erfc(math.sqrt(x / 2))


def hwe_test(n_aa: int, n_ab: int, n_bb: int) -> dict:
    """Hardy-Weinberg Equilibrium chi-square test.

    Returns dict with: chi2, p_value, expected_aa, expected_ab, expected_bb, in_hwe (bool, p>0.05)
    """
    total = n_aa + n_ab + n_bb
    if total < 2:
        return {
            "chi2": None, "p_value": None,
            "expected_aa": None, "expected_ab": None, "expected_bb": None,
            "in_hwe": None,
        }

    freq = allele_frequencies(n_aa, n_ab, n_bb)
    p, q = freq["p"], freq["q"]

    exp_aa = p * p * total
    exp_ab = 2 * p * q * total
    exp_bb = q * q * total

    # Chi-square statistic
    chi2 = 0.0
    for obs, exp in [(n_aa, exp_aa), (n_ab, exp_ab), (n_bb, exp_bb)]:
        if exp > 0:
            chi2 += (obs - exp) ** 2 / exp

    p_value = _chi2_sf_1df(chi2)

    return {
        "chi2": round(chi2, 4),
        "p_value": round(p_value, 4),
        "expected_aa": round(exp_aa, 2),
        "expected_ab": round(exp_ab, 2),
        "expected_bb": round(exp_bb, 2),
        "in_hwe": p_value > 0.05,
    }
