# P22 — 판정 로직 조사: 무신호 웰 no-call, 정규화 척도 불일치, 화면 간 판정 불일치

Contract: feedback/p22, branch `feedback/p22` (main `008eb7b`에서 분기).
이 문서는 조사 결과이며, `app/processing/`·`app/routers/`의 계산 코드는 변경하지 않았다.
특성화 테스트만 `snp-analyzer/tests/test_p22_no_signal_characterization.py`에 추가했다 (기존 테스트 단언은 수정하지 않음).

백엔드 기준선 재확인: `pytest -q` → **819 passed, 2 subtests passed** (기존 명시 기준선과 일치, venv:
`/mnt/docker/Q-Prism-SNP-visualizer/worktree/feedback-p0/snp-analyzer/venv/bin/python`).

---

## 발견 1 — 신호가 없는 웰에 유전형과 90%(또는 100%) 신뢰도가 부여됨

**판정: 사실. 그리고 보고된 것보다 범위가 더 넓고 더 심각하다.**

### 코드 경로

`cluster_auto`(`app/processing/clustering.py:196`)는:

- `total = fam + allele2`; `ratio = fam/total`이되, `total<=0`인 웰은 `ratio = 0.5`로 대체한다(`:325`).
- NTC 판정은 **그 호출에 들어온 웰들 중 `total > 0`인 웰만으로 계산한 중앙값**(`median_total`,
  `:332-333`)에 대한 상대 비교다: `total < 0.2 * median_total`. **`total > 0`인 웰이 그 호출 안에
  하나도 없으면 `median_total = 0.0`이 되어, `total < 0`은 항상 거짓이다.** 즉 무신호 웰이
  NTC/no-call 판정 대상에서 아예 빠진다.
- 마커 리전 기반 분석(`app/routers/clustering.py:293` `_run_regions`)은 **마커마다 그 마커의 웰
  부분집합만으로 독립적으로 `cluster_auto`를 호출**한다. 따라서 "그 호출에 들어온 모든 웰"이
  "한 마커 리전 전체"가 될 수 있다 — 플레이트 전체가 아니라 특정 어세이 하나가 통째로
  실패했을 때 정확히 이 조건이 된다.

### 실행으로 확인 (합성 입력, `cluster_auto` 직접 호출)

1. **3웰, 전부 (0,0), 다른 웰 없음** (신호 웰 <4 → "small region" 폴백,
   `clustering.py:380-390`):
   ```
   assignments = {'A1': 'Heterozygous', 'A2': 'Heterozygous', 'A3': 'Heterozygous'}
   confidences = {'A1': 0.9, 'A2': 0.9, 'A3': 0.9}
   warnings = ['low_n']
   ```
2. **6웰, 전부 (0,0)** (신호 웰 ≥4 → 혼합모형 분기, `low_n` 분기를 건너뜀):
   ```
   assignments = {W0..W5: 'Heterozygous'}
   confidences = {W0..W5: 1.0}
   warnings = []
   ```
   원인: 동일한 `ratio=0.5` 점들에 대해 BIC가 `K=1`(단일 성분)을 선택하고, 그 한 클래스에
   대한 posterior는 자명하게 1.0이 되어 `_CALL_MIN_POSTERIOR`(0.9) 기준을 통과한다.
   **`low_n` 경고조차 없고, 신뢰도는 0.9가 아니라 1.0(최댓값)이다.** 즉 리전이 작을수록(1-3웰)
   경고라도 붙지만, 리전이 클수록(≥4웰, 흔한 마커 크기) 아무 경고 없이 최대 확신 오판정이 된다.
3. **대조군(같은 3개의 (0,0) 웰 + 실제 신호가 있는 웰 5개, 즉 그 호출에 `total>0`인 웰이 존재)**:
   ```
   A1/A2/A3: assignment='NTC', confidence=1.0
   ```
   이 경우는 `median_total>0`이 되어 상대-NTC 감지기가 정상 작동한다(gap_ratio=inf → 명확한
   격차 → NTC 라벨, `test_c4_relative_ntc.py::test_clean_ntc_with_clear_gap_is_still_called_ntc`와
   동일한, 이미 테스트로 고정된 기존 동작). 즉 이 버그는 "무신호 웰이 존재하면 항상"이 아니라
   **"그 클러스터링 호출에 들어온 웰 전부가 무신호일 때"**로 조건이 좁다 — 하지만 마커 리전
   단위 호출에서는 "그 마커 전체가 실패"가 드문 일이 아니다.

(위 3가지 모두 `snp-analyzer/tests/test_p22_no_signal_characterization.py`에 특성화 테스트로
고정해 두었다. 3개 모두 통과함 — 현재 코드의 실제 동작이다.)

### 기존 테스트가 놓친 부분

`tests/test_c3_small_region.py`는 <4-웰 폴백을 다루지만 입력이 항상 `norm_fam≈700,
norm_allele2≈300` 같은 **양의 신호**다 (`_three_signal_wells`). 무신호(전부 0) 입력에 대한 어떤
보장도 확인하지 않는다 — 보고된 그대로 사실.

### 관련이지만 별개인 기존 동작 (참고용, 새 버그 아님)

`test_c4_relative_ntc.py`에는 **"명확한 격차의 근-제로 웰은 NTC로 유지한다"**는, 이미 의도적으로
테스트로 고정된 정책이 있다(`test_clean_ntc_with_clear_gap_is_still_called_ntc`). 이는
"신호가 명확히, 크게 분리된 채로 0에 가까우면 NTC로 자동 라벨"이라는 기존의 신중한 설계
결정이며, 발견 1의 버그(무신호 웰이 **유전형**으로 분류됨)와는 다른 문제다. 다만 사용자의
"무신호 웰은 no-call이 맞다"는 원칙을 **문자 그대로 전체 적용**한다면 이 기존 동작(NTC 자동
주장)도 재검토 대상이 될 수 있다 — 이는 발견 1의 버그 수정과는 별개로, **사용자가 결정할
정책 범위**이지 내가 판단할 문제가 아니다. (아래 "권장 방향"에서 다시 언급.)

---

## 발견 2 — 정규화 적용 여부가 엔드포인트마다 다름

**판정: 사실. 실행으로 재현함.**

### 코드 경로

- `normalize()`(`app/processing/normalize.py:26-35`)는 **웰 단위**로 판단한다: 그 웰의
  `reference_value`(ROX 등)가 0/음수/None이면 나누지 않고 raw 값을 그대로 반환한다.
- `normalization_applies()`(`:48-63`)는 **런/사이클 전체에 대해 "정규화 모드가 켜져 있는가"만**
  검사하고, 개별 웰의 참조값을 전혀 보지 않는다.
- `app/routers/clustering.py:487` `_normalization_was_applied`는 이보다 한 겹 더 검사한다:
  `normalization_applies()`가 True이고, **그 사이클의 웰 중 하나라도** 양의 참조값을 가지면
  True. (이것도 완벽하지 않다 — "하나라도"이지 "전부"가 아니다. 아래 실행 결과 참고.)
- `app/routers/data.py`의 `/api/data/{sid}/scatter`류 엔드포인트(코드에 `/plate`, `/scatter` 성격의
  두 곳)와 `/api/data/{sid}/amplification/all`(`:98`, `:176`, `:234` 각각)은 **웰별 검사 없이**
  `normalization_applies(unified, use_rox=use_rox)`만 그대로 `normalization_applied` 필드로
  반환한다.

### 실행으로 확인

**Case A** (4웰 중 1웰만 ROX=0, 나머지는 정상): 응답 안에서 정상 웰(A1-A3)은 `norm_fam≈0.18-0.2`
(나눈 값)인데 A4는 `norm_fam=600.0`(raw 그대로) — **같은 페이로드 안에 ~3000배 척도 차이**가
공존한다. `normalization_applied`는 모든 경로에서 `True`로 보고됨(이 경우는 세 경로가 일치).

**Case B** (전체 웰 ROX=0):
```
normalization_applies() 전역 플래그: True
clustering.py _normalization_was_applied (즉 /analyze의 analysis_context): False
data.py /scatter, /plate, /amplification/all: True
```
**동일한 런, 동일한 요청 조건에서 `/analyze`는 "정규화 안 됨"이라 말하고, `/scatter`·`/plate`·
`/amplification/all`은 "정규화 됨"이라고 말한다.** 보고된 그대로 재현됨.

또한 `app/processing/ratio_origin.py:107` `rox_outlier_wells`는 `if p.raw_rox`로 걸러서 **ROX=0인
웰을 참조-이상치 후보에서 제외**한다(0은 falsy). 그 웰은 실제로는 정규화가 안 됐는데도(발견 2
자체), QC의 "참조가 이상한 웰" 목록에도 잡히지 않는다.

### 모델에 웰 단위 플래그가 없음

`NormalizedPoint`/`ScatterPoint`(`app/models.py:18`, `:125`)에는 "이 웰이 실제로 나뉘었는가"를
나타내는 필드가 없다. `raw_rox`는 있으므로 클라이언트가 `raw_rox <= 0`을 직접 검사해 웰 단위로
재구성할 수는 있지만, 현재 프론트가 그렇게 하는지는 별개 조사가 필요하다(이번 조사에서
프론트 수정·전수조사는 범위 밖).

---

## 발견 3 — 판정 없음을 상세 패널만 임의 유전형으로 표시

**판정: 사실.**

- `frontend/src/components/analysis/WellDetailPanel.tsx:126`:
  `effectiveCall`(manual ?? auto)이 없고 `ploidy===2 && total>0`이면 `r=normFam/total`을
  `0.6/0.4`로 잘라 Allele1/Allele2/Heterozygous 중 하나를 **만들어** 보여준다. 판정이 진짜
  없어도(`Undetermined`도 아니고 아예 assignment가 없는 상태) 화면엔 유전형이 뜬다.
- `frontend/src/components/analysis/ResultsTable.tsx:110-135`는 `effectiveType(auto_cluster,
  manual_type, ...)`만 사용 — 비율 추론 없음. 판정이 없으면 결과 격자는 빈 셀/미배정으로 남는다.
- `app/reporting/result_snapshot.py:230-236` `_row_call`은 저장된 override나
  `result.assignments`가 없으면 `"Unknown"`(status `"missing"`)을 반환 — 비율 추론 없음
  (docstring이 명시: "No ratio-based inference: unavailable coordinates and calls remain
  explicit").

→ 코드로 확인: **상세 패널에서 `Heterozygous` 등으로 보이는 웰이 결과 격자/CSV 내보내기에서는
판정 없음으로 남는 상황이 실제로 가능**하다 (세 파일의 로직이 서로 다른 것을 확인했으므로
"부분적 사실"이 아니라 "사실"로 판정). 이번 조사는 프론트 수정이 금지돼 있어 브라우저로 직접
재현하지는 않았지만, 세 소스 모두 최종 확인했으므로 로직상 결론은 확정적이다.

### confidence 필드의 의미 혼재

동일한 `confidence: float | None`(`ClusteringResult.confidences`, `app/models.py:489`) 안에
다음이 모두 섞여 담긴다:
- 혼합모형 posterior (`cluster_auto` 정상 경로, `:578-583`)
- 수동 경계까지 거리 기반 점수 (`boundary_confidences`, B3 override, `:153-193`)
- 소규모 리전 고정값 `_SMALL_REGION_CONFIDENCE`(0.9, `:389`)
- NTC "격차 강도" 점수(`ntc_confidence`, `:366`, 0~0.99)
- 컨트롤/명시적 NTC는 고정 `1.0`(`:308`, `:371`)

`WellDetailPanel.tsx`는 이걸 구분 없이 전부 `Math.round(confidence*100)%`로만 표시한다
(`{confidence == null ? '—' : ...%}`). 모델/타입 어디에도 "이 숫자가 어떤 종류의 신뢰도인지"를
구분하는 필드가 없다 — 코드로 확인됨.

---

## 무신호 웰의 정의 — 제안과 근거

**제안**: "무신호"는 **원점 이동(origin shift) 이후** `norm_fam`과 `norm_allele2`가 **둘 다
정확히 0**인 상태로 정의하는 것이 이 코드베이스의 기존 설계와 가장 잘 맞는다. 이유:

- `shift_to_origin`(`app/processing/ratio_origin.py:145`)은 **의도적으로** 원점(플레이트 자체의
  배경/무주형 바닥) 아래 값을 0에서 clamp한다 — 주석에 "이것이 NTC 감지기가 이 웰들을 다시
  무신호로 보게 만드는 것"이라 명시돼 있다. 즉 "원점 이동 후 (0,0)"은 이미 이 코드베이스가
  "무신호"의 조작적 정의로 채택한 것이다.
- 원점 이동 **전** 원시값이 양수였는데 이동 후 (0,0)이 된 웰과, 원래부터 (0,0)이던 웰은 이
  단계 이후로는 **구분할 수 없다** — `shift_to_origin`이 `norm_fam`/`norm_allele2`만 덮어쓰고
  원본을 들고 있지 않기 때문이다(다만 라우터 쪽 `_snapshot_points`가 `plot_fam`/`plot_allele2`에
  이동 전 값을 별도로 남겨두므로, **그 값을 조회하면** 두 경우를 구분하는 것 자체는 가능하다 —
  `_manual_ntc_mask`가 이미 `plot_fam`/`plot_allele2` 우선 조회 패턴을 쓰고 있다).
- "정확히 0"이 아니라 "어떤 임계 미만"으로 완화할지는 **과학적 판단**이 필요한 지점이라
  확신하지 못한다 (아래 "확신하지 못하는 지점" 참고). 임계값을 두면, 이미 있는 상대-NTC
  감지기(발견 1 대조군에서 본, "명확한 격차의 근-제로는 NTC로 유지"하는 기존 테스트 고정
  정책)와 경계가 겹치므로, 새 임계값과 기존 `_NTC_SIGNAL_FRAC`/`_NTC_CLEAR_GAP` 사이의 관계를
  먼저 정리해야 한다.

**업계 관행에 대해**: qPCR/SNP 유전형 판정 소프트웨어(QuantStudio Genotyping, Bio-Rad CFX
Maestro, TaqMan Genotyper 등 상용 계기 소프트웨어)는 일반적으로 "No Call/Undetermined"을
(a) 두 채널 모두 임계값 미만인 웰, 또는 (b) 자동 클러스터링이 신뢰 구간 내로 배정하지 못한
웰에 대해 부여하고, "NTC"는 **플레이트 레이아웃에서 선언된 웰 역할**로 별도 관리하는 것이
일반적이다(코드의 C4 주석 자체가 정확히 이 구분을 이유로 든다). 다만 나는 이 분야의 1차 문헌이나
각 계기 소프트웨어의 정확한 최신 매뉴얼을 이번 조사에서 직접 확인하지 못했다 — **이 문단은
내 학습 지식에 기반한 일반적 서술이며, 특정 문헌/매뉴얼 인용으로 검증한 것이 아니다.** 과학적
타당성 판단이 필요한 부분이므로 이 정도의 확신 수준으로만 제시한다.

---

## 영향 범위 — 저장된 판정이 달라지는가

### 저장 구조 확인 (코드로, 운영 DB 미접근)

- `publish_analysis`(`app/processing/analysis_state.py:97`)가 `db.save_clustering(sid, result)`로
  세션당 `ClusteringResult`(assignments + confidences)를 저장한다.
- `db.save_clustering`(`app/db.py:294`)은 `INSERT OR REPLACE INTO clustering_results ...` —
  **세션당 한 행, 마지막 분석 결과로 덮어쓴다.** 이력/버전 관리가 없다.
- 내보내기/리포트(`app/reporting/result_snapshot.py`)는 **저장된 `ClusteringResult.assignments`를
  그대로 읽어 쓴다** (`_row_call`, `:230`) — 내보낼 때 클러스터링을 다시 계산하지 않는다.

### 결론

- **이미 생성되어 나간 리포트/CSV 파일**: 정적 산출물이므로 코드 수정으로 소급 변경되지 않는다.
  영향 없음.
- **DB에 저장된, 아직 재분석되지 않은 세션의 `clustering_results` 행**: 코드를 배포해도 자동으로
  바뀌지 않는다 — 세션당 한 행을 덮어쓰는 구조이므로, **그 세션에 대해 `/analyze`가 다시
  호출되기 전까지는** 예전 결과(예: 무신호 웰의 `Heterozygous` 0.9/1.0)가 그대로 남는다.
- **재분석 시점의 문제**: 어떤 세션을 열어 "다시 분석"을 누르면(입력이 동일해도) 수정 후에는
  다른 결과(예: `Undetermined`)가 나온다. **같은 입력, 다른 시점 → 다른 판정**이라는 재현성
  문제가 발생한다. DB에는 "이 결과가 어느 알고리즘 버전으로 계산됐는지"를 남기는 필드가 없어
  보인다(`clustering_results` 스키마 확인 범위에서는 버전 컬럼을 찾지 못함) — 즉 나중에 어떤
  저장된 판정이 수정 전/후 것인지 구분할 방법이 현재는 없다.

### 몇 웰이 영향받는지 추정

운영 DB 접근이 금지돼 있어 **실측할 수 없다.** 대신 조건을 정확히 특정했다: 이 버그가
발동하려면 **`cluster_auto`에 들어오는 그 호출의 웰 전부**(리전 분석이면 그 마커의 웰
전부, 리전이 없으면 플레이트 전체)의 `total<=0`이어야 한다. 이는:

- 마커 리전 단위로는 "그 마커 전체가 완전히 실패"하는 경우 (흔한 패턴은 아니지만, 작은 대조/검증
  마커나 소수 웰짜리 마커에서는 현실적으로 일어날 수 있음 — `clustering.py`의 자체 주석이 "9웰
  마커 리전" 규모를 예로 든다),
- 플레이트 전체 단위(리전 미정의 레거시 경로)로는 "런 전체가 완전히 실패"하는 경우.

**부분적으로 실패한 마커**(일부 웰만 무신호, 나머지는 정상 신호)는 이 버그에 걸리지 않는다 —
대조군 실행에서 확인했듯 `median_total>0`이 되어 기존 상대-NTC 감지기가 정상 작동, `NTC`로
라벨된다. 따라서 영향 범위는 "무신호 웰이 하나라도 있는 모든 세션"이 아니라, **"어떤 분석
호출 스코프(마커 또는 플레이트) 전체가 무신호였던 경우"**로 좁게 잡을 수 있다. 실제 몇 건이
있는지는 (운영 DB 없이) 합성 데이터로는 셀 수 없고, 실측하려면 —
운영 DB를 건드리지 않는 조건으로 — 스테이징 사본에서 저장된 각 세션의 리전 정의 + 원본
`WellCycleData`를 읽어, 수정된 로직으로 재계산한 뒤 기존 저장 결과와 비교하는 오프라인 스크립트를
돌리는 방법을 제안한다(이번 조사에서는 실행하지 않았다 — 범위 밖이자 운영 데이터 접근 금지
때문).

발견 2(정규화 척도 불일치)는 **저장된 유전형 판정 자체를 바꾸지 않는다** — `normalization_applied`는
표시용 메타데이터 플래그이고, 클러스터링 입력값(`norm_fam`/`norm_allele2`)은 이미 `normalize()`가
계산한 대로 저장/사용된다. 즉 이 발견은 "판정이 틀렸다"가 아니라 "판정에 쓰인 척도를 사용자에게
잘못 알린다(축 라벨, QC 해석)"는 문제다 — 영향은 신뢰도/해석 층위이지 저장된 유전형 레이블
자체는 아니다.

발견 3(상세 패널 임의 유전형)도 **저장된 판정을 바꾸지 않는다** — 프론트 전용 표시 로직이고
`result_snapshot`/DB에는 닿지 않는다. 영향은 "화면에 보이는 것과 내보낸 결과가 다르다"는
사용자 신뢰 문제다.

---

## 권장 방향

### 발견 1 (무신호 → no-call)

- **어디를 고칠지**: `cluster_auto`의 NTC 판정을, "그 호출에 `total>0`인 웰이 존재하는가"와
  무관하게 만들어야 한다. 구체적으로 두 지점이 후보다:
  1. `median_total`을 상대 판정의 기준으로 쓰기 전에, **`total<=0`인 웰은 (상대 감지기와
     별개로) 항상 무조건 no-call/no-signal 취급**하는 절대 규칙을 먼저 적용 — 즉 "정확히
     0"은 median이 무엇이든 항상 걸러지도록. 이렇게 하면 `median_total==0`이라는 축퇴
     상황에서도 안전하다.
  2. 그 다음, 발견 1 대조군에서 확인한 기존 정책(명확한 격차의 근-제로는 NTC로,
     불명확하면 Undetermined로)과 이 "정확히 0" 규칙이 **같은 라벨(NTC vs Undetermined)로
     귀결되는지, 아니면 "정확히 0"은 항상 Undetermined로 두고 "근-제로 하지만 0은 아닌" 것만
     기존 상대 감지기에 맡길지**는 정책 결정이 필요하다 — 사용자가 "무신호=no-call"이라
     했으므로, 가장 보수적인 해석은 "정확히 0(원점 이동 후)은 항상 Undetermined, NTC는
     여전히 조작자 선언 또는 명확한 격차 휴리스틱의 몫으로 남긴다"이다.
  3. 작은 리전 폴백(`:380-390`)에서 `ratio[i]`가 `0.5` 기본값(즉 `total<=0`)인 웰은 dosage
     계산으로 보내지 않고 바로 `Undetermined`/`confidence=0.0`으로 분기.
  4. 혼합모형 경로(`:531-583`)에서도 동일하게, `total<=0`이었던 웰(원본 마스크를 별도로
     들고 있어야 함 — 현재는 `ratio`로 뭉개져 구분 불가)은 posterior 계산 전에 걸러 항상
     `Undetermined`로.
- **`low_n` 경고와의 관계**: `low_n`은 "표본이 적어 통계적 근거가 약하다"는 경고이지 "신호가
  없다"는 경고가 아니다. 무신호는 `low_n`과 **독립적인** 새 경고(예: `"no_signal"`)로 남기는
  편이 낫다 — 지금처럼 큰 무신호 리전(≥4웰)이 `low_n`조차 없이 최대 확신으로 오판정되는 상황이
  가장 심각하므로, 경고 자체가 웰 개수와 무관하게 붙어야 한다.
- **바꾸지 않을 경우의 위험**: 완전히 실패한 마커/런이 최대 확신(1.0)의 `Heterozygous`로
  보고된다 — 실패를 실패로 인지하지 못하고 과학적으로 틀린 유전형이 하류(export, 통계, 사용자
  판단)로 흘러간다. 리전이 클수록 경고조차 없어 발견하기 더 어렵다.

### 발견 2 (정규화 척도 일관성)

- **어디서 보장할지**: 웰 단위 진실을 모델에 노출해야 한다 — `NormalizedPoint`/`ScatterPoint`에
  `normalized: bool`(그 웰이 실제로 나뉘었는가, 즉 `reference_value and reference_value>0`) 같은
  필드를 추가하고, 세 엔드포인트(`/scatter`류, `/plate`, `/amplification/all`, `/analyze`)가
  모두 **동일한 정의**로 계산한 `normalization_applied` 플래그(전역) + 웰별 `normalized` 플래그
  (개별)를 함께 반환하도록 통일하는 편을 권한다. 지금처럼 "전역 플래그 하나로 웰 전체를
  대표"하는 방식은 부분 실패(일부 웰만 ROX=0)를 표현할 수 없다.
- `clustering.py`의 `_normalization_was_applied`("하나라도 양수면 True")도 완벽한 정의가
  아니다 — 이 함수 자체를 새 웰별 플래그의 "OR" 또는 "AND" 집계로 재정의할지도 결정이 필요하다.
- **바꾸지 않을 경우의 위험**: 축 라벨이 실제 값의 성질과 다르게 표시되고, QC가 참조-이상치를
  놓치며(`rox_outlier_wells`가 `raw_rox==0`을 falsy로 건너뜀), 화면마다 같은 런에 대해 다른
  "정규화됨" 답을 준다 — 이미 실행으로 재현됨.

### 발견 3 (상세 패널 임의 유전형)

- **권장**: 상세 패널의 `0.6/0.4` 비율 추론을 제거하고 `ResultsTable`/`result_snapshot`과
  동일하게 "판정 없음"(no call/Unassigned)을 명시적으로 표시하는 쪽을 권한다 — 세 화면이 같은
  진실(저장된 `assignments`)을 반영해야 사용자가 화면마다 다른 답을 보지 않는다. 대안으로
  "추정치임을 명시하는 별도 UI 힌트(예: 이탤릭체 + '추정' 라벨)"를 남길 수도 있으나, 이는
  제품 결정이다.
- **confidence 종류 구분**: `ClusteringResult.confidences`를 단일 float 대신, 최소한 "무엇으로
  계산된 신뢰도인지"(posterior / boundary-distance / small-region-ceiling / ntc-gap / fixed)를
  구분하는 부가 필드나 별도 enum을 추가해, UI가 "90%"를 다른 근거끼리 똑같이 취급하지 않도록
  하는 편을 권한다.
- **바꾸지 않을 경우의 위험**: 상세 패널과 결과 격자/내보내기가 같은 웰에 대해 다른 답을
  보여주는 상태가 계속된다 — 사용자가 어느 쪽을 믿어야 할지 알 수 없고, 실제로 판정이 없는
  웰이 특정 화면에서만 "있는 것처럼" 보인다.

---

## 확신하지 못하는 지점

- **"무신호"의 정확한 임계값**(정확히 0만인지, 어떤 상대/절대 임계 이하까지 포함할지)은
  과학적 판단이 필요하며 나는 근거 없이 결정하지 않았다.
- qPCR/SNP 지오타이핑 업계의 no-call 정의에 대한 서술은 내 학습 지식 기반 일반론이며, 이번
  조사에서 1차 문헌이나 계기 소프트웨어 매뉴얼을 직접 대조 확인하지 않았다.
- 발견 1의 "정확히 0(원점 이동 후)은 항상 Undetermined"라는 방향이, 기존에 테스트로 고정된
  "명확한 격차의 근-제로는 NTC로 유지" 정책과 **모순되지 않는지**는 정책 결정 없이는 내가
  판단할 수 없다 — "정확히 0"과 "명확한 격차의 근-제로(0은 아님)"를 다른 라벨로 유지하는
  절충안이 가능한지도 사용자/오케스트레이터가 정할 부분이다.
- 실제 운영 데이터에서 "리전 전체가 무신호"인 사례가 몇 건/몇 퍼센트 존재하는지는 운영 DB
  접근 금지로 인해 **전혀 추정하지 못했다** — 위에서 제안한 오프라인 재계산 스크립트를 스테이징
  사본에서 실행하기 전까지는 실측 불가.
- 발견 2에서 제안한 "웰별 `normalized` 플래그"가 프론트 전반(차트 축 라벨, 범례 등)에 미치는
  파급 범위는 프론트 코드 전체를 조사하지 않았으므로 완전하지 않다 (이번 조사는 프론트 수정이
  금지돼 있어 읽기 확인만 함).
