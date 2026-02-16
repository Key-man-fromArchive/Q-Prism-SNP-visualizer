# CFX Opus XML Export Analysis: Quantification Cq Results & Summary

**Source files:**
- `admin_2026-02-16 11-12-20_783BR20183 -  Quantification Cq Results.xml` (149 KB)
- `admin_2026-02-16 11-12-20_783BR20183 -  Quantification Summary.xml` (54 KB)

**Analysis date:** 2026-02-16

---

## 1. Quantification Cq Results -- Complete Schema

### 1.1 XML Structure

Root element: `<_x0030_>` (encoded "0" -- a CFX Opus quirk for the sheet index)

Each `<Row>` contains **15 fields**:

| # | Field (XML tag) | Type | Description |
|---|-----------------|------|-------------|
| 1 | `Well` | String | Well position: A01-H12 (96-well plate) |
| 2 | `Fluor` | String | Fluorophore/dye channel |
| 3 | `Target` | String | Target name assigned in plate setup |
| 4 | `Content` | String | Well content type |
| 5 | `Sample` | String | Sample name |
| 6 | `Biological_Set_Name` | String | Biological replicate group name (always empty) |
| 7 | `Cq` | Float/NaN | Quantification cycle (threshold cycle) |
| 8 | `Cq_Mean` | Float/0 | Mean Cq across technical replicates |
| 9 | `Cq_Std._Dev` | Float | Standard deviation of Cq across replicates (always 0) |
| 10 | `Starting_Quantity__x0028_SQ_x0029_` | Float/NaN | Starting quantity from standard curve (always NaN) |
| 11 | `Log_Starting_Quantity` | Float/NaN | Log10 of starting quantity (always NaN) |
| 12 | `SQ_Mean` | Float | Mean of SQ across replicates (0 or NaN) |
| 13 | `SQ_Std._Dev` | Float | Standard deviation of SQ (always 0) |
| 14 | `Set_Point` | Integer | Number of amplification cycles (always 40) |
| 15 | `Well_Note` | String | User annotation (always empty) |

### 1.2 Row Count

**288 rows total = 96 wells x 3 fluorophores** -- hypothesis confirmed.

Row organization: **Fluor-major order** (NOT well-major):
- Rows 0-95: FAM for wells A01 through H12
- Rows 96-191: HEX for wells A01 through H12
- Rows 192-287: ROX for wells A01 through H12

Within each fluor block, wells are in column-major plate order (A01, A02, ..., A12, B01, ..., H12).

### 1.3 Fluorophore-to-Target Mapping

| Fluorophore | Target | Biological Meaning |
|-------------|--------|-------------------|
| **FAM** | **WT** | Wild-type allele |
| **HEX** | **MT** | Mutant allele |
| **ROX** | **REF** | Reference/passive reference dye |

This is the standard SNP discrimination assay configuration: FAM detects one allele (WT), HEX detects the other (MT), and ROX serves as the internal reference for normalization.

### 1.4 Content Types

| Content | Well Count | Row Count (x3 dyes) |
|---------|-----------|---------------------|
| `Unkn` | 92 wells | 276 rows |
| `NTC` | 4 wells | 12 rows |

**NTC wells: E12, F12, G12, H12** (bottom-right column 12, rows E-H)

### 1.5 Sample Name

All 288 rows have `Sample = "SNP"` -- a single uniform sample name for the entire plate. Individual sample differentiation was NOT configured in the CFX software plate setup.

### 1.6 Cq Value Statistics

#### Overall Counts

| Fluor | Valid Cq | NaN Cq | Total |
|-------|---------|--------|-------|
| FAM (WT) | 93 | 3 | 96 |
| HEX (MT) | 73 | 23 | 96 |
| ROX (REF) | 17 | 79 | 96 |

#### Descriptive Statistics (valid values only)

| Statistic | FAM (WT) | HEX (MT) | ROX (REF) |
|-----------|---------|---------|----------|
| Count | 93 | 73 | 17 |
| Min | 6.0104 | 6.1867 | 2.0000 |
| Max | 22.0000 | 22.0000 | 22.0000 |
| Mean | 9.6311 | 13.1959 | 8.8230 |
| Median | 8.0563 | 12.8058 | 6.8512 |
| Std Dev | 4.0338 | 4.5312 | 5.7320 |

#### Cq Distribution by Range

| Range | FAM | HEX | ROX |
|-------|-----|-----|-----|
| < 5 | 0 | 0 | 2 |
| 5 - 8 | 46 | 12 | 9 |
| 8 - 10 | 26 | 12 | 2 |
| 10 - 15 | 7 | 21 | 0 |
| 15 - 20 | 11 | 24 | 3 |
| 20+ | 3 | 4 | 1 |
| NaN | 3 | 23 | 79 |

#### Percentiles (FAM and HEX)

| Percentile | FAM | HEX |
|-----------|-----|-----|
| P0 (min) | 6.0104 | 6.1867 |
| P10 | 6.8930 | 7.2781 |
| P25 | 7.2619 | 9.2053 |
| P50 (median) | 8.0563 | 12.8058 |
| P75 | 9.7290 | 17.0514 |
| P90 | 15.9725 | 19.0118 |
| P100 (max) | 22.0000 | 22.0000 |

**Observation:** FAM (WT) values are concentrated in 5-10 range (strong amplification), while HEX (MT) values are more spread across 6-20 (variable amplification). This is consistent with a heterogeneous SNP sample set where wild-type signal is generally stronger.

#### Boundary Values (Cq = 2 or Cq = 22 exactly)

Wells with `Cq = 22` (exact integer, likely a capping threshold):
- B03 (FAM), G11 (FAM), F02 (HEX), A04 (ROX)

Wells with `Cq = 2` (exact integer, likely a floor threshold):
- G05 (ROX)

These integer values suggest CFX software applies min/max capping at cycle 2 (earliest detectable) and cycle 22 (user-defined Set_Point or analysis window limit). The `Set_Point = 40` likely represents total cycles run, while 22 may be an effective analysis ceiling.

### 1.7 NaN Cq Analysis

#### Wells with NaN by Fluor

- **FAM NaN (3 wells):** E12, G06, H12
- **HEX NaN (23 wells):** A05, A11, B05, B06, B07, C07, C10, C11, C12, E01, E08, E12, F07, F08, F11, F12, G04, G06, G09, G10, G11, H01, H12
- **ROX NaN (79 wells):** Nearly all wells (only 17 have valid ROX Cq)

#### NaN Pattern per Well

| Pattern | Count | Interpretation |
|---------|-------|---------------|
| FAM=val, HEX=val, ROX=NaN | 57 | Normal: both alleles detected, ROX below threshold |
| FAM=val, HEX=NaN, ROX=NaN | 19 | WT-only: homozygous wild-type candidates |
| FAM=val, HEX=val, ROX=val | 16 | All dyes above threshold |
| FAM=NaN, HEX=NaN, ROX=NaN | 3 | Empty/failed: no amplification (includes E12, H12 NTCs and G06) |
| FAM=val, HEX=NaN, ROX=val | 1 | Unusual: WT + REF only (F12, an NTC) |

**Key finding:** ROX (reference dye) has NaN in 79/96 wells. This is unusual for a passive reference -- normally ROX should be detected in all wells. This suggests ROX was configured as an active detection channel (Target = "REF") rather than being used as a passive reference for normalization. The CFX Opus may handle passive reference normalization internally without reporting it as Cq values.

### 1.8 NTC Well Detail

| Well | FAM (WT) | HEX (MT) | ROX (REF) |
|------|---------|---------|----------|
| E12 | NaN | NaN | NaN |
| F12 | 15.67 | NaN | 16.36 |
| G12 | 18.08 | 18.56 | NaN |
| H12 | NaN | NaN | NaN |

**NTC interpretation:**
- E12 and H12 are clean -- no amplification in any channel
- F12 shows late-cycle FAM and ROX signal (contamination or non-specific amplification)
- G12 shows late-cycle FAM and HEX signal (contamination or non-specific amplification)
- NTC Cq values > 15 cycles are typically considered acceptable for SNP discrimination assays since they are well-separated from true positive signals (most in 6-10 range)

### 1.9 Cq vs Cq_Mean Relationship

**Rule:** When Cq is a numeric value, `Cq_Mean` is ALWAYS identical to `Cq` (100% match).

**When Cq = NaN:** `Cq_Mean = 0` (not NaN). This is a software quirk -- 105 rows have this pattern.

**Why identical?** Because `Cq_Std._Dev = 0` for ALL rows. No biological replicates are defined (`Biological_Set_Name` is always empty). Each well is treated as a singleton, so Mean = Value and StDev = 0.

### 1.10 Unused Fields

Several fields contain constant/empty values across all 288 rows:

| Field | Value | Reason |
|-------|-------|--------|
| `Biological_Set_Name` | "" (empty) | No biological replicate groups defined |
| `Cq_Std._Dev` | 0 | Singleton wells (no grouping) |
| `Starting_Quantity__x0028_SQ_x0029_` | NaN | No standard curve loaded |
| `Log_Starting_Quantity` | NaN | No standard curve loaded |
| `SQ_Mean` | 0 or NaN | No standard curve loaded (0 when Cq=NaN, NaN otherwise) |
| `SQ_Std._Dev` | 0 | No standard curve loaded |
| `Set_Point` | 40 | Constant: total PCR cycles = 40 |
| `Well_Note` | "" (empty) | No user annotations |

### 1.11 Sample Data: Row A

| Well | FAM (WT) | HEX (MT) | ROX (REF) |
|------|---------|---------|----------|
| A01 | 8.626 | 9.205 | 8.705 |
| A02 | 9.001 | 13.175 | 3.567 |
| A03 | 9.838 | 17.051 | 6.851 |
| A04 | 15.905 | 17.608 | 22.000 |
| A05 | 9.239 | NaN | NaN |
| A06 | 7.710 | 16.590 | NaN |
| A07 | 7.237 | 8.778 | NaN |
| A08 | 8.516 | 14.537 | NaN |
| A09 | 7.870 | 9.870 | NaN |
| A10 | 8.084 | 8.555 | NaN |
| A11 | 9.729 | NaN | NaN |
| A12 | 15.911 | 7.983 | 8.105 |

---

## 2. Quantification Summary -- Complete Schema

### 2.1 XML Structure

Root element: `<_x0030_>` (same as Cq Results)

Each `<Row>` contains **7 fields**:

| # | Field | Type | Description |
|---|-------|------|-------------|
| 1 | `Well` | String | Well position |
| 2 | `Fluor` | String | Fluorophore |
| 3 | `Target` | String | Target name |
| 4 | `Content` | String | Well content type |
| 5 | `Sample` | String | Sample name |
| 6 | `Cq` | Float/NaN | Quantification cycle |
| 7 | `SQ` | Float/NaN | Starting quantity (always NaN) |

### 2.2 Row Count

**288 rows** -- identical to Cq Results (96 wells x 3 fluors).

Same row ordering (FAM block, then HEX block, then ROX block).

### 2.3 Comparison with Cq Results

#### Fields Unique to Cq Results (8 extra fields)

| Field | Value in this dataset | Useful? |
|-------|----------------------|---------|
| `Biological_Set_Name` | Always empty | No |
| `Cq_Mean` | Same as Cq (or 0 when Cq=NaN) | No (redundant with Cq) |
| `Cq_Std._Dev` | Always 0 | No |
| `Starting_Quantity__x0028_SQ_x0029_` | Always NaN | No |
| `Log_Starting_Quantity` | Always NaN | No |
| `SQ_Mean` | 0 or NaN | No |
| `SQ_Std._Dev` | Always 0 | No |
| `Set_Point` | Always 40 | Marginal (constant) |
| `Well_Note` | Always empty | No |

#### Fields Unique to Summary (1 field)

| Field | Note |
|-------|------|
| `SQ` | Equivalent to `Starting_Quantity__x0028_SQ_x0029_` in Cq Results. Always NaN in both. The Summary uses a cleaner tag name. |

#### Shared Fields (6 fields)

`Well`, `Fluor`, `Target`, `Content`, `Sample`, `Cq` -- identical values in both files.

---

## 3. Cross-File Analysis

### 3.1 Cq Value Consistency

**288/288 rows match exactly** -- Cq values are 100% identical between the two files (character-for-character string comparison, including full decimal precision and NaN).

### 3.2 Row Alignment

Both files use the same row ordering. Row N in Cq Results corresponds to Row N in Summary (same Well, same Fluor).

### 3.3 Redundancy Assessment

**The Summary file is a strict subset of Cq Results.** It contains:
- Same 6 core fields (Well, Fluor, Target, Content, Sample, Cq)
- One renamed field (SQ = Starting_Quantity, both NaN)
- NONE of the 8 extra statistical/replicate fields from Cq Results

The Summary adds **zero unique information**. It is a convenience export with a simpler schema.

### 3.4 Recommendation: Primary Cq Source

**Use Cq Results as the primary source.** Rationale:
1. It is a superset -- everything in Summary exists in Cq Results
2. The `Set_Point` field (40 cycles) provides useful context metadata
3. The `Cq_Mean` and `Cq_Std._Dev` fields would become meaningful if biological replicates were defined
4. `Well_Note` could contain annotations in other experiments
5. In this specific experiment, all extra fields are constant/empty, so Summary would also work fine

**For the parser:** Parse the Cq Results file. Fall back to Summary if Cq Results is not available. The Summary can be safely ignored when Cq Results is present.

---

## 4. Key Findings for SNP Analyzer Parser

### 4.1 What the parser needs to extract

For SNP discrimination, the parser needs per-well:
- **FAM Cq** (WT allele signal strength)
- **HEX Cq** (MT allele signal strength)
- **Content type** (Unkn vs NTC for filtering)

ROX Cq is mostly NaN (79/96 wells) and should NOT be used for normalization from this file. ROX normalization for the CFX Opus is likely handled in the amplification data curves, not in the Cq export.

### 4.2 Data quality considerations

- **NaN handling:** 3 FAM-NaN wells, 23 HEX-NaN wells. These represent no-amplification events (below threshold or truly absent allele).
- **Cq = 22 (ceiling):** 4 instances. This may represent a capping artifact; treat with caution.
- **Cq = 2 (floor):** 1 instance (ROX only). Likely an artifact.
- **NTC contamination:** 2 of 4 NTCs show late-cycle amplification (Cq > 15). This is borderline and should be flagged but is typically acceptable when sample Cq values are in the 6-10 range.

### 4.3 XML parsing notes

- Root tag is `_x0030_` (not a meaningful name)
- The tag `Starting_Quantity__x0028_SQ_x0029_` is XML-encoded for `Starting_Quantity(SQ)` -- parentheses are escaped
- All float values use full double precision (e.g., `8.62633865354423`)
- NaN is represented as the literal string `NaN`
- Empty string fields use self-closing tags (e.g., `<Biological_Set_Name />`)

### 4.4 Comparison with other CFX export formats

The Cq Results XML provides threshold cycle values but does NOT include:
- Raw fluorescence amplification curves (those are in the Amplification Results XML)
- End-point RFU values (those are in the End Point Results XML)
- Melt curve data (in the Melt Curve Results XML)

For the SNP discrimination scatter plot (Allele1 vs Allele2), the **End Point Results** or **Amplification Results** files are needed for RFU-based plotting. The Cq Results file is useful for:
- Cq-based allelic discrimination (plotting FAM Cq vs HEX Cq)
- Quality control (NTC checking, Cq outlier detection)
- Supplementary data display alongside RFU-based plots

---

## 5. Complete Well Map (92 Unkn + 4 NTC)

### NaN Pattern Visualization

```
     01   02   03   04   05   06   07   08   09   10   11   12
A:  FHR  FHR  FHR  FHR  Fh.  FH.  FH.  FH.  FH.  FH.  Fh.  FHR
B:  FHR  Fh.  FHR  Fh.  Fh.  Fh.  Fh.  FH.  FH.  FH.  FH.  FHR
C:  FHR  FH.  FH.  FH.  FH.  FHR  Fh.  FH.  FH.  Fh.  Fh.  Fh.
D:  FH.  FH.  FH.  FH.  FH.  FH.  FH.  FH.  FH.  FH.  FHR  FHR
E:  Fh.  FH.  FH.  FH.  FH.  FH.  FH.  Fh.  FH.  FH.  FH.  ...
F:  FH.  FH.  FHR  FH.  FH.  FH.  Fh.  Fh.  FH.  FH.  Fh.  F.R
G:  FH.  FH.  FHR  Fh.  FHR  ...  FH.  FH.  Fh.  Fh.  Fh.  FH.
H:  Fh.  FH.  FH.  FHR  FH.  FH.  FH.  FH.  FH.  FH.  FH.  ...
```

Legend:
- `F` = FAM has valid Cq
- `H` = HEX has valid Cq
- `R` = ROX has valid Cq
- `.` = NaN for that channel
- `h` = HEX is NaN (lowercase for visibility)
- `...` = all three channels are NaN (empty/failed well)
- NTC wells: E12, F12, G12, H12

---

## 6. Summary Table

| Property | Cq Results | Summary |
|----------|-----------|---------|
| Row count | 288 | 288 |
| Fields per row | 15 | 7 |
| Unique wells | 96 | 96 |
| Fluorophores | FAM, HEX, ROX | FAM, HEX, ROX |
| Cq values identical? | -- | Yes (100%) |
| Has replicate stats? | Yes (but all trivial) | No |
| Has standard curve data? | Yes (but all NaN) | SQ only (NaN) |
| Has Set_Point? | Yes (40) | No |
| Has Well_Note? | Yes (empty) | No |
| File size | 149 KB | 54 KB |
| **Recommended use** | **Primary source** | Fallback / ignore |
