# FB-07 — 제품 정체성 + 정보구조: 명칭 · 탭 구성 · 컬러

- **피드백 ID**: `36be23963de2477d` · 카테고리 `improvement` · 상태 `open`
- **제출**: 2026-09-11 14:32:20 / page_key `analysis` (가장 최근)
- **원문**:
  > 탭의 이름이 분석보다는 결과가 나을 것 같습니다.
  > 플레이트 설정은 아예 따로 빼버리고요.
  > 사실 가장 먼저 보는 페이지가 '플레이트 설정' 그리고 Raw data, 그 다음 탭으로 '결과분석' 탭 순서면 좋겠네요.
  > 결과 분석에 맞는 UI 레이아웃도 필요하구요.
  > 그리고 사이트 페이지 전체의 UI가 너무 촌스럽습니다. Q-Prism의 컬러에 맞게 컬러링을 합시다.
  > 또한 ASG-PCR SNP 판별 분석기는 너무 이름이 프로젝트명 같습니다.
  > Q-Prism(R) Cluster Caller 정도의 이름으로 섹시하게 가봅시다.
- **스크린샷**: `feedback-shots/36be2396-70f0bc.png`
- **복잡도**: Complex (**제품 결정 + 전역 변경**)

## 1. 요구 분해

| # | 요구 | 유형 |
|---|------|------|
| a | 상위 탭 순서: 플레이트 설정 → Raw data → 결과분석 | 정보구조 |
| b | "분석" → "결과" 명명 변경 | 정보구조 |
| c | 플레이트 설정을 워크스페이스 하위 탭에서 최상위로 승격 | 정보구조 |
| d | 결과 분석에 맞는 레이아웃 | → **FB-03에서 처리** |
| e | Q-Prism 컬러 적용 | 브랜드 (**정의 부재**) |
| f | 제품명 `Q-Prism® Cluster Caller` | 브랜드 (**결정 필요**) |

## 2. 현행 정보구조 (코드 근거)

### 2겹 탭 구조

**상위 탭** — `frontend/src/components/layout/TabNavigation.tsx`:

```tsx
const tabs: Tab[] = [
  { id: 'analysis',   label: 'Analysis',    dataTab: 'analysis' },
  { id: 'protocol',   label: 'Protocol',    dataTab: 'protocol' },
  { id: 'settings',   label: 'Settings',    dataTab: 'settings' },
  { id: 'quality',    label: 'Quality',     dataTab: 'quality' },
  { id: 'statistics', label: 'Statistics',  dataTab: 'statistics' },
  { id: 'compare',    label: 'Compare Runs',dataTab: 'compare' },
  { id: 'library',    label: 'Library',     dataTab: 'library',    sessionFree: true },
  { id: 'project',    label: 'Project',     dataTab: 'project',    sessionFree: true },
  { id: 'references', label: 'References',  …, overflow: true },
  { id: 'users',      label: 'Users',       …, adminOnly: true, overflow: true },
  { id: 'feedback',   label: 'Feedback',    …, adminOnly: true, overflow: true },
];
```

**하위(워크스페이스) 탭** — `frontend/src/components/analysis/AnalysisWorkspace.tsx`:

```tsx
function WorkspaceTabs() {
  return (['plate', 'analysis'] as const).map(surface => <button … >
    {surface === 'plate' ? t.wsTabPlate : t.wsTabAnalysis}
  </button>);
}
```

→ 사용자는 `분석` 탭을 누른 뒤 **다시** `플레이트 설정` 하위 탭을 눌러야 한다.
가장 먼저 하는 작업이 두 번째 계층에 묻혀 있다. 사용자 지적(c)이 정확하다.

### 라벨 소스

`locales/ko.ts`: `tabAnalysis: '분석'`, `tabProtocol: '프로토콜'`, `wsTabPlate: '플레이트 설정'`, `wsTabAnalysis: '분석'`
`locales/en.ts`: 대응 영문. `Translations` 타입이 키 동기화를 강제한다.
제품명: `appTitle: 'ASG-PCR SNP 판별 분석기'` / `'ASG-PCR SNP Discrimination Analyzer'`, 그리고 `index.html`의 `<title>`·OG 태그.

### 색 토큰

`frontend/src/index.css`:
```css
@theme {
  --color-bg: #f5f7fa;  --color-surface: #ffffff;  --color-border: #e0e4e8;
  --color-text: #1a1a2e; --color-text-muted: #6b7280;
  --color-primary: #2563eb;  --color-primary-hover: #1d4ed8;
  --color-fam: #2563eb;      --color-allele2: #dc2626;
  --color-accent: #10b981;   --color-danger: #ef4444;
  --color-success: #10b981;  --color-warning: #f59e0b; --color-info: #2563eb;
}
body.dark { /* 동일 토큰 재정의 */ }
```

`--color-primary: #2563eb`는 **Tailwind 기본 blue-600**이다. 브랜드 색이 아니라 프레임워크 기본값이다.
사용자가 "촌스럽다"고 한 것의 물리적 근거가 이것이다.

**그리고 리포지토리 전체에 "Q-Prism 컬러"의 정의가 존재하지 않는다.**
`README.md:11`은 "Q-Prism®은 프로젝트 명칭이며 Applied Biosystems/Thermo Fisher/Bio-Rad와 무관"이라고만 밝힌다.

추가로, 차트 색은 CSS 토큰을 쓰지 않고 `frontend/src/lib/plotly-theme.ts`에 HEX로 **따로 하드코딩**되어 있다:
```ts
paper_bgcolor: dark ? "#1a1d27" : "#ffffff",
gridColor: dark ? "#2d3040" : "#e5e7eb", …
```
→ 팔레트를 바꿔도 차트는 따라오지 않는다. **색 체계가 두 군데로 갈라져 있다.**

## 3. 해결 방향

### 3-1. 정보구조 재편 (요구 a/b/c)

```
현재 상위 탭                      변경안 상위 탭
──────────────────────────       ─────────────────────────────────
분석  (└ 플레이트 설정 / 분석)     플레이트 설정      ← 워크스페이스에서 승격
프로토콜                          Raw data          ← 프로토콜 확장 (FB-05/06)
설정                              결과              ← 구 '분석'
품질                              품질
통계                              통계
비교                              비교
라이브러리                        라이브러리
프로젝트                          프로젝트
⋯ 더보기 (참고자료/사용자/피드백)   ⋯ 더보기 (설정/참고자료/사용자/피드백)
```

주요 판단:
- `설정`을 더보기로 강등한다. FB-04가 정규화·축 설정을 플롯 헤더로 올리면 설정 탭의 사용 빈도가 크게 떨어진다.
- 워크스페이스 2단 탭(`WorkspaceTabs`)을 **제거**한다. 하위 계층이 사라지므로 FB-03의 수직 과밀도 1겹 줄어든다.
- `TabId` 타입 변경: `'analysis'` → `'results'`, `'protocol'` → `'rawdata'`, `'plate'` 신설.

> **호환성 주의 (리뷰에서 정정됨)**: `navigation-store`는 **persist하지 않는다.**
> 위치가 살아남는 실제 경로는 두 가지다:
> - **URL** — `lib/workspace-history.ts`가 탭/표면을 쿼리 문자열에 기록하고 `use-workspace-location.ts`가 동기화한다
> - **`session-store.sessionQueries`** — 열린 세션별 쿼리 문자열이 `sessionStorage`에 persist된다 (`qprism-file-workspace`)
>
> 따라서 필요한 것은 **스토어 마이그레이션이 아니라 legacy URL 파싱 + canonical rewrite**다:
> 구 탭 id(`analysis`, `protocol`)를 담은 URL/저장 쿼리를 읽어 신 id로 매핑하고, 주소를 새 형태로 바꿔 쓴다.
> 알 수 없는 id에 대한 **크래시 방지 폴백은 이미 구현되어 있다** — `navigation-store.ts`의 `parseNavigation`이
> `tab()` 타입가드로 미지의 값을 `domain.defaults.tab`으로 되돌린다(:25, :32-36, :56).
> 따라서 새로 만들 것은 폴백이 아니라 **구 id → 신 id 의미 보존 매핑**이다. 폴백만으로는
> 북마크된 `?tab=analysis&surface=plate`가 "결과" 탭이 아니라 기본 탭으로 떨어져 **사용자 의도가 유실**된다.

> **범위 경고**: `analysis` 문자열은 `App.tsx`의 `main-panel-analysis`, `AnalysisWorkspace`의 `workspace-panel-*`,
> `FeedbackWidget`의 `pageKey`, 루트 Playwright 스펙 다수에 퍼져 있다.
> **id는 유지하고 라벨만 바꾸는 최소안**도 유효한 선택지다 (아래 3-1-b).

**3-1-a (전면 재편)**: id·라벨·순서 모두 변경. 정합성 최상, 회귀 위험 최고.
**3-1-b (라벨·순서만)**: `TabId`는 그대로 두고 `tabLabels` 매핑과 `tabs` 배열 순서만 변경.

> **정정 (리뷰 반영)**: **3-1-b만으로는 요구를 만족할 수 없다.**
> 사용자는 `플레이트 설정`을 **독립된 최상위 탭**으로 요구했는데, 현재 `plate`는 최상위 `TabId`가 아니라
> `navigation-store`의 `surface` 값이다. 최상위 탭 두 개(Plate / Results)를 표현하려면
> **새 탭 id가 반드시 필요하다.**
>
> 따라서 **3-1-a로 가되**, 다음 매핑을 명시적으로 정의한다:
>
> | 신 최상위 탭 | 구 상태 | 함께 갱신할 계약 |
> |---|---|---|
> | `plate` | `tab='analysis'` + `surface='plate'` | `quality-navigation.ts`의 복귀 표면, feedback `page_key` |
> | `results` | `tab='analysis'` + `surface='analysis'` | 동일 |
> | `rawdata` | `tab='protocol'` | feedback `page_key` |
>
> `surface` 개념은 최상위 탭으로 흡수되어 **제거**되거나, 내부적으로만 남고 UI에서 사라진다.
> `App.tsx`의 `main-panel-analysis`, `AnalysisWorkspace`의 `workspace-panel-*`,
> `FeedbackWidget`의 `pageKey`, 루트 Playwright 스펙이 모두 영향권이다.

### 3-2. 제품명 (요구 f)

사용자 제안: `Q-Prism® Cluster Caller`

변경 지점:
| 위치 | 현재 |
|------|------|
| `locales/ko.ts` `appTitle` | `ASG-PCR SNP 판별 분석기` |
| `locales/en.ts` `appTitle` | `ASG-PCR SNP Discrimination Analyzer` |
| `frontend/index.html` `<title>` | `ASG-PCR SNP Discrimination Analyzer` |
| `index.html` `og:title` / `description` / `keywords` / `canonical` | ASG-PCR 중심 |
| `README.md` | `Q-Prism® SNP Visualizer` (또 다른 이름) |
| 내보내기 산출물(PDF/PNG 헤더) | `app/reporting/` 확인 필요 |

> **결정됨 (2026-09-11)**: `Q-Prism® Cluster Caller` 채택. `Q-Prism`은 인바이러스테크 자사 저작물이므로
> `®` 표기를 사용한다. 사용자(인바이러스테크) 확인 완료.

**주의 사항:**
1. ~~® 기호 사용 가능 여부~~ — **해결.** 자사 저작물이므로 사용 가능.
   단, `README.md:11`의 "Q-Prism®은 프로젝트 명칭이며 Applied Biosystems/Thermo Fisher/Bio-Rad와 무관"이라는
   **면책 문구는 유지한다** — 타사 상표와의 혼동 방지 목적이므로 자사 소유권과 무관하게 여전히 유효하다.
2. 현재 리포지토리에 **세 가지 이름**이 공존한다: `ASG-PCR SNP 판별 분석기`(UI), `Q-Prism® SNP Visualizer`(README), `SNP analyzer`(컨테이너/경로).
   이번 기회에 **하나로 통일**해야 한다.
3. SEO: `canonical` `https://snpanalyze.ivttools.com/`와 키워드가 ASG-PCR 기반이다. 명칭 변경 시 검색 유입 영향 검토.
4. ASG 플랫폼 연동 문구(`Save result to ASG Designer`, `backToAsgDesigner`)는 **상대 시스템의 이름**이므로 유지한다.

### 3-3. 브랜드 팔레트 (요구 e) — **정의부터 필요**

"Q-Prism 컬러"가 코드에도 문서에도 없으므로, 두 갈래다.

**(i) 브랜드 가이드가 존재하는 경우** → HEX 값을 제공받아 토큰에 매핑.
**(ii) 존재하지 않는 경우** → 팔레트를 **설계해야 하며, 이는 승인 대상이다.**

(ii)를 위한 제안 방향 (프리즘 = 빛의 분광):
- 주색(primary): 현행 범용 파랑에서 벗어난 **딥 인디고~바이올렛** 계열. 스펙트럼의 단파장 끝을 브랜드 앵커로.
- 보조(accent): 스펙트럼 반대편의 **앰버/시안**. 강조·성공 상태에 사용.
- 중립(neutral): 현행 `#f5f7fa`/`#1a1a2e`보다 약간 따뜻한 중립 램프. "촌스러움"의 상당 부분은 채도 0의 회색 + 순수 파랑 조합에서 온다.

**절대 준수 제약:**
1. **`--color-fam`과 `--color-allele2`는 브랜드 색으로 바꾸지 않는다.**
   FAM/HEX 채널 색은 qPCR 관례이며 실험자의 판독 습관에 직결된다. 브랜드보다 과학적 관례가 우선한다. (→ 결정 D-4)
2. **대비비 유지**: 본문 텍스트 4.5:1, UI 요소 3:1 (WCAG AA). 현행 `#1a1a2e` on `#f5f7fa`는 약 15:1로 여유가 크다 — 새 팔레트가 이를 깎지 않도록 검증.
3. **상태색 의미 보존**: 경고=앰버, 위험=적, 성공=녹. 브랜드 색과 충돌하면 브랜드를 양보한다.
4. **다크 모드 동시 정의**: `@theme`과 `body.dark` 두 블록을 **함께** 갱신.

### 3-4. 색 체계 단일화 (선행 기술 부채 해소)

`plotly-theme.ts`의 하드코딩 HEX를 CSS 토큰 읽기로 전환한다:

```ts
const read = (name: string) => getComputedStyle(document.body).getPropertyValue(name).trim();
export function plotlyColors() {
  return {
    paper_bgcolor: read('--color-surface'),
    plot_bgcolor:  read('--color-surface'),
    fontColor:     read('--color-text'),
    gridColor:     read('--color-border'),
    …
  };
}
```

→ 이후 팔레트 변경이 **한 곳**에서 끝난다. **3-3 착수 전에 이 리팩터링을 먼저 하는 것을 강력히 권장한다.**

**단, Plotly만이 아니다 (리뷰 지적).** HEX가 하드코딩된 곳이 더 있다:
- `frontend/src/lib/constants.ts` — 유전형/웰 타입 색 상수
- `frontend/src/lib/genotype.ts` — `wellInfo()`가 반환하는 색
- `frontend/src/components/protocol/ProtocolTab.tsx:13-27` — `PHASE_COLORS` / `AMP_COLORS`
- `app/reporting/pdf_builder.py` — PDF 산출물의 브랜드 문자열·색

→ 팔레트 작업의 실제 범위는 `index.css` + `plotly-theme.ts`가 아니라 **위 다섯 곳 전부**다.
초안이 이를 과소평가했다.
> **다크모드 전환 레이스 (FB-04·FB-06 공통 주의)**: `body`에 `transition: background-color 0.3s`가 걸려 있으므로
> 테마 토글 직후 `getComputedStyle`이 **전환 중간값**을 읽을 수 있다. `plotlyColors()`를 토큰 읽기로 바꿀 때
> 전환 완료 후 재렌더하거나, 전환 대상이 아닌 별도 토큰에서 읽도록 해야 한다.
> 이 위험은 **Plotly를 쓰는 모든 차트**(산점도·마커 산점도·증폭 오버레이·향후 프로토콜 다이어그램)에 공통 적용된다.

## 4. 변경 범위

| 파일 | 변경 | 단계 |
|------|------|------|
| `frontend/src/components/layout/TabNavigation.tsx` | 탭 순서/라벨/overflow 재배치 | 3-1 |
| `frontend/src/components/analysis/AnalysisWorkspace.tsx` | `WorkspaceTabs` 제거, 플레이트 승격 | 3-1 |
| `frontend/src/App.tsx` | 탭 라우팅, 패널 마운트 | 3-1 |
| `frontend/src/stores/navigation-store.ts` | 탭 id 마이그레이션/폴백 | 3-1 |
| `frontend/src/hooks/use-workspace-location.ts` | 위치 동기화 | 3-1 |
| `frontend/src/locales/{en,ko}.ts` | `appTitle`, 탭 라벨 | 3-1,3-2 |
| `frontend/index.html` | title / OG / keywords / favicon | 3-2 |
| `README.md` | 명칭 통일 | 3-2 |
| `frontend/src/lib/plotly-theme.ts` | CSS 토큰 읽기로 전환 | 3-4 |
| `frontend/src/index.css` | `@theme` + `body.dark` 팔레트 | 3-3 |
| `app/reporting/` | 내보내기 산출물 브랜딩 | 3-2 |
| 테스트 | `TabNavigation.keyboard.test.tsx`, `navigation-store.test.ts`, `workspace-location.test.ts`, 루트 E2E 전반 | 전체 |

## 5. 수용 기준

- [ ] 상위 탭 순서가 `플레이트 설정 → Raw data → 결과 → …`다.
- [ ] 플레이트 설정이 **1회 클릭**으로 도달된다 (하위 탭 경유 없음).
- [ ] **구 URL**(`?tab=analysis&surface=plate` 형태)로 진입해도 새 IA의 올바른 탭으로 매핑되고, 주소가 canonical 형태로 다시 쓰인다.
- [ ] `session-store.sessionQueries`에 저장된 구 쿼리 문자열도 동일하게 매핑된다.
- [ ] 알 수 없는 탭 id는 기본 탭으로 폴백한다 (기존 `parseNavigation` 타입가드 동작 유지 — 회귀 없음 확인).
- [ ] 품질 탭에서 웰로 되돌아가는 경로(`quality-navigation.ts`)가 새 탭 구조에서 동작한다.
- [ ] 피드백 위젯의 `page_key`가 새 탭 id를 기록한다 (과거 데이터와의 구분 가능).
- [ ] `en`/`ko` 양쪽 라벨이 번역되고 타입 체크를 통과한다.
- [ ] 제품명이 UI·`<title>`·OG·내보내기 산출물에서 **일관**된다.
- [ ] 팔레트 변경 후 본문 대비비가 WCAG AA를 만족한다 (라이트·다크 모두).
- [ ] `--color-fam` / `--color-allele2`의 채널 의미가 유지된다.
- [ ] Plotly 차트 색이 앱 팔레트와 일치한다 (3-4 이후).
- [ ] `constants.ts` / `genotype.ts` / `ProtocolTab.tsx` / `pdf_builder.py`의 색·브랜드 문자열이 함께 갱신된다.
- [ ] 키보드 탭 내비게이션(`navigateTabs`, `tab-keyboard.ts`)이 새 순서에서 동작한다.

## 6. 테스트 계획

- 단위: 탭 순서/overflow 분류, **legacy URL → 신 탭 id 매핑**(폴백이 아니라 의미 보존), `plotlyColors()`가 토큰을 읽는지.
- 회귀: `TabNavigation.keyboard.test.tsx:7,10,14`가 `activeTab="analysis"` / `main-panel-analysis` / `'protocol'` 리터럴을 직접 단언한다 — id 변경 시 확실히 깨진다.
- 접근성: `role="tablist"` / `aria-selected` / `tabIndex` roving 유지, 대비비 자동 검사.
- E2E: 전체 스펙의 탭 셀렉터 일괄 갱신 (**작업량이 가장 큰 부분**).
- 시각: 라이트/다크 × 1920/1280/400px 스크린샷 비교.

## 7. 리스크

- **최고.** 이 문서의 변경은 앱 전역에 닿는다.
- 탭 라벨/셀렉터 변경은 루트 `tests/`의 Playwright 스펙 대부분을 깬다. **범위 승인(D-5) 없이 착수하면 안 된다.**
- 팔레트 변경은 시각 회귀 기준선을 전부 무효화한다.
- `WorkspaceTabs` 제거는 `navigation-store.surface`, `lib/quality-navigation.ts`(복귀 표면 계약),
  `session-view-cache`, `workspace-restore`, `workspace-history` 경로에 연쇄한다.
- 피드백 `page_key`가 바뀌면 이번 7건처럼 **기존 피드백 데이터의 page_key와 새 데이터가 달라진다** — 분석 시 유의.
- 제품명 변경은 되돌리기 비용이 큰 대외 노출(SEO/OG/문서)을 포함한다.

## 8. 미결정 사항 (전부 블로킹)

| ID | 질문 |
|----|------|
| ~~**D-1**~~ | **해결 (2026-09-11)** — `Q-Prism® Cluster Caller` 채택. `®` 사용 가능(자사 저작물). README의 `Q-Prism® SNP Visualizer`는 이 이름으로 통일한다. |
| **D-2** | Q-Prism 브랜드 팔레트 HEX 값. 기존 가이드가 있는가, 신규 설계가 필요한가? |
| **D-4** | `--color-fam`/`--color-allele2`를 브랜드 색으로 바꿀 것인가? (권장: 유지) |
| **D-5** | 탭 id 전면 변경(3-1-a) 범위 승인. 리뷰 결과 **3-1-b(라벨만)로는 요구 충족 불가**로 판정됨. E2E 대량 수정 동반. |
| — | `설정` 탭 강등 동의 여부 |
| — | SEO/canonical 변경 허용 범위 |
