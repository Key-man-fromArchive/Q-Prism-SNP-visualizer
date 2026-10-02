"""P1-B2: import-time allele names and the StepOne response fields.

Uses synthetic ``UnifiedData`` so it is independent of the StepOne parser.
"""

# ruff: noqa: F811  (the imported layouts_client fixture is re-declared as a test argument)
import re
from pathlib import Path

from app.models import AlleleLabels, ReadLabel, UploadResponse
from app.services.import_session import create_session_from_import
from tests.test_layouts import _plate_unified, layouts_client  # noqa: F401

LABELS = {"fam": "WT", "allele2": "MT"}
READ_LABELS = {
    1: ReadLabel(stage="Pre-read", pcr_cycle=None, temperature=25.0),
    2: ReadLabel(stage="Amplification", pcr_cycle=36, temperature=40.0),
}
API_TS = Path(__file__).resolve().parents[1] / "frontend" / "src" / "types" / "api.ts"


def _stepone_unified(**extra):
    unified = _plate_unified()
    unified.imported_markers = {"qA": ["A1", "A2"], " qB ": ["A3", "A4"], "qC": ["A1"]}
    unified.imported_marker_alleles = {
        "qA": AlleleLabels(**LABELS),
        "qB": AlleleLabels(fam="Ref", allele2="Alt"),
        "qC": AlleleLabels(fam="X", allele2="Y"),
    }
    unified.default_cycle = 2
    unified.has_amplification_curve = False
    unified.read_labels = READ_LABELS
    for key, value in extra.items():
        setattr(unified, key, value)
    return unified


def _import(c, unified):
    return create_session_from_import(
        unified=unified,
        filename="run.eds",
        user_id="user-1",
        session_store=c.upload.sessions,
    )


def _cold_restart(c):
    c.upload.sessions.clear()
    c.clustering.marker_store.clear()


def _markers(c, sid):
    resp = c.client.get(f"/api/data/{sid}/markers")
    assert resp.status_code == 200, resp.text
    return {m["name"]: m for m in resp.json()["markers"]}


def test_import_sets_marker_allele_labels(layouts_client):
    response = _import(layouts_client, _stepone_unified())
    markers = _markers(layouts_client, response.session_id)
    assert markers["qA"]["allele_labels"] == LABELS
    # Whitespace in the instrument's marker name must not lose its names.
    assert markers["qB"]["allele_labels"] == {"fam": "Ref", "allele2": "Alt"}
    # A marker with no declared names keeps None; a fully-shadowed one is dropped.
    assert "qC" not in markers


def test_import_without_declared_alleles_leaves_labels_none(layouts_client):
    unified = _stepone_unified(imported_marker_alleles=None)
    response = _import(layouts_client, unified)
    assert all(
        m["allele_labels"] is None
        for m in _markers(layouts_client, response.session_id).values()
    )


def test_upload_response_carries_stepone_fields(layouts_client):
    response = _import(layouts_client, _stepone_unified())
    assert response.default_cycle == 2
    assert response.has_amplification_curve is False
    assert response.read_labels == READ_LABELS
    dumped = response.model_dump(mode="json")
    assert dumped["read_labels"]["2"] == {
        "stage": "Amplification",
        "pcr_cycle": 36,
        "temperature": 40.0,
    }


def test_upload_response_defaults_for_other_instruments(layouts_client):
    response = _import(layouts_client, _plate_unified())
    assert response.default_cycle is None
    assert response.has_amplification_curve is True
    assert response.read_labels is None


def test_session_info_has_fields_and_survives_restart(layouts_client):
    c = layouts_client
    sid = _import(c, _stepone_unified()).session_id

    def check():
        body = c.client.get(f"/api/sessions/{sid}").json()
        assert body["default_cycle"] == 2
        assert body["has_amplification_curve"] is False
        assert body["read_labels"]["2"] == {
            "stage": "Amplification",
            "pcr_cycle": 36,
            "temperature": 40.0,
        }

    check()
    _cold_restart(c)
    check()


def test_session_info_defaults_for_other_instruments(layouts_client):
    c = layouts_client
    sid = _import(c, _plate_unified()).session_id
    body = c.client.get(f"/api/sessions/{sid}").json()
    assert body["default_cycle"] is None
    assert body["has_amplification_curve"] is True
    assert body["read_labels"] is None


def test_restore_keeps_allele_labels(layouts_client):
    c = layouts_client
    sid = _import(c, _stepone_unified()).session_id
    _cold_restart(c)
    c.client.get(f"/api/sessions/{sid}")
    assert _markers(c, sid)["qA"]["allele_labels"] == LABELS


def test_operator_edit_survives_restore(layouts_client):
    c = layouts_client
    sid = _import(c, _stepone_unified()).session_id
    marker_id = _markers(c, sid)["qA"]["id"]
    new = {"fam": "Hap1", "allele2": "Hap2"}
    resp = c.client.put(
        f"/api/data/{sid}/markers/{marker_id}", json={"allele_labels": new}
    )
    assert resp.status_code == 200, resp.text
    _cold_restart(c)
    c.client.get(f"/api/sessions/{sid}")
    assert _markers(c, sid)["qA"]["allele_labels"] == new


def _ts_type_fields(name: str) -> set[str]:
    source = API_TS.read_text(encoding="utf-8")
    block = re.search(rf"export type {name} = \{{(.*?)\n\}};", source, re.S).group(1)
    return set(re.findall(r"^  (\w+)\??:", block, re.M))


def test_responses_match_typescript_contract(layouts_client):
    c = layouts_client
    response = _import(c, _stepone_unified())
    ts_fields = _ts_type_fields("UploadResponse")
    assert ts_fields <= set(UploadResponse.model_fields)
    assert {"default_cycle", "read_labels", "has_amplification_curve"} <= ts_fields
    info = set(c.client.get(f"/api/sessions/{response.session_id}").json())
    assert ts_fields <= info


def test_every_upload_entry_point_uses_import_session():
    root = Path(__file__).resolve().parents[1] / "app" / "routers"
    for name in ("upload.py", "import_api.py"):
        text = (root / name).read_text(encoding="utf-8")
        assert "create_session_from_import(" in text, name
        assert "UploadResponse(" not in text, (
            f"{name} builds a response outside import_session"
        )
