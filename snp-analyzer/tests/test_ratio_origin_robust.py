"""The ratio origin has to survive one bad well, and the ROX toggle must not
rewrite the plate.

Regression cover for a real 96-well CFX run
(``1-2_admin_2026-09-03 16-14-11_783BR20183.pcrd``). Its shape: 68 wells that
amplified on the FAM allele (~9000-11500 / ~2500 RFU), 26 wells that did not
amplify at all and sit at the pre-read floor (~3800-4800 / ~2350-2650), and one
well whose passive reference read 1.73x the plate median.

What that plate did to the old code:

    use_rox   origin source   origin              wells auto-labelled NTC
    off       plate_min       (3803.8, 2331.4)    25 of 96
    on        plate_min       set by ONE well     1 of 96

Neither number was right — the plate has no no-template well at all — and the
operator relabelled all 96 wells by hand. Both failures came from the same
place: a per-channel MINIMUM lets a single well define where "no signal" is,
and once the origin moves, every ratio and the relative no-signal cutoff move
with it.
"""
from __future__ import annotations

from collections import Counter

from app.models import UnifiedData, WellCycleData
from app.processing.clustering import cluster_auto
from app.processing.normalize import normalize_for_cycle
from app.processing.ratio_origin import (
    compute_ratio_origin,
    rox_outlier_wells,
    shift_to_origin,
)

_PLATE_ROX = 4263.0
_OUTLIER_WELL = "A11"          # reference reads 1.73x the plate median
_DIMMEST_WELL = "H1"           # the per-channel minimum in both channels


def _plate() -> UnifiedData:
    """One endpoint cycle shaped like the run above."""
    readings: list[WellCycleData] = []

    def add(well: str, fam: float, allele2: float, rox: float = _PLATE_ROX) -> None:
        readings.append(WellCycleData(well=well, cycle=1, fam=fam, allele2=allele2, rox=rox))

    # 68 amplified wells, spread across the range the real plate covered.
    for i in range(68):
        add(f"S{i}", 9000.0 + (i % 26) * 100.0, 2450.0 + (i % 7) * 20.0)

    # 26 wells stuck at the optical floor. One of them is the plate minimum in
    # both channels, and one carries the bad passive reference.
    for i in range(26):
        well = f"L{i}"
        fam, allele2 = 4000.0 + (i % 9) * 100.0, 2400.0 + (i % 5) * 50.0
        if i == 0:
            well, fam, allele2 = _DIMMEST_WELL, 3803.8, 2331.4
        elif i == 1:
            well = _OUTLIER_WELL
        add(well, fam, allele2, 7380.0 if well == _OUTLIER_WELL else _PLATE_ROX)

    wells = sorted({r.well for r in readings})
    return UnifiedData(
        instrument="CFX Opus (raw)", allele2_dye="HEX", wells=wells, cycles=[1],
        data=readings, has_rox=True, background_mode="none",
    )


def _call(use_rox: bool) -> tuple[dict[str, str], object, list[str]]:
    unified = _plate()
    points = normalize_for_cycle(unified, 1, use_rox=use_rox, background="none")
    origin = compute_ratio_origin(points, set())
    shifted = shift_to_origin(
        [
            {
                "well": p.well,
                "norm_fam": p.norm_fam,
                "norm_allele2": p.norm_allele2,
                "plot_fam": p.norm_fam,
                "plot_allele2": p.norm_allele2,
            }
            for p in points
        ],
        origin,
    )
    warnings: list[str] = []
    assignments, _ = cluster_auto(shifted, ploidy=2, warnings=warnings)
    return assignments, origin, warnings


# ---------------------------------------------------------------------------
# The origin
# ---------------------------------------------------------------------------

def test_a_full_plate_uses_the_floor_quantile_not_the_minimum():
    _, origin, _ = _call(use_rox=False)
    assert origin.source == "plate_floor"
    # Strictly above the dimmest well: that well no longer IS the origin.
    assert origin.fam > 3803.8 and origin.allele2 > 2331.4


def test_the_dimmest_well_does_not_define_the_origin():
    """Removing the plate minimum barely moves a quantile; it would move the
    minimum to whatever the next-dimmest well happens to be."""
    unified = _plate()
    points = normalize_for_cycle(unified, 1, use_rox=False, background="none")
    full = compute_ratio_origin(points, set())
    without = compute_ratio_origin([p for p in points if p.well != _DIMMEST_WELL], set())
    assert abs(without.fam - full.fam) < 0.02 * full.fam


def test_the_passive_reference_outlier_is_named_and_kept_out_of_the_origin():
    unified = _plate()
    points = normalize_for_cycle(unified, 1, use_rox=True, background="none")
    assert rox_outlier_wells(points) == {_OUTLIER_WELL}

    origin = compute_ratio_origin(points, set())
    outlier = next(p for p in points if p.well == _OUTLIER_WELL)
    # Normalized, the outlier is the dimmest well in both channels. If it were
    # still a candidate it would BE the origin.
    assert outlier.norm_fam < origin.fam and outlier.norm_allele2 < origin.allele2


def test_a_declared_ntc_still_wins_over_the_floor_estimate():
    unified = _plate()
    points = normalize_for_cycle(unified, 1, use_rox=False, background="none")
    origin = compute_ratio_origin(points, {"L5", "L6", "L7"})
    assert origin.source == "ntc"


# ---------------------------------------------------------------------------
# What the calls become
# ---------------------------------------------------------------------------

def test_a_plate_with_no_no_template_well_gets_no_ntc_call():
    assignments, _, warnings = _call(use_rox=False)
    assert Counter(assignments.values())["NTC"] == 0
    assert "relative_ntc" in warnings


def test_the_wells_that_did_not_amplify_are_no_calls():
    assignments, _, _ = _call(use_rox=False)
    assert assignments[_DIMMEST_WELL] == "Undetermined"
    assert assignments["L5"] == "Undetermined"
    # ... and the wells that did amplify are still called.
    assert assignments["S0"] == "Allele 1 Homo"


def test_the_rox_toggle_does_not_rewrite_the_plate():
    """The property the old code lost: 25 no-signal wells raw vs 1 normalized.
    Dividing by a passive reference whose CV is a few percent cannot legitimately
    change a quarter of the plate's calls."""
    raw, _, _ = _call(use_rox=False)
    normalized, _, _ = _call(use_rox=True)

    raw_counts, norm_counts = Counter(raw.values()), Counter(normalized.values())
    assert abs(raw_counts["Undetermined"] - norm_counts["Undetermined"]) <= 2
    disagreements = [w for w in raw if raw[w] != normalized.get(w)]
    assert len(disagreements) <= 2, disagreements
