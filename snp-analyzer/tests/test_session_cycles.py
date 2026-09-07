"""Session metadata exposes actual acquisition coordinates, not an inferred range."""

from types import SimpleNamespace

import pytest

from test_marker_contract import data_client as _data_client, _plate_unified, _register

data_client = _data_client


@pytest.mark.parametrize("cycles", [[0], [0, 10, 40], [2, 7, 101]])
def test_session_metadata_preserves_actual_cycles(data_client: SimpleNamespace, cycles: list[int]) -> None:
    unified = _plate_unified()
    unified.cycles = cycles
    _register(data_client, "actual-cycles", unified)
    response = data_client.client.get("/api/sessions/actual-cycles")
    assert response.status_code == 200
    assert response.json()["cycles"] == cycles
    assert response.json()["num_cycles"] == len(cycles)


def test_session_cycle_metadata_remains_authorized(data_client: SimpleNamespace) -> None:
    _register(data_client, "owned-cycles", _plate_unified())
    data_client.db.get_db().execute("INSERT INTO users(id,username,hashed_password) VALUES ('other','other','unusable')")
    data_client.db.get_db().execute("UPDATE sessions SET user_id='other' WHERE session_id='owned-cycles'")
    data_client.db.get_db().commit()
    response = data_client.client.get("/api/sessions/owned-cycles")
    assert response.status_code == 403
    assert "cycles" not in response.json()
