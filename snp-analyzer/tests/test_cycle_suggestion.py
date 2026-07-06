"""Tests for optimal-cycle suggestion (NTC-rise boundary) and its endpoint."""

import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user
from app.models import DataWindow, UnifiedData, WellCycleData
from app.processing.ntc_detection import compute_cycle_suggestion


def _unified_with_amp(n_cycles: int = 12) -> UnifiedData:
    """Real (rising) wells + flat NTC wells over an amplification window."""
    cycles = list(range(1, n_cycles + 1))
    data: list[WellCycleData] = []

    # 6 amplifying wells: signal grows strongly with cycle
    for i in range(6):
        well = f"A{i + 1}"
        for c in cycles:
            val = 10.0 + c * c * 3.0  # clearly rising
            data.append(WellCycleData(well=well, cycle=c, fam=val, allele2=val * 0.6, rox=None))

    # 2 NTC wells: stay flat (no amplification) the whole run
    for i in range(2):
        well = f"H{i + 1}"
        for c in cycles:
            data.append(WellCycleData(well=well, cycle=c, fam=5.0, allele2=5.0, rox=None))

    return UnifiedData(
        instrument="QuantStudio 3",
        allele2_dye="VIC",
        wells=[f"A{i + 1}" for i in range(6)] + ["H1", "H2"],
        cycles=cycles,
        data=data,
        has_rox=False,
        data_windows=[DataWindow(name="Amplification", start_cycle=1, end_cycle=n_cycles)],
    )


def test_no_ntc_contamination_suggests_last_cycle():
    unified = _unified_with_amp(12)
    result = compute_cycle_suggestion(unified)
    assert result["amp_start"] == 1
    assert result["amp_end"] == 12
    # Flat NTC → no onset → suggest the last amplification cycle
    assert result["ntc_onset_cycle"] is None
    assert result["suggested_cycle"] == 12
    assert result["ntc_wells"]  # NTC wells were detected


def _unified_three_clusters(n_cycles: int = 12) -> UnifiedData:
    """Three well-separated genotype clusters + NTC, so separation is scored."""
    cycles = list(range(1, n_cycles + 1))
    data: list[WellCycleData] = []
    groups = {
        "allele1": (100.0, 10.0),
        "allele2": (10.0, 100.0),
        "het": (60.0, 60.0),
    }
    wells: list[str] = []
    row = "ABC"
    for gi, (fam, a2) in enumerate(groups.values()):
        for j in range(3):
            w = f"{row[gi]}{j + 1}"
            wells.append(w)
            for c in cycles:
                data.append(WellCycleData(well=w, cycle=c, fam=fam, allele2=a2, rox=None))
    for j in range(2):  # NTC
        w = f"H{j + 1}"
        wells.append(w)
        for c in cycles:
            data.append(WellCycleData(well=w, cycle=c, fam=2.0, allele2=2.0, rox=None))

    return UnifiedData(
        instrument="QuantStudio 3",
        allele2_dye="VIC",
        wells=wells,
        cycles=cycles,
        data=data,
        has_rox=False,
        data_windows=[DataWindow(name="Amplification", start_cycle=1, end_cycle=n_cycles)],
    )


def test_separation_picks_cycle_within_window():
    unified = _unified_three_clusters(12)
    result = compute_cycle_suggestion(unified)
    # A real cycle inside the amplification window, past the early baseline floor
    assert result["suggested_cycle"] is not None
    assert result["amp_start"] <= result["suggested_cycle"] <= result["amp_end"]
    # Window is 1..12, so the baseline floor is ~cycle 6; must not pick a baseline cycle
    assert result["suggested_cycle"] >= result["amp_start"] + 4


def test_no_amplification_window_returns_none():
    unified = _unified_with_amp(12)
    unified.data_windows = None
    result = compute_cycle_suggestion(unified)
    assert result["suggested_cycle"] is None


@pytest.fixture
def data_client(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-cycle-tests",
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


def test_suggest_cycle_endpoint(data_client):
    import app.db as db

    unified = _unified_with_amp(12)
    data_client.upload.sessions["s1"] = unified
    db.save_session("s1", unified, filename="t.eds", user_id=None)

    resp = data_client.client.get("/api/data/s1/suggest-cycle")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["suggested_cycle"] == 12
    assert set(body.keys()) >= {
        "suggested_cycle",
        "ntc_onset_cycle",
        "ntc_wells",
        "amp_start",
        "amp_end",
    }
