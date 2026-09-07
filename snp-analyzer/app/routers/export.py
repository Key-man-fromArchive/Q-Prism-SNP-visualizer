from __future__ import annotations

import csv
import io
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.models import UnifiedData
from app.processing.genotype_vocab import DEFAULT_PLOIDY, label_by_ratio
from app.processing.background import BackgroundMode
from app.processing.normalize import normalize_for_cycle
from app.processing.ratio_origin import shift_points_to_origin
from app.routers.upload import sessions
from app.routers.clustering import cluster_store, welltype_store, ratio_origin_for
from app.auth import CurrentUser, check_session_access
from app.reporting.result_snapshot import (
    ExportOptions, ResultRow, ResultSnapshot, capture_result_snapshot, snapshot_rows,
)

router = APIRouter()

# NTC / low-signal fallback is a fraction of the plate's own median total signal
# (scale-invariant), never an absolute magnitude — ROX concentration varies by kit.
_UNDETERMINED_FRAC = 0.2


def _get_session(sid: str) -> UnifiedData:
    if sid not in sessions:
        raise HTTPException(404, "Session not found")
    return sessions[sid]


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
    use_rox: bool | None = Query(default=None),
    background: BackgroundMode | None = Query(default=None),
    result_revision: UUID | None = Query(default=None),
) -> StreamingResponse:
    """Download the latest validated whole-run result, using stored conditions."""
    snapshot = capture_result_snapshot(
        sid, current_user, ExportOptions(result_revision, cycle, use_rox, background),
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
    use_rox: bool = Query(default=True),
    background: BackgroundMode = Query(default="none"),
):
    """XLSX workbook: Summary sheet (embedded allele-discrimination plot +
    metadata + QC) and a Results sheet with the full genotype table."""
    from collections import Counter
    from fastapi.responses import Response
    from app.processing.genotype import count_genotypes, get_effective_types
    from app.reporting.xlsx_builder import build_xlsx

    check_session_access(sid, current_user)
    unified = _get_session(sid)

    # Use the analysed cycle (where clustering was computed) so the plot matches
    # the on-screen result; fall back to the last cycle.
    analysed = cluster_store[sid].cycle if sid in cluster_store else 0
    cycle = analysed if analysed and analysed in unified.cycles else max(unified.cycles)

    points = normalize_for_cycle(unified, cycle, use_rox=use_rox, background=background)
    # The exported columns are the values as measured. The genotype fallback and
    # the low-signal cutoff are ratios, so they are computed against the plate's
    # own no-signal origin instead of (0, 0) -- see app/processing/ratio_origin.py.
    called = {
        p.well: p
        for p in shift_points_to_origin(
            points, ratio_origin_for(sid, unified, points)
        )
    }
    cluster_assignments = cluster_store[sid].assignments if sid in cluster_store else {}
    confidences = (cluster_store[sid].confidences or {}) if sid in cluster_store else {}
    regions = cluster_store[sid].regions if sid in cluster_store else None
    manual_assignments = welltype_store.get(sid, {})
    sample_names = unified.sample_names or {}

    ploidy = getattr(unified, "ploidy", 2)
    effective_types = get_effective_types(cluster_assignments, manual_assignments, unified.wells)
    genotype_counts = count_genotypes(effective_types, ploidy)

    # A2: multi-marker plate -- each well's genotype uses its OWN marker's
    # ploidy vocabulary, and the pooled genotype_counts above (one binning
    # across every marker) is NOT authoritative -- replace it with a
    # per-marker-prefixed breakdown. Single-marker (regions is None) sessions
    # build empty maps and keep the pooled genotype_counts exactly as before.
    well_marker: dict[str, str] = {}
    well_ploidy: dict[str, int] = {}
    if regions:
        for r in regions:
            for w in r.wells:
                well_marker[w] = r.name
                well_ploidy[w] = r.ploidy
        marker_counts: dict[str, int] = {}
        for r in regions:
            r_effective = get_effective_types(r.assignments, manual_assignments, r.wells)
            for gt, n in count_genotypes(r_effective, r.ploidy).items():
                marker_counts[f"{r.name}: {gt}"] = n
        genotype_counts = marker_counts

    scatter_points: list[dict] = []
    table_rows: list[list] = []
    umin = _undetermined_min(called.values())
    for p in sorted(points, key=lambda pt: (pt.well[0], int(pt.well[1:]))):
        well_gt_ploidy = well_ploidy.get(p.well, ploidy)
        gt = _determine_genotype(
            p.well, called[p.well].norm_fam, called[p.well].norm_allele2,
            cluster_assignments, manual_assignments, well_gt_ploidy, umin
        )
        scatter_points.append({
            "well": p.well,
            "norm_fam": p.norm_fam,
            "norm_allele2": p.norm_allele2,
            "effective_type": gt,
        })
        conf = confidences.get(p.well)
        row: list[object] = [p.well]
        if regions:
            row.append(well_marker.get(p.well, ""))
        row += [
            sample_names.get(p.well, ""),
            gt,
            round(conf * 100, 1) if conf is not None else "",
            round(p.norm_fam, 6),
            round(p.norm_allele2, 6),
            round(p.raw_fam, 4),
            round(p.raw_allele2, 4),
            round(p.raw_rox, 4) if p.raw_rox is not None else "",
        ]
        table_rows.append(row)

    headers: list[str] = ["Well"]
    if regions:
        headers.append("Marker")
    headers += [
        "Sample Name", "Genotype", "Confidence (%)",
        "FAM (norm)", f"{unified.allele2_dye} (norm)",
        "FAM (raw)", f"{unified.allele2_dye} (raw)", "ROX (raw)",
    ]
    counts = Counter(gt for gt in effective_types.values())
    n_called = sum(c for g, c in counts.items() if g not in ("Undetermined", "NTC", "Unknown"))
    n_total = len(unified.wells)
    qc: dict[str, object] = {
        "Total wells": n_total,
        "Called": n_called,
        "Call rate (%)": round(n_called / n_total * 100, 1) if n_total else 0,
    }

    filename = ""
    try:
        from app.db import get_db
        db_row = get_db().execute(
            "SELECT raw_filename FROM sessions WHERE session_id = ?", (sid,)
        ).fetchone()
        if db_row:
            filename = db_row["raw_filename"] or ""
    except Exception:
        pass

    xlsx_bytes = build_xlsx(
        instrument=unified.instrument,
        allele2_dye=unified.allele2_dye,
        cycle=cycle,
        filename=filename,
        scatter_points=scatter_points,
        table_headers=headers,
        table_rows=table_rows,
        genotype_counts=genotype_counts,
        qc=qc,
    )
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="snp_report_cycle{cycle}.xlsx"'},
    )
