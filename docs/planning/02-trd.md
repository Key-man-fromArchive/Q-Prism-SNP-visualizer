# Q-Prism 다중 파일 작업공간 TRD

## 1. 기술 방향

기존 React/Vite/TypeScript 프론트엔드, Zustand 상태 관리, FastAPI API, SQLite session/분석 결과 영속화, Docker Compose 배포 구조를 유지한다. 새로운 서버 저장 모델이나 endpoint를 만들지 않는다.

업로드 큐, 이번 작업 목록, 파일별 view state와 활성 세션 전환은 프론트엔드가 담당한다. SQLite는 기존대로 session과 분석 결과의 source of truth이며 작업 목록/view state는 현재 브라우저 탭의 `sessionStorage`에만 저장한다.

## 2. 현재 구조와 변경 경계

| 영역 | 기존 구조 | MVP 변경 |
| --- | --- | --- |
| 활성 세션 | `session-store.ts`의 단일 `sessionId` | 단일 활성 세션을 유지하고 `openSessionIds`, `viewStates`, generation-guarded `loadSession` 추가 |
| 업로드 | 첫 화면의 `UploadZone.tsx` | 인증 후 모든 주요 화면에서 `FileWorkspaceDrawer` 제공 |
| 큐 | 전역 단일 upload state | drawer 로컬 queue, 항목별 단계/오류/재시도, 순차 처리 |
| 분석 | session mount 후 기존 cluster 조회, 없으면 자동 실행 | 기존 결과 우선 적용, 결과 없는 최초 열기만 자동 분석 |
| 작업 표면 | `AnalysisWorkspace` 로컬 `activeSurface` | session store에 파일별 surface를 저장/복원 |
| 최근 세션 | 기존 `GET /api/sessions` | `uploaded_at` 최신순 응답과 `raw_filename` 표시 사용 |
| 백엔드 | session/detail API와 SQLite | 응답에 기존 DB의 `raw_filename`만 추가, 신규 table/endpoint 없음 |

레거시 정적 브라우저 자산(`app/static/`)에는 새 기능을 이중 구현하지 않는다.

## 3. 프론트엔드 상태 설계

### 3.1 상태 소유권

```text
FileWorkspaceDrawer local state
  └─ File, XML bundle, queue stage, error, preview/mapping state

useSessionStore (Zustand + sessionStorage partial persistence)
  ├─ active sessionId/sessionInfo/wellGroups
  ├─ openSessionIds
  ├─ sessionId -> SessionViewState
  └─ generation-guarded loadSession

useDataStore/useSelectionStore/useSettingsStore
  └─ 현재 활성 session의 화면 projection
```

`partialize`는 `openSessionIds`와 `viewStates`만 저장한다. `File`, Blob, queue, upload error/progress, 현재 API 응답 객체는 저장하지 않는다. 브라우저 탭을 닫으면 작업 목록과 view state도 사라진다. 새 탭·다른 브라우저·다른 기기와 동기화하지 않는다.

### 3.2 핵심 타입

```ts
type QueueStatus =
  | "queued"
  | "packaging"
  | "uploading"
  | "mapping"
  | "success"
  | "error";

type QueueItem = {
  id: string;
  file: File;
  status: QueueStatus;
  error?: string;
  sessionId?: string;
  preview?: ImportPreview;
  previewIssues?: ValidationIssue[];
};

type SessionViewState = {
  activeSurface: "plate" | "analysis";
  selection: {
    selectedWell: string | null;
    selectedWells: string[];
    selectedGroup: string | null;
    focusSelectedWells: boolean;
    currentCycle: number;
    currentDataWindow: string | null;
  };
  settings: {
    useRox: boolean;
    backgroundMode: BackgroundMode;
    axisMode: AxisMode;
    scatterTool: ScatterTool;
    lockAspect: boolean;
    fixAxis: boolean;
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    clusterAlgorithm: "threshold" | "kmeans";
    ntcThreshold: number;
    allele1RatioMax: number;
    allele2RatioMin: number;
    nClusters: number;
    ploidy: number;
    showBoundaryLines: boolean;
    showAutoCluster: boolean;
    showManualTypes: boolean;
    showEmptyWells: boolean;
  };
};
```

스크롤 위치, 재생 여부, 열린 modal/menu/context popup, hover/drag/focus는 저장하지 않는다.

## 4. 업로드 coordinator

### 4.1 입력 분류

- raw: `.eds`, `.xls`, `.xlsx`, `.pcrd`, `.zip`
- XML: 같은 drop/선택 동작의 `.xml` 전체를 하나의 `cfx_xml_export.zip`으로 묶음
- preview/mapping: `.csv`, `.tsv`, `.txt`, `.rdml`, `.rdm`
- `.xlsx` raw parsing 실패 시 기존 `UploadZone`처럼 preview/mapping fallback 허용

같은 enqueue 동작에서 `name + size + lastModified`가 같은 파일은 하나만 남긴다. 지원 형식이 하나도 없으면 사용자 오류를 표시한다.

### 4.2 제한과 순서

- 한 번의 enqueue 동작당 최대 20개 원본 파일
- 한 번의 enqueue 동작당 전체 원본 크기 최대 500MB
- 서버의 기존 요청당 50MB 제한과 ZIP hardening은 그대로 적용
- queue item은 `for...of`에서 하나씩 await하여 순차 처리
- 한 항목의 실패는 다음 항목 처리를 막지 않음

MVP의 진행 표시는 byte percentage가 아니라 `queued`, `packaging`, `uploading`, `mapping`, `success`, `error` 단계다.

### 4.3 mapping 직렬화

preview/mapping 형식은 queue 순서대로 preview한다. `mapping` 상태에서 기존 `ImportMappingWizard`를 한 번에 하나만 렌더한다. mapping 완료 시 생성된 session을 이번 작업에 추가하고, 닫기/실패 시 해당 항목을 오류 상태로 남겨 재시도할 수 있게 한다.

## 5. 세션 전환 계약

### 5.1 열기 순서

1. `loadSession(targetId)`가 module-level generation을 증가시킨다.
2. 기존 `GET /api/sessions/{sid}`로 session info를 요청한다.
3. 응답 시 요청 generation이 최신인지 확인한다. 아니면 `false`를 반환하고 아무 store도 변경하지 않는다.
4. `setSession`이 outgoing session의 selection/settings/surface를 캡처한다.
5. session ID가 바뀌면 data store를 즉시 비우고 target view state 또는 안전한 기본값을 복원한다.
6. target을 `openSessionIds`에 추가하고 session info/well groups를 적용한다.
7. 성공한 모든 진입점은 Analysis top-level tab으로 이동한다.

핵심 안전장치는 generation과 각 session-dependent 응답 적용 직전의 활성 session ID 재검증이다.

### 5.2 분석 복원

- `AnalysisTab`과 multi-marker 분석은 현재 session ID를 캡처한다.
- 저장된 cluster가 있으면 assignment/boundary/offset 등 기존 결과를 먼저 적용하고 자동 분석하지 않는다.
- cluster가 없으면 복원된 cycle/settings가 준비된 뒤 기존 자동 분석을 한 번 실행한다.
- scatter, plate, clustering, well type/group 응답은 적용 직전에 요청 session ID가 현재 활성 ID인지 확인한다.
- A의 늦은 응답은 A의 서버 결과가 될 수 있지만 활성 B projection을 변경할 수 없다.

### 5.3 작업 목록 닫기

- 비활성 항목 닫기: `openSessionIds`에서만 제거한다.
- 활성 항목 닫기: 제거 후 남은 배열의 첫 번째 session을 연다.
- 남은 항목 없음: active session/data/selection을 안전하게 reset한다.
- 어떤 경우에도 session DELETE API를 호출하지 않는다.

## 6. 백엔드/API 계약

신규 endpoint는 없다. 기존 인증과 `check_session_access`를 유지한다.

### 6.1 `GET /api/sessions`

기존 session 목록 응답을 `uploaded_at` 내림차순으로 반환한다.

```json
[
  {
    "session_id": "...",
    "raw_filename": "plate-a.pcrd",
    "instrument": "CFX Opus",
    "num_wells": 96,
    "num_cycles": 40,
    "uploaded_at": "2026-09-11 10:00:00"
  }
]
```

현재 사용자/관리자/ASG launch mode의 기존 가시성 정책을 보존한다.

### 6.2 `GET /api/sessions/{sid}`

기존 `UploadResponse` 호환 응답에 `raw_filename`을 추가한다. instrument, wells/cycles, ROX, data windows, suggested cycle, groups, background modes 등 기존 필드를 제거하지 않는다.

### 6.3 기존 upload/import API

- `POST /api/upload`: raw/ZIP 업로드·검증·파싱·session 생성
- `POST /api/import/preview`: table/RDML/RDM preview
- `POST /api/import/parse`: mapping 적용·session 생성

업로드 완료는 session 생성까지이며 clustering 분석을 뜻하지 않는다. 프론트가 성공 session ID를 이번 작업에 추가하되 활성 session을 자동 변경하지 않는다.

### 6.4 오류

기존 HTTP status와 string/detail/validation issue 계약을 호환한다. 프론트는 오류를 항목별 문자열로 보존하고 재시도 시 그 항목만 다시 실행한다. 401은 전역 인증, 403/404는 session 열기 실패, 413은 파일별 제한, 422는 preview/mapping validation으로 구분한다.

## 7. 데이터베이스

DB migration은 없다. `sessions.raw_filename`과 `created_at`, `clustering_results` 등 기존 schema만 사용한다.

- `raw_filename`은 이미 `sessions`에 저장되므로 목록/detail 응답에 조회해 추가한다.
- 최근 정렬은 기존 `created_at`을 `uploaded_at`으로 반환해 사용한다.
- 작업 목록과 view state는 DB에 저장하지 않는다.
- session 영구 삭제와 30일 retention은 기존 동작을 유지한다.

자세한 데이터 경계는 `04-database-design.md`를 따른다.

## 8. 성능 및 자원 요구사항

- upload/preview는 항상 한 항목만 실행한다.
- XML 패키징과 파일 읽기는 비동기 API를 사용하되 원본 20개/500MB 사전 제한을 적용한다.
- queue stage 변경이 분석 tree 전체를 반복 렌더하지 않도록 drawer 로컬 상태로 유지한다.
- recent 목록은 기존 endpoint 결과 중 이번 작업 항목을 제외하고 최대 8개만 렌더한다.
- 드로어 클릭 후 첫 시각 피드백 100ms, 기존 결과 session의 조작 가능 상태 p95 1.5초를 로컬 fixture에서 목표로 한다.

## 9. 보안 및 개인정보

- session 목록/detail과 분석 API의 기존 소유권 검사를 유지한다.
- raw filename은 text node로만 렌더하고 HTML로 삽입하지 않는다.
- ZIP slip, entry 수, 비압축 크기, 압축률 방어와 파일별 50MB 제한을 유지한다.
- `sessionStorage`에는 session ID와 view settings만 저장한다. raw 파일/preview 내용/token/sample identifiers는 저장하지 않는다.
- 로그에 인증 token, 파일 본문, 비공개 sample identifier를 넣지 않는다.

## 10. 접근성 및 국제화

- drawer는 `role="dialog"`, 접근 가능한 이름, `aria-modal`, focus trap과 trigger focus restore를 제공한다.
- 상태는 icon과 label을 함께 사용하며 section은 의미 있는 heading으로 구분한다.
- 모든 새 문자열은 `locales/ko.ts`, `locales/en.ts`에서 관리한다.
- 320px viewport, 200% zoom, keyboard-only 흐름을 검증한다.

## 11. 테스트 전략

### 단위/컴포넌트

- open session IDs/view state의 `sessionStorage` persistence
- outgoing capture/target restore/data clear
- rapid `loadSession(A)→loadSession(B)` 역순 응답 폐기
- drawer focus trap/Escape/trigger focus restore
- 20개/500MB 제한, 중복 제거, XML grouping
- queue 순차 실행, 부분 실패와 항목별 retry
- RDML/RDM을 포함한 mapping 형식 분기와 wizard 단일 렌더
- 활성 항목 닫기 후 남은 첫 번째 session 열기

### 백엔드

- session 목록의 `uploaded_at` 최신순
- upload/detail 응답의 `raw_filename`
- 사용자 가시성/권한 회귀
- 기존 upload 50MB/content type/ZIP hardening 회귀

### E2E

- 분석 A를 유지한 채 raw+XML+mapping 대상 업로드
- 업로드가 순차 실행되고 일부 실패 후 나머지가 성공
- 새 session 첫 열기 자동 분석, 기존 cluster 재열기 무분석
- 같은 탭 A→B→A cycle/filter/selection/surface 복원
- A slow/B fast 전환과 A 결과 늦은 도착
- 닫기 후 프로젝트에서 session 존재 확인, 프로젝트의 기존 영구 삭제 확인

## 12. 출시 기준과 비목표

출시 전 관련 backend/frontend tests, frontend lint/build와 핵심 Playwright 흐름을 실행한다. 데이터 오염, stale response 재현, 권한 우회, 기존 upload/ZIP 보안 회귀는 배포 차단 사유다.

기술 비목표:

- SQLite view-state/workspace table 또는 신규 view-state/opened endpoint
- 다른 탭·브라우저·기기 간 workspace/view state 동기화
- WebSocket/SSE job system 또는 resumable upload
- server-side 원본 파일 저장
- 분석 알고리즘 병렬화 또는 batch analysis API
- 프로젝트/비교 API 재설계
