# 핸드오프: 한 플레이트 내 다중 마커(멀티-assay) 독립 판정

작성일: 2026-07-10 · 상태: 요구사항 확정 + 코드베이스 조사 완료, **구현 미착수**
대상: `Q-Prism-SNP-visualizer/snp-analyzer` · 관련 문서: `polyploid-genotyping-handoff.md`(다배체), 메모리 `pcrd-decryption-key.md`

---

## 0. TL;DR
- **요구사항(사용자, 김태화 연구사 데이터)**: 한 플레이트에 **여러 마커(assay)** 를 함께 돌린다. 예: `qtotal11.1, qswet5.3_repeat2.pcrd`는 열 1–6 = 마커 qSwet5.3, 열 7–12 = 마커 qTotal11.1 (둘 다 고구마 6배체).
- 현재 시스템은 **플레이트 전체를 단일 마커로** 클러스터링 → 두 마커가 섞여 오판정.
- 마커별로 **특성·해석법·ploidy가 다르므로 마커별 독립 판정**이 필요: 각 마커 = 임의 웰 집합(영역), 자체 clustering·ploidy·경계선(boundaries/offset)·통계.
- **그룹은 비정형**: 열/행뿐 아니라 임의 웰 집합, 크기 제각각(17개, 21개 등). → 연속 범위 가정 금지. 기존 **well-group**(임의 집합) 인프라가 토대.

---

## 1. 핵심 설계 방향 (권장)
"**마커 = 영역(region) = 임의 웰 집합 + 자체 판정 파라미터**"로 승격.

각 region이 갖는 것:
- `name` (예: "qSwet5.3"), `wells: list[str]`(임의 집합), `ploidy: int`
- 자체 판정 산출물: assignments(해당 웰만), boundaries/offset/offset_uncertain/low_separation, confidences, genotype_counts

판정 흐름: region마다 그 웰 부분집합으로 **독립 `cluster_auto(ploidy=region.ploidy)`** 실행 → 결과를 웰→라벨로 병합(전체 뷰용) + region별 메타 보관.

---

## 2. 코드베이스 조사 결과 (구현 진입점)

### 2.1 클러스터링 (핵심 변경 지점)
- `app/routers/clustering.py::run_clustering` (`POST /api/data/{sid}/cluster`): **현재 플레이트 전체 1회** 실행, ploidy는 세션 단일값. NTC/Omit 처리, `normalize_for_cycle`, `cluster_auto`/`cluster_threshold`, `genotype_window` 호출 후 `ClusteringResult` 저장(`cluster_store[sid]`, DB `save_clustering`).
- `app/processing/clustering.py`: `cluster_auto(points, ntc_threshold, control_wells, ploidy)`, `cluster_threshold(points, config, ploidy)`, `genotype_window(points, assignments, ploidy)→{boundaries, offset, offset_uncertain, low_separation}`. **모두 이미 임의 point 리스트를 받으므로 부분집합에 그대로 재사용 가능.**
- `app/processing/genotype_vocab.py`: ploidy별 라벨/컷/offset — region마다 다른 ploidy OK.

### 2.2 모델 (`app/models.py`)
- `ClusteringRequest{algorithm, cycle, threshold_config, n_clusters, ploidy}` → **`regions: list[MarkerRegion]|None` 추가 필요**.
- `ThresholdConfig{..., boundaries, offset}`, `ClusteringResult{assignments, confidences, ploidy, boundaries, offset, offset_uncertain, low_separation}` → **region별 결과 배열 필요**(예: `ClusteringResult.regions: list[RegionResult]`, 또는 별도 store).
- 신설 제안: `MarkerRegion{name, wells:list[str], ploidy:int=2, threshold_config?}`, `RegionResult{name, wells, ploidy, counts, boundaries, offset, offset_uncertain, low_separation}`.

### 2.3 기존 well-group 인프라 (재활용 토대)
- `group_store: dict[sid, {group_name: [wells]}]` (in-memory), DB `save_well_groups`/`load_well_groups`, `sessions.metadata_json.well_groups`.
- 엔드포인트: `GET/POST /api/data/{sid}/groups`, `DELETE .../groups/{name}`, `DELETE .../groups`.
- `.pcrd`/`.eds` 파서가 `well_groups` 파싱(`_parse_well_groups`). `UnifiedData.well_groups`.
- **결정 포인트**: region을 well-group 위에 얹을지(그룹=마커), 아니면 별도 `markers` 개념 신설할지. 그룹은 이미 임의 집합·영속·CRUD·프론트 매니저가 있어 **재활용이 유력**. 단 그룹당 `ploidy`/`boundaries` 저장 필드가 없으니 확장 필요.

### 2.4 집계/통계/내보내기/ASG (마커별로 관통 필요)
- `app/processing/genotype.py::count_genotypes(effective, ploidy)`, `app/routers/statistics.py`, `qc.py`, `export.py`, `asg_result.py` — **현재 플레이트 단위**. → region(마커)별 `genotype_counts`·통계로 확장, ASG 계약도 마커 배열(향후 schema bump).
- `asg_result.py`는 이미 `ploidy`/dosage counts 전송(schema_version 2). 마커별이면 `markers: [...]` 배열 필요(schema 3 후보).

### 2.5 프론트 (`frontend/src/`)
- `components/analysis/AnalysisTab.tsx`: ploidy 셀렉터·🎯분석·📏경계선 토글·Dosage 오프셋 컨트롤(전부 **플레이트 단일**). → region 선택기 + region별 파라미터로 확장.
- `stores/data-store.ts`(clusterAssignments/boundaries/offset/lowSeparation), `settings-store.ts`(ploidy). → region별 상태.
- `components/analysis/ScatterPlot.tsx`(드래그 방사 경계선)·`PlateView.tsx`·`ResultsTable.tsx`·`StatisticsTab.tsx`: region 필터링 + region별 색/경계/통계.
- well-group 매니저 컴포넌트(그룹 CRUD UI) 존재 — region 정의 UX 토대. 웰 선택은 PlateView/ScatterPlot의 기존 다중선택 활용 가능.

---

## 3. 권장 구현 순서 (다음 세션)
- **Phase A — 백엔드 코어(무회귀, 실데이터 검증 가능)**: `MarkerRegion`/`RegionResult` 모델, `run_clustering`이 `req.regions` 있으면 region마다 부분집합으로 `cluster_auto` 실행→병합+region 결과 반환. region을 세션 metadata에 영속. `regions` 없으면 현행 동작 그대로(회귀 0). **검증**: `qtotal11.1, qswet5.3_repeat2.pcrd`를 cols1-6/7-12·ploidy6 두 region으로 판정(아래 §4 기대값).
- **Phase B — 집계/통계/export/ASG region 관통**: 마커별 counts/통계, ASG 마커 배열.
- **Phase C — 프론트**: region 매니저(열/행 빠른선택 + 자유 웰선택, region별 ploidy), region별 결과 뷰(산점도 필터·자체 경계선·통계), region 스위처.
- **Phase D — ASG 계약**: 마커별 결과 수신(asg-saas_v2 동반).

---

## 4. 실데이터 기준값 (검증용)
파일: `/mnt/ivt-ngs-run/asg-designer-database/snpanalyze/qtotal11.1, qswet5.3_repeat2.pcrd` (CFX Opus, 96웰, 단일 엔드포인트 read, ROX 있음, ploidy 6).
- **Marker1 qSwet5.3 (cols 1–6)**: 배경차감+ROX정규화 후 ratio 0.15–0.88, 6배체 판정 시 NTC 9 + dosage 5/3/1(AAAAAB 16, AAABBB 21, ABBBBB 2) 근사, offset 불확실.
- **Marker2 qTotal11.1 (cols 7–12)**: ratio 대부분 0.69–0.79, 대부분 단일 dosage + NTC 6, offset 불확실.
- 주의: 두 마커의 **배경(채널 최소)은 플레이트 전체 기준**으로 빼도 클러스터 분리됨(현재 파서 방식). region별로 다시 배경을 잡을지는 검토 여지(마커별 배경이 더 정확할 수 있음).

---

## 5. .pcrd 관련 (이번 세션에 해결된 선행 컨텍스트)
- **복호화**: 리포의 14자 키 obsolete. 올바른 키 = `BioRad.Common.dll` .NET #US 힙의 **43자 문자열**($·# 포함). `dnfile`로 추출→zipfile 대입으로 발견. 프로덕션은 **시크릿 파일**로 배포(`asg-saas_v2/secrets/pcrd-pw.txt` + compose 볼륨 `/app/secrets/pcrd-pw.txt`; env는 특수문자 손상). 상세: 메모리 `pcrd-decryption-key.md`. DLL 위치: `/mnt/ivt-ngs-run/asg-designer-database/snpanalyze/Bio-Rad/CFX/`.
- **엔드포인트 파서 수정(커밋됨, branch `fix/pcrd-endpoint-background`)**: 단일 read `.pcrd`는 `_subtract_baseline`이 reporter를 0으로 만들던 버그 → `_subtract_channel_background`(채널별 플레이트 최소 배경 차감, ROX 보존)로 분기. 실파일 96/96 웰 non-zero 검증. 190 tests.
- 복호화된 XML 구조: `runData/plateReadDataVector/plateRead/PlateRead`, `Hdr/PlateReadDataHeader`(Step/Cycle/ChCount/NumRows/NumCols), `Data/PAr`(세미콜론, **channel-major**: `ch*108*4 + pos*4 + stat`, stat 0=mean). dyeLayer plateName FAM=0/HEX=1/ROX=2. 임시 복호화 XML: 세션 scratchpad `sweetpotato.xml`(휘발).

---

## 6. 미결정 (다음 세션 착수 전)
- region 저장을 **well-group 확장** vs **신설 markers 테이블**. (권장: well-group 확장 — 그룹당 ploidy/boundaries/offset 필드 추가)
- region 이름/자동 매핑: ASG launch context의 marker_id로 자동 명명 가능한가?
- NTC/컨트롤을 region별로 둘지 플레이트 전역으로 둘지.
- 배경 차감을 region별로 재계산할지(마커마다 채널 배경이 다를 수 있음).
- ASG 교차서비스 계약: 마커 배열(schema_version 3?) 형태.
- 혼합 ploidy(마커마다 다른 배수성) UI 표기·통계.
