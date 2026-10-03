"""Generate matplotlib chart images for PDF reports."""
from __future__ import annotations
import io
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib import font_manager
from matplotlib.figure import Figure


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


_FONT_PATH = Path(__file__).parent / "fonts" / "NanumGothic-Regular.ttf"
_FONT_FAMILY = "NanumGothic"
_FONT_RC = {"font.family": [_FONT_FAMILY, "DejaVu Sans"]}
_ASPECTS = {"4:3": (6.4, 4.8), "1:1": (5.4, 5.4), "3:4": (6.0, 8.0)}
# orientation -> (point key on x, point key on y)
_ORIENTATIONS = {"fam_x": ("norm_fam", "norm_allele2"), "allele2_x": ("norm_allele2", "norm_fam")}
_NO_AMPLIFICATION_LABEL = "No amplification"
_NO_AMPLIFICATION_COLOR = "#9ca3af"
_NO_AMPLIFICATION_SIZE = 8
_AXIS_MARGIN = 0.05
_WELL_LABEL_LIMIT = 48
_font_registered = False


def _register_font() -> None:
    """Make the bundled NanumGothic known to matplotlib (once per process)."""
    global _font_registered
    if not _font_registered:
        font_manager.fontManager.addfont(str(_FONT_PATH))
        _font_registered = True


def literal_text(text: str) -> str:
    """Escape ``$`` so user-supplied names are never interpreted as mathtext."""
    return text.replace("$", r"\$")


def _fitted_limits(values: list[float]) -> tuple[float, float] | None:
    """Data range plus a 5% margin; no negative space unless a point is negative."""
    if not values:
        return None
    low, high = min(values), max(values)
    pad = (high - low) * _AXIS_MARGIN or 0.05
    return (max(low - pad, 0.0) if low >= 0 else low - pad), high + pad


# (dx, dy, ha, va) in points, tried in order: upper-right first, then the other corners and sides.
_LABEL_SLOTS = (
    (3, 3, "left", "bottom"), (3, -3, "left", "top"), (-3, 3, "right", "bottom"), (-3, -3, "right", "top"),
    (0, 6, "center", "bottom"), (0, -6, "center", "top"), (6, 0, "left", "center"), (-6, 0, "right", "center"),
    (9, 9, "left", "bottom"), (9, -9, "left", "top"), (-9, 9, "right", "bottom"), (-9, -9, "right", "top"),
)


def _place_well_labels(fig: Figure, ax, points: list[dict], x_key: str, y_key: str) -> None:
    """Annotate each point with its well, never letting two labels overlap.

    Collisions are tested in display coordinates. A label that collides at one slot
    moves to the next; one that fits nowhere is dropped (the point itself stays).
    Points are visited in input order and slots in a fixed order, so output is deterministic.
    """
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    placed = []
    for p in points:
        text = literal_text(str(p["well"]))
        for dx, dy, ha, va in _LABEL_SLOTS:
            label = ax.annotate(text, (p[x_key], p[y_key]), xytext=(dx, dy), textcoords="offset points",
                                fontsize=6, color="#374151", ha=ha, va=va)
            box = label.get_window_extent(renderer).expanded(1.05, 1.1)
            if any(box.overlaps(other) for other in placed):
                label.remove()
                continue
            placed.append(box)
            break


def build_scatter_figure(
    points: list[dict], allele2_dye: str = "VIC", width: float | None = None,
    height: float | None = None, ploidy: int = 2, coordinate_basis: str = "normalized",
    *, title: str | None = None, x_label: str | None = None, y_label: str | None = None,
    legend_names: dict[str, str] | None = None, aspect: str | None = None,
    orientation: str = "fam_x",
) -> Figure:
    """Build the scatter figure; the caller owns and must close it.

    ``legend_names`` maps canonical genotype strings to display names. Colours
    are always looked up by the canonical string. ``orientation`` is ``fam_x``
    (x = FAM, y = allele-2 dye) or ``allele2_x`` (axes swapped); ``x_label`` and
    ``y_label`` title the horizontal and vertical axis whichever data they hold.
    """
    if orientation not in _ORIENTATIONS:
        raise ValueError(f"orientation must be one of {sorted(_ORIENTATIONS)}")
    x_key, y_key = _ORIENTATIONS[orientation]
    if aspect is not None and aspect not in _ASPECTS:
        raise ValueError(f"aspect must be one of {sorted(_ASPECTS)}")
    if aspect is not None:
        width, height = _ASPECTS[aspect]
    _register_font()
    with plt.rc_context(_FONT_RC):
        fig, ax = plt.subplots(figsize=(width or 6, height or 4.5))

        groups: dict[str, list] = {}
        flat = [p for p in points if p.get("no_amplification")]
        for p in points:
            if not p.get("no_amplification"):
                groups.setdefault(p.get("effective_type", "Unknown"), []).append(p)

        names = legend_names or {}
        if flat:
            # Unamplified wells carry no genotype signal: quiet grey, drawn underneath.
            ax.scatter([p[x_key] for p in flat], [p[y_key] for p in flat], c=_NO_AMPLIFICATION_COLOR,
                       s=_NO_AMPLIFICATION_SIZE, alpha=0.8, zorder=1,
                       label=f"{_NO_AMPLIFICATION_LABEL} (n={len(flat)})", linewidth=0)
        for gt, pts in groups.items():
            color = genotype_color(gt, ploidy) or "#6b7280"
            xs = [p[x_key] for p in pts]
            ys = [p[y_key] for p in pts]
            ax.scatter(xs, ys, c=color, s=20, alpha=0.7, label=literal_text(f"{names.get(gt, gt)} (n={len(pts)})"),
                       edgecolors="white", linewidth=0.3, zorder=2)

        fam_default, allele2_default = f"FAM ({coordinate_basis})", f"{allele2_dye} ({coordinate_basis})"
        fam_on_x = orientation == "fam_x"
        ax.set_xlabel(literal_text(x_label or (fam_default if fam_on_x else allele2_default)), fontsize=10)
        ax.set_ylabel(literal_text(y_label or (allele2_default if fam_on_x else fam_default)), fontsize=10)
        ax.set_title(literal_text(title or "Allele Discrimination Plot"), fontsize=12,
                     fontweight="bold")
        xlim = _fitted_limits([p[x_key] for p in points])
        ylim = _fitted_limits([p[y_key] for p in points])
        if xlim and ylim:
            ax.set_xlim(*xlim)
            ax.set_ylim(*ylim)
        if groups or flat:
            # Below the plot, horizontal: never covers a point.
            ax.legend(fontsize=8, loc="upper center", bbox_to_anchor=(0.5, -0.14), borderaxespad=0,
                      ncol=2, framealpha=0.9)
        ax.grid(True, alpha=0.3)
        fig.tight_layout()
        if len(points) <= _WELL_LABEL_LIMIT:
            _place_well_labels(fig, ax, points, x_key, y_key)
    return fig


def render_scatter_png(points: list[dict], allele2_dye: str = "VIC", width: float | None = None, height: float | None = None, ploidy: int = 2, coordinate_basis: str = "normalized", **options) -> bytes:
    """Render scatter plot as PNG bytes.

    Args:
        points: list of dicts with keys: well, norm_fam, norm_allele2, effective_type
        allele2_dye: name of second allele dye
        width, height: figure size in inches (overridden by ``aspect``)
        options: ``title``, ``x_label``, ``y_label``, ``legend_names``, ``aspect``
            ("4:3" or "1:1"); see :func:`build_scatter_figure`.

    Returns:
        PNG image bytes
    """
    fig = build_scatter_figure(points, allele2_dye, width, height, ploidy, coordinate_basis, **options)
    try:
        buf = io.BytesIO()
        with plt.rc_context(_FONT_RC):
            fig.savefig(buf, format="png", dpi=150)
    finally:
        plt.close(fig)
    return buf.getvalue()


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
