"""Embedded-font PDF report from accepted whole-run rows."""
import io
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

from app.reporting.charts import genotype_color, render_scatter_png
from app.reporting.result_snapshot import ResultSnapshot, snapshot_rows
from app.processing.ct_calculation import calculate_all_ct
from app.reporting.snapshot_plate import render_snapshot_plate
from app.reporting.snapshot_presentation import (
    CellValue, coordinate_basis, report_counts, report_figures, report_metadata, report_table,
)

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
        "Well", "Marker", "Sample Name", "Genotype", "Confidence (%)", "Marker ID",
        "Ploidy", "Read Status", "Assignment Status"}]
    numeric = [name for name in headers if name == "Well" or "(norm)" in name or "(raw)" in name]
    return identity, numeric


def _results(snapshot: ResultSnapshot) -> list[Flowable]:
    headers, rows = report_table(snapshot)
    output: list[Flowable] = []
    for names in _column_sections(headers):
        indices = [headers.index(name) for name in names]
        widths = [740 // len(indices)] * len(indices)
        output.extend([PageBreak(), paragraph("Whole-run results", 14), Spacer(1, 10)])
        output.append(table([headers[i] for i in indices],
                            [[row[i] for i in indices] for row in rows], widths))
    return output


def _ct_section(snapshot: ResultSnapshot) -> list[Flowable]:
    if len(snapshot.unified.cycles) < 3:
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


def build_snapshot_pdf(snapshot: ResultSnapshot) -> bytes:
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=landscape(A4),
                                 leftMargin=25, rightMargin=25, topMargin=25, bottomMargin=25)
    elements: list[Flowable] = [paragraph("SNP Discrimination Report", 18), Spacer(1, 12)]
    elements.append(table(["Condition", "Value"],
                          [[key, value] for key, value in report_metadata(snapshot)], [160, 570]))
    rows = snapshot_rows(snapshot)
    for figure in report_figures(snapshot, rows):
        elements.extend([PageBreak(), paragraph(figure.title, 14), Spacer(1, 10)])
        png = render_scatter_png(figure.points, snapshot.unified.allele2_dye, ploidy=figure.ploidy,
                                 coordinate_basis=coordinate_basis(snapshot))
        elements.append(Image(io.BytesIO(png), width=560, height=420))
    elements.extend([PageBreak(), paragraph("Genotype counts by marker", 14), Spacer(1, 10),
                     table(["Marker ID", "Genotype", "Count"], report_counts(rows), [220, 350, 160])])
    elements.extend(_results(snapshot))
    elements.extend([PageBreak(), paragraph("Plate view", 14),
                     Image(io.BytesIO(render_snapshot_plate(rows)), width=700, height=410)])
    elements.extend(_plate_legend(snapshot))
    elements.extend(_ct_section(snapshot))
    elements.extend([PageBreak(), paragraph("Analysis context", 14),
                     paragraph(snapshot.context.model_dump_json())])
    document.build(elements)
    return output.getvalue()
