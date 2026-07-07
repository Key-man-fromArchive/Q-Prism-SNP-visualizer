from __future__ import annotations

import csv
import io

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.models import UnifiedData
from app.processing.normalize import normalize_for_cycle
from app.routers.upload import sessions
from app.routers.clustering import cluster_store, welltype_store
from app.auth import CurrentUser, check_session_access

router = APIRouter()

# Genotype determination threshold (total normalized signal)
_UNDETERMINED_THRESHOLD = 0.1


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
) -> str:
    """Determine effective genotype for a well.

    Priority: manual_type > auto_cluster > ratio-based fallback.
    """
    # 1. Manual type takes highest priority
    if well in manual_assignments:
        return manual_assignments[well]

    # 2. Auto-cluster assignment
    if well in cluster_assignments:
        return cluster_assignments[well]

    # 3. Ratio-based fallback
    total = norm_fam + norm_allele2
    if total <= _UNDETERMINED_THRESHOLD:
        return "Undetermined"

    ratio = norm_fam / total
    if ratio > 0.6:
        return "Allele 1 Homo"
    elif ratio < 0.4:
        return "Allele 2 Homo"
    else:
        return "Heterozygous"


@router.get("/api/data/{sid}/export/csv")
async def export_csv(
    sid: str,
    current_user: CurrentUser,
    cycle: int = Query(default=0),
    use_rox: bool = Query(default=True),
):
    """Export scatter data as a downloadable CSV file."""
    check_session_access(sid, current_user)
    unified = _get_session(sid)

    if cycle <= 0:
        cycle = max(unified.cycles)

    if cycle not in unified.cycles:
        raise HTTPException(
            400,
            f"Cycle {cycle} not available. Range: {unified.cycles[0]}-{unified.cycles[-1]}",
        )

    points = normalize_for_cycle(unified, cycle, use_rox=use_rox)

    cluster_assignments: dict[str, str] = {}
    confidences: dict[str, float] = {}
    if sid in cluster_store:
        cluster_assignments = cluster_store[sid].assignments
        confidences = cluster_store[sid].confidences or {}
    manual_assignments = welltype_store.get(sid, {})

    sample_names = unified.sample_names or {}

    # Build CSV in memory
    output = io.StringIO()
    writer = csv.writer(output)

    # Header row
    writer.writerow([
        "Well",
        "Sample Name",
        "Genotype",
        "Confidence (%)",
        "FAM (norm)",
        f"{unified.allele2_dye} (norm)",
        "FAM (raw)",
        f"{unified.allele2_dye} (raw)",
        "ROX (raw)",
    ])

    # Data rows (sorted by well for consistent output)
    for p in sorted(points, key=lambda pt: (pt.well[0], int(pt.well[1:]))):
        genotype = _determine_genotype(
            p.well, p.norm_fam, p.norm_allele2,
            cluster_assignments, manual_assignments,
        )
        conf = confidences.get(p.well)
        writer.writerow([
            p.well,
            sample_names.get(p.well, ""),
            genotype,
            round(conf * 100, 1) if conf is not None else "",
            round(p.norm_fam, 6),
            round(p.norm_allele2, 6),
            round(p.raw_fam, 4),
            round(p.raw_allele2, 4),
            round(p.raw_rox, 4) if p.raw_rox is not None else "",
        ])

    csv_content = output.getvalue()
    output.close()

    filename = f"snp_export_cycle{cycle}.csv"

    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/data/{sid}/export/xlsx")
async def export_xlsx(sid: str, current_user: CurrentUser, use_rox: bool = Query(default=True)):
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

    points = normalize_for_cycle(unified, cycle, use_rox=use_rox)
    cluster_assignments = cluster_store[sid].assignments if sid in cluster_store else {}
    confidences = (cluster_store[sid].confidences or {}) if sid in cluster_store else {}
    manual_assignments = welltype_store.get(sid, {})
    sample_names = unified.sample_names or {}

    effective_types = get_effective_types(cluster_assignments, manual_assignments, unified.wells)
    genotype_counts = count_genotypes(effective_types)

    scatter_points: list[dict] = []
    table_rows: list[list] = []
    for p in sorted(points, key=lambda pt: (pt.well[0], int(pt.well[1:]))):
        gt = _determine_genotype(
            p.well, p.norm_fam, p.norm_allele2, cluster_assignments, manual_assignments
        )
        scatter_points.append({
            "well": p.well,
            "norm_fam": p.norm_fam,
            "norm_allele2": p.norm_allele2,
            "effective_type": gt,
        })
        conf = confidences.get(p.well)
        table_rows.append([
            p.well,
            sample_names.get(p.well, ""),
            gt,
            round(conf * 100, 1) if conf is not None else "",
            round(p.norm_fam, 6),
            round(p.norm_allele2, 6),
            round(p.raw_fam, 4),
            round(p.raw_allele2, 4),
            round(p.raw_rox, 4) if p.raw_rox is not None else "",
        ])

    headers = [
        "Well", "Sample Name", "Genotype", "Confidence (%)",
        "FAM (norm)", f"{unified.allele2_dye} (norm)",
        "FAM (raw)", f"{unified.allele2_dye} (raw)", "ROX (raw)",
    ]
    counts = Counter(gt for gt in effective_types.values())
    n_called = sum(c for g, c in counts.items() if g not in ("Undetermined", "NTC", "Unknown"))
    n_total = len(unified.wells)
    qc = {
        "Total wells": n_total,
        "Called": n_called,
        "Call rate (%)": round(n_called / n_total * 100, 1) if n_total else 0,
    }

    filename = ""
    try:
        from app.db import get_db
        row = get_db().execute(
            "SELECT raw_filename FROM sessions WHERE session_id = ?", (sid,)
        ).fetchone()
        if row:
            filename = row["raw_filename"] or ""
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
