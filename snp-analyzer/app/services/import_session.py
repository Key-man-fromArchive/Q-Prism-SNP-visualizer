from __future__ import annotations

from collections.abc import MutableMapping
import uuid

from app import asg_session, db
from app.models import DataWindow, UnifiedData, UploadResponse
from app.processing.background import available_background_modes
from app.processing import ntc_detection


def create_session_from_import(
    *,
    unified: UnifiedData,
    filename: str,
    user_id: str,
    session_store: MutableMapping[str, UnifiedData],
) -> UploadResponse:
    session_id = uuid.uuid4().hex[:12]
    session_store[session_id] = unified

    db.save_session(session_id, unified, filename=filename, user_id=user_id)
    imported_regions = _build_imported_marker_regions(unified)
    if imported_regions:
        db.save_marker_regions(session_id, imported_regions)
        # The marker endpoint is backed by an in-memory cache during the
        # current process, so seed it at the same time as its durable copy.
        from app.models import MarkerRegion
        from app.routers.clustering import marker_store

        marker_store[session_id] = [MarkerRegion(**region) for region in imported_regions]
    asg_session.bind_session_to_current_asg_launch(session_id, user_id)
    suggested_cycle = ntc_detection.compute_suggested_cycle(unified)

    return UploadResponse(
        session_id=session_id,
        instrument=unified.instrument,
        allele2_dye=unified.allele2_dye,
        num_wells=len(unified.wells),
        num_cycles=len(unified.cycles),
        has_rox=unified.has_rox,
        data_windows=_dump_data_windows(unified.data_windows),
        suggested_cycle=suggested_cycle,
        well_groups=unified.well_groups,
        background_modes=available_background_modes(unified),
    )


def _build_imported_marker_regions(unified: UnifiedData) -> list[dict[str, object]]:
    """Convert explicit instrument assay assignments into editable markers."""
    palette = [
        "#7c5cd6", "#d98a1e", "#2f9e5a", "#d5504e",
        "#3f86c4", "#12a3ad", "#b7519f", "#7a8794",
    ]
    plate_wells = set(unified.wells)
    regions: list[dict[str, object]] = []
    occupied: set[str] = set()
    imported_markers = getattr(unified, "imported_markers", None) or {}
    for index, (name, raw_wells) in enumerate(imported_markers.items()):
        wells = [well for well in raw_wells if well in plate_wells and well not in occupied]
        if not name.strip() or not wells:
            continue
        occupied.update(wells)
        regions.append({
            "id": f"imported-{index + 1}",
            "name": name.strip(),
            "wells": wells,
            "ploidy": getattr(unified, "ploidy", 2),
            "color": palette[index % len(palette)],
            "threshold_config": None,
            "catalog_id": None,
        })
    return regions


def _dump_data_windows(data_windows: list[DataWindow] | None) -> list[dict[str, int | str]] | None:
    if not data_windows:
        return None
    return [
        {"name": window.name, "start_cycle": window.start_cycle, "end_cycle": window.end_cycle}
        for window in data_windows
    ]
