"""Marker layout and highlight mode of the snapshot plate map."""
from types import SimpleNamespace

import matplotlib.pyplot as plt
import pytest

from app.reporting import snapshot_plate

WELLS = {"M1": ["A1", "A2"], "M2": ["A3", "A4"], "M3": ["B1", "B2"],
         "M4": ["B3", "B4"], "M5": ["C1", "C2"], "M6": ["C3", "C4"]}
LAYOUT = {"M1": "WT1", "M2": "WT2", "M3": "WT3", "M4": "WT4", "M5": "WT5", "M6": "WT6"}


def _rows():
    rows = []
    for marker_id, wells in WELLS.items():
        for well in wells:
            rows.append(SimpleNamespace(
                well=well, genotype="Allele 1 Homo", ploidy=2,
                marker=SimpleNamespace(marker_id=marker_id)))
    return rows


@pytest.fixture
def captured(monkeypatch):
    """Capture the figure before it is closed."""
    figures = []
    real = plt.close

    def close(figure=None):
        figures.append(figure)
        real(figure)

    monkeypatch.setattr(snapshot_plate.plt, "close", close)
    return figures


def _texts(figure):
    return [t.get_text() for t in figure.axes[0].texts]


def _alphas(figure):
    result = {}
    for coll in figure.axes[0].collections:
        offsets = coll.get_offsets()
        result[(int(offsets[0][0]), int(offsets[0][1]))] = coll.get_alpha()
    return result


def test_layout_labels_each_marker(captured):
    png = snapshot_plate.render_snapshot_plate(_rows(), marker_layout=LAYOUT)
    assert png.startswith(b"\x89PNG")
    texts = _texts(captured[0])
    assert sorted(t for t in texts if t.startswith("WT")) == sorted(LAYOUT.values())
    assert len(captured[0].axes[0].patches) == 6


def test_without_layout_no_labels_or_patches(captured):
    snapshot_plate.render_snapshot_plate(_rows())
    assert _texts(captured[0]) == []
    assert len(captured[0].axes[0].patches) == 0


def test_default_call_unchanged_by_none_kwargs():
    rows = _rows()
    assert (snapshot_plate.render_snapshot_plate(rows)
            == snapshot_plate.render_snapshot_plate(rows, marker_layout=None,
                                                    highlight_marker_id=None))


def test_highlight_emphasises_only_that_marker(captured):
    snapshot_plate.render_snapshot_plate(_rows(), marker_layout=LAYOUT,
                                         highlight_marker_id="M2")
    alphas = _alphas(captured[0])
    strong = {pos for pos, a in alphas.items() if a in (None, 1.0)}
    assert strong == {(3, 1), (4, 1)}
    assert all(a < 1.0 for pos, a in alphas.items() if pos not in strong)
