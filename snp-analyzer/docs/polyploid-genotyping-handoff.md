# 핸드오프: SNP Analyzer 판정 알고리즘 & 다배체(Polyploid) 지원 계획

작성일: 2026-07-09 · 상태: 현황 파악 완료, 다배체 지원 미착수(설계 제안)
대상 리포: `Q-Prism-SNP-visualizer` (subfolder `snp-analyzer`) · 브랜치 `main`

---

## 0. TL;DR

- `asgdesigner2.ivttools.com/snp-analyze/`의 **유전형 판정(genotyping) 엔진은 이 리포**(`snp-analyzer/app/processing/`)에 있다. 설계(design) 툴인 `asg-saas_v2`와는 **별개 서비스**이며, launch-token 핸드오프로 연동된다.
- 현재 엔진은 **철저히 이배체(diploid)·2-allele 전용**이다. 판정 클래스는 3종(Allele 1 Homo / Heterozygous / Allele 2 Homo) + NTC/컨트롤뿐.
- 판정의 본질은 2D 산점도(`norm_fam` vs `norm_allele2`)에서 각 well의 **fam-fraction 비율**(=각도)로 유전형을 나누는 것. 이배체는 비율 ≈ 1.0 / 0.5 / 0.0 세 지점에 모인다.
- 다배체 지원의 수학적 핵심: **동일한 fam-fraction 축에서 클러스터가 P+1개**(배수성 P)로 늘고, 라벨 경계가 `i/P`(i=0..P)로 세분될 뿐이다. 하지만 **비율↔dosage 매핑이 비선형**이고 클러스터 간격이 좁아져(사배체 = 0.25 간격) 현재의 silhouette + 분리 게이트 로직은 그대로 못 쓴다.
- 어휘(genotype 문자열)는 **공유 레지스트리 없이 백엔드/프론트 ~15곳에 매직 스트링으로 중복**돼 있고, 이배체 가정(3-클래스)은 최소 5곳에 독립적으로 하드코딩돼 있다. → 다배체의 첫 구조 작업은 **어휘 중앙화 + ploidy 파라미터 배관**이다.

---

## 1. 시스템 구성 (두 서비스, launch 핸드오프)

```
[asg-saas_v2 / Django]  설계(design)  ──launch token──▶  [Q-Prism-SNP-visualizer / FastAPI]  판정(genotyping)
  designer/, asg_designer/                                  snp-analyzer/app/
  /design/                                                  /snp-analyze/  (nginx → snp-analyzer:8000)
  snp_analysis 앱 = 핸드오프+결과저장 계층                      app/processing/ = 실제 판정 알고리즘  ← 이 문서의 대상
```

- 진입: ASG가 1회용 launch token 발급 → `#token=` fragment로 이 서비스로 redirect.
- 검증: 이 서비스가 `POST {ASG}/api/snp-analysis/launch/validate/`로 토큰 교환(server-to-server, `X-ASG-SNP-Service-Secret`).
- 저장: 분석 후 `POST {ASG}/api/snp-analysis/runs/`로 결과 반송 (`app/asg_client.py:143`, `app/asg_result.py`).
- 컨테이너 주의: 프로덕션은 `asg-saas_v2` 스택이 빌드한 `snp-analyzer:8000`. 로컬에 이 리포 자체 compose로 띄운 `0.0.0.0:8002->8000` 컨테이너가 **별도로** 있으니 혼동 금지.

---

## 2. 현재 판정 알고리즘 (상세)

### 2.1 파이프라인 단계

| 단계 | 위치 | 하는 일 |
|---|---|---|
| 1. Upload/Parse | `app/routers/upload.py:61`, `app/parsers/` | 기기 파일(QuantStudio `.eds`, CFX `.pcrd` 등) 파싱 → `UnifiedData`(well×cycle의 `fam, allele2, rox`) |
| 2. Normalize | `app/processing/normalize.py` | ROX(passive reference)로 나눠 `norm_fam, norm_allele2` 산출 (scale-invariant) |
| 3. Cluster/Genotype | `app/routers/clustering.py:42` → `app/processing/clustering.py` | 유전형 판정(핵심) |
| 4. Serve views | `app/routers/data.py` | scatter/plate/amplification/ct에 `auto_cluster/manual_type/confidence` 부착 |
| 5. Stats/QC/Export/ASG-save | `statistics/qc/export/asg` 라우터 | 집계·품질·내보내기·ASG 반송 |

### 2.2 핵심 알고리즘 — `cluster_auto` (`app/processing/clustering.py:47`)

판정 feature는 **magnitude가 아니라 fam-fraction 비율** `r = norm_fam / (norm_fam + norm_allele2)` (= 2D 산점도에서의 각도). ROX 농도가 kit마다 달라 절대값은 못 쓰기 때문에 모든 판단이 scale-invariant.

1. **NTC**: 총신호 `total = norm_fam + norm_allele2`가 **플레이트 median total의 20%**(`_NTC_SIGNAL_FRAC=0.2`) 미만이면 NTC. (절대 임계 없음, 상대값)
2. **KMeans**: 나머지 signal well을 `(fam, allele2)` 공간에서 **k=2 또는 3**을 silhouette로 선택 (`clustering.py:137`). 빈 클러스터 해는 기각.
3. **분리 게이트**: 클러스터 간 최소중심거리 `min_inter`가 `_SEP_FACTOR(2.0) × pooled_spread` 미만이면 "노이즈를 가짜 유전형으로 쪼갠 것"으로 보고 **monomorphic으로 붕괴** → well별 절대비율 `_label_by_ratio`로 폴백.
4. **라벨링**: 각 클러스터 중심의 비율로 `_label_by_ratio` (`≥0.65 Allele1Homo / ≤0.35 Allele2Homo / 그 사이 Het`). 진짜 3-클러스터이고 양 끝이 두 homozygote면 가운데를 Het로 강제(`spans_both`).
5. **Confidence & no-call**: 비율(각도) 공간에서 유전형별 중심을 만들고, 각 well을 가장 가까운 중심에 배정. `frac = nearest/second`가 `_AMBIG_RATIO(0.8)` 초과면 **Undetermined**. confidence = `1 - frac`. (저신호 het을 magnitude로 벌하지 않음 — 각도만 본다.)

보조 판정기:
- `cluster_threshold` (`clustering.py:25`): well별 비율을 `ThresholdConfig`(0.4/0.6)로 직접 컷. 데이터 비의존.
- `cluster_kmeans` (`clustering.py:253`): k=4 고정 + `_label_clusters`(0.4/0.6 컷).

### 2.3 유전형 집계 — `count_genotypes` (`app/processing/genotype.py:25`)

```python
GENOTYPED_TYPES = {"Allele 1 Homo", "Allele 2 Homo", "Heterozygous"}
EXCLUDED_TYPES  = {"NTC", "Unknown", "Positive Control", "Undetermined"}
# → {"AA","BB","AB","excluded"} 3+1 버킷으로 축약
```

수동 오버라이드는 `get_effective_types`로 auto 위에 덮어씀(manual > auto).

---

## 3. 왜 이배체 전용인가 (하드코딩된 이배체 가정 목록)

다배체로 가려면 아래 각 지점의 "3-클래스" 전제를 깨야 한다.

| # | 위치 | 이배체 전제 |
|---|---|---|
| 1 | `app/models.py:113` `WellType` enum | 유전형 클래스가 `ALLELE1_HOMO/HETEROZYGOUS/ALLELE2_HOMO` 3종뿐 (어휘의 단일 출처) |
| 2 | `app/processing/clustering.py:137` | `k in (2,3)` — 기대 클러스터 수가 2~3로 고정 |
| 3 | `app/processing/clustering.py:242` `_label_by_ratio` | 비율 컷 `0.65/0.35` (3구간) |
| 4 | `app/processing/clustering.py:277` `_label_clusters` | 비율 컷 `0.6/0.4` (3구간) |
| 5 | `app/models.py:131` `ThresholdConfig` | `allele1_ratio_max=0.4, allele2_ratio_min=0.6` (3구간) |
| 6 | `app/processing/genotype.py:20-38` | `count_genotypes`가 AA/AB/BB 3버킷 하드코딩 (**가장 많이 재사용되는 축약기**) |
| 7 | `app/processing/statistics.py` | allele freq(p/q) + 1-df HWE = biallelic diploid 집단유전학 |
| 8 | `app/asg_result.py:71-98` | 교차서비스 계약: `schema_version:1`, `summary.genotype_counts.{AA,AB,BB}`, `allele_frequency`, `hwe`, well별 `effective_type` |
| 9 | 중복 폴백들 | `app/routers/qc.py:71`, `app/routers/export.py:47`, `frontend/.../WellDetailPanel.tsx:164` — 이배체 비율 로직 독립 복사본 |
| 10 | 프론트/리포트 어휘·색 | `frontend/src/lib/constants.ts:3`, `types/api.ts:238`, `WellTypePopup.tsx:22`, `ScatterPlot.tsx:95`, `ResultsTable.tsx:11`, `StatisticsTab.tsx:69`, `use-keyboard-shortcuts.ts:77`, `AmplificationOverlay.tsx:12`, `app/reporting/charts.py:13`, `app/reporting/pdf_builder.py:94`, `locales/{en,ko}.ts` |

**DB는 스키마 변경 불필요**: `manual_welltypes.welltype`와 `clustering_results.labels_json`은 CHECK 없는 free string이라 새 카테고리 문자열을 그대로 저장 가능(`app/db_schema.sql:44,54`). ploidy 컬럼을 추가할 때만 마이그레이션 필요.

**참고 — assay registry는 다배체가 아님**: `app/import_models.py:20`의 `WT_MT / WT_MT1_MT2 / WT_MT1_MT2_MT3`은 **채널(dye) 다중화** 개념(import 매핑용)이지 allele dosage/ploidy가 아니다. 유전형 어휘·클러스터링으로 흐르지 않는다.

---

## 4. 다배체(Polyploid) 지원 설계

### 4.1 수학적 모델

KASP endpoint에서 유전형은 fam-fraction 비율 `r`로 결정된다. 배수성 P에서 **dosage 클래스는 P+1개**, 이상적 비율은 `r = i/P`:

| 배수성 | 클래스 수 | 이상적 비율(allele A dosage 기준) |
|---|---|---|
| Diploid (P=2) | 3 | 1.0(AA), 0.5(AB), 0.0(BB) — **현행** |
| Triploid (P=3) | 4 | 1.0, 0.67, 0.33, 0.0 |
| Tetraploid (P=4) | 5 | 1.0(AAAA), 0.75(AAAB), 0.5(AABB), 0.25(ABBB), 0.0(BBBB) |
| Hexaploid (P=6) | 7 | 1.0 … 0/6 |

즉 **feature 축(fam-fraction)은 동일**하고, 클러스터 개수와 라벨 경계만 P로 매개변수화된다.

### 4.2 ⚠️ 반드시 문서화할 도메인 caveat (naive 구현 금지)

1. **비율↔dosage 비선형성**: 실제 형광 비율은 dosage에 선형 비례하지 않는다(신호 압축·allele amplification bias). 헤테로 클래스들이 `i/P` 등간격에서 벗어나 몰린다. → 등간격 컷(`i/P`)은 **1차 근사일 뿐**. 실전은 per-assay 보정 또는 데이터 기반 클러스터 위치 추정이 필요. (참고 도구: fitTetra, ClusterCall, SuperMASSA, polyRAD — 대부분 mixture model 기반.)
2. **클러스터 근접**: 사배체는 0.25 간격 5클러스터 → 인접 클러스터 silhouette이 낮아 **현행 `k∈{2,3}` + `_SEP_FACTOR=2.0` 분리 게이트가 다 붕괴**시킨다. 판정 전략 자체를 교체해야 함(§4.3-2).
3. **endpoint KASP의 한계**: 고배수성 dosage 콜링은 데이터 품질(replicate, 신호 대비)이 이배체보다 훨씬 좋아야 하고, 자산에 따라 simplex(있음/없음) 수준까지만 신뢰 가능할 수 있다. UI에서 신뢰도/미결정을 정직하게 노출할 것.
4. **혼합 배수성**: 한 플레이트에 배수성이 섞일 수 있는가? 초기엔 **플레이트/세션 단위 단일 ploidy** 가정 권장.

### 4.3 seam별 변경 계획 (core → 바깥)

1. **어휘 중앙화 + ploidy 파라미터 (선행 필수)**
   - `WellType` enum(`models.py:113`)의 유전형 3종을 **ploidy에서 생성**하는 레지스트리로 대체하거나 확장. dosage 클래스 표기 규약 확정(§4.4).
   - `count_genotypes`/`_label_by_ratio` 등이 참조할 **단일 vocabulary source** 신설(예: `app/processing/genotype_vocab.py`).
   - `ploidy`를 `ClusteringRequest`(`models.py:137`) 또는 세션 metadata(`sessions.metadata_json`)로 배관. 기본값 2(이배체) — **회귀 방지**.

2. **클러스터링 재작성 (`clustering.py`)**
   - 기대 클러스터 수 = `ploidy+1`. silhouette 자동선택 대신 **기대 비율 위치(i/P)로 초기화한 1D 비율 mixture(GMM 등) 또는 constrained KMeans**로 교체.
   - `_SEP_FACTOR` 분리 게이트를 ploidy-aware하게(인접 dosage 간 기대 간격 `1/P` 기준). monomorphic 폴백 로직 유지하되 P 반영.
   - 라벨 경계를 `i/P`의 중점(옵션: 보정 테이블)으로. confidence/Undetermined 로직은 비율 공간이라 **그대로 재사용 가능**.

3. **집계·통계**
   - `count_genotypes`를 dosage 버킷 P+1개로 일반화(`genotype.py`).
   - `statistics.py`의 allele freq/HWE를 polysomic 모델로 교체하거나, 미지원 배수성에선 통계 비활성.
   - 중복 폴백 3곳(`qc.py:71`, `export.py:47`, `WellDetailPanel.tsx:164`)을 중앙 vocabulary/labeler로 수렴.

4. **교차서비스 계약 (`asg_result.py` ↔ asg-saas_v2)**
   - `schema_version: 2` 신설(또는 additive `dosage` 블록). `summary.genotype_counts`를 dosage 카운트로 확장하고 `ploidy` 필드 추가.
   - **ASG 측 동반 수정 필요**(parent repo `asg-saas_v2`): `snp_analysis/services.py:save_analysis_result`(schema_version 검사·저장), `snp_analysis/presentation.py`(genotype_counts 확장), 모델/템플릿. → 별도 핸드오프 항목(§5 Phase 4).
   - **부수 확인**: 현재 well 필드는 `effective_type`(`asg_result.py`)인데 ASG `presentation.py:_serialize_well`은 `genotype_call`/`call`을 읽음 → 공유뷰 well 표기 불일치 가능성. 계약 손볼 때 함께 정합화.

5. **프론트/리포트** (§3 표 #10 목록) — 색/심볼/라벨/약어/단축키/i18n을 P+1 클래스로. `ScatterPlot`은 dosage 클러스터 다색 처리.

### 4.4 미결정 사항 (진행 전 결정 필요)

- **ploidy 출처**: 업로드 시 사용자 입력 vs ASG launch context의 마커/생물종 ploidy vs assay registry. (권장: ASG context가 알면 그걸 default, UI에서 override)
- **dosage 클래스 표기 규약**: `AAAA…BBBB` vs `nulliplex/simplex/duplex/triplex/…` vs `dosage 0..P`. i18n·정렬·색 매핑 일관성 위해 초기에 고정.
- **범위**: 완전 dosage 콜링 vs 우선 simplex(presence/absence)만? endpoint 데이터 한계(§4.2-3) 고려해 MVP 스코프 확정.
- **비선형 보정**: 등간격 `i/P` 근사로 시작할지, per-assay 보정/학습셋 도입할지.
- **ASG 계약 방식**: schema_version bump vs additive block(하위호환).

---

## 5. 권장 구현 순서 (phased)

- **Phase 0 — 배관/중앙화 (무회귀)**: vocabulary 레지스트리 신설, `ploidy` 파라미터를 request/세션에 배관(기본 2). 알고리즘 동작 변화 없음. 중복 이배체 로직 3곳을 중앙으로 수렴.
- **Phase 1 — 등간격 dosage 판정**: `clustering.py`를 ploidy-aware로(P+1 클러스터, `i/P` 라벨, 분리 게이트/폴백 갱신). 잘 분리된 케이스에서 dosage 콜 + Undetermined. 단위테스트(합성 tetraploid 산점도).
- **Phase 2 — model-based & 보정**: silhouette/분리게이트를 mixture-model 판정기로 교체, 비선형 비율↔dosage 보정(옵션). 실제 다배체 플레이트로 검증.
- **Phase 3 — 통계/리포트/프론트**: polysomic freq/HWE, PDF·차트·프론트 어휘·색.
- **Phase 4 — 교차서비스 계약**: `schema_version:2` + ASG(`asg-saas_v2`) 수신부 동반 수정, end-to-end(설계→판정→ASG 저장) 검증.

각 Phase는 이배체 default를 유지해 기존 사용자 회귀가 없어야 함.

---

## 6. 파일 레퍼런스 인덱스

**판정 코어**
- `app/processing/clustering.py` — `cluster_auto`(:47), `cluster_threshold`(:25), `cluster_kmeans`(:253), `_label_by_ratio`(:242), `_label_clusters`(:277), 상수 `_NTC_SIGNAL_FRAC/_SEP_FACTOR/_AMBIG_RATIO`(:9-22)
- `app/processing/genotype.py` — `count_genotypes`(:25), `get_effective_types`(:5), `GENOTYPED_TYPES/EXCLUDED_TYPES`(:20)
- `app/processing/normalize.py` — ROX 정규화
- `app/models.py` — `WellType`(:113), `ThresholdConfig`(:131), `ClusteringRequest/Result`(:137/:144), `ScatterPoint/PlateWell`(:70/:83)

**라우터/데이터흐름**
- `app/routers/clustering.py:42` (`POST /api/data/{sid}/cluster`), `:117/:150`(수동 welltype)
- `app/routers/data.py:47/:89` (scatter/plate), `upload.py:61`, `import_api.py`

**영속화**
- `app/db_schema.sql` — `clustering_results`(:44), `manual_welltypes`(:54, free string), `sessions`(:19), `well_cycle_data`(:33)
- `app/db.py` — `save_clustering`(:105), `save_welltype`(:121), 마이그레이션(:35)

**교차서비스 계약**
- `app/asg_result.py:17` `build_result_snapshot`, `:71-121` payload(schema_version/summary/wells)
- `app/asg_client.py:60/:143` (validate/post), `app/asg_session.py` (scope `snp:save_result`)
- ASG 측: `asg-saas_v2/snp_analysis/services.py`(save_analysis_result), `presentation.py`(_serialize_well)

**통계/QC/리포트**
- `app/processing/statistics.py` (allele freq, HWE), `app/processing/quality.py`, `app/processing/ntc_detection.py`
- `app/reporting/charts.py:13`, `app/reporting/pdf_builder.py:94`

**프론트(React, `frontend/src/`)** — 빌드산출물 `app/static-react/`는 편집 대상 아님
- `lib/constants.ts:3`(WELL_TYPE_CONFIG), `types/api.ts:238`, `components/analysis/{ScatterPlot:95, WellTypePopup:22, ResultsTable:11, WellDetailPanel:164, AmplificationOverlay:12}.tsx`, `components/statistics/StatisticsTab.tsx:69`, `hooks/use-keyboard-shortcuts.ts:77`, `locales/{en,ko}.ts`

---
---

# Part II — 다배체 설계 확정 (연구 + 결정, 2026-07-09 갱신)

Part I의 현황 파악 위에, fitPoly/fitTetra·KASP 문헌 조사와 사용자 결정으로 **접근을 확정**했다. 이 섹션이 구현의 기준(source of truth)이다.

## 7. 연구 요약 — fitPoly가 필드 표준

### 7.1 우리 판정 축은 이미 옳다 (연구자 "각도/비율" 발언 검증)
KASP genotyping의 표준 feature는 두 정규화 신호 x,y에서 유도한 **각도 `θ=arctan(y/x)`** 또는 **정규화 비율 `y'=y/(x+y)`** 이고(allele-ratio 상관 ≈0.98), 이는 우리 `clustering.py:48`의 `r=norm_fam/(norm_fam+norm_allele2)` 및 fitPoly의 `y=s_B/(s_A+s_B)`와 **동일**하다. → **feature 축은 바꿀 필요 없다. 축 위의 클래스 분할 알고리즘만 교체한다.**

### 7.2 fitPoly 알고리즘 (임의 배수성; fitTetra 2011 → fitPoly 확장)
1. 비율 `y = s_B/(s_A+s_B)` (우리와 동일)
2. **arcsine-sqrt 변환** `y' = arcsin(√y)` — 비율 0·1 근처 분산 축소를 보정(분산 안정화)
3. 변환축에서 **정규분포 mixture, 컴포넌트 = ploidy+1**. 평균 초기값 ≈ dosage `d/P` (d=0..P)
4. **EM** 적합. 제약: 컴포넌트 간 **분산 σ² 공유**, 평균 단조. 혼합비 π 모드: `p.free`(자유)/`p.HW`/`p.F1`/`p.fixed`
5. **BIC로 모델 선택** — 부재 dosage는 π≈0으로 소거. → **현행 silhouette+분리게이트를 대체**
6. 샘플 = 최대 posterior 컴포넌트 배정 → dosage. **posterior = confidence**, `call.threshold`(≈0.9) 미만 = no-call

**구조 적합성**: fitPoly는 "마커 1개 × 샘플 다수"에 mixture를 적합 → 우리 **플레이트 1장 = assay 1개 × well 다수(≈90)** 와 정확히 일치. 우리 `confidence`/`Undetermined`가 fitPoly `posterior`/`call.threshold`에 1:1 매핑.

### 7.3 도메인 caveat (연구로 보강)
- **비선형성**: fitPoly는 평균을 `d/P`에 고정하지 않고 **EM으로 자유 추정**(초기값만 `d/P`) → 신호 압축/allele bias를 데이터가 흡수. 등간격 하드컷보다 견고.
- **샘플 수**: K=P+1 컴포넌트 추정에 well이 충분해야. 96-well(≈90)은 사배체(5클래스)까지 무난, 6·8배체(7·9클래스)는 marginal → 384-well 권장 + 낮은 신뢰도 정직 노출.
- **endpoint KASP 한계**: 고배수성은 array보다 replicate·신호대비 요구가 높음.

### 7.4 출처
- fitPoly (CRAN, PBR/fitPoly) — 임의 배수성, `saveMarkerModels` wrapper
- Voorrips, Gort, Vosman 2011, *BMC Bioinformatics* 12:172 — fitTetra 원 mixture 모델
- Zych et al. 2019 (fitTetra 2.0), *BMC Bioinformatics* — 다population·BIC·`p.type`
- KASP rare-allele 논문 (θ/y' 파라미터, 삼·사배체 클러스터+ANOVA)
- *The Sweetpotato Genome* (Springer 978-3-031-65003-1) — 6배체 dosage mapping 사례집

## 8. 확정된 설계 결정

| # | 항목 | 결정 |
|---|---|---|
| D1 | 판정 엔진 | **통합 mixture 엔진** — diploid 포함 전 배수성을 fitPoly식 GMM 하나로. (배포 전 P=2가 현행과 일치하는지 검증 → 무회귀) |
| D2 | 혼합비 가정 | **Unrestricted(`p.free`) 기본**. 집단구조 미가정(육종/임의 플레이트 안전). HW는 후순위 옵션. |
| D3 | MVP 범위 | **2x–8x 완전 dosage 지원**. 샘플 부족 시 UI 신뢰도 경고로 완화. |
| D4 | 판정 UX | **auto + 드래그 경계선 하이브리드** (§9) |

## 9. 판정 UX — auto mixture + 드래그 가능한 방사 경계선

**기하학적 근거**: 산점도(x=norm_fam, y=norm_allele2)에서 비율 `r` 고정 = 각도 고정 = **원점에서 뻗는 방사선(radial line) 1개**. `r ⟺ 각도 ⟺ 방사선`은 전단사(`r = 1/(1+tanφ)`). 배수성 P → **경계선 P개 → wedge P+1개** = dosage 클래스.
- 이배체: 선 2개 → zone 3개(FAM축 근처 Allele1 Homo / 가운데 Het / HEX축 근처 Allele2 Homo).
- 사배체: 선 4개 → zone 5개(AAAA…BBBB).

**동작 (dual-mode)**:
1. **Auto**: mixture(§7.2)가 dosage 콜 + confidence 산출, **경계선 P개의 제안 위치**(인접 컴포넌트 posterior 교차점)를 함께 emit.
2. **Manual**: 사용자가 방사선을 드래그 → 두 선 사이 wedge에 들어가는 well이 해당 dosage → **실시간 재라벨·재집계**. 세션에 override로 영속(현행 manual > auto 우선순위 유지).

**구현상 매핑**: 이는 현행 `ThresholdConfig`(고정 컷 2개)를 **P개 가변 컷 배열**로 일반화하는 것. `cluster_threshold`(`clustering.py:25`) 경로가 manual 드래그의 백엔드가 되고, `cluster_auto`가 mixture로 교체되며 제안 컷을 emit. 라벨링은 컷 배열 하나로 통일.

## 10. 확정 구현 계획 (결정 반영)

- **Phase 0 — 배관/중앙화 (무회귀) ✅ 완료 (2026-07-10)**: 아래 §12 참조. `genotype_vocab` 레지스트리 신설, `ploidy` 배관(기본 2). 158 tests green, 이배체 동작 불변. **미착수 이월**: 중복 이배체 ratio-폴백 3곳(`qc.py:76`/`export.py:52`(둘 다 0.6/0.4)·`clustering.py:_label_by_ratio`(0.65/0.35)·`WellDetailPanel.tsx`) 수렴은 상수가 서로 달라 무회귀로 합칠 수 없어 **Phase 1로 이월**(알고리즘 교체 시 함께).
- **Phase 1 — 통합 mixture 엔진 ✅ 완료 (2026-07-10)**: 아래 §13 참조. `cluster_auto`를 ploidy-aware GMM(arcsine-sqrt, K∈1..P+1 BIC, σ공유 tied, `p.free`)+근접병합+DP dosage 라벨로 교체. 164 tests green(diploid 회귀 7 + 합성 다배체 6). **Phase 2로 이관**: 제안 경계컷 emit·`cluster_threshold` P-컷 일반화(드래그 UI 계약과 함께). **Phase 3로 이관**: qc/export ratio-폴백 수렴(`count_genotypes` ploidy 관통과 함께).
- **Phase 2 — 드래그 UX + 프론트 ✅ 완료 (2026-07-10)**: §15 참조. 2a(ploidy 셀렉터 + dosage 어휘/색 일반화) + 2b(드래그 방사 경계선 추가/삭제/토글) + 백엔드(`cluster_threshold` P-컷, `genotype_boundaries` emit). tsc+vite build 통과. 드래그 핵심 로직 Plotly 하니스로 검증(좌표 변환 Plotly와 정확 일치, grab/이동/클램프 정상). 잔여: dblclick 추가삭제·persist 왕복·전체앱 E2E(로그인 차단). ASG context default는 Phase 4.
- **Phase 3 — 통계/리포트 ✅ 완료 (2026-07-10)**: §16 참조. `count_genotypes(_, ploidy)`를 statistics/export/asg에 관통(다배체 excluded 버그 해소), qc/export ratio-폴백을 `genotype_vocab.label_by_ratio`로 수렴 + export 절대컷→상대컷(비평 P2 버그) 수정, freq/HWE는 diploid 가드. 170 tests. **잔여**: polysomic freq/HWE(미지원, 다배체는 null), PDF 리포트(`reporting/charts.py`/`pdf_builder.py`) 어휘 일반화 미착수.
- **Phase 4 — 교차서비스 계약 ✅ 완료 (2026-07-10)**: §18. 발신부 다배체만 `schema_version:2`(+ploidy/offset/dosage counts; diploid는 v1 유지), ASG 수신부 v1/v2 허용 + presentation 일반화 + `effective_type`↔`genotype_call` 정합화 + 템플릿 2개. Q-Prism 6 + ASG 49 tests green(사전 실패 2 제외).

## 11. 남은 미결정 (Phase 0 착수 전 확정 권장)
- **dosage 클래스 표기 규약**: `AAAA…BBBB` vs `nulliplex/simplex/duplex/…` vs `dosage 0..P`. (i18n·정렬·색 매핑 일관성) — vocab 레지스트리 설계 직전 고정 필요.
- **ploidy 출처 default**: ASG launch context가 마커/생물종 ploidy를 제공하는지 실제 확인(제공 시 default, 미제공 시 2x). — Phase 2 셀렉터 전 확인.
- **arcsine-sqrt 채택**: fitPoly 충실히 따를지(권장) 또는 원비율 r 직접 사용할지 — Phase 1 착수 시 확정.

*(해결됨: 판정엔진=통합 mixture, segregation=p.free, 범위=2x–8x, UX=드래그 방사선 — §8. dosage 표기: 내부 정수 dosage 0..P canonical + 표시 라벨(2x=레거시 문자열, 3x+=allele-count 문자열 예 "AAAB") — §12에서 구현됨. arcsine-sqrt: 채택 확정. ploidy default 출처: ASG context는 현재 미제공 → 기본 2x+사용자선택, ASG-context default는 Phase 4.)*

---

## 12. Phase 0 구현 결과 (2026-07-10)

무회귀 배관 완료. 판정 알고리즘은 **아직 ploidy를 소비하지 않음**(Phase 1 대상) — 순수 배관/어휘 중앙화.

**신규**
- `app/processing/genotype_vocab.py` — 어휘 단일 출처. canonical = 정수 dosage 0..P(= allele-1/FAM copy 수, 높을수록 fam-fraction↑). `genotype_labels/genotype_label/dosage_of_label/genotyped_types` (P=2는 레거시 문자열 그대로, 3x+는 "AAAA…BBBB"). `default_ratio_cuts`((d+0.5)/P 등간격, **1차 근사** — Phase 1 mixture가 대체), `dosage_by_ratio/label_by_ratio`, `validate_ploidy`(2..8).
- `GET/POST /api/data/{sid}/ploidy` (`routers/clustering.py`) — 세션 ploidy 조회/설정(재클러스터 안 함).
- `tests/test_genotype_vocab.py` — 어휘 + count_genotypes(이배체 계약 불변 + 사배체 dosage-keyed) + ploidy DB 왕복 영속. 11 tests.

**변경**
- `models.py`: `UnifiedData.ploidy:int=2`, `ClusteringRequest.ploidy:int|None=None`(None=세션값 사용).
- `processing/genotype.py`: `count_genotypes(effective, ploidy=2)` — **P=2는 기존 {AA,AB,BB,excluded} 완전 보존**, P>2는 dosage 라벨 키. `GENOTYPED_TYPES`는 vocab에서 파생(값 동일).
- `db.py`: `save_session`/`load_all_sessions`가 `metadata_json.ploidy` 저장·복원(기본 2). `set_session_ploidy()` 헬퍼(metadata 병합, 데이터 재기록 없음).
- `routers/clustering.py`: `run_clustering`이 `req.ploidy`를 세션에 반영·영속(알고리즘 미소비).

**검증**: 158 tests green(기존 147 + 신규 11). `count_genotypes()` 기본 출력 = `{AA,AB,BB,excluded}` 불변 확인.

**다음(Phase 1) 진입점**: `clustering.py:cluster_auto`를 `unified.ploidy`(라우터에서 인자로 전달) 소비하도록 교체 — arcsine-sqrt 변환 + K=P+1 GMM(σ공유, `p.free`, BIC 축소) + 제안 경계컷 P개 emit. `cluster_threshold`를 P-컷 배열로 일반화하고 위 3개 ratio-폴백을 `genotype_vocab.label_by_ratio`로 수렴. 합성 tetraploid 단위테스트 + P=2 현행 일치 회귀테스트.

---

## 13. Phase 1 구현 결과 (2026-07-10)

`cluster_auto`(AUTO 알고리즘)를 diploid 전용 휴리스틱 → **ploidy-aware model-based**로 교체. fitPoly/fitTetra 방식(§7.2)을 우리 판정 구조에 이식.

**알고리즘 (`app/processing/clustering.py:cluster_auto(points, ntc_threshold, control_wells, ploidy=2)`)**
1. 컨트롤·NTC 처리 — **기존 그대로**(상대 median 20%).
2. signal well의 `r`을 **arcsine-sqrt 변환** `rt=arcsin(√r)` → 1D `GaussianMixture(covariance_type='tied', n_init=5, random_state=42)`를 **k=1..P+1**로 적합, **BIC 최소** 선택. (tied=σ공유, weights 자유=`p.free`. BIC가 기존 silhouette+분리게이트 대체; k=1=monomorphic.)
3. **근접 클러스터 병합**(`_DOSAGE_MERGE_FRAC=0.5`): 인접 클러스터 간 비율차가 `0.5/P` 미만이면 BIC 과분할로 보고 병합 — DP가 노이즈 분할을 가짜 dosage로 승격시키는 것 방지 + monomorphic 안정성 강화.
4. **DP dosage 배정**(`_assign_dosages`): 클러스터를 비율 오름차순 정렬 후 이상값 `d/P`에 대한 **단조증가 최적 배정**(rank 보존 → 스큐된 homozygote가 이웃과 순서 뒤바뀌지 않음, k=P+1이면 전 dosage 강제). `genotype_label(d, ploidy)`로 라벨.
5. **confidence/Undetermined — §14에서 개정됨**: 초기엔 비율공간 margin(`_AMBIG_RATIO`)이었으나, 3-AI 비평 후 **arcsine 공간 GMM posterior + SD-거리 outlier no-call**로 교체(§14 항목 1).
- `<4 signal wells` 폴백은 `genotype_vocab.label_by_ratio(r, ploidy)`로 수렴(1/3 폴백 처리; qc/export는 Phase 3).
- 미사용된 `_SEP_FACTOR` 제거.

**변경**: `routers/clustering.py`가 `cluster_auto(..., ploidy=unified.ploidy)` 전달.

**테스트**: `tests/test_cluster_auto.py` 7개 **전부 그대로 통과**(P=2 무회귀: 스큐된 het/GAP undetermined/monomorphic/부분스펙트럼). 신규 `tests/test_cluster_auto_polyploid.py` 6개(전 tetraploid 5클래스/부분스펙트럼 rank/monomorphic/NTC/ploidy검증/hexaploid). **총 164 green**. 수동 확인: P=5 6클래스 완전 분해.

**이월**: 제안 경계컷 emit·`cluster_threshold` P-컷 일반화 → Phase 2(드래그 UI 계약과 함께). `count_genotypes` ploidy 관통 + qc/export 폴백 수렴 → Phase 3.

**주의(다배체 미완성)**: 판정 엔진은 P를 소비하지만, **집계/통계/내보내기/ASG는 아직 diploid**. `count_genotypes(effective_types)`가 ploidy 인자 없이 호출되어(export.py:163/asg_result.py:45/statistics.py:26) 다배체 세션은 dosage 라벨이 전부 `excluded`로 집계됨 → Phase 3에서 수정.

---

## 14. 하드코딩 비율 3-AI 비평 & 개선 (2026-07-10)

Claude·Fable·Codex 3개 모델로 하드코딩 비율 상수를 교차 비평. 세 모델이 아래에 **만장일치 합의**:

**합의 결함 (심각도순)**
- **P0 — `d/P` 선형-dosage 가정**(`default_ratio_cuts`, `_assign_dosages`): KASP endpoint 형광비는 이항 count가 아니라 비선형(dye 밝기·allele별 증폭효율·plateau 압축). 클러스터가 `d/P`에서 벗어나며 고배수성일수록 치명(Codex: α-bias로 4/8=0.5→0.58, 8배체 경계 0.5625 넘어 거짓 5/8). GMM이 자유 적합해도 결국 `d/P` 최근접 스냅으로 선형 가정 재유입.
- **P1 — `_AMBIG_RATIO=0.8`**: GMM posterior를 버리고 비율-margin 재계산. ploidy-blind(8배체 애매구간 ~0.014 비율단위). → **posterior 기반으로**.
- **P2 — 중복 `0.6/0.4` 폴백**(`qc.py`·`export.py`·`ThresholdConfig`·프론트): 단일출처 우회, P>2에서 전부 Het 붕괴, 대칭컷이 dye bias 무시. + export의 **절대 `_UNDETERMINED_THRESHOLD=0.1`** vs qc의 상대컷 = scale-invariance 위반 버그.
- **P3 — `_NTC_SIGNAL_FRAC=0.2`**: median 안정성 가정, 실패/약신호 플레이트서 붕괴 → 컨트롤/background 모델.
- **P4 — `_DOSAGE_MERGE_FRAC=0.5`**: 이상간격 기반 하드병합이 비선형 압축으로 가까워진 **진짜** 인접 dosage를 지울 위험 → 증거기반(posterior 겹침/pooled SD)으로.

**모델별 고유**: Fable=arcsine-fit공간 vs raw-결정공간 불일치, `confidence=1-frac`가 확률 아닌데 확률로 export, tied 공분산 등분산 가정·ICL>BIC. Codex=arcsine-sqrt 자체가 이항용(endpoint는 비이항)이란 의문, 보정모델 `r=offset+scale·αx/(αx+1−x)`, 고배수성은 정확 dosage 대신 "resolved group" 보고, 검증 테스트 α=1.3–1.6. **이견**: arcsine 변환 정당성(Fable OK/Codex 의심), `_DOSAGE_MERGE_FRAC`(Claude 안전강화 vs Fable·Codex 위험).

**반영: 항목 1 (지금 완료)** — `cluster_auto` step 4를 **arcsine 공간 GMM posterior + SD-거리 outlier no-call**로 교체:
- 최종 dosage 클러스터별 Gaussian(평균 arcsine, pooled tied SD, weight=크기) 재구성 → 각 well을 max-posterior 클래스에 배정, **confidence = 그 posterior**(진짜 확률).
- no-call = (best posterior < `_CALL_MIN_POSTERIOR=0.9`) OR (모든 클래스 평균에서 `_OUTLIER_SD=4.0` pooled-SD 초과 = outlier). 둘 다 데이터 spread·ploidy에 스케일.
- `_AMBIG_RATIO` 제거. Fable의 "공간 불일치" 중 confidence 부분 해소(arcsine 공간에서 평가). 164 tests green(GAP=outlier→Undetermined, 중심 well posterior≈1, LOWHET 유지).

**이월 (Phase 2b/3)**: 항목 2 경계·중심 mixture-derived + `d/P`는 seed만 / 항목 3 merge·DP도 arcsine 공간 일관 / 항목 4 폴백 4종 `genotype_vocab` 수렴 + export 상대컷 / 항목 5 신뢰-배수성 상한·"resolved group" / 항목 6 per-assay 보정 + α-bias 합성 회귀테스트. (드래그 경계가 mixture-derived로 가는 Phase 2b에서 항목 2와 자연 통합)

---

## 15. Phase 2 프론트엔드 구현 결과 (2026-07-10)

**2a — ploidy 선택 + dosage 어휘/색 일반화**
- `frontend/src/lib/genotype.ts`(신규): 백엔드 `genotype_vocab` 미러. `genotypeLabels/genotypeLabel/dosageOfLabel/genotypeShortLabel`(P=2 레거시, 3x+ "AAAB"), diverging 팔레트 `genotypeColor`(dosage0=red/mid=green/top=blue → P=2 레거시색 정확 재현), `wellInfo`(dosage/컨트롤/미배정 통합 해석), `genotypeClasses(ploidy)`, `defaultRatioCuts/dosageByRatio/labelByRatio`(클라 재라벨).
- `settings-store`: `ploidy`(영속), `showBoundaryLines`. `types/api.ts`: ClusteringRequest.ploidy, ClusteringResult.ploidy/boundaries, ThresholdConfig.boundaries. `data-store`: `boundaries`.
- `AnalysisTab`: 분석바에 **ploidy 셀렉터(2x–8x, 변경 시 재분석)** + 결과 boundaries 저장.
- ScatterPlot/ResultsTable/PlateView/AmplificationOverlay/WellTypePopup/StatisticsTab/WellDetailPanel: 색·라벨·범례·수동배정목록·분포표를 `genotypeClasses/wellInfo` 기반으로. 다배체에선 biallelic freq/HWE 패널 숨김. locale ploidy 키.
- **이월(폴리시)**: use-keyboard-shortcuts/KeyboardHelpOverlay 키 4/5/6(회귀위험+6클래스 초과 단일키 한계).

**2b — 드래그 방사 경계선**
- 기하: 원점에서 방향 `(r, 1−r)` 방사선 = 비율 r 등고선. **선 개수 = ploidy**(P 선 → P+1 wedge). 표시 조건 = `showManualTypes && showBoundaryLines`(매뉴얼 활성 시에만).
- ScatterPlot(Plotly): `layout.shapes`로 방사선 P개(데이터 extent까지, autorange 왜곡 방지), `dragmode=false`(편집 중). 네이티브 포인터 핸들러 — 커서→비율 변환(축 `_offset/_length/range` 수동), **드래그=최근접 선 이동**(이웃 사이 클램프), **더블클릭: 선 위=삭제(ploidy−1)/빈 곳=추가(ploidy+1)**, 2..8 제한. 드래그 중 wedge 실시간 재라벨(`labelByRatio(r, 선개수, cuts)`). commit 시 `setBoundaries`+`setPloidy(선개수)`+threshold 클러스터링 persist(→ welltypes-changed 리페치).
- `AnalysisTab`에 "📏 경계선" 토글(매뉴얼 비활성 시 disabled). `cluster_threshold`가 boundaries 소비(Phase 2b 백엔드, 166 tests).

**검증 상태**: 백엔드 166 tests green. 프론트 `tsc -b` + `vite build` 통과. **드래그 핵심 로직 = 실 Plotly 하니스로 검증됨(Playwright, 2026-07-10)**:
- 좌표 변환(`_fullLayout.xaxis._offset/_length/range` 기반 수동 pixel→ratio)이 Plotly 자체 `xaxis.p2l()`와 **완전 일치**(0.23736842… 동일). `_offset/_length` 필드 존재 확인.
- 드래그: 커서 근처 방사선을 정확히 grab(0.625→grabbed 0.622), 커서 비율로 이동(→0.519, 목표 0.52 오차 ~0.001), 이웃 경계 불변, 클램프 정상.
- **미검증(잔여)**: dblclick 추가/삭제(하니스 미포함 — 공유 좌표함수 + splice/push/sort 자명), persist 왕복(threshold 클러스터 재호출→refetch), 전체 앱 E2E(로컬 로그인 자격증명 필요로 차단). dblclick capture ↔ Plotly autoscale 경합은 실앱에서 확인 권장.

---

## 16. Phase 3 구현 결과 (2026-07-10)

집계·통계·내보내기·QC·ASG가 세션 ploidy를 소비하도록 관통. 다배체 세션이 이제 dosage 라벨로 올바르게 집계됨(이전엔 전부 `excluded`).

- `routers/statistics.py`: `count_genotypes(effective, ploidy)`. `genotype_distribution`은 이미 effective 라벨 기반이라 다배체 자동 대응. allele_freq/HWE는 **ploidy==2에서만** 계산(그 외 zero/null → 프론트가 이미 숨김).
- `routers/export.py`: `_determine_genotype`를 ploidy-aware(`label_by_ratio`)로 + **절대 `_UNDETERMINED_THRESHOLD=0.1` → 상대 `_UNDETERMINED_FRAC=0.2×median`**(비평 P2 scale-invariance 버그 수정, `_undetermined_min()` 헬퍼). CSV/XLSX 둘 다 ploidy+상대컷 전달. `count_genotypes(_, ploidy)`. `build_xlsx`는 `genotype_counts.items()`만 순회 → dosage 키 안전.
- `routers/qc.py`: 콜레이트 폴백 `_determine_genotype`를 ploidy-aware(`label_by_ratio`)로 수렴.
- `asg_result.py`: `count_genotypes(_, ploidy)` + payload에 `ploidy` 추가. allele_freq/HWE는 diploid에서만(다배체는 null → **`genotype_counts["AA"]` KeyError 방지**). schema_version은 1 유지(v2 계약은 Phase 4).
- 테스트 `tests/test_polyploid_aggregation.py`(4): export/qc 폴백 ploidy-aware, 상대 undetermined 컷, tetraploid 분포 키. **170 green**.

**이월**: polysomic allele-freq/HWE(다배체 통계 미지원) → Phase 3+ 또는 별도. PDF 리포트(`reporting/charts.py:13`, `pdf_builder.py:94`) dosage 어휘 일반화 미착수. ASG 교차서비스 계약 v2(dosage counts 수신부) → Phase 4.

---

## 17. 관측 dosage 창 + 오프셋 (2026-07-10) — 사배체/고구마 부분-거동 대응

**문제(연구자 제기)**: 고구마는 6x지만 마커에 따라 관측 클래스가 0..6 전체가 아니라 **연속 부분창**만 나타남(예: subgenome 고정으로 3클래스가 dosage `{0,1,2}` 또는 `{4,5,6}`처럼). 그리고 **오프셋(절대 위치)은 fam-fraction만으로 식별 불가**할 때가 많음(극단 r≈0/1에 앵커가 없고 비선형까지 겹치면).

**결정(사용자)**: **관측창 + 오프셋 모델** + **추정+불확실 플래그**.

**모델**: ploidy P는 생물종 배수성(고정). 관측 클래스 K는 별개. **offset**(최저 관측 클래스의 절대 dosage)이 K개 zone을 0..P 사다리 안에 배치. wedge i = 절대 dosage `offset+i` → `genotype_label(offset+i, P)`. 선 개수 = **K−1**(관측 클래스 경계), ploidy와 무관.

**백엔드**:
- `genotype_vocab.dosage_by_ratio/label_by_ratio(..., offset=0)` — dosage = offset + Σ(cuts). 기본 0=무회귀.
- `ThresholdConfig.offset`, `cluster_threshold`가 offset 전달.
- `clustering.genotype_window(points, assignments, ploidy)` (기존 genotype_boundaries 대체) → `{boundaries: K−1 내부컷, offset: min 관측 dosage, offset_uncertain: 극단 앵커 없으면 True}`.
- `ClusteringResult.offset/offset_uncertain`, 라우터가 채움.

**프론트**:
- `genotype.labelByRatio(..., offset)`. data-store `offset`/`offsetUncertain`.
- ScatterPlot: wedge 색/라벨 = `labelByRatio(r, ploidy, cuts, offset)`. **persist는 ploidy=세션 고정**(선개수 아님). 더블클릭 추가/삭제는 **K 변경**(offset 자동 클램프), ploidy 불변.
- AnalysisTab: **오프셋 컨트롤 ◀ N ▶**(`shiftOffset` → threshold 재클러스터, `offset+K−1<=P` 범위) + **불확실 시 ⚠ 배지**. locale `offsetLabel/offsetHint/offsetUncertainHint`.

**Phase 2b 모델 교정**: 이전의 "선 개수=ploidy, 추가=ploidy±1"을 폐기 → "ploidy 고정, 선=K−1, offset로 창 이동". `setPloidy(lineCount)` 제거.

**테스트**: `test_cluster_auto_polyploid.py`에 window 앵커/불확실, label offset, threshold offset 추가. 174 tests green. tsc+vite build 통과. **미검증**: offset 컨트롤/창 드래그의 실앱 E2E(로그인 차단, §15와 동일).

**잔여 caveat**: 오프셋 자동추정은 여전히 `d/P` 근접 기반(비평 P0) — 앵커 없으면 uncertain 플래그로 정직 노출하고 사용자 선언에 의존. per-assay 보정/부모 dosage prior 도입 시 자동해소(향후).

---

## 18. Phase 4 구현 결과 — 교차서비스 계약 (2026-07-10)

두 리포 동반 수정. **diploid는 완전 무변(schema_version 1), 다배체만 v2**로 blast radius 최소화.

**발신부 (`Q-Prism .../app/asg_result.py`)**: `schema_version = 1 if ploidy==2 else 2`. summary에 `ploidy`, `offset` 추가. genotype_counts는 Phase 3에서 이미 dosage-keyed(다배체)/AA-AB-BB(diploid). allele_freq/HWE는 diploid만(다배체 null). wells는 기존대로 `effective_type` 포함.

**수신부 (`asg-saas_v2/snp_analysis/`, 브랜치 feat/polyploid-specificity)**:
- `services.py:save_analysis_result`: `schema_version in (1,2)` 허용, 실제 버전 저장(`int(schema_version)`).
- `presentation.py:serialize_analysis_run`: genotype_counts를 정수화 전체 dict로(+AA/AB/BB 기본값 back-compat), **`genotype_distribution`**(라벨·카운트 순서 리스트, ploidy 무관) + `ploidy` + `schema_version` 노출.
- `presentation.py:_serialize_well`: `effective_type`를 genotype_call 소스로 추가 → **공유뷰 well 유전형이 이전엔 항상 빈값이던 버그 수정**(genotype_call/call만 읽었음).
- 템플릿 `run_history_compact.html`·`shared_result.html`: 하드코딩 AA/AB/BB → `genotype_distribution` 순회 + 다배체 시 `Nx` 배지. diploid 렌더 문자열 동일("AA 2" 등) → 기존 테스트 통과.

**검증**: Q-Prism `test_asg_result_save` 6 green(diploid v1 불변). ASG `test_context` 49 green + **사전 실패 2**(`test_history_detail`/`test_order_detail` — 원본 코드에서도 동일 실패, sqlite 테스트환경 이슈, 제 변경 무관 — stash로 확인). presentation 단위 확인: diploid AA/AB/BB+dist, hexaploid dosage dist+ploidy6, well genotype_call=effective_type.

**주의**: ASG는 별도 리포/브랜치(feat/polyploid-specificity, 무관한 amplicon-outlier WIP 포함). 내 변경 4파일만 커밋(사용자 WIP docs/csv 제외). DB 마이그레이션 없음(ploidy는 summary_json에 실림). ASG 프론트/뷰의 다배체 실렌더 e2e는 미검증(로그인 차단, §15).
