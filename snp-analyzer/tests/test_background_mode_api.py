"""The background mode is offered, and enforced, per run.

Some modes distort a run rather than baseline it — a per-cycle plate floor
reshapes a multi-read curve instead of offsetting it, and erased a well's Ct
outright in testing. The rule lives in app/processing/background.py; these
tests cover the two places it has to reach: the session info the client builds
its selector from, and the API refusing a mode it was asked for anyway.
"""
import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user
from app.models import DataWindow, UnifiedData, WellCycleData


def _endpoint_plate() -> UnifiedData:
    """One plate read — the assay's normal mode."""
    data = [
        WellCycleData(well=w, cycle=1, fam=f, allele2=a, rox=None)
        for w, f, a in (("A1", 3351.0, 2402.0), ("G1", 3162.0, 2841.0), ("H1", 2832.0, 2271.0))
    ]
    return UnifiedData(
        instrument="CFX Opus (raw)", allele2_dye="HEX", wells=["A1", "G1", "H1"],
        cycles=[1], data=data, has_rox=False, background_mode="none",
        data_windows=[DataWindow(name="Amplification", start_cycle=1, end_cycle=1)],
    )


def _amplification_run(with_pre_read: bool) -> UnifiedData:
    data: list[WellCycleData] = []
    for c in range(1, 6):
        for w, amp in (("A1", 1200.0), ("H1", 60.0)):
            data.append(WellCycleData(well=w, cycle=c, fam=3000.0 + amp * c,
                                      allele2=3000.0, rox=None))
    windows = [DataWindow(name="Amplification", start_cycle=2, end_cycle=5)]
    if with_pre_read:
        windows.insert(0, DataWindow(name="Pre-read", start_cycle=1, end_cycle=1))
    return UnifiedData(
        instrument="CFX Opus (raw)", allele2_dye="HEX", wells=["A1", "H1"],
        cycles=[1, 2, 3, 4, 5], data=data, has_rox=False, background_mode="none",
        data_windows=windows,
    )


@pytest.fixture
def client(tmp_path):
    env = patch.dict(os.environ, {
        "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-background-modes",
        "ADMIN_PASSWORD": "StrongerOperatorPassword123!",
        "SNP_AUTH_MODE": "local",
    }, clear=False)
    env.start()
    import app.db as db
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "t.sqlite3"
    from app.main import app
    from app.routers import upload, clustering

    async def override():
        return TokenData(user_id="u", username="u", role="user")
    app.dependency_overrides[get_current_user] = override
    upload.sessions.clear(); clustering.welltype_store.clear(); clustering.cluster_store.clear()
    with TestClient(app) as c:
        yield SimpleNamespace(client=c, upload=upload, db=db)
    app.dependency_overrides.pop(get_current_user, None)
    upload.sessions.clear(); clustering.welltype_store.clear(); clustering.cluster_store.clear()
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _register(client, sid, unified):
    client.upload.sessions[sid] = unified
    client.db.save_session(sid, unified, filename="t.pcrd", user_id=None)


def test_session_info_says_which_modes_this_run_allows(client):
    _register(client, "end", _endpoint_plate())
    _register(client, "amp", _amplification_run(with_pre_read=True))
    _register(client, "late", _amplification_run(with_pre_read=False))

    def modes(sid):
        r = client.client.get(f"/api/sessions/{sid}")
        assert r.status_code == 200, r.text
        return r.json()["background_modes"]

    assert modes("end") == ["none", "channel_min"]
    assert modes("amp") == ["none", "pre_read"]
    assert modes("late") == ["none"]


def test_a_mode_the_run_cannot_be_read_with_is_a_400_not_a_500(client):
    _register(client, "amp", _amplification_run(with_pre_read=True))
    r = client.client.get("/api/data/amp/scatter?cycle=5&background=channel_min")
    assert r.status_code == 400, r.text
    assert "not valid for this run" in r.json()["detail"]


def test_an_allowed_mode_goes_through(client):
    _register(client, "amp", _amplification_run(with_pre_read=True))
    r = client.client.get("/api/data/amp/scatter?cycle=5&use_rox=false&background=pre_read")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["background_mode"] == "pre_read"
    # cycle 5 minus the pre-read: 1200*5 - 1200*1 for A1.
    fam = {p["well"]: p["norm_fam"] for p in body["points"]}
    assert fam["A1"] == pytest.approx(4800.0)


def test_raw_is_always_allowed_and_is_the_default(client):
    _register(client, "late", _amplification_run(with_pre_read=False))
    default = client.client.get("/api/data/late/scatter?cycle=5&use_rox=false")
    explicit = client.client.get("/api/data/late/scatter?cycle=5&use_rox=false&background=none")
    assert default.status_code == explicit.status_code == 200
    assert default.json()["points"] == explicit.json()["points"]
    assert default.json()["background_mode"] == "none"
    # Untouched: 3000 + 1200*5.
    fam = {p["well"]: p["norm_fam"] for p in default.json()["points"]}
    assert fam["A1"] == pytest.approx(9000.0)


def test_an_unknown_mode_is_rejected_at_the_edge(client):
    _register(client, "end", _endpoint_plate())
    r = client.client.get("/api/data/end/scatter?background=first_cycle")
    assert r.status_code == 422  # the Literal never reaches apply_background
