from __future__ import annotations

import csv
import io

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.models import UnifiedData
from app.processing.normalize import normalize_for_cycle
from app.routers.upload import sessions
from app.routers.clustering import cluster_store, welltype_store

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
    cycle: int = Query(default=0),
    use_rox: bool = Query(default=True),
):
    """Export scatter data as a downloadable CSV file."""
    unified = _get_session(sid)

    if cycle <= 0:
        cycle = max(unified.cycles)

    if cycle not in unified.cycles:
        raise HTTPException(
            400,
            f"Cycle {cycle} not available. Range: {unified.cycles[0]}-{unified.cycles[-1]}",
        )

    points = normalize_for_cycle(unified.data, cycle, unified.has_rox, use_rox)

    cluster_assignments: dict[str, str] = {}
    if sid in cluster_store:
        cluster_assignments = cluster_store[sid].assignments
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
        writer.writerow([
            p.well,
            sample_names.get(p.well, ""),
            genotype,
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
