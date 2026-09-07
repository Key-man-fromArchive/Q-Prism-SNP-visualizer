"""Physical plate rendering, with captured per-well ploidy and complete extent."""
import io

import matplotlib.pyplot as plt

from app.reporting.charts import genotype_color
from app.reporting.result_snapshot import ResultRow


def render_snapshot_plate(rows: list[ResultRow]) -> bytes:
    height = max(8, max(ord(row.well[0]) - 64 for row in rows))
    width = max(12, max(int(row.well[1:]) for row in rows))
    figure, axes = plt.subplots(figsize=(12, 7))
    try:
        for row in rows:
            color = genotype_color(row.genotype, row.ploidy or 2) or "#d1d5db"
            axes.scatter(int(row.well[1:]), ord(row.well[0]) - 64,
                         c=color, s=110 if width > 12 else 260, edgecolors="white")
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
