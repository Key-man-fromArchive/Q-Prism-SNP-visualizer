"""Assay preset CRUD API.

Built-in presets ship with the app and are read-only. User presets belong to
the user who saved them and are stored in the app database.
"""
from __future__ import annotations
import json
import secrets
import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, StringConstraints, field_validator

from app import db
from app.auth import CurrentUser

router = APIRouter()

MAX_PRESETS_PER_USER = 100
MAX_PRESET_NAME_LENGTH = 100
MAX_PRESET_SETTINGS_BYTES = 16 * 1024

# Default presets shipped with the app
DEFAULT_PRESETS = [
    {
        "id": "default-asgpcr",
        "name": "ASG-PCR Default",
        "builtin": True,
        "settings": {
            "algorithm": "threshold",
            "ntc_threshold": 0.1,
            "allele1_ratio_max": 0.4,
            "allele2_ratio_min": 0.6,
            "n_clusters": 4,
            "use_rox": True,
            "background": "none",
            "fix_axis": False,
            "x_min": 0, "x_max": 12,
            "y_min": 0, "y_max": 12,
        },
    },
    {
        "id": "cfx-no-rox",
        "name": "CFX Opus (no ROX)",
        "builtin": True,
        "settings": {
            "algorithm": "threshold",
            "ntc_threshold": 50,
            "allele1_ratio_max": 0.4,
            "allele2_ratio_min": 0.6,
            "n_clusters": 4,
            "use_rox": False,
            "background": "none",
            "fix_axis": False,
            "x_min": 0, "x_max": 5000,
            "y_min": 0, "y_max": 5000,
        },
    },
]


def _builtin_presets() -> list[dict]:
    return [json.loads(json.dumps(p)) for p in DEFAULT_PRESETS]


def _is_builtin(preset_id: str) -> bool:
    return any(p["id"] == preset_id for p in DEFAULT_PRESETS)


def _check_settings_size(settings: dict[str, Any] | None) -> dict[str, Any] | None:
    if settings is not None:
        try:
            size = len(json.dumps(settings).encode("utf-8"))
        except (TypeError, ValueError):
            raise ValueError("settings must be JSON serialisable")
        if size > MAX_PRESET_SETTINGS_BYTES:
            raise ValueError(f"settings must be at most {MAX_PRESET_SETTINGS_BYTES} bytes")
    return settings


PresetName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_PRESET_NAME_LENGTH)
]


class PresetCreate(BaseModel):
    name: PresetName
    settings: dict[str, Any]

    _settings_size = field_validator("settings")(_check_settings_size)


class PresetUpdate(BaseModel):
    name: PresetName | None = None
    settings: dict[str, Any] | None = None

    _settings_size = field_validator("settings")(_check_settings_size)


def _not_found() -> HTTPException:
    return HTTPException(404, "Preset not found")


# Handlers touch SQLite, so they are plain ``def`` and run in the threadpool.
@router.get("/api/presets")
def list_presets(current_user: CurrentUser):
    return {"presets": _builtin_presets() + db.list_user_presets(current_user.user_id)}


@router.post("/api/presets")
def create_preset(body: PresetCreate, current_user: CurrentUser):
    preset_id = secrets.token_hex(8)
    try:
        inserted = db.insert_user_preset(
            preset_id, current_user.user_id, body.name, body.settings, MAX_PRESETS_PER_USER
        )
    except sqlite3.IntegrityError:
        raise HTTPException(401, "Unknown user")
    if not inserted:
        raise HTTPException(400, "Preset limit reached")
    return {"id": preset_id, "name": body.name, "builtin": False, "settings": body.settings}


@router.put("/api/presets/{preset_id}")
def update_preset(preset_id: str, body: PresetUpdate, current_user: CurrentUser):
    if _is_builtin(preset_id):
        raise HTTPException(400, "Cannot modify built-in presets")
    if not db.update_user_preset(preset_id, current_user.user_id, body.name, body.settings):
        raise _not_found()
    preset = db.get_user_preset(preset_id, current_user.user_id)
    if preset is None:
        raise _not_found()
    return preset


@router.delete("/api/presets/{preset_id}")
def delete_preset(preset_id: str, current_user: CurrentUser):
    if _is_builtin(preset_id):
        raise HTTPException(400, "Cannot delete built-in presets")
    if not db.delete_user_preset(preset_id, current_user.user_id):
        raise _not_found()
    return {"status": "ok"}
