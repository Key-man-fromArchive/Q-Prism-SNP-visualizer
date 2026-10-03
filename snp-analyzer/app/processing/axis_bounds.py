"""Plate-wide scatter axis bounds, shared by the API and the exported charts."""
from typing import NamedTuple

from app.models import UnifiedData
from app.processing.normalize import normalize


class AxisBounds(NamedTuple):
    fam_min: float
    fam_max: float
    allele2_min: float
    allele2_max: float
    reads: int


def plate_axis_bounds(unified: UnifiedData, use_rox: bool, background: str | None) -> AxisBounds | None:
    """Raw min/max of the normalized values over every read of every well.

    Pre-, amplification and post-reads all count, so the range does not move
    with the selected cycle. Same normalization as the scatter endpoint.
    Returns None when the run has no readings.
    """
    points = normalize(unified, use_rox=use_rox, background=background)
    if not points:
        return None
    fam = [p.norm_fam for p in points]
    allele2 = [p.norm_allele2 for p in points]
    return AxisBounds(min(fam), max(fam), min(allele2), max(allele2), len(points))
