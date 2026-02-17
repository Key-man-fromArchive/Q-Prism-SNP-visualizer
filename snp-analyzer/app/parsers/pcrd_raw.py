"""Parser for Bio-Rad .pcrd raw instrument files.

.pcrd files are ZipCrypto-encrypted ZIP archives containing a single XML file
(<experimentalData2>) with raw RFU data, plate setup, and protocol information.

Supports complex ASG-PCR protocols with multiple data acquisition points:
  - Pre-read (30°C) → outlier detection
  - Amplification reads (40°C, 23 cycles) → signal curves
  - Post-read (30°C) → outlier detection

XML hierarchy:
  experimentalData2:
    plateSetup2: rows, columns, dyes
      dyeLayersList/dyeLayer: plateName (FAM, HEX, VIC, ROX)
        fluor: channelPosition (0, 1, 2, ...)
        wellSamples/wellSample: plateIndex, wellSampleType, sampleId
    protocol2BaseList: TemperatureStep + GotoStep sequence
    runData/plateReadDataVector/plateRead:
      PlateRead/Hdr/PlateReadDataHeader: Step, Cycle, ChCount, NumRows, NumCols
      PlateRead/Data/PAr: semicolon-delimited RFU stats
        Layout: (NumRows * NumCols) positions × ChCount channels × 4 stats
        Index: position * (ChCount * 4) + channel * 4 + stat_offset
        stat_offset: 0=mean, 1=stdev, 2=min, 3=max
        Rows 0-7 = wells A-H, row 8 = reference (skip)
"""

import zipfile
import xml.etree.ElementTree as ET

from app.models import UnifiedData, WellCycleData, ProtocolStep, DataWindow

WELL_ROWS = "ABCDEFGH"
_PCRD_PASSWORD = b"***REDACTED***"

# Well sample types that indicate an assigned well
_ASSIGNED_TYPES = {"wcSample", "wcNTC", "wcPostiveControl", "wcPositiveControl"}


def parse_pcrd(file_path: str) -> UnifiedData:
    """Parse a Bio-Rad .pcrd raw instrument file."""
    root = _extract_xml(file_path)

    # Parse plate setup: dye channels, well assignments, sample names
    plate_setup = root.find("plateSetup2")
    if plate_setup is None:
        raise ValueError("No plateSetup2 found in .pcrd file.")

    rows = int(plate_setup.get("rows", "8"))
    cols = int(plate_setup.get("columns", "12"))

    if rows != 8 or cols != 12:
        raise ValueError(
            f"This appears to be a {rows * cols}-well plate ({rows} rows × {cols} cols).\n"
            "Only 96-well plates (8×12) are currently supported."
        )

    channel_map, allele2_dye, has_rox, sample_names, ntc_wells, assigned_wells = (
        _parse_dye_layers(plate_setup)
    )

    if not assigned_wells:
        raise ValueError("No assigned wells found in .pcrd file (all wells are empty).")

    # Parse protocol for display
    protocol_steps = _parse_protocol(root)

    # Parse plate read data
    plate_reads = _parse_plate_reads(root, channel_map, assigned_wells)
    if not plate_reads:
        raise ValueError("No fluorescence data (plateReads) found in .pcrd file.")

    # Classify reads into data windows and assign sequential cycle numbers
    data_windows, cycle_data = _classify_reads_into_windows(plate_reads)

    # Build UnifiedData
    wells_set: set[str] = set()
    cycles_set: set[int] = set()
    data: list[WellCycleData] = []

    for entry in cycle_data:
        cycle_num = entry["cycle"]
        for well_id, rfu in entry["wells"].items():
            data.append(WellCycleData(
                well=well_id,
                cycle=cycle_num,
                fam=rfu["fam"],
                allele2=rfu["allele2"],
                rox=rfu.get("rox"),
            ))
            wells_set.add(well_id)
            cycles_set.add(cycle_num)

    # Convert sample name indices to well IDs
    sample_names_by_id = {}
    for plate_idx, name in sample_names.items():
        if 0 <= plate_idx < 96:
            well_id = _well_index_to_id(plate_idx)
            sample_names_by_id[well_id] = name

    return UnifiedData(
        instrument="CFX Opus (raw)",
        allele2_dye=allele2_dye,
        wells=sorted(wells_set, key=_well_sort_key),
        cycles=sorted(cycles_set),
        data=data,
        has_rox=has_rox,
        sample_names=sample_names_by_id or None,
        protocol_steps=protocol_steps or None,
        data_windows=data_windows if data_windows else None,
    )


def _extract_xml(file_path: str) -> ET.Element:
    """Open encrypted ZIP, extract single XML entry, parse to Element."""
    with zipfile.ZipFile(file_path, "r") as zf:
        names = zf.namelist()
        if not names:
            raise ValueError("Empty .pcrd archive — no files inside.")
        xml_bytes = zf.read(names[0], pwd=_PCRD_PASSWORD)
    # Strip BOM if present
    if xml_bytes[:3] == b"\xef\xbb\xbf":
        xml_bytes = xml_bytes[3:]
    return ET.fromstring(xml_bytes)


def _parse_dye_layers(plate_setup: ET.Element) -> tuple[
    dict[str, int],       # channel_map: dye_name -> channel_position
    str,                  # allele2_dye name (VIC or HEX)
    bool,                 # has_rox
    dict[int, str],       # sample_names: plate_index -> sample_id
    set[str],             # ntc_wells: set of well IDs
    set[int],             # assigned_wells: set of plate indices
]:
    """Parse dyeLayersList for channel mapping, well assignments, and sample names."""
    channel_map: dict[str, int] = {}
    sample_names: dict[int, str] = {}
    ntc_wells: set[str] = set()
    assigned_wells: set[int] = set()
    allele2_dye = "VIC"
    has_rox = False

    for dye_layer in plate_setup.findall(".//dyeLayer"):
        dye_name = dye_layer.get("plateName", "")
        fluor = dye_layer.find("fluor")
        if fluor is not None:
            ch_pos = int(fluor.get("channelPosition", "-1"))
            channel_map[dye_name.upper()] = ch_pos

        if dye_name.upper() in ("VIC", "HEX"):
            allele2_dye = dye_name.upper()
        if dye_name.upper() == "ROX":
            has_rox = True

        # Collect well assignments from this layer
        for ws in dye_layer.findall(".//wellSample"):
            ws_type = ws.get("wellSampleType", "")
            plate_idx = int(ws.get("plateIndex", "-1"))
            if plate_idx < 0:
                continue

            if ws_type in _ASSIGNED_TYPES:
                assigned_wells.add(plate_idx)

            if ws_type == "wcNTC" and 0 <= plate_idx < 96:
                ntc_wells.add(_well_index_to_id(plate_idx))

            sample_id = ws.get("sampleId", "")
            if sample_id and plate_idx not in sample_names:
                sample_names[plate_idx] = sample_id

    # Validate dye presence
    if "FAM" not in channel_map:
        raise ValueError(
            f"No FAM dye found. Available dyes: {list(channel_map.keys())}\n"
            "This .pcrd file may not be from an SNP discrimination experiment."
        )
    if allele2_dye not in channel_map:
        raise ValueError(
            f"No VIC or HEX dye found. Available dyes: {list(channel_map.keys())}\n"
            "This .pcrd file may not be from an SNP discrimination experiment."
        )

    return channel_map, allele2_dye, has_rox, sample_names, ntc_wells, assigned_wells


def _parse_protocol(root: ET.Element) -> list[ProtocolStep]:
    """Parse protocol2BaseList for PCR protocol display."""
    proto = root.find(".//protocol2BaseList")
    if proto is None:
        return []

    # First pass: collect all steps with their properties
    raw_steps: list[dict] = []
    for elem in proto:
        if elem.tag == "TemperatureStep":
            temp = float(elem.get("temperatureStepTemp", "0"))
            hold = int(elem.get("temperatureStepHoldTime", "0"))
            has_read = elem.find("PlateReadOption") is not None
            inc = elem.find("IncrementOption")
            inc_temp = float(inc.get("optionTemperatureIncrement", "0")) if inc is not None else 0.0
            raw_steps.append({
                "type": "temp",
                "temp": temp,
                "hold": hold,
                "has_read": has_read,
                "inc_temp": inc_temp,
            })
        elif elem.tag == "GotoStep":
            target = int(elem.get("optionGotoStep", "0"))
            count = int(elem.get("optionGotoCycle", "0"))
            raw_steps.append({
                "type": "goto",
                "target": target,
                "count": count,
            })

    # Second pass: resolve GOTOs to get cycle counts for temperature steps
    cycle_counts: dict[int, int] = {}  # step_index -> total cycles
    for i, step in enumerate(raw_steps):
        if step["type"] == "goto":
            target = step["target"]
            count = step["count"]
            # GOTO repeats steps from target to (i-1) for count+1 total iterations
            # But the first iteration already happened, so GOTO adds `count` more
            for j in range(target, i):
                if raw_steps[j]["type"] == "temp":
                    cycle_counts[j] = cycle_counts.get(j, 1) + count

    # Third pass: build ProtocolStep list
    steps: list[ProtocolStep] = []
    step_num = 0
    for i, step in enumerate(raw_steps):
        if step["type"] != "temp":
            continue
        step_num += 1
        total_cycles = cycle_counts.get(i, 1)
        temp = step["temp"]
        hold = step["hold"]

        # Generate label
        if temp <= 32 and step["has_read"]:
            label = "Pre-Read" if i < len(raw_steps) // 2 else "Post-Read"
        elif temp >= 90:
            label = "Initial Denaturation" if total_cycles == 1 else "Denaturation"
        elif step["has_read"]:
            label = "Data Collection"
        elif step["inc_temp"] != 0:
            label = f"Annealing (TD {step['inc_temp']:+.1f}/cyc)"
        elif total_cycles > 1:
            label = "Denaturation" if temp >= 85 else "Annealing"
        else:
            label = "Hold"

        steps.append(ProtocolStep(
            step=step_num,
            temperature=temp,
            duration_sec=hold,
            cycles=total_cycles,
            label=label,
        ))

    return steps


def _parse_plate_reads(
    root: ET.Element,
    channel_map: dict[str, int],
    assigned_wells: set[int],
) -> list[dict]:
    """Extract RFU data from plateRead elements.

    Returns list of dicts: [{step, cycle, wells: {well_id: {fam, allele2, rox}}}]
    """
    prdv = root.find("runData/plateReadDataVector")
    if prdv is None:
        return []

    fam_ch = channel_map.get("FAM", 0)
    allele2_ch = -1
    for dye in ("HEX", "VIC"):
        if dye in channel_map:
            allele2_ch = channel_map[dye]
            break
    rox_ch = channel_map.get("ROX", -1)

    results: list[dict] = []

    for pr_elem in prdv.findall("plateRead"):
        inner = pr_elem.find("PlateRead")
        if inner is None:
            continue

        hdr_elem = inner.find("Hdr/PlateReadDataHeader")
        if hdr_elem is None:
            continue

        step = int(hdr_elem.findtext("Step", "0"))
        cycle = int(hdr_elem.findtext("Cycle", "0"))
        ch_count = int(hdr_elem.findtext("ChCount", "6"))
        num_cols = int(hdr_elem.findtext("NumCols", "12"))

        data_elem = inner.find("Data/PAr")
        if data_elem is None or not data_elem.text:
            continue

        vals_text = data_elem.text.split(";")
        vals = [float(v) for v in vals_text if v.strip()]

        stats_per_pos = ch_count * 4
        expected = 108 * stats_per_pos  # 9 rows × 12 cols
        if len(vals) < expected:
            raise ValueError(
                f"PAr data has {len(vals)} values, expected {expected} "
                f"(108 positions × {ch_count} channels × 4 stats)."
            )

        wells: dict[str, dict] = {}
        for row in range(8):  # rows 0-7 = wells A-H (skip row 8 = reference)
            for col in range(num_cols):
                plate_idx = row * num_cols + col
                if plate_idx not in assigned_wells:
                    continue

                pos = row * num_cols + col
                base = pos * stats_per_pos

                fam_val = vals[base + fam_ch * 4]
                allele2_val = vals[base + allele2_ch * 4] if allele2_ch >= 0 else 0.0
                rox_val = vals[base + rox_ch * 4] if rox_ch >= 0 else None

                well_id = _well_index_to_id(plate_idx)
                wells[well_id] = {
                    "fam": fam_val,
                    "allele2": allele2_val,
                    "rox": rox_val,
                }

        results.append({"step": step, "cycle": cycle, "wells": wells})

    return results


def _classify_reads_into_windows(
    plate_reads: list[dict],
) -> tuple[list[DataWindow], list[dict]]:
    """Group plateReads by step, classify into named DataWindows.

    Classification heuristic:
      1. Largest-count read group → "Amplification"
      2. Single-read groups before amp → "Pre-read"
      3. Single-read groups after amp → "Post-read"
      4. If only one read group → "Amplification"

    Returns (data_windows, cycle_data) where cycle_data has sequential cycle numbers.
    """
    # Group by step value
    from collections import OrderedDict
    step_groups: OrderedDict[int, list[dict]] = OrderedDict()
    for pr in plate_reads:
        step = pr["step"]
        if step not in step_groups:
            step_groups[step] = []
        step_groups[step].append(pr)

    step_list = list(step_groups.keys())  # ordered by appearance

    if len(step_list) == 1:
        # Simple protocol: all reads are amplification
        amp_step = step_list[0]
        reads = step_groups[amp_step]
        cycle_data = []
        for i, pr in enumerate(reads, start=1):
            cycle_data.append({"cycle": i, "wells": pr["wells"]})
        windows = [DataWindow(name="Amplification", start_cycle=1, end_cycle=len(reads))]
        return windows, cycle_data

    # Find amplification: the step with the most reads
    amp_step = max(step_list, key=lambda s: len(step_groups[s]))
    amp_idx = step_list.index(amp_step)

    # Assign sequential cycle numbers across all windows
    windows: list[DataWindow] = []
    cycle_data: list[dict] = []
    cycle_num = 0

    for i, step in enumerate(step_list):
        reads = step_groups[step]
        start = cycle_num + 1

        for pr in reads:
            cycle_num += 1
            cycle_data.append({"cycle": cycle_num, "wells": pr["wells"]})

        end = cycle_num

        if step == amp_step:
            name = "Amplification"
        elif i < amp_idx:
            name = "Pre-read"
        else:
            name = "Post-read"

        windows.append(DataWindow(name=name, start_cycle=start, end_cycle=end))

    return windows, cycle_data


def _well_index_to_id(idx: int) -> str:
    """Convert 0-based row-major well index to A1-H12 format."""
    row = idx // 12
    col = idx % 12 + 1
    return f"{WELL_ROWS[row]}{col}"


def _well_sort_key(well: str) -> tuple[int, int]:
    row = ord(well[0]) - ord("A")
    col = int(well[1:])
    return (row, col)
