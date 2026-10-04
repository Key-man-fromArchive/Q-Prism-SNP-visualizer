"""``/api/data/{sid}/amplification`` with several wells.

The endpoint groups normalized points by well once instead of rescanning all
points per requested well (multi-well curves plan, T0b). The response must be
unchanged: curves in request order, each identical to its single-well
response, wells without points omitted, duplicates kept as requested.
"""

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
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-amp-multi-well",
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

    async def current_user_override():
        return TokenData(user_id="user-1", username="user1", role="user")

    app.dependency_overrides[get_current_user] = current_user_override
    upload.sessions.clear()

    with TestClient(app) as client:
        yield SimpleNamespace(client=client, upload=upload)

    app.dependency_overrides.pop(get_current_user, None)
    upload.sessions.clear()
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _unified() -> UnifiedData:
    """Three wells, points interleaved across wells and stored out of cycle
    order, so grouping and per-well cycle sorting are both exercised."""
    wells = ["A1", "A2", "B1"]
    data = []
    for cycle in [3, 1, 2]:
        for i, well in enumerate(wells):
            data.append(
                WellCycleData(
                    well=well,
                    cycle=cycle,
                    fam=100.0 + cycle * 20 + i * 7,
                    allele2=80.0 + cycle * 15 - i * 3,
                    rox=50.0 + i,
                )
            )
    return UnifiedData(
        instrument="QuantStudio 3",
        allele2_dye="VIC",
        wells=wells,
        cycles=[1, 2, 3],
        data=data,
        has_rox=True,
    )


def test_multi_well_request_returns_curves_in_request_order(data_client):
    data_client.upload.sessions["s"] = _unified()
    client = data_client.client

    multi = client.get("/api/data/s/amplification?wells=B1,Z9,A1,A2")
    assert multi.status_code == 200, multi.text
    curves = multi.json()["curves"]

    # Unknown well Z9 omitted; remaining curves in request order.
    assert [c["well"] for c in curves] == ["B1", "A1", "A2"]

    for curve in curves:
        single = client.get(f"/api/data/s/amplification?wells={curve['well']}")
        assert single.status_code == 200, single.text
        assert single.json()["curves"] == [curve]
        assert curve["cycles"] == [1, 2, 3]


def test_multi_well_request_keeps_duplicates_and_rejects_empty(data_client):
    data_client.upload.sessions["s"] = _unified()
    client = data_client.client

    dup = client.get("/api/data/s/amplification?wells=A2,A2")
    assert dup.status_code == 200, dup.text
    assert [c["well"] for c in dup.json()["curves"]] == ["A2", "A2"]

    assert client.get("/api/data/s/amplification?wells=").status_code == 400
    assert client.get("/api/data/s/amplification?wells=,%20,").status_code == 400
