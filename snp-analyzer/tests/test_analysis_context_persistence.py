"""P1-R1-T1: immutable provenance survives SQLite and genuine startup restore."""
from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from types import ModuleType

import pytest
from pydantic import ValidationError

from app import db
from app.models import ClusteringResult
from fixtures_ux_followup import make_ux_plate


class FailingCommitConnection(sqlite3.Connection):
    fail_next_commit = False

    def commit(self) -> None:
        if self.fail_next_commit:
            self.fail_next_commit = False
            raise sqlite3.OperationalError("synthetic commit failure")
        super().commit()


@pytest.fixture
def isolated_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[ModuleType]:
    connection = sqlite3.connect(tmp_path / "context.sqlite3", factory=FailingCommitConnection,
                                 check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "context.sqlite3")
    monkeypatch.setattr(db, "_conn", connection)
    db.init_db()
    yield db
    if db._conn is not connection and db._conn is not None:
        db._conn.close()
    connection.close()


def context_payload(cycle: int = 40) -> dict:
    parameters = {"ploidy": 2, "n_clusters": 3, "threshold_config": {
        "ntc_threshold": 0.1, "boundaries": [0.7, 0.3], "dosage_max": None,
    }, "extension": {"zero": 0, "disabled": False, "unknown": None}}
    return {
        "schema_version": 1, "result_revision": "a178af48-bb80-4e6e-9a98-6ed75008d0e1",
        "analysed_at": "2026-09-07T09:00:00+09:00", "cycle": cycle,
        "use_rox": False, "normalization_applied": False, "background": "pre_read",
        "algorithm": "threshold", "parameters": parameters, "input_revision": 7,
        "regions": [
            {"marker_id": "synthetic-2", "name": "Synthetic two", "wells": ["A1"],
             "ploidy": 2, "algorithm": "threshold", "parameters": parameters},
            {"marker_id": "synthetic-6", "name": "Synthetic six", "wells": ["A2"],
             "ploidy": 6, "algorithm": "auto", "parameters": {
                 "ploidy": 6, "n_clusters": 4, "threshold_config": {"boundaries": [0.8, 0.5, 0.2]},
             }},
        ],
    }


def verified_result(cycle: int = 40) -> ClusteringResult:
    return ClusteringResult.model_validate({
        "algorithm": "threshold", "cycle": cycle,
        "assignments": {"A1": "Allele 1 Homo", "A2": "AAABBB"},
        "confidences": {"A1": 0.91, "A2": 0.86}, "analysis_context": context_payload(cycle),
    })


def loaded_result() -> ClusteringResult:
    return next(entry["clustering"] for entry in db.load_all_sessions()
                if entry["session_id"] == "synthetic")


@pytest.mark.parametrize("cycle", [0, 20, 40])
def test_complete_context_round_trip(isolated_db: ModuleType, cycle: int) -> None:
    isolated_db.save_session("synthetic", make_ux_plate())
    isolated_db.get_db().execute("UPDATE sessions SET input_revision=7 WHERE session_id='synthetic'")
    isolated_db.get_db().commit()
    result = verified_result(cycle)
    isolated_db.save_clustering("synthetic", result)
    restored = loaded_result()
    assert restored.analysis_context is not None
    assert result.analysis_context is not None
    assert restored.analysis_context.model_dump() == result.analysis_context.model_dump()
    assert restored.analysis_context.analysed_at == datetime(2026, 9, 7, tzinfo=timezone.utc)
    assert restored.context_status == "verified"
    assert restored.assignments == result.assignments
    assert restored.confidences == result.confidences
    row = isolated_db.get_db().execute("SELECT * FROM clustering_results").fetchone()
    assert json.loads(row["result_json"])["analysis_context"]["cycle"] == cycle
    stored_context = json.loads(row["result_json"])["analysis_context"]
    assert stored_context["result_revision"] == context_payload()["result_revision"]
    assert stored_context["analysed_at"] == "2026-09-07T00:00:00Z"
    assert json.loads(row["labels_json"]) == result.assignments
    assert json.loads(row["confidences_json"]) == result.confidences
    assert isolated_db.get_db().execute("SELECT input_revision FROM sessions").fetchone()[0] == 7


@pytest.mark.parametrize("payload", [
    {"analysed_at": "2026-09-07T00:00:00"}, {"result_revision": "not-a-uuid"},
    {"input_revision": -1}, {"schema_version": 2}, {"background": "unknown"},
])
def test_invalid_context_is_not_verified(payload: dict) -> None:
    raw = {"algorithm": "threshold", "cycle": 40, "assignments": {},
           "analysis_context": {**context_payload(), **payload}}
    with pytest.raises(ValidationError):
        ClusteringResult.model_validate(raw)


@pytest.mark.parametrize("missing", list(context_payload()))
def test_context_requires_every_provenance_field(missing: str) -> None:
    context = context_payload()
    del context[missing]
    with pytest.raises(ValidationError):
        ClusteringResult.model_validate({"algorithm": "threshold", "cycle": 40,
                                        "assignments": {}, "analysis_context": context})


def test_nonzero_session_revision_survives_connection_reopen(isolated_db: ModuleType) -> None:
    unified = make_ux_plate()
    unified.input_revision = 9
    isolated_db.save_session("synthetic", unified)
    result = verified_result()
    result.confidences = {}
    isolated_db.save_clustering("synthetic", result)
    isolated_db.get_db().close()
    isolated_db._conn = None
    isolated_db.init_db()
    assert isolated_db.load_all_sessions()[0]["unified"].input_revision == 9
    assert loaded_result().model_dump() == result.model_dump()
    assert json.loads(isolated_db.get_db().execute(
        "SELECT confidences_json FROM clustering_results").fetchone()[0]) == {}


def test_existing_revision_column_with_missing_version_stamp(isolated_db: ModuleType) -> None:
    conn = isolated_db.get_db()
    conn.execute("DELETE FROM schema_version WHERE version=7")
    conn.commit()
    isolated_db.init_db()
    # Migration 7 (input_revision) is re-stamped. Checked by presence rather
    # than as the newest version: init_db() runs every later migration too.
    assert conn.execute("SELECT version FROM schema_version WHERE version=7").fetchone() is not None


@pytest.mark.parametrize("wire_context", ["missing", None])
def test_legacy_json_keeps_unknown_context(isolated_db: ModuleType, wire_context: str | None) -> None:
    isolated_db.save_session("synthetic", make_ux_plate())
    payload = {"algorithm": "threshold", "cycle": 40, "assignments": {"A1": "NTC"},
               "context_status": "verified"}
    if wire_context is None:
        payload["analysis_context"] = None
    old = ClusteringResult.model_validate(payload)
    isolated_db.save_clustering("synthetic", old)
    restored = loaded_result()
    assert restored.context_status == "legacy_unknown"
    assert restored.analysis_context is None
    assert restored.assignments == {"A1": "NTC"}
    assert restored.model_dump(exclude_none=True)["context_status"] == "legacy_unknown"


def test_legacy_column_only_row_is_readable(isolated_db: ModuleType) -> None:
    isolated_db.save_session("synthetic", make_ux_plate())
    conn = isolated_db.get_db()
    conn.execute("INSERT INTO clustering_results(session_id,labels_json,method,cycle,confidences_json) "
                 "VALUES (?,?,?,?,?)", ("synthetic", '{"A1":"NTC"}', "threshold", 40, '{"A1":0.8}'))
    conn.commit()
    restored = loaded_result()
    assert restored.analysis_context is None
    assert restored.context_status == "legacy_unknown"
    assert restored.confidences == {"A1": 0.8}


def test_migrate_v6_idempotently_without_cascade_deletion(isolated_db: ModuleType) -> None:
    conn = isolated_db.get_db()
    isolated_db.save_session("synthetic", make_ux_plate())
    isolated_db.save_clustering("synthetic", ClusteringResult(algorithm="threshold", cycle=40, assignments={}))
    isolated_db.save_welltype("synthetic", "A1", "NTC")
    columns = [row[1] for row in conn.execute("PRAGMA table_info(sessions)")]
    if "input_revision" in columns:
        conn.execute("ALTER TABLE sessions DROP COLUMN input_revision")
    conn.execute("DELETE FROM schema_version WHERE version > 6")
    conn.commit()
    isolated_db.init_db()
    isolated_db.init_db()
    assert conn.execute("SELECT input_revision FROM sessions").fetchone()[0] == 0
    # Migration 7 (input_revision) is re-stamped. Checked by presence rather
    # than as the newest version: init_db() runs every later migration too.
    assert conn.execute("SELECT version FROM schema_version WHERE version=7").fetchone() is not None
    assert conn.execute("SELECT COUNT(*) FROM well_cycle_data").fetchone()[0] == 96 * 42
    assert conn.execute("SELECT COUNT(*) FROM manual_welltypes").fetchone()[0] == 1
    assert loaded_result().context_status == "legacy_unknown"


def test_commit_failure_rolls_back_and_cannot_leak_into_later_commit(isolated_db: ModuleType) -> None:
    isolated_db.save_session("synthetic", make_ux_plate())
    previous = verified_result(20)
    isolated_db.save_clustering("synthetic", previous)
    conn = isolated_db.get_db()
    conn.fail_next_commit = True
    with pytest.raises(sqlite3.OperationalError, match="synthetic commit failure"):
        isolated_db.save_clustering("synthetic", verified_result(40))
    assert not conn.in_transaction
    assert loaded_result().cycle == 20
    isolated_db.save_welltype("synthetic", "A1", "NTC")
    assert loaded_result().model_dump() == previous.model_dump()


@pytest.mark.asyncio
async def test_real_lifespan_restores_saved_revision_and_context(
    isolated_db: ModuleType, monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.main as main
    from app.routers import clustering, data, sample, upload

    isolated_db.save_session("synthetic", make_ux_plate())
    isolated_db.save_clustering("synthetic", verified_result())
    conn = isolated_db.get_db()
    conn.execute("UPDATE sessions SET input_revision=8 WHERE session_id='synthetic'")
    conn.commit()
    conn.close()
    isolated_db._conn = None
    for module, name in [(upload, "sessions"), (clustering, "cluster_store"),
                         (clustering, "welltype_store"), (clustering, "marker_store"),
                         (clustering, "group_store"), (sample, "sample_name_store"), (data, "protocol_store")]:
        monkeypatch.setattr(module, name, {})
    monkeypatch.setattr(main, "assert_auth_configuration", lambda: None)
    monkeypatch.setattr(main, "_ensure_admin", lambda: None)
    monkeypatch.setattr(main, "_migrate_projects_json", lambda: None)
    async with main.lifespan(main.app):
        assert upload.sessions["synthetic"].input_revision == 8
        result = clustering.cluster_store["synthetic"]
        assert result.analysis_context.input_revision == 7
        assert result.context_status == "verified"
        assert result.model_dump() == loaded_result().model_dump()
