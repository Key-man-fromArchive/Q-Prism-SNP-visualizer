"""Assay preset CRUD API."""
from __future__ import annotations
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser

router = APIRouter()

PRESETS_FILE = Path(__file__).resolve().parent.parent / "data" / "presets.json"

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
            "fix_axis": False,
            "x_min": 0, "x_max": 5000,
            "y_min": 0, "y_max": 5000,
        },
    },
]


def _load_presets() -> list[dict]:
    """Load presets from JSON file, merging with builtins."""
    builtins = [p.copy() for p in DEFAULT_PRESETS]
    if PRESETS_FILE.exists():
        try:
            user_presets = json.loads(PRESETS_FILE.read_text())
        except (json.JSONDecodeError, IOError):
            user_presets = []
    else:
        user_presets = []

    # Merge: builtins first, then user presets (skip duplicates by id)
    ids = {p["id"] for p in builtins}
    result = builtins[:]
    for p in user_presets:
        if p.get("id") not in ids:
            result.append(p)
            ids.add(p["id"])
    return result


def _save_user_presets(presets: list[dict]):
    """Save only user (non-builtin) presets to file."""
    user_only = [p for p in presets if not p.get("builtin")]
    PRESETS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PRESETS_FILE.write_text(json.dumps(user_only, indent=2))


class PresetCreate(BaseModel):
    name: str
    settings: dict


class PresetUpdate(BaseModel):
    name: str | None = None
    settings: dict | None = None


@router.get("/api/presets")
async def list_presets(current_user: CurrentUser):
    return {"presets": _load_presets()}


@router.post("/api/presets")
async def create_preset(body: PresetCreate, current_user: CurrentUser):
    import uuid
    presets = _load_presets()
    new_preset = {
        "id": uuid.uuid4().hex[:8],
        "name": body.name,
        "builtin": False,
        "settings": body.settings,
    }
    presets.append(new_preset)
    _save_user_presets(presets)
    return new_preset


@router.put("/api/presets/{preset_id}")
async def update_preset(preset_id: str, body: PresetUpdate, current_user: CurrentUser):
    presets = _load_presets()
    for p in presets:
        if p["id"] == preset_id:
            if p.get("builtin"):
                raise HTTPException(400, "Cannot modify built-in presets")
            if body.name is not None:
                p["name"] = body.name
            if body.settings is not None:
                p["settings"] = body.settings
            _save_user_presets(presets)
            return p
    raise HTTPException(404, "Preset not found")


@router.delete("/api/presets/{preset_id}")
async def delete_preset(preset_id: str, current_user: CurrentUser):
    presets = _load_presets()
    for p in presets:
        if p["id"] == preset_id:
            if p.get("builtin"):
                raise HTTPException(400, "Cannot delete built-in presets")
            presets.remove(p)
            _save_user_presets(presets)
            return {"status": "ok"}
    raise HTTPException(404, "Preset not found")
