"""Optional background (baseline) subtraction — OFF by default.

The ASG-PCR run here is a KASP-like allele-specific system read at ENDPOINT:
the fluorescence at the final read *is* the measurement. There is no
amplification curve to fit and no probe being cleaved — this is not SYBR and
not a TaqMan probe — so there is no cycle that can stand in for "zero signal".
Subtracting one subtracts part of the answer, and the later a protocol starts
reading, the more of the answer it eats. Raw instrument RFU is therefore the
default, and raw is what gets parsed and stored.

Both modes below exist for the cases where a baseline genuinely helps —
reading a true amplification-curve run, or reproducing CFX Maestro's Baseline
Subtracted Curve Fit to compare against it — and both are applied at QUERY
time, on a copy. The stored data stays raw, so the choice is always
reversible; it used to be baked in at parse time and was not.

``pre_read``
    Subtract the 30 C pre-read as a flat per-well baseline. The pre-read runs
    before cycling with the DYE-TAG annealed to its quencher, so unlike any
    amplification cycle it does not move with the protocol's read schedule.
    Measured on three runs of the same assay (2026-08-24) that differ only in
    how many cycles precede the first plate read:

        protocol   cycles before 1st read   raw FAM at 1st read (Pos / NTC)
        v4         25                       4,770 / 4,293
        v7, v8     35                       10,233 / 4,688

    v8 is already fully amplified at its first read. Baselining on that read
    drops every well to ~0 and drives the best-separating cycles negative —
    the run reads as a total failure when it is the same curve as v4. Runs
    with no pre-read fall back to the first amplification cycle, which carries
    exactly that hazard; that is why it is a fallback and not the default.

``channel_min``
    Subtract a per-channel, per-cycle background FLOOR: the plate-wide minimum
    of each reporter, clamped at 0. The well with the least of a dye
    approximates zero signal for it. Cruder than a pre-read and it forces one
    well per channel to exactly 0, but it is the only option on a single
    endpoint read, which has no earlier cycle at all.

ROX is never touched by either mode. It is a passive reference used for
plate-loading normalization, and baseline-subtracting it would corrupt that.
"""

from typing import Literal

from app.models import UnifiedData, WellCycleData

BACKGROUND_NONE = "none"
BACKGROUND_PRE_READ = "pre_read"
BACKGROUND_CHANNEL_MIN = "channel_min"

BACKGROUND_MODES = (BACKGROUND_NONE, BACKGROUND_PRE_READ, BACKGROUND_CHANNEL_MIN)

# Query/request annotation, so an unknown mode is rejected at the edge with a
# 422 naming the valid ones instead of reaching apply_background as a 500.
BackgroundMode = Literal["none", "pre_read", "channel_min"]


def apply_background(data: UnifiedData, mode: str | None) -> UnifiedData:
    """Return ``data`` with ``mode``'s background removed from the reporters.

    ``None`` / ``"none"`` returns the input untouched — no copy, no cost — so
    the default path through every endpoint is exactly what it was before this
    option existed. Anything else returns a copy; the caller's UnifiedData
    (and the stored session) keeps its raw values.
    """
    if not mode or mode == BACKGROUND_NONE:
        return data
    if mode == BACKGROUND_PRE_READ:
        readings = _subtract_pre_read(data)
    elif mode == BACKGROUND_CHANNEL_MIN:
        readings = _subtract_channel_min(data)
    else:
        raise ValueError(
            f"Unknown background mode {mode!r}. Expected one of {BACKGROUND_MODES}."
        )
    return data.model_copy(update={"data": readings, "background_mode": mode})


def baseline_cycle(data: UnifiedData) -> int | None:
    """The cycle ``pre_read`` baselines against, or None if there is no data.

    The 30 C pre-read when the run has one; otherwise the first amplification
    read; otherwise the lowest cycle present.
    """
    if not data.cycles:
        return None
    for name in ("Pre-read", "Amplification"):
        for window in data.data_windows or []:
            if window.name == name:
                return window.start_cycle
    return min(data.cycles)


def _subtract_pre_read(data: UnifiedData) -> list[WellCycleData]:
    ref_cycle = baseline_cycle(data)
    if ref_cycle is None:
        return data.data

    baseline: dict[str, tuple[float, float]] = {
        d.well: (d.fam, d.allele2) for d in data.data if d.cycle == ref_cycle
    }
    out: list[WellCycleData] = []
    for d in data.data:
        bl = baseline.get(d.well)
        if bl is None:
            out.append(d)
            continue
        out.append(d.model_copy(update={"fam": d.fam - bl[0], "allele2": d.allele2 - bl[1]}))
    return out


def _subtract_channel_min(data: UnifiedData) -> list[WellCycleData]:
    # Per cycle, so an amplification run is floored read-by-read rather than
    # against whichever cycle happens to hold the plate's global minimum
    # (always the earliest one, which would make this a first-cycle baseline
    # by the back door). On a single endpoint read the two are identical.
    floors: dict[int, tuple[float, float]] = {}
    for d in data.data:
        fam_min, a2_min = floors.get(d.cycle, (d.fam, d.allele2))
        floors[d.cycle] = (min(fam_min, d.fam), min(a2_min, d.allele2))

    out: list[WellCycleData] = []
    for d in data.data:
        fam_bg, a2_bg = floors[d.cycle]
        out.append(d.model_copy(update={
            "fam": max(d.fam - fam_bg, 0.0),
            "allele2": max(d.allele2 - a2_bg, 0.0),
        }))
    return out
