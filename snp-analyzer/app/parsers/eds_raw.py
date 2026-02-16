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

import re
import zipfile
import xml.etree.ElementTree as ET

from app.models import UnifiedData, WellCycleData, ProtocolStep

WELL_ROWS = "ABCDEFGH"

# Stage flag labels from tcprotocol.xml
STAGE_LABELS = {
    "PRE_READ": "Pre-Read",
    "PRE_CYCLING": "Initial Denaturation",
    "CYCLING": "Cycling",
    "POST_READ": "Post-Read",
}


def well_index_to_id(idx: int) -> str:
    """Convert 0-based row-major well index to A1-H12 format."""
    row = idx // 12
    col = idx % 12 + 1
    return f"{WELL_ROWS[row]}{col}"


def _parse_bracket_array(text: str) -> list[float]:
    """Parse '[1.0, 2.0, 3.0]' into list of floats."""
    text = text.strip()
    if text.startswith("["):
        text = text[1:]
    if text.endswith("]"):
        text = text[:-1]
    if not text.strip():
        return []
    return [float(v.strip()) for v in text.split(",")]


def _parse_dye_list(text: str) -> list[str]:
    """Parse '[VIC, FAM, ROX]' into list of dye name strings."""
    text = text.strip()
    if text.startswith("["):
        text = text[1:]
    if text.endswith("]"):
        text = text[:-1]
    if not text.strip():
        return []
    return [v.strip() for v in text.split(",")]


def parse_eds(file_path: str) -> UnifiedData:
    """Parse a QuantStudio .eds raw instrument file."""
    with zipfile.ZipFile(file_path, "r") as zf:
        names = zf.namelist()

        # Find multicomponentdata.xml (required)
        mc_path = _find_file(names, "multicomponentdata.xml")
        if not mc_path:
            raise ValueError(
                "This .eds file does not contain multicomponentdata.xml.\n"
                "It may be corrupted or from an unsupported instrument."
            )

        mc_xml = zf.read(mc_path)
        dye_map, signal_map, stage_flags = _parse_multicomponent(mc_xml)

        # Find plate_setup.xml (optional, for sample names)
        sample_names = {}
        ps_path = _find_file(names, "plate_setup.xml")
        if ps_path:
            ps_xml = zf.read(ps_path)
            sample_names = _parse_plate_setup(ps_xml)

        # Find tcprotocol.xml (optional, for protocol steps)
        protocol_steps = []
        tc_path = _find_file(names, "tcprotocol.xml")
        if tc_path:
            tc_xml = zf.read(tc_path)
            protocol_steps = _parse_protocol(tc_xml)

    # Determine cycle indices for amplification (stage flag == 5)
    # stage_flags = [1, 5, 5, ..., 5, 6]
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

    # Build WellCycleData for amplification cycles only
    data: list[WellCycleData] = []
    wells_set: set[str] = set()
    cycles_set: set[int] = set()

    for well_idx in sorted(signal_map.keys()):
        dyes = dye_map.get(well_idx, [])
        if not dyes:
            continue

        cycle_arrays = signal_map[well_idx]  # list of arrays, one per dye
        well_id = well_index_to_id(well_idx)

        fam_array = cycle_arrays[fam_dye_idx]
        allele2_array = cycle_arrays[allele2_dye_idx]
        rox_array = cycle_arrays[rox_dye_idx] if rox_dye_idx is not None else None

        # Extract amplification cycles only (1-indexed for user display)
        for cycle_num, raw_idx in enumerate(amp_indices, start=1):
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

    # Convert sample names from well index to well ID
    sample_names_by_id = {}
    for well_idx, name in sample_names.items():
        if 0 <= well_idx < 96:
            sample_names_by_id[well_index_to_id(well_idx)] = name

    return UnifiedData(
        instrument="QuantStudio 3 (raw)",
        allele2_dye=allele2_dye,
        wells=sorted(wells_set, key=_well_sort_key),
        cycles=sorted(cycles_set),
        data=data,
        has_rox=has_rox,
        sample_names=sample_names_by_id or None,
        protocol_steps=protocol_steps or None,
    )


def _find_file(names: list[str], filename: str) -> str | None:
    """Find a file in ZIP by basename (case-insensitive)."""
    for n in names:
        if n.lower().endswith("/" + filename.lower()) or n.lower() == filename.lower():
            return n
    return None


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


def _parse_plate_setup(xml_data: bytes) -> dict[int, str]:
    """Parse plate_setup.xml for well -> sample name mapping."""
    root = ET.fromstring(xml_data)
    sample_names: dict[int, str] = {}

    for fm in root.findall(".//FeatureMap"):
        feature = fm.find("Feature")
        if feature is None:
            continue
        fid = feature.findtext("Id", "")
        if fid != "sample":
            continue
        for fv in fm.findall("FeatureValue"):
            idx_text = fv.findtext("Index")
            if idx_text is None:
                continue
            well_idx = int(idx_text)
            name = fv.findtext(".//Sample/Name", "")
            if name:
                sample_names[well_idx] = name

    return sample_names


def _parse_protocol(xml_data: bytes) -> list[ProtocolStep]:
    """Parse tcprotocol.xml for PCR protocol steps."""
    root = ET.fromstring(xml_data)
    steps: list[ProtocolStep] = []
    step_num = 0

    for stage in root.findall("TCStage"):
        stage_flag = stage.findtext("StageFlag", "")
        repetitions = int(stage.findtext("NumOfRepetitions", "1"))
        label_base = STAGE_LABELS.get(stage_flag, stage_flag)
        auto_delta = stage.findtext("AutoDeltaEnabled", "false") == "true"

        tc_steps = stage.findall("TCStep")
        for i, tc_step in enumerate(tc_steps):
            step_num += 1
            # Take first Temperature element (they're all the same per zone)
            temp_elem = tc_step.find("Temperature")
            temp = float(temp_elem.text) if temp_elem is not None else 0.0
            hold_time = int(tc_step.findtext("HoldTime", "0"))

            # Build descriptive label
            ext_temp = float(tc_step.findtext("ExtTemperature", "0"))
            if stage_flag == "PRE_READ":
                label = "Pre-Read"
            elif stage_flag == "POST_READ":
                label = "Post-Read"
            elif stage_flag == "PRE_CYCLING":
                label = "Initial Denaturation"
            elif len(tc_steps) == 1:
                label = label_base
            elif i == 0:
                label = "Denaturation"
                if auto_delta:
                    label += " (Touchdown)"
            elif tc_step.findtext("CollectionFlag", "0") == "1":
                label = "Data Collection"
            else:
                label = "Annealing"
                if auto_delta and ext_temp != 0:
                    label += f" (TD {ext_temp:+.1f}/cyc)"

            steps.append(ProtocolStep(
                step=step_num,
                temperature=temp,
                duration_sec=hold_time,
                cycles=repetitions,
                label=label,
            ))

    return steps


def _well_sort_key(well: str) -> tuple[int, int]:
    row = ord(well[0]) - ord("A")
    col = int(well[1:])
    return (row, col)
