"""Scatter axis orientation: FAM on x by default, ``allele2_x`` swaps the axes."""
from types import SimpleNamespace

import matplotlib.pyplot as plt
import pytest

from app.reporting.charts import build_scatter_figure
from fixtures_ux_followup import make_ux_markers, make_ux_plate
from test_stepone_eds import _upload, api  # noqa: F401
from test_marker_contract import data_client as _data_client, _register

data_client = _data_client
ROUTES = {
    "pdf": ("app.reporting.snapshot_pdf", "build_snapshot_pdf", "/api/data/export/export/pdf"),
    "pptx": ("app.routers.export_pptx", "build_snapshot_pptx", "/api/data/export/export/pptx"),
    "zip": ("app.routers.export_images", "build_scatter_zip", "/api/data/export/export/scatter-png.zip"),
    "xlsx": ("app.reporting.snapshot_xlsx", "build_snapshot_xlsx", "/api/data/export/export/xlsx"),
}


@pytest.fixture(autouse=True)
def _close():
    yield
    plt.close("all")


def _points():
    return [{"well": "A1", "norm_fam": 0.9, "norm_allele2": 0.1, "effective_type": "Allele 1 Homo"},
            {"well": "A2", "norm_fam": 0.2, "norm_allele2": 0.8, "effective_type": "Allele 2 Homo"}]


def _offsets(ax):
    return sorted(tuple(map(float, xy)) for c in ax.collections for xy in c.get_offsets())


def test_default_is_fam_on_x():
    ax = build_scatter_figure(_points(), allele2_dye="HEX").axes[0]
    assert ax.get_xlabel().startswith("FAM")
    assert ax.get_ylabel().startswith("HEX")
    assert _offsets(ax) == [(0.2, 0.8), (0.9, 0.1)]


def test_allele2_x_swaps_axes():
    ax = build_scatter_figure(_points(), allele2_dye="HEX", orientation="allele2_x").axes[0]
    assert ax.get_xlabel().startswith("HEX")
    assert ax.get_ylabel().startswith("FAM")
    assert _offsets(ax) == [(0.1, 0.9), (0.8, 0.2)]


def test_limits_and_well_labels_follow_orientation():
    ax = build_scatter_figure(_points(), orientation="fam_x").axes[0]
    assert ax.get_xlim()[1] > 0.9 and ax.get_ylim()[1] < 0.9
    label = next(t for t in ax.texts if t.get_text() == "A1")
    assert tuple(label.xy) == (0.9, 0.1)


def test_unknown_orientation_rejected():
    with pytest.raises(ValueError):
        build_scatter_figure(_points(), orientation="diagonal")


@pytest.fixture
def plate(data_client: SimpleNamespace) -> SimpleNamespace:
    _register(data_client, "export", make_ux_plate())
    unified = data_client.upload.sessions["export"]
    response = data_client.client.post("/api/data/export/cluster", json={
        "cycle": 20, "use_rox": True, "regions": [m.model_dump() for m in make_ux_markers(unified)],
    })
    assert response.status_code == 200, response.text
    return data_client


@pytest.mark.parametrize("kind", ROUTES)
def test_bad_orientation_is_400(plate: SimpleNamespace, kind: str) -> None:
    url = ROUTES[kind][2]
    assert plate.client.get(url + "?orientation=diagonal").status_code == 400
    assert plate.client.get(url + "?orientation=").status_code == 400


@pytest.mark.parametrize("kind", ROUTES)
@pytest.mark.parametrize("query,expected", [("", "fam_x"), ("?orientation=fam_x", "fam_x"),
                                            ("?orientation=allele2_x", "allele2_x")])
def test_every_output_receives_orientation(
    plate: SimpleNamespace, monkeypatch: pytest.MonkeyPatch, kind: str, query: str, expected: str,
) -> None:
    import importlib
    module, name, url = ROUTES[kind]
    seen: list[str] = []

    def spy(snapshot, *args):
        seen.append(snapshot.orientation)
        return b"x"

    monkeypatch.setattr(importlib.import_module(module), name, spy)
    assert plate.client.get(url + query).status_code == 200
    assert seen == [expected]


@pytest.mark.parametrize("kind", ["pdf", "xlsx"])
def test_real_output_builds_with_allele2_x(plate: SimpleNamespace, kind: str) -> None:
    assert plate.client.get(ROUTES[kind][2] + "?orientation=allele2_x").status_code == 200
