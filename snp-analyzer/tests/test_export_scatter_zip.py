"""Report PNG bundle: one chart per selected marker, safe names, fixed metadata."""
import io
import zipfile
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from fixtures_ux_followup import make_ux_markers, make_ux_plate
from test_stepone_eds import _upload, api  # noqa: F401
from test_marker_contract import data_client as _data_client, _register

data_client = _data_client
URL = "/api/data/export/export/scatter-png.zip"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


@pytest.fixture
def plate(data_client: SimpleNamespace) -> SimpleNamespace:
    _register(data_client, "export", make_ux_plate())
    return data_client


def _analyse(plate: SimpleNamespace, rename: dict[str, str] | None = None):
    unified = plate.upload.sessions["export"]
    markers = make_ux_markers(unified)
    for marker in markers:
        if rename and marker.id in rename:
            marker.name = rename[marker.id]
    response = plate.client.post("/api/data/export/cluster", json={
        "cycle": 20, "use_rox": True, "regions": [m.model_dump() for m in markers],
    })
    assert response.status_code == 200, response.text
    return markers


def _zip(response) -> zipfile.ZipFile:
    assert response.status_code == 200, response.text
    return zipfile.ZipFile(io.BytesIO(response.content))


def test_one_png_per_marker(plate: SimpleNamespace) -> None:
    _analyse(plate)
    response = plate.client.get(URL)
    assert response.headers["content-type"] == "application/zip"
    archive = _zip(response)
    assert len(archive.namelist()) == 2
    assert all(n.endswith(".png") for n in archive.namelist())
    assert all(archive.read(n).startswith(PNG_MAGIC) for n in archive.namelist())


def test_marker_selection(plate: SimpleNamespace) -> None:
    _analyse(plate)
    archive = _zip(plate.client.get(URL + "?marker_ids=synthetic-hexaploid"))
    assert archive.namelist() == ["Synthetic hexaploid.png"]


def test_bad_marker_selection_is_400(plate: SimpleNamespace) -> None:
    _analyse(plate)
    assert plate.client.get(URL + "?marker_ids=").status_code == 400
    assert plate.client.get(URL + "?marker_ids=nope").status_code == 400
    assert plate.client.get(URL + "?marker_ids=a,a").status_code == 400


def test_marker_ids_validated_before_capture(plate: SimpleNamespace) -> None:
    # No analysis exists: a malformed list must still answer 400, not 409.
    assert plate.client.get(URL + "?marker_ids=a,a").status_code == 400
    assert plate.client.get(URL).status_code == 409


def test_whole_run_has_single_png(plate: SimpleNamespace) -> None:
    response = plate.client.post("/api/data/export/cluster", json={
        "cycle": 20, "use_rox": True, "algorithm": "threshold"})
    assert response.status_code == 200, response.text
    assert _zip(plate.client.get(URL)).namelist() == ["whole-run.png"]


def test_conditions_are_checked(plate: SimpleNamespace) -> None:
    _analyse(plate)
    response = plate.client.get(URL + "?cycle=40")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "EXPORT_CONDITION_MISMATCH"


def test_names_are_safe_and_unique(plate: SimpleNamespace) -> None:
    markers = _analyse(plate, {"synthetic-diploid": "../../etc/passwd\x00\x07",
                               "synthetic-hexaploid": "../../etc/passwd\x00\x07"})
    archive = _zip(plate.client.get(URL))
    assert archive.namelist() == ["passwd.png", "passwd (2).png"]
    assert markers


@pytest.mark.parametrize("name", ["..", "a/b\\c", "x" * 400, "$a$ b", "한글 마커"])
def test_hostile_names_never_escape(plate: SimpleNamespace, name: str) -> None:
    _analyse(plate, {"synthetic-diploid": name})
    for entry in _zip(plate.client.get(URL)).namelist():
        assert "/" not in entry and "\\" not in entry and ".." not in entry.split(".png")[0].split()
        assert "\x00" not in entry and len(entry.encode()) <= 150
        assert entry.endswith(".png")


def test_entries_have_fixed_metadata(plate: SimpleNamespace) -> None:
    _analyse(plate)
    first = _zip(plate.client.get(URL))
    for info in first.infolist():
        assert info.date_time == (1980, 1, 1, 0, 0, 0)
        assert info.external_attr == 0x20 and info.create_system == 0
        assert info.extra == b""
        assert info.comment == b""
    second = _zip(plate.client.get(URL))
    assert [i.CRC for i in first.infolist()] == [i.CRC for i in second.infolist()]


def test_download_header_is_rfc5987(plate: SimpleNamespace) -> None:
    _analyse(plate)
    header = plate.client.get(URL).headers["content-disposition"]
    assert header.startswith("attachment; filename=")
    assert "filename*=UTF-8''" in header
    assert ".zip" in header


def test_same_renderer_as_pdf(plate: SimpleNamespace, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.reporting import snapshot_images
    assert snapshot_images.render_scatter_png.__module__ == "app.reporting.charts"
    seen: list[dict] = []
    original = snapshot_images.render_scatter_png

    def spy(points, *args, **options):
        seen.append(options)
        return original(points, *args, **options)

    monkeypatch.setattr(snapshot_images, "render_scatter_png", spy)
    _analyse(plate)
    plate.client.get(URL)
    assert len(seen) == 2 and all("x_label" in o and "legend_names" in o for o in seen)


def test_allele_names_reach_the_chart(plate: SimpleNamespace, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.models import AlleleLabels
    from app.reporting import snapshot_images
    markers = _analyse(plate)
    named = [m.model_copy(deep=True) for m in markers]
    named[0].allele_labels = AlleleLabels(fam="WT", allele2="MT")
    plate.clustering.marker_store["export"] = named
    seen: dict[str, dict] = {}
    original = snapshot_images.render_scatter_png

    def spy(points, *args, **options):
        seen[options["title"]] = options
        return original(points, *args, **options)

    monkeypatch.setattr(snapshot_images, "render_scatter_png", spy)
    assert plate.client.get(URL).status_code == 200
    named_opts = next(o for t, o in seen.items() if t.startswith("Synthetic diploid"))
    plain_opts = next(o for t, o in seen.items() if t.startswith("Synthetic hexaploid"))
    assert "WT" in named_opts["x_label"] or "WT" in named_opts["y_label"]
    assert all(v.count("/") == 1 for v in named_opts["legend_names"].values()
               if v not in {"Undetermined", "NTC"})
    assert plain_opts["legend_names"] == {}


def test_size_limit_is_enforced(plate: SimpleNamespace, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.reporting import snapshot_images
    _analyse(plate)
    monkeypatch.setattr(snapshot_images, "MAX_ZIP_BYTES", 1000)
    response = plate.client.get(URL)
    assert response.status_code == 413


def test_stepone_upload_to_png_bundle(api) -> None:  # noqa: F811
    """Upload -> markers -> analysis -> bundle on the synthetic StepOne file."""
    sid = _upload(api)["session_id"]
    markers = api.get(f"/api/data/{sid}/markers").json()["markers"]
    assert len(markers) >= 2
    regions = [{key: m[key] for key in ("id", "name", "wells", "ploidy")} for m in markers]
    response = api.post(f"/api/data/{sid}/cluster", json={"cycle": 2, "use_rox": False, "regions": regions})
    assert response.status_code == 200, response.text
    archive = _zip(api.get(f"/api/data/{sid}/export/scatter-png.zip"))
    assert len(archive.namelist()) == len(markers)
    assert all(archive.read(n).startswith(PNG_MAGIC) for n in archive.namelist())


def test_build_rejects_oversize_directly() -> None:
    from app.reporting import snapshot_images
    with pytest.raises(HTTPException) as caught:
        snapshot_images.check_size(snapshot_images.MAX_ZIP_BYTES + 1)
    assert caught.value.status_code == 413
