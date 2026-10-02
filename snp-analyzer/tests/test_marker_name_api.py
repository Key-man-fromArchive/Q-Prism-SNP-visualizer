"""Strict marker names on input paths: markers API, layout apply and instrument import."""
# ruff: noqa: F811  (the imported layouts_client fixture is re-declared as a test argument)
import pytest

from app.services.import_session import _build_imported_marker_regions
from tests.test_layouts import _plate_unified, _register, layouts_client  # noqa: F401

BAD_NAMES = ["a\x00b", "a\nb", "‮x", "a​b", "   "]


def _marker(name, marker_id="m1"):
    return {"id": marker_id, "name": name, "wells": ["A1", "A2"], "ploidy": 2}


@pytest.mark.parametrize("bad", BAD_NAMES)
def test_post_rejects_control_and_blank_names(layouts_client, bad):
    _register(layouts_client, "s1", _plate_unified())
    resp = layouts_client.client.post("/api/data/s1/markers", json={"markers": [_marker(bad)]})
    assert resp.status_code == 400, resp.text


def test_post_strips_surrounding_whitespace(layouts_client):
    _register(layouts_client, "s1", _plate_unified())
    resp = layouts_client.client.post("/api/data/s1/markers", json={"markers": [_marker("  qA \t")]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["markers"][0]["name"] == "qA"


@pytest.mark.parametrize("bad", BAD_NAMES)
def test_put_rejects_control_and_blank_names(layouts_client, bad):
    _register(layouts_client, "s1", _plate_unified())
    layouts_client.client.post("/api/data/s1/markers", json={"markers": [_marker("qA")]})
    resp = layouts_client.client.put("/api/data/s1/markers/m1", json={"name": bad})
    assert resp.status_code == 400, resp.text


def test_apply_layout_rejects_control_character_names(layouts_client):
    _register(layouts_client, "s1", _plate_unified())
    from app import db
    db.save_layout(
        "lay-1", "user-1", "bad", {"markers": [_marker("a\nb")], "well_types": {}})
    resp = layouts_client.client.post("/api/layouts/lay-1/apply", json={"sid": "s1"})
    assert resp.status_code == 400, resp.text
    assert "control" in resp.json()["detail"].lower()


class _Unified:
    wells = ["A1", "A2", "B1", "B2"]
    ploidy = 2
    imported_markers = {"qA\x00": ["A1"], "\x07​": ["A2"], "  qC ": ["B1"], "": ["B2"]}


def test_import_cleans_names_and_skips_those_left_empty():
    regions = _build_imported_marker_regions(_Unified())
    assert [r["name"] for r in regions] == ["qA", "qC"]
    assert [r["wells"] for r in regions] == [["A1"], ["B1"]]
