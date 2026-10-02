"""Physical plate rendering, with captured per-well ploidy and complete extent."""
import io
from collections.abc import Mapping

import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

from app.reporting.charts import _FONT_FAMILY, _register_font, genotype_color, literal_text
from app.reporting.result_snapshot import ResultRow

_DIM_ALPHA = 0.2


def _draw_marker_boundaries(axes, rows: list[ResultRow], layout: Mapping[str, str]) -> None:
    """Outline each marker's wells and print its abbreviation above the box."""
    extents: dict[str, list[int]] = {}
    for row in rows:
        if row.marker is None or row.marker.marker_id not in layout:
            continue
        col, line = int(row.well[1:]), ord(row.well[0]) - 64
        box = extents.setdefault(row.marker.marker_id, [col, col, line, line])
        box[:] = [min(box[0], col), max(box[1], col), min(box[2], line), max(box[3], line)]
    for marker_id, (c0, c1, r0, r1) in extents.items():
        axes.add_patch(Rectangle((c0 - 0.5, r0 - 0.5), c1 - c0 + 1, r1 - r0 + 1, fill=False,
                                 edgecolor="#374151", linewidth=1.2, linestyle="--"))
        axes.text(c0 - 0.45, r0 - 0.55, literal_text(layout[marker_id]), fontsize=8, va="bottom",
                  ha="left", color="#111827", fontfamily=[_FONT_FAMILY, "DejaVu Sans"])


def render_snapshot_plate(rows: list[ResultRow], *,
                          marker_layout: Mapping[str, str] | None = None,
                          highlight_marker_id: str | None = None) -> bytes:
    """Plate map coloured by assignment.

    ``marker_layout`` maps marker_id to its short label; each marker's wells are
    outlined and labelled. ``highlight_marker_id`` dims every other marker's wells.
    """
    height = max(8, max(ord(row.well[0]) - 64 for row in rows))
    width = max(12, max(int(row.well[1:]) for row in rows))
    if marker_layout:
        _register_font()
    figure, axes = plt.subplots(figsize=(12, 7))
    try:
        for row in rows:
            color = genotype_color(row.genotype, row.ploidy or 2) or "#d1d5db"
            options = {}
            if highlight_marker_id is not None:
                is_target = row.marker is not None and row.marker.marker_id == highlight_marker_id
                options["alpha"] = 1.0 if is_target else _DIM_ALPHA
            axes.scatter(int(row.well[1:]), ord(row.well[0]) - 64,
                         c=color, s=110 if width > 12 else 260, edgecolors="white", **options)
        if marker_layout:
            _draw_marker_boundaries(axes, rows, marker_layout)
        axes.set(xlim=(0.3, width + 0.7), ylim=(height + 0.7, 0.3),
                 xticks=list(range(1, width + 1)), yticks=list(range(1, height + 1)))
        axes.set_yticklabels([chr(65 + index) for index in range(height)])
        axes.set_aspect("equal")
        axes.set_title("Plate view / whole-run / stored assignments")
        output = io.BytesIO()
        figure.savefig(output, format="png", dpi=150, bbox_inches="tight")
        return output.getvalue()
    finally:
        plt.close(figure)
