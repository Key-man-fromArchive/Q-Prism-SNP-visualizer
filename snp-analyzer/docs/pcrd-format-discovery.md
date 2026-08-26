# Bio-Rad .pcrd File Format — Reverse Engineering Discovery Document

> Reverse-engineered from CFX Opus .pcrd files produced by CFX Maestro 5.3.
> This document records the format structure, decryption method, data layout,
> and calibration data findings discovered during parser development.

## 1. File Container

| Property | Value |
|----------|-------|
| Container | ZIP archive with ZipCrypto encryption |
| Password | Set via `PCRD_PASSWORD` environment variable |
| Contents | Single XML file (UTF-8 with BOM) |
| Root element | `<experimentalData2>` |

The decryption key must be provided via the `PCRD_PASSWORD` environment variable.
Standard Python `zipfile` module handles ZipCrypto decryption natively.

## 2. XML Structure Overview

```
experimentalData2
├── plateSetup2 (rows, columns, plateName)
│   └── dyeLayersList
│       └── dyeLayer[] (plateName="FAM"|"HEX"|"VIC"|"ROX")
│           ├── fluor (channelPosition: 0, 1, 2, ...)
│           └── wellSamples
│               └── wellSample[] (plateIndex, wellSampleType, sampleId)
├── protocol2BaseList
│   ├── TemperatureStep[] (temperatureStepTemp, temperatureStepHoldTime)
│   │   ├── PlateReadOption (presence = data acquisition point)
│   │   └── IncrementOption (optionTemperatureIncrement → touchdown)
│   └── GotoStep[] (optionGotoStep, optionGotoCycle)
├── runData
│   └── plateReadDataVector
│       └── plateRead[]
│           └── PlateRead
│               ├── Hdr/PlateReadDataHeader (Step, Cycle, ChCount, NumRows, NumCols)
│               └── Data/PAr (semicolon-delimited fluorescence values)
└── CalibrationCollection
    └── FactoryCals/Ar/I[n]
        └── CalibrationData (plateName, dyeName)
            └── PRs/PRs/{tag}/PlateRead/Data/PAr
```

## 3. Plate Setup

### Well Indexing
- `plateIndex`: 0-based, ROW-MAJOR order
- Formula: `row * 12 + col` where row=0..7 (A-H), col=0..11
- Example: A1=0, A12=11, B1=12, H12=95

### Well Sample Types
| Type | Meaning |
|------|---------|
| `wcSample` | Unknown/test sample |
| `wcNTC` | No Template Control |
| `wcPostiveControl` | Positive control (note: Bio-Rad typo in XML) |
| `wcPositiveControl` | Positive control (correct spelling, also accepted) |
| `wcEmpty` | Unassigned well |

### Dye Channel Mapping
Defined in `dyeLayer/fluor/@channelPosition`:
| Dye | Typical Channel | Role |
|-----|----------------|------|
| FAM | 0 | Reporter (Allele 1 / Wild Type) |
| HEX | 1 | Reporter (Allele 2 / Mutant) |
| VIC | 1 | Reporter (alternative to HEX) |
| ROX | 2 | Passive reference (plate-loading normalization) |

The CFX Opus has 6 optical channels total. Only assigned dyes have channel positions.

## 4. PAr Data Layout (Critical Discovery)

The `PAr` element contains semicolon-delimited floating-point values representing
fluorescence readings for all wells across all channels.

### Layout: CHANNEL-MAJOR

```
Total values = ChCount × N_positions × 4

Index formula:
  vals[channel * (N_positions * 4) + position * 4 + stat_offset]

Where:
  channel     = 0..ChCount-1
  N_positions = NumRows * NumCols (typically 108 = 9 rows × 12 cols)
  position    = row * NumCols + col
  stat_offset = 0 (mean), 1 (stdev), 2 (min), 3 (max)
```

### Physical Layout
- 108 positions = 9 rows × 12 columns
- Rows 0-7 correspond to wells A-H (the 96-well plate)
- Row 8 = internal reference detector (skip for analysis)

### Example: 6 channels, 108 positions
```
Total = 6 × 108 × 4 = 2592 values

Channel 0 (FAM): vals[0..431]     → 108 positions × 4 stats each
Channel 1 (HEX): vals[432..863]   → 108 positions × 4 stats each
Channel 2 (ROX): vals[864..1295]  → 108 positions × 4 stats each
Channel 3-5:     vals[1296..2591] → unused channels
```

### Why This Matters
The initial implementation assumed POSITION-MAJOR layout (`vals[pos * ChCount * 4 + ch * 4]`),
which produced similar values across all channels for any given well (all ~5500 RFU).
Switching to CHANNEL-MAJOR revealed the correct separation between FAM, HEX, and ROX signals.

## 5. Protocol Structure

### Temperature Steps
Each `TemperatureStep` element has:
- `temperatureStepTemp`: target temperature in °C
- `temperatureStepHoldTime`: hold time in seconds
- `PlateReadOption` child: if present, a data acquisition (plate read) occurs at this step
- `IncrementOption` child: if present, temperature decreases per cycle (touchdown PCR)

### GOTO Resolution
`GotoStep` elements create loops:
- `optionGotoStep`: target step index (0-based)
- `optionGotoCycle`: number of additional iterations

Steps inside a GOTO loop execute `optionGotoCycle + 1` total times
(the initial pass plus N repeats).

### ASG-PCR Protocol — real production profiles

> **2026-08-26.** The two-tier block that used to sit here (ending at 55 °C, 25
> plate reads) came from an early QuantStudio `.eds` and is NOT what the CFX
> production protocols do. It was read by another team as "ASG-PCR bottoms out at
> 55 °C and has no 40 °C step", which is wrong and cost a round of analysis.
> Below are the actual `protocol2BaseList` values, as parsed into
> `sessions.metadata_json.protocol_steps` by `app/parsers/pcrd_raw.py`.

Every production profile is **3-tier (v9: 4)** and every plate read happens at
**40 °C**, because the FRET cassette's measured binding temperature is 50 °C —
the reaction must drop below 50 °C for a reporter to exist, so the 40 °C step
cannot be removed.

| Stage | v4 (previous production) | v7 | v8 | v9 |
|---|---|---|---|---|
| Pre-read | 30 °C 60 s ● | 30 °C 60 s ● | 30 °C 60 s ● | 30 °C 60 s ● |
| Initial denaturation | 94 °C 300 s | 94 °C 300 s | 94 °C 300 s | 94 °C 300 s |
| Tier 1 (touchdown) | 94/20 + **61**/60 ×10 | 94/20 + **64**/60 ×10 | 94/20 + **61**/60 ×10 | 94/20 + **61**/60 ×10 |
| Tier 2 | 94/15 + 60/**5** ×15 | 94/10 + 60/**60** ×25 | 94/10 + 60/**60** ×25 | 94/15 + 60/**5** ×15 |
| Tier 3a (no read) | — | — | — | 94/10 + 60/30 ×10 |
| Tier 3b (read) | 95/10 + 60/60 + **40/10 ●** ×20 | 94/10 + 60/30 + **40/10 ●** ×10 | 94/10 + 60/30 + **40/10 ●** ×10 | 94/10 + 60/30 + **40/10 ●** ×10 |
| Post-read | 30 °C 30 s ● | 30 °C 30 s ● | 30 °C 30 s ● | 30 °C 30 s ● |
| Plate reads | 20 | 10 | 10 | 10 |
| 60 °C total | 1,275 s | 1,800 s | 1,800 s | 675 s |
| ≤50 °C total | 738 s | 369 s | 369 s | 369 s |

● = plate read. Touchdown decrements 0.6 °C/cycle (61.0 → 55.6, or 64.0 → 58.6 on v7).

**Cost of one read** (2.6 °C/s effective ramp, from 54 measured read timestamps):
50→40 descent 3.8 s + 40 °C hold 10.0 s + optical scan 19.2 s + 40→50 ascent
3.8 s = **36.9 s below 50 °C**, or 44.6 s of wall clock.

The production choice is **v9 with Tier 3b reduced to 3 reads** — same best
separation ratio (R min 4.72, reached at read #1), 1.8 min below 50 °C instead of
12.3 min, and 57.0 min total instead of 87.6.

For the full comparison and the evidence, see the V4-vs-V9 report.

## 6. Data Windows

PlateReads are grouped by their `Step` value and classified into named windows:

| Window | Heuristic | Purpose |
|--------|-----------|---------|
| Pre-read | Single read before amplification | Outlier detection (dry wells, film) |
| Amplification | Largest read group | Signal curves for genotyping |
| Post-read | Single read after amplification | Endpoint outlier detection |

For simple qPCR protocols with only one read step, all reads are classified
as "Amplification" with no pre/post windows.

## 7. Baseline Subtraction

### The Problem
Raw PAr data includes hardware background fluorescence (~3000-5000 RFU per channel).
CFX Maestro applies "LinearBaseLineNormalizedCurveFit" internally, which uses a
sigmoid curve-fit algorithm to estimate the lower asymptote as the baseline.

### Our Approach: First-Cycle Subtraction
The first amplification cycle is subtracted as a flat baseline from all cycles.
This produces values comparable to CFX Maestro's export:

| Metric | FAM | HEX |
|--------|-----|-----|
| Mean error vs XML export | 2.2% | 3.2% |
| Max error | 8.4% | 8.1% |
| Wells compared | 95 | 95 |

### ROX: Do NOT Baseline-Subtract
ROX is a passive reference dye — its signal does not change across amplification
cycles. Baseline subtraction makes ROX values near-zero in early cycles, causing
division-by-zero artifacts when computing FAM/ROX normalization.

**Rule: Only subtract baseline from reporter dyes (FAM, HEX/VIC). Keep ROX raw.**

## 8. Calibration Data (For Future Use)

The `.pcrd` file contains factory calibration data that could improve accuracy
through spectral deconvolution.

### Structure
```
CalibrationCollection/FactoryCals/Ar/I[0..27]/CalibrationData
```
- 28 entries total: 14 dyes × 2 plate types (BR Clear, BR White)
- Each entry has 8 plate reads: pure dye + empty at 4 temperatures (20, 40, 60, 80°C)
- Tags: `dye{N}_x003A_{temp}_x003A_PR` (pure) and `dye{N}_x003A_{temp}_x003A_ER` (empty)

### Calibration PAr Layout
Calibration PAr data uses a simplified layout (no stats, just means):
```
vals[channel * 108 + position]
```
(108 values per channel, no stdev/min/max)

### Computed Deconvolution Matrix (40°C, BR White)
The 3×3 inverse matrix for FAM/HEX/ROX spectral deconvolution:

```
        FAM         HEX         ROX
FAM  [ 0.999935  -0.020758   0.000939]
HEX  [ 0.003542   1.000079  -0.013857]
ROX  [ 0.012604  -0.011233   1.000164]
```

Key crosstalk coefficients:
- FAM → HEX: ~2.07% (the dominant systematic error source)
- HEX → FAM: ~0.35% (negligible)
- HEX → ROX: ~1.39%

Applying this deconvolution would reduce the mean error from ~2-3% to <1%,
but is not critical for allelic discrimination where relative ratios matter.

## 9. Comparison: .pcrd vs XML Export

| Feature | .pcrd Raw | XML Export |
|---------|-----------|------------|
| Data type | Raw PAr (hardware RFU) | Baseline-subtracted, deconvolved |
| Pre/Post reads | Included | Not exported |
| Cycle range | Full protocol | Analysis window only (e.g., 23 of 35) |
| Genotype calls | Not included | In ADSheet.xml |
| Plate setup | Full well assignments | Well names only |
| Protocol | Full with GOTO loops | Not included |
| File size | ~2-5 MB | ~5-15 MB (16 XML files) |
| Encryption | ZipCrypto | None |

## 10. Known Limitations

1. **384-well plates**: Not supported (NumRows > 8). Rejected with helpful error.
2. **MiniOpticon**: Not supported (NumRows < 8). Rejected with helpful error.
3. **Spectral deconvolution**: Not applied. Introduces ~2% systematic bias on FAM.
4. **Sigmoid baseline**: We use flat (first-cycle) baseline, not CFX Maestro's
   curve-fit approach. This means per-cycle values may differ from CFX Maestro
   in mid-amplification region, but endpoint values match within 2-8%.
5. **Multiple plate types**: Parser assumes consistent plate type across the run.
   Mixed plate types within a single .pcrd file have not been tested.
