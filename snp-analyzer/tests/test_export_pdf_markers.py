"""P2-E1: per-marker allele names in the PDF report (synthetic StepOnePlus upload -> PDF)."""

# ruff: noqa: F811  (the imported restore fixture is re-declared as a test argument)
import io

import pytest
from pypdf import PdfReader

from tests import stepone_fixtures as so
from tests.test_stepone_session_restore import restore  # noqa: F401

CLUSTER = {"cycle": 2, "use_rox": True, "algorithm": "threshold"}


def _upload(client, preset: str) -> str:
    options = so.StepOneOptions(markers=so.default_markers(preset))
    response = client.post(
        "/api/upload",
        files={
            "file": (
                "plate.eds",
                so.build_stepone_eds(options),
                "application/octet-stream",
            )
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["session_id"]


def _cluster(client, sid: str) -> None:
    response = client.post(f"/api/data/{sid}/cluster", json=CLUSTER)
    assert response.status_code == 200, response.text


def _pdf_pages(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [
        page.extract_text() or ""
        for page in PdfReader(io.BytesIO(response.content)).pages
    ]


def _run(client, preset: str, query: str = "") -> tuple[str, list[str]]:
    sid = _upload(client, preset)
    _cluster(client, sid)
    return sid, _pdf_pages(client.get(f"/api/data/{sid}/export/pdf{query}"))


def _marker_ids(client, sid: str) -> dict[str, str]:
    markers = client.get(f"/api/data/{sid}/markers").json()["markers"]
    return {m["name"]: m["id"] for m in markers}


def test_named_run_pdf_lists_six_markers_and_allele_names(restore):
    client, _, _ = restore
    _, pages = _run(client, "partial_default")
    text = "\n".join(pages)
    for number in range(1, 7):
        assert f"QPrism{number}" in text
    assert "Allele Call" in text
    assert "MT" in text and "WT" in text
    assert "WT/WT" in text or "WT/MT" in text or "MT/MT" in text


def test_korean_marker_name_is_rendered(restore):
    client, _, _ = restore
    sid = _upload(client, "partial_default")
    marker_id = _marker_ids(client, sid)["QPrism2"]
    renamed = client.put(
        f"/api/data/{sid}/markers/{marker_id}", json={"name": "한글마커"}
    )
    assert renamed.status_code == 200, renamed.text
    _cluster(client, sid)
    text = "\n".join(_pdf_pages(client.get(f"/api/data/{sid}/export/pdf")))
    assert "한글마커" in text


def test_unnamed_run_keeps_the_legacy_structure(restore):
    client, _, _ = restore
    _, pages = _run(client, "all_default")
    text = "\n".join(pages)
    assert "Allele Call" not in text
    assert "Marker detail" not in text
    assert "WT/MT" not in text
    for number in range(1, 7):
        assert f"QPrism{number}" in text
    # The pre-P2 report was 26 pages; the 5-page Ct section is the only difference (D-3).
    assert len(pages) == 26 - 5
    assert "Full-curve Ct" not in text


def test_stepone_run_has_no_ct_section(restore):
    client, _, _ = restore
    _, pages = _run(client, "partial_default")
    assert "Full-curve Ct" not in "\n".join(pages)


def test_one_selected_marker_exports_only_that_marker(restore):
    client, _, _ = restore
    sid = _upload(client, "partial_default")
    _cluster(client, sid)
    marker_id = _marker_ids(client, sid)["QPrism1"]
    text = "\n".join(
        _pdf_pages(client.get(f"/api/data/{sid}/export/pdf?marker_ids={marker_id}"))
    )
    assert "QPrism1" in text
    for number in range(2, 7):
        assert f"QPrism{number}" not in text


@pytest.mark.parametrize("query", ["marker_ids=", "marker_ids=a,a", "marker_ids=nope"])
def test_bad_marker_ids_are_400(restore, query):
    client, _, _ = restore
    sid = _upload(client, "partial_default")
    _cluster(client, sid)
    assert client.get(f"/api/data/{sid}/export/pdf?{query}").status_code == 400


def test_marker_ids_error_wins_over_missing_result(restore):
    client, _, _ = restore
    sid = _upload(client, "partial_default")
    assert client.get(f"/api/data/{sid}/export/pdf?marker_ids=").status_code == 400


def test_condition_mismatch_is_still_409(restore):
    client, _, _ = restore
    sid = _upload(client, "partial_default")
    _cluster(client, sid)
    response = client.get(f"/api/data/{sid}/export/pdf?cycle=5")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "EXPORT_CONDITION_MISMATCH"


def test_download_header_is_rfc5987(restore):
    client, _, _ = restore
    sid = _upload(client, "partial_default")
    _cluster(client, sid)
    header = client.get(f"/api/data/{sid}/export/pdf").headers["content-disposition"]
    assert header.startswith("attachment; filename=")
    assert "filename*=UTF-8''snp_report_whole-run_cycle2.pdf" in header
