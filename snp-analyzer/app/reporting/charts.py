"""Generate matplotlib chart images for PDF reports."""
from __future__ import annotations
import io
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np


# Genotype color map matching frontend
GENOTYPE_COLORS = {
    "Allele 1 Homo": "#dc2626",
    "Allele 2 Homo": "#2563eb",
    "Heterozygous": "#16a34a",
    "NTC": "#9ca3af",
    "Undetermined": "#f59e0b",
    "Unknown": "#6b7280",
    "Positive Control": "#8b5cf6",
}


def render_scatter_png(points: list[dict], allele2_dye: str = "VIC", width: float = 6, height: float = 4.5) -> bytes:
    """Render scatter plot as PNG bytes.

    Args:
        points: list of dicts with keys: well, norm_fam, norm_allele2, effective_type
        allele2_dye: name of second allele dye
        width, height: figure size in inches

    Returns:
        PNG image bytes
    """
    fig, ax = plt.subplots(figsize=(width, height))

    # Group by genotype for coloring
    groups: dict[str, list] = {}
    for p in points:
        gt = p.get("effective_type", "Unknown")
        groups.setdefault(gt, []).append(p)

    for gt, pts in groups.items():
        color = GENOTYPE_COLORS.get(gt, "#6b7280")
        xs = [p["norm_allele2"] for p in pts]
        ys = [p["norm_fam"] for p in pts]
        ax.scatter(xs, ys, c=color, s=20, alpha=0.7, label=gt, edgecolors="white", linewidth=0.3)

    ax.set_xlabel(f"{allele2_dye} (normalized)", fontsize=10)
    ax.set_ylabel("FAM (normalized)", fontsize=10)
    ax.set_title("Allele Discrimination Plot", fontsize=12, fontweight="bold")
    ax.legend(fontsize=8, loc="upper right", framealpha=0.9)
    ax.grid(True, alpha=0.3)

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150)
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def render_plate_png(wells: list[dict], width: float = 7, height: float = 4) -> bytes:
    """Render 96-well plate view as PNG bytes.

    Args:
        wells: list of dicts with keys: well, row, col, effective_type

    Returns:
        PNG image bytes
    """
    fig, ax = plt.subplots(figsize=(width, height))

    # Draw plate grid
    for r in range(8):
        for c in range(12):
            ax.add_patch(plt.Circle((c + 0.5, 7.5 - r), 0.35, fill=False, edgecolor="#d0d0d0", linewidth=0.5))

    # Fill wells with data
    for w in wells:
        row = w.get("row", 0)
        col = w.get("col", 0)
        gt = w.get("effective_type", "Unknown")
        color = GENOTYPE_COLORS.get(gt, "#d0d0d0")
        circle = plt.Circle((col + 0.5, 7.5 - row), 0.35, facecolor=color, edgecolor="white", linewidth=0.5, alpha=0.8)
        ax.add_patch(circle)

    # Row labels
    for r in range(8):
        ax.text(-0.2, 7.5 - r, chr(65 + r), ha="center", va="center", fontsize=9, fontweight="bold", color="#666")
    # Col labels
    for c in range(12):
        ax.text(c + 0.5, 8.2, str(c + 1), ha="center", va="center", fontsize=8, color="#666")

    # Legend
    handles = []
    for gt, color in GENOTYPE_COLORS.items():
        handles.append(mpatches.Patch(color=color, label=gt))
    ax.legend(handles=handles, fontsize=7, loc="lower center", bbox_to_anchor=(0.5, -0.18), ncol=4, framealpha=0.9)

    ax.set_xlim(-0.5, 12.5)
    ax.set_ylim(-0.5, 9)
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_title("Plate View", fontsize=12, fontweight="bold")

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf.read()
