"""Parser for Bio-Rad CFX Opus Quantification Amplification Results .xlsx files.

File structure (after fixing broken packaging):
- Sheets: FAM, HEX, ROX, Run Information
- Each dye sheet is WIDE format:
  - Column A: empty
  - Column B: Cycle number
  - Columns C-CT: Well IDs as headers (A1, A2, ..., H12)
  - Row 1: Header row
  - Row 2+: One row per cycle (this sample has only 1 cycle)
- Well IDs are native A1-H12 format
"""

import os
from collections.abc import Iterator

import openpyxl

from app.models import UnifiedData, WellCycleData, DataWindow
from app.parsers.detector import MAX_XLSX_SHEET_COLS, MAX_XLSX_SHEET_ROWS, _WorkbookTooLarge
from app.parsers.instrument_detail import cfx_export_detail, cfx_instrument_label
from app.parsers.safe_xml import check_zip_directory
from app.parsers.xlsx_fixer import fix_cfx_xlsx, needs_fixing


def _sheet_rows(ws) -> Iterator[tuple]:
    """Values of a sheet row by row, counting the rows and columns actually read.

    The dimension a sheet declares is not relied on: reading stops with an
    error as soon as the rows or the used columns exceed what an instrument
    export holds.
    """
    if hasattr(ws, "reset_dimensions"):
        ws.reset_dimensions()
    count = 0
    for row in ws.iter_rows(values_only=True):
        count += 1
        if count > MAX_XLSX_SHEET_ROWS:
            raise _too_large(ws, f"more than {MAX_XLSX_SHEET_ROWS} rows")
        if len(row) > MAX_XLSX_SHEET_COLS:
            used = next((i for i in range(len(row), 0, -1) if row[i - 1] is not None), 0)
            if used > MAX_XLSX_SHEET_COLS:
                raise _too_large(ws, f"more than {MAX_XLSX_SHEET_COLS} columns")
        yield row


def _too_large(ws, detail: str) -> _WorkbookTooLarge:
    return _WorkbookTooLarge(
        f"Sheet '{ws.title}' is larger than an instrument export can be ({detail})"
    )


def _cell(row: tuple, index: int):
    return row[index] if index < len(row) else None


def _identity(wb: openpyxl.Workbook) -> dict:
    """``instrument`` and ``instrument_detail`` fields from the Run Information sheet, if any."""
    sheet = next(
        (wb[name] for name in wb.sheetnames if name.strip().lower() == "run information"), None
    )
    rows = _sheet_rows(sheet) if sheet is not None else []
    detail = cfx_export_detail(rows)
    return {"instrument": cfx_instrument_label(detail), "instrument_detail": detail}


def parse_cfx_opus(file_path: str) -> UnifiedData:
    wb, fixed_path = _open_cfx(file_path)
    try:
        return _parse_workbook(wb)
    finally:
        _close_cfx(wb, fixed_path)


def _parse_workbook(wb: openpyxl.Workbook) -> UnifiedData:
    sheet_names = wb.sheetnames

    # Detect allele2 dye
    allele2_dye = "HEX" if "HEX" in sheet_names else "VIC"
    has_rox = "ROX" in sheet_names

    # Parse each dye sheet into {(well, cycle): value}
    fam_data = _parse_dye_sheet(wb["FAM"])
    allele2_data = _parse_dye_sheet(wb[allele2_dye])
    rox_data = _parse_dye_sheet(wb["ROX"]) if has_rox else {}

    # Merge into unified data
    all_keys = set(fam_data.keys()) | set(allele2_data.keys())

    wells_set: set[str] = set()
    cycles_set: set[int] = set()
    data: list[WellCycleData] = []

    for well, cycle in sorted(all_keys):
        fam_val = fam_data.get((well, cycle), 0.0)
        allele2_val = allele2_data.get((well, cycle), 0.0)
        rox_val = rox_data.get((well, cycle)) if has_rox else None

        data.append(
            WellCycleData(
                well=well,
                cycle=cycle,
                fam=fam_val,
                allele2=allele2_val,
                rox=rox_val,
            )
        )
        wells_set.add(well)
        cycles_set.add(cycle)

    sorted_cycles = sorted(cycles_set)
    window_name = "Amplification" if len(sorted_cycles) > 1 else "End Point"
    return UnifiedData(
        **_identity(wb),
        allele2_dye=allele2_dye,
        wells=sorted(wells_set, key=_well_sort_key),
        cycles=sorted_cycles,
        data=data,
        has_rox=has_rox,
        data_windows=[DataWindow(name=window_name, start_cycle=sorted_cycles[0], end_cycle=sorted_cycles[-1])] if sorted_cycles else None,
    )


def _parse_dye_sheet(ws) -> dict[tuple[str, int], float]:
    """Parse a wide-format dye sheet into {(well_id, cycle): rfu_value}."""
    result = {}
    rows = _sheet_rows(ws)

    # Row 1 is header: [None, 'Cycle', 'A1', 'A2', ..., 'H12']
    headers = next(rows, ())

    # Well IDs start at column index 2 (column C)
    well_ids = []
    for i in range(2, len(headers)):
        h = headers[i]
        if h is not None:
            well_ids.append((i, str(h)))

    # Data rows start at row 2
    for row in rows:
        cycle_val = _cell(row, 1)
        if cycle_val is None:
            continue
        cycle = int(cycle_val)

        for col_idx, well_id in well_ids:
            val = _cell(row, col_idx)
            if val is not None and isinstance(val, (int, float)):
                result[(well_id, cycle)] = float(val)

    return result


def _open_cfx(file_path: str):
    """Open a CFX Opus file once, read-only, fixing packaging if needed.

    Returns (wb, fixed_path); release both with ``_close_cfx``.
    """
    check_zip_directory(file_path)
    fixed_path = None
    if needs_fixing(file_path):
        fixed_path = fix_cfx_xlsx(file_path)
        work_path = fixed_path
    else:
        work_path = file_path
    try:
        wb = openpyxl.load_workbook(work_path, read_only=True, data_only=True)
    except BaseException:
        _close_cfx(None, fixed_path)
        raise
    return wb, fixed_path


def _close_cfx(wb, fixed_path: str | None) -> None:
    if wb is not None:
        wb.close()
    if fixed_path and os.path.exists(fixed_path):
        os.remove(fixed_path)


def parse_cfx_endpoint(file_path: str) -> UnifiedData:
    """Parse CFX Opus End Point Results .xlsx.

    Structure: FAM/HEX/ROX sheets, each in long format:
    [None, Well, Fluor, Target, Content, Sample, End RFU, Call, Sample Type, CallType, Is Control]
    96 rows per sheet (one per well).
    """
    wb, fixed_path = _open_cfx(file_path)
    try:
        sheet_names = wb.sheetnames
        allele2_dye = "HEX" if "HEX" in sheet_names else "VIC"
        has_rox = "ROX" in sheet_names

        fam_data = _parse_endpoint_sheet(wb["FAM"])
        allele2_data = _parse_endpoint_sheet(wb[allele2_dye])
        rox_data = _parse_endpoint_sheet(wb["ROX"]) if has_rox else {}

        all_wells = set(fam_data.keys()) | set(allele2_data.keys())
        data: list[WellCycleData] = []
        wells_set: set[str] = set()

        for well in sorted(all_wells):
            fam_val = fam_data.get(well, 0.0)
            allele2_val = allele2_data.get(well, 0.0)
            rox_val = rox_data.get(well) if has_rox else None

            data.append(WellCycleData(
                well=well, cycle=1,
                fam=fam_val, allele2=allele2_val, rox=rox_val,
            ))
            wells_set.add(well)

        return UnifiedData(
            **_identity(wb),
            allele2_dye=allele2_dye,
            wells=sorted(wells_set, key=_well_sort_key),
            cycles=[1],
            data=data,
            has_rox=has_rox,
            data_windows=[DataWindow(name="End Point", start_cycle=1, end_cycle=1)],
        )
    finally:
        _close_cfx(wb, fixed_path)


def _parse_endpoint_sheet(ws) -> dict[str, float]:
    """Parse End Point Results sheet: {well_id: end_rfu}."""
    result = {}
    rows = _sheet_rows(ws)
    headers = next(rows, ())
    headers_str = [str(h).upper() if h else "" for h in headers]

    well_col = None
    rfu_col = None
    for i, h in enumerate(headers_str):
        if h == "WELL":
            well_col = i
        if h == "END RFU":
            rfu_col = i

    if well_col is None or rfu_col is None:
        return result

    for row in rows:
        well = _cell(row, well_col)
        rfu = _cell(row, rfu_col)

        if well and rfu is not None and isinstance(rfu, (int, float)):
            # Normalize well format: A01 -> A1
            well_str = str(well).strip()
            if len(well_str) == 3 and well_str[1] == "0":
                well_str = well_str[0] + well_str[2]
            result[well_str] = float(rfu)

    return result


def parse_cfx_allelic(file_path: str) -> UnifiedData:
    """Parse CFX Opus Allelic Discrimination Results .xlsx.

    Structure: ADSheet with [None, Well, Sample, Call, Type, RFU1, RFU2]
    RFU1 = FAM, RFU2 = HEX (based on value comparison with known data).
    No ROX data available.
    """
    wb, fixed_path = _open_cfx(file_path)
    try:
        ws = wb["ADSheet"]
        rows = _sheet_rows(ws)
        headers = next(rows, ())
        headers_str = [str(h).upper() if h else "" for h in headers]

        well_col = None
        rfu1_col = None
        rfu2_col = None
        call_col = None
        sample_col = None

        for i, h in enumerate(headers_str):
            if h == "WELL":
                well_col = i
            elif h == "RFU1":
                rfu1_col = i
            elif h == "RFU2":
                rfu2_col = i
            elif h == "CALL":
                call_col = i
            elif h == "SAMPLE":
                sample_col = i

        if well_col is None or rfu1_col is None or rfu2_col is None:
            raise ValueError("ADSheet missing required columns (Well, RFU1, RFU2)")

        data: list[WellCycleData] = []
        wells_set: set[str] = set()
        sample_names: dict[str, str] = {}

        for row in rows:
            well = _cell(row, well_col)
            rfu1 = _cell(row, rfu1_col)
            rfu2 = _cell(row, rfu2_col)

            if not well or not isinstance(rfu1, (int, float)) or not isinstance(rfu2, (int, float)):
                continue

            well_str = str(well).strip()
            if len(well_str) == 3 and well_str[1] == "0":
                well_str = well_str[0] + well_str[2]

            data.append(WellCycleData(
                well=well_str, cycle=1,
                fam=float(rfu1), allele2=float(rfu2), rox=None,
            ))
            wells_set.add(well_str)

            if sample_col is not None:
                sample = _cell(row, sample_col)
                if sample:
                    sample_names[well_str] = str(sample)

        return UnifiedData(
            **_identity(wb),
            allele2_dye="HEX",
            wells=sorted(wells_set, key=_well_sort_key),
            cycles=[1],
            data=data,
            has_rox=False,
            sample_names=sample_names if sample_names else None,
            data_windows=[DataWindow(name="End Point", start_cycle=1, end_cycle=1)],
        )
    finally:
        _close_cfx(wb, fixed_path)


def _well_sort_key(well: str) -> tuple[int, int]:
    row = ord(well[0]) - ord("A")
    col = int(well[1:])
    return (row, col)
