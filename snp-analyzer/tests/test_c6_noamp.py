"""C6: No-Amp / failed-well exclusion (TDD, minimal).

A failed / no-amplification well can sit at a normal total signal level (so it
is NOT caught by the relative-NTC guard) but pinned at a ratio extreme
(~0.0/1.0). Left in the clustering input, it risks being swept into a real
extreme dosage class as a fake call.

Decision: reuse the existing ``WellType.OMIT`` well type rather than adding a
new ``NO_AMP`` type. ``run_clustering`` already excludes every well marked
Omit from the clustering input (the ``omitted`` set, see
app/routers/clustering.py::run_clustering) -- this is generic and already
covers "failed well, exclude from genotype calls" for ANY well the operator
flags as bad (spiked, no-amp, or otherwise), so a distinct NO_AMP type would
be a redundant, UI-only label with no new clustering behavior. These tests
prove: (1) an un-flagged failed well at a ratio extreme is genuinely at risk
of becoming a fake extreme-dosage call, and (2) marking it Omit removes it
from the genotype calls entirely, matching the general Omit-exclusion
contract already covered by tests/test_omit_welltype.py.
"""
from __future__ import annotations

import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user
from app.models import UnifiedData, WellCycleData


@pytest.fixture
def client(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-c6-noamp-tests",
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
    db.DB_PATH = tmp_path / "t.sqlite3"

    from app.main import app
    from app.routers import upload, clustering

    async def override():
        return TokenData(user_id="u", username="u", role="user")

    app.dependency_overrides[get_current_user] = override
    upload.sessions.clear()
    clustering.welltype_store.clear()
    clustering.cluster_store.clear()
    with TestClient(app) as c:
        yield SimpleNamespace(client=c, upload=upload, clustering=clustering, db=db)
    app.dependency_overrides.pop(get_current_user, None)
    upload.sessions.clear()
    clustering.welltype_store.clear()
    clustering.cluster_store.clear()
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _register(client, sid, unified):
    client.upload.sessions[sid] = unified
    client.db.save_session(sid, unified, filename="t.eds", user_id=None)


def _unified_with_failed_well() -> UnifiedData:
    """8 real samples (2 dosage classes, ~0.5 and ~0.9 fam-fraction) plus one
    failed/no-amp well at a normal total signal level (~1000, so it is not an
    NTC) but pinned at the ratio extreme (~0.001) -- exactly the failed-well
    shape that must not become a fake 'Allele 2 Homo' call."""
    wells = [f"S{i}" for i in range(8)] + ["FAIL1"]
    data = []
    for i in range(4):
        data.append(WellCycleData(well=f"S{i}", cycle=1, fam=500.0, allele2=500.0, rox=None))
    for i in range(4, 8):
        data.append(WellCycleData(well=f"S{i}", cycle=1, fam=900.0, allele2=100.0, rox=None))
    data.append(WellCycleData(well="FAIL1", cycle=1, fam=1.0, allele2=999.0, rox=None))
    return UnifiedData(
        instrument="QuantStudio 3", allele2_dye="VIC", wells=wells,
        cycles=[1], data=data, has_rox=False,
    )


def test_failed_well_without_omit_risks_a_fake_extreme_dosage_call(client):
    """Baseline (documents the risk this guard addresses): left un-flagged, the
    failed well at ratio~0 gets swept into a real dosage class instead of
    being excluded."""
    _register(client, "s1", _unified_with_failed_well())
    resp = client.client.post("/api/data/s1/cluster", json={"algorithm": "auto", "cycle": 1})
    assert resp.status_code == 200, resp.text
    assignments = resp.json()["assignments"]
    assert "FAIL1" in assignments
    assert assignments["FAIL1"] in ("Allele 2 Homo", "Undetermined")


def test_omit_marked_failed_well_excluded_from_genotype_calls(client):
    _register(client, "s1", _unified_with_failed_well())
    resp = client.client.post(
        "/api/data/s1/welltypes", json={"wells": ["FAIL1"], "well_type": "Omit"}
    )
    assert resp.status_code == 200, resp.text

    resp = client.client.post("/api/data/s1/cluster", json={"algorithm": "auto", "cycle": 1})
    assert resp.status_code == 200, resp.text
    assignments = resp.json()["assignments"]

    assert "FAIL1" not in assignments, "Omit-marked failed well must not receive a genotype call"
    assert set(assignments) == {f"S{i}" for i in range(8)}
