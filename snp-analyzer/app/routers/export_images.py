"""PNG bundle export route."""
from uuid import UUID

from fastapi import APIRouter, Query
from fastapi.responses import Response

from app.auth import CurrentUser
from app.processing.background import BackgroundMode
from app.processing.cycle_selection import CycleMode
from app.reporting.filenames import content_disposition
from app.reporting.result_snapshot import ExportOptions, capture_result_snapshot
from app.reporting.snapshot_images import build_scatter_zip
from app.reporting.snapshot_presentation import marker_scope
from app.routers.export_params import parse_marker_ids, parse_orientation

router = APIRouter()


@router.get("/api/data/{sid}/export/scatter-png.zip")
def export_scatter_png_zip(
    sid: str,
    current_user: CurrentUser,
    use_rox: bool | None = Query(default=None),
    background: BackgroundMode | None = Query(default=None),
    cycle: int | None = Query(default=None, ge=0),
    cycle_mode: CycleMode = Query(default="legacy_latest"),
    result_revision: UUID | None = Query(default=None),
    marker_ids: str | None = Query(default=None),
    orientation: str | None = Query(default=None),
):
    selected = parse_marker_ids(marker_ids)
    axes = parse_orientation(orientation)
    snapshot = capture_result_snapshot(
        sid, current_user,
        ExportOptions(result_revision, cycle, use_rox, background, cycle_mode, selected, axes),
    )
    return Response(
        build_scatter_zip(snapshot), media_type="application/zip",
        headers={"Content-Disposition": content_disposition(
            "snp_scatter_png_"
            + (f"{scope}_" if (scope := marker_scope(snapshot, selected is not None)) else "")
            + f"cycle{snapshot.context.cycle}.zip")},
    )
