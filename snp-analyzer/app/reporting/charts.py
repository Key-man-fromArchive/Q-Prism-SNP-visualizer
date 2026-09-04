"""Generate matplotlib chart images for PDF reports."""
from __future__ import annotations
import io
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np


# Non-genotype well categories. Fixed across ploidy, like the frontend's
# WELL_TYPE_INFO.
CONTROL_COLORS = {
    "NTC": "#9ca3af",
    "Undetermined": "#f59e0b",
    "Unknown": "#6b7280",
    "Positive Control": "#8b5cf6",
}

# Kept for callers that only ever deal with a diploid plate.
GENOTYPE_COLORS = {
    "Allele 1 Homo": "#2563eb",
    "Allele 2 Homo": "#dc2626",
    "Heterozygous": "#16a34a",
    **CONTROL_COLORS,
}

# Ordered dosage palette, mirroring frontend/src/lib/genotype.ts. Two arms
# stepped in OKLCH -- red for the allele-2 pole, blue for the allele-1 pole --
# with the balanced class of an even ploidy in green.
#
# This map used to be diploid-only, so on a polyploid plate every dosage class
# ("AAABBB", "AABBBB", ...) missed it and fell through to the same grey default:
# the exported report showed one colour for what the analysis had resolved into
# up to nine classes. See the frontend module for why the ramp is shaped this
# way and why grey is not available as a midpoint.
_RED_ARM = ["#76221d", "#892c26", "#9e342e", "#b14038", "#c74940", "#d7584e", "#dd7166", "#e4857b"]
_BLUE_ARM = ["#0d366b", "#104281", "#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#5598e7", "#6da7ec"]
_BALANCED = "#10b981"
_DIPLOID = ["#dc2626", "#16a34a", "#2563eb"]


def _arm_steps(arm: list[str], n: int) -> list[str]:
    if n <= 0:
        return []
    if n == 1:
        return [arm[0]]
    return [arm[round(i * (len(arm) - 1) / (n - 1))] for i in range(n)]


def dosage_palette(ploidy: int) -> list[str]:
    """Colour per dosage 0..ploidy, in dosage order."""
    if ploidy == 2:
        return list(_DIPLOID)
    even = ploidy % 2 == 0
    per_arm = ploidy // 2 if even else (ploidy + 1) // 2
    low = _arm_steps(_RED_ARM, per_arm)
    high = list(reversed(_arm_steps(_BLUE_ARM, per_arm)))
    return [*low, _BALANCED, *high] if even else [*low, *high]


def genotype_color(label: str, ploidy: int) -> str | None:
    """Colour for any assignment string, or None when it is not a known type."""
    from app.processing.genotype_vocab import dosage_of_label

    dosage = dosage_of_label(label, ploidy)
    if dosage is not None:
        return dosage_palette(ploidy)[dosage]
    return CONTROL_COLORS.get(label)


def render_scatter_png(points: list[dict], allele2_dye: str = "VIC", width: float = 6, height: float = 4.5, ploidy: int = 2) -> bytes:
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
        color = genotype_color(gt, ploidy) or "#6b7280"
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


def render_plate_png(wells: list[dict], width: float = 7, height: float = 4, ploidy: int = 2) -> bytes:
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
        color = genotype_color(gt, ploidy) or "#d0d0d0"
        circle = plt.Circle((col + 0.5, 7.5 - row), 0.35, facecolor=color, edgecolor="white", linewidth=0.5, alpha=0.8)
        ax.add_patch(circle)

    # Row labels
    for r in range(8):
        ax.text(-0.2, 7.5 - r, chr(65 + r), ha="center", va="center", fontsize=9, fontweight="bold", color="#666")
    # Col labels
    for c in range(12):
        ax.text(c + 0.5, 8.2, str(c + 1), ha="center", va="center", fontsize=8, color="#666")

    # Legend: this plate's own dosage classes, not a fixed diploid trio. It
    # listed the same three genotype names whatever the ploidy, so a hexaploid
    # plate's report named none of the classes it was actually showing.
    from app.processing.genotype_vocab import genotype_labels

    handles = [
        mpatches.Patch(color=color, label=label)
        for label, color in zip(genotype_labels(ploidy), dosage_palette(ploidy))
    ]
    handles += [mpatches.Patch(color=color, label=label) for label, color in CONTROL_COLORS.items()]
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
