# CFX Opus - Quantification Amplification Results XML Analysis

**Date**: 2026-02-16
**Instrument**: Bio-Rad CFX Opus (serial 783BR20183)
**Run**: admin_2026-02-16 11-12-20
**Files analyzed**:
- `admin_2026-02-16 11-12-20_783BR20183 -  Quantification Amplification Results_FAM.xml` (68.9 KB)
- `admin_2026-02-16 11-12-20_783BR20183 -  Quantification Amplification Results_HEX.xml` (69.2 KB)
- `admin_2026-02-16 11-12-20_783BR20183 -  Quantification Amplification Results_ROX.xml` (69.8 KB)

---

## 1. XML Schema

### Root Element

Each file uses the dye name as the root element tag:

```xml
<FAM>
  <Row>
    <Cycle>1</Cycle>
    <A1>48.6045673122326</A1>
    <A2>115.935012163661</A2>
    ...
    <H12>14.300947190171</H12>
  </Row>
  <Row>
    <Cycle>2</Cycle>
    ...
  </Row>
  ...
</FAM>
```

### Key structure facts
- **No XML declaration** (no `<?xml ...?>` header) -- file starts directly with `<FAM>`, `<HEX>`, or `<ROX>`
- **No attributes** on any element (root or children)
- **No namespaces**
- Each `<Row>` has exactly **97 child elements**: 1 `<Cycle>` + 96 well tags
- **Values are double-precision floats** with up to 15 significant digits (e.g., `48.6045673122326`)

### Well Tag Order

Wells appear in **row-major order** (A1-A12, B1-B12, ..., H1-H12):

```
A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12,
B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12,
C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12,
D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12,
E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12,
F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12,
G1, G2, G3, G4, G5, G6, G7, G8, G9, G10, G11, G12,
H1, H2, H3, H4, H5, H6, H7, H8, H9, H10, H11, H12
```

This is the standard 96-well plate layout (8 rows x 12 columns).

---

## 2. Cycle Count

| Dye | Rows | Cycles | Range |
|-----|------|--------|-------|
| FAM | 23   | 23     | 1-23  |
| HEX | 23   | 23     | 1-23  |
| ROX | 23   | 23     | 1-23  |

All three files have **identical structure**: 23 cycles, 96 wells, same well tag names, same ordering.

**Note**: 23 cycles is unusually short for a standard qPCR run (typically 35-45 cycles). This likely reflects the actual thermal cycling protocol configured for this SNP discrimination assay, since genotyping assays often use fewer cycles as they only need to distinguish amplifying vs. non-amplifying wells rather than precise Cq quantification.

---

## 3. Data Ranges (RFU values)

### Summary by dye and cycle position

| Metric | FAM Cycle 1 | FAM Cycle 12 | FAM Cycle 23 |
|--------|-------------|--------------|--------------|
| Min    | -1.83       | -80.06       | -10.38       |
| Max    | 381.63      | 4,412.17     | 12,812.79    |
| Mean   | 107.97      | 1,932.28     | 6,963.35     |
| Median | 106.50      | 1,859.79     | 8,665.39     |

| Metric | HEX Cycle 1 | HEX Cycle 12 | HEX Cycle 23 |
|--------|-------------|--------------|--------------|
| Min    | -8.84       | -41.70       | -5.60        |
| Max    | 18,538.26*  | 5,780.51     | 8,426.54     |
| Mean   | 404.35*     | 416.01       | 1,651.80     |
| Median | 21.50       | 12.40        | 225.97       |

*HEX max/mean at cycle 1 are inflated by 2 anomalous wells (E8, F12) -- see Section 8.

| Metric | ROX Cycle 1 | ROX Cycle 12 | ROX Cycle 23 |
|--------|-------------|--------------|--------------|
| Min    | -9.52       | -18.54       | -3.72        |
| Max    | 59.46       | 256.48       | 674.16       |
| Mean   | 8.78        | 14.92        | 58.79        |
| Median | 5.40        | -0.27        | 3.55         |

### Global ranges

| Dye | Global Min | Global Max  | Total Data Points |
|-----|-----------|-------------|-------------------|
| FAM | -85.06    | 12,812.79   | 2,208 (96 x 23)  |
| HEX | -150.36   | 18,538.26   | 2,208             |
| ROX | -31.60    | 674.16      | 2,208             |

---

## 4. Well Count

All three files contain data for all **96 wells** (A1 through H12). No wells are missing or empty.

---

## 5. Baseline Analysis

### Cycle 1 Values - Interpretation

The cycle 1 values are **NOT raw RFU** values. Evidence of baseline subtraction:

1. **Negative values present at cycle 1**: FAM has 3, HEX has 16, ROX has 19 negative wells
2. **FAM cycle 1 mean is ~108 RFU** -- raw FAM fluorescence on CFX Opus instruments is typically 200-2000 RFU at cycle 1
3. **Values near zero with scatter around baseline** in non-amplifying wells
4. **The export is labeled "Quantification Amplification Results"** -- Bio-Rad CFX Maestro exports this as **baseline-subtracted RFU (delta RFU or delta Rn)**

### Negative values per cycle (sample)

| Cycle | FAM negatives | HEX negatives | ROX negatives |
|-------|--------------|---------------|---------------|
| 1     | 3            | 16            | 19            |
| 5     | 32           | 20            | 27            |
| 9     | 14           | 51            | 27            |
| 12    | 9            | 32            | 51            |
| 17    | 4            | 19            | 36            |
| 23    | 1            | 2             | 19            |

The pattern shows:
- **FAM**: Many negatives in early-mid cycles (baseline fluctuation), decreasing as amplification takes over
- **HEX**: Peaks at cycle 9 (51 negative wells) because many wells don't amplify for HEX
- **ROX**: Consistently high negative count (~19-51 per cycle) because ROX shows very little signal change

This confirms **baseline-subtracted data** where values oscillate around zero when no amplification occurs.

---

## 6. Growth Patterns / Amplification Curves

### Example: Well A1 (amplifies for both FAM and HEX)

| Cycle | FAM     | HEX     | ROX    |
|-------|---------|---------|--------|
| 1     | 48.6    | 13.2    | 10.8   |
| 5     | -3.7    | -5.4    | 3.7    |
| 8     | 113.9   | 65.0    | 5.7    |
| 12    | 761.2   | 600.7   | 26.6   |
| 16    | 1,923.7 | 1,551.8 | 65.6   |
| 20    | 3,300.6 | 2,645.0 | 128.3  |
| 23    | 4,412.4 | 3,559.2 | 190.0  |

Classic sigmoid amplification curve: baseline -> exponential -> plateau. Amplification starts around cycles 7-8.

### Example: Well A5 (FAM-only amplifier)

| Cycle | FAM     | HEX    | ROX   |
|-------|---------|--------|-------|
| 1     | 76.4    | 18.4   | -0.7  |
| 5     | -13.8   | 7.2    | 3.0   |
| 8     | 78.4    | -1.8   | -0.7  |
| 12    | 1,476.4 | -11.8  | 0.6   |
| 16    | 4,412.9 | -6.5   | -1.7  |
| 20    | 7,363.6 | 11.2   | -1.1  |
| 23    | 8,810.3 | 31.6   | -0.2  |

FAM shows strong amplification while HEX stays flat near zero and ROX stays flat near zero. This is a **homozygous Allele 1** (FAM allele) sample.

### Well Classification (growth threshold: >500 RFU increase from cycle 1 to 23)

| Category      | Count | Description |
|---------------|-------|-------------|
| FAM-only      | 54    | Homozygous for FAM allele |
| HEX-only      | 6     | Homozygous for HEX allele |
| Both FAM+HEX  | 32    | Heterozygous |
| Neither       | 4     | No amplification (NTC/empty/failed) |

#### Wells by category

**FAM-only (54)**: A5, A6, A7, A8, A9, A10, A11, B2, B4, B5, B6, B7, B9, B10, B11, C3, C4, C5, C7, C8, C9, C10, C11, C12, D3, D4, D5, D9, E1, E3, E4, E5, E7, E8, E10, F5, F7, F8, F11, F12, G2, G4, G8, G10, G11, H1, H2, H3, H5, H7, H8, H9, H10, H11

**HEX-only (6)**: B12, D8, D10, D11, F2, F10

**Both (32)**: A1, A2, A3, A4, A12, B1, B3, B8, C1, C2, C6, D1, D2, D6, D7, D12, E2, E6, E9, E11, F1, F3, F4, F6, F9, G1, G3, G5, G7, G12, H4, H6

**Neither (4)**: E12, G6, G9, H12

---

## 7. ROX Behavior

### ROX is NOT a flat passive reference in this data

**Critical finding**: Unlike typical qPCR where ROX is a passive reference dye with flat signal, ROX in this dataset shows significant growth in some wells:

| Well Group | ROX Growth (mean) | ROX Growth (range) |
|------------|-------------------|-------------------|
| Both (FAM+HEX, 32 wells) | +132.85 RFU | -41.79 to +668.52 |
| HEX-only (6 wells) | +62.18 RFU | -63.18 to +255.04 |
| FAM-only (54 wells) | +3.68 RFU | -13.37 to +202.77 |
| Neither (4 wells) | -5.53 RFU | -9.10 to +0.42 |

**Top 5 ROX-growing wells**:

| Well | ROX Cycle 1 | ROX Cycle 23 | ROX Growth | SNP Category |
|------|-------------|--------------|------------|--------------|
| B3   | 5.65        | 674.16       | +668.52    | Both         |
| A3   | 13.59       | 591.59       | +578.00    | Both         |
| A2   | 8.51        | 466.36       | +457.85    | Both         |
| C1   | 8.10        | 360.23       | +352.13    | Both         |
| A4   | 16.55       | 342.96       | +326.41    | Both         |

**77 out of 96 wells** have flat ROX (|growth| < 50 RFU). The 19 wells with ROX growth are concentrated in wells that amplify for BOTH dyes.

### Interpretation

This ROX behavior could indicate:
1. **ROX is not just a passive reference** -- it may be a third channel measuring something (though unlikely for SNP discrimination)
2. **Spectral crosstalk/bleed-through**: Strong FAM+HEX signals bleeding into the ROX channel in wells with high amplification
3. **This is baseline-subtracted data**, so the "ROX growth" may be an artifact of the baseline subtraction algorithm

**For parser implementation**: The ROX channel data should still be parsed and stored, but these values are likely **NOT suitable for Rn normalization** (dividing FAM/ROX or HEX/ROX) because ROX itself is not flat. The data appears to already be baseline-subtracted.

---

## 8. NTC Well (H12) Analysis

H12 is confirmed as NTC (No Template Control) based on the Allelic Discrimination Results file.

### H12 values across all 23 cycles

| Cycle | FAM     | HEX     | ROX     |
|-------|---------|---------|---------|
| 1     | 14.30   | 10.40   | 5.48    |
| 2     | 0.23    | 0.36    | -2.45   |
| 3     | -5.96   | 0.54    | 4.23    |
| 4     | 0.16    | 2.00    | 2.07    |
| 5     | -0.94   | 0.11    | -1.94   |
| 6     | -0.34   | 0.11    | -2.30   |
| 7     | 2.16    | -0.73   | -4.25   |
| 8     | -0.02   | 0.16    | -0.95   |
| 9     | 0.96    | 0.51    | -0.21   |
| 10    | 3.27    | -3.04   | 0.14    |
| 11    | -1.25   | -0.67   | -1.56   |
| 12    | 1.92    | -3.44   | 5.16    |
| 13    | 0.96    | 1.16    | 2.03    |
| 14    | 1.93    | 5.49    | 0.95    |
| 15    | -6.68   | -0.66   | 1.48    |
| 16    | 4.32    | -2.23   | 0.34    |
| 17    | -5.01   | 1.06    | -0.43   |
| 18    | -2.08   | -0.13   | 1.40    |
| 19    | 1.15    | 3.72    | 0.90    |
| 20    | -3.23   | -1.25   | -5.74   |
| 21    | 2.45    | 2.66    | 2.05    |
| 22    | -6.96   | -2.26   | 2.43    |
| 23    | 4.55    | -0.58   | -1.31   |

### H12 Statistics

| Stat   | FAM   | HEX   | ROX   |
|--------|-------|-------|-------|
| Mean   | 0.26  | 0.58  | 0.33  |
| StdDev | 4.50  | 2.96  | 2.76  |
| Min    | -6.96 | -3.44 | -5.74 |
| Max    | 14.30 | 10.40 | 5.48  |

**Conclusion**: H12 (NTC) is perfectly flat across all three dyes. Values oscillate around zero with low variance, confirming:
- No amplification (no template present)
- Baseline subtraction is working correctly
- The noise floor is approximately +/-7 RFU for FAM, +/-5 RFU for HEX, +/-6 RFU for ROX

---

## 9. Differences Between Dyes

### Structural comparison

| Property | FAM | HEX | ROX |
|----------|-----|-----|-----|
| Root tag | `<FAM>` | `<HEX>` | `<ROX>` |
| Row count | 23 | 23 | 23 |
| Well count | 96 | 96 | 96 |
| Cycle range | 1-23 | 1-23 | 1-23 |
| Well tag order | A1...H12 | A1...H12 | A1...H12 |
| File size | 68.9 KB | 69.2 KB | 69.8 KB |

**All three files have identical structure.** The only differences are:
1. The root element tag name (`<FAM>` vs `<HEX>` vs `<ROX>`)
2. The actual RFU data values
3. Minor file size differences (due to different float representations)

### Signal magnitude comparison

| Dye | Typical amplifying well at Cycle 23 | Non-amplifying well |
|-----|--------------------------------------|---------------------|
| FAM | 4,000 - 12,000 RFU | -10 to +80 RFU |
| HEX | 2,000 - 8,000 RFU | -40 to +30 RFU |
| ROX | 0 - 670 RFU (mostly flat) | -6 to +6 RFU |

FAM produces the strongest signal, followed by HEX. ROX has ~10-20x lower signal.

### HEX Anomalous Wells (E8, F12)

Two wells in the HEX channel show an extraordinary pattern: **extremely high values at cycle 1 that linearly DECREASE over cycles**:

**E8 HEX**: Starts at 15,498 RFU, linearly decreases to ~85 RFU at cycle 19, then rises slightly to 932 at cycle 23.

**F12 HEX**: Starts at 18,538 RFU, linearly decreases to -150 RFU at cycle 19, then rises to 1,026 at cycle 23.

```
E8 HEX trace: 15498 -> 14574 -> 13654 -> 12717 -> 11796 -> ... -> 85 -> -1 -> 206 -> 551 -> 932
F12 HEX trace: 18538 -> 17368 -> 16203 -> 15043 -> 13884 -> ... -> -150 -> 36 -> 531 -> 996 -> 1026
```

These same wells show normal behavior in FAM (E8: 14 -> 1235; F12: 77 -> 5031) and ROX (E8: 30 -> 90; F12: 8 -> 211).

**This is likely a fluorescence artifact** -- possibly a bubble, debris, or instrument artifact in the HEX channel only. The linear decay pattern suggests the baseline subtraction algorithm struggled with an anomalous initial signal. The software may be applying a linearly-decreasing baseline correction derived from the abnormal cycle-1 reading.

---

## 10. Negative Values

**Yes, negative RFU values are present in all three files.** This is expected for baseline-subtracted data.

| Dye | Total negative values | % of all data points | Wells with negatives at Cycle 1 |
|-----|----------------------|---------------------|---------------------------------|
| FAM | 187                  | 8.5%                | 3 (B3, D8, D10)               |
| HEX | 454                  | 20.6%               | 16                              |
| ROX | 695                  | 31.5%               | 19                              |

**Distribution pattern**:
- **FAM**: Fewest negatives because FAM amplifies in 86/96 wells; negatives mostly in early cycles before amplification begins and in the 10 non-amplifying wells
- **HEX**: More negatives because only 38/96 wells amplify for HEX; the 58 non-amplifying wells contribute negative values across all cycles
- **ROX**: Most negatives because ROX is mostly flat (passive reference behavior in 77/96 wells); values fluctuate around zero

**For parser implementation**: The parser must handle negative float values. These are NOT errors -- they are a natural consequence of baseline subtraction.

---

## 11. Parser Implementation Notes

### Parsing algorithm

```python
import xml.etree.ElementTree as ET

def parse_amplification_xml(filepath: str) -> dict:
    """Parse CFX Opus Quantification Amplification Results XML.

    Returns:
        {
            "dye": str,          # "FAM", "HEX", or "ROX"
            "cycles": list[int], # [1, 2, ..., 23]
            "wells": list[str],  # ["A1", "A2", ..., "H12"]
            "data": dict[str, list[float]]  # well -> [rfu_cycle1, rfu_cycle2, ...]
        }
    """
    tree = ET.parse(filepath)
    root = tree.getroot()
    dye = root.tag  # "FAM", "HEX", or "ROX"

    rows = root.findall("Row")
    first_row = rows[0]
    wells = [child.tag for child in first_row if child.tag != "Cycle"]

    cycles = []
    data = {w: [] for w in wells}

    for row in rows:
        cycles.append(int(row.find("Cycle").text))
        for well in wells:
            data[well].append(float(row.find(well).text))

    return {"dye": dye, "cycles": cycles, "wells": wells, "data": data}
```

### Key parsing considerations

1. **Root tag varies by dye** -- use `root.tag` to identify which dye the file contains
2. **No XML declaration or namespaces** -- standard ElementTree parsing works fine
3. **Well tags are XML element names** -- `<A1>`, `<A2>`, ..., `<H12>`; these are already valid XML tag names
4. **Float precision**: Values have up to 15 significant digits (double precision). Python's `float()` handles these correctly.
5. **Negative values must be handled** -- do NOT assume RFU >= 0
6. **The data is baseline-subtracted** -- this is NOT raw RFU and should NOT be further baseline-subtracted
7. **23 cycles for this run** -- do not hardcode cycle count; read from the data
8. **The HEX anomalous wells (E8, F12)** with very high initial values should be handled gracefully; they are valid data even if biologically suspicious

### File naming convention

```
{operator}_{date} {time}_{serial} -  Quantification Amplification Results_{DYE}.xml
```

Example: `admin_2026-02-16 11-12-20_783BR20183 -  Quantification Amplification Results_FAM.xml`

- Operator: `admin`
- Date/Time: `2026-02-16 11-12-20`
- Serial: `783BR20183`
- Dye: `FAM` (from the suffix before `.xml`)

Note the **double space** before "Quantification" -- this appears to be a Bio-Rad export quirk.

### Relationship to other CFX Opus XML exports

This directory also contains related XML files from the same run:

| File Type | Size | Description |
|-----------|------|-------------|
| Quantification Amplification Results (x3) | ~70 KB | **THIS FILE** - cycle-by-cycle RFU per well |
| End Point Results (x3) | ~29 KB | Single endpoint RFU per well (detailed) |
| Quantification Plate View Results (x3) | ~12 KB | Summary plate view |
| Quantification Cq Results | 146 KB | Cq values (288 rows) |
| Quantification Summary | 53 KB | Summary data (288 rows) |
| Allelic Discrimination Results | 18 KB | AD call results per well |
| Melt Curve Plate View Results (x3) | ~6 KB | Melt curve data |
| Run Information | 1.2 KB | Run metadata |
| Standard Curve Results | 0.6 KB | Standard curve data |
| ANOVA Results | 0.1 KB | Statistical analysis |
| Gene Expression Results - Bar Chart | 6.3 KB | Gene expression data |

---

## 12. Summary of Key Findings

1. **Clean, simple XML structure**: No namespaces, no attributes, predictable well ordering (A1-H12 row-major)
2. **Baseline-subtracted data**: Values represent delta-RFU, can be negative, centered around zero for non-amplifying wells
3. **23 amplification cycles**: Shorter than typical qPCR, appropriate for SNP discrimination endpoint assays
4. **96 wells, all populated**: Full plate with data in every well position
5. **SNP discrimination pattern visible**: 54 FAM-homozygous, 6 HEX-homozygous, 32 heterozygous, 4 NTC/failed
6. **ROX is NOT a simple passive reference**: Shows growth correlated with FAM+HEX amplification, likely spectral crosstalk
7. **Two anomalous HEX wells** (E8, F12): Extremely high starting values with linear decay -- instrument artifact
8. **NTC (H12) is clean**: Flat across all dyes, confirming no contamination
9. **Identical structure across all three dye files**: Same wells, same cycles, same ordering -- can be parsed with a single function
10. **Negative values are expected and common** (8.5% FAM, 20.6% HEX, 31.5% ROX)
