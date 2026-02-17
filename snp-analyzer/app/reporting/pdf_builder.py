"""Build PDF report using reportlab."""
from __future__ import annotations
import io
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak
)

from app.reporting.charts import render_scatter_png, render_plate_png, GENOTYPE_COLORS


def build_report(
    session_id: str,
    instrument: str,
    allele2_dye: str,
    num_wells: int,
    num_cycles: int,
    scatter_points: list[dict],
    plate_wells: list[dict],
    ct_results: dict | None = None,
    filename: str = "",
) -> bytes:
    """Build a complete PDF report.

    Returns: PDF file bytes
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=15*mm, rightMargin=15*mm,
        topMargin=15*mm, bottomMargin=15*mm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("ReportTitle", parent=styles["Heading1"], fontSize=18, spaceAfter=6)
    subtitle_style = ParagraphStyle("ReportSubtitle", parent=styles["Normal"], fontSize=10, textColor=colors.grey, spaceAfter=12)
    h2_style = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=14, spaceBefore=16, spaceAfter=8)
    normal_style = styles["Normal"]

    elements = []

    # Title
    elements.append(Paragraph("SNP Discrimination Report", title_style))
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    elements.append(Paragraph(f"Generated: {now} | Session: {session_id}", subtitle_style))

    # Session info table
    info_data = [
        ["Instrument", instrument],
        ["Allele 2 Dye", allele2_dye],
        ["Wells", str(num_wells)],
        ["Cycles", str(num_cycles)],
    ]
    if filename:
        info_data.append(["Source File", filename])

    info_table = Table(info_data, colWidths=[35*mm, 80*mm])
    info_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.grey),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 12))

    # Scatter plot
    elements.append(Paragraph("Allele Discrimination Plot", h2_style))
    scatter_png = render_scatter_png(scatter_points, allele2_dye)
    scatter_img = Image(io.BytesIO(scatter_png), width=160*mm, height=120*mm)
    elements.append(scatter_img)

    # Plate view
    elements.append(Paragraph("Plate View", h2_style))
    plate_png = render_plate_png(plate_wells)
    plate_img = Image(io.BytesIO(plate_png), width=170*mm, height=100*mm)
    elements.append(plate_img)

    # Genotype summary table
    elements.append(Paragraph("Genotype Summary", h2_style))
    genotype_counts: dict[str, int] = {}
    for p in scatter_points:
        gt = p.get("effective_type", "Unknown")
        genotype_counts[gt] = genotype_counts.get(gt, 0) + 1

    summary_data = [["Genotype", "Count", "%"]]
    total = len(scatter_points) or 1
    for gt in ["Allele 1 Homo", "Allele 2 Homo", "Heterozygous", "NTC", "Undetermined", "Unknown"]:
        count = genotype_counts.get(gt, 0)
        if count > 0:
            pct = f"{count / total * 100:.1f}"
            summary_data.append([gt, str(count), pct])

    if len(summary_data) > 1:
        summary_table = Table(summary_data, colWidths=[50*mm, 25*mm, 25*mm])
        summary_table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.93, 0.95, 0.97)),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.Color(0.85, 0.87, 0.9)),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
        ]))
        elements.append(summary_table)

    # Ct/Cq results table (if available)
    if ct_results:
        elements.append(PageBreak())
        elements.append(Paragraph("Ct/Cq Values", h2_style))
        ct_data = [["Well", "FAM Ct", f"{allele2_dye} Ct"]]
        for well in sorted(ct_results.keys(), key=lambda w: (w[0], int(w[1:]))):
            ct = ct_results[well]
            fam_ct = f"{ct['fam_ct']:.1f}" if ct.get("fam_ct") is not None else "Undet."
            a2_ct = f"{ct['allele2_ct']:.1f}" if ct.get("allele2_ct") is not None else "Undet."
            ct_data.append([well, fam_ct, a2_ct])

        ct_table = Table(ct_data, colWidths=[25*mm, 35*mm, 35*mm])
        ct_table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.93, 0.95, 0.97)),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.Color(0.85, 0.87, 0.9)),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
        ]))
        elements.append(ct_table)

    # Footer
    elements.append(Spacer(1, 20))
    elements.append(Paragraph(
        "Report generated by ASG-PCR SNP Discrimination Analyzer | Powered by Invirustech",
        ParagraphStyle("Footer", parent=normal_style, fontSize=8, textColor=colors.grey, alignment=1),
    ))

    doc.build(elements)
    buf.seek(0)
    return buf.read()
