"""Where the fam-fraction ratio is measured from, on raw endpoint data.

Every genotype call in this codebase is a ratio: ``fam / (fam + allele2)``,
compared against radial boundary cuts (``cluster_threshold``, ``cluster_auto``,
``genotype_window``, and the draggable lines in the scatter plots). A ratio is
an angle measured from an origin, and it is only meaningful if that origin is
where "no signal" actually sits.

On raw KASP-like endpoint data it is not. Both reporter channels carry an
optical background of roughly 2000-4000 RFU, and a common offset on both axes
pulls every angle toward 45 degrees. Measured on a real endpoint plate:

    well              raw            ratio from (0,0)   ratio from NTC origin
    A1  FAM-dominant  3351 / 2402    0.582              0.798
    G1  HEX-leaning   3162 / 2841    0.527              0.367
    separation                       0.056              0.43

The clusters are still there — the two wells are separated in x and y — but
measured from (0, 0) they occupy a 3-degree wedge, and no set of boundary cuts
resolves them. The relative-NTC detector fails the same way: an NTC well's raw
total is ~0.9x the plate median, never the ~0.2x it is looking for.

The plate's own no-template wells mark the true origin, so that is what the
ratio is measured from. This shifts the CALLING geometry only. Displayed
values, exported values and stored values stay raw — see
``app/processing/background.py`` for why they must.

With no NTC well known, the origin has to be estimated from the plate itself,
and the estimator has to survive a single bad well. The per-channel MINIMUM
does not: on a 96-well CFX plate
(``1-2_admin_2026-09-03 16-14-11_783BR20183.pcrd``) it landed on H1, itself a
failed well, and the resulting shift dropped a quarter of the plate below the
relative no-signal cutoff. Under passive-reference normalization it was worse
— one well whose ROX read 1.73x the plate median became the minimum in BOTH
channels, so that single well defined the origin and the no-signal count
swung from 25 wells to 1 purely on the normalization toggle. A low QUANTILE
over wells with a sane passive reference is the same estimate with none of
that leverage, and it is reported as ``plate_floor`` so a view can say what it
is rather than imply an NTC it never saw.
"""

from statistics import median

from app.models import RatioOrigin

# Per-channel quantile standing in for the plate's no-signal floor when no NTC
# well is known. Low enough to sit under the dimmest real sample, high enough
# that no single well decides it.
_ORIGIN_QUANTILE = 0.05

# Below this many wells a 5th percentile is interpolated between two or three
# readings and means nothing more than the minimum does — so it stays the
# minimum, and stays labelled as the weaker claim it has always been.
_MIN_WELLS_FOR_QUANTILE = 8

# A passive-reference read this far from the plate median is a physically
# abnormal well (bubble, volume error, dispensing miss), not a dim sample.
# Such a well is excluded from the floor estimate in BOTH modes: normalized,
# its inflated reference divides its reporters down into the floor; raw, its
# reporters are suspect for the same underlying reason.
_ROX_SANE_RANGE = (1 / 1.5, 1.5)


def compute_ratio_origin(points, ntc_wells) -> RatioOrigin:
    """Locate the ratio origin for one cycle's ``NormalizedPoint`` list.

    Prefers the median of the plate's no-template wells — median, not mean, so
    one contaminated NTC cannot drag the origin. With no NTC well known, falls
    back to a per-channel low quantile of the plate, which is a weaker claim
    (the dimmest wells are not necessarily background) and is reported as such
    via ``source`` rather than passed off as an NTC origin.
    """
    if not points:
        return RatioOrigin()

    ntc = [p for p in points if p.well in (ntc_wells or set())]
    if ntc:
        return RatioOrigin(
            fam=median(p.norm_fam for p in ntc),
            allele2=median(p.norm_allele2 for p in ntc),
            source="ntc",
        )

    candidates = _floor_candidates(points)
    if len(candidates) >= _MIN_WELLS_FOR_QUANTILE:
        return RatioOrigin(
            fam=_quantile([p.norm_fam for p in candidates], _ORIGIN_QUANTILE),
            allele2=_quantile([p.norm_allele2 for p in candidates], _ORIGIN_QUANTILE),
            source="plate_floor",
        )

    return RatioOrigin(
        fam=min(p.norm_fam for p in candidates),
        allele2=min(p.norm_allele2 for p in candidates),
        source="plate_min",
    )


def rox_outlier_wells(points) -> set[str]:
    """Wells whose passive reference is too far from the plate median to trust.

    Reported separately from the origin so QC can name them: on the plate this
    guard was written for, A11's reference read 7380 against a plate median of
    4263 (1.73x), and normalizing by it pushed that one well below every other
    well in both channels.
    """
    refs = [(p.well, p.raw_rox) for p in points if p.raw_rox]
    if len(refs) < _MIN_WELLS_FOR_QUANTILE:
        return set()
    plate = median(value for _, value in refs)
    if plate <= 0:
        return set()
    low, high = _ROX_SANE_RANGE
    return {well for well, value in refs if not low <= value / plate <= high}


def _floor_candidates(points) -> list:
    """``points`` minus the passive-reference outliers, when enough remain.

    Dropping the outliers must never shrink the plate below the point where a
    quantile is meaningful — a run where most references are odd is a run whose
    references carry no information, so all wells are kept and the estimate
    degrades to what it was before rather than to a handful of wells.
    """
    outliers = rox_outlier_wells(points)
    if not outliers:
        return list(points)
    kept = [p for p in points if p.well not in outliers]
    return kept if len(kept) >= _MIN_WELLS_FOR_QUANTILE else list(points)


def _quantile(values: list[float], q: float) -> float:
    """Linear-interpolated quantile (``statistics.quantiles`` needs n >= 2 and
    only exposes cut points, not an arbitrary q)."""
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    pos = q * (len(ordered) - 1)
    lower = int(pos)
    if lower + 1 >= len(ordered):
        return ordered[-1]
    return ordered[lower] + (pos - lower) * (ordered[lower + 1] - ordered[lower])


def shift_to_origin(point_dicts: list[dict], origin: RatioOrigin) -> list[dict]:
    """Re-express clustering input relative to ``origin``, clamped at 0.

    Clamping matters: it puts the no-template wells at (0, 0), which is what
    makes the NTC detectors — absolute ``ntc_threshold`` and the relative
    plate-median one — see them as no-signal again. A well dimmer than the NTC
    origin in one channel has no signal there to measure a ratio from anyway.
    """
    if origin.fam == 0.0 and origin.allele2 == 0.0:
        return point_dicts
    return [
        {
            **p,
            "norm_fam": max(p["norm_fam"] - origin.fam, 0.0),
            "norm_allele2": max(p["norm_allele2"] - origin.allele2, 0.0),
        }
        for p in point_dicts
    ]


def shift_points_to_origin(points: list, origin: RatioOrigin) -> list:
    """``shift_to_origin`` for ``NormalizedPoint`` objects.

    Only ``norm_fam`` / ``norm_allele2`` move — the ``raw_*`` fields keep the
    instrument's own numbers, so anything reporting or exporting raw values is
    unaffected. Used by QC, where the plate's median total signal sets every
    threshold: measured from (0, 0) on raw endpoint data that median is mostly
    optical background, which puts an NTC well at ~0.9x the median and would
    flag a clean plate as contaminated on every run.
    """
    if origin.fam == 0.0 and origin.allele2 == 0.0:
        return points
    return [
        p.model_copy(update={
            "norm_fam": max(p.norm_fam - origin.fam, 0.0),
            "norm_allele2": max(p.norm_allele2 - origin.allele2, 0.0),
        })
        for p in points
    ]
