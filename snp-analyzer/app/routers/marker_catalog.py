"""Per-user marker (assay) CATALOG -- a durable, plate-independent assay
registry.

A "layout" (``app/routers/layouts.py``) snapshots one PLATE's marker set.
This module is different: it lets a user register a single ASSAY once (e.g.
"qSwet5.3") with rich detail -- genomic target, chemistry, calibration
evidence, ground-truth validation status -- and reuse that SAME assay
definition across many unrelated plates/sessions later, by attaching a
session's ephemeral ``marker_regions`` row to a catalog entry
(``POST /api/data/{sid}/markers/{marker_id}/attach-catalog``).

Scope: ``app.auth.TokenData`` carries only ``user_id``/``username``/``role``
-- there is no team/org concept -- so a catalog entry is owned by exactly one
user. "Sharing" a catalog entry with another user is an explicit copy
(``POST /api/marker-catalog/{id}/copy``), never a shared/team scope (mirrors
``app/routers/layouts.py``'s ``saved_layouts`` pattern exactly).
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.auth import CurrentUser, check_session_access
from app.models import MarkerCalibration, MarkerCatalogEntry, MarkerRegion, MarkerValidation
from app.processing.genotype_vocab import validate_ploidy
from app.routers.clustering import _invalidate_clustering, _validate_marker_set, marker_store
from app.routers.upload import sessions

router = APIRouter()


class MarkerCatalogCreate(BaseModel):
    name: str
    target_gene: str | None = None
    snp_id: str | None = None
    allele1_base: str | None = None
    allele2_base: str | None = None
    chemistry: str | None = None
    default_ploidy: int = 2
    color: str | None = None
    expected_dosage_classes: int | None = None
    interpretation_notes: str = ""
    asg_target_id: str | None = None
    calibration: MarkerCalibration = Field(default_factory=MarkerCalibration)
    validation: MarkerValidation = Field(default_factory=MarkerValidation)


class MarkerCatalogUpdate(BaseModel):
    """Partial update for one catalog entry (PUT /api/marker-catalog/{id}).

    Only fields explicitly present in the request body are applied
    (``model_dump(exclude_unset=True)`` in the handler) -- mirrors
    ``app.routers.clustering.MarkerUpdate``'s semantics exactly."""
    name: str | None = None
    target_gene: str | None = None
    snp_id: str | None = None
    allele1_base: str | None = None
    allele2_base: str | None = None
    chemistry: str | None = None
    default_ploidy: int | None = None
    color: str | None = None
    expected_dosage_classes: int | None = None
    interpretation_notes: str | None = None
    asg_target_id: str | None = None
    calibration: MarkerCalibration | None = None
    validation: MarkerValidation | None = None


class AttachCatalogRequest(BaseModel):
    catalog_id: str


def _validate_catalog_fields(name: str, default_ploidy: int, validation: MarkerValidation) -> None:
    """Shared by create/update so both paths reject the same bad input with
    the same 400, instead of a bad row ever reaching the DB."""
    if not name or not name.strip():
        raise HTTPException(400, "Marker catalog entry name must not be empty")
    try:
        validate_ploidy(default_ploidy)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if validation.concordance is not None and not (0.0 <= validation.concordance <= 1.0):
        raise HTTPException(400, "validation.concordance must be in [0, 1]")


def _new_catalog_id() -> str:
    return uuid.uuid4().hex[:16]


def _row_to_entry(row: dict) -> MarkerCatalogEntry:
    return MarkerCatalogEntry(
        id=row["id"],
        owner_user_id=row["owner_user_id"],
        name=row["name"],
        target_gene=row["target_gene"],
        snp_id=row["snp_id"],
        allele1_base=row["allele1_base"],
        allele2_base=row["allele2_base"],
        chemistry=row["chemistry"],
        default_ploidy=row["default_ploidy"],
        color=row["color"],
        expected_dosage_classes=row["expected_dosage_classes"],
        interpretation_notes=row["interpretation_notes"] or "",
        asg_target_id=row["asg_target_id"],
        calibration=MarkerCalibration(**row["calibration"]),
        validation=MarkerValidation(**row["validation"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _get_owned_entry(catalog_id: str, current_user) -> dict:
    """404 (not 403) if the entry doesn't exist OR isn't owned by the caller
    -- an entry's existence is not disclosed to a non-owner (mirrors
    ``app.routers.layouts._get_owned_layout``)."""
    from app.db import get_marker_catalog_entry

    row = get_marker_catalog_entry(catalog_id)
    if row is None or row["owner_user_id"] != current_user.user_id:
        raise HTTPException(404, "Marker catalog entry not found")
    return row


@router.get("/api/marker-catalog")
async def list_my_catalog(current_user: CurrentUser):
    from app.db import list_marker_catalog_entries

    rows = list_marker_catalog_entries(current_user.user_id)
    return {"entries": [_row_to_entry(r).model_dump() for r in rows]}


@router.post("/api/marker-catalog")
async def create_catalog_entry(body: MarkerCatalogCreate, current_user: CurrentUser):
    _validate_catalog_fields(body.name, body.default_ploidy, body.validation)

    from app.db import get_marker_catalog_entry, save_marker_catalog_entry

    entry_id = _new_catalog_id()
    save_marker_catalog_entry(entry_id, current_user.user_id, body.model_dump())
    return _row_to_entry(get_marker_catalog_entry(entry_id)).model_dump()


@router.get("/api/marker-catalog/{catalog_id}")
async def get_catalog_entry(catalog_id: str, current_user: CurrentUser):
    return _row_to_entry(_get_owned_entry(catalog_id, current_user)).model_dump()


@router.put("/api/marker-catalog/{catalog_id}")
async def update_catalog_entry(catalog_id: str, body: MarkerCatalogUpdate, current_user: CurrentUser):
    existing = _get_owned_entry(catalog_id, current_user)

    updates = body.model_dump(exclude_unset=True)
    merged = {**existing, **updates}

    validation = MarkerValidation(**merged["validation"])
    _validate_catalog_fields(merged["name"], merged["default_ploidy"], validation)

    from app.db import get_marker_catalog_entry, update_marker_catalog_entry

    data = {**merged, "validation": validation.model_dump()}
    update_marker_catalog_entry(catalog_id, data)
    return _row_to_entry(get_marker_catalog_entry(catalog_id)).model_dump()


@router.delete("/api/marker-catalog/{catalog_id}")
async def delete_catalog_entry(catalog_id: str, current_user: CurrentUser):
    _get_owned_entry(catalog_id, current_user)

    from app.db import delete_marker_catalog_entry

    delete_marker_catalog_entry(catalog_id)
    return {"status": "ok"}


@router.post("/api/marker-catalog/{catalog_id}/copy")
async def copy_catalog_entry(catalog_id: str, current_user: CurrentUser):
    """Duplicate ANY existing catalog entry into the caller's OWN catalog.

    This is the explicit "sharing" primitive: since TokenData has no
    team/org concept, a user who wants to reuse another user's assay
    definition does so by copying it (by id) into their own catalog --
    ownership of the SOURCE entry is deliberately NOT required (unlike
    GET/PUT/DELETE, which are owner-only). The resulting copy is fully
    independent: editing/deleting it never touches the original (mirrors
    ``app.routers.layouts.copy_layout_endpoint``)."""
    from app.db import get_marker_catalog_entry, save_marker_catalog_entry

    src = get_marker_catalog_entry(catalog_id)
    if src is None:
        raise HTTPException(404, "Marker catalog entry not found")

    new_id = _new_catalog_id()
    data = dict(src)
    data["name"] = f"{src['name']} (copy)"
    save_marker_catalog_entry(new_id, current_user.user_id, data)
    return _row_to_entry(get_marker_catalog_entry(new_id)).model_dump()


@router.post("/api/data/{sid}/markers/{marker_id}/attach-catalog")
async def attach_catalog_to_marker(
    sid: str, marker_id: str, body: AttachCatalogRequest, current_user: CurrentUser
):
    """Link session marker ``marker_id`` to catalog assay ``body.catalog_id``.

    Prefills the session marker's ``ploidy``/``color`` from the catalog entry
    when the marker still holds ``MarkerRegion``'s field default for that
    field (``ploidy == 2`` / ``color is None``) -- i.e. hasn't been
    customized away from the default yet. An already-customized field is
    left untouched so this never silently overwrites a deliberate choice.
    The catalog entry must exist AND be owned by the caller (its scope is the
    owning user only, same as GET/PUT/DELETE) -- 404 otherwise, mirroring
    ``check_session_access``'s non-disclosure of session existence."""
    check_session_access(sid, current_user)
    if sid not in sessions:
        raise HTTPException(404, "Session not found")

    markers = marker_store.get(sid, [])
    idx = next((i for i, m in enumerate(markers) if m.id == marker_id), None)
    if idx is None:
        raise HTTPException(404, f"Marker {marker_id!r} not found")

    catalog_row = _get_owned_entry(body.catalog_id, current_user)

    marker = markers[idx]
    updated = marker.model_dump()
    updated["catalog_id"] = body.catalog_id
    if updated.get("ploidy", 2) == 2:
        updated["ploidy"] = catalog_row["default_ploidy"]
    if updated.get("color") is None:
        updated["color"] = catalog_row["color"]
    updated_marker = MarkerRegion(**updated)

    unified = sessions[sid]
    others = [m for i, m in enumerate(markers) if i != idx]
    _validate_marker_set(others + [updated_marker], unified)

    new_markers = list(markers)
    new_markers[idx] = updated_marker

    # DB-before-memory (mirrors app.routers.clustering.update_marker).
    from app.db import save_marker_regions

    save_marker_regions(sid, [m.model_dump() for m in new_markers])
    marker_store[sid] = new_markers
    _invalidate_clustering(sid)

    return updated_marker.model_dump()
