# FB-02 — 첫 업로드 화면: 멀티 업로드 진입점 위치 + 브랜드 부재

- **피드백 ID**: `0de8fb3361884951` · 카테고리 `bug` · 상태 `open`
- **제출**: 2026-09-11 14:21:27 / page_key `analysis` (세션 없음 상태)
- **원문**: "멀티 업로드는 우측 상단이 아니라. 파일 입력시엔 업로드창 인근에 나와야합니다. … 이 화면은 SNP analysis. Qprism 플랫폼의 SNP 판별을 담당하는 중요한 기능입니다. 미적으로 매우 뒤떨어지는 상황입니다. Q-Prism 로고, Invirustech 로고, Q-Prism art 같은게 들어가면 좋겠어요"
- **스크린샷**: `feedback-shots/0de8fb33-262cda.png` (우측 상단 `Powered by Invirustech` / `파일` / 계정 영역만 잘려 담김)
- **복잡도**: Complex (레이아웃 + 에셋 + 브랜드 결정)

## 1. 관찰된 현상

두 개의 독립 문제가 한 건으로 제출되었다.

**(a) 업로드 진입점이 둘이고, 하나는 시야 밖에 있다**
- 중앙: `UploadZone` 드롭 영역
- 우측 상단 헤더: `FileWorkspaceDrawer` 트리거 버튼 `파일 (1)`

**(b) 시각적 브랜드 부재** — 첫 화면에 로고·아트·파비콘이 없다.

> **정정 (리뷰 반영)**: 초안은 "중앙은 단일/폴더 업로드, 멀티 업로드는 헤더에만"이라고 적었으나 **사실이 아니다.**
> `UploadZone.tsx:418`의 파일 input에 `multiple`이 있고, `UploadZone.tsx:157-166`이
> `runUploadJobs(files)`로 다중 파일을 이미 배치 처리한다(`/** Upload multiple files as separate sessions … */`).
> **중앙 드롭존도 멀티 업로드를 지원한다.**
>
> 따라서 실제 문제는 "멀티 업로드가 헤더에만 있다"가 아니라
> **같은 일을 하는 업로드 구현이 두 벌이고, 서로 다른 UI·검증 한도·오류 복구를 갖는다**는 것이다.
> 사용자는 그중 하나를 시야 밖에서 발견하고 위치를 지적한 것이다.

> **정정 2**: "제품 정체성이 전혀 없다"도 과장이다. 텍스트 제품명(`Header.tsx` `<h1>{t.appTitle}</h1>`)과
> `Powered by Invirustech` 링크는 존재한다. 없는 것은 **시각적 아이덴티티(로고·마크·아트·파비콘)** 다.

## 2. 근본 원인 (코드 근거)

### (a) 헤더가 세션 유무와 무관하게 항상 렌더된다

`snp-analyzer/frontend/src/App.tsx`:

```tsx
<Header />                                     // 조건 없음
<main>
  {visibility.upload && <UploadZone … />}      // 세션이 없을 때만
```

`workspaceVisibility(ready, session, projectOnly)` → `upload: ready && !session && !projectOnly`.
업로드 화면은 조건부인데 헤더는 아니다. `FileWorkspaceDrawer`는 `Header.tsx`의 `header-actions`에 하드코딩되고,
`index.css`의 `.header-actions { justify-content: flex-end; }`가 우측 끝에 고정한다.

### (b) 드로어 큐는 **컴포넌트 지역 상태**다 — 이동 설계의 핵심 제약

`FileWorkspaceDrawer.tsx:87`:
```tsx
const [queue, setQueue] = useState<QueueItem[]>([]);
```

그리고 `session-store.ts`의 persist는 큐를 담지 않는다:
```ts
name: 'qprism-file-workspace',
storage: createJSONStorage(() => sessionStorage),
partialize: state => ({ openSessionIds: state.openSessionIds, sessionQueries: state.sessionQueries }),
```
주석도 명시한다: *"Only WHICH plates are open survives a reload."*

> **정정 3 (설계에 직접 영향)**: 초안은 "큐가 `qprism-file-workspace`에 persist되므로 트리거를 옮겨도 상태가 공유된다"고 했으나
> **틀렸다.** 큐는 드로어의 지역 `useState`다.
> → **세션 유무에 따라 드로어를 조건부로 마운트/언마운트하면 업로드 진행 중인 큐가 통째로 소실된다.**
> 업로드가 끝나면 세션이 생기고, 그 순간 `visibility.upload`가 false로 바뀌므로
> 초안의 설계는 **성공 직후 큐를 지우는 버그**를 낳는다.

### (c) 브랜드 에셋 부재

- `frontend/public/`: `templates/` 아래 CSV/TSV 3개뿐. **이미지 에셋 0개, 파비콘 없음.**
- `frontend/index.html`: `<link rel="icon">` 없음.
- 리포지토리 전체 grep 결과 Q-prism 브랜드 팔레트/로고 정의 **없음**. `README.md:11`은 "Q-prism®은 프로젝트 명칭"이라고만 명시.

## 3. 해결 방향

### 3-1. 드로어를 **항상 마운트**하고 트리거만 여러 곳에 둔다 (설계 변경)

조건부 재마운트를 금지하는 구조로 간다.

1. `FileWorkspaceDrawer`를 **패널(상시 마운트)** 과 **트리거(복수 배치 가능)** 로 분리한다.
   - 패널은 `App.tsx` 최상위에 **항상** 마운트된다. 큐 상태가 여기 산다.
   - 열림 상태와 큐는 패널이 소유하고, Context 또는 zustand 스토어로 트리거에 노출한다.
2. 트리거는 두 위치에 렌더한다. 어느 쪽이 보일지는 `visibility.upload`가 결정한다.
   - 세션 없음 → `UploadZone` 하단 보조 액션 줄 (`inline` 형태)
   - 세션 있음 → 헤더 (`header` 형태, 현행 아이콘+카운트)
3. 패널 자체는 portal로 렌더해 트리거 위치와 DOM 계층을 분리한다.
4. 닫힘 시 포커스는 **현재 보이는 트리거**로 돌아가야 한다. `triggerRef` 단일 참조를
   "활성 트리거" 레지스트리로 바꾼다.

> 이 구조라면 업로드 완료 → 세션 생성 → 트리거 위치 전환이 일어나도 **큐와 열림 상태가 살아남는다.**

### 3-2. 업로드 구현 이원화 정리 (초안 누락)

`UploadZone`과 `FileWorkspaceDrawer`는 **둘 다 멀티 파일을 처리하지만 구현이 다르다.**

| | `UploadZone` | `FileWorkspaceDrawer` |
|---|---|---|
| 다중 파일 | `runUploadJobs(files)` | 자체 `QueueItem[]` 상태 머신 |
| 한도 | `lib/upload-jobs.ts` 규칙 | `MAX_FILES_PER_DROP = 20`, `MAX_TOTAL_BYTES = 500MB` |
| 매핑 마법사 | `ImportMappingWizard` 직접 | `ImportMappingWizard` 큐 항목별 |
| 오류 복구 | `UploadJobSummary` | 큐 항목 `error` 상태 |

**결정 필요**: 두 경로를 하나로 통합할 것인가, 역할을 분리(단건 빠른 경로 / 다건 관리 경로)하고 **한도와 오류 문구만 일치**시킬 것인가.
통합은 범위가 크므로 **후자를 1차 권장**한다.

### 3-3. 업로드 화면의 브랜드 레이어

`UploadZone` 상단에 브랜드 히어로 블록을 추가한다.

```
┌──────────────────────────────────────────────┐
│  [Q-prism 마크]  Q-prism® Cluster Caller       │  ← D-1 확정 후
│  SNP 판별 · 대립유전자 클러스터링              │
│  ┌────────────────────────────────────────┐  │
│  │   (드롭존 — 기존 UploadZone 본문)        │  │
│  └────────────────────────────────────────┘  │
│  여러 파일 관리하며 올리기 · 예제 불러오기      │  ← inline 드로어 트리거
│  최근 세션 (기존 RecentSessions)              │
│              Powered by Invirustech           │
└──────────────────────────────────────────────┘
```

- 히어로는 **세션 없음 상태에서만** 표시된다.
- `Powered by Invirustech`는 업로드 화면에서 하단 푸터로, 세션 중에는 현행 헤더 위치 유지.

### 3-4. 에셋 파이프라인 (선행 필요)

| 에셋 | 경로(제안) | 상태 |
|------|-----------|------|
| 파비콘 | `frontend/public/favicon.svg` + `index.html` `<link rel="icon">` | **미제공** |
| Q-prism 마크 | `frontend/public/brand/qprism-mark.svg` | **미제공** |
| Invirustech 로고 | `frontend/public/brand/invirustech.svg` | **미제공** |
| 히어로 아트 | `frontend/public/brand/qprism-hero.svg` | **미제공** |

SVG 권장: 다크 모드에서 `currentColor`/CSS 변수 추종, 해상도·번들 크기 문제 없음.

## 4. 변경 범위

| 파일 | 변경 |
|------|------|
| `frontend/src/components/upload/FileWorkspaceDrawer.tsx` | 패널/트리거 분리, 큐 상태를 상시 마운트 패널이 소유, portal |
| `frontend/src/components/upload/FileWorkspaceTrigger.tsx` | **신규** — `placement: 'header' \| 'inline'` 트리거 |
| `frontend/src/components/layout/Header.tsx` | 업로드 상태에서 트리거 숨김, `poweredBy` 조건부 |
| `frontend/src/components/upload/UploadZone.tsx` | 히어로 블록, inline 트리거 슬롯, 푸터 |
| `frontend/src/App.tsx` | 드로어 패널 상시 마운트, `visibility.upload` 전달 |
| `frontend/src/lib/upload-jobs.ts` | 한도·오류 문구를 드로어와 일치 (3-2) |
| `frontend/index.html` | 파비콘 link, title (D-1 확정 후) |
| `frontend/public/brand/*` | 신규 에셋 (**제공 필요**) |
| `frontend/src/locales/{en,ko}.ts` | 히어로 문구, inline 트리거 라벨 |
| 테스트 | `FileWorkspaceDrawer.test.tsx`, `UploadZone.entry.test.tsx`, `Header.test.tsx` |

## 5. 수용 기준

- [ ] 세션이 없을 때 헤더에 파일 드로어 트리거가 **보이지 않는다**.
- [ ] 세션이 없을 때 드롭존 인근에서 파일 워크스페이스를 열 수 있다.
- [ ] 세션이 있을 때 헤더 트리거는 현행과 동일하게 동작한다(카운트 배지 포함).
- [ ] **업로드가 진행 중인 상태에서 세션이 생성되어 트리거 위치가 바뀌어도 큐와 열림 상태가 유지된다.** (핵심 회귀 방지)
- [ ] 두 트리거 중 어디서 열든 동일한 큐가 보인다.
- [ ] 드로어를 닫으면 포커스가 **현재 보이는** 트리거로 돌아간다.
- [ ] 중앙 드롭존의 다중 파일 배치 업로드가 회귀하지 않는다 (`multiple` + `runUploadJobs`).
- [ ] 드로어 내부 동작(파일 검증·ZIP 패키징·매핑 마법사 진입)이 변하지 않는다.
- [ ] 히어로 블록이 1920px과 400px 폭 모두에서 깨지지 않는다.
- [ ] 다크 모드에서 로고/아트가 판독 가능하다.

## 6. 테스트 계획

- 단위: 세션 유무에 따른 트리거 렌더 위치, 큐 상태 공유.
- E2E(`tests/`): 업로드 → 세션 생성 → 헤더 트리거 복귀 경로.
- 육안: 1920x911(피드백 뷰포트), 1280px, 400px / 라이트·다크.

## 7. 리스크

- **중간~높음.** 큐가 지역 상태라는 사실이 설계를 규정한다. **조건부 마운트 방식으로 구현하면 업로드 중 큐가 소실된다** — 이 문서의 가장 중요한 제약.
- `FileWorkspaceDrawer`는 포커스 트랩(`FOCUSABLE` 상수)을 포함한다. 트리거가 둘이 되면 `triggerRef` 단일 참조 가정이 깨진다.
- 헤더에서 `poweredBy`를 조건부로 만들면 `Header.test.tsx`의 기존 단언이 깨진다.
- `FileWorkspaceDrawer.test.tsx`가 지역 상태를 가정하고 있다면 리프트 후 전부 갱신 필요.

## 8. 미결정 사항 (블로킹)

- **D-1** 제품 정식 명칭 — 히어로 문구에 직접 들어감
- **D-3** 로고/아트 에셋 — 미제공 상태에서는 3-1만 구현 가능
- **3-2 결정**: 두 업로드 구현을 통합할 것인가, 역할 분리 + 한도/문구만 일치시킬 것인가 (권장: 후자)
- 히어로 아트의 톤(과학적 도식 / 추상 프리즘 / 사진) — 시안 승인 필요

> **분할 착수 권장**: 3-1(드로어 구조 리팩터링 + 트리거 배치)은 에셋과 무관하므로 선행 구현하고,
> 3-3/3-4(브랜드)은 D-1/D-3 확정 후 별도 커밋으로 진행한다.
