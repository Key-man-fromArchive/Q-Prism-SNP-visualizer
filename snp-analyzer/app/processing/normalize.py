from app.models import NormalizedPoint, UnifiedData, WellCycleData
from app.processing.background import apply_background


PASSIVE_REFERENCE_MODE = "passive_reference"
RAW_MODE = "none"


def normalize(
    data: UnifiedData | list[WellCycleData],
    has_rox: bool | None = None,
    use_rox: bool = True,
    background: str | None = None,
) -> list[NormalizedPoint]:
    """Divide the reporters by the passive reference, if that is switched on.

    ``background`` optionally removes an instrument baseline first (default:
    nothing is removed — see app/processing/background.py). It needs the whole
    run to resolve a pre-read or a plate-wide floor, so it is applied here on
    the full UnifiedData, before any per-cycle scoping. A bare list of
    readings carries no windows and no plate context, so it is passed through
    unchanged.
    """
    if isinstance(data, UnifiedData):
        data = apply_background(data, background)
    readings, apply_normalization = _normalization_context(data, has_rox, use_rox)
    results = []
    for d in readings:
        reference_value = _normalization_value(d)
        if apply_normalization and reference_value and reference_value > 0:
            norm_fam = d.fam / reference_value
            norm_allele2 = d.allele2 / reference_value
        else:
            norm_fam = d.fam
            norm_allele2 = d.allele2
        results.append(NormalizedPoint(
            well=d.well,
            cycle=d.cycle,
            norm_fam=round(norm_fam, 6),
            norm_allele2=round(norm_allele2, 6),
            raw_fam=round(d.fam, 4),
            raw_allele2=round(d.allele2, 4),
            raw_rox=round(reference_value, 4) if reference_value is not None else None,
        ))
    return results


def normalization_applies(
    data: UnifiedData | list[WellCycleData],
    has_rox: bool | None = None,
    use_rox: bool = True,
) -> bool:
    """Whether ``normalize`` would actually divide by the passive reference.

    Asking for normalization is not the same as getting it: a run with no
    passive reference, or one whose parser recorded ``normalization_mode
    "none"``, is returned raw no matter what the caller requests. Views used to
    label their axes "FAM / ROX" straight off the request flag, which quietly
    mislabels raw RFU as normalized. This reports the decision itself so a view
    can state what the numbers ARE.
    """
    _, applied = _normalization_context(data, has_rox, use_rox)
    return applied


def normalize_for_cycle(
    data: UnifiedData | list[WellCycleData],
    cycle: int,
    has_rox: bool | None = None,
    use_rox: bool = True,
    background: str | None = None,
) -> list[NormalizedPoint]:
    if isinstance(data, UnifiedData):
        # Background first, THEN scope to the cycle: a pre-read baseline lives
        # in a different cycle than the one being asked for, and a plate floor
        # needs the run's own reads. Scoping first would leave nothing to
        # subtract against.
        data = apply_background(data, background)
        cycle_data = [d for d in data.data if d.cycle == cycle]
        scoped = data.model_copy(update={"data": cycle_data})
        return normalize(scoped, has_rox, use_rox)

    cycle_data = [d for d in data if d.cycle == cycle]
    return normalize(cycle_data, has_rox, use_rox)


def _normalization_context(
    data: UnifiedData | list[WellCycleData],
    has_rox: bool | None,
    use_rox: bool,
) -> tuple[list[WellCycleData], bool]:
    if not isinstance(data, UnifiedData):
        return data, bool(has_rox and use_rox)

    requested = use_rox
    if has_rox is not None and use_rox is True:
        requested = has_rox

    if data.normalization_mode is None:
        return data.data, bool(data.has_rox and requested)

    mode = data.normalization_mode.lower()
    if mode == RAW_MODE:
        return data.data, False
    return data.data, bool(requested and data.normalization_channel and mode == PASSIVE_REFERENCE_MODE)


def _normalization_value(reading: WellCycleData) -> float | None:
    if reading.normalization_value is not None:
        return reading.normalization_value
    return reading.rox
