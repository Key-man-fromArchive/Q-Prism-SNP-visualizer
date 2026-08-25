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


def _with_offset(unified: UnifiedData, offset: float) -> UnifiedData:
    """The same plate read with an optical background on both reporters."""
    return unified.model_copy(update={
        "data": [
            d.model_copy(update={"fam": d.fam + offset, "allele2": d.allele2 + offset})
            for d in unified.data
        ]
    })


def test_quality_is_offset_invariant():
    """Raw reporter channels carry 2000-4000 RFU of optical background and
    nothing subtracts it any more (app/processing/background.py). Scoring the
    absolute peak gave a background-only well 10.6 of 40 magnitude points and
    dropped its low_signal flag, because 3000 is not under 15% of a 9000
    median. Every term reads amplitude above the well's own baseline instead,
    so the offset cancels exactly.
    """
    plate = _unified(dead_well=True)
    plain = score_all_wells(plate, use_rox=False)
    offset = score_all_wells(_with_offset(plate, 3000.0), use_rox=False)

    assert set(plain) == set(offset)
    for w in plain:
        assert plain[w]["score"] == offset[w]["score"], w
        assert plain[w]["flags"] == offset[w]["flags"], w
    # The dead well gets no credit for background: both amplitude terms are 0
    # and it is flagged, with or without the offset. (Its remaining 30 points
    # are the noise term — a perfectly flat well has a perfectly clean
    # baseline. That is the rubric's own judgement, unchanged here.)
    assert offset["DEAD"]["magnitude_score"] == 0
    assert offset["DEAD"]["rise_score"] == 0
    assert "low_signal" in offset["DEAD"]["flags"]
