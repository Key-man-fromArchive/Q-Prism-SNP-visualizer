"""Synthetic example datasets for demoing genotyping at each ploidy (2x–8x).

Each example is a full-spectrum plate: the P+1 dosage classes at fam-fractions
near ``d/P`` (with a mild, realistic dye/amplification skew and deterministic
per-well noise), plus a few NTC wells and two cycles (a low pre-read and a
high endpoint). ``ploidy`` is set on the session so the UI opens at the right
ploidy. Deterministic — no RNG — so examples are stable across loads."""
from __future__ import annotations

import math

from app.models import UnifiedData, WellCycleData
from app.processing.genotype_vocab import MAX_PLOIDY, MIN_PLOIDY, validate_ploidy

# Mild FAM-side amplification bias so clusters sit off the exact d/P grid
# (exercises the skew-robust, rank-preserving caller — not a perfect ladder).
_ALPHA = 1.25
_NTC_WELLS = 4
_CYCLES = [1, 40]  # pre-read (low signal), endpoint (high signal)

# Realistic 2-D cluster spread: total signal varies well-to-well (sample DNA /
# amplification efficiency) and each channel carries independent noise, so a
# genotype forms a ROUND blob radiating from the origin — not a thin arc. Genotype
# is the fam-fraction (angle), which is magnitude-invariant, so this doesn't change
# the calls.
_MAG_SPREAD = 0.28   # +/- total-signal variation (radial)
_AXIS_NOISE = 0.045  # independent per-channel noise (makes blobs round)

_ROWS = "ABCDEFGH"
_PLATE_SIZE = 96  # a real .pcrd plate always carries the full complement of wells


def _hash01(i: int, salt: float) -> float:
    """Deterministic pseudo-random in [0,1) — stable examples without an RNG."""
    x = math.sin((i + 1) * 12.9898 + salt) * 43758.5453
    return x - math.floor(x)


def _well_ids(n: int) -> list[str]:
    """First n wells of a 96-well plate, column-major within each row (A1..H12)."""
    ids = []
    for r in _ROWS:
        for c in range(1, 13):
            ids.append(f"{r}{c}")
            if len(ids) >= n:
                return ids
    return ids


def _all_plate_wells() -> list[str]:
    """Every well on a 96-well plate, in A1..H12 order."""
    return [f"{r}{c}" for r in _ROWS for c in range(1, 13)]


def _biased_ratio(dosage: int, ploidy: int) -> float:
    x = dosage / ploidy
    return (_ALPHA * x) / (_ALPHA * x + (1 - x)) if 0 < x < 1 else x


def build_example(ploidy: int) -> UnifiedData:
    validate_ploidy(ploidy)
    classes = ploidy + 1
    per = max(6, min(12, 88 // classes))  # keep total signal wells within a plate
    n_signal = per * classes
    wells = _well_ids(n_signal + _NTC_WELLS)
    signal_wells = wells[:n_signal]
    ntc_wells = wells[n_signal:]

    data: list[WellCycleData] = []
    sample_names: dict[str, str] = {}

    idx = 0
    for d in range(ploidy, -1, -1):  # high dosage (FAM-dominant) first
        base = _biased_ratio(d, ploidy)
        for _j in range(per):
            well = signal_wells[idx]
            # per-well total magnitude (radial) + independent channel noise (round)
            mag = 1.0 + (_hash01(idx, 1.7) - 0.5) * 2 * _MAG_SPREAD
            n_fam = (_hash01(idx, 9.3) - 0.5) * 2 * _AXIS_NOISE
            n_a2 = (_hash01(idx, 5.1) - 0.5) * 2 * _AXIS_NOISE
            idx += 1
            sample_names[well] = f"d{d}/{ploidy}"
            for cyc in _CYCLES:
                scale = (0.06 if cyc == 1 else 1.0) * mag
                fam = max(base * scale + n_fam + 0.02, 0.01)
                allele2 = max((1 - base) * scale + n_a2 + 0.02, 0.01)
                data.append(WellCycleData(well=well, cycle=cyc, fam=fam, allele2=allele2, rox=1.0))

    # NTC = a small round cloud near the origin (below the relative NTC cutoff).
    for k, well in enumerate(ntc_wells):
        sample_names[well] = "NTC"
        nf = 0.03 + _hash01(1000 + k, 3.3) * 0.03
        na = 0.03 + _hash01(1000 + k, 7.7) * 0.03
        for cyc in _CYCLES:
            data.append(WellCycleData(well=well, cycle=cyc, fam=nf, allele2=na, rox=1.0))

    # A real .pcrd plate always carries the full well complement (96), and the
    # frontend Plate Setup grid renders every A1..H12 cell — so any well a user
    # might select (e.g. a whole column) must exist in this session's plate.
    # The remaining, unused wells are filled as realistic empty/low-signal wells
    # (an NTC-like round cloud near the origin) without altering the signal-well
    # genotype distributions above.
    used_wells = set(signal_wells) | set(ntc_wells)
    empty_wells = [w for w in _all_plate_wells() if w not in used_wells]
    for k, well in enumerate(empty_wells):
        # NTC-like signal (a small round cloud near the origin), but labeled
        # distinctly from the dedicated NTC wells above: these are simply the
        # rest of the physical plate that this demo assay doesn't use, not a
        # control a caller would want folded into a whole-plate NTC count.
        sample_names[well] = "Empty"
        nf = 0.02 + _hash01(2000 + k, 4.4) * 0.02
        na = 0.02 + _hash01(2000 + k, 8.8) * 0.02
        for cyc in _CYCLES:
            data.append(WellCycleData(well=well, cycle=cyc, fam=nf, allele2=na, rox=1.0))

    all_wells = sorted(set(signal_wells + ntc_wells + empty_wells))
    return UnifiedData(
        instrument=f"Example {ploidy}x",
        allele2_dye="HEX",
        wells=all_wells,
        cycles=list(_CYCLES),
        data=data,
        has_rox=True,
        sample_names=sample_names,
        ploidy=ploidy,
    )


def list_examples() -> list[dict]:
    return [{"ploidy": p, "label": f"{p}x"} for p in range(MIN_PLOIDY, MAX_PLOIDY + 1)]
