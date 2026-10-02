"""Query parameters shared by the export routers."""
from fastapi import HTTPException

MAX_MARKER_IDS = 200


def parse_marker_ids(raw: str | None) -> tuple[str, ...] | None:
    """Parse a comma-separated ``marker_ids`` query value.

    ``None`` (parameter absent) means every marker. A present value must name at
    least one marker, with no empty or repeated entries; whether each id exists
    is checked against the captured result by ``filter_snapshot``.
    """
    if raw is None:
        return None
    ids = tuple(part.strip() for part in raw.split(","))
    if not ids or any(not marker_id for marker_id in ids):
        raise HTTPException(400, "marker_ids must be a comma-separated list of marker ids")
    if len(set(ids)) != len(ids):
        raise HTTPException(400, "marker_ids must not repeat a marker")
    if len(ids) > MAX_MARKER_IDS:
        raise HTTPException(400, "Too many marker_ids")
    return ids
