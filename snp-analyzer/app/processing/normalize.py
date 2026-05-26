from app.models import NormalizedPoint, UnifiedData, WellCycleData


PASSIVE_REFERENCE_MODE = "passive_reference"
RAW_MODE = "none"


def normalize(
    data: UnifiedData | list[WellCycleData],
    has_rox: bool | None = None,
    use_rox: bool = True,
) -> list[NormalizedPoint]:
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


def normalize_for_cycle(
    data: UnifiedData | list[WellCycleData],
    cycle: int,
    has_rox: bool | None = None,
    use_rox: bool = True,
) -> list[NormalizedPoint]:
    if isinstance(data, UnifiedData):
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
