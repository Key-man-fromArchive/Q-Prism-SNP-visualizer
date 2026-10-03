"""Plate-wide axis bounds: endpoint, helper and identical axes across exported charts."""
import pytest

from app.auth import create_user_in_db
from fixtures_ux_followup import make_ux_markers, make_ux_plate
from test_marker_contract import data_client as _data_client, _register
from test_stepone_eds import _upload, api  # noqa: F401

data_client = _data_client
URL = "/api/data/axis/axis-bounds"
ZIP_URL = "/api/data/axis/export/scatter-png.zip"


@pytest.fixture
def plate(data_client):
    _register(data_client, "axis", make_ux_plate())
    return data_client


def _expected(unified, use_rox, background="none"):
    from app.processing.normalize import normalize

    points = normalize(unified, use_rox=use_rox, background=background)
    return (
        (min(p.norm_fam for p in points), max(p.norm_fam for p in points)),
        (min(p.norm_allele2 for p in points), max(p.norm_allele2 for p in points)),
        len(points),
    )


@pytest.mark.parametrize("use_rox", [True, False])
@pytest.mark.parametrize("background", ["none", "pre_read"])
def test_endpoint_spans_every_read_and_well(plate, use_rox, background):
    unified = plate.upload.sessions["axis"]
    response = plate.client.get(URL, params={"use_rox": use_rox, "background": background})
    assert response.status_code == 200, response.text
    body = response.json()
    fam, allele2, reads = _expected(unified, use_rox, background)
    assert (body["fam"]["min"], body["fam"]["max"]) == pytest.approx(fam)
    assert (body["allele2"]["min"], body["allele2"]["max"]) == pytest.approx(allele2)
    assert body["reads"] == reads == len(unified.data)


def test_use_rox_changes_the_bounds(plate):
    on = plate.client.get(URL, params={"use_rox": True}).json()
    off = plate.client.get(URL, params={"use_rox": False}).json()
    assert on["fam"] != off["fam"]


def test_background_changes_the_bounds(plate):
    none = plate.client.get(URL, params={"background": "none"}).json()
    pre = plate.client.get(URL, params={"background": "pre_read"}).json()
    assert none["fam"] != pre["fam"]


def test_unknown_session_and_other_users_session(plate):
    assert plate.client.get("/api/data/missing/axis-bounds").status_code in (403, 404)
    plate.upload.sessions["theirs"] = make_ux_plate()
    other = create_user_in_db("bob", "Zq7-Distinct-Passphrase-91")
    plate.db.save_session("theirs", plate.upload.sessions["theirs"], filename="t.eds", user_id=other)
    assert plate.client.get("/api/data/theirs/axis-bounds").status_code == 403


def test_no_readings_is_an_error(plate):
    unified = make_ux_plate()
    unified.data = []
    plate.upload.sessions["empty"] = unified
    plate.db.save_session("empty", unified, filename="e.eds", user_id=None)
    assert plate.client.get("/api/data/empty/axis-bounds").status_code in (400, 404)


def test_helper_returns_none_without_readings():
    from app.processing.axis_bounds import plate_axis_bounds

    unified = make_ux_plate()
    unified.data = []
    assert plate_axis_bounds(unified, True, "none") is None


@pytest.mark.parametrize("orientation", ["fam_x", "allele2_x"])
def test_every_marker_chart_shares_plate_wide_axes(plate, monkeypatch, orientation):
    import io
    import zipfile

    from app.reporting import charts

    unified = plate.upload.sessions["axis"]
    markers = make_ux_markers(unified)
    response = plate.client.post("/api/data/axis/cluster", json={
        "cycle": 20, "use_rox": True, "regions": [m.model_dump() for m in markers]})
    assert response.status_code == 200, response.text

    seen = []
    original = charts.build_scatter_figure

    def spy(*args, **kwargs):
        fig = original(*args, **kwargs)
        ax = fig.axes[0]
        seen.append((ax.get_xlim(), ax.get_ylim()))
        return fig

    monkeypatch.setattr(charts, "build_scatter_figure", spy)
    url = ZIP_URL + f"?orientation={orientation}"
    archive = zipfile.ZipFile(io.BytesIO(plate.client.get(url).content))
    assert len(archive.namelist()) == len(markers) >= 2
    assert len(seen) == len(markers)
    assert all(limits == seen[0] for limits in seen)

    fam, allele2, _ = _expected(unified, True)
    from app.reporting.charts import _fitted_limits

    fam_lim, allele2_lim = _fitted_limits(list(fam)), _fitted_limits(list(allele2))
    expected = (fam_lim, allele2_lim) if orientation == "fam_x" else (allele2_lim, fam_lim)
    assert seen[0][0] == pytest.approx(expected[0])
    assert seen[0][1] == pytest.approx(expected[1])
