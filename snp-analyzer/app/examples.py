"""Synthetic example datasets for demoing genotyping at each ploidy (2x–8x).

Each example is a full-spectrum plate: the P+1 dosage classes at fam-fractions
near ``d/P`` (with a mild, realistic dye/amplification skew and deterministic
per-well noise), plus a few NTC wells and two cycles (a low pre-read and a
high endpoint). ``ploidy`` is set on the session so the UI opens at the right
ploidy. Deterministic — no RNG — so examples are stable across loads."""
from __future__ import annotations

from app.models import UnifiedData, WellCycleData
from app.processing.genotype_vocab import MAX_PLOIDY, MIN_PLOIDY, validate_ploidy

# Mild FAM-side amplification bias so clusters sit off the exact d/P grid
# (exercises the skew-robust, rank-preserving caller — not a perfect ladder).
_ALPHA = 1.25
_NTC_WELLS = 3
_CYCLES = [1, 40]  # pre-read (low signal), endpoint (high signal)

_ROWS = "ABCDEFGH"


def _well_ids(n: int) -> list[str]:
    """First n wells of a 96-well plate, column-major within each row (A1..H12)."""
    ids = []
    for r in _ROWS:
        for c in range(1, 13):
            ids.append(f"{r}{c}")
            if len(ids) >= n:
                return ids
    return ids


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
        for j in range(per):
            well = signal_wells[idx]
            idx += 1
            r = min(max(base + (j - per / 2) * 0.004, 0.02), 0.98)
            sample_names[well] = f"d{d}/{ploidy}"
            for cyc in _CYCLES:
                scale = 0.08 if cyc == 1 else 1.0
                data.append(
                    WellCycleData(
                        well=well,
                        cycle=cyc,
                        fam=r * scale + 0.01,
                        allele2=(1 - r) * scale + 0.01,
                        rox=1.0,
                    )
                )

    for well in ntc_wells:
        sample_names[well] = "NTC"
        for cyc in _CYCLES:
            data.append(WellCycleData(well=well, cycle=cyc, fam=0.01, allele2=0.01, rox=1.0))

    all_wells = sorted(set(signal_wells + ntc_wells))
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
