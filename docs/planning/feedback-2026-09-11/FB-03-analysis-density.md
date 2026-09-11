# FB-03 — 분석 화면 과밀: 결과보다 텍스트가 많다

- **피드백 ID**: `2d1ca7ee9f444564` · 카테고리 `improvement` · 상태 `open`
- **제출**: 2026-09-11 14:23:09 / page_key `analysis` / 1920x911
- **원문 요지**:
  1. "이 분석툴을 가지고 결국 유저는 뭘 할까요? 샘플별로, 어떤 유전형을 가지는지 보고 싶을 겁니다."
  2. "지금은 시각적인 것보다 텍스트가 훨씬 많습니다. 분석경고 같은건 최하단에 있어도 충분합니다."
  3. "마커로 분할할 경우 플레이트 96웰을 보여줄게 아니라 마커1 마커2 이렇게 선택할 수 있어야합니다."
  4. "'플레이트 웰을 고르거나 산점도에서 영역을 드래그하세요' 이 부분이 나오는건 없어도 될거 같아요. 그룹1,2,3,4가 딱히 의미가 없는 상황입니다."
- **스크린샷**: `feedback-shots/2d1ca7ee-0de854.png` (전체 화면)
- **복잡도**: Complex (레이아웃 재설계, 다중 컴포넌트)

## 1. 관찰된 현상 — 화면 상단부터의 실제 스택

스크린샷과 코드를 대조하면 **산점도가 나오기까지 세로로 6겹의 텍스트 블록**을 지난다.

| 순서 | 블록 | 소스 |
|------|------|------|
| 1 | 앱 제목 + 연동 배지 + 장비/웰/사이클 배지 + QC 배지 | `Header.tsx` |
| 2 | 최상위 탭 줄 (분석·프로토콜·설정·품질·통계·비교·라이브러리·프로젝트·더보기) | `TabNavigation.tsx` |
| 3 | 워크스페이스 탭 줄 (플레이트 설정 / 분석) | `AnalysisWorkspace.tsx` `WorkspaceTabs` |
| 4 | `AnalysisResultStatus` + `PlateScopeSummary` 2단 요약 상자 | `AnalysisWorkspace.tsx` `analysis-context-summary` |
| 5 | 마커 분할 권유 배너 (`split-marker-banner`) | `AnalysisWorkspace.tsx` |
| 6 | 사이클 컨트롤 + 분석 툴바 (`analysis-primary-toolbar`) | `AnalysisTab.tsx` |
| 7 | **분석 경고 Callout** (`analysis-warnings`) | `AnalysisTab.tsx` |
| 8 | 웰 선택 툴바 ("플레이트 웰을 고르거나…" + 그룹1~6 + 그룹 추가) | `WellSelectionToolbar.tsx` |
| 9 | 드디어 산점도 / 플레이트 뷰 | `analysis-grid` |

## 2. 근본 원인 (코드 근거)

### (a) 경고가 결과보다 위에 있다

`frontend/src/components/analysis/AnalysisTab.tsx` — `analysisWarnings` Callout이 `analysis-grid`(산점도) **앞에** 렌더된다:

```tsx
{analysisWarnings.length > 0 && (
  <Callout tone="warning" className="mx-4 mt-4 sm:mx-6" data-testid="analysis-warnings">
    <b>{t.analysisWarningsTitle}:</b> …
  </Callout>
)}
…
<div className="analysis-grid grid gap-4 p-4 sm:px-6">
  <ScatterPlot />
```

`index.css`가 1280px 이상에서 `max-height: 5rem; overflow: auto`로 높이를 제한하고는 있으나, **순서 자체가 경고 우선**이다.

### (b) 그룹 컨트롤이 항상 보인다

`frontend/src/components/analysis/WellSelectionToolbar.tsx:8`:

```tsx
const DEFAULT_GROUPS = Array.from({ length: 6 }, (_, i) => `Group ${i + 1}`);
```

이 6개는 **이미 존재하는 그룹이 아니라 "현재 선택을 그룹 N으로 저장" 프리셋 슬롯**이다.
선택 웰이 0개면 `assignPreset()`이 `t.manualGroupSelectFirst` 오류를 띄울 뿐 아무 일도 하지 않는다.
그런데도 `0개 웰 선택` 상태에서 버튼 6개 + `+ 그룹 추가`가 자리를 차지한다.
사용자가 "그룹1,2,3,4가 딱히 의미가 없는 상황"이라고 한 것이 정확히 이 상태다.

### (c) 마커 선택기는 존재하지만 이 경로에서는 도달하지 못한다

`AnalysisWorkspace.tsx`의 분기:

```tsx
{markers.length > 0
  ? <MultiMarkerAnalysisPanel markers={markers} />          // 마커 선택기 있음
  : <div data-testid="single-marker-analysis-view"> … <AnalysisTab /> </div>}   // 플레이트 뷰
```

`MultiMarkerAnalysisPanel.tsx:258`에 `data-testid="marker-selector-sidebar"` 목록이 **이미 구현되어 있다.**
즉 3번 요구는 "없는 기능"이 아니라 **마커가 0개인 세션에서는 그 UI에 도달할 수 없다**는 발견 가능성 문제다.
현 세션(`23cf12a845cc`)은 마커 분할 전이라 `markers.length === 0`이고, 그래서 96웰 플레이트가 보인다.

### (d) 레이아웃이 "산점도 : 플레이트"를 1:1로 나눈다

`index.css`:
```css
@media (min-width: 1280px) { .analysis-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
```
결과의 주역(산점도)과 조작 도구(플레이트 뷰)가 동등한 폭을 갖는다.
그 아래 `ResultsTable`(유전자형 결과)은 `analysis-secondary` 영역에 들어가고,
`index.css`의 `[data-testid="results-scroll-region"] { max-height: 24rem; overflow-y: auto; }`로 높이가 제한된다.

> **정정 (리뷰 반영)**: 초안은 이를 "접힌 영역"이라고 썼으나 정확하지 않다. `ResultsTable`은 **항상 렌더되며**,
> 접힌 것이 아니라 **높이가 24rem으로 잘린 스크롤 영역**이다.
> 문제는 가시성이 아니라 **위치(최하단)와 높이 제한**이다.

## 3. 해결 방향

목표를 한 문장으로: **"이 플레이트의 샘플들이 어떤 유전형인가"를 스크롤 없이 답한다.**

### 3-1. 수직 순서 재배치 (우선순위: 상)

```
현재                          변경안
────────────────────────      ────────────────────────
컨텍스트 요약 2단 상자         분석 툴바 (사이클 + 분석)
마커 분할 배너                 ▸ 컨텍스트 요약 (접힘, 한 줄 요약)
분석 툴바                      결과 영역 (산점도 + 유전형 요약)
분석 경고 ← 여기               플레이트 뷰 / 웰 상세
웰 선택 툴바                   유전자형 결과 표
산점도 + 플레이트               ▸ 분석 경고 (접힘, 배지로 개수만 상단 노출)
유전자형 결과 (접힘)
증폭 오버레이
```

- `analysis-warnings` Callout을 `ResultsTable` **아래**로 이동.
- 대신 `analysis-primary-toolbar`에 `⚠ 경고 N건` 배지를 두고, 클릭 시 하단 경고 영역으로 스크롤/포커스 이동.
  **경고를 숨기는 것이 아니라 강등한다** — 저신호 웰 경고 같은 항목은 판정 신뢰도에 직결되므로 접근성을 유지해야 한다.
- `analysis-context-summary`(`AnalysisResultStatus` + `PlateScopeSummary`)는 `<details>`로 접고,
  요약 한 줄(예: `사이클 6/6 · 96웰 · 마커 분할 없음`)만 기본 노출.

### 3-2. 웰 선택 툴바 조건부화 (우선순위: 상)

- 안내 문구 "플레이트 웰을 고르거나 산점도에서 영역을 드래그하세요"는 **선택 웰이 0개일 때만** 의미가 있으나,
  현재는 그 상태에서 가장 크게 보인다. → 선택 0개일 때는 **플레이트 뷰 헤더의 보조 문구**로 이동.
- 그룹 프리셋 버튼(그룹 1~6)은 **선택이 있을 때만** 동작하는 컨트롤이므로, 다음 중 하나일 때만 렌더한다:
  (i) `hasSelection === true` — 저장할 대상이 있다, 또는
  (ii) 저장된 수동 그룹(`manualNames`)이 존재한다 — 필터로 쓸 수 있다.
  둘 다 아니면 `+ 그룹 추가`만 남긴다.
  `AnalysisTab.tsx`의 그룹 필터 바가 이미 `groupNames.length > 0 || hasEmptyWells` 조건을 쓰므로 원칙이 일관된다.

### 3-3. 마커 선택기 상시 노출 (우선순위: 중)

- 마커가 0개인 세션에서도 분석 표면 상단에 **스코프 선택기**를 둔다:
  `[ 전체 플레이트 ] [ + 마커로 분할 ]`
- 마커가 1개 이상이면 현행 `marker-selector-sidebar`가 그대로 이 자리에 들어간다.
- 결과적으로 "전체 플레이트 ↔ 마커1 ↔ 마커2"가 **같은 컨트롤**이 되어, 사용자가 기대한 모델과 일치한다.
- `split-marker-banner`는 이 선택기에 흡수되어 **제거**한다 (배너 1겹 감소).

### 3-4. 결과 우선 그리드 (우선순위: 중)

- `analysis-grid` 컬럼 비율을 1:1에서 **산점도 우세**로 변경 (FB-04와 함께 설계 — 아래 참조).
- `ResultsTable`을 24rem 스크롤 제약에서 풀어, 산점도 옆 또는 바로 아래의 **1급 영역**으로 승격.
- 스크린샷의 유전자형 결과 표는 현재 웰 좌표(`A1`, `A2`…)만 보이고 유전형 값이 비어 있다 —
  분석 전 상태이므로 정상이나, **표의 기본 정렬이 웰 순서**라 "샘플별 유전형"을 읽기 어렵다.
  → 정렬 기준에 `유전형` / `샘플명` 옵션 추가 검토.

> **FB-04와의 경계**: 산점도 자체의 크기·종횡비·인라인 컨트롤은 FB-04가 담당한다.
> FB-03은 **산점도 주변에 무엇이 얼마나 붙는가**를 담당한다. 두 문서의 `analysis-grid` 변경은 **하나의 커밋으로 합쳐야** 한다.

## 4. 변경 범위

| 파일 | 변경 |
|------|------|
| `frontend/src/components/analysis/AnalysisTab.tsx` | 경고 블록 위치, 그룹 필터 바 조건 |
| `frontend/src/components/analysis/AnalysisWorkspace.tsx` | 컨텍스트 요약 접기, 배너 → 스코프 선택기 |
| `frontend/src/components/analysis/WellSelectionToolbar.tsx` | 빈 상태 렌더 억제 |
| `frontend/src/components/analysis/MultiMarkerAnalysisPanel.tsx` | 스코프 선택기 공용화 |
| `frontend/src/components/analysis/ResultsTable.tsx` | 승격, 정렬 옵션 |
| `frontend/src/index.css` | `.analysis-grid`, `.analysis-context-summary`, `.analysis-secondary` 규칙 |
| `frontend/src/locales/{en,ko}.ts` | 스코프 선택기 문구, 경고 배지 문구 |
| 테스트 | `AnalysisTab.assignment.test.tsx`, `AnalysisWorkspace.readiness.test.tsx`, `MultiMarkerAnalysisPanel.requests.test.tsx`, `ResultsTable.keyboard.test.tsx`, 루트 `tests/` E2E |

## 5. 수용 기준

- [ ] 1920x911에서 **스크롤 없이** 산점도 전체와 유전형 요약이 보인다.
- [ ] 분석 경고가 사라지지 않는다 — 상단 배지로 개수가 보이고, 클릭하면 도달한다.
- [ ] 웰 그룹이 정의되지 않은 플레이트에서 그룹 버튼이 렌더되지 않는다.
- [ ] 마커 0개 세션에서도 "전체 플레이트 / 마커로 분할" 선택기가 보인다.
- [ ] 마커 ≥1개 세션의 기존 마커 선택 동작이 회귀하지 않는다.
- [ ] 키보드 내비게이션(`navigateTabs`, `use-keyboard-assignment`)이 유지된다.
- [ ] 접근성: 접힌 `<details>`가 스크린리더에서 도달 가능하고, 경고에 `role="alert"` 성격이 유지된다.

## 6. 테스트 계획

- 단위: 빈 그룹/빈 선택 상태의 렌더 억제, 경고 배지-본문 연결, 스코프 선택기 분기.
- E2E: 마커 0개 → 마커 분할 → 마커 선택 왕복.
- 시각: 1920x911 / 1280px / 400px, 라이트·다크.

## 7. 리스크

- **높음.** 분석 화면은 이 앱에서 테스트가 가장 조밀한 영역이다. `data-testid` 이동이 여러 스펙을 동시에 깬다.
- **품질 탭 복귀 계약**: `lib/quality-navigation.ts`가 `surface: 'plate' | 'analysis'`를 근거로 품질 화면에서
  분석 화면의 특정 표면으로 되돌린다. 워크스페이스 구조를 바꾸면 이 계약이 함께 깨진다 — FB-07과 공동 회귀 대상.
- `split-marker-banner` 제거는 `AnalysisWorkspace.tsx`의 `bannerDismissed` 상태와 세션 전환 시 리셋 로직(render-phase state adjustment)을 함께 제거해야 한다 — 부분 제거 시 죽은 상태가 남는다.
- 경고를 아래로 옮기면 **놓칠 위험**이 생긴다. 배지 강조와 `aria-live` 처리를 반드시 동반할 것.

## 8. 미결정 사항

- **경고 강등 정책 (구현 전 확정 필수)**: 판정 신뢰도에 직결되는 경고를 무조건 하단으로 내리는 것은 안전하지 않다.
  **심각도 등급을 먼저 정의**하고, 상위 등급은 상단에 잔류시키는 규칙이 필요하다.
  예: `blocking`(상단 잔류) / `advisory`(하단 강등). 현재 `analysis-warnings`에는 심각도 구분이 없다 —
  `lib/analysis-warnings.ts`와 백엔드 `warnings` 계약에 등급 추가가 선행되어야 한다.
- `ResultsTable` 기본 정렬 기준 변경 여부 (웰 순서는 플레이트 대조에 유리, 유전형 순서는 판독에 유리).
- FB-04와의 커밋 병합 여부 (권장: 병합).
