"""Scatter figure readability: title, axes, legend, well labels, font, aspect."""
import logging
import warnings

import matplotlib.pyplot as plt
import pytest

from app.reporting.charts import build_scatter_figure, render_scatter_png


def _points(n=6):
    types = ["Allele 1 Homo", "Heterozygous", "Allele 2 Homo"]
    return [{"well": f"A{i + 1}", "norm_fam": 0.1 * i, "norm_allele2": 1 - 0.1 * i,
             "effective_type": types[i % 3]} for i in range(n)]


@pytest.fixture(autouse=True)
def _close():
    yield
    plt.close("all")


def _texts(ax):
    return [t.get_text() for t in ax.texts]


def test_title_axes_legend_and_well_labels_present():
    fig = build_scatter_figure(
        _points(), title="rs123 · Amplification 1/5 · PCR 36 · 40°C",
        x_label="VIC · WT (ROX-normalized)", y_label="FAM · MUT (ROX-normalized)",
        legend_names={"Allele 1 Homo": "MUT/MUT", "Heterozygous": "MUT/WT"})
    ax = fig.axes[0]
    assert ax.get_title() == "rs123 · Amplification 1/5 · PCR 36 · 40°C"
    assert ax.get_xlabel() == "VIC · WT (ROX-normalized)"
    assert ax.get_ylabel() == "FAM · MUT (ROX-normalized)"
    labels = [t.get_text() for t in ax.get_legend().get_texts()]
    assert "MUT/MUT (n=2)" in labels
    assert "MUT/WT (n=2)" in labels
    assert "Allele 2 Homo (n=2)" in labels
    assert sorted(_texts(ax)) == sorted(p["well"] for p in _points())


def test_legend_is_below_the_axes():
    fig = build_scatter_figure(_points())
    ax = fig.axes[0]
    fig.canvas.draw()
    legend_box = ax.get_legend().get_window_extent()
    axes_box = ax.get_window_extent()
    assert legend_box.y1 <= axes_box.y0 + 1


def test_color_lookup_uses_canonical_string_not_display_name():
    fig = build_scatter_figure(_points(3), legend_names={"Heterozygous": "A/B"})
    ax = fig.axes[0]
    colors = {c.get_label().split(" (n=")[0]: tuple(c.get_facecolor()[0][:3]) for c in ax.collections}
    plain = build_scatter_figure(_points(3)).axes[0]
    expected = {c.get_label().split(" (n=")[0]: tuple(c.get_facecolor()[0][:3]) for c in plain.collections}
    assert colors["A/B"] == expected["Heterozygous"]


def test_well_labels_omitted_above_48_wells():
    fig = build_scatter_figure(_points(49))
    assert _texts(fig.axes[0]) == []
    assert len(build_scatter_figure(_points(48)).axes[0].texts) == 48


@pytest.mark.parametrize("aspect,ratio", [("4:3", 4 / 3), ("1:1", 1.0)])
def test_aspect_argument(aspect, ratio):
    fig = build_scatter_figure(_points(), aspect=aspect)
    w, h = fig.get_size_inches()
    assert w / h == pytest.approx(ratio)
    png = render_scatter_png(_points(), aspect=aspect)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_portrait_aspect_is_three_by_four():
    w, h = build_scatter_figure(_points(), aspect="3:4").get_size_inches()
    assert w / h == pytest.approx(0.75)


def test_portrait_png_keeps_three_by_four():
    import io

    from PIL import Image

    with Image.open(io.BytesIO(render_scatter_png(_points(), aspect="3:4"))) as image:
        assert image.width / image.height == pytest.approx(0.75, abs=0.02)


def test_axes_fit_data_with_five_percent_margin_and_no_negative_space():
    ax = build_scatter_figure(_points(), orientation="allele2_x").axes[0]
    assert ax.get_ylim() == pytest.approx((0.0, 0.5 + 0.5 * 0.05))
    assert ax.get_xlim() == pytest.approx((0.5 - 0.5 * 0.05, 1.0 + 0.5 * 0.05))
    default = build_scatter_figure(_points()).axes[0]
    assert default.get_xlim() == pytest.approx(ax.get_ylim())
    assert default.get_ylim() == pytest.approx(ax.get_xlim())


def test_axes_extend_below_zero_only_for_negative_points():
    points = _points()
    points[0]["norm_fam"] = -0.2
    assert build_scatter_figure(points).axes[0].get_xlim()[0] < -0.2
    assert build_scatter_figure(points, orientation="allele2_x").axes[0].get_ylim()[0] < -0.2


def test_no_zone_or_boundary_artists_in_export_figure():
    ax = build_scatter_figure(_points()).axes[0]
    assert not ax.patches
    assert not ax.lines


def test_invalid_aspect_rejected():
    with pytest.raises(ValueError):
        build_scatter_figure(_points(), aspect="16:9")


def test_korean_names_render_without_missing_glyph_warning(caplog):
    with warnings.catch_warnings(record=True) as caught, caplog.at_level(logging.WARNING):
        warnings.simplefilter("always")
        png = render_scatter_png(
            _points(), title="마커 한글 · 증폭 1/5", x_label="VIC · 야생형 (ROX 정규화)",
            y_label="FAM · 변이형 (ROX 정규화)", legend_names={"Heterozygous": "변이/야생"})
    assert png[:4] == b"\x89PNG"
    assert [str(w.message) for w in caught if "Glyph" in str(w.message)] == []
    assert [r.message for r in caplog.records if "Glyph" in r.message] == []


_MATH_NAME = r"A$\frac$ x $_$"


def test_user_names_are_not_parsed_as_mathtext():
    png = render_scatter_png(
        _points(), title=_MATH_NAME, x_label=_MATH_NAME, y_label=_MATH_NAME,
        legend_names={"Heterozygous": _MATH_NAME})
    assert png[:4] == b"\x89PNG"


def test_plate_marker_label_is_not_parsed_as_mathtext():
    from types import SimpleNamespace

    from app.reporting.snapshot_plate import render_snapshot_plate
    rows = [SimpleNamespace(well="A1", genotype="Allele 1 Homo", ploidy=2,
                            marker=SimpleNamespace(marker_id="M1"))]
    png = render_snapshot_plate(rows, marker_layout={"M1": _MATH_NAME})
    assert png[:4] == b"\x89PNG"


def test_default_call_keeps_legacy_labels():
    ax = build_scatter_figure(_points(), allele2_dye="HEX").axes[0]
    assert ax.get_xlabel() == "FAM (normalized)"
    assert ax.get_ylabel() == "HEX (normalized)"
