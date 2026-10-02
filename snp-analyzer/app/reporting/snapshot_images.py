"""Report PNG bundle: one scatter chart per marker, zipped with fixed metadata."""
import io
import zipfile

from fastapi import HTTPException

from app.models import AnalysisRegionContext
from app.reporting.charts import render_scatter_png
from app.reporting.filenames import safe_filename, unique_filename
from app.reporting.result_snapshot import ResultSnapshot, snapshot_rows
from app.reporting.snapshot_presentation import (
    coordinate_basis, figure_options, report_figures,
)

MAX_ZIP_BYTES = 50 * 1024 * 1024
FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
WHOLE_RUN_NAME = "whole-run"
DOS_ARCHIVE = 0x20  # no Unix mode or owner data; zipfile replaces a zero value with 0o600


def check_size(total: int) -> None:
    if total > MAX_ZIP_BYTES:
        raise HTTPException(413, "The PNG bundle is too large; select fewer markers")


def _marker_name(snapshot: ResultSnapshot, marker: AnalysisRegionContext | None) -> str:
    if marker is None:
        return WHOLE_RUN_NAME
    label = snapshot.marker_labels.get(marker.marker_id)
    return label.name if label else marker.name


def _entry(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, date_time=FIXED_TIMESTAMP)
    info.compress_type = zipfile.ZIP_STORED
    info.create_system = 0
    info.external_attr = DOS_ARCHIVE
    return info


def build_scatter_zip(snapshot: ResultSnapshot) -> bytes:
    """Zip holding one PNG per marker, drawn by the same function as the PDF."""
    figures = report_figures(snapshot, snapshot_rows(snapshot))
    regions: list[AnalysisRegionContext | None] = list(snapshot.context.regions) or [None]
    output, used, total = io.BytesIO(), set(), 0
    with zipfile.ZipFile(output, "w") as archive:
        for figure, marker in zip(figures, regions, strict=True):
            png = render_scatter_png(
                figure.points, snapshot.unified.allele2_dye, ploidy=figure.ploidy,
                coordinate_basis=coordinate_basis(snapshot), **figure_options(snapshot, figure, marker))
            total += len(png)
            check_size(total)
            name = unique_filename(f"{safe_filename(_marker_name(snapshot, marker))}.png", used)
            archive.writestr(_entry(name), png)
    check_size(output.tell())
    return output.getvalue()
