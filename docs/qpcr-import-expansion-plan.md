# qPCR Import Expansion Plan

## 목적

현재 Q-Prism SNP Visualizer는 QuantStudio와 Bio-Rad CFX 계열 파일을 중심으로 동작한다. Roche LightCycler, Qiagen Rotor-Gene, Analytik Jena qTOWER 등 다른 qPCR 장비까지 확장하려면 장비별 파일을 모두 직접 해석하는 방식만으로는 유지보수가 어렵다. 목표는 모든 입력을 `well, cycle, reporter channel, RFU` 형태로 수집한 뒤, 각 reporter channel을 assay role인 `WT`, `MT1`, `MT2`, `MT3`, `normalization`, `excluded`에 매핑하는 import layer를 만드는 것이다. dye/channel 이름과 변이 role은 반드시 분리해서 다룬다.

## 배경 조사 요약

- RDML은 qPCR 데이터 교환을 위한 공개 표준이며, Bio-Rad CFX Maestro, Roche LightCycler 96, Applied Biosystems 계열, Qiagen Rotor-Gene Q 등이 RDML 호환 목록에 있다.
- RDES는 RDML 컨소시엄이 제안한 단순 spreadsheet 형식이다. `Well, Sample, Sample Type, Target, Target Type, Dye, Cq` 뒤에 cycle별 raw fluorescence 값을 배치한다.
- qpcR의 `pcrimport()`는 구분자, decimal separator, 삭제할 행/열, reporter/reference dye 위치를 사용자가 단계적으로 매핑하는 방식이다.
- qbase+는 장비별 export를 공통 내부 형식으로 변환하며, 자동 인식 실패 시 generic/qBase/RDML 형식으로 맞추도록 안내한다.
- Analytik Jena qPCRsoft는 Excel, CSV, LIMS, qBase+, GeneIO, GenEx export를 지원하고 fluorescence data CSV export도 제공한다.

## 제품 전략: 3층 Import Architecture

### Layer 1. Vendor Parsers

기존 `QuantStudio`와 `Bio-Rad CFX` parser는 유지한다. 장비별 원본 파일에서 최대한 많은 metadata를 얻을 수 있으므로, 이미 지원하는 포맷은 계속 우선 경로로 둔다.

추가 후보:

- Roche LightCycler text export / RDML
- Qiagen Rotor-Gene RDML
- Analytik Jena qPCRsoft CSV/XLS/XLSX export

### Layer 2. Standard Interchange Parsers

표준 포맷을 장비 확장의 중심으로 삼는다.

- `.rdml`: RDML ZIP/XML에서 run, react, target, dye, amplification data point를 추출한다.
- `.tsv`, `.csv`, `.txt`: RDES-compatible input을 지원한다.
- `.xlsx`: RDES-compatible workbook 또는 generic spreadsheet를 지원한다.

RDML은 장비 간 호환성, RDES는 사용자가 직접 맞출 수 있는 실용성을 담당한다.

### Layer 3. Generic Mapping Importer

자동 감지가 실패하거나 파일 구조가 다양한 경우 mapping UI로 처리한다. 이 레이어는 장비 미보유 상황에서 가장 중요한 확장 수단이다.

지원할 기본 형태:

```csv
well,cycle,dye,role,rfu,sample,target
A1,1,FAM,WT,123.4,Sample_01,SNP1
A1,1,VIC,MT1,100.2,Sample_01,SNP1
A1,1,ROX,normalization,900.1,Sample_01,SNP1
```

또는 channel-neutral wide 형태:

```csv
well,cycle,ch1_rfu,ch2_rfu,ch3_rfu,ch4_rfu,sample,target
A1,1,123.4,100.2,900.1,,Sample_01,SNP1
A1,2,130.1,108.7,902.4,,Sample_01,SNP1
```

wide 형태에서는 UI 또는 sidecar metadata가 `ch1_rfu -> WT`, `ch2_rfu -> MT1`, `ch3_rfu -> normalization`처럼 channel role을 확정해야 한다.

## RDES 입력양식 다운로드 기능

RDES는 사용자가 장비 export를 직접 변환할 수 있는 가장 좋은 fallback이다. 따라서 업로드 화면에 `Download template` 기능을 추가한다.

릴리스 규칙: 다운로드 가능한 템플릿은 같은 릴리스에서 반드시 업로드와 분석 preview까지 성공해야 한다. 아직 parser가 없는 템플릿은 UI에 노출하지 않는다.

### 제공 템플릿

1. `qprism-rdes-amplification-template.tsv`
   - RDES의 cycle-as-columns 구조를 따르되 `Role` 컬럼을 추가한 Q-Prism extension 형식
   - 아래 예시는 `WT/MT duplex + ROX normalization` 모드 한 가지 케이스다. 다른 assay에서는 dye와 role 조합이 달라질 수 있다.

```tsv
Well	Sample	Sample Type	Target	Target Type	Dye	Role	Cq	1	2	3	4	5
A1	Sample_01	unkn	SNP1	toi	FAM	WT		120.1	122.3	130.5	150.2	180.8
A1	Sample_01	unkn	SNP1	toi	VIC	MT1		98.1	99.5	105.0	112.2	130.4
A1	Sample_01	unkn	SNP1	ref	ROX	normalization		900.0	901.2	899.8	902.1	900.7
```

주의: 엄격한 RDES 표준은 첫 7개 컬럼이 고정되어 있으므로 위 템플릿은 strict RDES가 아니다. strict RDES 파일은 별도 mapping UI에서 `Target/Dye -> Role`을 확정한다.

2. `qprism-generic-long-template.csv`
   - 사용자가 이해하기 쉬운 long format
   - 헤더: `well,cycle,dye,role,rfu,sample,target,sample_type`

3. `qprism-generic-wide-template.csv`
   - channel-neutral wide format
   - 헤더: `well,cycle,ch1_rfu,ch2_rfu,ch3_rfu,ch4_rfu,sample,target`
   - UI에서 각 channel을 `WT`, `MT1`, `MT2`, `MT3`, `normalization`, `excluded` 중 하나로 매핑한다.

### UI 요구사항

- 업로드 영역 근처에 템플릿 다운로드 메뉴를 둔다.
- 메뉴 항목:
  - `RDES TSV`
  - `Generic long CSV`
  - `Generic wide CSV`
- 각 템플릿에는 2-3개 example row를 제공한다.
- RDES/CSV 파일 내부에는 comment row를 넣지 않는다. 설명은 별도 help modal 또는 README로 제공한다.
- 템플릿 다운로드는 서버 API 없이 static file로 제공해도 된다.

## Mapping UI 요구사항

### 자동 감지

파일 업로드 후 preview 단계에서 다음을 자동 추정한다.

- delimiter: comma, tab, semicolon
- decimal separator: `.`, `,`
- header row 위치
- well column
- cycle column 또는 cycle header row
- channel/dye column 또는 channel별 value columns
- fluorescence value column
- sample name column
- channel 수와 dye 후보: FAM, VIC, HEX, Cy5, Texas Red, ROX 등
- 가능한 assay mode 후보: WT/MT duplex, WT/MT1/MT2 triplex, WT/MT1/MT2/MT3 quadruplex, normalization 사용 여부

### 사용자 매핑

사용자 매핑은 두 단계로 분리한다.

1. 파일 구조 매핑
   - Well
   - Cycle
   - Sample name, optional
   - Target, optional
   - NTC/control/sample type, optional
   - 각 fluorescence column 또는 dye row가 어떤 reporter channel인지

2. Assay role 매핑
   - Assay mode: `WT/MT`, `WT/MT1/MT2`, `WT/MT1/MT2/MT3`
   - 각 reporter channel -> `WT`, `MT1`, `MT2`, `MT3`, `normalization`, `excluded`
   - normalization 방식: `none`, `passive reference`, `custom/manual`
   - ROX는 특정 assay mode에서만 normalization channel로 사용한다. 다른 mode에서는 allele reporter일 수도 있고, 아예 없을 수도 있다.

### Mapping Wizard Flow

1. 파일 업로드 후 owner-bound `preview_id`를 생성한다.
2. workbook 또는 archive에 여러 table 후보가 있으면 worksheet/table을 선택한다.
3. delimiter, decimal separator, header row, first data row를 확인한다.
4. format을 선택한다: strict RDES, Q-Prism RDES-extension, generic long, generic wide.
5. 파일 구조를 매핑한다.
6. assay mode와 channel role을 확정한다.
7. validation preview를 확인한다.
8. import하거나, 파일 재업로드 없이 mapping 단계로 돌아가 수정한다.

### Preview & Validation

매핑 후 즉시 preview를 제공한다.

- wells 수
- cycles 범위
- detected channels/dyes
- selected assay mode
- role binding: WT/MT1/MT2/MT3/normalization/excluded
- missing values 수
- duplicate `(well, cycle, channel)` 수
- 선택된 assay mode의 모든 required role이 channel에 바인딩되었는지
- normalization mode가 channel을 요구할 때 해당 channel이 존재하는지
- 동일 channel 또는 role이 중복 바인딩되지 않았는지
- 3개 representative amplification curves
- 선택된 assay mode의 대표 role-pair endpoint scatter preview, 예: WT vs MT1, MT1 vs MT2

검증 실패 시 분석으로 넘어가지 않고 구체적인 수정 메시지를 제공한다.

### Error Recovery Taxonomy

| Error | User Action | Import 가능 여부 |
| --- | --- | --- |
| unsupported extension/content type | 지원 포맷 또는 템플릿으로 변환 | 불가 |
| Cq-only 또는 endpoint-only 파일 | cycle별 fluorescence export 필요 안내 | 제한 모드 전까지 불가 |
| missing well/cycle/channel/RFU | mapping 수정 또는 파일 보정 | 불가 |
| malformed well ID | `A1` 또는 지원 plate geometry로 보정 | 불가 |
| duplicate `(well, cycle, channel)` | 중복 처리 정책 선택 또는 파일 보정 | 기본 불가 |
| required role 미바인딩 | channel role 매핑 수정 | 불가 |
| normalization channel 누락 | normalization mode를 `none`으로 바꾸거나 파일 보정 | 조건부 가능 |
| decimal separator mismatch | preview에서 separator 수정 | 가능 |
| inconsistent cycle count | 제외/보정 또는 import 중단 선택 | 조건부 가능 |

## Backend 설계

### 신규 모듈

```text
snp-analyzer/app/parsers/
  registry.py
  rdml.py
  rdes.py
  generic_table.py
  mapping.py
snp-analyzer/app/services/
  import_session.py
```

### Canonical Import Model

Parser는 바로 기존 분석 모델에 쓰기보다 먼저 장비 중립 canonical model을 만든다.

```text
ImportRun
  instrument: optional string
  plate_geometry: rows/columns/well_format
  channels: list[ReporterChannel]
  readings: list[well, cycle, channel_id, rfu]
  samples: well -> sample metadata
  targets: optional target metadata
  cq_values: optional per well/channel Cq

ReporterChannel
  channel_id: stable id from file
  dye_name: optional, e.g. FAM/VIC/HEX/ROX/Cy5
  role: WT | MT1 | MT2 | MT3 | normalization | excluded | unknown
```

`UnifiedData` 변환은 mapping/validation 이후에만 수행한다. 장기적으로는 기존 `fam/allele2` 중심 model을 role-aware model로 확장해야 한다. 단기 호환이 필요하면 WT/MT duplex만 기존 `fam/allele2` 형태로 adapter 변환하고, triplex/quadruplex는 새 분석 모델이 준비될 때까지 preview-only 또는 제한 지원으로 둔다.

### Parser Registry Contract

각 parser는 동일한 계약을 따른다.

```text
sniff(file) -> confidence + parser_id + reason
preview(file) -> detected tables, channels, sample rows, warnings
parse(file, mapping_config) -> ImportRun
to_unified(import_run, assay_config) -> UnifiedData or role-aware analysis model
```

우선순위는 vendor parser, standard parser(RDML/RDES), generic parser 순서다. generic `.xlsx`가 CFX `.xlsx`를 가로채지 않도록 detector precedence tests를 둔다.

### 데이터 흐름

```text
uploaded file
  -> parser registry sniff
  -> parser preview
  -> mapping config
  -> ImportRun
  -> role-aware validation
  -> UnifiedData or future role-aware analysis model
  -> existing normalization / scatter / plate / QC
```

### API 후보

- `POST /api/import/preview`
  - 파일을 읽고 `preview_id`, sheet/list/header 후보, channel 후보, sample rows, warnings를 반환한다.
- `POST /api/import/parse`
  - `preview_id` + mapping config를 받아 session을 생성한다.
- `GET /templates/qprism-rdes-amplification-template.tsv`
  - static template download.

기존 `POST /api/upload`은 자동 감지 가능한 vendor 파일을 바로 처리하고, ambiguous/RDML/RDES/generic file은 preview flow로 유도한다. `/api/upload`과 `/api/import/parse`는 공통 service인 `create_session_from_import(...)`를 사용해 session 생성, SQLite 저장, ASG binding, suggested cycle 계산이 drift 나지 않게 한다.

### Security & Limits

- 기존 upload size limit과 ZIP hardening을 `.rdml`, `.rdm`, `.xlsx`, `.zip`에 재사용한다.
- RDML/XML parsing에는 external entity를 비활성화한 XML parser, 예: `defusedxml`, 를 사용한다.
- preview는 최대 rows/sheets/cycles/wells/channels를 제한하고 sample rows만 반환한다.
- numeric RFU는 finite number만 허용한다.
- spreadsheet formula는 값으로 계산된 결과만 읽고, formula text가 RFU 위치에 있으면 reject한다.
- validation 실패 시 session을 생성하거나 DB에 저장하지 않는다.

## 테스트 Fixture 전략

공개 예제를 사용해 최소 fixture set을 만든다.

- RDML R package:
  - `lc96_bACTXY.rdml`
  - `BioRad_qPCR_melt.rdml`
  - `stepone_std.rdml`
- RDML-tools:
  - `test_1_raw_data.rdml`
  - `sample.tsv`
- tidyqpcr:
  - Roche LightCycler raw text export example
  - Roche LightCycler Cq text export example

주의: Roche 공개 예제는 single-channel SYBR 중심이라 SNP allelic discrimination 전체 검증에는 부족하다. SNP multi-channel 검증은 synthetic RDES/generic fixtures와 실제 사용자 제공 파일이 필요하다.

필수 synthetic fixture matrix:

- generic long: WT/MT duplex, WT/MT + normalization, WT/MT1/MT2, WT/MT1/MT2/MT3
- generic wide: channel-neutral columns with explicit role mapping
- Q-Prism RDES-extension: cycle-as-columns with `Role`
- strict RDES: role은 mapping UI에서 확정
- invalid cases: malformed well, duplicate `(well, cycle, channel)`, missing required role, missing normalization channel, decimal comma, semicolon delimiter, inconsistent cycle count
- regression cases: 기존 QuantStudio `.eds/.xls`, Bio-Rad `.pcrd/.xlsx/.zip`가 기존처럼 동작

## 단계별 구현 로드맵

### Phase 1. Template & Strict Generic/RDES Foundation

- static template 3종 추가
- 다운로드 가능한 모든 템플릿의 strict parser 구현
- generic long/wide CSV parser 구현: exact header만 자동 parse
- Q-Prism RDES-extension parser 구현
- backend tests 추가
- 업로드 UI에 template download 메뉴 추가

### Phase 2. Canonical Import & Validation

- `ImportRun` canonical model 추가
- assay mode 정의와 channel -> role mapping rule 추가
- role-aware validation 추가
- 공통 session creation service 추가
- detector precedence regression tests 추가

### Phase 3. Mapping Preview UI

- preview API 추가
- frontend mapping screen 추가
- worksheet/header/data row 선택 추가
- channel mapping과 assay role mapping 분리
- validation summary와 representative curve preview 제공
- mapping preset 저장 구조 설계

### Phase 4. RDML Parser

- `.rdml` ZIP/XML parsing 추가
- RDML amplification data point를 `ImportRun`으로 변환
- RDML fixture tests 추가
- Roche LightCycler 96 RDML 예제로 smoke test
- RDML은 multi-run/multi-target 가능성이 높으므로 기본은 preview-first로 처리한다.

### Phase 5. Vendor Presets

- Roche LightCycler text export preset
- Analytik Jena qPCRsoft CSV/XLSX preset
- Qiagen Rotor-Gene RDML preset
- 실제 사용자 파일 확보 시 장비별 parser 보강

## 수용 기준

- 사용자는 vendor 파일 없이도 RDES/generic template을 다운로드해 데이터를 업로드할 수 있다.
- cycle별 fluorescence 값이 있으면 기존 scatter, plate, amplification curve, QC 기능을 재사용한다.
- 선택된 assay mode의 모든 required role이 channel에 바인딩된다.
- role 미바인딩, role 중복, channel 중복은 import 전에 차단된다.
- dye/channel 이름과 WT/MT role은 분리된 metadata로 저장된다.
- normalization channel이 지정되지 않거나 해당 assay mode에서 요구되지 않으면 raw fluorescence mode로 동작한다.
- normalization이 요구되는데 channel이 없으면 import 전에 사용자가 `none`으로 바꾸거나 파일을 수정해야 한다.
- mapping 실패는 조용히 실패하지 않고 수정 가능한 메시지를 제공한다.
- parser 추가가 기존 QuantStudio/Bio-Rad import를 깨뜨리지 않는다.
- 다운로드 가능한 모든 템플릿은 template download -> upload -> preview -> import smoke test를 통과한다.
- 각 parser test는 wells, cycles, readings count, channel role mapping, sample metadata, expected errors를 golden assertion으로 검증한다.

## 참고 링크

- RDML: https://rdml.org/
- RDML compliant instruments: https://rdml.org/instruments.html
- RDES format: https://rdml.org/rdes.html
- qpcR `pcrimport`: https://search.r-project.org/CRAN/refmans/qpcR/html/pcrimport.html
- qbase+ manual: https://genorm.cmgg.be/software/qbaseplus_manual_20180924.pdf
- tidyqpcr: https://github.com/ropensci/tidyqpcr
- RDML example data: https://github.com/PCRuniversum/RDML/tree/master/inst/extdata
- RDML-tools sample files: https://github.com/RDML-consortium/rdml-tools/tree/main/client/src/static/bin
