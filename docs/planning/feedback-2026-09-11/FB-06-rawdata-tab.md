# FB-06 — 프로토콜 탭을 "Raw data" 탭으로: 증폭 곡선 오버레이 이관

- **피드백 ID**: `f127b261f35a49e8` · 카테고리 `feature` · 상태 `open`
- **제출**: 2026-09-11 14:28:00 / page_key `protocol`
- **원문**: "증폭오버레이 곡선이 PCR 프로토콜 단계 화면 하단에 있으면 좋겠습니다. 전체 웰의 형광을 볼 수 있게 그리고 웰마다 형광값을 볼 수 있게요. 그래서 탭이름을 '프로토콜'이 아니라 Rawdata 로 표시하면 좋겠네요."
- **스크린샷**: `feedback-shots/f127b261-4cb65a.png` (증폭 곡선 오버레이 캡처)
- **복잡도**: Complex (정보구조 이동 + 상태 결합 해제)

## 1. 요구 분해

세 가지 서로 다른 요구가 한 건에 들어 있다.

| # | 요구 | 성격 |
|---|------|------|
| a | 증폭 오버레이를 프로토콜 화면 하단에 배치 | 배치 이동 |
| b | 전체 웰 형광을 볼 수 있게 | **이미 구현됨** (`getAllAmplification`) |
| c | 웰마다 형광값을 볼 수 있게 | **부분 구현** (Plotly 호버) — 표 형태 요구일 가능성 |
| d | 탭 이름을 `프로토콜` → `Raw data` | 명명 (FB-07과 연동) |

## 2. 현행 구현 (코드 근거)

### 증폭 오버레이의 현재 위치 — 분석 탭 최하단

`frontend/src/components/analysis/AnalysisTab.tsx` 말미:

```tsx
<div className="analysis-secondary px-4 pb-4 sm:px-6"><ResultsTable /></div>
{/* Amplification Overlay - full width below grid */}
<div style={{ padding: "0 24px 16px" }}>
  <AmplificationOverlay />
</div>
```

그리고 `MultiMarkerAnalysisPanel.tsx:461`에서 마커별로 한 번 더:
```tsx
<AmplificationOverlay ploidyOverride={selectedMarker.ploidy} />
```

즉 **두 곳에 마운트**되어 있고, 둘 다 분석 탭 안이다. 프로토콜 탭에는 없다.

> **정정 (리뷰 반영)**: 두 마운트 지점은 **동시에 활성화되지 않는다.**
> `AnalysisWorkspace.tsx`의 분기가 배타적이기 때문이다:
> `markers.length > 0 ? <MultiMarkerAnalysisPanel/> : <AnalysisTab/>`.
> 즉 현재 DOM에는 오버레이가 항상 **하나만** 존재한다.

### 오버레이가 분석 상태에 결합되어 있다

`frontend/src/components/analysis/AmplificationOverlay.tsx`:

```tsx
const gt = curve.effective_type || "Unknown";
const color = wellInfo(gt, ploidy, dark).color;    // ← 유전형 판정 결과로 색을 칠한다
…
const yValues = channel === "fam" ? curve.norm_fam : curve.norm_allele2;   // ← 항상 처리된 값
```

- 곡선 색이 **유전형 판정 결과**(`effective_type`)에서 나온다. 스크린샷 범례 `Allele 1 Homo` / `Undetermined`가 그 결과다.
- **Y값은 언제나 `norm_fam` / `norm_allele2`** 다. 요청의 `use_rox` / `backgroundMode`에 따라 백엔드가 이미 처리한 값이며,
  프론트에서 "raw로 되돌릴" 방법이 없다.
- 데이터 요청: `getAllAmplification(sessionId, useRox, backgroundMode)`.

**따라서 "Raw data"라는 이름과 현재 동작은 모순된다.** 지금 오버레이는 raw가 아니라
*정규화·배경보정이 반영되고 유전형으로 색칠된* 곡선이다.

### 응답이 실제 처리 상태를 알려주지 않는다 (초안 누락)

`app/routers/data.py`의 all-amplification 응답:

```python
return {
    "allele2_dye": unified.allele2_dye,
    **build_role_label_metadata(unified),
    "curves": curves,
}
```

→ `normalization_applied` / `background_mode` **에코가 없다.**
프론트가 스토어의 *요청값*으로 "정규화: 적용됨"이라고 쓰면 **백엔드가 실제로 적용했는지와 무관한 주장**이 된다.
(산점도 쪽은 `normalizationApplied`를 응답에서 받아 `ScatterReferenceBasis`로 "요청: 예 / 실제 적용: 아니오"를 구분해 표시한다 —
오버레이에는 그 계약이 없다.)

### DOM id 하드코딩

`id="overlay-plot"`, `id="overlay-container"`, `id="toggle-overlay-btn"`, `id="overlay-channel-select"`가 고정값이다.

> **정정 2 (리뷰 반영)**: 초안은 이것이 "Plotly 오작동"과 "`chart-export-registry.ts` 오염"을 일으킨다고 했으나 **둘 다 틀렸다.**
> - Plotly는 `plotRef.current`(ref)로 인스턴스를 잡는다. id 조회를 쓰지 않는다.
> - `chart-export-registry.ts`는 element 참조를 하나만 보관하는 활성 산점도 레지스트리이고, **오버레이는 여기에 등록조차 하지 않는다.**
>
> 실제 영향은 더 좁다: (i) 중복 id는 유효하지 않은 HTML이며, (ii) `plot-cleanup.test.tsx:33,49`가
> `container.querySelector('#overlay-plot')` / `'#toggle-overlay-btn')`로 **첫 매치**를 집는다 —
> 두 인스턴스가 동시에 존재하면 이 테스트가 어느 쪽을 검사하는지 불명확해진다.
> → **차단 사유는 아니지만, 동시 마운트를 도입한다면 id를 스코프화하는 편이 옳다.**

### 기본 접힘 + 하드코딩 영어

```tsx
const [visible, setVisible] = useState(false);
<button id="toggle-overlay-btn" …>{visible ? "Hide Overlay" : "Show Overlay"}</button>
```
기본으로 닫혀 있고, 버튼 라벨이 **i18n을 거치지 않은 하드코딩 영어**다.
스크린샷에도 `Hide Overlay`가 한국어 UI 안에서 영어로 보인다. **부수 결함으로 함께 수정한다.**

## 3. 해결 방향

### 3-1. 탭 정체성 재정의 (FB-07 B1과 함께)

`프로토콜` 탭을 **`Raw data`** 탭으로 확장한다. 구성:

```
Raw data 탭
├─ 열 순환 프로파일 다이어그램        (FB-05)
├─ PCR 프로토콜 단계 표 (편집 가능)    (기존)
├─ 판독 채널 요약                     (FB-05)
└─ 증폭 곡선 오버레이                 (FB-06) ← 본 문서
   ├─ 채널 선택 (FAM / HEX / …)
   ├─ 색 기준 선택: [유전형] / [웰 타입] / [단색]   ← 신규
   ├─ 정규화·배경보정 상태 표시 (raw인지 처리본인지 명시)
   └─ 웰별 형광값 표 / 호버 상세        ← 요구 (c)
```

### 3-2. 오버레이 이동 방식

**`AmplificationOverlay`를 분석 탭에서 제거하지 않는다.** 이유:
- 분석 중 곡선을 확인하는 것은 정당한 워크플로우다.
- `MultiMarkerAnalysisPanel`은 마커 스코프(`ploidyOverride`)로 렌더하므로 마커별 곡선이 필요하다.

대신 **Raw data 탭에 전체 플레이트 스코프로 추가 마운트**하고, 분석 탭의 것은 접힌 보조 영역으로 유지한다.
→ FB-03(분석 화면 과밀)과도 정합한다.

> 구현 주의: 동시 마운트를 도입하면 **처음으로** 오버레이가 두 개 존재하게 된다.
> Plotly 자체는 ref 기반이라 안전하지만, 고정 DOM id가 중복되고 `plot-cleanup.test.tsx`의
> `querySelector('#overlay-plot')`가 모호해진다. → id를 prop 또는 `useId()` 기반으로 스코프화한다.
> 요청 중복은 **조건부**다: 오버레이는 `useState(false)` 기본값이고 `if (!visible …) return`으로 막혀 있어
> **사용자가 양쪽에서 각각 펼쳤을 때만** 두 번 호출된다. 마운트만으로 상시 중복 전송되지는 않는다. (리뷰 정정)

### 3-3. "Raw" 의미의 정직한 표기

탭 이름이 `Raw data`가 되는 이상, 화면이 무엇을 보여주는지 명시해야 한다.

**(1) 처리 상태를 정직하게 표시하려면 응답 계약을 넓혀야 한다.**
all-amplification 응답에 `normalization_applied: bool`과 `background_mode`를 **에코로 추가**한다
(산점도가 이미 쓰는 패턴). 그래야 헤더에 `정규화: 요청 예 / 실제 적용 아니오` 같은 참인 문장을 쓸 수 있다.
스토어의 요청값만으로 상태를 단언하는 것은 금지한다.

**(2) 색 기준 선택기** (색만 바꾸는 것이며 값은 바꾸지 않는다):
- `유전형` (현행, `effective_type`)
- `웰 타입` (`wellTypeAssignments`)
- `단색` — 판정 결과에 물들지 않은 곡선 형태 보기

> **정정 (리뷰 반영)**: 초안은 `단색`을 "순수 원시 신호 보기"라고 썼으나 **틀렸다.**
> 색을 바꿔도 Y값은 여전히 `norm_fam`/`norm_allele2`다. `단색`은 *판정 색에서 자유로운 보기*일 뿐 raw가 아니다.

**(3) 진짜 raw를 보여주려면** — 별도 작업.
이 차트만 `use_rox=false, background=none`으로 독립 요청하는 "원시 신호 보기" 토글을 두거나,
백엔드가 미처리 RFU를 함께 내려주어야 한다. **탭 이름을 `Raw data`로 바꾼다면 이 항목이 사실상 필수다** —
그렇지 않으면 이름이 내용을 잘못 설명한다.

### 3-4. 웰별 형광값 (요구 c)

현재는 Plotly 호버 툴팁(`hovertemplate: '${curve.well}<br>Cycle %{x}<br>RFU %{y:.3f}'`)만 있다.
사용자가 "웰마다 형광값을 볼 수 있게"라고 한 것은 **열람 가능한 표**를 뜻할 가능성이 높다.

제안:
- 오버레이 아래에 **웰 × 사이클 RFU 표**를 접힌 영역으로 제공.
- 행: 웰, 열: 사이클, 값: 선택 채널의 RFU. 채널 선택기와 연동.
- CSV 내보내기 버튼 (`use-exports.ts` 패턴 재사용).
- 96웰 × N사이클은 큰 표이므로 `overflow: auto` 컨테이너 + 가상 스크롤 검토.

> **미확정**: 사용자가 원한 것이 표인지, 웰 클릭 시 단일 곡선 강조인지 불명확. **확인 필요 (Q-1)**.

### 3-5. 하드코딩 영어 수정

`"Hide Overlay"` / `"Show Overlay"`를 `t.overlayShow` / `t.overlayHide`로 i18n 처리.

## 4. 변경 범위

| 파일 | 변경 |
|------|------|
| `frontend/src/components/analysis/AmplificationOverlay.tsx` | `id` 충돌 해소, 색 기준 선택기, 처리 상태 표기, i18n |
| `frontend/src/components/protocol/ProtocolTab.tsx` | 오버레이 마운트 (전체 플레이트 스코프) |
| `frontend/src/components/analysis/AnalysisTab.tsx` | 오버레이를 접힌 보조 영역으로 |
| `frontend/src/components/layout/TabNavigation.tsx` | 탭 id/라벨 (FB-07과 병합) |
| `frontend/src/locales/{en,ko}.ts` | `Raw data` 탭 라벨, 오버레이 문구 |
| `app/routers/data.py` | all-amplification 응답에 `normalization_applied` / `background_mode` 에코 |
| `frontend/src/types/api.ts` | 응답 타입 동기화 |
| 테스트 | `ProtocolTab.test.tsx`, `plot-cleanup.test.tsx`, 루트 E2E의 탭 셀렉터 |

## 5. 수용 기준

- [ ] Raw data 탭에서 전체 웰 증폭 곡선을 볼 수 있다.
- [ ] 분석 탭과 Raw data 탭에 동시 마운트해도 **두 차트가 각각 올바르게 렌더**된다 (id 충돌 없음).
- [ ] 탭 전환 시 Plotly 인스턴스가 누수되지 않는다 (`plot-cleanup` 테스트 통과).
- [ ] 오버레이 헤더의 정규화/배경보정 표시가 **응답 에코 값**에 근거한다 (스토어 요청값이 아니라).
- [ ] 색 기준을 `단색`으로 바꾸면 유전형 판정 색이 사라진다. 문구가 이를 "raw"라고 주장하지 **않는다**.
- [ ] `Hide/Show Overlay` 버튼이 한국어 UI에서 한국어로 나온다.
- [ ] 마커별 오버레이(`ploidyOverride`)가 회귀하지 않는다.
- [ ] PNG/PDF 내보내기가 의도한 차트를 집는다 (오버레이는 export registry에 등록되지 않으므로 회귀 없음을 확인).

## 6. 테스트 계획

- 단위: 두 인스턴스 동시 마운트 시 각 `ref`가 서로 다른 DOM 노드인지.
- 단위: 색 기준 전환이 trace 색을 바꾸는지.
- 회귀: `plot-cleanup.test.tsx`, `use-exports.test.tsx`.
- E2E: 분석 탭 ↔ Raw data 탭 왕복 후 두 차트 모두 정상.

## 7. 리스크

- **중간.** 중복 DOM id 자체는 Plotly/내보내기를 깨지 않는다(위 정정). 다만 `plot-cleanup.test.tsx`의
  `querySelector` 단언이 모호해지므로 id 스코프화를 함께 한다.
- 요청 중복은 **양쪽 오버레이를 모두 펼쳤을 때만** 발생한다(기본 접힘). 비용도 높지 않다 —
  `/api/data/{sid}/amplification/all`(`app/routers/data.py:220`)은 인메모리 세션 조회이고 DB를 치지 않으며,
  `normalize()`는 96웰 × N사이클 CPU 연산이다. **차단 사유는 아니나** 세션 단위 캐시를 두면 깔끔하다
  (`session-view-cache.ts` 패턴).
- 응답 계약 확장(`normalization_applied` 에코)은 백엔드 변경이므로 `pytest` 및 ASG 저장 경로 회귀 확인 필요.
- 탭 개명은 루트 Playwright 스펙 다수를 깬다 (FB-07과 함께 일괄 처리).

## 8. 미결정 사항

- **Q-1**: "웰마다 형광값" = RFU 표인가, 곡선 강조인가, 웰 클릭 시 상세 패널인가.
- 기본 색 기준: `단색` vs `유전형`(현행).
- **`Raw data` 탭 이름을 쓴다면 "진짜 raw 보기"(3-3 (3))를 함께 구현할 것인가.** 이름과 내용의 일치 문제.
- 오버레이 데이터 캐시 전략 (중복 요청 허용 여부).
- 탭 명칭 최종형: `Raw data` / `원시 데이터` / `Raw data (원시 데이터)` — FB-07 D-1과 함께 결정.
