"""Genotype ratios are measured from the plate's NTC wells, not from (0, 0).

Raw endpoint RFU carries an optical background on both reporter channels, and a
common offset on both axes drags every ``fam/(fam+allele2)`` toward 0.5 — which
is the quantity every call in this codebase is made on. The numbers below are a
real endpoint plate; they are the reason this module exists.
"""
from app.models import NormalizedPoint, RatioOrigin
from app.processing.ratio_origin import (
    compute_ratio_origin,
    shift_points_to_origin,
    shift_to_origin,
)


def _point(well: str, fam: float, allele2: float) -> NormalizedPoint:
    return NormalizedPoint(
        well=well, cycle=1,
        norm_fam=fam, norm_allele2=allele2,
        raw_fam=fam, raw_allele2=allele2,
    )


def _dict(well: str, fam: float, allele2: float) -> dict:
    return {"well": well, "norm_fam": fam, "norm_allele2": allele2}


def _ratio(fam: float, allele2: float) -> float:
    return fam / (fam + allele2)


# ---------------------------------------------------------------------------
# Locating the origin
# ---------------------------------------------------------------------------

def test_ntc_wells_are_the_origin():
    points = [_point("A1", 3351, 2402), _point("H1", 2832, 2271), _point("H2", 2840, 2279)]
    origin = compute_ratio_origin(points, {"H1", "H2"})
    assert origin.source == "ntc"
    assert origin.fam == 2836 and origin.allele2 == 2275   # median of the two


def test_a_single_contaminated_ntc_cannot_drag_the_origin():
    """Median, not mean: one hot NTC out of three must not move the origin."""
    points = [
        _point("H1", 2832, 2271),
        _point("H2", 2840, 2279),
        _point("H3", 9000, 2280),   # contaminated
    ]
    origin = compute_ratio_origin(points, {"H1", "H2", "H3"})
    assert origin.fam == 2840       # the middle value, not (2832+2840+9000)/3


def test_plate_minimum_stands_in_when_no_ntc_is_known():
    points = [_point("A1", 3351, 2402), _point("G1", 3162, 2841), _point("H1", 2832, 2271)]
    origin = compute_ratio_origin(points, set())
    assert origin.source == "plate_min"       # a weaker claim, and says so
    assert origin.fam == 2832 and origin.allele2 == 2271


def test_declared_ntc_not_on_the_plate_falls_back():
    points = [_point("A1", 3351, 2402), _point("H1", 2832, 2271)]
    origin = compute_ratio_origin(points, {"H12"})   # never read
    assert origin.source == "plate_min"


def test_no_points_means_no_origin():
    origin = compute_ratio_origin([], {"H1"})
    assert (origin.fam, origin.allele2, origin.source) == (0.0, 0.0, "zero")


# ---------------------------------------------------------------------------
# What it buys: the calls become possible at all
# ---------------------------------------------------------------------------

def test_raw_ratios_are_unusable_and_shifted_ones_are_not():
    """A1 is FAM-dominant, G1 leans HEX. From (0, 0) they are 0.056 apart --
    no set of boundary cuts resolves that. From the NTC origin, 0.43 apart."""
    a1, g1, ntc = (3351, 2402), (3162, 2841), (2832, 2271)

    raw_gap = abs(_ratio(*a1) - _ratio(*g1))
    assert round(_ratio(*a1), 3) == 0.582
    assert round(_ratio(*g1), 3) == 0.527
    assert raw_gap < 0.06

    points = [_point("A1", *a1), _point("G1", *g1), _point("H1", *ntc)]
    origin = compute_ratio_origin(points, {"H1"})
    shifted = {p["well"]: p for p in shift_to_origin(
        [_dict("A1", *a1), _dict("G1", *g1)], origin
    )}
    r_a1 = _ratio(shifted["A1"]["norm_fam"], shifted["A1"]["norm_allele2"])
    r_g1 = _ratio(shifted["G1"]["norm_fam"], shifted["G1"]["norm_allele2"])

    assert round(r_a1, 3) == 0.798
    assert round(r_g1, 3) == 0.367
    assert abs(r_a1 - r_g1) > 0.4


def test_ntc_wells_land_on_the_origin_so_the_ntc_detectors_see_them():
    """Both NTC rules -- an absolute ntc_threshold and the relative
    plate-median one -- test total signal. Measured from (0, 0) on raw data an
    NTC well's total is ~0.9x the plate median and neither ever fires."""
    plate = [_point("A1", 3351, 2402), _point("G1", 3162, 2841), _point("H1", 2832, 2271)]
    raw_totals = sorted(p.norm_fam + p.norm_allele2 for p in plate)
    raw_median = raw_totals[len(raw_totals) // 2]
    ntc_raw = 2832 + 2271
    assert ntc_raw / raw_median > 0.85          # invisible to a 0.2x rule

    origin = compute_ratio_origin(plate, {"H1"})
    shifted = {p.well: p for p in shift_points_to_origin(plate, origin)}
    assert shifted["H1"].norm_fam == 0 and shifted["H1"].norm_allele2 == 0


# ---------------------------------------------------------------------------
# Mechanics
# ---------------------------------------------------------------------------

def test_shift_clamps_at_zero_and_keeps_every_other_key():
    origin = RatioOrigin(fam=100.0, allele2=100.0, source="ntc")
    out = shift_to_origin([{"well": "A1", "norm_fam": 40.0, "norm_allele2": 250.0,
                            "extra": "kept"}], origin)
    assert out[0] == {"well": "A1", "norm_fam": 0.0, "norm_allele2": 150.0,
                      "extra": "kept"}


def test_shift_leaves_the_raw_fields_alone():
    """Displayed and exported values stay raw -- only the calling geometry moves."""
    origin = RatioOrigin(fam=2832.0, allele2=2271.0, source="ntc")
    out = shift_points_to_origin([_point("A1", 3351, 2402)], origin)[0]
    assert out.norm_fam == 519.0 and out.norm_allele2 == 131.0
    assert out.raw_fam == 3351 and out.raw_allele2 == 2402


def test_a_zero_origin_is_a_no_op():
    points = [_point("A1", 3351, 2402)]
    dicts = [_dict("A1", 3351, 2402)]
    zero = RatioOrigin()
    assert shift_points_to_origin(points, zero) is points
    assert shift_to_origin(dicts, zero) is dicts


# ---------------------------------------------------------------------------
# The exported genotype column, which is the deliverable
# ---------------------------------------------------------------------------

def test_export_genotype_fallback_needs_the_origin_to_separate_alleles():
    """CSV/XLSX fall back to a ratio call for any well with no cluster or manual
    type. Fed raw endpoint values that fallback calls every well heterozygous;
    fed origin-relative ones it calls the alleles."""
    from app.routers.export import _determine_genotype, _undetermined_min

    plate = [
        _point("A1", 3351, 2402),   # FAM allele
        _point("G1", 3162, 2841),   # HEX-leaning
        _point("H1", 2832, 2271),   # NTC
    ]

    def call(points):
        umin = _undetermined_min(points)
        return {
            p.well: _determine_genotype(p.well, p.norm_fam, p.norm_allele2, {}, {}, 2, umin)
            for p in points
        }

    raw = call(plate)
    # Every well lands in the middle wedge: the column carries no information.
    assert raw["A1"] == raw["G1"] == raw["H1"] == "Heterozygous"

    shifted = call(shift_points_to_origin(plate, compute_ratio_origin(plate, {"H1"})))
    assert shifted["A1"] == "Allele 1 Homo"              # ratio 0.798
    assert shifted["G1"] != shifted["A1"]               # ratio 0.367 — a real call
    assert shifted["H1"] == "Undetermined"               # sits at the origin
