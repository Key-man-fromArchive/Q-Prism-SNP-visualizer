# FB-04 — 대립유전자 판별 산점도: 종횡비 · 정규화 · 축 설정

- **피드백 ID**: `7ec0ec1e5e8a4870` · 카테고리 `improvement` · 상태 `open`
- **제출**: 2026-09-11 14:25:58 / page_key `analysis` / 1920x911
- **원문 요지**:
  1. "대립유전자 판별 창이 너무너무 작습니다. 정확히는 세로가 너무 낮습니다. 최소한 이 그래프는 정사각, 하다못해 4:3 세로 직사각형이 나오면 좋겠습니다."
  2. "보다시피 여백이 너무 많은 상황이죠."
  3. "ROX normalisation을 설정페이지에 들어가서 하는데, 이러지말고 대립유전자 판별 플롯 위에 Normalization 체크박스 만들어서 켜고 끌 수 있게. 이때 normalization은 어떤 채널로 할지(99%는 ROX임) 드래그드롭박스로 선택할 수 있게해야합니다."
  4. "X, Y축 최대 최소값을 설정할 수 있어야합니다. 기본은 자동값이지만 '축설정'을 클릭하면 최소 최대값을 텍스트로 입력해서 설정할 수 있어야합니다."
- **스크린샷**: `feedback-shots/7ec0ec1e-2ab387.png`
- **복잡도**: Complex (레이아웃 + 상태 + 백엔드 계약 검토)

## 1. 요구 대비 현행 구현 매트릭스

| 요구 | 현행 | 격차 |
|------|------|------|
| 1. 세로 높이 (정사각~4:3) | 높이 **360px**, 폭 약 940px → 약 **2.6:1 가로 장방형** | **실제 결함** |
| 2. 여백 과다 | 플롯 캔버스가 낮아 범례·여백이 상대적으로 커 보임 | 1의 파생 |
| 3-a. 정규화 체크박스를 플롯 위에 | **이미 존재**하나 접힌 `<details>` 안에 매장 | **발견 가능성 결함** |
| 3-b. 정규화 채널 선택 드롭다운 | **존재하지 않음.** 참조 채널은 임포트 시 역할 매핑으로 고정 | **신규 기능** |
| 4. X/Y 최대·최소 수동 입력 | **이미 존재** (`axis-x-min`/`max`, `axis-y-min`/`max`) — 같은 `<details>` 안 | **발견 가능성 결함** |

> 핵심: 4건 중 2건은 기능이 이미 있는데 **찾을 수 없는 곳에 있다.**
> 스크린샷 상단의 접힌 줄 `▸ 표시·계산 설정 — 펼쳐서 변경 · NTC 기준 · WT (FAM)/MT1 (HEX) · … · 참조 정규화 요청: 아니오; 실제 적용: 아니오` 가 바로 그 `<details>`다.

## 2. 근본 원인 (코드 근거)

### (a) 산점도 높이 — CSS가 1280px 이상에서 오히려 줄인다

`frontend/src/index.css`:

```css
.analysis-scatter-canvas { height: 420px; }                 /* 기본 */

@media (min-width: 1280px) {
  .analysis-scatter-canvas { max-height: 300px; }           /* ← 먼저 300px로 제한 */
  …
  .analysis-scatter-canvas { height: 360px; }               /* ← 이후 360px 지정 */
}
```

같은 미디어쿼리 블록 내에 `.analysis-scatter-canvas` 규칙이 **두 번** 나타나며,
`max-height: 300px`가 여전히 유효하므로 **1280px 이상에서 실제 렌더 높이는 300px**다.
즉 넓은 화면일수록 그래프가 작아진다. 동시에

```css
@media (min-width: 1280px) { .analysis-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
```

로 폭은 절반(1920px 기준 약 940px)을 받는다 → **약 3:1의 납작한 캔버스**.

소비처: `ScatterPlot.tsx`의 `<div className="relative analysis-scatter-canvas">` (내부 플롯은 `height: 100%`),
그리고 `MarkerScatterPlot.tsx`의 동일 클래스. 두 플롯이 같은 규칙을 공유한다.

### (b) 정규화 토글과 축 입력이 `<details>`에 매장

`frontend/src/components/analysis/ScatterViewControls.tsx`:

```tsx
<details data-testid="analysis-advanced-settings" className="analysis-advanced-settings mb-2">
  <summary …>{t.analysisAdvancedSettings} · … · <ScatterReferenceBasis …/> · …</summary>
  <div data-testid="scatter-view-controls" …>
    … 드래그 도구 / 축 범위(axis-mode + x·y min·max) / NTC 오프셋 / NTC 사분면 / 배수성 상한 / 정규화 체크박스 …
```

정규화 체크박스는 `data-testid="scatter-use-rox"`, 축 입력은 `axis-x-min`·`axis-x-max`·`axis-y-min`·`axis-y-max`로 이미 존재한다.
문제는 이 `<div>`가 **6개 컨트롤 그룹을 한 줄로 늘어놓은 접힌 패널**이라는 점이다.
`index.css`의 `.analysis-advanced-settings > div { max-height: 18rem; overflow: auto; }`가 이를 더욱 답답하게 만든다.

사용자가 "설정 페이지에 들어가서 한다"고 인식한 이유: `SettingsTab.tsx`에도 동일한 `useRox` 설정이 있어
**두 곳에 중복 노출**되고, 그중 발견하기 쉬운 쪽이 설정 탭이다.

### (c) 정규화 채널 선택이 없다

`frontend/src/lib/channel-labels.ts`:

```ts
export function channelLabels(metadata, allele2Dye): ChannelLabels {
  return {
    fam: metadata?.channel_labels?.fam || "FAM",
    allele2: metadata?.channel_labels?.allele2 || allele2Dye || "Allele2",
    normalization: metadata?.channel_labels?.normalization ?? null,
  };
}
```

정규화 채널은 **단수 슬롯**이며, 임포트 시점의 역할 매핑(`ImportRole`, `channel_roles`)에서 결정된다.
분석 화면에서 바꿀 수 있는 값이 아니다. `useRox`는 "그 채널로 나눌지 말지"의 **불리언**일 뿐이다.

즉 3-b는 **UI 추가가 아니라 데이터 모델 확장**이다:
런에서 수집된 채널 중 어느 것을 참조로 쓸지 런타임에 재지정하려면 백엔드가
(i) 런의 전체 채널 목록을 내려주고, (ii) 분석 요청이 참조 채널 ID를 받아야 한다.

## 3. 해결 방향

### 3-1. 캔버스 종횡비 (우선순위: 최상)

**먼저 결함 제거**: `index.css`의 1280px 블록에서 `.analysis-scatter-canvas`가 **두 번** 선언된다
(`:166` `max-height: 300px`, `:175` `height: 360px`). 서로 다른 속성이라 뒤 규칙이 앞 규칙을 대체하지 않고
**둘 다 적용**되어 used height가 300px로 눌린다. 중복 선언을 하나로 합친다.

**그다음 종횡비**. 단순히 `aspect-ratio: 4/3; max-height: 70vh`를 얹으면 **요구를 만족하지 못한다**:

| 조건 | 계산 |
|------|------|
| 1920px 뷰포트, 2단 그리드 | 컬럼 폭 약 940px |
| 4:3이면 필요한 높이 | 940 × 0.75 = **705px** |
| 911px 뷰포트의 `70vh` | **638px** |

→ `max-height`가 먼저 걸려 실제 비율은 940:638 ≈ **1.47:1**. 4:3(1.33:1)도, 정사각도 아니다.
**높이를 자르는 방식으로는 종횡비를 보장할 수 없다. 폭을 종횡비에 맞춰 묶어야 한다.**

```css
.analysis-scatter-canvas {
  --scatter-max-h: min(70vh, 640px);          /* 세로 상한 */
  aspect-ratio: 4 / 3;
  height: auto;
  width: 100%;
  max-width: calc(var(--scatter-max-h) * 4 / 3);   /* 상한 높이에서 역산한 폭 */
  min-height: 360px;                           /* Plotly 0-height 마운트 방어 */
  margin-inline: auto;                         /* 남는 폭은 여백으로 */
}
```

- 폭을 `max-width`로 묶으므로 `aspect-ratio`가 **항상 성립**한다. 높이가 잘리지 않는다.
- 640px 상한 기준 폭은 약 853px → 940px 컬럼 안에 들어가고, 남는 약 87px는 좌우 여백이 된다.
- `min-height: 360px`가 마운트 시 0-height를 막는다 (Gemini·Codex 공통 지적).
  좁은 폭(예: 400px 단일 컬럼)에서는 4:3이 300px를 요구하므로 `min-height`가 이겨 세로가 더 길어진다 —
  의도된 동작이며 사용자 요구("세로가 낮다") 방향과 일치한다.
- 정사각(1:1)을 택하면 `aspect-ratio: 1/1`, `max-width: var(--scatter-max-h)` → 폭 640px.
  컬럼 여백이 300px로 커진다. **→ 결정 D-6 참조.**

**Plotly 리사이즈 검증 항목**:
- `aspect-ratio` 컨테이너는 초기 레이아웃 패스에서 높이가 0일 수 있다 → `min-height`로 방어하되,
  `Plotly.react` 호출 시점에 `clientHeight > 0`인지 확인. 필요하면 `ResizeObserver` + `Plotly.Plots.resize`.
- `lockAspect`(`lib/scatter-axes.ts`의 `scaleanchor: 'x'`, `scaleratio: 1`)는 **데이터 축 비율**이고
  캔버스 종횡비와 별개다. 둘 다 켜졌을 때 Plotly가 `constrain: 'domain'`으로 플롯 영역을 더 줄이지 않는지 확인.

### 3-2. 컨트롤 승격 — "플롯 헤더 바" 신설 (우선순위: 상)

`<details>` 안의 6개 그룹을 **사용 빈도**로 분리한다.

```
┌ 대립유전자 판별 ────────────────────────────────────────────┐
│ [☑ 정규화: ROX ▾]   [축: 자동 ▾] [축 설정…]   [선택|편집]    │  ← 신설 헤더 바 (항상 보임)
│ 비율 원점: … (기존 ratio-origin-note)                        │
│                                                             │
│            (4:3 산점도 캔버스)                               │
│                                                             │
│ ▸ 고급 설정 — NTC 사분면 · NTC 오프셋 · 배수성 상한           │  ← 남은 details
└─────────────────────────────────────────────────────────────┘
```

- **항상 보임**: 정규화 체크박스(+채널), 축 모드 드롭다운, `축 설정…` 버튼, 드래그 도구 토글.
- **`축 설정…` 버튼**: 클릭 시 x/y min·max 4개 입력을 **인라인 팝오버**로 연다. 사용자 요구 4번의 문자 그대로.
  열리면 `axisMode`를 자동으로 `manual`로 전환한다 (현재는 `manual`을 먼저 골라야 입력이 활성화됨 — `numberInput(..., !manual)`).
- **접힌 채 유지**: NTC 사분면, NTC 축 오프셋, 배수성 상한 — 전문가용 저빈도 설정.
- `data-testid`는 **모두 보존**한다 (`scatter-use-rox`, `axis-mode`, `axis-x-min` …). 위치만 바뀌고 테스트는 통과해야 한다.

### 3-3. 정규화 중복 노출 정리

- `SettingsTab`의 `useRox` 항목은 **제거하지 않고** "플롯에서 직접 조절" 안내 + 링크로 바꾸거나,
  플롯 헤더가 1급 조작면임을 명시한다. 단일 스토어(`settings-store.useRox`)를 공유하므로 값은 항상 일치한다.
- 결정 필요: 설정 탭에서 완전 제거 vs. 읽기 전용 표시 유지.

### 3-4. 정규화 채널 선택 드롭다운 (우선순위: 중, **별도 작업으로 분리 권장**)

현재 모델로는 불가능하므로 단계적으로 접근한다.

**Step 1 (즉시 가능, 저비용)** — 드롭다운을 **표시하되 현재 채널만** 담는다.
```
[☑ 정규화: ROX ▾]      ← 항목 1개 (현재 참조 채널), 나머지는 disabled + 사유 툴팁
```
사용자에게 "무엇으로 정규화 중인가"를 명시하는 것만으로도 원 요구의 상당 부분을 만족한다.
참조 채널이 없는 런에서는 체크박스가 `disabled`된다 (`hasNormalizationChannel` prop이 이미 존재).

**Step 2 (백엔드 계약 확장 필요)** — 런타임 참조 채널 재지정.
필요한 변경:
- 백엔드: 세션 응답에 **수집된 전체 채널 목록**(id, dye, 현재 role) 노출
- 백엔드: 분석/오버레이/내보내기 요청이 `normalization_channel_id`를 수용
- **저장 모델 확장** — 현재 통합 세션 모델은 `fam` / `allele2` / `reference` 세 슬롯만 보존한다(`app/models.py`).
  임의 채널을 참조로 쓰려면 **원시 채널 RFU 전체를 보존하도록 저장 구조를 넓혀야** 한다.
  요청 필드 추가만으로는 동작하지 않는다. (리뷰 지적)
- 처리 계층: `app/processing/normalize.py`의 `_normalization_value()`가
  `reading.normalization_value` → `reading.rox` 폴백 체인을 **하드코딩**하고 있다. 채널 재지정 시 이 파일이 변경 범위에 들어간다. (리뷰 지적 — 초안 누락)
- 무효화: `AnalysisContext`에 `result_revision` / `input_revision`이 **이미 존재**한다(`app/models.py:380,389`).
  새 무효화 체계를 만들 필요 없이 **기존 revision 입력에 참조 채널 축을 추가**하면 된다. (리뷰 지적 — 초안 누락)
- 프론트: `settings-store`에 채널 ID 보관, `analyzeCurrent` 요청 페이로드 확장

**Step 2는 이 문서의 범위를 넘어서므로 별도 기획/승인 대상이다.**

## 4. 변경 범위

| 파일 | 변경 | 단계 |
|------|------|------|
| `frontend/src/index.css` | `.analysis-scatter-canvas` **중복 선언 제거**(:166/:175) + 폭 기반 `aspect-ratio` | 3-1 |
| `frontend/src/components/analysis/ScatterViewControls.tsx` | 헤더 바 / 고급 설정 분리, 축 설정 팝오버 | 3-2 |
| `frontend/src/components/analysis/ScatterPlot.tsx` | 헤더 바 슬롯 배치, 리사이즈 확인 | 3-1,3-2 |
| `frontend/src/components/analysis/MarkerScatterPlot.tsx` | 동일 (같은 클래스/컨트롤 공유) | 3-1,3-2 |
| `frontend/src/components/settings/SettingsTab.tsx` | `useRox` 중복 정리 | 3-3 |
| `frontend/src/locales/{en,ko}.ts` | `축 설정…`, 정규화 채널 라벨 | 3-2 |
| 테스트 | `ScatterViewControls.test.tsx`, `ScatterPlot.requests.test.tsx`, `MarkerScatterPlot.export.test.tsx`, `SettingsTab.test.tsx` | 전체 |
| **백엔드** | Step 2에 한해 `app/models.py`(`UnifiedData` 채널 슬롯, `ClusteringRequest`), `app/routers/clustering.py`, `app/processing/normalize.py`, `app/role_labels.py` | 3-4 Step 2 |

## 5. 수용 기준

- [ ] 1920x911에서 캔버스 `boundingBox()`의 width/height 비가 **4:3 ± 2%** 다 (300px로 눌리지 않는다).
- [ ] 1280px / 768px / 400px에서 캔버스가 뷰포트 세로를 넘지 않으면서도 종횡비를 유지한다.
- [ ] 마운트 직후 캔버스 높이가 0이 아니어서 Plotly가 정상 렌더된다.
- [ ] 정규화 체크박스가 **펼치는 동작 없이** 플롯 위에 보인다.
- [ ] 참조 채널명(예: `ROX`)이 체크박스 옆에 표시된다. 참조 채널이 없는 런에서는 비활성 + 사유가 보인다.
- [ ] `축 설정…` 클릭 → x/y min·max 4개 입력 즉시 편집 가능 (축 모드를 먼저 바꿀 필요 없음).
- [ ] 기존 `data-testid`가 모두 유지되어 기존 단위 테스트가 통과한다.
- [ ] `lockAspect` 체크 시 데이터 축 비율 고정 동작이 회귀하지 않는다.
- [ ] 다크 모드에서 헤더 바 대비가 유지된다.
- [ ] 두 플롯(`ScatterPlot`, `MarkerScatterPlot`)이 **동일한** 컨트롤을 갖는다 (현행 계약 유지).

## 6. 테스트 계획

- 단위: 축 설정 팝오버가 `axisMode`를 `manual`로 전환하는지, 입력이 `settings-store.setAxisRange`에 반영되는지.
- 단위: `hasNormalizationChannel === false`일 때 체크박스 비활성 + 사유 노출.
- 시각/E2E: 1920x911에서 캔버스 실측 높이가 `min-height` 이상인지 Playwright `boundingBox()`로 단언.
- 회귀: `plot-cleanup.test.tsx` (Plotly purge), `ScatterPlot.requests.test.tsx` (요청 발생 조건).
- **내보내기 캡처 크기**: 캔버스 종횡비가 바뀌면 PNG/PDF 산출물의 이미지 크기도 바뀐다.
  `hooks/use-exports.ts`의 캡처 로직이 캔버스 실측 크기를 쓰는지 고정값을 쓰는지 **미검증** — 착수 시 확인 필요. (리뷰 지적)

## 7. 리스크

- **중간~높음.**
- `aspect-ratio` 도입 시 Plotly가 마운트 시점 0-height를 관측하면 빈 캔버스가 남는다. `min-height`를 반드시 병기.
- **`max-height`로 종횡비를 보장하려는 시도는 실패한다** (3-1의 계산). 폭을 묶는 방식으로만 성립한다.
- `<details>` 분해는 `analysis-advanced-settings` summary 문자열을 단언하는 테스트를 깬다.
- `SettingsTab`에서 `useRox`를 제거하면 `SettingsTab.test.tsx` / `apply-preset.test.ts` / 프리셋 저장 경로가 영향받는다.
  프리셋은 `useRox` 값을 담을 수 있으므로 **스토어 필드 자체는 절대 제거하지 말 것.**
- FB-03이 `analysis-grid` 컬럼 비율을 바꾸므로 캔버스 폭이 달라진다 → **FB-03과 함께 측정해야 한다.**

## 8. 미결정 사항

- **D-6 목표 종횡비**: 정사각(1:1) vs 4:3. 문서는 4:3을 채택했으나 사용자는 "정사각"을 먼저 언급했다.
  911px 뷰포트에서 정사각은 폭 640px(컬럼 여백 300px), 4:3은 폭 853px(여백 87px). **여백 대 비율의 트레이드오프 선택 필요.**
- 세로 상한값 `min(70vh, 640px)`의 구체 수치 — 툴바/헤더 높이 실측 후 확정.
- `SettingsTab`의 `useRox` 처리: 제거 / 읽기 전용 / 현행 유지.
- **3-4 Step 2(참조 채널 재지정)의 착수 여부** — 백엔드 계약 변경이므로 별도 승인 필요.
