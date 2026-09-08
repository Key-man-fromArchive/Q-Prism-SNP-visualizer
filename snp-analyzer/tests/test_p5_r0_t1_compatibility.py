"""P5-R0-T1 security, ASG, persistence, upload, and archive compatibility.

All values in this module are synthetic.  The tests deliberately exercise the
authorization boundary before snapshot rendering or transport so that a
failure cannot accidentally disclose an ASG target or result payload.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch
import zipfile

import jwt
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient


def _tiny_plate():
    from app.models import UnifiedData, WellCycleData

    return UnifiedData(
        instrument="Synthetic P5 instrument",
        allele2_dye="HEX",
        wells=["A1", "A2"],
        cycles=[1, 2, 3],
        data=[
            WellCycleData(well="A1", cycle=1, fam=1.0, allele2=0.2, rox=1.0),
            WellCycleData(well="A1", cycle=2, fam=2.0, allele2=0.3, rox=1.0),
            WellCycleData(well="A1", cycle=3, fam=3.0, allele2=0.4, rox=1.0),
            WellCycleData(well="A2", cycle=1, fam=0.2, allele2=1.0, rox=1.0),
            WellCycleData(well="A2", cycle=2, fam=0.3, allele2=2.0, rox=1.0),
            WellCycleData(well="A2", cycle=3, fam=0.4, allele2=3.0, rox=1.0),
        ],
        has_rox=True,
        sample_names={"A1": "Synthetic-1", "A2": "Synthetic-2"},
    )


def _verified_result():
    from app.models import ClusteringResult

    return ClusteringResult(
        algorithm="threshold",
        cycle=3,
        assignments={"A1": "Allele 1 Homo", "A2": "Allele 2 Homo"},
    )


def _publish_verified_result(session_id: str) -> None:
    """Create an accepted, provenance-bearing result through the real path."""
    from app.models import ClusteringRequest
    from app.processing.analysis_state import publish_analysis
    from app.routers.clustering import _calculate_snapshot, _capture_analysis

    ticket, snapshot = _capture_analysis(session_id, ClusteringRequest(cycle=3))
    publish_analysis(ticket, _calculate_snapshot(snapshot))


def _reset_state(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, *, mode: str = "local") -> None:
    monkeypatch.setenv("SNP_AUTH_MODE", mode)
    monkeypatch.setenv("JWT_SECRET_KEY", "synthetic-p5-jwt-key-never-a-production-secret")
    monkeypatch.setenv("ASG_SNP_SERVICE_SECRET", "synthetic-service-secret")
    from app import db
    from app.asg_session import clear_asg_launch_state
    from app.routers import clustering, data, sample, upload

    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "p5.sqlite3"
    upload.sessions.clear()
    clustering.cluster_store.clear()
    clustering.welltype_store.clear()
    clustering.marker_store.clear()
    clustering.group_store.clear()
    data.protocol_store.clear()
    sample.sample_name_store.clear()
    clear_asg_launch_state()
    db.init_db()


def _add_user(user_id: str, username: str, role: str = "user") -> None:
    from app.db import get_db

    get_db().execute(
        "INSERT INTO users (id, username, hashed_password, display_name, role) VALUES (?, ?, ?, ?, ?)",
        (user_id, username, "!synthetic-unusable", username, role),
    )
    get_db().commit()


def _add_session(session_id: str, user_id: str) -> None:
    from app.db import save_session
    from app.routers.upload import sessions

    plate = _tiny_plate()
    sessions[session_id] = plate
    save_session(session_id, plate, filename="synthetic.xlsx", user_id=user_id)


def _token(user_id: str, username: str, role: str = "user", *, expired: bool = False) -> str:
    from app import auth

    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": user_id,
            "username": username,
            "role": role,
            "auth_mode": "local",
            "exp": now - timedelta(minutes=5) if expired else now + timedelta(minutes=20),
        },
        auth.JWT_SECRET_KEY,
        algorithm="HS256",
    )


def test_local_auth_rejects_missing_invalid_expired_and_non_admin_without_secrets(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    _reset_state(monkeypatch, tmp_path)
    _add_user("user-1", "synthetic-user")
    _add_user("admin-1", "synthetic-admin", "admin")
    from app.main import app

    with TestClient(app) as client:
        missing = client.get("/api/auth/me")
        client.cookies.set("snp_auth", "not-a-jwt")
        invalid = client.get("/api/auth/me")
        client.cookies.set("snp_auth", _token("user-1", "synthetic-user", expired=True))
        expired = client.get("/api/auth/me")
        client.cookies.set("snp_auth", _token("user-1", "synthetic-user"))
        denied = client.get("/api/admin/dashboard")

    for response in (missing, invalid, expired, denied):
        assert response.status_code in {401, 403}
        body = response.text.lower()
        assert "synthetic-p5-jwt-key" not in body
        assert "service-secret" not in body
    assert denied.status_code == 403
    assert denied.json()["detail"] == "Admin access required"


def test_asg_scope_owner_binding_and_expired_bootstrap_save_without_retry(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    _reset_state(monkeypatch, tmp_path, mode="asg_launch")
    _add_user("owner", "owner@example.test")
    _add_user("other", "other@example.test")
    _add_session("owned", "owner")
    _add_session("other-session", "other")
    from app.asg_client import ASGLaunchContext, ASGLaunchSaveCredential
    from app.asg_session import bind_session_to_current_asg_launch, remember_asg_launch
    from app.auth import create_access_token
    from app.main import app
    _publish_verified_result("owned")
    launch = ASGLaunchSaveCredential("synthetic-launch", "synthetic-save-credential")
    target = ASGLaunchContext("design_run_item", "synthetic-target", {"marker_id": "synthetic-marker"})
    remember_asg_launch("owner", target, launch, ["snp:read"], None)
    bind_session_to_current_asg_launch("owned", "owner")

    with patch("app.routers.asg.post_analysis_result") as post:
        with TestClient(app) as client:
            client.cookies.set("snp_auth", create_access_token("owner", "owner@example.test", "user"))
            no_scope = client.post("/api/asg/save-result", json={"session_id": "owned"})
            client.cookies.set("snp_auth", create_access_token("other", "other@example.test", "user"))
            cross_owner = client.post("/api/asg/save-result", json={"session_id": "owned"})
        assert no_scope.status_code == 403
        assert cross_owner.status_code == 403
        post.assert_not_called()

    # An expired bootstrap launch remains valid for a session already bound to
    # it; expiry must not erase the save credential or trigger a retry.
    remember_asg_launch(
        "owner", target, launch, ["snp:read", "snp:save_result"],
        datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    bind_session_to_current_asg_launch("owned", "owner")
    with patch("app.routers.asg.post_analysis_result", return_value={"analysis_run_id": "synthetic-run", "created": True}) as post:
        with TestClient(app) as client:
            client.cookies.set("snp_auth", create_access_token("owner", "owner@example.test", "user"))
            saved = client.post("/api/asg/save-result", json={"session_id": "owned", "selected_cycle": 3})
    assert saved.status_code == 200
    assert saved.json()["analysis_run_id"] == "synthetic-run"
    assert post.call_count == 1
    assert post.call_args.args[0]["launch"]["save_token"] == "synthetic-save-credential"


def test_cross_user_snapshot_denies_before_target_disclosure_and_missing_session_never_transports(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    _reset_state(monkeypatch, tmp_path, mode="asg_launch")
    _add_user("owner", "owner@example.test")
    _add_user("other", "other@example.test")
    _add_session("private", "other")
    from app.asg_client import ASGLaunchContext, ASGLaunchSaveCredential
    from app.asg_result import build_result_snapshot
    from app.asg_session import remember_asg_launch
    from app.auth import TokenData

    remember_asg_launch(
        "owner", ASGLaunchContext("private_target_type", "private-target", {"private": "domain-data"}),
        ASGLaunchSaveCredential("launch", "credential"), ["snp:save_result"], None,
    )
    with pytest.raises(HTTPException) as denied:
        build_result_snapshot("private", user=TokenData(user_id="owner", username="owner@example.test", role="user"))
    assert denied.value.status_code == 403
    assert "private-target" not in str(denied.value.detail)
    assert "domain-data" not in str(denied.value.detail)

    with pytest.raises(HTTPException) as missing:
        build_result_snapshot("not-loaded", user=TokenData(user_id="owner", username="owner@example.test", role="user"))
    # The access check intentionally precedes the existence check to avoid
    # turning a private session identifier into an oracle.
    assert missing.value.status_code == 403


def test_cross_user_export_routes_deny_before_rendering_or_transport(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    """Every whole-run adapter must perform the owner check first."""
    _reset_state(monkeypatch, tmp_path, mode="asg_launch")
    _add_user("owner", "owner@example.test")
    _add_user("other", "other@example.test")
    _add_session("private", "owner")
    from app.asg_client import ASGLaunchContext, ASGLaunchSaveCredential
    from app.asg_session import remember_asg_launch
    from app.auth import create_access_token
    from app.main import app

    remember_asg_launch(
        "owner",
        ASGLaunchContext("private_target_type", "private-target", {"private": "domain-data"}),
        ASGLaunchSaveCredential("launch", "credential"),
        ["snp:save_result"],
        None,
    )

    with patch("app.routers.export.render_snapshot_csv", return_value="secret-csv") as csv_render, \
         patch("app.reporting.snapshot_pdf.build_snapshot_pdf", return_value=b"secret-pdf") as pdf_render, \
         patch("app.reporting.snapshot_xlsx.build_snapshot_xlsx", return_value=b"secret-xlsx") as xlsx_render, \
         patch("app.asg_result._render_asg", return_value={"secret": "asg"}) as asg_render, \
         patch("app.routers.asg.post_analysis_result", return_value={"analysis_run_id": "unexpected"}) as post:
        with TestClient(app) as client:
            client.cookies.set("snp_auth", create_access_token("other", "other@example.test", "user"))
            responses = [
                client.get("/api/data/private/export/csv"),
                client.get("/api/data/private/export/pdf"),
                client.get("/api/data/private/export/xlsx"),
                client.post("/api/asg/save-result", json={"session_id": "private"}),
            ]

    assert [response.status_code for response in responses] == [403, 403, 403, 403]
    assert all("private-target" not in response.text for response in responses)
    assert all("domain-data" not in response.text for response in responses)
    csv_render.assert_not_called()
    pdf_render.assert_not_called()
    xlsx_render.assert_not_called()
    asg_render.assert_not_called()
    post.assert_not_called()


def test_real_process_restart_restores_owner_revision_context_and_all_analysis_state(tmp_path: Path) -> None:
    db_path = tmp_path / "restart.sqlite3"
    root = Path(__file__).resolve().parents[1]
    env = {
        **os.environ,
        "PYTHONPATH": str(root),
        "DB_PATH": str(db_path),
        "SNP_AUTH_MODE": "local",
        "JWT_SECRET_KEY": "synthetic-p5-restart-key-long-enough-for-runtime",
        "ADMIN_PASSWORD": "SyntheticRestartPassword123!",
    }
    seed = """
import json
from app import db
from app.models import ClusteringRequest, MarkerRegion, ProtocolStep, UnifiedData, WellCycleData, WellType
from app.processing.analysis_state import mutate_inputs, publish_analysis
from app.routers import clustering, data, upload
from app.routers.clustering import _calculate_snapshot, _capture_analysis
db.init_db()
db.get_db().execute("INSERT INTO users (id, username, hashed_password, display_name, role) VALUES (?, ?, ?, ?, ?)", ('restart-owner', 'restart-owner@example.test', '!synthetic-unusable', 'Restart Owner', 'user'))
db.get_db().commit()
plate = UnifiedData(
    instrument='restart', allele2_dye='HEX', wells=['A1', 'A2'], cycles=[1, 2, 3],
    data=[
        WellCycleData(well='A1', cycle=1, fam=1, allele2=2, rox=1),
        WellCycleData(well='A1', cycle=2, fam=1, allele2=2, rox=1),
        WellCycleData(well='A1', cycle=3, fam=3, allele2=1, rox=1),
        WellCycleData(well='A2', cycle=1, fam=2, allele2=1, rox=1),
        WellCycleData(well='A2', cycle=2, fam=2, allele2=1, rox=1),
        WellCycleData(well='A2', cycle=3, fam=1, allele2=3, rox=1),
    ], has_rox=True, sample_names={'A1': 'restart-sample-1', 'A2': 'restart-sample-2'},
    imported_well_types={'A2': 'NTC'}, well_groups={'parsed-group': ['A1']},
    protocol_steps=[ProtocolStep(step=1, temperature=95, duration_sec=30, cycles=1, label='synthetic protocol')],
)
upload.sessions['restart-session'] = plate
db.save_session('restart-session', plate, filename='synthetic.xlsx', user_id='restart-owner')
marker = MarkerRegion(id='restart-marker', name='restart assay', wells=['A1', 'A2'])
mutate_inputs('restart-session', markers=[marker], welltypes={'A1': WellType.ALLELE1_CONTROL.value})
db.save_well_groups('restart-session', {'manual-group': ['A2']})
data.protocol_store['restart-session'] = [ProtocolStep(step=2, temperature=60, duration_sec=45, cycles=2, label='manual protocol')]
db.save_protocol_override('restart-session', json.dumps([s.model_dump() for s in data.protocol_store['restart-session']]))
ticket, snapshot = _capture_analysis('restart-session', ClusteringRequest(cycle=3))
publish_analysis(ticket, _calculate_snapshot(snapshot))
row = db.get_db().execute('SELECT user_id, input_revision FROM sessions WHERE session_id=?', ('restart-session',)).fetchone()
print(json.dumps({'owner': row['user_id'], 'revision': row['input_revision'], 'result': True}))
"""
    restored = """
import asyncio
import json
from app.main import app, lifespan
from app.routers import clustering, data, upload
async def check():
    clustering._calculate_snapshot = lambda snapshot: (_ for _ in ()).throw(AssertionError('implicit calculation'))
    async with lifespan(app):
        plate = upload.sessions['restart-session']
        result = clustering.cluster_store['restart-session']
        context = result.analysis_context
        from app.db import get_session_owner
        print(json.dumps({
            'owner': get_session_owner('restart-session'), 'revision': plate.input_revision,
            'instrument': plate.instrument, 'wells': plate.wells,
            'markers': [m.id for m in clustering.marker_store['restart-session']],
            'welltypes': clustering.welltype_store['restart-session'],
            'groups': clustering.group_store['restart-session'],
            'protocol': data.protocol_store['restart-session'][0].label,
            'assignments': result.assignments,
            'result_revision': str(context.result_revision), 'context_revision': context.input_revision,
        }))
asyncio.run(check())
"""
    first = subprocess.run([sys.executable, "-c", seed], cwd=root, env=env, capture_output=True, text=True, check=True)
    second = subprocess.run([sys.executable, "-c", restored], cwd=root, env=env, capture_output=True, text=True)
    assert json.loads(first.stdout.strip().splitlines()[-1]) == {
        "owner": "restart-owner", "revision": 1, "result": True,
    }
    assert second.returncode == 0, second.stderr
    restored_data = json.loads(second.stdout.strip().splitlines()[-1])
    assert restored_data["owner"] == "restart-owner"
    assert restored_data["revision"] == 1
    assert restored_data["instrument"] == "restart"
    assert restored_data["wells"] == ["A1", "A2"]
    assert restored_data["markers"] == ["restart-marker"]
    assert restored_data["welltypes"] == {"A1": "Allele 1 Control"}
    assert restored_data["groups"] == {"manual-group": ["A2"]}
    assert restored_data["protocol"] == "manual protocol"
    assert restored_data["assignments"]
    assert restored_data["context_revision"] == 1
    assert restored_data["result_revision"]


def test_legacy_migration_is_idempotent_and_preserves_rows(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _reset_state(monkeypatch, tmp_path)
    from app import db

    db.save_session("legacy-session", _tiny_plate(), filename="legacy.xlsx", user_id=None)
    conn = db.get_db()
    conn.execute(
        "INSERT INTO clustering_results(session_id, labels_json, method, cycle, confidences_json) VALUES (?, ?, ?, ?, ?)",
        ("legacy-session", json.dumps({"A1": "NTC"}), "threshold", 3, json.dumps({"A1": 0.8})),
    )
    conn.execute("ALTER TABLE clustering_results DROP COLUMN result_json")
    conn.execute("DELETE FROM schema_version WHERE version > 2")
    conn.commit()
    db.init_db()
    db.init_db()
    row = db.get_db().execute("SELECT labels_json, method FROM clustering_results WHERE session_id='legacy-session'").fetchone()
    assert json.loads(row["labels_json"]) == {"A1": "NTC"}
    assert row["method"] == "threshold"
    assert db.get_db().execute("SELECT MAX(version) FROM schema_version").fetchone()[0] >= 7


def test_manual_pre_v3_sqlite_migration_reopens_twice_preserves_parent_child_and_marks_context_unknown(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Migrate an actually old on-disk schema, not a modern table with a column removed."""
    from app import db
    import sqlite3

    path = tmp_path / "manual-legacy.sqlite3"
    legacy = sqlite3.connect(path)
    legacy.executescript(
        """
        PRAGMA foreign_keys=ON;
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')));
        INSERT INTO schema_version(version) VALUES (1), (2);
        CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, hashed_password TEXT NOT NULL,
                            display_name TEXT, role TEXT NOT NULL DEFAULT 'user', is_active INTEGER NOT NULL DEFAULT 1);
        INSERT INTO users(id, username, hashed_password, display_name, role)
            VALUES ('legacy-owner', 'legacy-owner@example.test', '!synthetic-unusable', 'Legacy Owner', 'user');
        CREATE TABLE sessions (session_id TEXT PRIMARY KEY, instrument TEXT NOT NULL, num_wells INTEGER NOT NULL,
            num_cycles INTEGER NOT NULL, plate_size INTEGER DEFAULT 96, allele2_dye TEXT NOT NULL,
            has_rox INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), raw_filename TEXT,
            metadata_json TEXT, user_id TEXT REFERENCES users(id));
        CREATE TABLE well_cycle_data (session_id TEXT NOT NULL, well TEXT NOT NULL, cycle INTEGER NOT NULL,
            fam REAL NOT NULL, allele2 REAL NOT NULL, rox REAL, PRIMARY KEY(session_id, well, cycle),
            FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE);
        CREATE TABLE clustering_results (session_id TEXT PRIMARY KEY, labels_json TEXT NOT NULL,
            method TEXT NOT NULL, cycle INTEGER NOT NULL, confidences_json TEXT,
            FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE);
        CREATE TABLE manual_welltypes (session_id TEXT NOT NULL, well TEXT NOT NULL, welltype TEXT NOT NULL,
            PRIMARY KEY(session_id, well), FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE);
        CREATE TABLE sample_name_overrides (session_id TEXT NOT NULL, well TEXT NOT NULL, sample_name TEXT NOT NULL,
            PRIMARY KEY(session_id, well), FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE);
        CREATE TABLE protocol_overrides (session_id TEXT PRIMARY KEY, protocol_json TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE);
        CREATE TABLE well_groups (session_id TEXT NOT NULL, group_name TEXT NOT NULL, wells_json TEXT NOT NULL,
            PRIMARY KEY(session_id, group_name), FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE);
        INSERT INTO sessions(session_id, instrument, num_wells, num_cycles, allele2_dye, has_rox, raw_filename, metadata_json, user_id)
            VALUES ('legacy-parent', 'Legacy instrument', 1, 1, 'HEX', 1, 'legacy.xlsx', '{"sample_names":{"A1":"legacy sample"}}', 'legacy-owner');
        INSERT INTO well_cycle_data(session_id, well, cycle, fam, allele2, rox) VALUES ('legacy-parent', 'A1', 1, 11, 22, 1);
        INSERT INTO clustering_results(session_id, labels_json, method, cycle, confidences_json)
            VALUES ('legacy-parent', '{"A1":"NTC"}', 'threshold', 1, '{"A1":0.75}');
        INSERT INTO manual_welltypes(session_id, well, welltype) VALUES ('legacy-parent', 'A1', 'NTC');
        """
    )
    legacy.commit()
    legacy.close()

    monkeypatch.setenv("DB_PATH", str(path))
    db.DB_PATH = path
    db._conn = None
    db.init_db()
    first = db.load_all_sessions()
    assert len(first) == 1
    assert first[0]["unified"].input_revision == 0
    assert first[0]["unified"].wells == ["A1"]
    assert first[0]["clustering"].assignments == {"A1": "NTC"}
    assert first[0]["clustering"].analysis_context is None
    assert first[0]["welltypes"] == {"A1": "NTC"}
    assert db.get_db().execute("SELECT COUNT(*) FROM well_cycle_data WHERE session_id='legacy-parent'").fetchone()[0] == 1

    db.get_db().close()
    db._conn = None
    db.init_db()
    second = db.load_all_sessions()
    assert len(second) == 1
    assert second[0]["clustering"].analysis_context is None
    assert second[0]["clustering"].assignments == {"A1": "NTC"}
    assert db.get_db().execute("SELECT COUNT(*) FROM sessions WHERE session_id='legacy-parent'").fetchone()[0] == 1
    assert db.get_db().execute("SELECT COUNT(*) FROM well_cycle_data WHERE session_id='legacy-parent'").fetchone()[0] == 1
    assert db.get_db().execute("SELECT COUNT(*) FROM clustering_results WHERE session_id='legacy-parent'").fetchone()[0] == 1


class _FakeUpload:
    filename = "synthetic.xls"
    content_type = "application/vnd.ms-excel"

    def __init__(self, payload: bytes):
        self.payload = payload
        self.reads = 0

    async def read(self, _size: int = -1) -> bytes:
        self.reads += 1
        if self.reads == 1:
            return self.payload
        return b""


@pytest.mark.asyncio
async def test_upload_rejection_leaves_no_database_session_job_or_tempfile(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    _reset_state(monkeypatch, tmp_path)
    from app import db
    from app.routers import upload

    exact_temp_path = tmp_path / "upload-under-test.xls"

    def fake_mkstemp(*, suffix: str = "") -> tuple[int, str]:
        assert suffix == ".xls"
        fd = os.open(exact_temp_path, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
        return fd, str(exact_temp_path)

    monkeypatch.setattr(upload.tempfile, "mkstemp", fake_mkstemp)
    before_db = db.get_db().execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    before_memory = dict(upload.sessions)
    with patch.object(upload, "detect_and_parse", side_effect=ValueError("synthetic malformed upload")) as parse:
        with patch.object(upload, "create_session_from_import") as create:
            with pytest.raises(HTTPException) as error:
                await upload.upload_file(SimpleNamespace(user_id="owner"), _FakeUpload(b"synthetic"))
    assert error.value.status_code == 400
    parse.assert_called_once()
    create.assert_not_called()
    assert dict(upload.sessions) == before_memory
    assert db.get_db().execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == before_db
    assert not exact_temp_path.exists()


def _zip_file(tmp_path: Path, entries: list[tuple[str, bytes]]) -> Path:
    path = tmp_path / "synthetic.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries:
            archive.writestr(name, content)
    return path


@pytest.mark.parametrize("name", ["/absolute.xml", "..\\backslash.xml", "../relative.xml"])
def test_zip_rejects_absolute_and_traversal_paths(tmp_path: Path, name: str) -> None:
    from app.parsers.detector import _validate_zip_archive

    with zipfile.ZipFile(_zip_file(tmp_path, [(name, b"x")])) as archive:
        with pytest.raises(ValueError, match="unsafe path"):
            _validate_zip_archive(archive)


def test_zip_entry_count_and_compression_ratio_limits_and_zero_size_entry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.parsers import detector

    too_many = _zip_file(tmp_path, [(f"{i}.xml", b"x") for i in range(3)])
    monkeypatch.setattr(detector, "MAX_ZIP_ENTRIES", 2)
    with zipfile.ZipFile(too_many) as archive:
        with pytest.raises(ValueError, match="too many entries"):
            detector._validate_zip_archive(archive)

    ratio = _zip_file(tmp_path, [("ratio.xml", b"A" * 10000)])
    monkeypatch.setattr(detector, "MAX_ZIP_ENTRIES", 500)
    monkeypatch.setattr(detector, "MAX_ZIP_COMPRESSION_RATIO", 1)
    with zipfile.ZipFile(ratio) as archive:
        with pytest.raises(ValueError, match="compression ratio"):
            detector._validate_zip_archive(archive)

    zero = tmp_path / "zero.zip"
    with zipfile.ZipFile(zero, "w") as archive:
        archive.writestr("empty.xml", b"")
    with zipfile.ZipFile(zero) as archive:
        detector._validate_zip_archive(archive)
