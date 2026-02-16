# CFX Opus XML Parser — Design Specification

**Created**: 2026-02-16
**Status**: Ready for implementation
**Prerequisite analysis**: `analysis-amplification.md`, `analysis-endpoint-ad.md`, `analysis-cq-summary.md`, `analysis-supplementary.md`

---

## Phase 2: Cross-Reference — XML vs XLSX

### 2.1 Field-by-Field Comparison

| Data Type | XLSX Source | XML Source | Fields Match? | Notes |
|-----------|------------|------------|---------------|-------|
| Allelic Discrimination | ADSheet sheet in .xlsx | ADSheet.xml | **Identical** 6 fields | Well, Sample, Call, Type, RFU1, RFU2 |
| Amplification Curves | FAM/HEX/ROX sheets in .xlsx | 3x Amplification Results XML | **Identical** structure | Cycle × Well matrix, baseline-subtracted RFU |
| End Point | FAM/HEX/ROX sheets in .xlsx | 3x End Point Results XML | **Identical** 10 fields | Well, Fluor, Target, Content, Sample, End_RFU, etc. |
| Cq Values | Cq Results sheet in .xlsx | Cq Results XML | **Identical** 15 fields | 288 rows = 96 wells × 3 dyes |

### 2.2 XML Advantages Over XLSX

| Advantage | Detail |
|-----------|--------|
| **No dependency** | stdlib `xml.etree.ElementTree` vs `openpyxl` (200KB+ dep) |
| **No packaging bugs** | CFX .xlsx files have broken ZIP paths requiring `xlsx_fixer.py`; XML has no such issues |
| **Full float precision** | 15 significant digits vs Excel-rounded values |
| **Simpler parsing** | Flat `<Root><Row>...</Row></Root>`, no sheet/cell navigation |
| **Target/Dye mapping explicit** | End Point XML: FAM=WT, HEX=MT, ROX=REF |
| **NTC identification** | End Point XML `Content` field: "Unkn" vs "NTC" |

### 2.3 XML Disadvantages

| Disadvantage | Detail |
|-------------|--------|
| **Multiple files** | 16+ separate XML files vs single .xlsx with multiple sheets |
| **Upload UX** | User must upload ZIP or multiple files, not a single file |
| **No single-file complete data** | ADSheet alone lacks NTC info; Amplification lacks genotype calls |

### 2.4 New Data Exclusively in XML

There is no data in XML that isn't also available in XLSX exports. Both export the same underlying CFX Maestro analysis results. The XML is simply a more parser-friendly format.

### 2.5 The 23 vs 35 Cycle Question

- **Protocol**: `ASQ-S3v2(35cycles).prcl` = 35 thermal cycles
- **Cq Results**: `Set_Point = 40` (total cycle capacity or analysis setting)
- **Amplification data**: 23 cycles of RFU data exported
- **Cq ceiling**: max Cq = 22.000 (integer, capping artifact)
- **Conclusion**: The CFX Maestro software likely exports only the analysis window (cycles 1-23) in the amplification data, not all 35 thermal cycles. The PCR ran 35 cycles, but data collection or export was limited. This is not a parsing issue — we parse what's in the file.

### 2.6 ROX Normalization Strategy

| Source | ROX Behavior | Normalization Strategy |
|--------|-------------|----------------------|
| Amplification XML | ROX shows growth in some wells (spectral crosstalk) | **Do NOT use for normalization** — data is already baseline-subtracted |
| End Point XML | ROX End_RFU near zero for most wells (77/96) | **Not useful** — baseline subtraction already applied |
| ADSheet XML | No ROX column; RFU1/RFU2 are pre-normalized | **No ROX needed** — Bio-Rad handles internally |
| Amplification XLSX | Same data as Amplification XML | Same conclusion |

**Decision**: When parsing CFX XML, set `has_rox=False` for ADSheet-only parsing, or `has_rox=True` with ROX data stored (but not suitable for division normalization) for amplification data. The frontend already handles both cases.

---

## Phase 3: Parser Design

### 3.1 Upload Strategy — ZIP File

Since XML export produces 16+ files, we accept a **ZIP archive** containing them.

**Approach**: Add `.zip` to `SUPPORTED_EXTENSIONS`. In `detector.py`, when a `.zip` is received:
1. Extract to temp directory
2. Scan for known CFX XML filename patterns
3. Route to the appropriate XML parser based on what's found
4. Clean up temp directory

This preserves the existing single-file upload UX — the user just ZIPs the export folder.

### 3.2 Minimum Viable File Sets

Three parsing tiers, depending on which XML files are present in the ZIP:

| Tier | Files Required | Result | Equivalent XLSX |
|------|---------------|--------|-----------------|
| **Tier 1** (Best) | 3× Amplification Results + ADSheet | Multi-cycle curves + genotype calls | Amplification XLSX |
| **Tier 2** | ADSheet + 1× End Point (any dye) | Single-cycle scatter + NTC info | Allelic Discrimination XLSX |
| **Tier 3** | ADSheet only | Single-cycle scatter, no NTC info | Allelic Discrimination XLSX |

**Priority**: Try Tier 1 first, fall back to Tier 2, then Tier 3.

### 3.3 File Detection Logic

XML files are identified by filename pattern (Bio-Rad uses consistent naming):

```python
# Filename patterns (after the run prefix)
PATTERNS = {
    "amplification_fam": "Quantification Amplification Results_FAM.xml",
    "amplification_hex": "Quantification Amplification Results_HEX.xml",
    "amplification_rox": "Quantification Amplification Results_ROX.xml",
    "adsheet":           "Allelic Discrimination Results_ADSheet.xml",
    "endpoint_fam":      "End Point Results_FAM.xml",
    "endpoint_hex":      "End Point Results_HEX.xml",
    "endpoint_rox":      "End Point Results_ROX.xml",
    "cq_results":        "Quantification Cq Results.xml",
    "run_info":          "Run Information.xml",
}
```

Matching: `filename.endswith(pattern)` for each pattern (prefix varies by run).

Also detect HEX vs VIC: Check the root element of the second amplification file — if it's `<VIC>` instead of `<HEX>`, set `allele2_dye = "VIC"`.

### 3.4 Field Mapping to UnifiedData

#### Tier 1: Amplification + ADSheet

```
UnifiedData:
  instrument     = "CFX Opus"
  allele2_dye    = root tag of 2nd amp file ("HEX" or "VIC")
  wells          = sorted well tags from amplification XML (A1-H12)
  cycles         = sorted Cycle values [1..N]
  data           = list[WellCycleData] from merged FAM/HEX/ROX amp data
  has_rox        = True (ROX amp data present, stored as-is)
  sample_names   = {well: sample} from ADSheet (all "SNP" in sample data)
  protocol_steps = None (not available in XML export)

WellCycleData for each (well, cycle):
  well    = well ID (e.g. "A1")
  cycle   = cycle number
  fam     = FAM amplification RFU at this cycle
  allele2 = HEX amplification RFU at this cycle
  rox     = ROX amplification RFU at this cycle (or None)
```

**Genotype call integration**: ADSheet `Call` values stored via a new optional field or separate endpoint. Currently the frontend derives calls from cluster analysis, so ADSheet calls are bonus metadata.

#### Tier 2: ADSheet + End Point

```
UnifiedData:
  instrument     = "CFX Opus"
  allele2_dye    = "HEX" (from End Point Fluor field, or "VIC" if present)
  wells          = sorted wells from ADSheet
  cycles         = [1]  (endpoint only)
  data           = WellCycleData(cycle=1, fam=RFU1, allele2=RFU2, rox=None)
  has_rox        = False (AD values are pre-normalized)
  sample_names   = {well: sample} from ADSheet
  protocol_steps = None
```

End Point XML is used only for NTC identification (`Content` field) — not for RFU values. The ADSheet RFU1/RFU2 are the correct values for the scatter plot.

#### Tier 3: ADSheet Only

Same as existing `parse_cfx_allelic()` but reading from XML instead of XLSX. Identical output.

### 3.5 Well ID Normalization

CFX XML uses zero-padded well IDs: `A01`, `A02`, ..., `H12`.
Our model uses: `A1`, `A2`, ..., `H12`.

Normalize: strip leading zero from column number.

```python
def normalize_well(well: str) -> str:
    """A01 -> A1, H12 -> H12"""
    row = well[0]
    col = int(well[1:])
    return f"{row}{col}"
```

### 3.6 Implementation Plan

#### New File: `app/parsers/cfx_xml_parser.py`

```python
# Public API
def parse_cfx_xml_zip(zip_path: str) -> UnifiedData:
    """Parse a ZIP file containing CFX Opus XML exports."""

# Internal functions
def _find_xml_files(extract_dir: str) -> dict[str, str]:
    """Scan directory for known CFX XML filename patterns. Returns {type: path}."""

def _parse_amplification_xml(filepath: str) -> tuple[str, list[int], dict[str, list[float]]]:
    """Parse one amplification XML. Returns (dye, cycles, {well: [rfu_per_cycle]})."""

def _parse_adsheet_xml(filepath: str) -> list[dict]:
    """Parse ADSheet. Returns [{well, sample, call, rfu1, rfu2}, ...]."""

def _parse_endpoint_xml(filepath: str) -> dict[str, dict]:
    """Parse End Point XML. Returns {well: {end_rfu, content, target, fluor}}."""

def _parse_run_info_xml(filepath: str) -> dict[str, str]:
    """Parse Run Information. Returns {field: value} dict."""

def _normalize_well(well: str) -> str:
    """A01 -> A1"""
```

#### Modify: `app/parsers/detector.py`

```python
# Add to detect_and_parse():
elif ext == ".zip":
    return _handle_zip(file_path, original_filename)

def _handle_zip(file_path, filename):
    """Handle ZIP files — could be CFX XML export or other."""
    # Extract, scan for CFX XML patterns
    # If found: parse_cfx_xml_zip()
    # If not: raise ValueError("ZIP does not contain recognized CFX XML exports")
```

#### Modify: `app/config.py`

```python
SUPPORTED_EXTENSIONS = {".xls", ".xlsx", ".eds", ".pcrd", ".zip"}
```

### 3.7 Parsing Algorithm — Amplification XML

```python
import xml.etree.ElementTree as ET

def _parse_amplification_xml(filepath: str):
    tree = ET.parse(filepath)
    root = tree.getroot()
    dye = root.tag  # "FAM", "HEX", "VIC", or "ROX"

    wells = []
    cycles = []
    data = {}  # well -> [rfu_per_cycle]

    for i, row in enumerate(root.findall("Row")):
        cycle = int(row.find("Cycle").text)
        cycles.append(cycle)

        if i == 0:
            wells = [child.tag for child in row if child.tag != "Cycle"]
            data = {w: [] for w in wells}

        for well in wells:
            data[well].append(float(row.find(well).text))

    return dye, cycles, data
```

### 3.8 Parsing Algorithm — ADSheet XML

```python
def _parse_adsheet_xml(filepath: str):
    tree = ET.parse(filepath)
    root = tree.getroot()  # <ADSheet>

    results = []
    for row in root.findall("Row"):
        results.append({
            "well": _normalize_well(row.find("Well").text),
            "sample": row.find("Sample").text or "",
            "call": row.find("Call").text or "",
            "type": row.find("Type").text or "",
            "rfu1": float(row.find("RFU1").text),
            "rfu2": float(row.find("RFU2").text),
        })
    return results
```

### 3.9 Parsing Algorithm — End Point XML (for NTC detection)

```python
def _parse_endpoint_xml(filepath: str):
    tree = ET.parse(filepath)
    root = tree.getroot()  # <FAM>, <HEX>, or <ROX>

    wells = {}
    for row in root.findall("Row"):
        well = _normalize_well(row.find("Well").text)
        wells[well] = {
            "fluor": root.tag,
            "target": row.find("Target").text or "",
            "content": row.find("Content").text or "",
            "end_rfu": float(row.find("End_RFU").text),
            "sample_type": row.find("Sample_Type").text or "",
        }
    return wells
```

### 3.10 Merged Assembly (Tier 1)

```python
def _assemble_tier1(amp_fam, amp_hex, amp_rox, adsheet):
    """Assemble UnifiedData from amplification XMLs + ADSheet."""
    dye_fam, cycles, fam_data = amp_fam
    dye_hex, _, hex_data = amp_hex
    _, _, rox_data = amp_rox if amp_rox else (None, None, {})

    wells = sorted(fam_data.keys(), key=_well_sort_key)

    data = []
    for well in wells:
        norm_well = _normalize_well(well)
        for i, cycle in enumerate(cycles):
            data.append(WellCycleData(
                well=norm_well,
                cycle=cycle,
                fam=fam_data[well][i],
                allele2=hex_data.get(well, [0]*len(cycles))[i],
                rox=rox_data.get(well, [None]*len(cycles))[i] if rox_data else None,
            ))

    sample_names = {r["well"]: r["sample"] for r in adsheet}

    return UnifiedData(
        instrument="CFX Opus",
        allele2_dye=dye_hex,  # "HEX" or "VIC"
        wells=[_normalize_well(w) for w in wells],
        cycles=sorted(cycles),
        data=data,
        has_rox=bool(rox_data),
        sample_names=sample_names if any(v != "SNP" for v in sample_names.values()) else None,
    )
```

### 3.11 Error Messages for Rejected XML Files

When non-essential XML files are uploaded individually (not in a ZIP):

| XML File Type | Error Message |
|---------------|---------------|
| Cq Results | "Cq Results XML contains threshold cycle values only. For scatter plot analysis, please export Allelic Discrimination or Amplification Results." |
| Summary | "Quantification Summary is a subset of Cq Results. Please export Allelic Discrimination or Amplification Results." |
| Plate View | "Plate View exports contain display-oriented data. Please export Amplification Results." |
| Melt Curve | "Melt Curve Plate View contains no numerical data." |
| Gene Expression | "Gene Expression analysis is not applicable to SNP discrimination." |
| ANOVA | "ANOVA Results file is empty." |
| Standard Curve | "Standard Curve Results contain no applicable data." |

### 3.12 Testing Plan

1. **Unit tests**: Parse each XML type independently with sample data
2. **Integration test**: ZIP with full 16-file export → verify UnifiedData output
3. **Tier fallback test**: ZIP with only ADSheet → Tier 3 works
4. **Error test**: ZIP with only rejected files → helpful error
5. **Well normalization**: A01→A1, H12→H12
6. **Negative values**: Verify negative RFU values pass through correctly
7. **NaN handling**: Wells with NaN Cq treated correctly
8. **E2E**: Upload ZIP via browser → scatter plot renders

---

## Summary

| Aspect | Decision |
|--------|----------|
| Upload format | ZIP file containing CFX XML exports |
| Extension | `.zip` added to supported list |
| Minimum data | ADSheet.xml alone (Tier 3) |
| Optimal data | 3× Amplification + ADSheet (Tier 1) |
| ROX strategy | Store as-is, `has_rox=True` for Tier 1; not used for normalization |
| Dependencies | None new (stdlib `xml.etree`, `zipfile`) |
| New file | `app/parsers/cfx_xml_parser.py` |
| Modified files | `detector.py`, `config.py` |
| Well format | Normalize A01→A1 |
