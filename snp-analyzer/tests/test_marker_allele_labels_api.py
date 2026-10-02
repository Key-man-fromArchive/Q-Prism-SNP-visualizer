"""P1-B1: per-marker allele names through the marker, layout and catalog APIs."""
# ruff: noqa: F811  (the imported layouts_client fixture is re-declared as a test argument)
import pytest

from tests.test_layouts import _plate_unified, _register, layouts_client  # noqa: F401

LABELS = {"fam": "WT", "allele2": "MT"}


def _post_markers(c, sid, markers):
    resp = c.client.post(f"/api/data/{sid}/markers", json={"markers": markers})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _two_markers(**first_extra):
    return [
        {"id": "m1", "name": "qA", "wells": ["A1", "A2"], **first_extra},
        {"id": "m2", "name": "qB", "wells": ["A3", "A4"]},
    ]


def _get_marker(c, sid, marker_id):
    resp = c.client.get(f"/api/data/{sid}/markers")
    assert resp.status_code == 200, resp.text
    return next(m for m in resp.json()["markers"] if m["id"] == marker_id)


def test_post_and_get_round_trip_allele_labels(layouts_client):
    _register(layouts_client, "s1", _plate_unified())
    _post_markers(layouts_client, "s1", _two_markers(allele_labels=LABELS))
    assert _get_marker(layouts_client, "s1", "m1")["allele_labels"] == LABELS
    assert _get_marker(layouts_client, "s1", "m2")["allele_labels"] is None


def test_put_sets_updates_and_clears_labels(layouts_client):
    c = layouts_client
    _register(c, "s1", _plate_unified())
    _post_markers(c, "s1", _two_markers())

    resp = c.client.put("/api/data/s1/markers/m1", json={"allele_labels": LABELS})
    assert resp.status_code == 200, resp.text
    assert _get_marker(c, "s1", "m1")["allele_labels"] == LABELS

    # Omitting the field keeps it (partial update).
    c.client.put("/api/data/s1/markers/m1", json={"color": "#112233"})
    assert _get_marker(c, "s1", "m1")["allele_labels"] == LABELS

    # Explicit null clears it.
    resp = c.client.put("/api/data/s1/markers/m1", json={"allele_labels": None})
    assert resp.status_code == 200, resp.text
    assert _get_marker(c, "s1", "m1")["allele_labels"] is None


def test_put_labels_persist_to_db(layouts_client):
    import app.db as db

    c = layouts_client
    _register(c, "s1", _plate_unified())
    _post_markers(c, "s1", _two_markers())
    c.client.put("/api/data/s1/markers/m1", json={"allele_labels": LABELS})
    stored = {m["marker_id"] if "marker_id" in m else m["id"]: m for m in db.load_marker_regions("s1")}
    assert stored["m1"]["allele_labels"] == LABELS


def test_label_change_does_not_bump_input_revision(layouts_client):
    c = layouts_client
    _register(c, "s1", _plate_unified())
    rev0 = _post_markers(c, "s1", _two_markers())["input_revision"]

    resp = c.client.put("/api/data/s1/markers/m1", json={"allele_labels": LABELS})
    assert resp.json()["input_revision"] == rev0
    resp = c.client.put("/api/data/s1/markers/m1", json={"allele_labels": None})
    assert resp.json()["input_revision"] == rev0
    # A judgment-relevant change still bumps it.
    resp = c.client.put("/api/data/s1/markers/m1", json={"ploidy": 4})
    assert resp.json()["input_revision"] == rev0 + 1


@pytest.mark.parametrize(
    "bad",
    [
        {"fam": "WT"},
        {"fam": "WT", "allele2": "MT", "extra": "x"},
        {"fam": "", "allele2": "MT"},
        {"fam": "X" * 33, "allele2": "MT"},
        {"fam": "WT", "allele2": "wt"},
        {"fam": "W\x00T", "allele2": "MT"},
        "WT/MT",
    ],
)
def test_put_rejects_invalid_labels_with_400(layouts_client, bad):
    c = layouts_client
    _register(c, "s1", _plate_unified())
    _post_markers(c, "s1", _two_markers())
    resp = c.client.put("/api/data/s1/markers/m1", json={"allele_labels": bad})
    assert resp.status_code == 400, resp.text
    assert _get_marker(c, "s1", "m1")["allele_labels"] is None


def test_post_rejects_invalid_labels(layouts_client):
    # POST bodies are validated by the framework against MarkerRegion (422).
    c = layouts_client
    _register(c, "s1", _plate_unified())
    resp = c.client.post(
        "/api/data/s1/markers",
        json={"markers": _two_markers(allele_labels={"fam": "A", "allele2": "a"})},
    )
    assert resp.status_code == 422, resp.text
    assert c.client.get("/api/data/s1/markers").json()["markers"] == []


def test_layout_saves_and_applies_labels(layouts_client):
    c = layouts_client
    _register(c, "s1", _plate_unified())
    _post_markers(c, "s1", _two_markers(allele_labels=LABELS))
    layout = c.client.post("/api/layouts", json={"name": "L", "sid": "s1"}).json()
    saved = {m["id"]: m for m in layout["snapshot"]["markers"]}
    assert saved["m1"]["allele_labels"] == LABELS
    assert saved["m2"]["allele_labels"] is None

    _register(c, "s2", _plate_unified())
    resp = c.client.post(f"/api/layouts/{layout['id']}/apply", json={"sid": "s2"})
    assert resp.status_code == 200, resp.text
    applied = {m["id"]: m for m in resp.json()["markers"]}
    assert applied["m1"]["allele_labels"] == LABELS
    assert _get_marker(c, "s2", "m1")["allele_labels"] == LABELS


def test_layout_apply_rejects_invalid_stored_labels(layouts_client):
    import app.db as db

    c = layouts_client
    _register(c, "s1", _plate_unified())
    snapshot = {
        "schema_version": 1,
        "plate": {"rows": 1, "cols": 4},
        "markers": [{"id": "m1", "name": "qA", "wells": ["A1"], "allele_labels": {"fam": "A", "allele2": "A"}}],
    }
    db.save_layout("bad1", "user-1", "bad", snapshot)
    resp = c.client.post("/api/layouts/bad1/apply", json={"sid": "s1"})
    assert resp.status_code == 400, resp.text


def _catalog_body(**kw):
    return {"name": "qSwet", "default_ploidy": 2, **kw}


def _attach(c, catalog_id):
    return c.client.post("/api/data/s1/markers/m1/attach-catalog", json={"catalog_id": catalog_id})


def test_attach_catalog_prefills_empty_labels_from_bases(layouts_client):
    c = layouts_client
    _register(c, "s1", _plate_unified())
    _post_markers(c, "s1", _two_markers())
    entry = c.client.post("/api/marker-catalog", json=_catalog_body(allele1_base="A", allele2_base="G")).json()
    resp = _attach(c, entry["id"])
    assert resp.status_code == 200, resp.text
    assert resp.json()["allele_labels"] == {"fam": "A", "allele2": "G"}
    assert _get_marker(c, "s1", "m1")["allele_labels"] == {"fam": "A", "allele2": "G"}


def test_attach_catalog_keeps_existing_labels(layouts_client):
    c = layouts_client
    _register(c, "s1", _plate_unified())
    _post_markers(c, "s1", _two_markers(allele_labels=LABELS))
    entry = c.client.post("/api/marker-catalog", json=_catalog_body(allele1_base="A", allele2_base="G")).json()
    assert _attach(c, entry["id"]).json()["allele_labels"] == LABELS


@pytest.mark.parametrize(
    "bases",
    [{}, {"allele1_base": "A"}, {"allele2_base": "G"}, {"allele1_base": "A", "allele2_base": "a"}],
)
def test_attach_catalog_without_usable_bases_leaves_labels_empty(layouts_client, bases):
    c = layouts_client
    _register(c, "s1", _plate_unified())
    _post_markers(c, "s1", _two_markers())
    entry = c.client.post("/api/marker-catalog", json=_catalog_body(**bases)).json()
    resp = _attach(c, entry["id"])
    assert resp.status_code == 200, resp.text
    assert resp.json()["allele_labels"] is None
