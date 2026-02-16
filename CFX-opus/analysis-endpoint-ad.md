# CFX Opus XML Export Analysis: ADSheet + End Point Results

**Date**: 2026-02-16
**Instrument**: CFX Opus (serial 783BR20183)
**Operator**: admin
**Files analyzed**:
1. `admin_2026-02-16 11-12-20_783BR20183 -  Allelic Discrimination Results_ADSheet.xml` (18 KB)
2. `admin_2026-02-16 11-12-20_783BR20183 -  End Point Results_FAM.xml` (30 KB)
3. `admin_2026-02-16 11-12-20_783BR20183 -  End Point Results_HEX.xml` (30 KB)
4. `admin_2026-02-16 11-12-20_783BR20183 -  End Point Results_ROX.xml` (30 KB)

---

## 1. ADSheet.xml -- Full Analysis

### 1.1 XML Schema

Root element: `<ADSheet>`. Contains 96 `<Row>` children. Each Row has exactly 5 fields:

```xml
<Row>
  <Well>A01</Well>
  <Sample>SNP</Sample>
  <Call>Heterozygote</Call>
  <Type>Auto</Type>
  <RFU1>2608.8444141484</RFU1>
  <RFU2>2108.4052494247</RFU2>
</Row>
```

| Tag | Description | Values in this file |
|-----|-------------|-------------------|
| `Well` | Well position (A01-H12) | All 96 wells of a 96-well plate |
| `Sample` | Sample name | All "SNP" |
| `Call` | Genotype call result | "Allele 1", "Allele 2", "Heterozygote", "No Call" |
| `Type` | Call method | All "Auto" (software auto-called) |
| `RFU1` | Allele 1 fluorescence (baseline-subtracted, normalized) | Float, can be negative |
| `RFU2` | Allele 2 fluorescence (baseline-subtracted, normalized) | Float, can be negative |

**Notable**: The ADSheet has NO `Content`, `Target`, `Fluor`, `Sample_Type`, `Is_Control`, or `CallType` fields. It is purely the allelic discrimination summary.

### 1.2 Row Count

**96 rows** -- one per well in a 96-well plate. All wells present (A01 through H12).

### 1.3 Genotype Call Distribution

| Call | Count | Percentage |
|------|-------|------------|
| Allele 1 | 63 | 65.6% |
| Allele 2 | 12 | 12.5% |
| Heterozygote | 9 | 9.4% |
| No Call | 12 | 12.5% |

**No "Undetermined" or "NTC" calls exist in ADSheet** -- the ADSheet only uses the 4 call types above. NTC wells receive "No Call" in the ADSheet, even though they are flagged as NTC in the End Point files.

### 1.4 RFU1 and RFU2 Identity

**RFU1 = Allele 1 axis = FAM (WT / Wild Type)**
**RFU2 = Allele 2 axis = HEX (MT / Mutant)**

Evidence:
- All "Allele 1" calls have high RFU1 (~2000-9700) and low RFU2 (~-7 to ~330)
- All "Allele 2" calls have low RFU1 (~134-516) and high RFU2 (~2857-6439)
- Heterozygotes have both RFU1 and RFU2 in moderate-to-high range
- In End Point files: FAM Target = "WT", HEX Target = "MT"

Cross-reference with End Point files confirms the mapping, though the **values are NOT identical** (see Section 4 for details).

### 1.5 Data Ranges

| Metric | RFU1 (Allele 1 / FAM) | RFU2 (Allele 2 / HEX) |
|--------|----------------------|----------------------|
| Min | -11.02 | -17.10 |
| Max | 9674.63 | 6438.58 |
| Mean | 4874.73 | 878.42 |

The mean being much higher for RFU1 than RFU2 reflects the population: 63 Allele 1 calls dominate.

Negative values exist for both axes, indicating baseline-subtracted values where the signal can dip below the computed baseline.

### 1.6 NTC Wells

The ADSheet does NOT contain a Content/NTC field. However, cross-referencing with End Point files reveals 4 NTC wells. Their AD values:

| Well | AD Call | RFU1 | RFU2 | FAM End_RFU | HEX End_RFU | ROX End_RFU |
|------|---------|------|------|------------|------------|------------|
| E12 | No Call | -2.75 | -6.82 | 1.26 | 2.90 | 2.73 |
| F12 | No Call | 1222.00 | 71.80 | 3183.58 | 487.49 | 134.99 |
| G12 | No Call | 660.29 | 384.93 | 2565.40 | 2443.71 | 24.50 |
| H12 | No Call | -2.08 | -0.13 | -0.69 | 0.46 | -0.33 |

**Important observation**: All 4 NTC wells are called "No Call" in the ADSheet. However, F12 and G12 have surprisingly high RFU values, suggesting possible contamination in those NTC wells. E12 and H12 have near-zero values as expected for true NTC.

### 1.7 No Call Wells (all 12)

| Well | RFU1 | RFU2 | Likely reason |
|------|------|------|--------------|
| C01 | 1434.07 | 320.85 | Ambiguous signal |
| D06 | 291.21 | 174.06 | Low signal, ambiguous |
| D07 | 156.17 | 2.61 | Low FAM, near-zero HEX |
| E08 | 72.63 | 446.02 | Low FAM, moderate HEX |
| **E12** | -2.75 | -6.82 | **NTC well** |
| F09 | 33.14 | -1.41 | Very low signal |
| **F12** | 1222.00 | 71.80 | **NTC well** (contaminated?) |
| **G06** | -11.02 | -17.10 | Lowest values, likely empty/failed |
| G09 | 162.09 | -0.06 | Low signal |
| **G12** | 660.29 | 384.93 | **NTC well** (contaminated?) |
| H04 | 248.72 | 241.66 | Ambiguous (similar RFU1/RFU2) |
| **H12** | -2.08 | -0.13 | **NTC well** |

Of the 12 "No Call" wells, 4 are NTC (column 12) and 8 are sample wells with low/ambiguous signals.

---

## 2. End Point Results (FAM / HEX / ROX) -- Full Analysis

### 2.1 XML Schema (identical across all 3 files)

Root element: `<FAM>`, `<HEX>`, or `<ROX>`. Each contains 96 `<Row>` children:

```xml
<Row>
  <Well>H12</Well>
  <Fluor>FAM</Fluor>
  <Target>WT</Target>
  <Content>NTC</Content>
  <Sample>SNP</Sample>
  <End_RFU>-0.688107952306837</End_RFU>
  <Call />
  <Sample_Type>NTC</Sample_Type>
  <CallType>Unassigned</CallType>
  <Is_Control>False</Is_Control>
</Row>
```

| Tag | Description | Values |
|-----|-------------|--------|
| `Well` | Well position | A01-H12 (96 wells) |
| `Fluor` | Fluorophore name | "FAM", "HEX", or "ROX" per file |
| `Target` | Target name assigned in plate setup | See table below |
| `Content` | Sample content type | "Unkn" or "NTC" |
| `Sample` | Sample name | All "SNP" |
| `End_RFU` | End-point relative fluorescence units | Float, can be negative |
| `Call` | Individual dye call | **Always empty** (self-closing `<Call />`) |
| `Sample_Type` | Expanded content type | "Unknown" or "NTC" |
| `CallType` | Call classification | **Always "Unassigned"** |
| `Is_Control` | Control well flag | **Always "False"** |

### 2.2 Target Mapping

| Dye | Target | Meaning |
|-----|--------|---------|
| FAM | WT | Wild Type (Allele 1) |
| HEX | MT | Mutant (Allele 2) |
| ROX | REF | Reference / Passive reference dye |

### 2.3 Row Counts

All three files have **96 rows** each. Same well set as ADSheet.

### 2.4 Well Ordering

**End Point files are ordered REVERSE** compared to ADSheet:
- ADSheet: A01, A02, A03 ... H10, H11, H12 (row-major ascending)
- End Point: H12, H11, H10 ... A03, A02, A01 (row-major descending)

This difference is cosmetic only -- all 96 wells are present in both and can be joined by well ID.

### 2.5 Content Distribution

| Content | Sample_Type | Count |
|---------|------------|-------|
| Unkn | Unknown | 92 |
| NTC | NTC | 4 |

NTC wells: **E12, F12, G12, H12** (entire column 12 rows E-H)

### 2.6 End_RFU Ranges

| Dye | Min | Max | Mean |
|-----|-----|-----|------|
| FAM | -0.69 | 11,233.38 | 5,974.64 |
| HEX | 0.46 | 7,710.68 | 1,311.81 |
| ROX | -2.05 | 585.93 | 46.88 |

### 2.7 Call and CallType Fields

- **Call**: Always **empty** (`<Call />`). Individual dye endpoint results do not carry genotype calls.
- **CallType**: Always **"Unassigned"**. No per-dye call logic applied.
- **Is_Control**: Always **"False"**. No wells flagged as controls.

Genotype calls exist ONLY in the ADSheet, which combines both dyes for allelic discrimination.

### 2.8 NTC Values Per Dye

| NTC Well | FAM End_RFU | HEX End_RFU | ROX End_RFU |
|----------|------------|------------|------------|
| E12 | 1.26 | 2.90 | 2.73 |
| F12 | 3183.58 | 487.49 | 134.99 |
| G12 | 2565.40 | 2443.71 | 24.50 |
| H12 | -0.69 | 0.46 | -0.33 |

F12 and G12 show elevated signal across all dyes, suggesting contamination or mis-setup. E12 and H12 are clean NTCs.

---

## 3. ROX End Point Analysis

### 3.1 ROX as Passive Reference

ROX (Target="REF") is a passive reference dye used for well-to-well normalization. Its End_RFU range:

| Metric | Value |
|--------|-------|
| Min | -2.05 (H01) |
| Max | 585.93 (B03) |
| Mean | 46.88 |
| Median | ~1.5 |

### 3.2 ROX Distribution Pattern

The vast majority of wells have ROX End_RFU values near zero (-2 to +10), but a handful of wells show outlier values:

| Well | ROX End_RFU | Notes |
|------|------------|-------|
| B03 | 585.93 | Highest |
| A03 | 500.88 | |
| A02 | 405.09 | |
| C01 | 305.32 | |
| A04 | 232.71 | |
| B12 | 231.81 | |
| B01 | 230.73 | |
| A12 | 221.81 | |
| F03 | 209.79 | |
| C06 | 208.31 | |
| D12 | 206.50 | |

These outlier ROX values cluster in the left side of the plate (columns 1-3) and in some column-12 wells, possibly indicating plate effects or seal issues.

### 3.3 ROX Usefulness for Normalization

**In the CFX Opus XML endpoint context, ROX End_RFU values are NOT useful for normalization.** The values are already baseline-subtracted endpoint values, and for most wells they are near zero. The passive reference normalization has already been applied internally by the CFX Maestro software before computing the AD RFU1/RFU2 values in the ADSheet.

The End Point Results appear to already be **post-normalization** values (delta-Rn style), not raw fluorescence readings. The ROX "change from baseline" is approximately zero for most wells (as expected for a passive reference that stays constant through the run).

---

## 4. Cross-File Analysis

### 4.1 AD RFU1 vs FAM End_RFU -- NOT Identical

**Critical finding: ADSheet RFU1 values are NOT the same as FAM End_RFU values.**

| Well | AD RFU1 | FAM End_RFU | Difference | Call |
|------|---------|------------|------------|------|
| A01 | 2608.84 | 3497.30 | +888.46 | Heterozygote |
| A05 | 5965.85 | 7547.76 | +1581.90 | Allele 1 |
| A06 | 9361.52 | 10369.98 | +1008.45 | Allele 1 |
| A12 | 515.96 | 1146.87 | +630.90 | Allele 2 |
| B12 | 241.74 | 349.74 | +108.00 | Allele 2 |
| D08 | 158.73 | 263.51 | +104.78 | Allele 2 |
| E02 | 1934.19 | 2753.34 | +819.15 | Heterozygote |
| H12 | -2.08 | -0.69 | +1.40 | No Call (NTC) |

Similarly, **AD RFU2 values differ from HEX End_RFU values**.

### 4.2 Nature of the Difference

| Comparison | Min Diff | Max Diff | Mean Diff | Stdev |
|-----------|----------|----------|-----------|-------|
| FAM End_RFU - AD RFU1 | 1.40 | 2860.33 | 1099.92 | 555.17 |
| HEX End_RFU - AD RFU2 | -91.65 | 2897.65 | 433.39 | 616.55 |

Key observations:
- **FAM End_RFU is ALWAYS greater than AD RFU1** (all 96 differences are positive)
- **HEX End_RFU is usually greater than AD RFU2** (most differences positive, a few slightly negative)
- The differences are **not constant** (vary from ~1 to ~2860), ruling out a simple baseline offset
- The ratio FAM/RFU1 is also not constant (ranges from ~1.1 to ~2.2 for positive wells)

### 4.3 Interpretation

The ADSheet and End Point Results appear to use **different normalization algorithms**:

1. **End Point Results (FAM/HEX/ROX)**: These appear to be the **raw endpoint fluorescence minus baseline** (delta-Rn). Each dye's endpoint is computed independently. The ROX values being near zero suggest the baseline subtraction is already normalized against the passive reference.

2. **ADSheet RFU1/RFU2**: These appear to be further processed values used specifically for the allelic discrimination scatter plot. The AD algorithm likely applies additional normalization (possibly including NTC subtraction, or a different baseline window) to optimize cluster separation for genotype calling.

**For our SNP analyzer application**, the ADSheet RFU1/RFU2 values are what should be used for the allelic discrimination scatter plot and genotype calls, as these match what Bio-Rad's CFX Maestro displays in its AD view.

### 4.4 Well Ordering Consistency

- **ADSheet**: A01 to H12 (ascending, row-major)
- **End Point (all 3)**: H12 to A01 (descending, row-major)
- **Well sets**: Identical across all 4 files (all 96 wells present)
- **Matching by well ID**: Works perfectly -- same well names, same sample names

### 4.5 Values Are Baseline-Subtracted

Both the ADSheet and End Point values show negative values in some wells, confirming these are **baseline-subtracted** (not raw) fluorescence readings:
- AD RFU1 min: -11.02 (G06), AD RFU2 min: -17.10 (G06)
- FAM End_RFU min: -0.69 (H12)
- HEX End_RFU min: 0.46 (H12) -- barely positive
- ROX End_RFU min: -2.05 (H01)

---

## 5. Comparison with Current XLSX Parser

### 5.1 Current Parser Data Source

Our existing CFX XLSX parser reads from "Allelic Discrimination Results.xlsx" which contains data equivalent to the ADSheet XML. The XLSX file contains:
- Well, Sample, Call, Type, RFU1, RFU2

### 5.2 XML vs XLSX Differences

| Aspect | XLSX (current) | XML (ADSheet) |
|--------|---------------|--------------|
| Fields | Same 6 fields | Same 6 fields |
| Precision | Excel-limited | Full float precision (13+ digits) |
| Encoding | Binary XLSX | Plain text XML |
| Parsing | openpyxl/xlrd | xml.etree (stdlib, no deps) |
| Content/NTC info | In separate sheet | NOT in ADSheet (must come from End Point XML) |
| Target names | In separate sheet | NOT in ADSheet (must come from End Point XML) |

### 5.3 XML Advantages

1. **Richer data available**: The 3 End Point XML files provide per-dye data with Content, Target, Sample_Type, and Fluor information that the ADSheet alone lacks
2. **No external dependency**: XML parsing uses stdlib `xml.etree.ElementTree`
3. **Full precision**: Float values have full precision, not Excel-rounded
4. **Target/Dye mapping**: End Point files clearly label FAM=WT (Allele 1) and HEX=MT (Allele 2)
5. **NTC identification**: Content="NTC" field in End Point files identifies NTC wells

### 5.4 XML Disadvantages

1. **Multiple files needed**: ADSheet + End Point files must all be uploaded together
2. **Different normalization**: End Point RFU values differ from AD RFU values; must use ADSheet for the scatter plot
3. **No single file**: Unlike XLSX which can have multiple sheets, XML requires separate files

---

## 6. Summary Data Tables

### 6.1 Allele 2 Wells (12 wells)

| Well | AD RFU1 (FAM) | AD RFU2 (HEX) | FAM End_RFU | HEX End_RFU |
|------|--------------|--------------|------------|------------|
| A12 | 515.96 | 4764.85 | 1146.87 | 6358.89 |
| B03 | 510.02 | 3193.17 | 797.88 | 4418.58 |
| B12 | 241.74 | 5943.78 | 349.74 | 7348.25 |
| D08 | 158.73 | 3277.20 | 263.51 | 4572.98 |
| D10 | 134.11 | 2856.91 | 209.12 | 4045.83 |
| D11 | 159.22 | 3005.24 | 233.55 | 4022.64 |
| D12 | 274.80 | 5533.68 | 453.16 | 6998.54 |
| F02 | 184.55 | 3339.48 | 270.51 | 4478.59 |
| F03 | 263.72 | 5561.62 | 383.17 | 6950.29 |
| F10 | 256.13 | 6438.58 | 376.71 | 7710.68 |
| G03 | 247.98 | 4913.04 | 468.88 | 6422.36 |
| G05 | 251.30 | 3382.74 | 426.27 | 4548.72 |

### 6.2 Heterozygote Wells (9 wells)

| Well | AD RFU1 (FAM) | AD RFU2 (HEX) | FAM End_RFU | HEX End_RFU |
|------|--------------|--------------|------------|------------|
| A01 | 2608.84 | 2108.41 | 3497.30 | 2948.95 |
| A04 | 1854.28 | 1050.10 | 4714.61 | 3696.42 |
| C06 | 3538.16 | 2698.73 | 4561.64 | 3625.37 |
| D02 | 4316.90 | 3746.25 | 5292.21 | 4734.08 |
| E02 | 1934.19 | 1927.97 | 2753.34 | 2843.67 |
| E06 | 2037.78 | 3212.01 | 2642.17 | 4164.04 |
| F04 | 4129.76 | 3686.61 | 5012.50 | 4630.02 |
| F06 | 3834.85 | 3399.36 | 4739.44 | 4369.12 |
| H06 | 3524.55 | 3269.05 | 4361.87 | 4192.20 |

---

## 7. Key Findings for Parser Implementation

1. **For allelic discrimination scatter plot**: Use ADSheet XML `RFU1` (X-axis, FAM/Allele 1) and `RFU2` (Y-axis, HEX/Allele 2) directly. These are the values Bio-Rad uses for genotype clustering.

2. **For genotype calls**: ADSheet `Call` field has 4 values: "Allele 1", "Allele 2", "Heterozygote", "No Call". There is no separate "NTC" or "Undetermined" call -- NTC wells get "No Call".

3. **For NTC identification**: Must parse End Point XML files and check `Content` field for "NTC". The ADSheet alone cannot distinguish NTC from failed sample wells.

4. **For dye/target mapping**: End Point XML provides: FAM=WT (Allele 1), HEX=MT (Allele 2), ROX=REF (passive reference).

5. **ROX normalization**: Not needed when using AD RFU values -- the normalization is already baked in. ROX End_RFU values are near-zero for most wells.

6. **End Point RFU values**: Useful for per-dye analysis but NOT interchangeable with AD RFU values. The AD values use a different (more processed) normalization specific to allelic discrimination.

7. **XML parsing**: All files use simple, flat XML with no namespaces, attributes, or nesting beyond Root > Row > Fields. Trivial to parse with `xml.etree.ElementTree`.
