"""Tests for the 'Omit' well type: wells marked Omit have data but must be
excluded from auto-clustering (so a bad/spiked reading can't skew results)."""

import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user
from app.models import UnifiedData, WellCycleData


@pytest.fixture
def data_client(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-omit-tests",
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
    db.DB_PATH = tmp_path / "test.sqlite3"

    from app.main import app
    from app.routers import upload
    from app.routers import clustering

    async def current_user_override():
        return TokenData(user_id="user-1", username="user1", role="user")

    app.dependency_overrides[get_current_user] = current_user_override
    upload.sessions.clear()
    clustering.welltype_store.clear()
    clustering.cluster_store.clear()

    with TestClient(app) as client:
        yield SimpleNamespace(client=client, upload=upload, clustering=clustering)

    app.dependency_overrides.pop(get_current_user, None)
    upload.sessions.clear()
    clustering.welltype_store.clear()
    clustering.cluster_store.clear()
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _register(data_client, sid: str, unified: UnifiedData):
    """Register a session both in-memory and in the DB (satisfies FK constraints)."""
    import app.db as db

    data_client.upload.sessions[sid] = unified
    # user_id=None keeps the FK happy and, in local mode, an unowned session
    # is accessible (see check_session_access).
    db.save_session(sid, unified, filename="test.eds", user_id=None)


def _multi_well_unified() -> UnifiedData:
    # Three wells with plain fluorescence readings across 3 cycles.
    data = []
    wells = ["A1", "A2", "A3"]
    for w in wells:
        for cycle in [1, 2, 3]:
            data.append(
                WellCycleData(
                    well=w,
                    cycle=cycle,
                    fam=100.0 + cycle * 20,
                    allele2=80.0 + cycle * 15,
                    rox=None,
                )
            )
    return UnifiedData(
        instrument="QuantStudio 3",
        allele2_dye="VIC",
        wells=wells,
        cycles=[1, 2, 3],
        data=data,
        has_rox=False,
    )


def test_omit_is_accepted_as_well_type(data_client):
    _register(data_client, "s1", _multi_well_unified())
    resp = data_client.client.post(
        "/api/data/s1/welltypes", json={"wells": ["A2"], "well_type": "Omit"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["assignments"]["A2"] == "Omit"


def test_omitted_well_excluded_from_clustering(data_client):
    _register(data_client, "s1", _multi_well_unified())

    # Mark A2 as omitted
    data_client.client.post(
        "/api/data/s1/welltypes", json={"wells": ["A2"], "well_type": "Omit"}
    )

    resp = data_client.client.post(
        "/api/data/s1/cluster", json={"algorithm": "threshold", "cycle": 3}
    )
    assert resp.status_code == 200, resp.text
    assignments = resp.json()["assignments"]

    assert "A2" not in assignments, "omitted well must not receive a cluster call"
    assert "A1" in assignments
    assert "A3" in assignments


def test_non_omitted_wells_all_clustered(data_client):
    _register(data_client, "s1", _multi_well_unified())

    resp = data_client.client.post(
        "/api/data/s1/cluster", json={"algorithm": "threshold", "cycle": 3}
    )
    assert resp.status_code == 200, resp.text
    assignments = resp.json()["assignments"]

    assert {"A1", "A2", "A3"} <= set(assignments.keys())
