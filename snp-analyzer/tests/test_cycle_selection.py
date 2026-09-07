"""Explicit cycle coordinates coexist with the legacy zero/latest sentinel."""
from types import SimpleNamespace

import pytest

from test_marker_contract import data_client as _data_client, _plate_unified, _register

data_client = _data_client


@pytest.mark.parametrize("route", ["scatter", "plate", "cluster"])
@pytest.mark.parametrize("mode,expected", [(None, 40), ("legacy_latest", 40), ("absolute", 0)])
def test_sparse_zero_selection(data_client: SimpleNamespace, route: str, mode: str | None, expected: int) -> None:
    unified = _plate_unified()
    mapping = {1: 0, 2: 10, 3: 40}
    unified.cycles = [0, 10, 40]
    for reading in unified.data:
        reading.cycle = mapping[reading.cycle]
    _register(data_client, "sparse-zero", unified)
    options: dict[str, int | str] = {"cycle": 0}
    if mode is not None:
        options["cycle_mode"] = mode
    path = f"/api/data/sparse-zero/{route}"
    response = (data_client.client.post(path, json=options) if route == "cluster"
                else data_client.client.get(path, params=options))
    assert response.status_code == 200, response.text
    assert response.json()["cycle"] == expected
    if route == "cluster":
        assert response.json()["analysis_context"]["cycle"] == expected


@pytest.mark.parametrize("route", ["scatter", "plate", "cluster"])
def test_absolute_unavailable_cycle_is_rejected(data_client: SimpleNamespace, route: str) -> None:
    _register(data_client, "missing-cycle", _plate_unified())
    options = {"cycle": 0, "cycle_mode": "absolute"}
    path = f"/api/data/missing-cycle/{route}"
    response = (data_client.client.post(path, json=options) if route == "cluster"
                else data_client.client.get(path, params=options))
    assert response.status_code == 400
    assert "Cycle 0 not available" in response.json()["detail"]
