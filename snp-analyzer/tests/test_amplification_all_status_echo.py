"""The all-amplification overlay has to state what its numbers ARE.

``/api/data/{sid}/amplification/all`` used to return only ``curves`` +
``allele2_dye`` + role label metadata -- no echo of whether normalization or
background subtraction was actually applied. The frontend overlay had no
choice but to assert "normalized" straight off the *request* (``useRox`` /
``backgroundMode`` in the store), which is a lie on a run with no passive
reference: ``normalize()`` silently falls back to raw values no matter what
``use_rox`` asks for (see app/processing/normalize.py:_normalization_context).

The scatter/plate endpoints already solved this with
``normalization_applies(unified, use_rox=use_rox)`` and an echoed
``background_mode``. This file proves amplification/all follows the same,
reused, decision -- not a new one.
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
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-amp-status-echo",
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


def _unified(*, has_rox: bool, normalization_mode: str | None = None) -> UnifiedData:
    """One well, three cycles. ``has_rox`` controls whether a passive
    reference is actually present on this run -- the thing amplification/all
    has to be honest about regardless of what ``use_rox`` requests.
    """
    data = [
        WellCycleData(
            well="A1",
            cycle=cycle,
            fam=100.0 + cycle * 20,
            allele2=80.0 + cycle * 15,
            rox=50.0 if has_rox else None,
        )
        for cycle in [1, 2, 3]
    ]
    return UnifiedData(
        instrument="QuantStudio 3",
        allele2_dye="VIC",
        wells=["A1"],
        cycles=[1, 2, 3],
        data=data,
        has_rox=has_rox,
        normalization_mode=normalization_mode,
    )


def test_reference_channel_present_and_use_rox_true_reports_applied(data_client):
    data_client.upload.sessions["with-ref"] = _unified(has_rox=True)

    response = data_client.client.get(
        "/api/data/with-ref/amplification/all?use_rox=true"
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["normalization_applied"] is True
    assert payload["background_mode"] == "none"


def test_no_reference_channel_and_use_rox_true_honestly_reports_not_applied(
    data_client,
):
    """The key case: a run with no passive reference cannot be normalized no
    matter what the client asks for. Echoing the request instead of the
    outcome would tell the overlay "normalized" over raw RFU.
    """
    data_client.upload.sessions["no-ref"] = _unified(has_rox=False)

    response = data_client.client.get("/api/data/no-ref/amplification/all?use_rox=true")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["normalization_applied"] is False


def test_background_mode_echoes_the_actually_applied_mode(data_client):
    data_client.upload.sessions["with-ref"] = _unified(has_rox=True)

    response = data_client.client.get(
        "/api/data/with-ref/amplification/all?use_rox=false&background=none"
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["normalization_applied"] is False
    assert payload["background_mode"] == "none"


def test_existing_fields_are_preserved_for_backward_compatibility(data_client):
    data_client.upload.sessions["with-ref"] = _unified(has_rox=True)

    response = data_client.client.get(
        "/api/data/with-ref/amplification/all?use_rox=true"
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["allele2_dye"] == "VIC"
    assert "curves" in payload
    assert payload["curves"][0]["well"] == "A1"
    assert payload["curves"][0]["effective_type"] == "Unknown"
    assert "channel_labels" in payload
    assert "role_channel_labels" in payload
