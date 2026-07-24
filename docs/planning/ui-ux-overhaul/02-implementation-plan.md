# Q-Prism SNP Visualizer — UI/UX 개선 구현계획 (Implementation Plan)

- 문서 상태: Draft v0.3 (codex 계획 리뷰 R1·R2 반영)
- 작성일: 2026-07-24
- 상위 문서: `docs/planning/ui-ux-overhaul/01-prd.md` (v0.3+, codex R1·R2·R3 반영, Phase 0·1 근거 승인)
- 대상: `snp-analyzer/frontend` (React 19 + Tailwind v4 + Zustand + Plotly + lucide)

이 문서는 PRD의 요구사항(FR-*/NFR-*)을 **파일 단위 작업(Task)** 으로 전개한다. 각 Task는 `대상 파일 · 변경 요지 · 수용 기준(AC) · 테스트 · 의존성`을 명시한다. 태스크 ID는 `T<phase>.<n>`.

---

## 0. 공통 규약 & 사전 준비 (Prerequisites)

### 0.1 코딩 규약

- 색·간격·타이포·컴포넌트는 토큰/프리미티브에서만. 데이터 구동 색(Plotly 시리즈, 웰 유전형/클러스터 색)만 예외(PRD §5 P1).
- 아이콘은 lucide-react. 콘텐츠 글리프 화이트리스트는 §T0.4 참조.
- 기존 `id`/`data-testid` 보존(PRD §P8). 불가피 변경 시 대응 e2e 동시 수정.
- 사용자 대면 문자열은 `use-i18n` 키 경유(`locales/en.ts`+`ko.ts` 동시). 로케일 문자열에 아이콘 글리프 금지.

### 0.2 테스트 인프라 도입 (T0.0, Phase 0 선행)

- 대상: `snp-analyzer/frontend/package.json`, 신규 `vitest.config.ts`, `src/test/setup.ts`.
- 변경: `vitest`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom` devDependency 추가. `"test": "vitest run"`, `"test:watch": "vitest"` 스크립트 추가. Vite alias(`@`)를 vitest에 반영.
- AC: `npm run test`가 예시 스모크 테스트(프리미티브 1개)로 통과. 기존 `npm run build`/`lint`/`e2e` 무영향.
- 의존성: 없음(가장 먼저).

### 0.3 회귀 QA 파이프라인 (상시)

- 격리 컨테이너 빌드(`docker build -t qprism-current snp-analyzer`) + Playwright 캡처 스크립트(기획 과정 산출물 재사용)로 단계별 before/after 스크린샷 확보.
- QA 매트릭스: 12화면 × {라이트,다크} × {한,영}. 각 Phase 종료 시 실행.

### 0.4 정적 게이트 (M2 실현)

**반드시 `snp-analyzer/frontend`를 cwd로** 아래 게이트가 0(화이트리스트 제외)임을 확인. `rg`(ripgrep) 기준, 이스케이프/엔티티/유니코드 이스케이프를 모두 포함한다. (아래 패턴은 최소 기준이며, 구현 시 소스 기반으로 인벤토리를 재확정한다 — R1 리뷰에서 정규식이 `Header.tsx:282`·`CycleControl.tsx:176`의 이스케이프 아이콘, `▲/▼`, `GroupManager.tsx:90`의 닫기 ×, `CompareTab`/`MultiMarkerAnalysisPanel`/`BatchTab`의 raw 색을 놓칠 수 있음을 확인.)

```
cd snp-analyzer/frontend
# 1) 미정의 CSS 변수 (정의된 --color-* 는 대상 아님)
rg -n "var\(--(border|bg|primary|accent|text-muted)\)" src            # 인라인 style
rg -n "\[var\(--(border|bg|primary|accent|text-muted)\)\]" src        # Tailwind arbitrary
# 2) 아이콘용 이모지/엔티티/유니코드 (콘텐츠 화이트리스트 제외)
#    - 리터럴 이모지/기호, HTML 엔티티, \uXXXX 및 서로게이트 페어(📷 등) 모두 포함
rg -n "🎯|📏|🔗|📁|📷|⚠|ℹ|✎|✕|▲|▼|◀|▶|←|→|&#[0-9]+;|&#x[0-9A-Fa-f]+;|&times;|&larr;|&rarr;|\\\\u[0-9A-Fa-f]{4}" src
rg -np "[\x{1F000}-\x{1FAFF}\x{2190}-\x{27BF}\x{2B00}-\x{2BFF}]" src   # 리터럴 이모지/기호 유니코드 블록
# 3) raw 상태 팔레트 (text|bg|border|ring 유틸 전부; §5 예외 화이트리스트 제외)
rg -n "(text|bg|border|ring)-(green|red|amber|blue|gray)-[0-9]{2,3}|bg-(red|green|amber)-(50|100)" src
# 4) 하드코딩 hex 색 (데이터 구동 예외 화이트리스트 제외)
rg -n "#[0-9a-fA-F]{6}\b" src
```

화이트리스트(교체 대상 아님)는 구현 중 최종 확정하여 §6에 목록화:
- 콘텐츠 글리프: `KeyboardHelpOverlay` 단축키 표기, `χ²`·통계 기호.
- 데이터 구동 색 예외: `ScatterPlot`/`WellDetailPanel`/`PlateView`/`ProtocolTab`/`QcBadges`의 Plotly 시리즈·유전형/클러스터·프로토콜 스테이지 색 매핑(단, 정적 UI 색은 토큰화).

---

## 1. Phase 0 — 즉시 안정화 (P0)

목표: "고장 나 보이는" 결함 제거. 회귀 위험 최소. 최소 프리미티브 시드로 P0 의존성 해소.

### T0.1 — 최소 프리미티브 시드 (FR-DS-1a)

- 대상(신규): `src/components/shared/ui/Button.tsx`, `IconButton.tsx`, `Menu.tsx`, `StatusState.tsx`, `index.ts`. (`cn` 유틸은 기존 `lib/utils.ts` 사용, class-variance-authority 이미 의존성에 있음.)
- 변경:
  - `Button`: variant(primary/secondary/ghost/danger) × size(sm/md), `whitespace-nowrap`, disabled/loading, 토큰 색만 사용, 다크모드 자동.
  - `IconButton`: 아이콘 전용, 필수 `aria-label`, 포커스 링, disabled.
  - `Menu`: 트리거 + 팝오버 리스트(내보내기용). 키보드(↑↓/Enter/Esc), 외부 클릭 닫기, `role="menu"`.
  - `StatusState`: `variant=loading|empty|error`, 아이콘+메시지+선택적 액션 버튼.
- AC: 각 컴포넌트 Vitest 단위 테스트(렌더, variant class, disabled, aria, 키보드). 라이트/다크 스냅샷 시각 확인.
- 의존성: T0.0.

### T0.2 — 미정의 CSS 변수 교정 (FR-DS-3)

프로퍼티별 치환 규칙:

| 잘못된 참조 | 치환 |
| :-- | :-- |
| `borderColor/border: var(--border)` | `border-border` 클래스 또는 `var(--color-border)` |
| `background/bg-[var(--bg)]` | `bg-bg` 또는 `var(--color-bg)` |
| `color: var(--text-muted)` | `text-text-muted` 또는 `var(--color-text-muted)` |
| `var(--primary)` / `var(--accent)` | `var(--color-primary)` / `var(--color-accent)` |

- 대상(R1 확인, 총 **14곳**; 구현 시 rg로 프로퍼티·정의여부 재확정, 정의된 `--color-*` 참조는 대상 아님): `AnalysisTab.tsx`(314,346,374,386,395,420 — 6), `ResultsTable.tsx`(109), `GroupManager.tsx`(113), `UploadZone.tsx`(416,594,615,636,640,644 — 6).
- AC: §0.4 게이트(1) 0. 라이트/다크에서 테두리·배경·머티드 텍스트가 토큰색으로 정상 렌더(회귀 스크린샷 비교).
- 의존성: 없음(독립). 우선 착수 가능.

### T0.3 — 산점도/플레이트/웰상세/결과표 상태 UI + 백지 근인 조사 (FR-ST-1, FR-ST-3)

- 대상: `ScatterPlot.tsx`, `PlateView.tsx`, `WellDetailPanel.tsx`, `ResultsTable.tsx`, 그리고 멀티마커 경로 `MultiMarkerAnalysisPanel.tsx`의 대응 렌더 지점.
- **요청-상태 소유 설계(선행 결정)**: 현행 데이터 흐름이 컴포넌트마다 다르다 — `ScatterPlot`/`PlateView`는 자체 fetch하며 에러를 `console.error`로 삼킴(`ScatterPlot.tsx:81-88`, `PlateView.tsx:50-64`), `ResultsTable`은 fetch 없이 scatter-store 파생(`ResultsTable.tsx:43-58`), `WellDetailPanel`은 선택 후에만 fetch. → **소유 규칙**: (a) scatter 데이터 요청의 `status(loading|ready|error)`+`error`+`refetch`를 **단일 소스(scatter 데이터 store 또는 공용 훅 `useScatterData`)** 에 둔다. (b) `ScatterPlot`·`ResultsTable`은 그 status를 구독(파생 패널도 동일 상태 표시). (c) `PlateView`·`WellDetailPanel`은 각자의 요청 status를 로컬로 노출. 세부 위치(store 확장 vs 훅)는 구현 시 확정하되 AC로 검증.
- 변경:
  - 각 컴포넌트에 `StatusState` 연결: **loading(요청 중, 스켈레톤/스피너)**, empty(데이터 0 + "분석 실행" 유도), error(메시지 + 재시도). `console.error`만 하던 경로 제거.
  - **FR-ST-3 근인(가설 강화)**: 초기화 버그로 추정 — `selection-store`가 `currentCycle`을 `0`으로 초기화(`selection-store.ts:24`)하는데, scatter fetch가 falsy 사이클에서 early-return(`ScatterPlot.tsx:81-82`)하고 렌더도 포인트 0에서 early-return(`:95-98`). 첫 예제 로드 시 사이클 초기화 타이밍이 백지 원인일 개연성이 높다. **재현 Playwright 테스트**(예제 로드 → 첫 렌더에서 fetch·플롯 발생 단언)를 먼저 작성해 재현하고, 근인이면 수정. 단순 empty-state로 은폐 금지.
- AC: **loading/empty/error 3상태 + 정상 렌더**가 단일마커·멀티마커 두 경로에서 명시적으로 동작. 첫 예제 로드 백지 0(M1)이 재현 테스트로 보장(PR 서술만으로 불충분). 조사 결과·근인·수정 여부를 PR에 기록.
- 의존성: T0.1(StatusState).

### T0.4 — 아이콘 □ 박멸 (FR-X-1, FR-UP-1)

- 교체 인벤토리(구현 시 grep 전수 재확정):

| 파일 | 현재 | 교체(lucide) |
| :-- | :-- | :-- |
| `UploadZone.tsx` | 373 `&#128196;`(히어로), 597 `&#128218;`, 600 `▲▼`, 619 `&#8594;` | `Upload`/`FileUp`, `BookOpen`, `ChevronUp/Down`, `ArrowRight` |
| `Header.tsx` | 282 ☀️/🌙 | `Sun`/`Moon` |
| `PlateSetupTab.tsx` | 582 🔗, 593 ✎ | `Link2`, `Pencil` |
| `CycleControl.tsx` | 176 `⏸`/`▶` | `Pause`/`Play` |
| `AnalysisTab.tsx` | 412 🎯, 376 📏, 361 ⚠, 388/396 ◀▶ | `Target`, `Ruler`, `AlertTriangle`, `ChevronLeft/Right` |
| `BatchTab.tsx` | 342/555 `&times;`, 506 `&#8592;` | `X`, `ArrowLeft` |
| `GroupManager.tsx` | 90 `&times;`(닫기) | `X` |
| `AnalysisWorkspace.tsx` | 154 `×`(배너 닫기) | `X` |
| `MultiMarkerAnalysisPanel.tsx` | 216·288 ⚠, 315 ℹ | `AlertTriangle`, `Info` |
| `CompareTab.tsx` | ⚠️ | `AlertTriangle` |
| `LayoutsLibraryPanel.tsx` | ✕ | `X` |
| `ProtocolTab.tsx` | 📷(카메라, 서로게이트) 등 | 해당 lucide |
| `UserManagement.tsx` | 아이콘성 글리프(있는 경우) | 해당 lucide |
| `KeyboardHelpOverlay.tsx` | 닫기 × (단축키 표기 글리프는 **제외**) | 닫기만 `X` |

- **로케일 임베드 글리프(M1 필수, Phase 0에서 처리)**: 화면에 □로 보이는 로케일 문자열의 글리프(예: `locales/*.ts`의 `exampleLoad` 📁, `qcWarnings` ⚠)는 **문자열에서 글리프를 제거**하고 컴포넌트가 lucide 아이콘 + 정리된 텍스트로 렌더한다. (로케일 전수 정합·검증은 FR-X-1b/T1.6에서 마감.)
- **콘텐츠 화이트리스트(교체 안 함)**: `KeyboardHelpOverlay`의 **단축키 표기 글리프**(예: 화살표 키 표시)만 콘텐츠로 유지 — 단, 동일 파일의 **닫기 × 는 lucide `X`로 교체**. 통계 기호(χ² 등) 유지.
- AC: §0.4 게이트(2) = 0 across all `src`(화이트리스트 제외). 이모지 폰트 없는 환경(격리 컨테이너)에서 □ 0(M1).
- 의존성: 없음(단, IconButton 사용 시 T0.1).

### T0.5 — 헤더/툴바 재구성 (FR-HD-1/2/4/6)

- 대상: `Header.tsx`.
- 변경:
  - export 5종(CSV/PNG/인쇄/PDF/XLSX) → 단일 **"내보내기" `Menu`**(아이콘+텍스트 항목, `whitespace-nowrap`). 개별 badge 필 제거.
  - Undo/Redo → `IconButton`(`Undo2`/`Redo2`), disabled 시각.
  - "새 파일"·"프로젝트 추가"·언어·테마 토글을 `Button`/`IconButton`으로. 다크모드 토큰 정합(밝은 블록 제거).
  - **ASG 보존(FR-HD-6, 현행 동작 정확화)**: ASG 저장 버튼은 **런치 모드이면 렌더**되고(`Header.tsx:227`), `canSaveToAsg`(=`snp:save_result` 스코프)는 버튼을 **disabled 처리만** 한다(`:233`). 이 두 동작을 그대로 유지. 추가로 `linkedContext` 표시(`:126`), 세션 변경/사이클·ROX·welltype 변경 시 dirty-reset 이펙트(`:41-46`, `:86-97`)를 보존. 리팩터는 표현만 변경.
- AC: 한국어에서 툴바 세로 줄바꿈 0. 다크모드 밝은 블록 0. `asg_launch` e2e: 스코프 없음→버튼 렌더+disabled, 스코프 있음→활성+saving/saved/error 전이, 세션 변경 시 dirty-reset이 모두 회귀 없이 동작. 기존 export 버튼 `id`(`export-csv-btn` 등) 보존 또는 대응 테스트 수정.
- 의존성: T0.1(Button/IconButton/Menu), T0.4(아이콘).

### Phase 0 완료 기준(Exit)

- M1(백지·□·한국어붕괴·다크붕괴 0), §0.4 게이트: CSS 변수(gate 1) = 0, **아이콘 글리프(gate 2) = 0 across all `src`(로케일 포함)**. 화면에 □로 보이는 로케일 임베드 글리프도 T0.4에서 제거하므로 로케일 제외 없이 게이트를 통과해야 한다.
- 기존 e2e(루트 `tests/`, `frontend/e2e`) 통과, 신규 프리미티브 Vitest 통과.
- before/after QA 매트릭스 스크린샷 첨부.

---

## 2. Phase 1 — 디자인 시스템 & 이관 (P1)

목표: 일관성의 근본 해결. 프리미티브 완성 + 토큰화 + 화면 이관.

### T1.1 — 잔여 프리미티브 (FR-DS-1, NFR-DS-5)

- 대상(신규): `shared/ui/Card.tsx`, `Field.tsx`+`Label`, `Modal.tsx`, `Badge.tsx`, `Toolbar.tsx`, `Callout.tsx`(배너용).
- `Modal` 완전 사양(PRD NFR-DS-5): `role="dialog"`+`aria-modal`, `aria-labelledby/描述`, 초기 포커스, 포커스 트랩, Esc, Cancel, 배경 inert/스크롤 락, 닫힘 시 호출 컨트롤 포커스 복귀.
- 기존 `shared/QcBadges`·`KeyboardHelpOverlay`를 새 프리미티브 위에 재구성(삭제 아님).
- AC: 각 프리미티브 Vitest(특히 Modal 포커스 트랩/복귀/Esc). 
- 의존성: T0.1.

### T1.2 — 토큰 체계 정리 (FR-DS-2, FR-DS-4)

- 대상: `index.css`(@theme), 전 컴포넌트.
- 변경: 상태색(success/warning/danger/info)과 배경/보더 변형 토큰 정의. raw 팔레트(`text-green-600`, `bg-red-50`, `text-*-400` 등)·hex를 토큰으로 치환. 타입 스케일(`text-[8px~13px]`) → xs/sm/base 수렴(밀집 그리드 최소 가독 하한 규정).
- 대상 화면: `QualityTab`(51-53,170), `StatisticsTab`(206-209), `SettingsTab`(399), `LoginPage`(66), `PlateView`(269,304-305), `WellDetailPanel`(63-82), `BatchTab`(329-333) 등.
- AC: §0.4 raw 팔레트 grep 0(예외 화이트리스트 제외). 다크/라이트 대비 WCAG AA(NFR-X-4), axe 심각 0.
- 의존성: T1.1.

### T1.3 — 화면 이관: 버튼/카드 (FR-DS, M3)

- 대상: `SettingsTab`(버튼 3종 난립→Button variant, 카드 높이 정렬), `Quality/Statistics/Batch/MarkerCatalog/Library` 버튼·카드.
- AC: 일반 액션 버튼 100% `Button`/`IconButton`(시맨틱 컴포지트 예외: 탭·웰셀·메뉴항목·Plotly). 카드 = `Card`.
- 의존성: T1.1, T1.2.

### T1.3a — 헤더 영역 구획 & 배지 우선순위 (FR-HD-3, FR-HD-5)

- 대상: `Header.tsx`.
- 변경:
  - **FR-HD-3**: 헤더를 명시적 두 영역으로 — (좌) 브랜드 + 세션 컨텍스트(`instrument`/`num_wells`/`num_cycles`/`QcBadges`), (우) 액션(내보내기 Menu·새 파일·프로젝트 추가·ASG 저장)·`linkedContext`·사용자/로그아웃·언어·테마. `flex` 레이아웃을 `ml-auto` 임기응변 대신 좌/우 컨테이너로 구조화.
  - **FR-HD-5**: 컨텍스트 배지가 많아질 때(예: QC 다수 플래그) 우선순위 낮은 항목은 요약 배지 + 툴팁/`Menu`로 접기. 좁은 폭에서 우측 액션이 배지를 밀어내지 않도록.
- AC: 1280px·한국어·다크에서 헤더 한 줄 유지(줄바꿈·가로 오버플로 0). 배지 과밀 시 요약 동작. `local`/`asg_launch` 두 모드에서 좌/우 구성 e2e 확인.
- 의존성: T0.5(툴바), T1.1.

### T1.4 — 확인 다이얼로그 통일 (FR-CN-1)

- 대상: `BatchTab.tsx`(153,200,220,240 — 4개 `window.confirm`), `MarkerCatalogTab.tsx`(226 — 1개).
- 변경: 전부 `Modal` 기반 확인으로. 파괴적 액션(세션/마커 삭제 등)은 danger + 되돌릴 수 없음 경고 + 명시 확인 라벨.
- AC: `window.confirm` 사용 0. 삭제 e2e(취소/확인) 통과.
- 의존성: T1.1(Modal).

### T1.5 — 상태 UI 고도화 (FR-ST-2)

- 대상: Phase0에서 상태 연결한 컴포넌트 + `Quality/Statistics`(이미 일부 보유)를 `StatusState`로 통일.
- AC: 로딩=스켈레톤/스피너, 빈=행동유도, 에러=재시도. 스타일 일관.
- 의존성: T0.3, T1.1.

### T1.6 — i18n 완성 (FR-X-2, FR-X-1b)

- 대상: `locales/en.ts`·`ko.ts`, 하드코딩 문자열 보유 컴포넌트(`WellDetailPanel` 축 라벨 89-90/260, `ImportMappingWizard` 651-653/730-743, `UploadZone` 상태문구 81/90/204/554, `QualityTab` 119, `StatisticsTab` 102/156/199-202, `Header` ASG 문자열 36-38/242). (참고: `UploadZone.tsx:594`의 `hover:bg-[var(--color-bg)]`는 **정의된** 토큰이라 결함 아님 — 정리는 스타일 일관화 차원의 선택.)
- 변경: 사용자 대면 리터럴 → 훅 키(양 로케일). 로케일 문자열 내 아이콘 글리프 제거(`exampleLoad` 📁, `qcWarnings` ⚠ 등) → 컴포넌트 lucide+텍스트.
- AC: 사용자 대면 리터럴 0(테스트 셀렉터 문자열 제외), 로케일 파일 내 이모지/엔티티 0, 언어 스토어 영속 보존, 한/영 전환 시 잔여 영어 0.
- 의존성: 없음(문자열 작업), FR-X-1b는 T0.4와 연계.

### T1.7 — 플레이트 접근성 통일 (FR-X-3)

현행 웰은 마우스 전용 `<div>`(`PlateView.tsx:260-286`)에 드래그 상태만 있고 포커스/앵커 모델이 없음(`:35-39`). 구현 전 **인터랙션 모델을 명시·확정**한다.

- 인터랙션 모델(확정):
  - **active-cell**: 그리드는 Tab 스톱 1개. `roving tabindex`로 활성 셀 1개만 `tabindex=0`, 나머지 `-1`.
  - **이동**: ↑↓←→(활성 셀 이동), Home/End(행 처음/끝), PageUp/PageDown(선택: 첫/끝 행).
  - **선택**: Enter/Space=활성 셀 토글. **selection-anchor**: Shift+화살표=앵커~활성 사이 범위 선택(드래그 대체). 열/행 헤더 포커스 후 Enter=열/행 전체 토글. Esc=선택 해제.
  - **disabled/empty 웰 규칙**: empty/omit 웰은 포커스는 받되 선택 토글 불가(또는 필터에 따름) — 규칙을 명시하고 접근 이름에 상태 반영.
  - **접근 이름**: 예 "A1, 유전형 X, 선택됨/비어있음".
- 대상: `PlateView.tsx`(div→button+roving), `PlateSetupTab.tsx`(동일 모델 정렬). 공용 로빙-그리드 훅으로 추출 검토.
- AC: 키보드만으로 96·384-well 활성 이동·단일/범위 선택·열행 토글 가능. `selection-store`와 동기화(마우스 드래그 회귀 0). axe 심각 0.
- 테스트: Vitest(로빙 훅 단위) + **Playwright 키보드 플로우(96·384 각각)**: 화살표 이동·Shift 범위·헤더 토글·Esc. axe만으로는 인터랙션 미검증이므로 별도 필수.
- 의존성: T1.1.

### T1.8 — 임포트 마법사 밀도/구획 (FR-UP-4, P1)

- 대상: `ImportMappingWizard.tsx`.
- 변경: 요약/구조/매핑/검증/원자료 섹션을 `Card`+구획, 긴 섹션 접힘(progressive disclosure). 미정의 변수(T0.2 커버 범위 밖 잔여)·영어 하드코딩(T1.6 연계) 정리.
- AC: 폼이 섹션 단위로 접히고, 1280px에서 본문 가로 오버플로 0(넓은 원자료 테이블은 자체 overflow 컨테이너). i18n 리터럴 0.
- 의존성: T1.1, T1.6. (P1이므로 Phase 1에 포함 — Phase 2로 미루지 않음.)

### Phase 1 완료 기준(Exit)

- M2/M3 게이트 통과(raw 팔레트·미정의 변수·아이콘 0, 액션 버튼 100% 프리미티브).
- M5(axe 심각 0, 키보드 도달), 테마×로케일 QA 매트릭스 무결.
- **NFR-X-5(1280 필수)의 점진 이행**: Phase 1에서 이관된 화면(헤더·설정·품질·통계·배치·카탈로그·임포트 마법사)은 1280px에서 본문 가로 오버플로 0. (Analysis 2×2 그리드 리플로우는 T2.3에서 마감 — NFR-X-5의 마지막 조각.)
- FR-UP-4(P1) 완료(T1.8). 전체 테스트(Vitest+e2e+pytest) 통과.

---

## 3. Phase 2 — 재배치 & 정제 (P2)

목표: 정보 흐름·밀도 개선(기능별 재배치). **T2.1은 PRD Q1(IA) 사용자 승인 후 착수.**

### T2.1 — 최상위 내비 IA (FR-NAV-1) [Q1 승인 게이트]

- 대상: `TabNavigation.tsx`, `App.tsx`.
- 기본 제안: `사용자(admin)`·`참고문헌`을 "더보기" 오버플로 `Menu`로. 8탭 유지. `sessionFree`/`adminOnly`/무세션 disabled/`asg_launch` 노출 규칙 보존.
- AC: 권한·무세션 규칙 회귀 0. 승인된 IA와 일치.
- 테스트: e2e — (a) 비관리자에게 `사용자` 탭 미노출, (b) 무세션 시 세션-의존 탭 disabled 유지, (c) `sessionFree` 탭(라이브러리·프로젝트·참고문헌)은 무세션에서도 접근, (d) `asg_launch` 모드에서 탭 노출 정책 불변.
- 의존성: T1.1(Menu), **사용자 승인(PRD Q1)**.

### T2.2 — Analysis 단일 스티키 툴바 (FR-NAV-2)

- 대상: `AnalysisTab.tsx`(사이클/Analyze/배수성/경계선 바), `AnalysisWorkspace.tsx`(워크스페이스 서브탭), `CycleControl.tsx`.
- 변경: 서브탭+슬라이더+Analyze/배수성/경계선을 단일 스티키 `Toolbar`로 통합(3줄→≤1줄). 단일·멀티마커 두 경로 적용.
- **상태 소유권 보존(PRD §7.1)**: 컨트롤 이동해도 `selection-store`(사이클/재생/선택), `data-store`(경계/오프셋), `settings-store`(배수성/레이어) 구독 그대로. 크로스-패널 동기화·undo/redo·단축키 회귀 금지.
- AC: M4(chrome 바 6→≤3). 플레이트↔산점도↔결과표 동기화·사이클 애니메이션·단축키 e2e 통과.
- 의존성: T1.1(Toolbar), Phase 1.

### T2.3 — Analysis 그리드 반응형 (FR-NAV-3)

- 대상: `AnalysisTab.tsx`(2×2 인라인 그리드), 멀티마커 대응.
- 변경: 인라인 grid → 반응형 유틸(≥1280 2열, 좁은 폭 1열). 
- AC: 1280 본문 가로 스크롤 0. 넓은 콘텐츠는 자체 overflow 컨테이너만(NFR-X-5).
- 의존성: 없음(Phase1 이후).

### T2.4 — 배너/콜아웃 통일 (FR-NAV-4)

- 대상: `AnalysisWorkspace.tsx`(split-marker-banner), 유사 배너.
- 변경: `Callout` 프리미티브로. `data-testid`(`split-marker-banner`/`-cta`/`-dismiss`) 보존.
- AC: 배너 노출/CTA(플레이트 이동)/dismiss 동작이 기존 `data-testid`로 e2e 회귀 0. 라이트/다크 토큰 색.
- 테스트: 기존 배너 e2e 재실행(셀렉터 불변).
- 의존성: T1.1.

### T2.5 — 업로드 정제 (FR-UP-2/3)

- 대상: `UploadZone.tsx`. (FR-UP-4 마법사는 T1.8로 선이동.)
- 변경: 드롭존 3-컨트롤(파일/폴더/예제) 동일 컴포넌트 패밀리 정렬(예제 드롭다운 이질감 제거), 최근 세션/프로젝트 바로가기 노출.
- AC: 3-컨트롤이 동일 시각 패밀리. 최근 항목 클릭 시 해당 세션/프로젝트 진입 e2e. 1280 본문 오버플로 0.
- 테스트: e2e — 예제 로드(기존 `example-select` 셀렉터 보존), 최근 항목 진입.
- 의존성: Phase 1.

### T2.6 — 로그인 & 반응형 마감 (FR-X-* 잔여, NFR-X-5)

- 대상: `LoginPage.tsx`(raw red→토큰, 에러 `role="alert"` + `aria-live`, 브랜드 정돈), 전 화면 반응형 점검.
- AC: 로그인 에러가 스크린리더에 announce(`role="alert"`), 색 토큰화. **전 12화면 1280px 본문 가로 오버플로 0(필수)**, 834px에서 치명적 겹침·잘림 0(베스트-에포트).
- 테스트: Vitest(LoginPage 에러 role) + Playwright 뷰포트 스냅샷(1280·834) × 주요 화면.
- 의존성: Phase 1, T2.2/T2.3(Analysis 반응형).

### Phase 2 완료 기준(Exit)

- M4 달성, NFR-X-5(1280 무결/834 무붕괴), 전체 QA 매트릭스·테스트 통과.

---

## 4. 작업 순서 & 의존성 (Sequencing)

```
T0.0(테스트인프라) → T0.1(시드) ─┬→ T0.3(상태UI) 
                                  ├→ T0.5(헤더)   ← T0.4(아이콘)
T0.2(CSS변수, 독립) ──────────────┘
T0.4(아이콘, 대부분 독립)
──[Phase0 Exit / 배포]──
T1.1(프리미티브) → T1.2(토큰) → T1.3(버튼/카드), T1.3a(헤더 구획)
T1.1 → T1.4(모달확인), T1.5(상태), T1.7(플레이트a11y)
T1.6(i18n, 병행 가능) → T1.8(임포트 마법사)
──[Phase1 Exit / 배포]──
[Q1 승인] → T2.1(IA)
T2.2(툴바) → T2.3(그리드) ; T2.4, T2.5, T2.6
──[Phase2 Exit]──
```

각 Phase Exit에서 독립 배포. Phase 내 Task는 위 의존성 순.

---

## 5. 리스크 & 완화 (PRD §10 연계)

| 리스크 | 완화 |
| :-- | :-- |
| 스타일 이관 시각 회귀 | 단계별 before/after QA 매트릭스, 작은 PR |
| 셀렉터 변경으로 e2e 붕괴 | id/testid 보존, 변경 시 테스트 동시 수정(P8) |
| 툴바 재배치로 상태 동기화 회귀 | §7.1 상태 소유권 맵 준수, 동기화 e2e 게이트 |
| ASG 저장 동작 손상 | FR-HD-6 수용 기준, `asg_launch` e2e |
| i18n 누락 | §0.4 grep 게이트, 한/영 QA |
| 산점도 근인 미상 | T0.3 조사 우선, 픽스는 결과 후 결정 |

---

## 6. 산출물 & 추적

- 코드: `shared/ui/*` 프리미티브, 각 화면 이관 PR(Phase/Task 단위).
- 문서: Task별 PR 설명에 AC 체크·QA 스크린샷·grep 게이트 결과 첨부.
- 테스트: Vitest 단위(프리미티브·상태 UI), Playwright e2e(플로우·매트릭스), 기존 pytest 유지.
- 화이트리스트(콘텐츠 글리프·데이터 구동 색 예외)는 본 문서 §0.4에 최종 목록화.
