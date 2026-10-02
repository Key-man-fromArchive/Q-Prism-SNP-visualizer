"""PDF, XLSX, PNG zip and PPTX hand the chart renderer the same options per marker."""
from types import SimpleNamespace

from app.reporting import snapshot_images, snapshot_pdf, snapshot_pptx, snapshot_xlsx
from test_export_pptx import data_client, run  # noqa: F401  (fixtures)

FORMATS = {"pdf": snapshot_pdf, "xlsx": snapshot_xlsx, "zip": snapshot_images, "pptx": snapshot_pptx}
URLS = {"pdf": "export/pdf", "xlsx": "export/xlsx", "zip": "export/scatter-png.zip",
        "pptx": "export/pptx"}
KEYS = ("title", "x_label", "y_label", "legend_names", "aspect")


def _capture(monkeypatch, module) -> list[dict]:
    calls: list[dict] = []
    real = module.render_scatter_png

    def spy(points, *args, **options):
        calls.append({"ploidy": options.get("ploidy", args[1] if len(args) > 1 else None),
                      **{key: options.get(key) for key in KEYS}})
        return real(points, *args, **options)

    monkeypatch.setattr(module, "render_scatter_png", spy)
    return calls


def test_four_outputs_receive_identical_figure_options(run: SimpleNamespace, monkeypatch) -> None:  # noqa: F811
    seen: dict[str, list[dict]] = {name: _capture(monkeypatch, mod) for name, mod in FORMATS.items()}
    for name, path in URLS.items():
        response = run.client.get(f"/api/data/{run.sid}/{path}")
        assert response.status_code == 200, (name, response.text[:200])
    reference = seen["zip"]
    assert len(reference) == 6
    assert all(call["title"] and call["x_label"] and call["y_label"] for call in reference)
    for name, calls in seen.items():
        assert calls == reference, name


def test_exports_default_to_portrait_three_by_four(run: SimpleNamespace, monkeypatch) -> None:  # noqa: F811
    calls = _capture(monkeypatch, snapshot_images)
    run.client.get(f"/api/data/{run.sid}/export/scatter-png.zip")
    assert calls
    assert all(call["aspect"] == "3:4" for call in calls)


def test_legend_lists_only_present_calls_with_display_names(run: SimpleNamespace, monkeypatch) -> None:  # noqa: F811
    calls = _capture(monkeypatch, snapshot_images)
    run.client.get(f"/api/data/{run.sid}/export/scatter-png.zip")
    named = [call for call in calls if call["legend_names"]]
    assert named
    for call in named:
        assert set(call["legend_names"]) <= {"Allele 1 Homo", "Heterozygous", "Allele 2 Homo",
                                             "Undetermined", "NTC", "Unknown"} | set(call["legend_names"])
        assert all("/" in text for key, text in call["legend_names"].items()
                   if key in {"Allele 1 Homo", "Heterozygous", "Allele 2 Homo"})


def _row(genotype: str, call_len: int = 0):
    marker = SimpleNamespace(name="m", marker_id="m1", ploidy=2)
    labels = SimpleNamespace(fam="F" * call_len, allele2="G" * call_len)
    return SimpleNamespace(genotype=genotype, marker=marker, allele_labels=labels if call_len else None,
                           well="A1", sample_name="s", confidence=0.5)


def test_pptx_long_allele_call_is_clipped_in_result_rows() -> None:
    rows = snapshot_pptx._result_table_rows([_row("Heterozygous", 30)])
    assert len(rows[0][3]) == snapshot_pptx._CALL_CHARS and rows[0][3].endswith("…")


def test_pptx_count_table_marks_truncation_and_keeps_totals() -> None:
    page = SimpleNamespace(rows=[_row(f"call{i}") for i in range(14)])
    shown = snapshot_pptx._call_counts(page)
    assert len(shown) == snapshot_pptx.MAX_COUNT_ROWS
    assert shown[-1][0].startswith("…") and sum(count for _, count in shown) == 14


def test_plate_label_limit_is_shared() -> None:
    from app.reporting import snapshot_presentation
    assert snapshot_pdf.MAX_LAYOUT_LABEL is snapshot_presentation.MAX_LAYOUT_LABEL
    assert snapshot_pptx.MAX_LAYOUT_LABEL is snapshot_presentation.MAX_LAYOUT_LABEL
