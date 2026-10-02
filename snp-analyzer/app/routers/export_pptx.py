"""PPTX report export of the latest validated whole-run result."""

from uuid import UUID

from fastapi import APIRouter, Query
from fastapi.responses import Response

from app.auth import CurrentUser
from app.processing.background import BackgroundMode
from app.processing.cycle_selection import CycleMode
from app.reporting.filenames import content_disposition
from app.reporting.result_snapshot import ExportOptions, capture_result_snapshot
from app.reporting.snapshot_pptx import build_snapshot_pptx, pptx_filename
from app.routers.export_params import parse_marker_ids

router = APIRouter()

PPTX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
)


@router.get("/api/data/{sid}/export/pptx")
async def export_pptx(
    sid: str,
    current_user: CurrentUser,
    use_rox: bool | None = Query(default=None),
    background: BackgroundMode | None = Query(default=None),
    cycle: int | None = Query(default=None, ge=0),
    cycle_mode: CycleMode = Query(default="legacy_latest"),
    result_revision: UUID | None = Query(default=None),
    marker_ids: str | None = Query(default=None),
    include_table: bool = Query(default=True),
) -> Response:
    """Download a 16:9 deck, using the stored analysis conditions."""
    selected = parse_marker_ids(marker_ids)
    snapshot = capture_result_snapshot(
        sid,
        current_user,
        ExportOptions(
            result_revision, cycle, use_rox, background, cycle_mode, selected
        ),
    )
    return Response(
        build_snapshot_pptx(snapshot, include_table),
        media_type=PPTX_MEDIA_TYPE,
        headers={
            "Content-Disposition": content_disposition(
                pptx_filename(snapshot, selected is not None)
            )
        },
    )
