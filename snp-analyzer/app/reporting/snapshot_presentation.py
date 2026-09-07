"""Format-neutral presentation of detached accepted results."""
from collections import Counter
from dataclasses import dataclass
from enum import Enum

from app.reporting.result_snapshot import ResultRow, ResultSnapshot, snapshot_rows

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
    return [ReportFigure(f"{marker.name} [{marker.marker_id}] / ploidy {marker.ploidy}",
                         marker.ploidy, figure_points([row for row in rows
                                                     if row.marker == marker]))
            for marker in snapshot.context.regions]


def report_counts(rows: list[ResultRow]) -> list[list[CellValue]]:
    counts = Counter((row.marker.marker_id if row.marker else "", row.genotype)
                     for row in rows)
    return [[marker, genotype, count] for (marker, genotype), count in counts.items()]


def report_table(snapshot: ResultSnapshot) -> tuple[list[str], list[list[CellValue]]]:
    return report_headers(snapshot), [row_values(snapshot, row) for row in snapshot_rows(snapshot)]
