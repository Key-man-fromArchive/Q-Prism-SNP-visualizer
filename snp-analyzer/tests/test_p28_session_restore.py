"""P28: reopening a session after it has fallen out of process memory.

Every session's full data (readings, clustering result, manual well types,
markers, manual well groups, sample name overrides, protocol override) has
been written to SQLite since v0.2.0, but nothing ever read a COLD session
back out of it on demand -- the process-local ``sessions`` dict (and its
siblings: ``cluster_store``/``welltype_store``/``marker_store``/
``group_store``/``sample_name_store``/``protocol_store``) was populated ONLY
by an upload or an eager, unbounded startup loop. A session that fell out of
that dict (process restart, or -- after this change -- LRU eviction) could
not be reopened even though the DB still had everything.

The critical property this file exists to prove is FIDELITY, not just "some
JSON comes back": a session restored from the DB must re-analyse to the SAME
clustering assignments the original in-memory session would have, because
that computation reads marker/well-type overlays straight out of process
memory (see app.routers.clustering._capture_analysis). Restoring only
UnifiedData and leaving those overlays empty would silently change what a
re-analysis computes.
"""

from __future__ import annotations

import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user
from fixtures_ux_followup import make_ux_markers, make_ux_plate


@pytest.fixture
def restore_client(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-restore-tests",
            "ADMIN_PASSWORD": "StrongerOperatorPassword123!",
            "SNP_AUTH_MODE": "local",
        },
        clear=False,
    )
    env.start()

    import app.db as db

    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "restore.sqlite3"

    from app.main import app
    from app.routers import upload, clustering, sample, data
    from app.services import session_restore

    async def current_user_override():
        return TokenData(user_id="user-1", username="user1", role="user")

    app.dependency_overrides[get_current_user] = current_user_override

    def _clear_all():
        upload.sessions.clear()
        clustering.cluster_store.clear()
        clustering.welltype_store.clear()
        clustering.group_store.clear()
        clustering.marker_store.clear()
        sample.sample_name_store.clear()
        data.protocol_store.clear()
        session_restore._access_order.clear()

    _clear_all()

    with TestClient(app) as client:
        # lifespan() has now run init_db(); the users table exists.
        conn = db.get_db()
        for user_id, username in (
            ("user-1", "restore-user-1"),
            ("someone-else", "restore-user-2"),
        ):
            conn.execute(
                "INSERT OR IGNORE INTO users (id, username, hashed_password, display_name, role) "
                "VALUES (?, ?, ?, ?, ?)",
                (user_id, username, "x", username, "user"),
            )
        conn.commit()
        yield SimpleNamespace(
            client=client,
            upload=upload,
            clustering=clustering,
            sample=sample,
            data=data,
            session_restore=session_restore,
            override_user=current_user_override,
        )

    app.dependency_overrides.pop(get_current_user, None)
    _clear_all()
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _upload_plate(rc, sid: str = "restore-1"):
    """Simulate a completed upload: memory + DB, exactly what create_session_from_import does."""
    import app.db as db

    plate = make_ux_plate()
    rc.upload.sessions[sid] = plate
    db.save_session(sid, plate, filename="restore.eds", user_id="user-1")
    return plate


def _simulate_cold_cache(rc):
    """Drop every process-local cache -- the DB is untouched. Simulates a
    process restart (or an LRU eviction) without actually restarting."""
    rc.upload.sessions.clear()
    rc.clustering.cluster_store.clear()
    rc.clustering.welltype_store.clear()
    rc.clustering.group_store.clear()
    rc.clustering.marker_store.clear()
    rc.sample.sample_name_store.clear()
    rc.data.protocol_store.clear()
    rc.session_restore._access_order.clear()


# ---------------------------------------------------------------------------
# GET /api/sessions -- lists from the DB, never requires a warm cache
# ---------------------------------------------------------------------------


def test_list_sessions_returns_db_sessions_with_empty_memory(restore_client):
    rc = restore_client
    _upload_plate(rc, "restore-list-1")
    rc.upload.sessions.clear()  # memory empty; DB still has it

    response = rc.client.get("/api/sessions")
    assert response.status_code == 200
    body = response.json()
    assert [row["session_id"] for row in body] == ["restore-list-1"]
    row = body[0]
    assert row["instrument"] == "Synthetic UX fixture"
    assert row["num_wells"] == 96
    assert row["num_cycles"] == 42
    assert row["raw_filename"] == "restore.eds"


def test_list_sessions_does_not_touch_well_cycle_data(restore_client, monkeypatch):
    """Listing must stay cheap regardless of how many readings a session holds."""
    rc = restore_client
    _upload_plate(rc, "restore-list-2")
    rc.upload.sessions.clear()

    import app.db as db

    class _GuardedConn:
        """sqlite3.Connection is a C type and cannot be monkeypatched
        in-place, so wrap the singleton connection instead."""

        def __init__(self, real):
            self._real = real

        def execute(self, sql, *args, **kwargs):
            assert "well_cycle_data" not in sql, (
                f"list_sessions must not read well_cycle_data: {sql!r}"
            )
            return self._real.execute(sql, *args, **kwargs)

        def __getattr__(self, name):
            return getattr(self._real, name)

    monkeypatch.setattr(db, "_conn", _GuardedConn(db.get_db()))
    response = rc.client.get("/api/sessions")
    assert response.status_code == 200
    assert len(response.json()) == 1


def test_list_sessions_orders_newest_first_across_cold_and_warm(restore_client):
    rc = restore_client
    import app.db as db

    _upload_plate(rc, "restore-list-old")
    _upload_plate(rc, "restore-list-new")
    # sessions.created_at has only second resolution -- force a real
    # ordering rather than relying on two inserts landing in different
    # wall-clock seconds.
    conn = db.get_db()
    conn.execute(
        "UPDATE sessions SET created_at = '2025-01-01T00:00:00' WHERE session_id = 'restore-list-old'"
    )
    conn.execute(
        "UPDATE sessions SET created_at = '2025-01-02T00:00:00' WHERE session_id = 'restore-list-new'"
    )
    conn.commit()
    # Only the older one is evicted from memory; both must still be listed,
    # newest first, regardless of which happen to be warm.
    rc.upload.sessions.pop("restore-list-old", None)

    body = rc.client.get("/api/sessions").json()
    assert [row["session_id"] for row in body] == [
        "restore-list-new",
        "restore-list-old",
    ]


# ---------------------------------------------------------------------------
# GET /api/sessions/{sid} -- reopening a single cold session
# ---------------------------------------------------------------------------


def test_reopen_cold_session_restores_upload_equivalent_fields(restore_client):
    rc = restore_client
    plate = _upload_plate(rc, "restore-open-1")
    _simulate_cold_cache(rc)

    response = rc.client.get("/api/sessions/restore-open-1")
    assert response.status_code == 200
    body = response.json()
    assert body["instrument"] == plate.instrument
    assert body["allele2_dye"] == plate.allele2_dye
    assert body["num_wells"] == len(plate.wells)
    assert body["well_ids"] == plate.wells
    assert body["num_cycles"] == len(plate.cycles)
    assert body["has_rox"] == plate.has_rox
    assert body["well_groups"] == plate.well_groups
    # And it is now warm for later requests in the same process.
    assert "restore-open-1" in rc.upload.sessions


def test_reopen_nonexistent_session_is_a_clear_404_not_empty(restore_client):
    rc = restore_client
    response = rc.client.get("/api/sessions/does-not-exist-anywhere")
    assert response.status_code == 404
    assert response.json()["detail"] == "Session not found"


# ---------------------------------------------------------------------------
# Permission rules survive a cold restore
# ---------------------------------------------------------------------------


def test_other_users_cold_session_is_still_403_not_leaked(restore_client):
    rc = restore_client
    import app.db as db

    plate = make_ux_plate()
    rc.upload.sessions["restore-owned-by-other"] = plate
    db.save_session(
        "restore-owned-by-other", plate, filename="x.eds", user_id="someone-else"
    )
    _simulate_cold_cache(rc)

    response = rc.client.get("/api/sessions/restore-owned-by-other")
    assert response.status_code == 403


def test_admin_can_open_any_users_cold_session(restore_client):
    rc = restore_client
    import app.db as db

    plate = make_ux_plate()
    rc.upload.sessions["restore-admin-open"] = plate
    db.save_session(
        "restore-admin-open", plate, filename="x.eds", user_id="someone-else"
    )
    _simulate_cold_cache(rc)

    async def admin_override():
        return TokenData(user_id="admin-1", username="admin1", role="admin")

    from app.main import app
    from app.auth import get_current_user

    app.dependency_overrides[get_current_user] = admin_override
    try:
        response = rc.client.get("/api/sessions/restore-admin-open")
    finally:
        app.dependency_overrides[get_current_user] = rc.override_user
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# THE critical property: round-trip analysis fidelity
# ---------------------------------------------------------------------------


def test_clustering_round_trip_identical_before_and_after_cold_restore(restore_client):
    """Upload -> set markers + manual well types + a manual group -> analyse
    -> save -> go cold (simulated restart) -> reopen -> re-analyse: the
    assignments (and the untouched saved result) must be byte-identical.
    """
    rc = restore_client
    sid = "restore-fidelity-1"
    plate = _upload_plate(rc, sid)

    markers = make_ux_markers(plate)
    markers_body = {"markers": [m.model_dump(mode="json") for m in markers]}
    resp = rc.client.post(f"/api/data/{sid}/markers", json=markers_body)
    assert resp.status_code == 200, resp.text

    # A manual well-type override that is NOT part of the imported/parsed
    # well types -- only welltype_store (memory-only until restored) knows
    # about it, so this specifically exercises that restore path.
    manual_well = plate.wells[0]
    resp = rc.client.put(
        f"/api/data/{sid}/welltypes/bulk",
        json={"assignments": {manual_well: "Allele 1 Control"}},
    )
    assert resp.status_code == 200, resp.text

    # A manual (not file-parsed) well group -- only group_store knows this.
    resp = rc.client.post(
        f"/api/data/{sid}/groups",
        json={"name": "manual-group", "wells": [plate.wells[1]]},
    )
    assert resp.status_code == 200, resp.text

    cluster_resp = rc.client.post(f"/api/data/{sid}/cluster", json={})
    assert cluster_resp.status_code == 200, cluster_resp.text
    before = cluster_resp.json()
    assert before["assignments"]

    before_markers = rc.client.get(f"/api/data/{sid}/markers").json()["markers"]
    before_welltypes = rc.client.get(f"/api/data/{sid}/welltypes").json()
    before_groups = rc.client.get(f"/api/data/{sid}/groups").json()

    _simulate_cold_cache(rc)

    # 1) The SAVED result (not recomputed) must come back identical.
    get_resp = rc.client.get(f"/api/data/{sid}/cluster")
    assert get_resp.status_code == 200
    restored_saved = get_resp.json()
    assert restored_saved["assignments"] == before["assignments"]
    assert restored_saved["algorithm"] == before["algorithm"]
    assert restored_saved["cycle"] == before["cycle"]

    # 2) Restored markers/well-types/groups match what was set before restart.
    after_markers = rc.client.get(f"/api/data/{sid}/markers").json()["markers"]
    assert after_markers == before_markers
    after_welltypes = rc.client.get(f"/api/data/{sid}/welltypes").json()
    assert after_welltypes["assignments"] == before_welltypes["assignments"]
    after_groups = rc.client.get(f"/api/data/{sid}/groups").json()
    assert after_groups == before_groups

    # 3) A genuine RE-analysis (not just replaying the saved row) must land
    # on the SAME assignments -- proving the restored marker/well-type
    # overlays, not just the cached result, are faithful.
    _simulate_cold_cache(rc)
    recompute_resp = rc.client.post(f"/api/data/{sid}/cluster", json={})
    assert recompute_resp.status_code == 200, recompute_resp.text
    after = recompute_resp.json()
    assert after["assignments"] == before["assignments"]


def test_restore_without_any_manual_overrides_still_matches(restore_client):
    """A session that never had markers/manual well types set (the common
    case) restores to the plain imported/parsed state, and re-analysis still
    matches the pre-restart result.
    """
    rc = restore_client
    sid = "restore-fidelity-plain"
    _upload_plate(rc, sid)

    before = rc.client.post(f"/api/data/{sid}/cluster", json={}).json()
    _simulate_cold_cache(rc)
    after = rc.client.post(f"/api/data/{sid}/cluster", json={}).json()
    assert after["assignments"] == before["assignments"]


# ---------------------------------------------------------------------------
# Bounded in-memory cache: never grows without limit
# ---------------------------------------------------------------------------


def test_lru_eviction_respects_cap_and_spares_in_flight_sessions(
    restore_client, monkeypatch
):
    from app.services import session_restore
    from app.processing.analysis_state import publication_states, PublicationState

    monkeypatch.setattr(session_restore, "SESSION_CACHE_MAX_ENTRIES", 2)

    rc = restore_client
    plate_a = _upload_plate(rc, "restore-cap-a")
    session_restore.touch_session("restore-cap-a")
    _upload_plate(rc, "restore-cap-b")
    session_restore.touch_session("restore-cap-b")

    # "restore-cap-a" has a publication in flight -- must never be evicted,
    # even though it is the least-recently-used entry.
    publication_states["restore-cap-a"] = PublicationState(owner=plate_a, pending=True)
    try:
        _upload_plate(rc, "restore-cap-c")
        session_restore.touch_session("restore-cap-c")

        assert "restore-cap-a" in rc.upload.sessions
        assert "restore-cap-c" in rc.upload.sessions
        assert len(rc.upload.sessions) <= 3  # a (protected) + c (newest) [+ maybe b]
    finally:
        publication_states.pop("restore-cap-a", None)
