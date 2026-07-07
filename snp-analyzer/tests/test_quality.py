"""Per-well quality scoring: scale-invariant, chemistry-agnostic, plate-relative.

Regression for endpoint chemistry (flat amplification, near-zero normalized
baseline) being falsely flagged noisy_baseline / weak_amplification everywhere.
"""

from collections import Counter

from app.models import UnifiedData, WellCycleData
from app.processing.quality import score_all_wells


def _unified(scale: float = 1.0, dead_well: bool = False) -> UnifiedData:
    """20 endpoint-style wells: a noisy near-zero baseline then a clear signal.
    All similar, so no well is an outlier. Optionally add one dead well."""
    n_cycles = 12
    wells: list[str] = []
    data: list[WellCycleData] = []

    def add(well: str, endpoint: float):
        wells.append(well)
        for c in range(1, n_cycles + 1):
            if c < n_cycles:  # baseline: small, deterministically "noisy"
                v = (0.02 + ((c * 7 + hash(well)) % 5) * 0.01) * scale
            else:  # endpoint read: the real signal
                v = endpoint * scale
            data.append(WellCycleData(well=well, cycle=c, fam=v, allele2=v * 0.3, rox=None))

    for i in range(20):
        add(f"W{i}", endpoint=0.6)
    if dead_well:
        # No signal at all — a genuine outlier.
        wells.append("DEAD")
        for c in range(1, n_cycles + 1):
            data.append(WellCycleData(well="DEAD", cycle=c, fam=0.01 * scale, allele2=0.01 * scale, rox=None))

    return UnifiedData(
        instrument="QuantStudio 3", allele2_dye="VIC", wells=wells,
        cycles=list(range(1, n_cycles + 1)), data=data, has_rox=False,
    )


def test_uniform_endpoint_plate_has_no_false_flags():
    res = score_all_wells(_unified(), use_rox=False)
    flags = Counter(f for r in res.values() for f in r["flags"])
    # A uniform plate must not flag every well as noisy/weak.
    assert flags.get("noisy_baseline", 0) == 0
    assert flags.get("weak_amplification", 0) == 0
    assert all(r["score"] >= 50 for r in res.values())


def test_dead_well_is_flagged():
    res = score_all_wells(_unified(dead_well=True), use_rox=False)
    assert "low_signal" in res["DEAD"]["flags"] or "weak_amplification" in res["DEAD"]["flags"]
    # The 20 real wells stay clean.
    assert all(not res[f"W{i}"]["flags"] for i in range(20))


def test_quality_is_scale_invariant():
    """A low-ROX kit rescales every axis; scores must not change."""
    small = score_all_wells(_unified(scale=1.0), use_rox=False)
    large = score_all_wells(_unified(scale=1000.0), use_rox=False)
    for w in small:
        assert small[w]["score"] == large[w]["score"], w
        assert small[w]["flags"] == large[w]["flags"], w
