"""Single-process input transactions; calculation publication is a separate phase.

Mutations are synchronous and never await while holding this short DB boundary.
The existing SQLite connection is process-global: this lock protects this input
writer, not arbitrary legacy DB writers or multiple uvicorn processes.
"""

from __future__ import annotations

from dataclasses import dataclass
from threading import RLock

from fastapi import HTTPException

from app import db
from app.models import MarkerRegion, UnifiedData, WellType

input_lock = RLock()


@dataclass
class InputSnapshot:
    ploidy: int
    markers: list[MarkerRegion]
    welltypes: dict[str, str]

    def judgment_key(self) -> tuple:
        markers = sorted(
            (
                m.id,
                tuple(m.wells),
                m.ploidy,
                m.threshold_config.model_dump_json() if m.threshold_config else None,
            )
            for m in self.markers
        )
        return self.ploidy, markers, self.welltypes


def check_expected(unified: UnifiedData, expected: int | None) -> None:
    if expected is not None and expected != unified.input_revision:
        raise HTTPException(
            409,
            {
                "code": "INPUT_REVISION_CONFLICT",
                "message": "Analysis inputs changed; refresh before retrying.",
                "current_input_revision": unified.input_revision,
            },
        )


def validate_welltypes(unified: UnifiedData, assignments: dict[str, str]) -> None:
    if not set(assignments).issubset(unified.wells):
        raise HTTPException(400, "Well is not part of this session's plate")
    if any(
        value not in {kind.value for kind in WellType} for value in assignments.values()
    ):
        raise HTTPException(400, "Invalid well type")


def _persist_inputs(sid: str, before: InputSnapshot, after: InputSnapshot) -> None:
    if before.markers != after.markers:
        db.save_marker_regions(
            sid, [m.model_dump() for m in after.markers], commit=False
        )
    if before.welltypes != after.welltypes:
        db.delete_welltypes(sid, commit=False)
        for well, value in after.welltypes.items():
            db.save_welltype(sid, well, value, commit=False)
    if before.ploidy != after.ploidy:
        db.set_session_ploidy(sid, after.ploidy, commit=False)


def mutate_inputs(
    sid: str,
    expected: int | None = None,
    *,
    markers: list[MarkerRegion] | None = None,
    welltypes: dict[str, str] | None = None,
    ploidy: int | None = None,
) -> int:
    from app.routers.upload import sessions
    from app.routers.clustering import marker_store, welltype_store

    with input_lock:
        unified = sessions[sid]
        before = InputSnapshot(
            unified.ploidy, marker_store.get(sid, []), welltype_store.get(sid, {})
        )
        after = InputSnapshot(
            ploidy if ploidy is not None else before.ploidy,
            markers if markers is not None else before.markers,
            welltypes if welltypes is not None else before.welltypes,
        )
        validate_welltypes(unified, after.welltypes)
        check_expected(unified, expected)
        if after == before:
            return unified.input_revision
        revision = unified.input_revision + int(
            after.judgment_key() != before.judgment_key()
        )
        conn = db.get_db()
        try:
            _persist_inputs(sid, before, after)
            conn.execute(
                "UPDATE sessions SET input_revision=? WHERE session_id=?",
                (revision, sid),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        unified.ploidy = after.ploidy
        unified.input_revision = revision
        marker_store[sid] = after.markers
        welltype_store[sid] = after.welltypes
        return revision
