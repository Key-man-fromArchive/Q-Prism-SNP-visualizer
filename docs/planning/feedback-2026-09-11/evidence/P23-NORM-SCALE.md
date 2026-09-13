# P23 — 정규화 적용 여부 웰 단위 일관화, ROX=0 이상치 누락 수정, 척도 혼합의 판정 영향 측정

Contract: feedback/p23, branch `feedback/p23` (main `b2efb9c`에서 분기).

선행 조사: `docs/planning/feedback-2026-09-11/evidence/P22-CALL-LOGIC.md` 발견 2.
이 문서는 그 재현을 독립적으로 다시 확인하고, 고친 내용과 근거, 그리고 척도 혼합이
실제 판정에 미치는 영향을 실측치로 남긴다.

백엔드 기준선(작업 시작 시점): `pytest -q` → **823 passed, 2 subtests passed**
(venv: `/mnt/docker/Q-Prism-SNP-visualizer/worktree/feedback-p0/snp-analyzer/venv/bin/python`).

---

## 1. 재현 — P22의 재현을 다시 실행으로 확인

P22가 보고한 두 사실을 동일한 조건으로 재확인했다 (수정 전 코드로, `git checkout` 롤백 후 재실행):

- **`if p.raw_rox`(`app/processing/ratio_origin.py:107`, 수정 전)는 ROX=0을 falsy로 걸러
  참조-이상치 후보에서 제외한다.** 9개 웰이 ROX=1000(정상), 1개 웰(A10)이 ROX=0인 합성 플레이트에서
  수정 전 `rox_outlier_wells()`는 `set()`을 반환했다 — A10이 계산에 아예 들어가지 않았기 때문이다.
  수정 후에는 `{"A10"}`을 정확히 반환한다.
  (`tests/test_p23_normalization_scale_consistency.py::test_zero_rox_well_is_not_silently_excluded_from_reference_outliers`)

- **네 엔드포인트가 서로 다른 답을 한다.** 4웰 모두 ROX=0인 합성 플레이트를 `/scatter`, `/plate`,
  `/amplification/all`, `POST /cluster`(`/analyze`)에 동일 조건(`use_rox=true`)으로 질의했다.
  수정 전:
  ```
  /scatter          normalization_applied = True   (normalization_applies()만 봄, 웰별 참조값 무시)
  /plate            normalization_applied = True   (위와 동일)
  /amplification/all normalization_applied = True  (위와 동일)
  /analyze (POST /cluster) analysis_context.normalization_applied = False
                    (_normalization_was_applied: "그 사이클에 양의 참조값이 하나라도 있는가"를 추가로 봄)
  ```
  **같은 런, 같은 요청 조건에서 세 엔드포인트는 "정규화됨", 한 엔드포인트는 "정규화 안 됨"이라고
  답했다.** RED 테스트로 고정: `test_all_zero_rox_reports_not_applied_consistently_across_endpoints`
  (수정 전 코드에 대해 4개 assert 모두 실패하는 것을 확인 후 수정 적용, 아래 "RED 확인" 절 참고).

- **한 응답 안에 척도가 섞인다.** A1(ROX=1000, 정상)과 A2(ROX=0)를 한 세션에 넣고 `/scatter`를
  질의하면, 수정 전 응답은 `normalization_applied: true` 하나만 보고하지만 실제 값은:
  ```
  A1: norm_fam = 0.9    (900.0 / 1000.0 — 나뉜 값)
  A2: norm_fam = 900.0  (나뉘지 않은 raw 값 그대로)
  ```
  **~1000배 척도 차이가 "정규화 적용됨" 표시 아래 공존**한다.
  (`test_scatter_reports_normalization_per_well_not_just_per_response` 등)

---

## 2. 고친 내용

### 2.1 웰 단위 정규화 플래그 — `NormalizedPoint.normalized`

`normalize()`(`app/processing/normalize.py:9`)가 실제로 나눴는지(`divided = apply_normalization
and reference_value is not None and reference_value > 0`)를 **읽는 그 시점에** 각 리딩에 기록한다.
이 하나의 불리언이 런 단위(모드/참조채널) 사유와 웰 단위(참조값이 0/음수/없음) 사유를 **이미 전부
반영**하므로, 응답 요약에 별도의 판단 로직을 다시 두지 않고 이 필드를 그대로 읽으면 된다.

`NormalizedPoint`, `ScatterPoint`, `PlateWell`에 `normalized: bool = False`를 추가했다 (기본값이
있어 기존 직렬화/역직렬화 경로를 깨지 않는다). `/amplification/all`의 커브 딕셔너리에는
`cycles`와 나란한 `normalized: list[bool]`을 추가했다 — 한 웰의 참조값이 사이클마다 바뀔 수
있어(예: 사이클별로 다시 읽는 ROX) 웰 하나에 불리언 하나로는 부족하기 때문이다. `AmplificationCurve`
Pydantic 모델(단수 `/amplification` 엔드포인트가 쓰는 것)은 건드리지 않았다 — 이번 조사 범위는
팀장이 지정한 네 엔드포인트(`/analyze`, `/scatter`, `/plate`, `/amplification/all`)이고, 단수
`/amplification`은 애초에 `normalization_applied`조차 보고하지 않는 별도 계약이라 범위 밖으로
남겼다.

### 2.2 응답 단위 요약 — `normalization_summary()`, 네 엔드포인트 공유

`app/processing/normalize.py`에 `normalization_summary(points) -> (applied: bool, mixed: bool)`을
추가했다. 그 응답에 포함된 `NormalizedPoint.normalized` 값들만 보고:
- `applied` = 그중 하나라도 실제로 나뉘었는가 (기존 `/analyze`의 "하나라도 양의 참조값" 정의와
  일치하도록 유지 — 회귀 없음)
- `mixed` = 나뉜 것과 안 나뉜 것이 **섞여** 있는가 (신규)

`/scatter`, `/plate`, `/amplification/all`(`app/routers/data.py`), `/analyze`
(`app/routers/clustering.py`의 `_attach_context`), `/qc`(`app/routers/qc.py`의 `_plate_check`) 다섯
곳 모두 **이 하나의 함수**로 `normalization_applied`/`normalization_mixed`를 계산하도록 바꿨다.
기존에는:
- `data.py`의 세 엔드포인트: `normalization_applies(unified, use_rox=use_rox)` — 런 단위만
- `clustering.py`: `_normalization_was_applied()` — 런 단위 + "그 사이클에 양의 참조값이 하나라도"
- `qc.py`: `_normalization_used()` — `clustering.py`와 같은 식을 별도로 다시 구현

세 갈래 정의가 하나로 합쳐졌고, 모두 이미 계산되어 있던 `NormalizedPoint` 리스트를 그대로
읽는다 — `snapshot.unified.data`를 별도로 다시 훑지 않는다(`clustering.py`는 이 참에
`_snapshot_points`가 `NormalizedPoint` 리스트도 함께 반환하도록 하고, `_attach_context`가 그것을
받도록 시그니처를 바꿨다. 이 시그니처를 직접 호출하는 두 테스트 헬퍼
(`tests/test_a2_region_passthrough.py`)도 4-튜플 언패킹으로 맞춰 갱신했다 — 단언을 약화하지 않고
새 반환값 개수에 맞춘 것뿐이다).

`normalization_applies()`(런 단위, 참조값 자체는 안 보는 기존 함수)는 그대로 남겨뒀다 —
`test_normalization_applies_reports_the_decision_not_the_request`가 그 정의를 그대로 검증하고
있고, 다른 목적(모드가 정규화를 지원하는가)에 여전히 유효하다.

`AnalysisContext`(`/analyze`가 저장하는 provenance)와 `NtcCheck`(`/qc`)에는
`normalization_mixed: bool = False`를 기본값과 함께 추가했다 — 기존에 DB에 저장된 옛 provenance가
이 필드 없이도 역직렬화되어야 하기 때문이다(`test_analysis_context_persistence.py`의
리터럴 payload가 이 필드 없이도 여전히 통과하는 것으로 확인).

### 2.3 `ratio_origin.py:107` — ROX=0을 조용히 빼지 않는다

```python
refs = [(p.well, p.raw_rox) for p in points if p.raw_rox]        # 이전
refs = [(p.well, p.raw_rox) for p in points if p.raw_rox is not None]  # 수정 후
```
0은 "값 없음"이 아니라 "0이라는 값"이고, 플레이트 중앙값 대비 가장 비정상적인 축에 속하는
값이다. 이 필터가 `is not None`이 아니라 truthy 검사였던 탓에 ROX=0 웰은:
- `rox_outlier_wells()`의 이상치 후보 계산에 전혀 들어가지 못했고 (그래서 이상치로도 보고되지
  않았고),
- `_floor_candidates()`(원점 추정용 5퍼센타일 후보)에서도 "이상치가 아니므로" 계속 남아있었다
  — 즉 실제로는 척도가 완전히 다른 raw 값이 정규화-스케일 값들과 나란히 원점 추정에 들어갈 수
  있는 경로가 있었다(2.4절 실측 참고, 이 특정 실험 조건에서는 결과에 영향이 없었지만 원인
  자체는 실재한다).

고친 뒤 5:5로 정상/ROX=0이 섞인 극단 케이스를 직접 확인했다: 중앙값이 두 그룹 사이(500)로
이동하면서 **양쪽 그룹 모두** 이상치로 잡힌다 — 절반이 0을 읽는 런은 "신뢰할 수 있는 참조가
없는 런"이라는 사실을 정직하게 보고하는 것이지, 다수(9:1이었다면 다수)가 조용히 이기는 것이
아니다. (`test_zero_rox_wells_count_toward_the_plate_reference_median`)

---

## 3. 척도 혼합이 실제 판정에 미치는 영향 — 측정치

**판정 로직(`cluster_auto`, `cluster_threshold` 등)은 전혀 바꾸지 않았다.** 아래는 같은 계산에
서로 다른 입력을 넣어 나온 차이를 측정한 것이다. `cluster_auto`는 신호 크기가 아니라
fam-fraction(비율)만 보도록 설계돼 있어(`app/processing/clustering.py:272` 주석: "Genotype is the
fam-fraction (angle), not the signal magnitude") 척도 자체는 비율을 바꾸지 않는다 — 문제는
**원점 보정**(`ratio_origin.py`의 `compute_ratio_origin`/`shift_to_origin`)이다: 원점은 대체로
정규화-스케일(작은 수) 근처에서 추정되므로, 그걸 raw-스케일(수천) 웰에서 빼면 사실상 아무 효과가
없고, 정규화-스케일 웰에서 빼면 비율을 유의미하게 바꾼다. 두 실험으로 이를 직접 측정했다
(스크립트는 일회성 측정용이라 저장소에 커밋하지 않았다; 재현 절차는 아래 각주에 기재).

### 실험 A — ratio_origin.py:107 수정 자체가 판정을 바꾸는가

30웰 합성 플레이트(신호 20웰 rox=1000 정상; 바닥/무신호형 10웰 중 5개는 rox=0, 5개는 rox=1000)에서
**수정 전 이상치 필터(빈 목록)**와 **수정 후 이상치 필터**로 각각 원점을 추정하고 `cluster_auto`를
돌렸다.

```
OLD(버그) 이상치: []                       NEW(수정) 이상치: ['F0','F1','F2','F3','F4']
OLD 원점: fam=4.1 allele2=2.4225           NEW 원점: fam=4.1 allele2=2.41
판정이 달라진 웰: 0 / 30
```
이 특정 구성에서는 **판정에 영향 없음** — raw-스케일 값(수천)이 정규화-스케일 값(1~11)보다
항상 훨씬 크기 때문에, 5퍼센타일(하위) 원점 추정에서 raw 값은 정렬 상단에 몰려 하위 추정치에
영향을 주지 않았다. 실제 임상/실험 데이터에서도 raw RFU가 ROX로 나눈 값보다 항상 훨씬 크므로
이 방향이 일반적일 것으로 본다 — 다만 이는 이 구성에서의 실측이며, 모든 플레이트 구성에서
0이라는 보장은 아니다.

### 실험 B — "척도가 섞인 채로 실제 판정한 것" vs "만약 모든 웰이 일관되게 나뉘었다면"

같은 20+10웰 플레이트에서, 현재(수정된) 코드로 두 시나리오를 비교했다:
- **MIXED**(실제 상황): 바닥형 10웰 중 5개(F0-F4)는 ROX=0 → raw로 남음, 5개(F5-F9)는 ROX=1000 →
  정상 정규화.
- **CONSISTENT**(반사실 비교군): F0-F4도 ROX=1000으로 주어 전부 일관되게 정규화됨 — 즉 "그 웰의
  참조가 0으로 읽히는 결함이 애초에 없었다면"의 대조.

```
MIXED 원점:      fam=4.1 allele2=2.41         (F0-F4는 이상치로 잡혀 원점 추정에서 제외됨)
CONSISTENT 원점: fam=4.0 allele2=2.4

판정이 달라진 웰: 5 / 30  (F0, F1, F2, F3, F4 전부)
  F0: MIXED='Heterozygous'(신뢰도 1.0)  vs  CONSISTENT='Undetermined'(신뢰도 0.99)
  F1~F4: 동일 패턴
F5-F9(같은 "바닥형" 신호를 가졌지만 항상 정상 정규화된 웰)은 두 시나리오 모두 'Undetermined'.
```
**5/30(16.7%) 웰이, MIXED에서는 신뢰도 1.0의 확정 유전형(`Heterozygous`)으로, 일관되게
정규화됐다면 마땅히 그래야 할 `Undetermined`(무신호/판정 보류) 대신 잘못 호출됐다.** F5-F9는
F0-F4와 raw 신호 크기가 사실상 같은데도(둘 다 "바닥" 그룹) ROX 읽힘 여부 하나로 최종 판정이
갈렸다 — `ratio_origin.py`가 문서화하고 있는 "raw endpoint 데이터를 (0,0)에서 측정하면 무신호와
신호를 구분 못 한다"는 바로 그 실패 모드가, 정규화된 나머지 플레이트 사이에서 raw로 남은
소수의 웰에 국한되어 재발한 것이다.

**결론**: 이번 P23 수정(웰 단위 보고 일관화, 이상치 필터 수정)은 이 근본 원인(ROX=0인 웰이
계속 raw로 취급되는 `normalize()`의 기존 동작)을 바꾸지 않았다 — 지시받은 범위가 아니었고,
바꾸려면 사전 승인이 필요하다. 다만 이제는 그 웰이:
- 응답에서 `normalized: false`로 **드러나고**,
- `rox_outlier_wells`/QC에 **참조 이상치로 잡히므로**,
화면이 최소한 "이 웰의 값은 다른 웰과 같은 척도가 아니다"라고 보여줄 수 있는 재료는 갖췄다.
그러나 **`cluster_auto`에 들어가는 값 자체는 여전히 raw다** — 이 실험이 보여주듯, 그 결과로
확신도 1.0의 오탐이 나올 수 있다. 클러스터링 입력에서 이런 웰을 별도 처리(제외/경고/원점 이상
보정)해야 하는지는 **판정 로직 변경**에 해당하므로 이번 작업 범위 밖에 두고, 여기에 실측치로
보고한다.

(재현 절차: `normalize_for_cycle` → `compute_ratio_origin`/`shift_to_origin`
→ `cluster_auto`를 위 두 플레이트 구성에 대해 직접 호출하고 `assignments`를 비교하면 동일한
결과를 얻는다. 정확한 웰 구성은 위 표에 기재된 대로다.)

---

## 4. RED 확인

`tests/test_p23_normalization_scale_consistency.py`의 8개 테스트를 **수정 전 코드**(`git checkout
b2efb9c -- <해당 파일들>`, WIP 커밋으로 작업 보존 후 임시 롤백)에 대해 실행 → **8개 전부 실패**:
```
FAILED test_scatter_reports_normalization_per_well_not_just_per_response
FAILED test_plate_reports_normalization_per_well
FAILED test_amplification_all_reports_normalization_per_well_per_cycle
FAILED test_all_zero_rox_reports_not_applied_consistently_across_endpoints
FAILED test_mixed_rox_cluster_context_reports_the_same_mixed_verdict
FAILED test_zero_rox_well_is_not_silently_excluded_from_reference_outliers
FAILED test_zero_rox_wells_count_toward_the_plate_reference_median
FAILED test_all_normal_rox_plate_is_fully_normalized_and_never_mixed
```
수정 복원 후 **8개 전부 통과**. 회귀 테스트
(`test_all_normal_rox_plate_is_fully_normalized_and_never_mixed`)는 모든 ROX가 정상인 경우
네 엔드포인트가 여전히 `normalization_applied=True, normalization_mixed=False`이고 모든
포인트/웰/커브가 `normalized=True`임을 확인한다 — 기존 동작 보존.

---

## 5. 검증

### 백엔드
- `pytest -q` (전체): **823 passed + 2 subtests passed** (기준선과 동일 — 기존 테스트 회귀 없음),
  신규 `tests/test_p23_normalization_scale_consistency.py` 8개 포함 시 **831 passed + 2 subtests**.
- 변경한 `.py` 파일 `ruff check`: 전부 통과.
- 신규 파일(`tests/test_p23_normalization_scale_consistency.py`)만 `ruff format --check`: 통과
  (최초 실행 시 미포맷 발견 → `ruff format` 적용 후 재확인).

### 프론트엔드
서버가 웰 단위(`normalized`)와 응답 단위(`normalization_mixed`)를 보고하게 된 것에 맞춰, 이미
있는 공용 처리-상태 배지(`OverlayProcessingStatus`, `app/components/analysis/
AmplificationOverlay.tsx` — `AmplificationOverlay.tsx`와 `FluorescenceDataCard.tsx` 둘 다 재사용)에
`normalizationMixed?: boolean` prop을 추가했다. `true`면 배지에 "(일부 웰만 실제로 정규화됨 —
나머지는 참조값이 0이거나 없어 원값 그대로입니다.)"를 덧붙인다(`data-mixed` 속성으로도 노출).
`types/api.ts`에 `NormalizedPoint.normalized`, `ScatterPoint.normalized`, `PlateWell.normalized`,
`AmplificationCurve.normalized`(사이클별 배열), 그리고 네 응답 타입 + `AnalysisContext` +
`QcResponse.ntc_check`에 `normalization_mixed?: boolean`을 추가했다 — 전부 옵셔널이라 기존 타입을
깨지 않는다.

지시받은 대로 다음 파일은 건드리지 않았다: `MultiMarkerAnalysisPanel.tsx`, `CycleControl.tsx`,
`navigation-store.ts`, `WellDetailPanel.tsx`, `ResultsTable.tsx`, `playwright.config.ts`.
`WellDetailPanel.tsx`/`ScatterPlot.tsx`/`MarkerScatterPlot.tsx` 등 `/scatter`·`/plate` 데이터를
소비하는 화면에도 같은 배지를 붙이는 것이 이상적이지만, 그중 하나(`WellDetailPanel.tsx`)는
금지 목록에 있고 나머지는 이번 "최소한으로" 지시 범위를 넘어선다고 판단해 **보류**했다 — 필요시
후속 작업으로 보고한다.

- `npm test -- --run`: **128 files / 946 tests passed** (기준선 128/944 + 신규 2건).
- `npx tsc --noEmit`: 0 errors.
- `npx eslint .`: 0 errors.
- `npm run build`: 성공 (기존에도 있던 청크 크기 경고 외 신규 오류 없음).

---

## 6. 변경 파일

- `snp-analyzer/app/models.py` — `NormalizedPoint.normalized`, `ScatterPoint.normalized`,
  `PlateWell.normalized`, `AnalysisContext.normalization_mixed`
- `snp-analyzer/app/processing/normalize.py` — `normalize()`가 `normalized` 채움,
  `normalization_summary()` 신설
- `snp-analyzer/app/processing/ratio_origin.py` — `rox_outlier_wells`의 `if p.raw_rox` →
  `is not None`
- `snp-analyzer/app/routers/data.py` — `/scatter`, `/plate`, `/amplification/all`이
  `normalization_summary()`를 공유하고 `normalization_mixed` + 웰/커브별 `normalized`를 반환
- `snp-analyzer/app/routers/clustering.py` — `_snapshot_points`/`_attach_context`가
  `NormalizedPoint` 리스트를 공유해 `normalization_summary()`를 씀; `_normalization_was_applied`
  제거
- `snp-analyzer/app/routers/qc.py` — `_plate_check`가 같은 `normalization_summary()`를 씀;
  `_normalization_used` 제거; `NtcCheck.normalization_mixed`
- `snp-analyzer/app/routers/compare.py` — `ScatterPoint` 생성 시 `normalized` 전달(일관성)
- `snp-analyzer/tests/test_a2_region_passthrough.py` — `_snapshot_points`/`_attach_context` 시그니처
  변경에 맞춰 두 호출부 갱신
- `snp-analyzer/tests/test_p23_normalization_scale_consistency.py` — 신규, RED 확인
- `snp-analyzer/frontend/src/types/api.ts` — 웰 단위/응답 단위 필드 타입 추가(옵셔널)
- `snp-analyzer/frontend/src/components/analysis/AmplificationOverlay.tsx` —
  `OverlayProcessingStatus`에 `normalizationMixed` prop
- `snp-analyzer/frontend/src/components/analysis/FluorescenceDataCard.tsx` — 위 prop 배선
- `snp-analyzer/frontend/src/components/analysis/AmplificationOverlay.rawdata.test.tsx` — 신규
  mixed-배지 테스트 2건
- `snp-analyzer/frontend/src/locales/en.ts`, `ko.ts` — `overlayProcessingStatusMixed`
