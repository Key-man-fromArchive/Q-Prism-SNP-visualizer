"""Parser for Bio-Rad CFX Opus XML export files (ZIP archive).

Accepts a ZIP containing CFX Maestro XML exports. Implements 3-tier parsing:
  Tier 1: 3x Amplification Results + ADSheet → multi-cycle curves + genotype calls
  Tier 2: ADSheet + EndPoint → single-cycle scatter + NTC info
  Tier 3: ADSheet only → single-cycle scatter

XML structure:
  - Root tag = dye name (FAM/HEX/VIC/ROX) or data type (ADSheet)
  - Children: <Row> elements with flat fields
  - Amplification: <Cycle> + well tags (A1..H12) per Row
  - ADSheet: <Well>, <Sample>, <Call>, <Type>, <RFU1>, <RFU2>
  - EndPoint: <Well>, <Fluor>, <Target>, <Content>, <End_RFU>, ...

No external dependencies — uses stdlib xml.etree.ElementTree and zipfile.
"""

import os
import tempfile
import zipfile
import xml.etree.ElementTree as ET

from app.models import UnifiedData, WellCycleData, DataWindow


# --- Filename patterns (Bio-Rad consistent suffixes) ---

_PATTERNS = {
    "amplification_fam": "Quantification Amplification Results_FAM.xml",
    "amplification_hex": "Quantification Amplification Results_HEX.xml",
    "amplification_vic": "Quantification Amplification Results_VIC.xml",
    "amplification_rox": "Quantification Amplification Results_ROX.xml",
    "adsheet": "Allelic Discrimination Results_ADSheet.xml",
    "endpoint_fam": "End Point Results_FAM.xml",
    "endpoint_hex": "End Point Results_HEX.xml",
    "endpoint_vic": "End Point Results_VIC.xml",
    "endpoint_rox": "End Point Results_ROX.xml",
}


# --- Public API ---

def parse_cfx_xml_zip(zip_path: str) -> UnifiedData:
    """Parse a ZIP file containing CFX Opus XML exports."""
    extract_dir = tempfile.mkdtemp(prefix="cfx_xml_")
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(extract_dir)

        xml_files = _find_xml_files(extract_dir)

        if not xml_files.get("adsheet"):
            raise ValueError(
                "ZIP does not contain 'Allelic Discrimination Results_ADSheet.xml'.\n\n"
                "Please export from CFX Maestro:\n"
                "  File > Export > select all data types, then ZIP the exported folder."
            )

        # Try Tier 1: Amplification + ADSheet
        has_amp_fam = "amplification_fam" in xml_files
        has_amp_allele2 = "amplification_hex" in xml_files or "amplification_vic" in xml_files

        if has_amp_fam and has_amp_allele2:
            return _assemble_tier1(xml_files)

        # Try Tier 2: ADSheet + EndPoint
        has_ep = any(k.startswith("endpoint_") for k in xml_files)
        if has_ep:
            return _assemble_tier2(xml_files)

        # Tier 3: ADSheet only
        return _assemble_tier3(xml_files)

    finally:
        # Clean up extracted files
        import shutil
        shutil.rmtree(extract_dir, ignore_errors=True)


# --- File discovery ---

def _find_xml_files(extract_dir: str) -> dict[str, str]:
    """Scan extracted directory for known CFX XML filename patterns."""
    found = {}
    for dirpath, _dirs, filenames in os.walk(extract_dir):
        for fname in filenames:
            if not fname.lower().endswith(".xml"):
                continue
            full_path = os.path.join(dirpath, fname)
            for key, suffix in _PATTERNS.items():
                if fname.endswith(suffix):
                    found[key] = full_path
                    break
    return found


# --- Individual XML parsers ---

def _parse_amplification_xml(filepath: str) -> tuple[str, list[int], dict[str, list[float]]]:
    """Parse one amplification XML.

    Returns (dye_name, sorted_cycles, {well: [rfu_per_cycle]}).
    Wells in amp XML use A1 format (no zero-padding).
    """
    tree = ET.parse(filepath)
    root = tree.getroot()
    dye = root.tag  # "FAM", "HEX", "VIC", or "ROX"

    wells: list[str] = []
    cycles: list[int] = []
    data: dict[str, list[float]] = {}

    for i, row in enumerate(root.findall("Row")):
        cycle = int(row.find("Cycle").text)
        cycles.append(cycle)

        if i == 0:
            # First row: discover well tags (everything except Cycle)
            wells = [child.tag for child in row if child.tag != "Cycle"]
            data = {w: [] for w in wells}

        for well in wells:
            elem = row.find(well)
            data[well].append(float(elem.text))

    return dye, sorted(cycles), data


def _parse_adsheet_xml(filepath: str) -> list[dict]:
    """Parse ADSheet XML.

    Returns list of {well, sample, call, type, rfu1, rfu2}.
    Well IDs are zero-padded (A01) — normalized here.
    """
    tree = ET.parse(filepath)
    root = tree.getroot()

    results = []
    for row in root.findall("Row"):
        well = _normalize_well(row.find("Well").text)
        sample_elem = row.find("Sample")
        call_elem = row.find("Call")
        type_elem = row.find("Type")

        results.append({
            "well": well,
            "sample": sample_elem.text if sample_elem is not None and sample_elem.text else "",
            "call": call_elem.text if call_elem is not None and call_elem.text else "",
            "type": type_elem.text if type_elem is not None and type_elem.text else "",
            "rfu1": float(row.find("RFU1").text),
            "rfu2": float(row.find("RFU2").text),
        })
    return results


def _parse_endpoint_xml(filepath: str) -> dict[str, dict]:
    """Parse End Point XML for NTC identification.

    Returns {well: {fluor, target, content, end_rfu, sample_type}}.
    """
    tree = ET.parse(filepath)
    root = tree.getroot()

    wells = {}
    for row in root.findall("Row"):
        well = _normalize_well(row.find("Well").text)
        content_elem = row.find("Content")
        target_elem = row.find("Target")
        sample_type_elem = row.find("Sample_Type")
        end_rfu_elem = row.find("End_RFU")

        wells[well] = {
            "fluor": root.tag,
            "target": target_elem.text if target_elem is not None and target_elem.text else "",
            "content": content_elem.text if content_elem is not None and content_elem.text else "",
            "end_rfu": float(end_rfu_elem.text) if end_rfu_elem is not None and end_rfu_elem.text else 0.0,
            "sample_type": sample_type_elem.text if sample_type_elem is not None and sample_type_elem.text else "",
        }
    return wells


# --- Tier assembly ---

def _assemble_tier1(xml_files: dict[str, str]) -> UnifiedData:
    """Tier 1: Amplification + ADSheet → multi-cycle data."""
    amp_fam = _parse_amplification_xml(xml_files["amplification_fam"])

    # Detect allele2 dye (HEX or VIC)
    allele2_key = "amplification_hex" if "amplification_hex" in xml_files else "amplification_vic"
    amp_allele2 = _parse_amplification_xml(xml_files[allele2_key])

    amp_rox = None
    if "amplification_rox" in xml_files:
        amp_rox = _parse_amplification_xml(xml_files["amplification_rox"])

    adsheet = _parse_adsheet_xml(xml_files["adsheet"])

    dye_fam, cycles, fam_data = amp_fam
    dye_allele2, _, allele2_data = amp_allele2
    rox_data = amp_rox[2] if amp_rox else {}

    # Amplification XML wells are already A1 format
    wells = sorted(fam_data.keys(), key=_well_sort_key)

    data: list[WellCycleData] = []
    for well in wells:
        for i, cycle in enumerate(cycles):
            rox_val = rox_data[well][i] if well in rox_data else None
            data.append(WellCycleData(
                well=well,
                cycle=cycle,
                fam=fam_data[well][i],
                allele2=allele2_data.get(well, [0.0] * len(cycles))[i],
                rox=rox_val,
            ))

    sample_names = {r["well"]: r["sample"] for r in adsheet}
    # Only include sample_names if they have meaningful values (not all "SNP")
    has_meaningful_names = any(v and v != "SNP" for v in sample_names.values())

    return UnifiedData(
        instrument="CFX Opus",
        allele2_dye=dye_allele2,
        wells=wells,
        cycles=cycles,
        data=data,
        has_rox=bool(rox_data),
        sample_names=sample_names if has_meaningful_names else None,
        data_windows=[DataWindow(name="Amplification", start_cycle=cycles[0], end_cycle=cycles[-1])] if cycles else None,
    )


def _assemble_tier2(xml_files: dict[str, str]) -> UnifiedData:
    """Tier 2: ADSheet + EndPoint → single-cycle scatter with NTC info."""
    adsheet = _parse_adsheet_xml(xml_files["adsheet"])

    # Detect allele2 dye from endpoint files
    allele2_dye = "HEX"
    if "endpoint_vic" in xml_files:
        allele2_dye = "VIC"
    elif "endpoint_hex" in xml_files:
        allele2_dye = "HEX"

    # Parse endpoint for NTC identification
    ntc_wells: set[str] = set()
    for key in ("endpoint_fam", "endpoint_hex", "endpoint_vic", "endpoint_rox"):
        if key in xml_files:
            ep_data = _parse_endpoint_xml(xml_files[key])
            for well, info in ep_data.items():
                if info["content"] == "NTC" or info["sample_type"] == "NTC":
                    ntc_wells.add(well)

    # Build data from ADSheet RFU values (pre-normalized by Bio-Rad)
    wells_set: set[str] = set()
    data: list[WellCycleData] = []
    sample_names: dict[str, str] = {}

    for r in adsheet:
        well = r["well"]
        data.append(WellCycleData(
            well=well, cycle=1,
            fam=r["rfu1"], allele2=r["rfu2"], rox=None,
        ))
        wells_set.add(well)
        if r["sample"]:
            # Mark NTC wells in sample name
            if well in ntc_wells:
                sample_names[well] = "NTC"
            else:
                sample_names[well] = r["sample"]

    wells = sorted(wells_set, key=_well_sort_key)
    has_meaningful_names = any(v and v != "SNP" for v in sample_names.values())

    return UnifiedData(
        instrument="CFX Opus",
        allele2_dye=allele2_dye,
        wells=wells,
        cycles=[1],
        data=data,
        has_rox=False,
        sample_names=sample_names if has_meaningful_names else None,
        data_windows=[DataWindow(name="End Point", start_cycle=1, end_cycle=1)],
    )


def _assemble_tier3(xml_files: dict[str, str]) -> UnifiedData:
    """Tier 3: ADSheet only → single-cycle scatter, no NTC info."""
    adsheet = _parse_adsheet_xml(xml_files["adsheet"])

    wells_set: set[str] = set()
    data: list[WellCycleData] = []
    sample_names: dict[str, str] = {}

    for r in adsheet:
        well = r["well"]
        data.append(WellCycleData(
            well=well, cycle=1,
            fam=r["rfu1"], allele2=r["rfu2"], rox=None,
        ))
        wells_set.add(well)
        if r["sample"]:
            sample_names[well] = r["sample"]

    wells = sorted(wells_set, key=_well_sort_key)
    has_meaningful_names = any(v and v != "SNP" for v in sample_names.values())

    return UnifiedData(
        instrument="CFX Opus",
        allele2_dye="HEX",
        wells=wells,
        cycles=[1],
        data=data,
        has_rox=False,
        sample_names=sample_names if has_meaningful_names else None,
        data_windows=[DataWindow(name="End Point", start_cycle=1, end_cycle=1)],
    )


# --- Utilities ---

def _normalize_well(well: str) -> str:
    """A01 -> A1, H12 -> H12."""
    row = well[0]
    col = int(well[1:])
    return f"{row}{col}"


def _well_sort_key(well: str) -> tuple[int, int]:
    """Sort wells A1..H12 in row-major order."""
    row = ord(well[0]) - ord("A")
    col = int(well[1:])
    return (row, col)
