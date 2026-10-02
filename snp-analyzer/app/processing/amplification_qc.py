"""No-amplification well detection from the Pre-read -> read signal rise.

Per well and channel: dRn = (dye/ROX at the read cycle) - (dye/ROX at the
Pre-read), or the raw RFU difference when normalization is off. The automatic
channel threshold is ``fraction`` times the value at the top 10% of the
positive dRn values across the whole plate; a manual threshold in the config
replaces it for that channel. A well with both channels below their thresholds
is "no amplification".
"""
import math

from app.models import AmplificationQcConfig, AmplificationQcResult, UnifiedData
from app.processing.background import baseline_cycle
from app.processing.normalize import normalize_for_cycle

TOP_FRACTION = 0.10  # the plate's strongest 10% of positive rises set the scale


def _rises(unified: UnifiedData, baseline: int, cycle: int, use_rox: bool) -> dict[str, tuple[float, float]]:
    """well -> (FAM dRn, allele-2 dRn) for wells measured at both cycles."""
    before = {p.well: p for p in normalize_for_cycle(unified, baseline, use_rox=use_rox)}
    rises = {}
    for point in normalize_for_cycle(unified, cycle, use_rox=use_rox):
        start = before.get(point.well)
        if start is None:
            continue
        rise = (point.norm_fam - start.norm_fam, point.norm_allele2 - start.norm_allele2)
        if all(math.isfinite(value) for value in rise):
            rises[point.well] = rise
    return rises


def _top_value(values: list[float]) -> float | None:
    """Smallest value inside the top 10% of the positive values; None if there are none."""
    positive = sorted((v for v in values if v > 0), reverse=True)
    if not positive:
        return None
    return positive[max(math.ceil(len(positive) * TOP_FRACTION) - 1, 0)]


def _channel_threshold(values: list[float], fraction: float, manual: float | None) -> float | None:
    if manual is not None:
        return manual
    top = _top_value(values)
    return None if top is None else fraction * top


def _amplified(rise: float, threshold: float | None) -> bool:
    return threshold is not None and rise > 0 and rise >= threshold


def _result(config: AmplificationQcConfig, **fields) -> AmplificationQcResult:
    return AmplificationQcResult(enabled=config.enabled, fraction=config.fraction, **fields)


def compute_amplification_qc(
    unified: UnifiedData,
    cycle: int,
    wells: list[str],
    config: AmplificationQcConfig,
    use_rox: bool = True,
) -> AmplificationQcResult:
    """Judge ``wells`` at ``cycle``; thresholds always come from every plate well.

    Not available (and nothing flagged) when the run has no Pre-read, when
    ``cycle`` is not after it, or when QC is switched off.
    """
    baseline = baseline_cycle(unified)
    if baseline is None or cycle <= baseline or cycle not in unified.cycles:
        return _result(config, available=False, source="off")
    if not config.enabled:
        return _result(config, available=True, source="off", baseline_cycle=baseline, read_cycle=cycle)
    rises = _rises(unified, baseline, cycle, use_rox)
    fam = _channel_threshold([r[0] for r in rises.values()], config.fraction, config.fam_threshold)
    allele2 = _channel_threshold([r[1] for r in rises.values()], config.fraction, config.allele2_threshold)
    manual = (config.fam_threshold is not None) + (config.allele2_threshold is not None)
    flagged = sorted(
        well for well in set(wells)
        if well in rises
        and not _amplified(rises[well][0], fam) and not _amplified(rises[well][1], allele2)
    )
    return _result(
        config, available=True, fam_threshold=fam, allele2_threshold=allele2,
        source=("auto", "mixed", "manual")[manual], baseline_cycle=baseline,
        read_cycle=cycle, no_amplification_wells=flagged,
    )
