"""Tests for control-well anchoring and control/NTC QC warnings (Phase 2)."""

import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user
from app.models import UnifiedData, WellCycleData
from app.processing.clustering import cluster_auto


def test_control_wells_are_honored_and_excluded_from_clustering():
    pts = [{"well": f"A{i}", "norm_fam": 0.92, "norm_allele2": 0.08} for i in range(10)]
    pts += [{"well": f"H{i}", "norm_fam": 0.60, "norm_allele2": 0.40} for i in range(10)]
    pts += [{"well": f"B{i}", "norm_fam": 0.30, "norm_allele2": 0.70} for i in range(10)]
    # A positive control that sits in the Allele 1 cloud, and an NTC.
    pts += [{"well": "PC1", "norm_fam": 0.93, "norm_allele2": 0.07},
            {"well": "NTC1", "norm_fam": 0.02, "norm_allele2": 0.02}]

    assign, conf = cluster_auto(
        pts, control_wells={"PC1": "Positive Control", "NTC1": "NTC"}
    )
    assert assign["PC1"] == "Positive Control"
    assert assign["NTC1"] == "NTC"
    # The genotype clusters are unaffected by the controls.
    assert all(assign[f"A{i}"] == "Allele 1 Homo" for i in range(10))
    assert all(assign[f"H{i}"] == "Heterozygous" for i in range(10))
    assert all(assign[f"B{i}"] == "Allele 2 Homo" for i in range(10))


def _unified(extra: list[tuple[str, float, float]]) -> UnifiedData:
    """Three genotype clusters (strong signal) plus caller-supplied extra wells."""
    data: list[WellCycleData] = []
    wells: list[str] = []
    base = [("A", 0.92, 0.08), ("H", 0.60, 0.40), ("B", 0.30, 0.70)]
    for prefix, fam, a2 in base:
        for i in range(8):
            w = f"{prefix}{i}"
            wells.append(w)
            data.append(WellCycleData(well=w, cycle=1, fam=fam, allele2=a2, rox=None))
    for w, fam, a2 in extra:
        wells.append(w)
        data.append(WellCycleData(well=w, cycle=1, fam=fam, allele2=a2, rox=None))
    return UnifiedData(
        instrument="QuantStudio 3", allele2_dye="VIC", wells=wells,
        cycles=[1], data=data, has_rox=False,
    )


@pytest.fixture
def client(tmp_path):
    env = patch.dict(os.environ, {
        "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-control-qc",
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
        yield SimpleNamespace(client=c, upload=upload, clustering=clustering, db=db)
    app.dependency_overrides.pop(get_current_user, None)
    upload.sessions.clear(); clustering.welltype_store.clear(); clustering.cluster_store.clear()
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _register(client, sid, unified):
    client.upload.sessions[sid] = unified
    client.db.save_session(sid, unified, filename="t.eds", user_id=None)


def test_qc_flags_contaminated_ntc(client):
    # An NTC well as bright as the real samples (contamination).
    _register(client, "s1", _unified([("NTCbad", 0.90, 0.06)]))
    client.clustering.welltype_store["s1"] = {"NTCbad": "NTC"}
    resp = client.client.get("/api/data/s1/qc?cycle=1&use_rox=false")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ntc_check"]["ok"] is False
    assert any("NTCbad" in w for w in body["warnings"])


def test_qc_flags_failed_positive_control(client):
    # A positive control with no signal -> should be flagged as a failed control.
    _register(client, "s1", _unified([("PCdead", 0.0, 0.0)]))
    client.clustering.welltype_store["s1"] = {"PCdead": "Positive Control"}
    resp = client.client.get("/api/data/s1/qc?cycle=1&use_rox=false")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert any("PCdead" in w for w in body["warnings"])
