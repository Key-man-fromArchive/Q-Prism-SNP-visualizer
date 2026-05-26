from __future__ import annotations

from collections.abc import MutableMapping
import uuid

from app import asg_session, db
from app.models import DataWindow, UnifiedData, UploadResponse
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
    )


def _dump_data_windows(data_windows: list[DataWindow] | None) -> list[dict[str, int | str]] | None:
    if not data_windows:
        return None
    return [
        {"name": window.name, "start_cycle": window.start_cycle, "end_cycle": window.end_cycle}
        for window in data_windows
    ]
