"""Endpoint (single-read) .pcrd: per-channel background subtraction instead of
whole-read baseline (which would zero the reporters)."""
from app.parsers.pcrd_raw import _subtract_channel_background, _subtract_baseline
from app.models import DataWindow


def _cycle(fam_hex):  # fam_hex: {well: (fam, allele2, rox)}
    return {"cycle": 1, "wells": {w: {"fam": f, "allele2": a, "rox": r} for w, (f, a, r) in fam_hex.items()}}


def test_single_read_background_floor_preserves_signal():
    cd = [_cycle({
        "A1": (3351, 2402, 2784),   # FAM-dominant
        "G1": (3162, 2841, 2850),   # HEX-leaning
        "H1": (2832, 2271, 2782),   # plate min in each channel (background well)
    })]
    _subtract_channel_background(cd)
    w = cd[0]["wells"]
    # background floor = min per channel (fam 2832, allele2 2271) subtracted
    assert w["A1"]["fam"] == 3351 - 2832 and w["A1"]["allele2"] == 2402 - 2271
    assert w["H1"]["fam"] == 0 and w["H1"]["allele2"] == 0
    # ROX untouched
    assert w["A1"]["rox"] == 2784
    # discrimination signal is preserved (A1 FAM-dominant, G1 not)
    r_a1 = w["A1"]["fam"] / (w["A1"]["fam"] + w["A1"]["allele2"])
    r_g1 = w["G1"]["fam"] / (w["G1"]["fam"] + w["G1"]["allele2"])
    assert r_a1 > 0.7 and r_g1 < r_a1


def test_background_clamps_at_zero():
    cd = [_cycle({"A1": (100, 50, 1000), "A2": (100, 200, 1000)})]
    _subtract_channel_background(cd)
    w = cd[0]["wells"]
    assert w["A1"]["fam"] == 0 and w["A2"]["fam"] == 0  # both at fam min
    assert all(v["fam"] >= 0 and v["allele2"] >= 0 for v in w.values())


# ---------------------------------------------------------------------------
# Amplification runs: the baseline is the pre-read, not the first read.
#
# Real numbers below are the raw FAM means of three runs of the same assay on
# 2026-08-24, differing only in how many cycles run before the first plate read
# (v4: 25, v7/v8: 35). Taking the first read as the baseline works for v4 and
# destroys v8.
# ---------------------------------------------------------------------------

def _run(preread, reads):
    """cycle_data for a run: one pre-read, then `reads` amplification cycles."""
    def wells(vals):
        return {w: {"fam": f, "allele2": f, "rox": 2500.0} for w, f in vals.items()}
    cd = [{"cycle": 1, "wells": wells(preread)}]
    for i, r in enumerate(reads, start=2):
        cd.append({"cycle": i, "wells": wells(r)})
    windows = [
        DataWindow(name="Pre-read", start_cycle=1, end_cycle=1),
        DataWindow(name="Amplification", start_cycle=2, end_cycle=1 + len(reads)),
    ]
    return cd, windows


def test_late_reading_run_keeps_its_discrimination():
    """v8: 35 cycles before the first read, so that read is already amplified."""
    cd, windows = _run(
        preread={"POS": 4155.0, "NTC": 3814.0},
        reads=[{"POS": 10233.0, "NTC": 4688.0},     # first read — already separated
               {"POS": 13352.0, "NTC": 13329.0}],   # last read — NTC has caught up
    )
    _subtract_baseline(cd, windows)
    first = cd[1]["wells"]
    # Baselining on the first read would have made both of these 0.
    assert first["POS"]["fam"] > 6000
    assert first["NTC"]["fam"] > 0
    assert first["POS"]["fam"] - first["NTC"]["fam"] > 5000


def test_early_reading_run_is_unchanged_in_shape():
    """v4: 25 cycles before the first read, so the first read is still flat."""
    cd, windows = _run(
        preread={"POS": 4163.0, "NTC": 3751.0},
        reads=[{"POS": 4770.0, "NTC": 4293.0},
               {"POS": 10042.0, "NTC": 4658.0}],
    )
    _subtract_baseline(cd, windows)
    first, peak = cd[1]["wells"], cd[2]["wells"]
    assert first["POS"]["fam"] - first["NTC"]["fam"] < 500      # nothing yet
    assert peak["POS"]["fam"] - peak["NTC"]["fam"] > 4800       # separated


def test_separation_never_goes_negative_where_it_is_real():
    """The old behaviour drove the best-separating cycle negative on a late run."""
    cd, windows = _run(
        preread={"POS": 4155.0, "NTC": 3814.0},
        reads=[{"POS": 10233.0, "NTC": 4688.0},
               {"POS": 10419.0, "NTC": 5042.0}],
    )
    _subtract_baseline(cd, windows)
    for entry in cd[1:]:
        w = entry["wells"]
        assert w["POS"]["fam"] > 0 and w["NTC"]["fam"] > 0
        assert w["POS"]["fam"] > w["NTC"]["fam"]


def test_falls_back_to_first_amplification_cycle_without_a_preread():
    cd, windows = _run(preread={"POS": 0.0, "NTC": 0.0},
                       reads=[{"POS": 4770.0, "NTC": 4293.0},
                              {"POS": 10042.0, "NTC": 4658.0}])
    windows = [w for w in windows if w.name != "Pre-read"]   # no pre-read recorded
    _subtract_baseline(cd, windows)
    assert cd[1]["wells"]["POS"]["fam"] == 0.0               # baselined on itself
    assert cd[2]["wells"]["POS"]["fam"] == 10042.0 - 4770.0
