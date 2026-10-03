"""Project summary carries per-plate allele names and per-marker names."""
# ruff: noqa: F811  (the imported layouts_client fixture is re-declared as a test argument)
from tests.test_layouts import _plate_unified, _register, layouts_client  # noqa: F401

WT_MT = {"fam": "WT", "allele2": "MT"}
OTHER = {"fam": "A", "allele2": "G"}


def _markers(c, sid, markers):
    resp = c.client.post(f"/api/data/{sid}/markers", json={"markers": markers})
    assert resp.status_code == 200, resp.text


def _summary(c, sids):
    created = c.client.post("/api/projects", json={"name": "p", "session_ids": sids})
    assert created.status_code in (200, 201), created.text
    resp = c.client.get(f"/api/projects/{created.json()['id']}/summary")
    assert resp.status_code == 200, resp.text
    return {p["session_id"]: p for p in resp.json()["plates"]}


def _two(first, second):
    return [
        {"id": "m1", "name": "qA", "wells": ["A1", "A2"], "allele_labels": first},
        {"id": "m2", "name": "qB", "wells": ["A3", "A4"], "allele_labels": second},
    ]


def test_same_labels_collapse_to_one_value(layouts_client):
    _register(layouts_client, "s1", _plate_unified())
    _markers(layouts_client, "s1", _two(WT_MT, WT_MT))
    plate = _summary(layouts_client, ["s1"])["s1"]
    assert plate["allele_labels"] == WT_MT
    assert plate["markers"] == [
        {"marker_id": "m1", "name": "qA", "allele_labels": WT_MT},
        {"marker_id": "m2", "name": "qB", "allele_labels": WT_MT},
    ]


def test_differing_or_absent_labels_are_null(layouts_client):
    _register(layouts_client, "s1", _plate_unified())
    _markers(layouts_client, "s1", _two(WT_MT, OTHER))
    _register(layouts_client, "s2", _plate_unified())
    _markers(layouts_client, "s2", _two(WT_MT, None))
    _register(layouts_client, "s3", _plate_unified())
    plates = _summary(layouts_client, ["s1", "s2", "s3"])
    assert plates["s1"]["allele_labels"] is None
    assert plates["s2"]["allele_labels"] is None
    assert plates["s3"]["allele_labels"] is None
    assert plates["s3"]["markers"] == []


def test_single_marker_value_is_used(layouts_client):
    _register(layouts_client, "s1", _plate_unified())
    _markers(layouts_client, "s1", [{"id": "m1", "name": "qA", "wells": ["A1"], "allele_labels": WT_MT}])
    assert _summary(layouts_client, ["s1"])["s1"]["allele_labels"] == WT_MT
