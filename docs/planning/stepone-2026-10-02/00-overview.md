# StepOnePlus 지원 · 마커별 분석 · 결과 출력 기획서

- 작성일: 2026-10-02 · 개정 r2(멀티 AI 리뷰 1차 반영) · 실행 구조는 06-tasks-draft r3(병렬 레인)
- 상태: APPROVED — 2026-10-02 사용자 승인(결정 기록: evidence/P0-T0.1.md)
- 기준 코드: `main` = `55a7452` (Release v1.3.1, `worktree/ux-followup-integration`)
  - 루트 작업트리는 detached `201e0c7`로 **main보다 143커밋 뒤**다. 구현 기준으로 쓰지 않는다.
- 대상 파일: `261002_QPrism_ASG-PCR.eds` (전남대학교, StepOnePlus, StepOne Software v2.3, Genotyping, ROX high)
  - 고객 데이터이므로 **저장소에 커밋하지 않는다.** 실제 파일 검증은 저장소 밖 경로로만 한다.
- 범위 밖: Fluorquant 파일, 48웰 StepOne, StepOne 방식 ΔRn 배경 모드, 마커별 염료 매핑, 마커별 비율 원점, 레거시 정적 프론트(`USE_LEGACY=1`), 미사용 `pdf_builder.py`/`xlsx_builder.py`

---

## 1. 목표

사용자가 StepOnePlus `.eds`를 올려서 아래 흐름을 끝까지 쓸 수 있어야 한다.

1. **업로드** — 7개 읽기(Pre-read 1 · 40°C 5 · Post-read 1)가 각각 사이클로 들어온다. 첫 화면은 **Amplification 첫 읽기**(앱 사이클 2)이고, 세션을 다시 열어도 같다. 사이클 표시에 실제 PCR 사이클 번호가 함께 보인다(예: "Amplification 1/5 · PCR 36 · 40°C").
2. **플레이트 마커 설정** — 파일에 정의된 마커 6개(QPrism1, SNP Assay 1–5, 각 16웰)가 자동으로 잡히고, 대립유전자 이름(QPrism1: FAM=WT, VIC=MT)도 함께 들어온다. 사용자가 마커·웰·대립유전자 이름을 고칠 수 있다.
3. **마커별 분석 결과** — 마커를 고르면 그 마커의 웰만 scatter·판정·결과표에 나온다. 판정은 대립유전자 이름으로 읽힌다(예: WT/WT, WT/MT, MT/MT).
4. **결과 출력** — PDF, scatter 이미지, PowerPoint, Excel/CSV에서 **마커별 scatter와 판정 결과**가 대립유전자 이름과 함께 바로 읽힌다. 마커 하나만 골라 내보낼 수 있다.

한 화면에 한 사이클씩 보는 현재 방식(구간 버튼 + 슬라이더)은 유지한다. 7개 읽기 비교 뷰는 만들지 않는다.

---

## 2. 현황 (main 기준 조사, 2026-10-02)

### 2.1 파서
- `.eds`는 `eds_raw.parse_eds`가 처리하며 `multicomponentdata.xml`(QuantStudio)만 읽는다. StepOne 파일은 `multicomponent_data.txt`라서 **업로드가 실패한다**(실행 확인). 실제 파일은 ZIP 보안 검사는 통과한다.
- `parse_eds` 전체를 검증하는 테스트가 없다.

### 2.2 StepOne 파일 구조 (실측)
- `multicomponent_data.txt`: CRLF, 탭 구분. 레코드 `WELL CYCLE DYE MSE SIGNAL PUREDYE0` + pure-dye 연속줄 3개. 웰·사이클 요약 `WELL CYCLE MSE`가 **다음 레코드와 한 줄에 붙어** 나온다(9필드). 마지막 요약은 끝 탭을 빼면 3필드.
  - 레코드 2016개 = 96웰 × 7읽기 × 3염료(FAM, ROX, VIC). 신호값은 `f[4]`(`f[3]`은 MSE — 한 칸 밀리면 조용히 틀린 값).
- `tcprotocol.xml`: 1 PRE_READ(수집) / 2 PRE_CYCLING / 3–5 CYCLING(수집 없음, 10+15+10) / 6 CYCLING ×5(40°C 단계만 수집) / 7 POST_READ(수집) → 7읽기. 40°C 읽기는 **PCR 36–40사이클**.
- `experiment.xml`: `InstrumentTypeId=steponeplus`, 플레이트 타입 문자열 없음. `<Markers>`(복수형) 6개, 각각 `Allele1/Allele2`의 `Name`·`Reporter`.
  - QPrism1: Allele1 = **MT / VIC**, Allele2 = **WT / FAM**. 나머지 5개는 기본값 "Allele 1"(VIC) / "Allele 2"(FAM).
  - **StepOne Allele1은 VIC, 앱 allele-1은 FAM 고정**(`genotype_vocab.py`). 이름은 **리포터 염료로 매핑**한다.
  - 마커 이름은 `plate_setup.xml`과 정확히 일치(16웰씩). NTC 없음(전부 UNKNOWN).

### 2.3 장비 계산 방식과 데이터 특성
- StepOne `Allele ΔRn = dye_post/ROX_post − dye_pre/ROX_pre` (결과 xls와 일치).
- ROX post/pre: 최소 0.77 · 중앙값 0.83 · 최대 0.96. 기존 `pre_read` 모드와의 차이는 원점 보정 후 비율 중앙값 0.008, 최대 0.060, 클러스터 뒤바뀜 0웰. → 기존 모드 유지.
- Post-read VIC 음수 16웰(최소 −4973). 원신호 4필터는 모두 양수이며, FAM이 강한 웰에서 스펙트럼 분리가 FAM의 GREEN 누설을 과보정해 생긴다. 30°C에서만 발생. puredye 보정 2014-05-19, 만료 2015-11-17. 값은 그대로 저장한다.

### 2.4 마커 (main)
- `UnifiedData.imported_markers`(이름 → 웰)만 있다. `import_session._build_imported_marker_regions`가 `MarkerRegion`으로 바꾼다.
- `MarkerRegion`: `id, name, wells, ploidy, threshold_config, color, catalog_id`. **대립유전자 이름 필드가 없다.** `MarkerUpdate`(PUT)는 명시 필드 목록이다.
- 저장: `marker_regions` 테이블, `save_marker_regions`/`load_marker_regions`(`db.py:451/479`)가 열 목록을 명시. 스키마 마이그레이션은 버전 블록(`if current < N`, 최신 10).
- 세션 메타데이터(`db.save_session`)는 필드를 골라 `metadata_json`에 저장한다. **새 UnifiedData 필드는 따로 저장·복원해야 한다.**
- 분석: `_run_regions`가 마커별 판정. 비율 원점·NTC는 플레이트 전체. 판정 입력 키(`judgment_key`)는 마커 id·웰·ploidy·threshold만 포함.
- **출력은 분석 시점에 고정된 `context.regions`를 쓴다**(`result_snapshot.py`). 분석 뒤 마커 이름을 바꾸면 화면엔 반영되고 출력엔 반영되지 않는다(현행 결함, 이름 변경에도 해당).
- 판정 문자열(`Allele 1 Homo / Heterozygous / Allele 2 Homo`)은 ASG 연동에서 값으로 쓰인다 → **정규 문자열은 바꾸지 않는다.** 테스트 아닌 파일 15곳이 이 문자열을 그린다.

### 2.5 결과 출력 (main)
- **PDF** `snapshot_pdf.py`(reportlab, 한글 폰트): 메타데이터 → 마커별 scatter → 판정 수 → 결과표(열 화이트리스트 `_column_sections`) → 플레이트 맵(판정 색만, **마커 배치 안 보임**) → Ct 표(사이클 ≥3이면) → 분석 컨텍스트.
- **Scatter 그림**(`charts.render_scatter_png`, matplotlib): 제목 고정 "Allele Discrimination Plot", 축 `FAM (basis)`, 점 크기 고정, 웰 라벨 없음, 범례에 정규 문자열·개수 없음, 범례가 점을 가릴 수 있음, **DejaVu 폰트라 한글이 깨진다.**
- **PNG**: 프론트 `Plotly.toImage`(화면 비율 반영) + 캡션. 현재 화면 차트 1개만.
- **XLSX/CSV**: Marker 열, XLSX Summary에 마커별 scatter. 파일명 `whole-run` 고정.
- **PPTX 없음.** 의존성에도 없음(`python-pptx`는 `lxml`, `XlsxWriter`, `Pillow`, `typing_extensions` 필요; 현재 `requirements.txt`엔 openpyxl·matplotlib·reportlab만).
- 모든 출력은 `capture_result_snapshot`(revision·사이클·ROX·배경 조건 검사)을 거친다. 마커 선택 내보내기는 없다.

---

## 3. 설계

### 3.1 StepOne 파서
1. `app/parsers/eds_common.py`로 공용 함수 이전(`_parse_plate_metadata`, `_parse_protocol`, `_find_file`, `_well_sort_key`, `well_index_to_id`), `eds_raw`에서 재노출. 이전 전에 QuantStudio 골든 테스트로 현행 고정.
2. `app/parsers/stepone_eds.py`
   - 텍스트 파서: 줄 단위, `\r` 제거. 앞이 탭인 줄은 연속줄. `f[2]`가 알파벳(`isalpha`)이면 레코드 `f[0:6]`, 숫자면 요약 `f[0:3]`이고 남은 필드가 6개 이상이면 레코드 `f[3:9]`. 마지막 요약 3·4필드 허용. 연속줄 정확히 3개. 중복·빈 파일·잘림·염료 누락·부분 웰은 줄 번호를 담은 `ValueError`. 줄 수 상한.
   - 읽기 구간: PRE_READ/POST_READ 수집 = 1, CYCLING = 반복 수 × 수집 단계 수, 수집 없는 단계 = 0. PRE_CYCLING·hold·melt 수집은 미지원 오류. 합계 불일치는 오류(순차 대체 없음).
   - 읽기 라벨: 각 사이클의 실제 PCR 사이클 번호·온도를 계산(`read_labels`: 사이클 → `{stage, pcr_cycle, temperature}`).
   - 플레이트: `steponeplus` → 8×12, 그 외 미지원 오류.
3. `parse_eds`: `multicomponentdata.xml`이 없고 `multicomponent_data.txt`가 있으면 StepOne으로 넘긴다. `detector.py` 안내 문구 갱신.
4. **대립유전자 이름**: `experiment.xml` `<Markers>`를 읽어 이름(공백 제거)별 `{fam, allele2}`. 규칙:
   - 리포터 FAM → `fam`, VIC/HEX/JOE/TET → `allele2`. 두 쪽이 같은 리포터이거나 지원 외 리포터면 건너뜀.
   - 양쪽 다 기본값("Allele 1/2")이면 없음. 한쪽만 사용자 이름이면 **양쪽 다 파일 값 그대로** 둔다.
   - `plate_setup.xml`에 없는 마커는 버린다.
5. **UnifiedData 신규 필드**(선택, 기본값이면 기존 동작): `default_cycle`, `has_amplification_curve`, `read_labels`, `imported_marker_alleles`. **모두 세션 `metadata_json`에 저장·복원**한다.
   - `compute_suggested_cycle`은 `default_cycle`이 있으면 그 값을 반환. "추천 사이클로 분석" 버튼(`compute_cycle_suggestion`)은 기존대로 별도 계산 — 첫 화면과 다를 수 있음을 문서화.

### 3.2 마커별 대립유전자 이름 (계약)
- `MarkerRegion.allele_labels: {"fam": str, "allele2": str} | None` — 채널 역할 키. 길이 상한·제어문자 거부·키 고정.
- 저장: 스키마 v11 블록에서 `marker_regions.allele_labels_json` 추가(+ `db_schema.sql`), `save/load_marker_regions` SQL 갱신, `MarkerUpdate`에 필드 추가, 레이아웃 저장/적용·세션 복원 포함.
- 업로드 시 `imported_marker_alleles`로 채움. 카탈로그 연결 시 이름이 비어 있으면 카탈로그 `allele1_base/allele2_base`로 미리 채움.
- **이름은 표시 전용**: 판정 입력 키에 넣지 않으므로 이름 변경은 재분석을 요구하지 않는다.
- **출력은 현재 이름을 쓴다**: `capture_result_snapshot`이 `input_lock` 아래에서 현재 마커 저장소의 이름·대립유전자 이름을 복사해 `ResultSnapshot.marker_labels`에 담는다. 분석 뒤 이름을 고쳐도 출력에 반영된다(기존 마커 이름 결함도 함께 해소) 결과 행의 마커 이름 교체는 `snapshot_rows` 한 곳에서 `marker_id` 키로 한다(모든 출력이 같은 행을 읽음). 마커 삭제·웰 변경은 revision이 바뀌어 기존대로 409.
- 표시 규칙(정규 문자열 불변, 표시층에서만 변환):
  - 2배체: `Allele 1 Homo` → `WT/WT`, `Heterozygous` → `WT/MT`, `Allele 2 Homo` → `MT/MT` (FAM 쪽 이름 먼저). 형식은 D-2(기본값 권장안으로 진행, 상수 하나로 교체 가능).
  - 고배체: `AAAB` + 범례 `A = WT (FAM), B = MT (VIC)`.
  - 이름 없으면 지금 표기. 색은 정규 문자열로 찾은 뒤 표시 이름을 붙인다.
- 단일 진실 원천: 프론트 `lib/genotype.ts`, 백엔드 `snapshot_presentation`에 표시 함수 하나씩.
- 표시 지점 전수(작업 범위):
  - 프론트: `MarkerScatterPlot`, `ScatterPlot`, `MultiMarkerAnalysisPanel`, `ResultsTable`, `WellDetailPanel`, `PlateView`, `PlateLegend`, `StatisticsTab`, `WellTypePopup`, `FluorescenceDataCard`, `AmplificationOverlay`, `BatchTab`, `batch/project-export.ts`, `batch/project-summary.ts`, `KeyboardHelpOverlay`, `lib/chart-semantics.ts`, `lib/scatter-axes.ts`
  - 백엔드: `charts.py`(범례·색), `snapshot_presentation.py`, `snapshot_pdf.py`, `snapshot_xlsx.py`, `routers/export.py`, `routers/qc.py`
- 사이클 표시: `CycleControl`과 출력 캡션에 `read_labels`(PCR 사이클·온도)를 함께 표시.
- 증폭 곡선 패널: StepOne(`has_amplification_curve=False`)은 x축을 읽기 이름(Pre · PCR36…40 · Post)으로 표시. 숨길지는 D-9.

### 3.3 결과 출력
**공통 그림 경로**: PDF·PPTX·PNG 묶음은 모두 `charts.render_scatter_png` 한 경로를 쓴다. 화면 PNG(Plotly)는 "현재 화면 이미지", 백엔드 PNG는 "보고서 이미지"로 메뉴에서 구분한다.

**Scatter 그림 가독성 개선**(`charts.py`)
- 제목: 마커 이름 + 사이클 라벨(예 "QPrism1 · Amplification 1/5 (PCR 36)")
- 축: `FAM · WT (ROX 정규화)` / `VIC · MT (ROX 정규화)`
- 범례: 표시 이름 + 개수(`WT/WT (n=5)`), 그림 밖(아래)으로
- 웰 라벨: 마커가 48웰 이하이면 점 옆에 웰 ID 표시(기본 켬)
- 한글: NanumGothic을 matplotlib에 등록
- 종횡비·축 범위: 화면 설정(4:3 / 1:1)을 출력 조건으로 받는다

**마커 선택 내보내기**: PDF·PPTX·PNG 묶음은 선택 인자 `marker_ids`(검증 후 스냅샷에 적용). CSV/XLSX는 전체 유지(Marker 열로 필터 가능). 조건 불일치 재시도 흐름도 마커 선택을 들고 간다. 파일명에 마커 이름(안전 처리).

**플레이트 맵**: 마커 배치를 보여준다(마커 경계·약칭 + 판정 색). 마커 페이지·슬라이드에는 그 마커 웰을 강조한 작은 맵.

- **PDF**: 마커별 페이지 = 개선된 scatter + 그 마커 판정 수 표 + 강조 맵. 결과표에 `Allele Call` 열(화이트리스트 추가). `has_amplification_curve=False`면 Ct 표 생략(D-3).
- **CSV/XLSX**: `Genotype`(정규, 계약 유지) 옆에 `Allele Call`, 사이클 라벨 열.
- **PPTX(신규)**: `/api/data/{sid}/export/pptx`, 16:9.
  1. 표지: 파일명, 장비, 사이클 라벨, ROX·배경, revision, 분석 시각
  2. 마커별 1장: 개선된 scatter(좌) + 판정 수 표·강조 맵(우)
  3. 플레이트 맵 1장
  4. 결과표: 웰 · 샘플 · 마커 · `Allele Call` · 신뢰도, 슬라이드당 3단 × 16행(48웰), 머리행 반복. 결과표 포함 여부 옵션(기본 포함)
  - 표 글자에 한글 글꼴 이름(`latin`·`ea` 모두) 지정. 글꼴 내장은 불가 — 문서화.
- **PNG 묶음**: `/export/scatter-png.zip`. 항목명 안전 처리(경로 구분자·`..`·제어문자·NUL 제거, 중복 번호, 길이 상한), 고정 타임스탬프, `Content-Disposition`은 RFC 5987.
- **프론트**: Header 내보내기 메뉴에 PPTX, 보고서 PNG 묶음, 마커 선택. `ExportKind`·`exportStored`에 새 종류 추가, ko/en 문구.

---

## 4. 결정 사항

| ID | 항목 | 상태 | 권장 / 결정 |
|---|---|---|---|
| D-1 | 첫 화면 사이클 | **결정됨** (2026-10-02) | StepOne은 Amplification 첫 읽기. 다른 장비 불변 |
| D-2 | 판정 표기 형식 | 미결(비차단) | `WT/WT · WT/MT · MT/MT`로 진행, 상수 교체 가능 |
| D-3 | StepOne PDF Ct 표 | 미결 | 생략 권장(35사이클 뒤 40°C 5읽기로는 Ct 의미 없음) |
| D-4 | 의존성 추가 | 미결 | `python-pptx` + `lxml`·`XlsxWriter`·`Pillow`·`typing_extensions` 버전 고정, 감사·Docker 빌드 통과 조건 |
| D-5 | PNG 묶음 방식 | 미결(비차단) | 백엔드 matplotlib zip으로 진행 |
| D-6 | 마커별 염료 매핑 | 범위 밖 | 이 파일은 모든 마커 FAM/VIC |
| D-7 | 마커별 비율 원점 | 범위 밖 | 알고리즘 변경, 별도 계약 |
| D-8 | 계약 활성화 | 실행 시 | 완료된 feedback 계약 작업서 보관, 본 작업서 승격 |
| D-9 | StepOne 증폭 곡선 패널 | 미결 | 읽기 이름 x축으로 표시 권장(숨기지 않음) |
| D-10 | 마커 선택 내보내기 범위 | 미결 | PDF·PPTX·PNG 묶음만 권장 |

---

## 5. 검증 원칙
- 합성 StepOne `.eds` 생성기로 저장소 안 테스트: CRLF, 끝 탭, 붙은 줄, 음수, ROX 변동 ≈0.83, 마커 6개 2열 배치, 대립유전자 이름(QPrism1 MT/VIC·WT/FAM), 부분 기본값·미사용 마커 변형.
- 실제 파일 검증(`QPRISM_STEPONE_EDS` 있을 때만): A1 Post-read Rn 0.4106 / 0.8811, 첫 화면 사이클 2(재시작 복원 후에도), 마커 6개, QPrism1 이름 MT/WT. 산출물은 저장소 밖.
- 출력물 검사: PDF 텍스트(마커·이름·판정 수·한글), PPTX 슬라이드 수·표·글꼴, zip 항목 수·이름, 분석 뒤 이름 변경 → 출력 반영.
- 사람 눈 확인: 실제 파일 PDF·PPTX·PNG 렌더 스크린샷(저장소 밖).
