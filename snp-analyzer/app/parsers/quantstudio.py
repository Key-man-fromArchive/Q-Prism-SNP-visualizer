"""Parser for QuantStudio 3 Multicomponent Data .xls files.

File structure:
- Rows 0-40: Key-value metadata pairs
- Row 41: Blank separator
- Row 42: Header row (e.g., ['Well', 'Cycle', 'VIC', 'ROX', 'FAM'])
- Row 43+: Data rows in cycle-major order (all wells for cycle 1, then cycle 2, etc.)
- Wells are numeric 1-96, need conversion to A1-H12
- Empty wells have '' (empty string) for dye values
"""

import xlrd

from app.models import UnifiedData, WellCycleData, DataWindow

WELL_ROWS = "ABCDEFGH"


def well_num_to_id(n: int) -> str:
    """Convert 1-based well number to A1-H12 format (row-major order)."""
    row = (n - 1) // 12
    col = (n - 1) % 12 + 1
    return f"{WELL_ROWS[row]}{col}"


def find_header_row(sheet: xlrd.sheet.Sheet) -> int:
    """Find the header row by looking for 'Well' in column A."""
    for r in range(min(60, sheet.nrows)):
        val = sheet.cell_value(r, 0)
        if isinstance(val, str) and val.strip().lower() == "well":
            return r
    raise ValueError("Could not find header row with 'Well' in column A")


def parse_quantstudio(file_path: str) -> UnifiedData:
    wb = xlrd.open_workbook(file_path)
    sheet = wb.sheet_by_index(0)

    header_row = find_header_row(sheet)
    headers = [sheet.cell_value(header_row, c).strip() for c in range(sheet.ncols)]

    # Dynamically detect column indices
    col_map = {}
    for i, h in enumerate(headers):
        col_map[h.upper()] = i

    well_col = col_map.get("WELL")
    cycle_col = col_map.get("CYCLE")
    fam_col = col_map.get("FAM")
    rox_col = col_map.get("ROX")

    if well_col is None or cycle_col is None or fam_col is None:
        raise ValueError(f"Missing required columns. Found: {headers}")

    # Detect allele2 dye: VIC or HEX
    allele2_dye = None
    allele2_col = None
    for dye in ("VIC", "HEX"):
        if dye in col_map:
            allele2_dye = dye
            allele2_col = col_map[dye]
            break

    if allele2_col is None:
        raise ValueError(f"No VIC or HEX column found. Columns: {headers}")

    has_rox = rox_col is not None

    data: list[WellCycleData] = []
    wells_set: set[str] = set()
    cycles_set: set[int] = set()

    data_start = header_row + 1
    for r in range(data_start, sheet.nrows):
        well_num = sheet.cell_value(r, well_col)
        cycle_val = sheet.cell_value(r, cycle_col)

        if not isinstance(well_num, (int, float)) or not isinstance(
            cycle_val, (int, float)
        ):
            continue

        well_id = well_num_to_id(int(well_num))
        cycle = int(cycle_val)

        fam_val = sheet.cell_value(r, fam_col)
        allele2_val = sheet.cell_value(r, allele2_col)
        rox_val = sheet.cell_value(r, rox_col) if has_rox else None

        # Skip empty wells (dye values are empty strings)
        if not isinstance(fam_val, (int, float)):
            continue

        data.append(
            WellCycleData(
                well=well_id,
                cycle=cycle,
                fam=float(fam_val),
                allele2=float(allele2_val) if isinstance(allele2_val, (int, float)) else 0.0,
                rox=float(rox_val) if isinstance(rox_val, (int, float)) else None,
            )
        )
        wells_set.add(well_id)
        cycles_set.add(cycle)

    sorted_cycles = sorted(cycles_set)
    return UnifiedData(
        instrument="QuantStudio 3",
        allele2_dye=allele2_dye,
        wells=sorted(wells_set, key=_well_sort_key),
        cycles=sorted_cycles,
        data=data,
        has_rox=has_rox,
        data_windows=[DataWindow(name="Amplification", start_cycle=sorted_cycles[0], end_cycle=sorted_cycles[-1])] if sorted_cycles else None,
    )


def parse_quantstudio_amplification(file_path: str) -> UnifiedData:
    """Parse Amplification Data .xls (Rn/DeltaRn per allele per cycle).

    Structure: Well, Well Position, Cycle, Target Name, Rn, Delta Rn
    Two rows per well per cycle (one per allele target).
    We use Rn values and pivot allele targets into FAM and VIC/HEX channels.
    """
    wb = xlrd.open_workbook(file_path)
    sheet = wb.sheet_by_index(0)

    header_row = find_header_row(sheet)
    headers = [sheet.cell_value(header_row, c).strip() for c in range(sheet.ncols)]

    col_map = {}
    for i, h in enumerate(headers):
        col_map[h.upper()] = i

    well_col = col_map.get("WELL")
    pos_col = col_map.get("WELL POSITION")
    cycle_col = col_map.get("CYCLE")
    target_col = col_map.get("TARGET NAME")
    rn_col = col_map.get("RN")

    if well_col is None or cycle_col is None or target_col is None or rn_col is None:
        raise ValueError(f"Missing required columns for Amplification Data. Found: {headers}")

    # First pass: collect all target names to identify alleles
    targets: set[str] = set()
    data_start = header_row + 1
    for r in range(data_start, sheet.nrows):
        t = sheet.cell_value(r, target_col)
        if isinstance(t, str) and t.strip():
            targets.add(t.strip())

    # Identify which target is FAM (Allele 1) and which is VIC/HEX (Allele 2)
    # QS files may label targets as "Allele 1" (=VIC/HEX) and "Allele 2" (=FAM)
    fam_target = None
    allele2_target = None
    allele2_dye = "VIC"

    for t in sorted(targets):
        t_lower = t.lower()
        if "allele 2" in t_lower or "fam" in t_lower:
            fam_target = t
        elif "allele 1" in t_lower or "vic" in t_lower or "hex" in t_lower:
            allele2_target = t
            if "hex" in t_lower:
                allele2_dye = "HEX"

    if not fam_target and not allele2_target and len(targets) == 2:
        t_list = sorted(targets)
        allele2_target = t_list[0]
        fam_target = t_list[1]

    if not fam_target or not allele2_target:
        raise ValueError(f"Could not identify allele targets. Found targets: {targets}")

    # Second pass: collect Rn values keyed by (well, cycle, target)
    rn_data: dict[tuple[str, int, str], float] = {}
    for r in range(data_start, sheet.nrows):
        well_num = sheet.cell_value(r, well_col)
        cycle_val = sheet.cell_value(r, cycle_col)
        target = sheet.cell_value(r, target_col)
        rn_val = sheet.cell_value(r, rn_col)

        if not isinstance(well_num, (int, float)) or not isinstance(cycle_val, (int, float)):
            continue
        if not isinstance(target, str) or not target.strip():
            continue
        if not isinstance(rn_val, (int, float)):
            continue

        well_id = well_num_to_id(int(well_num))
        cycle = int(cycle_val)
        rn_data[(well_id, cycle, target.strip())] = float(rn_val)

    # Merge into unified data
    well_cycles: set[tuple[str, int]] = set()
    for well_id, cycle, _ in rn_data:
        well_cycles.add((well_id, cycle))

    data_list: list[WellCycleData] = []
    wells_set: set[str] = set()
    cycles_set: set[int] = set()

    for well_id, cycle in sorted(well_cycles):
        fam_val = rn_data.get((well_id, cycle, fam_target), 0.0)
        allele2_val = rn_data.get((well_id, cycle, allele2_target), 0.0)

        data_list.append(
            WellCycleData(
                well=well_id,
                cycle=cycle,
                fam=fam_val,
                allele2=allele2_val,
                rox=None,  # Rn is already ROX-normalized
            )
        )
        wells_set.add(well_id)
        cycles_set.add(cycle)

    sorted_cycles = sorted(cycles_set)
    return UnifiedData(
        instrument="QuantStudio 3",
        allele2_dye=allele2_dye,
        wells=sorted(wells_set, key=_well_sort_key),
        cycles=sorted_cycles,
        data=data_list,
        has_rox=False,  # Rn is already normalized
        data_windows=[DataWindow(name="Amplification", start_cycle=sorted_cycles[0], end_cycle=sorted_cycles[-1])] if sorted_cycles else None,
    )


def _well_sort_key(well: str) -> tuple[int, int]:
    row = ord(well[0]) - ord("A")
    col = int(well[1:])
    return (row, col)
