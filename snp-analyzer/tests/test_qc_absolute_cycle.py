"""QC current plate controls use explicit coordinates, preserving legacy callers."""
from types import SimpleNamespace

import pytest

from test_marker_contract import data_client as _data_client, _plate_unified, _register

data_client = _data_client


@pytest.mark.parametrize("query,expected", [
    ("cycle=0&cycle_mode=absolute", 0),
    ("cycle=10&cycle_mode=absolute", 10),
    ("cycle=0", 40),
    ("", 40),
])
def test_qc_coordinate_mode(data_client: SimpleNamespace, query: str, expected: int) -> None:
    unified = _plate_unified()
    unified.cycles = [0, 10, 40]
    unified.data = [point.model_copy(update={"cycle": cycle}) for cycle in unified.cycles for point in unified.data]
    _register(data_client, "qc-cycle", unified)
    response = data_client.client.get(f"/api/data/qc-cycle/qc?{query}")
    assert response.status_code == 200
    assert response.json()["ntc_check"]["cycle"] == expected


@pytest.mark.parametrize("query,status", [("cycle=7&cycle_mode=absolute", 400), ("cycle_mode=invalid", 422)])
def test_qc_invalid_coordinate_mode(data_client: SimpleNamespace, query: str, status: int) -> None:
    _register(data_client, "qc-cycle", _plate_unified())
    assert data_client.client.get(f"/api/data/qc-cycle/qc?{query}").status_code == status
