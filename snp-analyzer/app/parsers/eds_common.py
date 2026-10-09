"""Helpers shared by the .eds parsers (QuantStudio raw and StepOnePlus).

Plate geometry, well IDs, ZIP member lookup, bracketed-array parsing and the
``tcprotocol.xml`` / ``plate_setup.xml`` readers live here so that both
instrument parsers can use them without importing each other.
"""

import re
import string
import xml.etree.ElementTree as ET

from app.models import ProtocolStep
from app.parsers.safe_xml import (
    MAX_AUX_XML_BYTES,
    check_plate_dims,
    parse_xml_bytes,
)

WELL_ROWS = "ABCDEFGH"
# Row labels for well IDs: A..Z, enough for 96 (8 rows) and 384 (16 rows) plates.
ROW_LABELS = string.ascii_uppercase

_XML_WHAT = "A plate or protocol document"

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
    m = re.search(rb"TYPE_(\d{1,6})X(\d{1,6})", xml_data)
    if m:
        rows, cols = int(m.group(1)), int(m.group(2))
        check_plate_dims(rows, cols, "The experiment")
        return (rows, cols)
    return None


def _parse_bracket_array(text: str, max_items: int | None = None) -> list[float]:
    """Parse '[1.0, 2.0, 3.0]' into list of floats.

    ``max_items`` refuses a longer array before any value is converted.
    """
    if max_items is not None and text.count(",") >= max_items:
        raise ValueError(f"A data array holds more than {max_items} values")
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


def _find_file(names: list[str], filename: str) -> str | None:
    """Find a file in ZIP by basename (case-insensitive)."""
    for n in names:
        if n.lower().endswith("/" + filename.lower()) or n.lower() == filename.lower():
            return n
    return None


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
    root = parse_xml_bytes(xml_data, _XML_WHAT, MAX_AUX_XML_BYTES)
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
    root = parse_xml_bytes(xml_data, _XML_WHAT, MAX_AUX_XML_BYTES)
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
                    goto_label = f"↩ Repeat Step {first_step_in_stage} × {repetitions} cycles"
                else:
                    goto_label = f"↩ Repeat Steps {first_step_in_stage}-{last_step} × {repetitions} cycles"

            steps.append(ProtocolStep(
                step=step_num,
                temperature=temp,
                duration_sec=hold_time,
                cycles=repetitions,
                label=label,
                phase=phase,
                goto_label=goto_label,
                plate_read=tc_step.findtext("CollectionFlag", "0") == "1",
                temp_increment=ext_temp if (auto_delta and ext_temp != 0) else None,
            ))

    return steps


def _parse_stage_type_map(xml_data: bytes) -> dict[int, str]:
    """Parse tcprotocol.xml to build stage_index -> stage_type mapping.

    TCStageFlags values in multicomponentdata.xml are 1-based stage indices.
    This maps each stage index to its type (PRE_READ, CYCLING, POST_READ, etc).
    Only CYCLING stages with data collection are relevant for amplification.
    """
    root = parse_xml_bytes(xml_data, _XML_WHAT, MAX_AUX_XML_BYTES)
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
