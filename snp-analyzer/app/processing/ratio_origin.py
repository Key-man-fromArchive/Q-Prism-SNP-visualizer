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
"""

from statistics import median

from app.models import RatioOrigin


def compute_ratio_origin(points, ntc_wells) -> RatioOrigin:
    """Locate the ratio origin for one cycle's ``NormalizedPoint`` list.

    Prefers the median of the plate's no-template wells — median, not mean, so
    one contaminated NTC cannot drag the origin. With no NTC well known, falls
    back to the per-channel plate-wide minimum, which is a weaker claim (the
    dimmest sample is not necessarily background) and is reported as such via
    ``source`` rather than passed off as an NTC origin.
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

    return RatioOrigin(
        fam=min(p.norm_fam for p in points),
        allele2=min(p.norm_allele2 for p in points),
        source="plate_min",
    )


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
