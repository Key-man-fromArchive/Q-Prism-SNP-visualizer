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
