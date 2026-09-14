from __future__ import annotations

import csv
import io
from uuid import UUID

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.processing.genotype_vocab import DEFAULT_PLOIDY, label_by_ratio
from app.processing.background import BackgroundMode
from app.auth import CurrentUser
from app.reporting.result_snapshot import (
    ExportOptions, ResultRow, ResultSnapshot, capture_result_snapshot, snapshot_rows,
)
from app.processing.cycle_selection import CycleMode

router = APIRouter()

# NTC / low-signal fallback is a fraction of the plate's own median total signal
# (scale-invariant), never an absolute magnitude — ROX concentration varies by kit.
_UNDETERMINED_FRAC = 0.2


def _determine_genotype(
    well: str,
    norm_fam: float,
    norm_allele2: float,
    cluster_assignments: dict[str, str],
    manual_assignments: dict[str, str],
    ploidy: int = DEFAULT_PLOIDY,
    undetermined_min: float = 0.0,
) -> str:
    """Determine effective genotype for a well.

    Priority: manual_type > auto_cluster > ratio-based fallback. The fallback is
    ploidy-aware (dosage by fam-fraction via the central vocabulary) and only
    reached when a well has neither a manual nor an auto call. ``undetermined_min``
    is a scale-relative low-signal cutoff supplied by the caller.
    """
    if well in manual_assignments:
        return manual_assignments[well]
    if well in cluster_assignments:
        return cluster_assignments[well]

    total = norm_fam + norm_allele2
    if total <= undetermined_min:
        return "Undetermined"
    return label_by_ratio(norm_fam / total, ploidy)


def _undetermined_min(points) -> float:
    """Scale-relative low-signal cutoff = a fraction of the plate median total."""
    totals = [p.norm_fam + p.norm_allele2 for p in points]
    positive = sorted(t for t in totals if t > 0)
    if not positive:
        return 0.0
    median = positive[len(positive) // 2]
    return _UNDETERMINED_FRAC * median


def _csv_text(value: object) -> object:
    """Escape spreadsheet formula text only; negative numeric RFU stays numeric."""
    if not isinstance(value, str):
        return value
    dangerous = ("=", "+", "-", "@", "＝", "＋", "－", "＠")
    if value.startswith(("\t", "\r", "\n")) or value.lstrip().startswith(dangerous):
        return "'" + value
    return value


def _csv_header(snapshot: ResultSnapshot) -> list[str]:
    dye = snapshot.unified.allele2_dye
    return (["Well"] + (["Marker"] if snapshot.context.regions else []) + [
        "Sample Name", "Genotype", "Confidence (%)", "FAM (norm)", f"{dye} (norm)",
        "FAM (raw)", f"{dye} (raw)", "ROX (raw)", "Result Revision", "Input Revision",
        "Analysed At", "Cycle", "Use ROX", "Normalization Applied", "Background",
        "Algorithm", "Scope", "Marker ID", "Ploidy", "Read Status", "Assignment Status",
        "Raw Coordinate Basis", "Passive Reference Dye", "Analysis Context",
    ])


def _csv_coordinates(row: ResultRow) -> list[object]:
    point = row.point
    if point is None:
        return [""] * 5
    return [round(point.norm_fam, 6), round(point.norm_allele2, 6),
            round(point.raw_fam, 4), round(point.raw_allele2, 4),
            round(point.raw_rox, 4) if point.raw_rox is not None else ""]


def _csv_row(snapshot: ResultSnapshot, row: ResultRow) -> list[object]:
    context = snapshot.context
    prefix: list[object] = [row.well]
    if context.regions:
        prefix.append(row.marker.name if row.marker else "")
    return prefix + [
        row.sample_name, row.genotype,
        round(row.confidence * 100, 1) if row.confidence is not None else "",
        *_csv_coordinates(row), str(context.result_revision), context.input_revision,
        context.analysed_at.isoformat(), context.cycle, context.use_rox,
        context.normalization_applied, context.background, context.algorithm,
        "whole-run", row.marker.marker_id if row.marker else "", row.ploidy,
        row.read_status,
        row.assignment_status, "post-background/pre-reference",
        snapshot.passive_reference_label,
        context.model_dump_json(),
    ]


def render_snapshot_csv(snapshot: ResultSnapshot) -> str:
    """Render exclusively from accepted copies; never re-read a live store."""
    with io.StringIO() as output:
        writer = csv.writer(output)
        writer.writerow([_csv_text(value) for value in _csv_header(snapshot)])
        for row in snapshot_rows(snapshot):
            writer.writerow([_csv_text(value) for value in _csv_row(snapshot, row)])
        return output.getvalue()


@router.get("/api/data/{sid}/export/csv")
async def export_csv(
    sid: str,
    current_user: CurrentUser,
    cycle: int | None = Query(default=None, ge=0),
    cycle_mode: CycleMode = Query(default="legacy_latest"),
    use_rox: bool | None = Query(default=None),
    background: BackgroundMode | None = Query(default=None),
    result_revision: UUID | None = Query(default=None),
) -> StreamingResponse:
    """Download the latest validated whole-run result, using stored conditions."""
    snapshot = capture_result_snapshot(
        sid, current_user, ExportOptions(result_revision, cycle, use_rox, background, cycle_mode),
    )
    content = render_snapshot_csv(snapshot)
    filename = f"snp_export_whole-run_cycle{snapshot.context.cycle}.csv"
    return StreamingResponse(
        iter([content]), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/data/{sid}/export/xlsx")
async def export_xlsx(
    sid: str,
    current_user: CurrentUser,
    use_rox: bool | None = Query(default=None),
    background: BackgroundMode | None = Query(default=None),
    cycle: int | None = Query(default=None, ge=0),
    cycle_mode: CycleMode = Query(default="legacy_latest"),
    result_revision: UUID | None = Query(default=None),
):
    from fastapi.responses import Response
    from app.reporting.snapshot_xlsx import build_snapshot_xlsx

    snapshot = capture_result_snapshot(
        sid, current_user, ExportOptions(result_revision, cycle, use_rox, background, cycle_mode),
    )
    return Response(
        build_snapshot_xlsx(snapshot),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="snp_report_whole-run_cycle{snapshot.context.cycle}.xlsx"'},
    )
