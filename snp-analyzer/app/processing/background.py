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
    Offered only when the run actually has one — see
    ``available_background_modes``. Measured on three runs of the same assay
    (2026-08-24) that differ only in how many cycles precede the first plate
    read:

        protocol   cycles before 1st read   raw FAM at 1st read (Pos / NTC)
        v4         25                       4,770 / 4,293
        v7, v8     35                       10,233 / 4,688

    v8 is already fully amplified at its first read. Baselining on that read
    drops every well to ~0 and drives the best-separating cycles negative —
    the run reads as a total failure when it is the same curve as v4. That is
    why a run with no pre-read gets no baseline option at all: there is no
    honest stand-in for the dark state, and the nearest candidate is the
    failure above.

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


class BackgroundModeError(ValueError):
    """A background mode that this run cannot legitimately be read with.

    Subclasses ValueError so callers that just want "bad input" still catch it;
    app.main maps it to a 400 so a direct API call gets told why rather than a
    500 or, worse, a silently distorted curve.
    """


def available_background_modes(data: UnifiedData) -> list[str]:
    """The modes that are meaningful for this particular run.

    Not a UI convenience — the excluded ones actively corrupt the data:

    ``channel_min`` subtracts a per-cycle plate-wide floor, which is not a
    per-well constant, so on a multi-cycle run it changes the SHAPE of every
    curve rather than its offset. Measured on a two-well synthetic run, adding
    it on top of raw data moved one well's Ct from 6.86 to 7.03 and made the
    other's disappear entirely (9.89 -> None). It is the right tool only where
    it was originally used: a single endpoint read, which has no earlier cycle
    to baseline against at all.

    ``pre_read`` is offered only when the run actually has a 30 C pre-read.
    Without one it falls back to the first amplification cycle, and that
    fallback is precisely the hazard this module exists to document: a protocol
    that starts reading late is already amplified at its first read, so
    baselining there subtracts the result.
    """
    modes = [BACKGROUND_NONE]
    n_cycles = len(data.cycles)
    has_pre_read = any((w.name == "Pre-read") for w in (data.data_windows or []))
    if n_cycles > 1 and has_pre_read:
        modes.append(BACKGROUND_PRE_READ)
    if n_cycles == 1:
        modes.append(BACKGROUND_CHANNEL_MIN)
    return modes


def apply_background(data: UnifiedData, mode: str | None) -> UnifiedData:
    """Return ``data`` with ``mode``'s background removed from the reporters.

    ``None`` / ``"none"`` returns the input untouched — no copy, no cost — so
    the default path through every endpoint is exactly what it was before this
    option existed. Anything else returns a copy; the caller's UnifiedData
    (and the stored session) keeps its raw values.
    """
    if not mode or mode == BACKGROUND_NONE:
        return data
    if mode not in BACKGROUND_MODES:
        raise BackgroundModeError(
            f"Unknown background mode {mode!r}. Expected one of {BACKGROUND_MODES}."
        )
    allowed = available_background_modes(data)
    if mode not in allowed:
        raise BackgroundModeError(
            f"Background mode {mode!r} is not valid for this run "
            f"({len(data.cycles)} read(s)); it would distort the data rather "
            f"than baseline it. Available: {allowed}."
        )
    if mode == BACKGROUND_PRE_READ:
        readings = _subtract_pre_read(data)
    else:
        readings = _subtract_channel_min(data)
    return data.model_copy(update={"data": readings, "background_mode": mode})


def baseline_cycle(data: UnifiedData) -> int | None:
    """The cycle ``pre_read`` baselines against, or None if there is no pre-read.

    Only ever the 30 C pre-read. There is deliberately no fallback to the first
    amplification read: that fallback IS the hazard documented above, and
    ``available_background_modes`` refuses the mode outright rather than quietly
    baselining on a read that may already be fully amplified.
    """
    if not data.cycles:
        return None
    for window in data.data_windows or []:
        if window.name == "Pre-read":
            return window.start_cycle
    return None


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
