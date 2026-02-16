# CFX Opus XML Export Analysis - Workplan

## Background
CFX Opus (.pcrd) raw files are encrypted and uncrackable. However, CFX Maestro exports rich XML data that is far more detailed than the XLSX exports we currently parse. The XML export includes per-dye files with cycle-by-cycle amplification data, endpoint fluorescence, and allelic discrimination calls.

## File Inventory (16 XML files from single run)

| # | File | Size | Description | Priority |
|---|------|------|-------------|----------|
| 1 | Run Information.xml | 1.2KB | Metadata: instrument, protocol, dates | HIGH |
| 2 | ADSheet.xml | 18KB | Allelic Discrimination: Well, Sample, Call, RFU1, RFU2 | **CRITICAL** |
| 3 | Quantification Amplification Results_FAM.xml | 70KB | FAM cycle-by-cycle RFU (23 cycles x 96 wells) | **CRITICAL** |
| 4 | Quantification Amplification Results_HEX.xml | 71KB | HEX cycle-by-cycle RFU | **CRITICAL** |
| 5 | Quantification Amplification Results_ROX.xml | 71KB | ROX cycle-by-cycle RFU | **CRITICAL** |
| 6 | End Point Results_FAM.xml | 30KB | FAM final RFU per well | HIGH |
| 7 | End Point Results_HEX.xml | 30KB | HEX final RFU per well | HIGH |
| 8 | End Point Results_ROX.xml | 30KB | ROX final RFU per well | HIGH |
| 9 | Quantification Cq Results.xml | 149KB | Cq values per well per dye (288 rows = 96x3) | HIGH |
| 10 | Quantification Summary.xml | 54KB | Summary: Well, Fluor, Target, Cq, SQ | MEDIUM |
| 11 | Quantification Plate View Results_FAM.xml | 13KB | Plate grid view (display-oriented) | LOW |
| 12 | Quantification Plate View Results_HEX.xml | 13KB | Plate grid view | LOW |
| 13 | Quantification Plate View Results_ROX.xml | 12KB | Plate grid view | LOW |
| 14 | Gene Expression Results - Bar Chart.xml | 6KB | Gene expression (all NaN - not configured) | SKIP |
| 15 | Melt Curve Plate View Results_FAM/HEX/ROX.xml | 6KB ea | Melt curve (display-oriented) | LOW |
| 16 | ANOVA Results_ANOVA.xml | 108B | Empty | SKIP |
| 17 | Standard Curve Results.xml | 630B | All N/A | SKIP |

## XML Structure Summary (from initial sampling)

### ADSheet.xml
```xml
<Row>
  <Well>A01</Well>
  <Sample>SNP</Sample>
  <Call>Heterozygote</Call>  <!-- Genotype call -->
  <Type>Auto</Type>
  <RFU1>2608.84</RFU1>       <!-- Allele 1 (FAM) endpoint -->
  <RFU2>2108.41</RFU2>       <!-- Allele 2 (HEX) endpoint -->
</Row>
```

### Amplification Results (per dye)
```xml
<FAM>
  <Row>
    <Cycle>1</Cycle>
    <A1>48.60</A1>   <!-- Well A1 RFU at cycle 1 -->
    <A2>115.94</A2>
    ...
    <H12>-2.31</H12>
  </Row>
  <!-- 23 rows total = 23 amplification cycles -->
</FAM>
```

### End Point Results (per dye)
```xml
<Row>
  <Well>H12</Well>
  <Fluor>FAM</Fluor>
  <Target>WT</Target>
  <Content>NTC</Content>    <!-- NTC / Unkn -->
  <Sample>SNP</Sample>
  <End_RFU>-0.688</End_RFU>
  <Call />
  <Sample_Type>NTC</Sample_Type>
  <CallType>Unassigned</CallType>
  <Is_Control>False</Is_Control>
</Row>
```

### Cq Results
```xml
<Row>
  <Well>A01</Well>
  <Fluor>FAM</Fluor>
  <Target>WT</Target>
  <Content>Unkn</Content>
  <Sample>SNP</Sample>
  <Cq>8.626</Cq>
  <Cq_Mean>8.626</Cq_Mean>
  <Cq_Std._Dev>0</Cq_Std._Dev>
  <Set_Point>40</Set_Point>
</Row>
```

## Analysis Phases

### Phase 1: Deep Analysis (Subagents, Parallel)
Dispatch 4 subagents to fully parse and document each XML category:

| Agent | Files | Output |
|-------|-------|--------|
| A: Amplification | 3x Amp Results (FAM/HEX/ROX) | `analysis-amplification.md` |
| B: Endpoint + AD | ADSheet + 3x End Point | `analysis-endpoint-ad.md` |
| C: Cq + Summary | Cq Results + Summary | `analysis-cq-summary.md` |
| D: Plate/Melt/Meta | Plate View + Melt + Run Info | `analysis-supplementary.md` |

Each agent produces:
- Full schema documentation (all fields, types, ranges)
- Row counts and data completeness
- Sample data snippets
- Relationship to UnifiedData model
- What's new vs. XLSX exports

### Phase 2: Cross-Reference & Comparison
- Compare XML fields to current XLSX parser output
- Identify new data exclusively available in XML
- Map pre-read / amplification / post-read data structure
- Verify 23 amplification cycles matches protocol (35 cycles configured?)

### Phase 3: Parser Design Spec
- Write `CFX-XML-PARSER-SPEC.md` with:
  - Which XML files to parse (minimal set)
  - Field mapping to UnifiedData
  - ROX normalization strategy from XML data
  - Handling pre/post-read vs amplification cycles
  - File detection logic (multiple XML files from one export)

### Phase 4: Implementation (future session)
- Create `app/parsers/cfx_xml_parser.py`
- Integrate with existing upload flow (multi-file upload?)
- Tests

## Key Questions to Resolve
1. **Pre/Post read data**: Where exactly are pre-read and post-read fluorescence values? Only amplification (23 cycles) visible so far.
2. **23 vs 35 cycles**: Protocol says 35 cycles but amplification data shows 23. Was the run stopped early, or are some cycles read-only?
3. **Multi-file upload**: XML export produces 16+ files. Should we accept a ZIP/folder, or require specific files?
4. **FAM=WT mapping**: FAM is mapped to "WT" (wild-type) target. How does this map to our Allele1/Allele2 model?
5. **RFU1/RFU2 in ADSheet**: Which dye is RFU1 vs RFU2? (Likely FAM/HEX but need to verify)

## Output Files
All intermediate analysis files will be written to `./CFX-opus/`:
- `WORKPLAN-cfx-xml-analysis.md` (this file)
- `analysis-amplification.md`
- `analysis-endpoint-ad.md`
- `analysis-cq-summary.md`
- `analysis-supplementary.md`
- `CFX-XML-PARSER-SPEC.md` (Phase 3)
