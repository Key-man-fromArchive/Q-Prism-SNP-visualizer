"""Per-user saved plate-layout library (S3 dependency).

A "layout" is a reusable PHYSICAL plate design: a marker set (each
``{id,name,color,ploidy,wells,threshold_config?}``) plus optionally
well-types / sample ids, captured from one session's *current* state and
re-applicable to another session later.

Scope: ``app.auth.TokenData`` carries only ``user_id``/``username``/``role``
-- there is no team/org concept -- so a layout is owned by exactly one user.
"Sharing" a layout with another user is an explicit copy
(``POST /api/layouts/{id}/copy``), never a shared/team scope.

Markers already persist per-session in ``marker_regions``
(``/api/data/{sid}/markers``); this module reuses the SAME validation
(``_validate_marker_set`` from ``app.routers.clustering``) so an applied
layout can never write an invalid marker set into a session.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, check_session_access
from app.models import MarkerRegion
from app.routers.clustering import (
    _invalidate_clustering,
    _validate_marker_set,
    marker_store,
    welltype_store,
)
from app.routers.sample import _merged_samples
from app.routers.upload import sessions

router = APIRouter()

SNAPSHOT_SCHEMA_VERSION = 1


class LayoutCreate(BaseModel):
    name: str
    sid: str


class LayoutApply(BaseModel):
    sid: str
    # L4: threshold_config.boundaries are data-specific (tuned against ONE
    # run's fluorescence); default OFF so applying a layout never silently
    # carries stale manual boundaries onto a different run's data.
    apply_analysis_settings: bool = False
    # L2: required to confirm an apply that would silently change the ploidy
    # of a marker id that already exists in the target session.
    force: bool = False


def _get_session(sid: str):
    if sid not in sessions:
        raise HTTPException(404, "Session not found")
    return sessions[sid]


def _plate_rows_cols(unified) -> dict:
    """Derive {rows, cols} from the session's own well list (no separate
    plate-geometry field exists on UnifiedData -- see app/models.py)."""
    if not unified.wells:
        return {"rows": 0, "cols": 0}
    rows = {w[0] for w in unified.wells}
    cols = {int(w[1:]) for w in unified.wells}
    return {"rows": len(rows), "cols": max(cols)}


def _session_markers(sid: str) -> list[MarkerRegion]:
    """The session's current marker set (memory-first, DB fallback -- mirrors
    the pattern already used by clustering.py's B1 stored-marker path)."""
    markers = marker_store.get(sid)
    if markers is not None:
        return list(markers)
    from app.db import load_marker_regions
    return [MarkerRegion(**m) for m in load_marker_regions(sid)]


def _build_snapshot(sid: str, unified) -> dict:
    markers = _session_markers(sid)
    snapshot: dict = {
        "schema_version": SNAPSHOT_SCHEMA_VERSION,
        "plate": _plate_rows_cols(unified),
        "markers": [m.model_dump() for m in markers],
    }

    well_types = dict(welltype_store.get(sid, {}))
    if well_types:
        snapshot["well_types"] = well_types

    sample_ids = _merged_samples(sid)
    if sample_ids:
        snapshot["sample_ids"] = sample_ids

    return snapshot


def _get_owned_layout(layout_id: str, current_user) -> dict:
    """404 (not 403) if the layout doesn't exist OR isn't owned by the
    caller -- a layout's existence is not disclosed to a non-owner."""
    from app.db import get_layout

    row = get_layout(layout_id)
    if row is None or row["owner_user_id"] != current_user.user_id:
        raise HTTPException(404, "Layout not found")
    return row


def _new_layout_id() -> str:
    return uuid.uuid4().hex[:16]


@router.get("/api/layouts")
async def list_my_layouts(current_user: CurrentUser):
    from app.db import list_layouts

    return {"layouts": list_layouts(current_user.user_id)}


@router.post("/api/layouts")
async def create_layout(body: LayoutCreate, current_user: CurrentUser):
    """Snapshot session ``sid``'s CURRENT marker set (+ well types/sample
    names) into a new layout owned by the caller."""
    check_session_access(body.sid, current_user)
    unified = _get_session(body.sid)

    if not body.name or not body.name.strip():
        raise HTTPException(400, "Layout name must not be empty")

    snapshot = _build_snapshot(body.sid, unified)

    from app.db import get_layout, save_layout

    layout_id = _new_layout_id()
    save_layout(layout_id, current_user.user_id, body.name, snapshot)
    return get_layout(layout_id)


@router.get("/api/layouts/{layout_id}")
async def get_layout_endpoint(layout_id: str, current_user: CurrentUser):
    return _get_owned_layout(layout_id, current_user)


@router.delete("/api/layouts/{layout_id}")
async def delete_layout_endpoint(layout_id: str, current_user: CurrentUser):
    _get_owned_layout(layout_id, current_user)
    from app.db import delete_layout

    delete_layout(layout_id)
    return {"status": "ok"}


@router.post("/api/layouts/{layout_id}/copy")
async def copy_layout_endpoint(layout_id: str, current_user: CurrentUser):
    """Duplicate ANY existing layout into the caller's OWN library.

    This is the explicit "sharing" primitive: since TokenData has no team/org
    concept, a user who wants to reuse another user's layout does so by
    copying it (by id) into their own library -- ownership of the SOURCE
    layout is deliberately NOT required (unlike GET/DELETE, which are
    owner-only). The resulting copy is fully independent: editing/deleting it
    never touches the original."""
    from app.db import get_layout, save_layout

    src = get_layout(layout_id)
    if src is None:
        raise HTTPException(404, "Layout not found")

    new_id = _new_layout_id()
    save_layout(new_id, current_user.user_id, f"{src['name']} (copy)", src["snapshot"])
    return get_layout(new_id)


@router.post("/api/layouts/{layout_id}/apply")
async def apply_layout_endpoint(layout_id: str, body: LayoutApply, current_user: CurrentUser):
    """Write the layout's markers into session ``body.sid``.

    Reuses the exact validation POST /api/data/{sid}/markers uses
    (``_validate_marker_set``): one-well-one-marker, wells must exist on
    THIS plate, ploidy must be valid.
    """
    layout = _get_owned_layout(layout_id, current_user)
    check_session_access(body.sid, current_user)
    unified = _get_session(body.sid)

    snapshot = layout["snapshot"]
    raw_markers: list[dict] = snapshot.get("markers", [])

    # L4: apply markers+ploidy+color by default; threshold_config.boundaries
    # (data-specific manual boundaries) are dropped unless the caller
    # explicitly opts in -- a saved layout's boundaries were tuned against
    # ONE run's fluorescence and are meaningless (or misleading) on another.
    def _strip_analysis_settings(m: dict) -> dict:
        m = dict(m)
        if not body.apply_analysis_settings:
            m["threshold_config"] = None
        return m

    incoming_raw = [_strip_analysis_settings(m) for m in raw_markers]

    # L3: do NOT blindly assume the same plate -- validate every well the
    # layout references actually exists on the TARGET session's plate first.
    valid_wells = set(unified.wells)
    missing: list[str] = []
    for m in incoming_raw:
        for w in m.get("wells", []):
            if w not in valid_wells and w not in missing:
                missing.append(w)
    if missing:
        raise HTTPException(
            400,
            f"Layout references wells not present on the target plate: {sorted(missing)}",
        )

    # L2: applying REPLACES the target session's whole marker set (mirrors
    # POST /markers' replace-all semantics). If a marker id that ALREADY
    # exists in the target session would silently have its ploidy changed
    # by this apply, refuse unless the caller explicitly confirms with
    # force=True -- a silent ploidy change relabels every well under that
    # marker without the user asking for it.
    existing_markers = _session_markers(body.sid)
    existing_by_id = {m.id: m for m in existing_markers}
    if not body.force:
        conflicts = [
            m["id"]
            for m in incoming_raw
            if m["id"] in existing_by_id
            and existing_by_id[m["id"]].ploidy != m.get("ploidy", 2)
        ]
        if conflicts:
            raise HTTPException(
                409,
                {
                    "message": (
                        "Applying this layout would silently change ploidy "
                        "for existing marker(s); pass force=true to confirm."
                    ),
                    "conflicting_marker_ids": conflicts,
                },
            )

    incoming_markers = [MarkerRegion(**m) for m in incoming_raw]
    _validate_marker_set(incoming_markers, unified)

    from app.db import save_marker_regions

    save_marker_regions(body.sid, [m.model_dump() for m in incoming_markers])
    marker_store[body.sid] = incoming_markers
    _invalidate_clustering(body.sid)

    # well_type carryover: well-type roles (NTC / Positive Control / Allele
    # controls / Omit) describe the PHYSICAL layout of the plate -- which
    # wells are reserved as controls -- so they travel with the marker set
    # itself, same as ploidy/color. sample_ids are per-RUN identities (which
    # sample sat in which well for THIS run) and are NEVER carried over by
    # apply, regardless of apply_analysis_settings -- a different session's
    # wells almost certainly hold different physical samples.
    well_types = snapshot.get("well_types") or {}
    applied_well_types = {w: t for w, t in well_types.items() if w in valid_wells}
    if applied_well_types:
        from app.db import save_welltype

        welltype_store.setdefault(body.sid, {}).update(applied_well_types)
        for w, t in applied_well_types.items():
            save_welltype(body.sid, w, t)

    return {
        "sid": body.sid,
        "markers": [m.model_dump() for m in incoming_markers],
        "well_types_applied": applied_well_types,
    }
