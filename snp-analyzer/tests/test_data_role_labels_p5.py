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
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-data-labels",
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


def _unified(
    *,
    allele2_dye: str = "VIC",
    role_channels: dict[str, str] | None = None,
    normalization_mode: str | None = None,
    normalization_channel: str | None = None,
    normalization_dye: str | None = None,
) -> UnifiedData:
    data = []
    for cycle in [1, 2, 3]:
        data.append(
            WellCycleData(
                well="A1",
                cycle=cycle,
                fam=100.0 + cycle * 20,
                allele2=80.0 + cycle * 15,
                rox=50.0 if normalization_channel else None,
                normalization_value=50.0 if normalization_channel else None,
            )
        )
    return UnifiedData(
        instrument="P5 Test Import" if role_channels else "QuantStudio 3",
        allele2_dye=allele2_dye,
        wells=["A1"],
        cycles=[1, 2, 3],
        data=data,
        has_rox=normalization_channel is not None,
        normalization_mode=normalization_mode,
        normalization_channel=normalization_channel,
        normalization_dye=normalization_dye,
        role_channels=role_channels,
    )


def test_imported_wt_mt_data_responses_include_role_labels_and_normalization(data_client):
    data_client.upload.sessions["imported"] = _unified(
        role_channels={"WT": "FAM", "MT1": "VIC", "normalization": "ROX"},
        normalization_mode="passive_reference",
        normalization_channel="ROX",
        normalization_dye="ROX",
    )

    for path in [
        "/api/data/imported/scatter?cycle=3",
        "/api/data/imported/plate?cycle=3",
        "/api/data/imported/amplification?wells=A1",
        "/api/data/imported/amplification/all",
        "/api/data/imported/ct",
    ]:
        response = data_client.client.get(path)
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["allele2_dye"] == "VIC"
        assert payload["channel_labels"] == {
            "fam": "WT (FAM)",
            "allele2": "MT1 (VIC)",
            "normalization": "Normalization (ROX)",
        }
        assert payload["role_channel_labels"]["WT"] == "WT (FAM)"
        assert payload["role_channel_labels"]["MT1"] == "MT1 (VIC)"
        assert payload["role_channels"]["normalization"] == "ROX"
        assert payload["normalization_mode"] == "passive_reference"
        assert payload["normalization_channel"] == "ROX"
        assert payload["normalization_dye"] == "ROX"


def test_legacy_sessions_fallback_to_fam_and_allele2_dye_labels(data_client):
    data_client.upload.sessions["legacy"] = _unified(allele2_dye="HEX")

    response = data_client.client.get("/api/data/legacy/scatter?cycle=3")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["allele2_dye"] == "HEX"
    assert payload["channel_labels"] == {
        "fam": "WT (FAM)",
        "allele2": "MT1 (HEX)",
        "normalization": None,
    }
    assert payload["role_channels"] == {"WT": "FAM", "MT1": "HEX"}


def test_compare_scatter_and_stats_include_role_labels(data_client):
    data_client.upload.sessions["imported"] = _unified(
        role_channels={"WT": "FAM", "MT1": "VIC"},
    )
    data_client.upload.sessions["legacy"] = _unified(allele2_dye="HEX")

    scatter = data_client.client.get(
        "/api/compare/scatter?sid1=imported&sid2=legacy&cycle1=3&cycle2=3"
    )
    stats = data_client.client.get(
        "/api/compare/stats?sid1=imported&sid2=legacy&cycle1=3&cycle2=3"
    )

    assert scatter.status_code == 200, scatter.text
    assert stats.status_code == 200, stats.text
    assert scatter.json()["run1"]["channel_labels"]["allele2"] == "MT1 (VIC)"
    assert scatter.json()["run2"]["channel_labels"]["allele2"] == "MT1 (HEX)"
    assert stats.json()["run1"]["allele2_dye"] == "VIC"
    assert stats.json()["run1"]["channel_labels"]["fam"] == "WT (FAM)"
