"""Single-process input transactions; calculation publication is a separate phase.

Mutations are synchronous and never await while holding this short DB boundary.
The existing SQLite connection is process-global: this lock protects this input
writer, not arbitrary legacy DB writers or multiple uvicorn processes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from threading import RLock

from fastapi import HTTPException

from app import db
from app.models import ClusteringResult, MarkerRegion, UnifiedData, WellType

input_lock = RLock()


@dataclass
class PublicationState:
    owner: UnifiedData
    lock: RLock = field(default_factory=RLock)
    sequence: int = 0
    pending: bool = False
    failed: bool = False


@dataclass(frozen=True)
class AnalysisTicket:
    sid: str
    session: UnifiedData
    state: PublicationState
    sequence: int
    input_revision: int


publication_states: dict[str, PublicationState] = {}


def _current_publication_state(sid: str) -> PublicationState | None:
    from app.routers.upload import sessions

    state = publication_states.get(sid)
    if state is not None and state.owner is sessions.get(sid):
        return state
    return None


def begin_analysis(sid: str, session: UnifiedData) -> AnalysisTicket:
    """Caller holds input_lock; accepted requests supersede even if they fail."""
    state = _current_publication_state(sid)
    if state is None:
        state = PublicationState(session)
        publication_states[sid] = state
    with state.lock:
        state.sequence += 1
        state.pending = True
        state.failed = False
        return AnalysisTicket(sid, session, state, state.sequence, session.input_revision)


def forget_analysis(sid: str) -> None:
    """Called only after session deletion commits, under input_lock."""
    publication_states.pop(sid, None)


def analysis_status(sid: str) -> dict[str, object]:
    from app.routers.clustering import cluster_store

    with input_lock:
        state = _current_publication_state(sid)
        if state and state.pending:
            return {"analysis_pending": True, "analysis_status": "computing"}
        if state and state.failed:
            return {"analysis_pending": False, "analysis_status": "failed"}
        return {"analysis_pending": False,
                "analysis_status": "completed" if sid in cluster_store else "idle"}


def fail_analysis(ticket: AnalysisTicket) -> None:
    with input_lock, ticket.state.lock:
        if publication_states.get(ticket.sid) is ticket.state and ticket.sequence == ticket.state.sequence:
            ticket.state.pending = False
            ticket.state.failed = True


def _check_publication(ticket: AnalysisTicket) -> None:
    from app.routers.upload import sessions

    if sessions.get(ticket.sid) is not ticket.session or publication_states.get(ticket.sid) is not ticket.state:
        raise HTTPException(404, "Session not found")
    if ticket.sequence != ticket.state.sequence:
        raise HTTPException(409, {"code": "ANALYSIS_SUPERSEDED", "message": "A newer analysis was accepted."})
    check_expected(ticket.session, ticket.input_revision)


def publish_analysis(ticket: AnalysisTicket, result: ClusteringResult) -> None:
    """Single-process CAS + short DB boundary; never called in calculation workers."""
    from app.routers.clustering import cluster_store

    with input_lock, ticket.state.lock:
        _check_publication(ticket)
        db.save_clustering(ticket.sid, result)
        cluster_store[ticket.sid] = result
        ticket.state.pending = False
        ticket.state.failed = False


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
