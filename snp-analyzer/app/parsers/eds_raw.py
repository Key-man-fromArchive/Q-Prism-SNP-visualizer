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
import string
import zipfile
import xml.etree.ElementTree as ET

from app.models import UnifiedData, WellCycleData, ProtocolStep, DataWindow

WELL_ROWS = "ABCDEFGH"
# Row labels for well IDs: A..Z, enough for 96 (8 rows) and 384 (16 rows) plates.
ROW_LABELS = string.ascii_uppercase

# Stage flag labels from tcprotocol.xml
STAGE_LABELS = {
    "PRE_READ": "Pre-Read",
    "PRE_CYCLING": "Initial Denaturation",
    "CYCLING": "Cycling",
    "POST_READ": "Post-Read",
}


def well_index_to_id(idx: int, cols: int = 12) -> str:
    """Convert 0-based row-major well index to a well ID (e.g. A1, H12, P24).

    ``cols`` is the plate column count: 12 for 96-well (8x12),
    24 for 384-well (16x24).
    """
    row = idx // cols
    col = idx % cols + 1
    return f"{ROW_LABELS[row]}{col}"


def _parse_plate_dims(xml_data: bytes) -> tuple[int, int] | None:
    """Determine (rows, cols) from experiment.xml PlateTypeID, e.g. TYPE_16X24.

    Returns None if no recognizable plate type is present, so the caller can
    fall back to inferring geometry from the observed well indices.
    """
    m = re.search(rb"TYPE_(\d+)X(\d+)", xml_data)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    return None


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

        # Find experiment.xml (optional, for plate geometry: 96-well vs 384-well)
        plate_dims: tuple[int, int] | None = None
        exp_path = _find_file(names, "experiment.xml")
        if exp_path:
            plate_dims = _parse_plate_dims(zf.read(exp_path))

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
    sample_names, _, _ = _parse_plate_metadata(xml_data)
    return sample_names


def _parse_marker_groups(xml_data: bytes) -> dict[str, list[int]] | None:
    """Parse plate_setup.xml for marker-task groups.

    Returns {marker_name: [well_indices]} for every explicit marker, including
    a single-marker plate, or None when the file declares no marker.
    """
    _, groups, _ = _parse_plate_metadata(xml_data)
    return groups


def _parse_plate_metadata(
    xml_data: bytes,
) -> tuple[dict[int, str], dict[str, list[int]] | None, dict[int, str]]:
    """Parse explicit sample, assay, and task metadata from plate_setup.xml."""
    root = ET.fromstring(xml_data)
    sample_names: dict[int, str] = {}
    marker_groups: dict[str, list[int]] = {}
    well_types: dict[int, str] = {}

    for feature_map in root.findall(".//FeatureMap"):
        feature_id = feature_map.findtext("Feature/Id", "").strip().lower()
        for feature_value in feature_map.findall("FeatureValue"):
            index_text = feature_value.findtext("Index")
            if index_text is None:
                continue
            well_idx = int(index_text)

            if feature_id == "sample":
                name = feature_value.findtext(".//Sample/Name", "").strip()
                if name:
                    sample_names[well_idx] = name

            if feature_id == "marker-task":
                marker_name = feature_value.findtext(
                    ".//MarkerTask/Marker/Name", ""
                ).strip()
                if marker_name:
                    marker_groups.setdefault(marker_name, []).append(well_idx)

            if well_type := _parse_eds_well_type(feature_value, feature_id):
                well_types[well_idx] = well_type

    groups = marker_groups or None
    return sample_names, groups, well_types


def _parse_eds_well_type(feature_value: ET.Element, feature_id: str) -> str | None:
    """Map QuantStudio task/sample-type values onto the application's roles."""
    task_roots: list[ET.Element] = []
    for element in feature_value.iter():
        tag = element.tag.rsplit("}", 1)[-1].lower()
        if tag in {"task", "sampletype", "welltype"}:
            task_roots.append(element)

    if not task_roots and feature_id not in {"task", "sample-type", "well-type"}:
        return None

    candidates: set[str] = set()
    roots = task_roots or [feature_value]
    for root in roots:
        for text in root.itertext():
            normalized = re.sub(r"[^A-Z0-9]+", "_", text.strip().upper()).strip("_")
            if normalized:
                candidates.add(normalized)

    mappings = {
        "NTC": "NTC",
        "NEGATIVE_CONTROL": "NTC",
        "NO_TEMPLATE_CONTROL": "NTC",
        "UNKNOWN": "Unknown",
        "SAMPLE": "Unknown",
        "POSITIVE_CONTROL": "Positive Control",
        "POSITIVE_1_1": "Allele 1 Control",
        "POSITIVE_CONTROL_1_1": "Allele 1 Control",
        "POSITIVE_2_2": "Allele 2 Control",
        "POSITIVE_CONTROL_2_2": "Allele 2 Control",
        "POSITIVE_1_2": "Heterozygous",
        "POSITIVE_CONTROL_1_2": "Heterozygous",
    }
    for candidate in candidates:
        if candidate in mappings:
            return mappings[candidate]
    return None


def _parse_protocol(xml_data: bytes) -> list[ProtocolStep]:
    """Parse tcprotocol.xml for PCR protocol steps with phase grouping.

    Assigns phase labels for visual grouping:
    Pre-read / Initial Denaturation / Amplification 1,2,3 / Post-read.
    """
    root = ET.fromstring(xml_data)
    steps: list[ProtocolStep] = []
    step_num = 0

    # First pass: count CYCLING stages and determine phase names
    cycling_stages: list[tuple[int, ET.Element]] = []
    all_stages = root.findall("TCStage")
    for idx, stage in enumerate(all_stages):
        if stage.findtext("StageFlag", "") == "CYCLING":
            cycling_stages.append((idx, stage))

    # Build phase names for cycling stages
    cycling_phase_names: dict[int, str] = {}
    for amp_num, (stage_idx, stage) in enumerate(cycling_stages, 1):
        auto_delta = stage.findtext("AutoDeltaEnabled", "false") == "true"
        has_collection = any(
            s.findtext("CollectionFlag", "0") == "1"
            for s in stage.findall("TCStep")
        )
        suffix = ""
        if auto_delta:
            suffix = " (Touchdown)"
        elif has_collection:
            suffix = " (Read)"
        cycling_phase_names[stage_idx] = f"Amplification {amp_num}{suffix}"

    # Second pass: build steps with phases and GOTO labels
    for stage_idx, stage in enumerate(all_stages):
        stage_flag = stage.findtext("StageFlag", "")
        repetitions = int(stage.findtext("NumOfRepetitions", "1"))
        label_base = STAGE_LABELS.get(stage_flag, stage_flag)
        auto_delta = stage.findtext("AutoDeltaEnabled", "false") == "true"

        # Determine phase for this stage
        if stage_flag == "PRE_READ":
            phase = "Pre-read"
        elif stage_flag == "POST_READ":
            phase = "Post-read"
        elif stage_flag == "PRE_CYCLING":
            phase = "Initial Denaturation"
        elif stage_idx in cycling_phase_names:
            phase = cycling_phase_names[stage_idx]
        else:
            phase = stage_flag

        tc_steps = stage.findall("TCStep")
        first_step_in_stage = step_num + 1
        for i, tc_step in enumerate(tc_steps):
            step_num += 1
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

            # GOTO label on last step of cycling stages with repetitions > 1
            goto_label = ""
            if stage_flag == "CYCLING" and repetitions > 1 and i == len(tc_steps) - 1:
                last_step = step_num
                if first_step_in_stage == last_step:
                    goto_label = f"\u21a9 Repeat Step {first_step_in_stage} \u00d7 {repetitions} cycles"
                else:
                    goto_label = f"\u21a9 Repeat Steps {first_step_in_stage}-{last_step} \u00d7 {repetitions} cycles"

            steps.append(ProtocolStep(
                step=step_num,
                temperature=temp,
                duration_sec=hold_time,
                cycles=repetitions,
                label=label,
                phase=phase,
                goto_label=goto_label,
            ))

    return steps


def _parse_stage_type_map(xml_data: bytes) -> dict[int, str]:
    """Parse tcprotocol.xml to build stage_index -> stage_type mapping.

    TCStageFlags values in multicomponentdata.xml are 1-based stage indices.
    This maps each stage index to its type (PRE_READ, CYCLING, POST_READ, etc).
    Only CYCLING stages with data collection are relevant for amplification.
    """
    root = ET.fromstring(xml_data)
    stage_map: dict[int, str] = {}

    for i, stage in enumerate(root.findall("TCStage"), 1):
        stage_flag = stage.findtext("StageFlag", "")
        # Only mark CYCLING stages that have data collection
        if stage_flag == "CYCLING":
            has_collection = any(
                s.findtext("CollectionFlag", "0") == "1"
                for s in stage.findall("TCStep")
            )
            if has_collection:
                stage_map[i] = "CYCLING"
            # Skip non-collecting CYCLING stages (e.g., touchdown)
        elif stage_flag in ("PRE_READ", "POST_READ", "PRE_CYCLING"):
            stage_map[i] = stage_flag

    return stage_map


def _well_sort_key(well: str) -> tuple[int, int]:
    row = ord(well[0]) - ord("A")
    col = int(well[1:])
    return (row, col)
