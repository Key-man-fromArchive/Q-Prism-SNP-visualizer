# Q-Prism 다중 파일 작업공간 코딩 컨벤션

## 1. 적용 범위

이 문서는 다중 파일 작업공간 구현에 적용하며 저장소 루트 `AGENTS.md`를 우선한다. Python은 3.12 호환, TypeScript는 현재 Vite/React/ESLint 설정을 유지한다.

## 2. 파일 배치

```text
snp-analyzer/
├─ app/
│  ├─ routers/              # 기존 session/upload/import API
│  ├─ models.py             # Pydantic request/response 계약
│  ├─ db.py                 # migration, query, transaction
│  └─ db_schema.sql         # 신규 설치용 최종 schema
├─ frontend/src/
│  ├─ components/upload/    # FileWorkspaceDrawer, mapping wizard, 시작 upload UI
│  ├─ hooks/                # 기존 분석/표시 hooks
│  ├─ stores/               # active session/open IDs/view state
│  ├─ lib/                  # 순수 grouping/validation/API helpers
│  ├─ types/                # API/UI 타입
│  └─ locales/              # ko/en 문자열
└─ tests/                   # backend test_*.py

tests/                      # Playwright NN-feature.spec.ts
```

기존 parsing은 `app/parsers/`, 분석은 `app/processing/`에 둔다. 파일 drawer가 parser 규칙이나 clustering 알고리즘을 직접 구현하지 않는다.

## 3. 네이밍

### Python

- module/function/variable: `snake_case`
- class/Pydantic model: `PascalCase`
- constant/env setting: `UPPER_SNAKE_CASE`
- 신규 public function은 type hint와 목적이 불명확할 때 짧은 docstring을 제공한다.

### TypeScript/React

- component/type: `PascalCase`
- variable/function/hook: `camelCase`, hook은 `use...`
- store file: `kebab-case-store.ts`, export는 `use...Store`
- test ID: 안정적인 `kebab-case`, 파일명/배열 index를 test ID에 넣지 않는다.
- API JSON은 backend의 `snake_case`, UI domain type은 기존 API type 스타일과 일치시킨다. 변환 layer 없이 혼용하지 않는다.

권장 식별자:

- `clientId`: upload 전 queue item의 브라우저 식별자
- `sessionId`: 서버 session 식별자
- `sessionLoadRevision`: session 전환 요청 세대
- `previewId`: import preview 임시 식별자

## 4. 컴포넌트 규칙

- `FileWorkspaceDrawer`는 휘발성 queue/preview 상태를 소유하고, session 열기/복원은 `useSessionStore` action을 사용한다.
- session row는 props로 session summary와 open/close callback을 받는다.
- 기존 공유 `Button`, `IconButton`, `StatusState`, `Callout`, `Modal`을 우선 사용한다.
- icon-only button은 반드시 `aria-label`을 갖는다.
- 이벤트 listener, timer와 Blob URL은 effect cleanup에서 정리한다.
- render 중 다른 store를 명령형으로 변경하지 않는다. 기존 render-time session reset 패턴을 확대하지 않는다.

## 5. Zustand 상태 규칙

- queue는 drawer local state, open list/view state/active projection은 session store가 소유해 같은 데이터를 중복 저장하지 않는다.
- store action은 구현 명칭인 `setSession`, `loadSession`, `addOpenSession`, `closeOpenSession`, `syncOpenSessions`, `setWorkspaceSurface`를 일관되게 사용한다.
- nested state를 직접 mutation하지 않는다.
- selector는 필요한 slice만 구독해 queue 단계 갱신이 전체 분석 tree를 rerender하지 않게 한다.
- `File`, Blob, queue와 preview는 persist store에 넣지 않는다.
- `openSessionIds`와 파일별 view state만 현재 탭의 `sessionStorage`에 저장한다.
- session switch는 여러 store setter를 UI 곳곳에서 호출하지 않고 coordinator의 단일 순서로 수행한다.

## 6. 비동기/경쟁 조건 규칙

session detail 열기는 `sessionLoadRevision`을 캡처하고, 분석 데이터 요청은 요청 시점의 `sessionId`를 캡처한다.

```ts
const revision = ++sessionLoadRevision;
const info = await getSessionInfo(sessionId);

if (revision !== sessionLoadRevision) return false;
setSession(sessionId, info);
return true;
```

- 늦은 응답을 “대개 먼저 끝날 것”이라는 가정으로 허용하지 않는다.
- 최초 자동 분석은 session ref guard로 한 번만 시작한다. 저장 cluster가 확인되면 실행하지 않는다.
- scatter/plate/cluster/well type/group 응답도 적용 직전에 요청 session ID와 현재 활성 ID를 비교한다.

## 7. 업로드 규칙

- extension 비교는 lowercase로 정규화하되 표시 파일명은 원본을 유지한다.
- 형식 grouping과 limit validation은 순수 함수로 구현하고 fixture 기반 단위 테스트를 둔다.
- 같은 선택의 XML만 한 묶음이다. 서로 다른 drop 이벤트의 XML을 암묵적으로 합치지 않는다.
- CSV/TSV/TXT/RDML/RDM은 기존 preview/mapping 경로로 보낸다.
- queue item은 `for...of`에서 하나씩 await해 순차 처리한다. 한 항목의 실패가 loop 전체를 throw하지 않게 항목 단위로 catch하며 빈 catch로 원인을 버리지 않는다.
- raw/table 내용을 로그 또는 browser storage에 기록하지 않는다.
- 파일별 50MB와 ZIP hardening은 backend에서 계속 강제한다.

## 8. API와 오류 규칙

- `frontend/src/lib/api.ts`의 기존 오류 변환을 사용하고 drawer는 항목별 오류 문자열을 보존한다.
- 사용자 메시지와 console 진단을 분리한다. console에 file content/token/sample identifiers를 넣지 않는다.
- 401은 전역 auth 흐름, 403/404는 해당 session을 열 수 없는 상태로 처리한다.
- 기존 GET session 목록/detail 외에 view-state/opened endpoint를 만들지 않는다.

## 9. 데이터베이스 규칙

- 이 MVP를 위해 schema migration, view-state/workspace table, last-opened column을 추가하지 않는다.
- `sessions.raw_filename`과 `created_at`을 기존 parameterized query로 읽어 list/detail response에 제공한다.
- 최근 파일은 기존 `uploaded_at` 최신순이며 열기 동작으로 DB timestamp를 변경하지 않는다.
- 작업 목록 닫기는 DELETE API나 DB write를 호출하지 않는다.
- backend 테스트는 임시 `DB_PATH`를 사용하고 운영/개발 DB를 공유하지 않는다.

## 10. 스타일/i18n 규칙

- 기존 semantic token(`bg-surface`, `border-border`, `text-danger` 등)을 쓰고 임의 hex를 JSX에 추가하지 않는다.
- 모든 사용자 문자열은 `ko.ts`와 `en.ts`에 동시에 추가한다.
- 파일명, instrument명, parser error의 원문 식별자는 번역하지 않는다.
- 상태는 icon+문구를 제공하며 색상만으로 표현하지 않는다.
- drawer animation은 reduced-motion을 존중한다.

## 11. 테스트 컨벤션

- backend: `snp-analyzer/tests/test_*.py`
- component/store: 기존 Vitest 패턴을 따라 `*.test.ts(x)` colocate
- Playwright: root `tests/NN-feature.spec.ts`, 다음 사용 가능한 번호 사용
- network race는 임의 `sleep`이 아니라 route interception/deferred promise로 완료 순서를 결정한다.
- file fixture는 합성 데이터와 공개 식별자만 사용한다.

필수 테스트 범주:

1. grouping/limit/duplicate/unsupported format
2. queue 부분 성공·재시도·CSV mapping serialization
3. XML bundle path 안전성
4. sessionStorage view state capture/restore와 새 session 기본값
5. existing cluster vs first-open auto analysis call count
6. rapid A→B→A와 generation/session ID 기준 역순 응답 폐기
7. drawer keyboard/focus/KO/EN/dark mode
8. close가 delete하지 않음
9. 기존 auth/upload/ZIP/parser/backend 전체 회귀

## 12. 검증 명령

```bash
cd snp-analyzer
venv/bin/python -m pytest --tb=short -q

cd snp-analyzer/frontend
npm run test
npm run lint
npm run build

# 앱을 8002에서 시작한 뒤 저장소 루트
npx playwright test
```

Python dependency는 반드시 `snp-analyzer/venv`에 설치하고 host interpreter를 오염시키지 않는다. 인증 test가 passlib/bcrypt 충돌로 실패하지 않도록 requirements의 `bcrypt==4.0.1`을 유지한다.

## 13. 완료 기준

- 구현 코드에 관련 단위/컴포넌트/E2E test가 있다.
- backend 전체 test, frontend test/lint/build, 관련 Playwright가 통과한다.
- stale 응답/권한/ZIP hardening/닫기-vs-삭제 회귀가 없다.
- 새 공용 함수와 복잡한 state transition에 타입이 있고 무의미한 `any`가 없다.
- 새 사용자 문자열 KO/EN 누락이 없고 접근성 serious/critical 위반이 없다.
- unrelated dirty worktree 변경과 기존 `docs/planning/06-tasks.md`를 수정하지 않는다.

## 14. 금지 사항

- `UploadZone`과 drawer에 업로드 로직 복사
- 컴포넌트에서 session store를 먼저 바꾸고 나중 응답을 무조건 적용
- 업로드 실패 catch를 비워 파일별 원인 소실
- localStorage에 File 내용/token/sample 데이터 저장
- drawer에 영구 삭제 추가
- parser/analysis 로직을 frontend에서 재구현
- 기존 사용자 변경을 reset/checkout으로 제거
