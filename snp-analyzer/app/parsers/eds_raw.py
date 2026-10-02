"""Parser for QuantStudio .eds raw instrument files.

.eds files are ZIP archives containing XML data from QuantStudio 3/5/7.
Primary data source: multicomponentdata.xml (spectrally decomposed per-dye fluorescence).
Also extracts: plate_setup.xml (sample names), tcprotocol.xml (PCR protocol).

Data hierarchy in .eds:
  multicomponentdata.xml:
    <DyeData WellIndex="N"><DyeList>[VIC, FAM, ROX]</DyeList></DyeData>
    <SignalData WellIndex="N">  (N CycleData children, one per dye in DyeList order)
      <CycleData>[float, float, ...]</CycleData>  (25 values: 1 pre-read + 23 amplification + 1 post-read)

  WellIndex: 0-based row-major (row*12 + col, A=0..H=7, col1=0..col12=11)
  TCStageFlags: [1, 5, 5, ..., 5, 6]  where 1=PRE_READ, 5=CYCLING, 6=POST_READ
"""

import zipfile
import xml.etree.ElementTree as ET

from app.models import UnifiedData, WellCycleData, DataWindow
from app.parsers.instrument_detail import read_eds_instrument_detail
from app.parsers.eds_common import (
    ROW_LABELS,
    STAGE_LABELS,
    WELL_ROWS,
    _find_file,
    _parse_bracket_array,
    _parse_dye_list,
    _parse_eds_well_type,
    _parse_marker_groups,
    _parse_plate_dims,
    _parse_plate_metadata,
    _parse_plate_setup,
    _parse_protocol,
    _parse_stage_type_map,
    _well_sort_key,
    well_index_to_id,
)

# Shared helpers moved to eds_common; re-exported so existing imports keep working.
__all__ = [
    "ROW_LABELS",
    "STAGE_LABELS",
    "WELL_ROWS",
    "_find_file",
    "_parse_eds_well_type",
    "_parse_marker_groups",
    "_parse_plate_dims",
    "_parse_plate_metadata",
    "_parse_plate_setup",
    "_parse_protocol",
    "_parse_stage_type_map",
    "_well_sort_key",
    "well_index_to_id",
    "parse_eds",
]

def parse_eds(file_path: str) -> UnifiedData:
    """Parse a QuantStudio .eds raw instrument file."""
    with zipfile.ZipFile(file_path, "r") as zf:
        names = zf.namelist()

        # Find multicomponentdata.xml (required)
        mc_path = _find_file(names, "multicomponentdata.xml")
        if not mc_path and _find_file(names, "multicomponent_data.txt"):
            from app.parsers.stepone_eds import parse_stepone_eds

            return parse_stepone_eds(zf, names)
        if not mc_path:
            raise ValueError(
                "This .eds file does not contain multicomponentdata.xml.\n"
                "It may be corrupted or from an unsupported instrument."
            )

        mc_xml = zf.read(mc_path)
        dye_map, signal_map, stage_flags = _parse_multicomponent(mc_xml)

        # Find experiment.xml (optional, for plate geometry: 96-well vs 384-well)
        plate_dims: tuple[int, int] | None = None
        exp_path = _find_file(names, "experiment.xml")
        if exp_path:
            plate_dims = _parse_plate_dims(zf.read(exp_path))

        instrument_detail = read_eds_instrument_detail(zf, names)

        # Find plate_setup.xml (optional, for sample names and marker groups)
        sample_names: dict[int, str] = {}
        marker_groups_raw: dict[str, list[int]] | None = None
        imported_types_raw: dict[int, str] = {}
        ps_path = _find_file(names, "plate_setup.xml")
        if ps_path:
            ps_xml = zf.read(ps_path)
            sample_names, marker_groups_raw, imported_types_raw = _parse_plate_metadata(ps_xml)

        # Find tcprotocol.xml (optional, for protocol steps)
        protocol_steps = []
        stage_type_map: dict[int, str] = {}  # stage_index (1-based) -> stage_type
        tc_path = _find_file(names, "tcprotocol.xml")
        if tc_path:
            tc_xml = zf.read(tc_path)
            protocol_steps = _parse_protocol(tc_xml)
            stage_type_map = _parse_stage_type_map(tc_xml)

    # Determine cycle indices using stage type mapping from protocol
    # TCStageFlags values are 1-based stage indices, not fixed enums.
    # Look up actual stage type (PRE_READ, CYCLING, POST_READ) from protocol.
    amp_indices = []
    pre_read_indices = []
    post_read_indices = []

    if stage_type_map:
        # Find which stage indices have data collection in CYCLING stages
        cycling_with_collection = set()
        for idx, stype in stage_type_map.items():
            if stype == "CYCLING":
                cycling_with_collection.add(idx)
        pre_read_stages = {idx for idx, s in stage_type_map.items() if s == "PRE_READ"}
        post_read_stages = {idx for idx, s in stage_type_map.items() if s == "POST_READ"}

        for i, flag in enumerate(stage_flags):
            if flag in cycling_with_collection:
                amp_indices.append(i)
            elif flag in pre_read_stages:
                pre_read_indices.append(i)
            elif flag in post_read_stages:
                post_read_indices.append(i)
    else:
        # Fallback: assume flag 5=CYCLING, 1=PRE_READ, 6=POST_READ
        amp_indices = [i for i, flag in enumerate(stage_flags) if flag == 5]
        pre_read_indices = [i for i, flag in enumerate(stage_flags) if flag == 1]
        post_read_indices = [i for i, flag in enumerate(stage_flags) if flag == 6]

    # Detect allele2 dye from the first assigned well's dye list
    allele2_dye = "VIC"
    has_rox = False
    first_dyes = None
    for well_idx in sorted(dye_map.keys()):
        dyes = dye_map[well_idx]
        if dyes:
            first_dyes = dyes
            for d in dyes:
                if d.upper() in ("VIC", "HEX"):
                    allele2_dye = d.upper()
                if d.upper() == "ROX":
                    has_rox = True
            break

    if first_dyes is None:
        raise ValueError("No assigned wells found in .eds file.")

    # Build dye role mapping: find FAM, allele2 (VIC/HEX), and ROX indices in dye list
    fam_dye_idx = None
    allele2_dye_idx = None
    rox_dye_idx = None
    for i, d in enumerate(first_dyes):
        d_upper = d.upper()
        if d_upper == "FAM":
            fam_dye_idx = i
        elif d_upper in ("VIC", "HEX"):
            allele2_dye_idx = i
        elif d_upper == "ROX":
            rox_dye_idx = i

    if fam_dye_idx is None or allele2_dye_idx is None:
        raise ValueError(
            f"Expected FAM and VIC/HEX dyes but found: {first_dyes}\n"
            "This .eds file may not be from an SNP discrimination experiment."
        )

    # Determine plate geometry (96-well = 8x12, 384-well = 16x24, etc.).
    # Prefer the declared plate type; otherwise infer from the highest well index.
    if plate_dims:
        plate_rows, plate_cols = plate_dims
    else:
        max_idx = max([*signal_map.keys(), *dye_map.keys(), 0])
        if max_idx >= 96:
            plate_rows, plate_cols = 16, 24
        else:
            plate_rows, plate_cols = 8, 12
    num_wells = plate_rows * plate_cols

    # Build WellCycleData for all data points (pre-read + amplification + post-read)
    all_indices = pre_read_indices + amp_indices + post_read_indices
    data: list[WellCycleData] = []
    wells_set: set[str] = set()
    cycles_set: set[int] = set()

    for well_idx in sorted(signal_map.keys()):
        dyes = dye_map.get(well_idx, [])
        if not dyes:
            continue

        cycle_arrays = signal_map[well_idx]  # list of arrays, one per dye
        well_id = well_index_to_id(well_idx, plate_cols)

        fam_array = cycle_arrays[fam_dye_idx]
        allele2_array = cycle_arrays[allele2_dye_idx]
        rox_array = cycle_arrays[rox_dye_idx] if rox_dye_idx is not None else None

        # Emit sequential cycles 1..N for all data points
        for cycle_num, raw_idx in enumerate(all_indices, start=1):
            if raw_idx >= len(fam_array):
                continue
            fam_val = fam_array[raw_idx]
            allele2_val = allele2_array[raw_idx]
            rox_val = rox_array[raw_idx] if rox_array else None

            data.append(WellCycleData(
                well=well_id,
                cycle=cycle_num,
                fam=fam_val,
                allele2=allele2_val,
                rox=rox_val,
            ))
            wells_set.add(well_id)
            cycles_set.add(cycle_num)

    # Build data windows from stage flag counts
    windows: list[DataWindow] = []
    offset = 1
    if pre_read_indices:
        windows.append(DataWindow(name="Pre-read", start_cycle=offset, end_cycle=offset + len(pre_read_indices) - 1))
        offset += len(pre_read_indices)
    if amp_indices:
        windows.append(DataWindow(name="Amplification", start_cycle=offset, end_cycle=offset + len(amp_indices) - 1))
        offset += len(amp_indices)
    if post_read_indices:
        windows.append(DataWindow(name="Post-read", start_cycle=offset, end_cycle=offset + len(post_read_indices) - 1))
        offset += len(post_read_indices)

    # Convert sample names from well index to well ID
    sample_names_by_id = {}
    for well_idx, name in sample_names.items():
        if 0 <= well_idx < num_wells:
            sample_names_by_id[well_index_to_id(well_idx, plate_cols)] = name

    # Convert explicit assay assignments from well indices to well IDs. These
    # become first-class editable markers when the session is created; they
    # are not legacy well groups.
    imported_markers: dict[str, list[str]] | None = None
    if marker_groups_raw:
        imported_markers = {}
        for marker_name, indices in marker_groups_raw.items():
            ids = [well_index_to_id(idx, plate_cols) for idx in indices if 0 <= idx < num_wells and well_index_to_id(idx, plate_cols) in wells_set]
            if ids:
                imported_markers[marker_name] = sorted(set(ids), key=_well_sort_key)
        if not imported_markers:
            imported_markers = None

    imported_well_types = {
        well_index_to_id(idx, plate_cols): well_type
        for idx, well_type in imported_types_raw.items()
        if 0 <= idx < num_wells and well_index_to_id(idx, plate_cols) in wells_set
    }
    ntc_wells = sorted(
        (well for well, well_type in imported_well_types.items() if well_type == "NTC"),
        key=_well_sort_key,
    )

    return UnifiedData(
        instrument="QuantStudio 3 (raw)" if num_wells == 96 else f"QuantStudio (raw, {num_wells}-well)",
        allele2_dye=allele2_dye,
        wells=sorted(wells_set, key=_well_sort_key),
        cycles=sorted(cycles_set),
        data=data,
        has_rox=has_rox,
        sample_names=sample_names_by_id or None,
        imported_well_types=imported_well_types or None,
        imported_markers=imported_markers,
        protocol_steps=protocol_steps or None,
        data_windows=windows if windows else None,
        well_groups=None,
        ntc_wells=ntc_wells or None,
        instrument_detail=instrument_detail,
    )

def _parse_multicomponent(xml_data: bytes) -> tuple[
    dict[int, list[str]],      # well_idx -> dye list
    dict[int, list[list[float]]],  # well_idx -> [array per dye]
    list[int],                 # stage flags
]:
    """Parse multicomponentdata.xml."""
    root = ET.fromstring(xml_data)

    # Parse TCStageFlags: "[1, 5, 5, ..., 5, 6]"
    stage_flags_text = root.findtext("TCStageFlags", "")
    stage_flags = [int(v) for v in _parse_bracket_array(stage_flags_text)] if stage_flags_text else []

    # Parse DyeData: well_index -> dye list
    dye_map: dict[int, list[str]] = {}
    for dd in root.findall(".//DyeData"):
        well_idx = int(dd.get("WellIndex", "-1"))
        dye_list_text = dd.findtext("DyeList", "[]")
        dyes = _parse_dye_list(dye_list_text)
        dye_map[well_idx] = dyes

    # Parse SignalData: well_index -> list of CycleData arrays
    signal_map: dict[int, list[list[float]]] = {}
    for sd in root.findall(".//SignalData"):
        well_idx = int(sd.get("WellIndex", "-1"))
        cycle_data_elems = sd.findall("CycleData")
        if not cycle_data_elems:
            continue
        arrays = [_parse_bracket_array(cd.text or "") for cd in cycle_data_elems]
        signal_map[well_idx] = arrays

    return dye_map, signal_map, stage_flags
