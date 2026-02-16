# CFX Opus Supplementary XML Export Analysis

**Date**: 2026-02-16
**Instrument**: CFX Opus 783BR20183
**Software**: CFX Maestro 5.3.022.1030

---

## 1. Quantification Plate View Results (FAM, HEX, ROX)

### Structure

Each file is a single XML document with the root element being the fluorophore name (`<FAM>`, `<HEX>`, `<ROX>`). The content is a flat sequence of `<Row>` elements -- there are **no explicit row labels** (A, B, C...). Columns are encoded as XML tags using the `_x00NN_` escaped Unicode pattern:

| XML Tag | Column Number |
|---------|---------------|
| `_x0031_` | 1 |
| `_x0032_` | 2 |
| ... | ... |
| `_x0039_` | 9 |
| `_x0031_0` | 10 |
| `_x0031_1` | 11 |
| `_x0031_2` | 12 |

### Row Pattern (Repeating Group of 4 Rows per Plate Row)

Each plate row (A through H) is represented by **4 consecutive `<Row>` elements** in a fixed repeating pattern:

| Row within group | Content | Example values |
|-----------------|---------|----------------|
| Row 1 | **Sample Type** | `Unkn`, `NTC` |
| Row 2 | **Biological Set Name** | `SNP` (all wells in this experiment) |
| Row 3 | **Cq value** | `8.62633865354423`, `NaN`, `22` |
| Row 4 | **Quantity** (SQ) | `NaN` (all values, no standard curve) |

Total: 8 plate rows x 4 data rows = **32 `<Row>` elements** per file. This is consistent across all three fluorophore files (FAM: 450 lines, HEX: 450 lines, ROX: 450 lines).

### Data Content Analysis

**FAM file (Quantification Plate View)**:
- Row A (group 1): All `Unkn` sample type, all `SNP` bio set. Cq values range from ~7.2 to ~15.9. All SQ = `NaN`.
- Row E (group 5): Columns 1-11 are `Unkn`, column 12 is `NTC`. Cq values present for all Unkn wells, `NaN` for NTC (E12).
- Row F-H: Same pattern -- column 12 = `NTC` with `NaN` Cq.
- Special Cq values: `22` appears in a few wells (e.g., B3-FAM, G11-FAM). The value `22` is suspiciously round and likely represents wells that never crossed the threshold within the measured cycles, capped at cycle 22.

**HEX file (Quantification Plate View)**:
- Same structural pattern as FAM.
- More `NaN` Cq values than FAM, indicating HEX had less amplification across the plate.
- Value `22` also appears (F2-HEX).
- Wells with detected Cq range roughly from 6.4 to 21.9.

**ROX file (Quantification Plate View)**:
- Same structural pattern.
- **Mostly `NaN` Cq values** -- ROX is the passive reference dye and should not show specific amplification.
- Only scattered wells have Cq values (A1: 8.70, A2: 3.57, A3: 6.85, A4: 22, A12: 8.10, B1: 5.07, B3: 5.23, B12: 6.14, C1: 5.32, C6: 5.36, D11: 6.54, D12: 6.93, F3: 7.11, F12: 16.36, G3: 16.64, G5: 2, H4: 18.07).
- The ROX Cq value of `2` for well G5 is suspiciously low and likely an artifact.

### Unique Data Assessment

The Cq values in these files are the **same Cq values** available in the "Quantification Cq Results" tabular export (one of the main exports). The plate view format merely arranges them in a grid layout.

**Additional data provided that IS unique to this format:**
- Sample type per well per fluorophore (`Unkn` / `NTC`)
- Biological Set Name per well per fluorophore (`SNP`)
- SQ (Starting Quantity) values -- though all `NaN` here

**Verdict**: The Cq values are **redundant** with the Cq Results export. The sample type and bio set name data is also available in the Cq Results table. **No unique data worth parsing.**

---

## 2. Melt Curve Plate View Results (FAM, HEX, ROX)

### Structure

Identical grid structure to Quantification Plate View: root element is the fluorophore name, flat `<Row>` elements with encoded column tags.

### Critical Difference: Only 2 Rows per Plate Row

Each plate row is represented by just **2 `<Row>` elements**:

| Row within group | Content | Example values |
|-----------------|---------|----------------|
| Row 1 | **Sample Type** | `Unkn`, `NTC` |
| Row 2 | **Biological Set Name** | `SNP` (all wells) |

Total: 8 plate rows x 2 data rows = **16 `<Row>` elements** per file (confirmed: 226 lines each).

### Data Content Analysis

**There are NO melt temperature values, NO peak data, NO melt curve data of any kind.**

All three files (FAM, HEX, ROX) contain exclusively:
- Sample type labels: `Unkn` or `NTC`
- Biological set names: `SNP`

This is purely a plate layout display file. The melt curve plate view in CFX Maestro software would display these labels overlaid on the plate grid, with melt data shown separately.

### Usefulness for SNP Discrimination

Even if this file contained melt curve data, melt curve analysis is a separate technique from allelic discrimination (end-point analysis). For SNP genotyping via allele-specific PCR, the relevant data is the end-point RFU values or Cq values, not melt temperatures.

**Verdict**: **Completely useless for parsing. Contains zero data values -- only layout labels.**

---

## 3. Gene Expression Results - Bar Chart

### Structure

Root element: `<_x0030_>` (encoded "0" -- likely represents the chart/group index).
Contains 3 `<Row>` elements, one per fluorophore data set.

### Schema (All Fields)

Each `<Row>` contains these fields:

| Field | Description | FAM value | HEX value | ROX value |
|-------|-------------|-----------|-----------|-----------|
| `Data_Set` | Channel ID | `1-FAM` | `1-HEX` | `1-ROX` |
| `Target` | Target name | `WT` | `MT` | `REF` |
| `Sample` | Sample group | `SNP` | `SNP` | `SNP` |
| `Control` | Reference sample | (empty) | (empty) | (empty) |
| `Relative_Quantity` | ddCq result | `0` | `0` | `0` |
| `Relative_Quantity(lg)` | Log relative quantity | `0` | `0` | `0` |
| `Relative_Quantity_SD` | RQ standard deviation | `0` | `0` | `0` |
| `Corrected_Relative_Quantity_SD` | Corrected RQ SD | `0` | `0` | `0` |
| `SD_RQ(lg)` | Log RQ SD | `NaN` | `NaN` | `NaN` |
| `Relative_Quantity_SEM` | RQ standard error | `NaN` | `NaN` | `NaN` |
| `Corrected_Relative_Quantity_SEM` | Corrected RQ SEM | `NaN` | `NaN` | `NaN` |
| `SEM_RQ(lg)` | Log RQ SEM | `NaN` | `NaN` | `NaN` |
| `Relative_Quantity_95%_CI_Low` | RQ 95% CI low | `NaN` | `NaN` | `NaN` |
| `Relative_Quantity_95%_CI_High` | RQ 95% CI high | `NaN` | `NaN` | `NaN` |
| `Unscaled_Expression` | Raw expression | `NaN` | `NaN` | `NaN` |
| `Unscaled_Expression(lg)` | Log unscaled expr | `NaN` | `NaN` | `NaN` |
| `Unscaled_Expression_SD` | Unscaled expr SD | `NaN` | `NaN` | `NaN` |
| `Corrected_Unscaled_Expression_SD` | Corrected unscaled SD | `NaN` | `NaN` | `NaN` |
| `SD_Unscaled_Expression(lg)` | Log unscaled SD | `NaN` | `NaN` | `NaN` |
| `Unscaled_Expression_SEM` | Unscaled expr SEM | `NaN` | `NaN` | `NaN` |
| `Corrected_Unscaled_Expression_SEM` | Corrected unscaled SEM | `NaN` | `NaN` | `NaN` |
| `SEM_Unscaled_Expression(lg)` | Log unscaled SEM | `NaN` | `NaN` | `NaN` |
| `Expression` | Normalized expression | `NaN` | `NaN` | `NaN` |
| `Expression(lg)` | Log expression | `NaN` | `NaN` | `NaN` |
| `Expression_SD` | Expression SD | `NaN` | `NaN` | `NaN` |
| `Corrected_Expression_SD` | Corrected expression SD | `NaN` | `NaN` | `NaN` |
| `SD_Expression(lg)` | Log expression SD | `NaN` | `NaN` | `NaN` |
| `Expression_SEM` | Expression SEM | `NaN` | `NaN` | `NaN` |
| `Corrected_Expression_SEM` | Corrected expression SEM | `NaN` | `NaN` | `NaN` |
| `SEM_Expression(lg)` | Log expression SEM | `NaN` | `NaN` | `NaN` |
| `Expression_95%_CI_Low` | Expression 95% CI low | `NaN` | `NaN` | `NaN` |
| `Expression_95%_CI_High` | Expression 95% CI high | `NaN` | `NaN` | `NaN` |
| `Wells` | Number of wells | `91` | `72` | `16` |
| **`Mean_Cq`** | **Mean Cq across wells** | **`9.4719`** | **`13.1214`** | **`8.3521`** |
| **`Cq_SD`** | **Cq standard deviation** | **`3.9255`** | **`4.5177`** | **`5.5700`** |
| **`Cq_SEM`** | **Cq standard error of mean** | **`0.4115`** | **`0.5324`** | **`1.3925`** |
| `P-Value` | Statistical p-value | `NaN` | `NaN` | `NaN` |

### Interesting Observations

1. **Target names confirmed**: FAM = `WT` (wild-type), HEX = `MT` (mutant), ROX = `REF` (reference). This confirms the allelic discrimination setup.
2. **Well counts**: FAM detected in 91 wells, HEX in 72 wells, ROX in only 16 wells. ROX is passive reference -- most wells show no Cq for it.
3. **All expression values are NaN**: Gene expression analysis requires a control sample and reference gene to be properly configured. This experiment is not a gene expression experiment.
4. **Mean Cq values are available** but only as aggregate statistics across all wells -- not per-well data.

**Verdict**: **Not useful for SNP discrimination parsing.** The target names (WT/MT/REF) are mildly interesting for confirming channel assignments, but this is already available in the Cq Results export. All expression calculations are NaN. The schema is documented above for future reference in case a gene expression experiment is encountered.

---

## 4. Run Information

### Complete Field List

| Field | Value | Notes |
|-------|-------|-------|
| File Name | `admin_2026-02-16 11-12-20_783BR20183.pcrd` | Original .pcrd file name |
| Created By User | `admin` | Operator who created the run |
| Notes | (empty) | User notes field, blank |
| ID | (empty) | Run ID field, blank |
| Run Started | `02/16/2026 02:13:01 UTC` | Run start timestamp |
| Run Ended | `02/16/2026 03:52:26 UTC` | Run end timestamp |
| Sample Vol | `10` | Reaction volume in uL |
| Lid Temp | `105` | Heated lid temperature in Celsius |
| **Protocol File Name** | **`ASQ-S3v2(35cycles).prcl`** | **Protocol name -- indicates 35 cycles** |
| Plate Setup File Name | `FAMHEX-ASGPCR.pltd` | Plate setup template file |
| Base Serial Number | `783BR20183` | Instrument base serial |
| Optical Head Serial Number | `783BR20183` | Optical head serial (same as base) |
| CFX Maestro Version | `5.3.022.1030. ` | Software version (note trailing space+period) |

### Run Duration Analysis

- Start: 02:13:01 UTC
- End: 03:52:26 UTC
- **Duration: ~1 hour 39 minutes 25 seconds**

This is consistent with a 35-cycle PCR run including hot start, cycling, and a melt curve step.

### Protocol Name and the Cycle Count Question

The protocol name `ASQ-S3v2(35cycles).prcl` explicitly states **35 cycles**. This is important context for the previously observed "23 cycles in amplification data" discrepancy:

- The amplification curve data files show data for only a subset of cycles
- The protocol was configured for 35 cycles total
- The Cq values reaching up to 22 (but never exceeding ~22) suggest the **data collection window** or **analysis window** may have been limited, OR the export only includes cycles up to the last detected threshold crossing plus some buffer
- Another possibility: the `22` values that appear in some wells represent a Cq cap, not actual cycle 22 data

**This file does NOT resolve the 23-vs-35 cycle question directly**, but it confirms the protocol intent was 35 cycles. The resolution likely lies in the amplification curve data file structure or the analysis settings.

### Useful Fields for UnifiedData Model

Fields that could populate our parser's UnifiedData model:

| Run Info Field | UnifiedData mapping | Priority |
|---------------|---------------------|----------|
| Protocol File Name | `protocol_name` or metadata | Medium -- useful for display |
| Plate Setup File Name | metadata | Low |
| Run Started / Ended | `run_date`, `run_duration` | Medium |
| Sample Vol | metadata | Low |
| Created By User | metadata | Low |
| Base Serial Number | `instrument_serial` | Medium |
| CFX Maestro Version | `software_version` | Low |

Most of this metadata is "nice to have" but not critical for SNP discrimination analysis. The essential data (well positions, Cq values, RFU values, sample names) comes from the main Cq Results and End Point Results exports.

---

## 5. Overall Assessment

### Files Worth Parsing

| File | Unique Data? | Worth Parsing? | Reason |
|------|-------------|----------------|--------|
| Quantification Plate View (FAM/HEX/ROX) | No | **Skip** | Cq values are redundant with Cq Results export. Grid layout is harder to parse than tabular format. |
| Melt Curve Plate View (FAM/HEX/ROX) | No | **Skip** | Contains ZERO data values -- only sample type and bio set labels. |
| Gene Expression Bar Chart | No | **Skip** | All expression values are NaN. Not applicable to SNP experiments. |
| Run Information | Partially | **Optional** | Contains protocol name, timestamps, instrument info. Nice metadata but not essential. |

### Recommended Action

1. **Reject** Quantification Plate View XML files in the file detector with a message like: "Plate View exports contain display-only data. Please export Cq Results or End Point Results instead."

2. **Reject** Melt Curve Plate View XML files with: "Melt Curve Plate View exports contain no numerical data. Please export Quantification Cq Results for SNP analysis."

3. **Reject** Gene Expression XML files with: "Gene Expression analysis is not applicable to SNP discrimination experiments."

4. **Optionally accept** Run Information XML as supplementary metadata. If the main data file (Cq Results or End Point Results) is already uploaded, this could enrich the display with protocol name and run timestamps. However, this is low priority.

### The 23-vs-35 Cycle Question

None of these supplementary files resolve this question. The Run Information confirms the protocol was set for 35 cycles. The Plate View Cq values include values up to `22` (appearing as an integer, not a decimal), which may represent the maximum reportable cycle in the software's analysis window. The resolution of this question will require examining:

1. The amplification curve data file (which cycle numbers are explicitly present in the raw RFU-per-cycle data)
2. The CFX Maestro analysis settings (baseline cycles, threshold, Cq determination mode)
3. Whether the "22" Cq values represent true cycle-22 threshold crossings or an artifact of analysis window limits

### Column Encoding Reference (for future use)

The `_x00NN_` pattern is standard XML name escaping for characters that are invalid as XML element names (digits cannot start an element name). Decoding:

```
_x0031_   -> "1"    (Unicode 0x0031 = '1')
_x0032_   -> "2"    (Unicode 0x0032 = '2')
...
_x0039_   -> "9"    (Unicode 0x0039 = '9')
_x0031_0  -> "10"   (Unicode 0x0031 = '1', then literal '0')
_x0031_1  -> "11"
_x0031_2  -> "12"
_x0030_   -> "0"    (used as root element in Gene Expression)
```

Python parsing helper:
```python
import re

def decode_xml_tag(tag: str) -> str:
    """Decode _xNNNN_ escaped XML element names."""
    return re.sub(r'_x([0-9A-Fa-f]{4})_', lambda m: chr(int(m.group(1), 16)), tag)

# decode_xml_tag("_x0031_2") -> "12"
# decode_xml_tag("_x0030_") -> "0"
```

### File Detection Signatures

For the smart file detector (15 export type detection), these files can be identified by:

| File Type | Root Element | Distinguishing Feature |
|-----------|-------------|----------------------|
| Quant Plate View | `<FAM>`, `<HEX>`, `<ROX>`, etc. | Contains 4-row groups with Cq values |
| Melt Curve Plate View | `<FAM>`, `<HEX>`, `<ROX>`, etc. | Contains only 2-row groups (no data values) |
| Gene Expression | `<_x0030_>` | Contains `<Data_Set>`, `<Expression>`, `<Relative_Quantity>` fields |
| Run Information | `<Run_x0020_Information>` | Contains `<Column1>`/`<Column2>` key-value pairs |

Note: Quant Plate View and Melt Curve Plate View share the same root element pattern (fluorophore name). They must be differentiated by:
- **Filename**: "Quantification Plate View" vs "Melt Curve Plate View"
- **Content**: Quant has 4 rows per plate row (includes numeric Cq + SQ), Melt has 2 rows per plate row (labels only)
- **Row count**: Quant = 32 rows, Melt = 16 rows
