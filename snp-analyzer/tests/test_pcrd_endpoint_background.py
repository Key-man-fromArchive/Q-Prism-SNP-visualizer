"""Background subtraction is OFF by default, and available as an explicit mode.

This assay is KASP-like allele-specific PCR read at ENDPOINT: the RFU at the
read is the measurement, so no cycle stands in for zero signal and subtracting
one subtracts part of the answer. The parser therefore stores raw RFU (it used
to subtract at parse time, irreversibly), and the two baseline modes are
applied at query time on a copy.

The amplification numbers below are the raw FAM means of three runs of the same
assay on 2026-08-24, which differ only in how many cycles run before the first
plate read (v4: 25, v7/v8: 35).
"""
import pytest

from app.models import DataWindow, UnifiedData, WellCycleData
from app.processing.background import (
    BACKGROUND_CHANNEL_MIN,
    BACKGROUND_NONE,
    BACKGROUND_PRE_READ,
    apply_background,
)


def _endpoint(wells: dict[str, tuple[float, float, float]]) -> UnifiedData:
    """Single-read plate: {well: (fam, allele2, rox)}."""
    return UnifiedData(
        instrument="CFX Opus (raw)",
        allele2_dye="HEX",
        wells=sorted(wells),
        cycles=[1],
        data=[
            WellCycleData(well=w, cycle=1, fam=f, allele2=a, rox=r)
            for w, (f, a, r) in wells.items()
        ],
        data_windows=[DataWindow(name="Amplification", start_cycle=1, end_cycle=1)],
        background_mode="none",
    )


def _run(preread: dict[str, float], reads: list[dict[str, float]]) -> UnifiedData:
    """One pre-read then N amplification reads; fam == allele2 for brevity."""
    data: list[WellCycleData] = [
        WellCycleData(well=w, cycle=1, fam=v, allele2=v, rox=2500.0)
        for w, v in preread.items()
    ]
    for i, read in enumerate(reads, start=2):
        data += [
            WellCycleData(well=w, cycle=i, fam=v, allele2=v, rox=2500.0)
            for w, v in read.items()
        ]
    return UnifiedData(
        instrument="CFX Opus (raw)",
        allele2_dye="HEX",
        wells=sorted(preread),
        cycles=list(range(1, len(reads) + 2)),
        data=data,
        data_windows=[
            DataWindow(name="Pre-read", start_cycle=1, end_cycle=1),
            DataWindow(name="Amplification", start_cycle=2, end_cycle=1 + len(reads)),
        ],
        background_mode="none",
    )


def _at(data: UnifiedData, cycle: int) -> dict[str, WellCycleData]:
    return {d.well: d for d in data.data if d.cycle == cycle}


# ---------------------------------------------------------------------------
# Default: nothing is subtracted
# ---------------------------------------------------------------------------

def test_default_is_raw_rfu():
    """The endpoint read reaches the plot as the instrument reported it."""
    plate = _endpoint({"A1": (3351, 2402, 2784), "H1": (2832, 2271, 2782)})
    for mode in (None, BACKGROUND_NONE):
        out = apply_background(plate, mode)
        assert out is plate  # same object: no copy, no transform
        w = _at(out, 1)
        assert (w["A1"].fam, w["A1"].allele2) == (3351, 2402)
        assert (w["H1"].fam, w["H1"].allele2) == (2832, 2271)


def test_unified_data_defaults_to_no_background():
    plate = UnifiedData(
        instrument="x", allele2_dye="HEX", wells=["A1"], cycles=[1],
        data=[WellCycleData(well="A1", cycle=1, fam=1.0, allele2=1.0)],
    )
    assert plate.background_mode is None
    assert apply_background(plate, plate.background_mode) is plate


def test_pcrd_parser_does_not_subtract():
    """The parser must not carry a baseline transform of its own any more.

    A parse-time subtraction is baked into the stored session and cannot be
    undone, which is exactly the failure this module exists to prevent.
    """
    import inspect

    from app.parsers import pcrd_raw

    src = inspect.getsource(pcrd_raw)
    assert "_subtract_baseline" not in src
    assert "_subtract_channel_background" not in src


def test_unknown_mode_is_rejected():
    plate = _endpoint({"A1": (100, 100, 100)})
    with pytest.raises(ValueError, match="Unknown background mode"):
        apply_background(plate, "first_cycle")


def test_a_transform_never_mutates_the_stored_raw_data():
    plate = _endpoint({"A1": (3351, 2402, 2784), "H1": (2832, 2271, 2782)})
    apply_background(plate, BACKGROUND_CHANNEL_MIN)
    assert _at(plate, 1)["A1"].fam == 3351  # original untouched


# ---------------------------------------------------------------------------
# channel_min: the only option on a single endpoint read
# ---------------------------------------------------------------------------

def test_channel_min_floor_preserves_the_discrimination_signal():
    plate = _endpoint({
        "A1": (3351, 2402, 2784),   # FAM-dominant
        "G1": (3162, 2841, 2850),   # HEX-leaning
        "H1": (2832, 2271, 2782),   # plate min in each channel
    })
    w = _at(apply_background(plate, BACKGROUND_CHANNEL_MIN), 1)

    assert w["A1"].fam == 3351 - 2832 and w["A1"].allele2 == 2402 - 2271
    assert w["H1"].fam == 0 and w["H1"].allele2 == 0
    assert w["A1"].rox == 2784  # ROX is a passive reference — never subtracted

    r_a1 = w["A1"].fam / (w["A1"].fam + w["A1"].allele2)
    r_g1 = w["G1"].fam / (w["G1"].fam + w["G1"].allele2)
    assert r_a1 > 0.7 and r_g1 < r_a1


def test_channel_min_clamps_at_zero():
    plate = _endpoint({"A1": (100, 50, 1000), "A2": (100, 200, 1000)})
    w = _at(apply_background(plate, BACKGROUND_CHANNEL_MIN), 1)
    assert w["A1"].fam == 0 and w["A2"].fam == 0  # both at the fam minimum
    assert all(d.fam >= 0 and d.allele2 >= 0 for d in [w["A1"], w["A2"]])


def test_channel_min_floors_each_cycle_separately():
    """Otherwise the global minimum is always the earliest read, which would
    make this a first-cycle baseline by the back door."""
    run = _run(preread={"POS": 4155.0, "NTC": 3814.0},
               reads=[{"POS": 10233.0, "NTC": 4688.0}])
    out = apply_background(run, BACKGROUND_CHANNEL_MIN)
    assert _at(out, 1)["POS"].fam == 4155.0 - 3814.0
    assert _at(out, 2)["POS"].fam == 10233.0 - 4688.0   # not 10233 - 3814


# ---------------------------------------------------------------------------
# pre_read: the baseline is the pre-read, never the first plate read
# ---------------------------------------------------------------------------

def test_late_reading_run_keeps_its_discrimination():
    """v8: 35 cycles before the first read, so that read is already amplified."""
    run = _run(
        preread={"POS": 4155.0, "NTC": 3814.0},
        reads=[{"POS": 10233.0, "NTC": 4688.0},     # first read — already separated
               {"POS": 13352.0, "NTC": 13329.0}],   # last read — NTC has caught up
    )
    first = _at(apply_background(run, BACKGROUND_PRE_READ), 2)
    # Baselining on the first read would have made both of these 0.
    assert first["POS"].fam > 6000
    assert first["NTC"].fam > 0
    assert first["POS"].fam - first["NTC"].fam > 5000


def test_early_reading_run_is_unchanged_in_shape():
    """v4: 25 cycles before the first read, so the first read is still flat."""
    out = apply_background(
        _run(preread={"POS": 4163.0, "NTC": 3751.0},
             reads=[{"POS": 4770.0, "NTC": 4293.0},
                    {"POS": 10042.0, "NTC": 4658.0}]),
        BACKGROUND_PRE_READ,
    )
    first, peak = _at(out, 2), _at(out, 3)
    assert first["POS"].fam - first["NTC"].fam < 500      # nothing yet
    assert peak["POS"].fam - peak["NTC"].fam > 4800       # separated


def test_separation_never_goes_negative_where_it_is_real():
    """The old parse-time behaviour drove the best-separating cycle negative."""
    out = apply_background(
        _run(preread={"POS": 4155.0, "NTC": 3814.0},
             reads=[{"POS": 10233.0, "NTC": 4688.0},
                    {"POS": 10419.0, "NTC": 5042.0}]),
        BACKGROUND_PRE_READ,
    )
    for cycle in (2, 3):
        w = _at(out, cycle)
        assert w["POS"].fam > 0 and w["NTC"].fam > 0
        assert w["POS"].fam > w["NTC"].fam


def test_pre_read_falls_back_to_the_first_amplification_cycle():
    """No pre-read in the protocol: the fallback carries the hazard above,
    which is why it is a fallback and not the default."""
    run = _run(preread={"POS": 0.0, "NTC": 0.0},
               reads=[{"POS": 4770.0, "NTC": 4293.0},
                      {"POS": 10042.0, "NTC": 4658.0}])
    run = run.model_copy(update={
        "data_windows": [w for w in run.data_windows if w.name != "Pre-read"],
    })
    out = apply_background(run, BACKGROUND_PRE_READ)
    assert _at(out, 2)["POS"].fam == 0.0                       # baselined on itself
    assert _at(out, 3)["POS"].fam == 10042.0 - 4770.0


def test_pre_read_leaves_rox_alone():
    out = apply_background(
        _run(preread={"POS": 4155.0}, reads=[{"POS": 10233.0}]),
        BACKGROUND_PRE_READ,
    )
    assert all(d.rox == 2500.0 for d in out.data)
