"""Format-neutral presentation of detached accepted results."""
from collections import Counter
from dataclasses import dataclass
from enum import Enum
from typing import Literal

from app.models import AlleleLabels, AnalysisRegionContext
from app.reporting.filenames import safe_filename
from app.reporting.result_snapshot import ResultRow, ResultSnapshot, snapshot_rows

# D-2: the one place to change the diploid call notation.
DIPLOID_CALL_FORMAT = "{first}/{second}"
CellValue = str | int | float | bool | None


@dataclass(frozen=True)
class ReportFigure:
    title: str
    ploidy: int
    points: list[dict[str, object]]


def report_metadata(snapshot: ResultSnapshot) -> list[tuple[str, CellValue]]:
    context = snapshot.context
    return [
        ("Scope", "whole-run"), ("File", snapshot.raw_filename),
        ("Instrument", snapshot.unified.instrument),
        ("Allele 2 dye", snapshot.unified.allele2_dye),
        ("Result Revision", str(context.result_revision)),
        ("Input Revision", context.input_revision),
        ("Analysed At", context.analysed_at.isoformat()),
        ("Analysis cycle", context.cycle), ("Use ROX", context.use_rox),
        ("Normalization Applied", context.normalization_applied),
        ("Background", context.background), ("Algorithm", context.algorithm.value if isinstance(context.algorithm, Enum) else context.algorithm),
        ("Raw Coordinate Basis", "post-background/pre-reference"),
        ("Passive Reference Dye", snapshot.passive_reference_label),
        ("Normalized Coordinate Basis", "post-background / positive passive reference when applied; raw fallback otherwise"),
    ]


def display_genotype(
    genotype: str, marker: AnalysisRegionContext | None = None,
    allele_labels: AlleleLabels | None = None,
) -> str:
    """Operator-facing diploid call text; canonical strings are never altered upstream."""
    if allele_labels is None or (marker is not None and marker.ploidy != 2):
        return genotype
    first, second = allele_labels.fam, allele_labels.allele2
    pairs = {"Allele 1 Homo": (first, first), "Heterozygous": (first, second),
             "Allele 2 Homo": (second, second)}
    if genotype not in pairs:
        return genotype
    return DIPLOID_CALL_FORMAT.format(first=pairs[genotype][0], second=pairs[genotype][1])


def polyploid_legend(allele_labels: AlleleLabels | None, allele2_dye: str) -> str | None:
    """Legend decoding the A/B letters of higher-ploidy calls."""
    if allele_labels is None:
        return None
    return f"A = {allele_labels.fam} (FAM), B = {allele_labels.allele2} ({allele2_dye})"


def axis_label(
    snapshot: ResultSnapshot, axis: Literal["fam", "allele2"],
    marker: AnalysisRegionContext | None = None,
    allele_labels: AlleleLabels | None = None,
) -> str:
    """Scatter axis title; names the allele and the normalization basis when known."""
    dye = "FAM" if axis == "fam" else snapshot.unified.allele2_dye
    if allele_labels is None:
        return f"{dye} (norm)"
    name = allele_labels.fam if axis == "fam" else allele_labels.allele2
    reference = snapshot.passive_reference_label
    basis = f"{reference}-normalized" if snapshot.context.normalization_applied else "norm"
    return f"{dye} · {name} ({basis})"


def cycle_label(snapshot: ResultSnapshot, cycle: int) -> str:
    """Read/cycle title using the instrument's read names when declared."""
    labels = snapshot.unified.read_labels
    label = labels.get(cycle) if labels else None
    if label is None:
        return str(cycle)
    if label.stage.casefold() != "amplification":
        return label.stage
    reads = sorted(c for c, item in labels.items() if item.stage == label.stage)
    parts = [f"{label.stage} {reads.index(cycle) + 1}/{len(reads)}"]
    if label.pcr_cycle is not None:
        parts.append(f"PCR {label.pcr_cycle}")
    if label.temperature is not None:
        parts.append(f"{label.temperature:g}°C")
    return " · ".join(parts)


def figure_title(snapshot: ResultSnapshot, name: str, marker: AnalysisRegionContext | None) -> str:
    """The one marker figure title: marker name, cycle label and a non-diploid ploidy."""
    cycle = snapshot.context.cycle
    labels = snapshot.unified.read_labels
    when = cycle_label(snapshot, cycle) if labels and cycle in labels else f"Cycle {cycle}"
    parts = [name, when]
    if marker is not None and marker.ploidy != 2:
        parts.append(f"{marker.ploidy}n")
    return " · ".join(parts)


def marker_scope(snapshot: ResultSnapshot, selected: bool) -> str | None:
    """Filename scope: the safe marker names of a marker selection, else None (whole run)."""
    if not selected:
        return None
    return "+".join(safe_filename(_current_name(snapshot, marker))
                    for marker in snapshot.context.regions)


def coordinate_basis(snapshot: ResultSnapshot) -> str:
    if not snapshot.context.normalization_applied:
        return "raw / post-background"
    return "reference-normalized / raw fallback"


def report_headers(snapshot: ResultSnapshot) -> list[str]:
    dye = snapshot.unified.allele2_dye
    return ["Well"] + (["Marker"] if snapshot.context.regions else []) + ["Sample Name", "Genotype", "Confidence (%)",
            "FAM (norm)", f"{dye} (norm)", "FAM (raw)", f"{dye} (raw)",
            "ROX (raw)", "Result Revision", "Cycle", "Marker ID", "Ploidy",
            "Read Status", "Assignment Status"]


def row_values(snapshot: ResultSnapshot, row: ResultRow) -> list[CellValue]:
    point = row.point
    coordinates: list[CellValue] = [None] * 5
    if point is not None:
        coordinates = [point.norm_fam, point.norm_allele2, point.raw_fam,
                       point.raw_allele2, point.raw_rox]
    prefix: list[CellValue] = [row.well]
    if snapshot.context.regions:
        prefix.append(row.marker.name if row.marker else "")
    return prefix + [row.sample_name,
            row.genotype, round(row.confidence * 100, 1) if row.confidence is not None else None,
            *coordinates, str(snapshot.context.result_revision), snapshot.context.cycle,
            row.marker.marker_id if row.marker else "", row.ploidy,
            row.read_status, row.assignment_status]


def figure_points(rows: list[ResultRow]) -> list[dict[str, object]]:
    return [{"well": row.well, "norm_fam": row.point.norm_fam,
             "norm_allele2": row.point.norm_allele2, "effective_type": row.genotype}
            for row in rows if row.point is not None]


def report_figures(snapshot: ResultSnapshot, rows: list[ResultRow]) -> list[ReportFigure]:
    if not snapshot.context.regions:
        return [ReportFigure("Whole-run", snapshot.result.ploidy, figure_points(rows))]
    return [ReportFigure(figure_title(snapshot, _current_name(snapshot, marker), marker),
                         marker.ploidy, figure_points([row for row in rows
                                                     if row.marker and row.marker.marker_id == marker.marker_id]))
            for marker in snapshot.context.regions]


def _current_name(snapshot: ResultSnapshot, marker: AnalysisRegionContext) -> str:
    label = snapshot.marker_labels.get(marker.marker_id)
    return label.name if label else marker.name


def report_counts(rows: list[ResultRow]) -> list[list[CellValue]]:
    counts = Counter((row.marker.marker_id if row.marker else "", row.genotype)
                     for row in rows)
    return [[marker, genotype, count] for (marker, genotype), count in counts.items()]


def report_table(snapshot: ResultSnapshot) -> tuple[list[str], list[list[CellValue]]]:
    return report_headers(snapshot), [row_values(snapshot, row) for row in snapshot_rows(snapshot)]
