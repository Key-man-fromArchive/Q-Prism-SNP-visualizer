"""Embedded-font PDF report from accepted whole-run rows."""
import io
from collections import Counter
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Flowable, Image, LongTable, PageBreak, Paragraph, SimpleDocTemplate, Spacer,
    TableStyle,
)

from app.models import AnalysisRegionContext
from app.reporting.charts import genotype_color, render_scatter_png
from app.reporting.result_snapshot import ResultRow, ResultSnapshot, snapshot_rows
from app.processing.ct_calculation import calculate_all_ct
from app.reporting.snapshot_plate import render_snapshot_plate
from app.reporting.snapshot_presentation import (
    CellValue, ReportFigure, axis_label, coordinate_basis, cycle_label, display_genotype,
    polyploid_legend, report_counts, report_figures, report_metadata, report_table,
)

CANONICAL_DIPLOID = ("Allele 1 Homo", "Heterozygous", "Allele 2 Homo")
MAX_LAYOUT_LABEL = 12

FONT = "ReportNanum"


def report_style(size: int = 8) -> ParagraphStyle:
    if FONT not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(FONT, str(Path(__file__).parent / "fonts" / "NanumGothic-Regular.ttf")))
    return ParagraphStyle(f"Report{size}", fontName=FONT, fontSize=size,
                          leading=size * 1.4, wordWrap="CJK", splitLongWords=True)


def paragraph(value: object, size: int = 8) -> Paragraph:
    return Paragraph(escape("" if value is None else str(value)), report_style(size))


def table(headers: list[str], rows: list[list[CellValue]], widths: list[int]) -> LongTable:
    cells = [[paragraph(value) for value in headers]]
    cells.extend([paragraph(value) for value in row] for row in rows)
    result = LongTable(cells, colWidths=widths, repeatRows=1, splitByRow=1)
    result.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8eef4")),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.lightgrey),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return result


def _column_sections(headers: list[str]) -> tuple[list[str], list[str]]:
    # Separate identity and numeric tables keep full labels legible on A4.
    identity = [name for name in headers if name in {
        "Well", "Marker", "Sample Name", "Genotype", "Allele Call", "Confidence (%)", "Marker ID",
        "Ploidy", "Read Status", "Assignment Status"}]
    numeric = [name for name in headers if name == "Well" or "(norm)" in name or "(raw)" in name]
    return identity, numeric


def _has_allele_names(rows: list[ResultRow]) -> bool:
    return any(row.allele_labels is not None for row in rows)


def _call_table(
    snapshot: ResultSnapshot, rows: list[ResultRow],
) -> tuple[list[str], list[list[CellValue]]]:
    """Report table; named runs get an ``Allele Call`` column after ``Genotype``."""
    headers, values = report_table(snapshot)
    if not _has_allele_names(rows):
        return headers, values
    at = headers.index("Genotype") + 1
    for row, cells in zip(rows, values, strict=True):
        cells.insert(at, display_genotype(row.genotype, row.marker, row.allele_labels))
    return [*headers[:at], "Allele Call", *headers[at:]], values


def _results(snapshot: ResultSnapshot, result_rows: list[ResultRow]) -> list[Flowable]:
    headers, rows = _call_table(snapshot, result_rows)
    output: list[Flowable] = []
    for names in _column_sections(headers):
        indices = [headers.index(name) for name in names]
        widths = [740 // len(indices)] * len(indices)
        output.extend([PageBreak(), paragraph("Whole-run results", 14), Spacer(1, 10)])
        output.append(table([headers[i] for i in indices],
                            [[row[i] for i in indices] for row in rows], widths))
    return output


def _ct_section(snapshot: ResultSnapshot) -> list[Flowable]:
    # D-3: a run without an amplification curve has no meaningful Ct.
    if len(snapshot.unified.cycles) < 3 or not snapshot.unified.has_amplification_curve:
        return []
    results = calculate_all_ct(snapshot.unified, snapshot.context.use_rox)
    rows: list[list[CellValue]] = [[well, values.get("fam_ct"), values.get("allele2_ct")]
                                 for well, values in results.items()]
    return [PageBreak(), paragraph("Full-curve Ct", 14),
            paragraph(f"All acquisition cycles; use_rox={snapshot.context.use_rox}; background=none. Not a selected-cycle genotype metric. Blank = unavailable / undetermined, not zero."),
            table(["Well", "FAM Ct", f"{snapshot.unified.allele2_dye} Ct"], rows, [100, 300, 300])]


def _plate_legend(snapshot: ResultSnapshot) -> list[Flowable]:
    entries = dict.fromkeys((row.marker.name if row.marker else "Whole-run / outside marker",
                             row.ploidy, row.genotype) for row in snapshot_rows(snapshot))
    rows: list[list[CellValue]] = [["", marker, ploidy, genotype]
                                 for marker, ploidy, genotype in entries]
    legend = table(["Color", "Marker", "Ploidy", "Stored type"], rows, [40, 330, 60, 300])
    for index, (_, ploidy, genotype) in enumerate(entries, 1):
        color = genotype_color(genotype, ploidy or 2) or "#d1d5db"
        legend.setStyle(TableStyle([("BACKGROUND", (0, index), (0, index), colors.HexColor(color))]))
    return [PageBreak(), paragraph("Plate legend / captured marker and ploidy", 14), legend]


def _marker_by_id(snapshot: ResultSnapshot) -> dict[str, AnalysisRegionContext]:
    return {marker.marker_id: marker for marker in snapshot.context.regions}


def _scatter_options(snapshot: ResultSnapshot, marker: AnalysisRegionContext | None) -> dict[str, object]:
    """Allele-aware axis and legend text; empty for a marker without names."""
    label = snapshot.marker_labels.get(marker.marker_id) if marker else None
    labels = label.allele_labels if label else None
    if labels is None:
        return {}
    legend = {g: display_genotype(g, marker, labels) for g in CANONICAL_DIPLOID} if marker.ploidy == 2 else {}
    return {"x_label": axis_label(snapshot, "allele2", marker, labels),
            "y_label": axis_label(snapshot, "fam", marker, labels), "legend_names": legend}


def _figure_page(snapshot: ResultSnapshot, figure: ReportFigure,
                 marker: AnalysisRegionContext | None) -> list[Flowable]:
    png = render_scatter_png(figure.points, snapshot.unified.allele2_dye, ploidy=figure.ploidy,
                             coordinate_basis=coordinate_basis(snapshot),
                             **_scatter_options(snapshot, marker))
    page: list[Flowable] = [PageBreak(), paragraph(figure.title, 14), Spacer(1, 10),
                            Image(io.BytesIO(png), width=560, height=420)]
    label = snapshot.marker_labels.get(marker.marker_id) if marker else None
    legend = polyploid_legend(label.allele_labels, snapshot.unified.allele2_dye) if label and marker.ploidy != 2 else None
    if legend:
        page.append(paragraph(legend))
    return page


def _plate_layout(rows: list[ResultRow]) -> dict[str, str]:
    return {row.marker.marker_id: row.marker.name[:MAX_LAYOUT_LABEL] for row in rows if row.marker}


def _marker_detail(snapshot: ResultSnapshot, rows: list[ResultRow], marker: AnalysisRegionContext) -> list[Flowable]:
    """Counts of this marker's calls plus the plate map with its wells emphasised."""
    own = [row for row in rows if row.marker and row.marker.marker_id == marker.marker_id]
    counts = Counter((row.genotype, display_genotype(row.genotype, row.marker, row.allele_labels))
                     for row in own)
    name = own[0].marker.name if own and own[0].marker else marker.name
    plate = render_snapshot_plate(rows, marker_layout=_plate_layout(rows), highlight_marker_id=marker.marker_id)
    return [PageBreak(), paragraph(f"Marker detail: {name} [{marker.marker_id}]", 14), Spacer(1, 10),
            table(["Genotype", "Allele Call", "Count"],
                  [[genotype, call, count] for (genotype, call), count in counts.items()], [260, 260, 120]),
            Spacer(1, 10), Image(io.BytesIO(plate), width=520, height=303)]


def _marker_pages(snapshot: ResultSnapshot, rows: list[ResultRow]) -> list[Flowable]:
    markers = _marker_by_id(snapshot)
    named = _has_allele_names(rows)
    output: list[Flowable] = []
    for figure, marker in zip(report_figures(snapshot, rows),
                              markers.values() if markers else [None], strict=True):
        output.extend(_figure_page(snapshot, figure, marker))
        if named and marker is not None:
            output.extend(_marker_detail(snapshot, rows, marker))
    return output


def _plate_page(rows: list[ResultRow]) -> list[Flowable]:
    layout = _plate_layout(rows) if _has_allele_names(rows) else None
    png = render_snapshot_plate(rows, marker_layout=layout) if layout else render_snapshot_plate(rows)
    return [PageBreak(), paragraph("Plate view", 14), Image(io.BytesIO(png), width=700, height=410)]


def _metadata(snapshot: ResultSnapshot) -> list[tuple[str, CellValue]]:
    items = report_metadata(snapshot)
    if snapshot.unified.read_labels:
        items.append(("Analysis read", cycle_label(snapshot, snapshot.context.cycle)))
    return items


def build_snapshot_pdf(snapshot: ResultSnapshot) -> bytes:
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=landscape(A4),
                                 leftMargin=25, rightMargin=25, topMargin=25, bottomMargin=25)
    elements: list[Flowable] = [paragraph("SNP Discrimination Report", 18), Spacer(1, 12)]
    elements.append(table(["Condition", "Value"],
                          [[key, value] for key, value in _metadata(snapshot)], [160, 570]))
    rows = snapshot_rows(snapshot)
    elements.extend(_marker_pages(snapshot, rows))
    elements.extend([PageBreak(), paragraph("Genotype counts by marker", 14), Spacer(1, 10),
                     table(["Marker ID", "Genotype", "Count"], report_counts(rows), [220, 350, 160])])
    elements.extend(_results(snapshot, rows))
    elements.extend(_plate_page(rows))
    elements.extend(_plate_legend(snapshot))
    elements.extend(_ct_section(snapshot))
    elements.extend([PageBreak(), paragraph("Analysis context", 14),
                     paragraph(snapshot.context.model_dump_json())])
    document.build(elements)
    return output.getvalue()
