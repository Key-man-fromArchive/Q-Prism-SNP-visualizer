# Q-Prism UI/UX v0.2 구현 작업서 — Auto-Orchestrate

- Contract ID: qprism-ux-followup-20260907-v1
- 작성일: 2026-09-07
- 상태: IN PROGRESS — P1 서버·계약 기반 게이트 통과·로컬 통합 완료(83887a4). P2 분석·QC 화면 연결 진행 중.
- 기준: [UI/UX 후속 개선 기획서 v0.2](ui-ux-overhaul/04-review-followup-prd.md)
- 실행 기준 파일: docs/planning/06-tasks.md
- 이전 계약: [qPCR Import Expansion 원문 보관](archive/06-tasks-qpcr-import-expansion.md). 보관본의 작업은 이번 실행 대상이 아니다.

## 1. 실행 계약

### 범위와 권한

구현은 이후 auto-orchestrate 실행 요청부터 시작한다. 대상은 PRD UX-01~UX-10이다. 알고리즘·QC 임계값 변경, 신규 파서, 과거 분석 버전 탐색, 파일 자동 재시도는 제외한다. PRD v0.2의 변경표가 과거 UI/UX 문서보다 우선한다.

- 오케스트레이터는 의존성 선택·위임·상태 갱신·검증·Phase 통합을 담당한다. 소스·테스트 구현은 지정 specialist가 수행한다.
- 일반 auto-orchestrate 모드를 기본으로 한다. 작업서 작성 요청만으로 구현·main 병합·원격 push·외부 알림을 수행하지 않는다. 실행 시 세션의 권한과 스킬의 일반 모드 Phase 전환 규칙을 따른다. Slack 등 외부 메시지는 명시적 요청이 없으면 보내지 않는다.
- ID·Depends On·Status·담당·Write Scope·검증을 파싱해 DAG를 만든다. 선행 FAIL/BLOCKED면 후속 작업을 실행하지 않는다. 실패를 건너뛰어 Phase 완료로 처리하지 않는다.
- Status는 TODO → IN_PROGRESS → DONE 또는 BLOCKED/FAIL로 갱신한다. 체크박스는 모든 AC·검증 충족 및 로컬 커밋 존재 시에만 표시한다.
- 기능 작업은 TDD_MODE:RED_FIRST로 RED → GREEN → REFACTOR 증거를 남긴다. P0 준비·문서에는 인위적 RED를 요구하지 않는다. 검증 전용 작업은 테스트 실행·리뷰 결과가 증거다.
- specialist는 로컬 커밋 후 TASK_DONE:{task_id}:{commit_sha}를 보고한다. 검증 작업도 재현 명령·결과를 담은 증거 문서를 Phase 브랜치에 커밋한다. main 병합·push는 specialist가 하지 않는다.
- 호출은 기본 12턴, 통합은 최대 15턴으로 나눈다. 초과 시 완료 부분·실패 명령·다음 수정점을 인계한다. 동일 실패 반복 시 원인 분석 후 같은 Phase에서 수정한다.
- .claude/orchestrate-state.json은 실행 시 생성한다. Contract ID·문서 해시·기준 커밋·Phase·작업별 커밋을 연결한다. 이전 계약 상태를 이번 ID에 재사용하지 않는다. 기존 상태는 보존하고 불일치를 해소한 뒤 재개한다.

### 브랜치·Worktree·동시성

작성 당시 브랜치는 fix/ntc-origin-axis-selection, 코드 HEAD는 0b4ed25였다. main과 같다고 가정하지 않는다. 실행 전 최신 승인 코드와 PRD/작업서가 커밋되어 main에 포함됐는지 확인한다. 미포함이면 차이를 확인하고 필요한 기준 브랜치 통합부터 처리한다. 오래된 main에서 구현을 시작하지 않는다.

모든 Phase는 아래 브랜치 기반 Worktree에서 수행한다. Phase N 시작점은 이전 Phase 검증·통합이 끝난 main이다. 기존 경로·브랜치는 확인 후 재사용하고 강제 초기화하지 않는다.

| Phase | 브랜치 | Worktree(루트 기준) | 목적 |
| --- | --- | --- | --- |
| P0 | ux-followup/p0-preflight | worktree/ux-followup-p0 | 기준선·fixture·검증 도구 |
| P1 | ux-followup/p1-contracts | worktree/ux-followup-p1 | 결과 계약·서버 QC·출력 |
| P2 | ux-followup/p2-result-ui | worktree/ux-followup-p2 | 판정·QC·출력·키보드 UI |
| P3 | ux-followup/p3-continuity | worktree/ux-followup-p3 | 복원·실행취소·실패 처리 |
| P4 | ux-followup/p4-layout | worktree/ux-followup-p4 | 반응형·접근성·표현 |
| P5 | ux-followup/p5-release | worktree/ux-followup-p5 | 회귀·보안·운영 인계 |

PRD의 우선순위 P1/P2와 이 문서의 실행 Phase P0–P5는 다른 표기다. PRD 구현 순서 0(계약)은 P0–P1, 1(정확성)은 P1–P2, 2(연속성)은 P3, 3(레이아웃)은 P4에 대응하며 P5는 최종 통합 인수다.

생성 예: git worktree add worktree/ux-followup-p0 -b ux-followup/p0-preflight main

- 기본 동시성 1. P0의 두 독립 작업만 Write Scope·실행 환경 분리를 확인한 뒤 최대 2개 병렬화한다. 나머지는 DAG대로 직렬 실행한다.
- 동일 Worktree의 git index/커밋·패키지 설치·DB/서버 조작은 직렬화한다. specialist가 동시에 git add/commit하지 않는다.
- models.py, db.py, clustering.py, data.py, types/api.ts, lib/api.ts, App.tsx, Header.tsx, locales/*는 공유 자원이다. 작업명만 다르다고 병렬화하지 않는다.
- Write Scope 밖 수정은 오케스트레이터에게 영향 파일을 보고하고 소유권 조정 후 진행한다. 범위 밖 기능을 암묵적으로 추가하지 않는다.

## 2. 공통 검증과 증거

약어: BE=snp-analyzer, FE=snp-analyzer/frontend, SRC=FE/src. 명령은 해당 Phase Worktree에서 실행한다.

| 별칭 | 디렉터리 | 명령/검증 |
| --- | --- | --- |
| BE-TEST | BE | venv/bin/python -m pytest tests/<task_test>.py --tb=short -q |
| BE-ALL | BE | venv/bin/python -m pytest --tb=short -q |
| FE-TEST | FE | npm run test -- src/<task_test>.test.ts 또는 .test.tsx |
| FE-CHECK | FE | npm run lint 및 npm run build 각각 실행 |
| FE-ALL | FE | npm run test |
| ROOT-E2E | 루트 | E2E_BASE_URL=<이번 Worktree Vite 주소> npx playwright test tests/<NN-feature>.spec.ts --project=chromium --workers=1 |
| EXISTING-E2E | FE | VITE_DEV_API_TARGET=<격리 API 주소> E2E_PORT=<할당 포트> npm run e2e |
| COVERAGE | BE/FE | P0-T0.1에서 마련한 명령·대상 manifest 사용 |

- Python은 BE/venv에 두 requirements 파일로 준비하고 bcrypt 4.0.1을 확인한다. 호스트 설치 금지. coverage·보고서 추출 도구는 개발 의존성에만 추가한다.
- 백엔드는 임시 DB_PATH와 합성 계정·local 인증으로 실행한다. JWT/계정 값은 테스트 환경에서 생성하고 로그·커밋에 담지 않는다. 운영 DB는 사용하지 않는다.
- 루트 E2E는 서버 자동 시작이 없다. 새 18~26번 테스트는 현재 Worktree Vite/API와 공용 로그인 helper를 사용한다. FE E2E는 기존 Vite 자동 실행·auth.setup을 사용한다. 포트·인증 파일을 병렬 공유하지 않는다.
- UI는 정상/빈/로딩/실패 상태와 관련 언어·테마를 브라우저로 확인한다. 재현 페이지가 필요하면 개발/테스트 모드에 한정하고 배포 빌드에서는 노출하지 않는다.
- 증거는 docs/planning/ui-ux-overhaul/evidence/<task-id>.md에 커밋·명령·결과·남은 문제를 기록한다. 이미지·trace·coverage 원본은 격리 artifact 경로에 두고 링크한다. 비공개 샘플명·인증 파일·대용량 생성물은 커밋하지 않는다.
- Phase 체인: verification → evaluation → code-review → security(해당 변경) → frontend review(해당 변경). 관련 테스트·lint/build 성공, 미해결 중요 리뷰 이슈 0, 새 코드 coverage 70% 이상·복잡도 10 이하를 확인하고 전체 coverage도 보고한다. 기존 실패·coverage 부족·기존 보안 문제는 기준선과 분리한다. 미충족 게이트를 PASS로 처리하지 않으며 범위 밖 개선이 필요하면 차단 사유로 인계한다.

## 3. 인터페이스 계약 점검(ICV)

현재 구현의 공백을 아래 Resource 작업으로 해소한다. 계획상 연결은 지정했으나 API가 이미 지원된다는 의미는 아니다. Screen은 해당 Resource 완료 후 실행한다.

| 소비 동작 | 필요한 계약/현재 공백 | 생산 작업 | 소비 작업 |
| --- | --- | --- | --- |
| 분석·복원 | analysis_context/result/input revision, legacy_unknown; 저장 조건 누락 | P1-R1-T1~T3 | P2-S1-T1, P3-S1-T1 |
| QC | NTC status/flagged/reason, authoritative/markers; 타입/미평가 분기 누락 | P1-R2-T1 | P2-S2-T1 |
| 추천 안내 | 상승 평가 상태·사유; null 의미 중복 | P1-R2-T1 | P2-S1-T1 |
| CSV/PDF/XLSX | 버전 고정 snapshot·409·metadata; 조건 혼합 | P1-R3-T1~T2 | P2-S3-T1 |
| PNG | 활성 chart handle·렌더 버전·필터 캡션; 고정 ID 의존 | P2-S3-T1 | P2-S3-T1 |
| 탐색 | navigation-store·URL·restoring; 로컬 상태 충돌 | P1-S0-T1 | P3-S1-T1 |
| undo | mutation revision·공유 이력·충돌 감지; 이력 미연결 | P1-R1-T2, P3-S2-T1 | P3-S2-T1 |
| 업로드 내역 | 메모리 job·unknown; 원인 소실 | P3-S3-T1 | P3-S3-T1 |

계약은 PRD §5를 따른다. 실제 필드·오류 코드·revision 대상은 P0-T0.1의 appendix에 확정하고 P1에서 검증한다. 미결 항목을 빈 TODO로 소비 코드에 넘기지 않는다.

## Phase P0 — 실행 기준선과 검증 준비

### P0-T0.1: 기준 커밋·계약·검증 환경 확정

- Status: DONE
- Commit: 9f519ae86cc430c819ee49dbb2bf7b2913a0aefa
- Evidence: [P0-T0.1](ui-ux-overhaul/evidence/P0-T0.1.md). 기준선 기록 완료이며 품질 게이트 통과는 아님.
- 담당: test-specialist
- Depends On: []
- Write Scope: docs/planning/ui-ux-overhaul/05-contract-appendix.md, BE/requirements-dev.txt, FE/package.json·lockfile·vitest.config.ts, tests/helpers.ts, 테스트/coverage 설정
- 구현: 코드·문서 커밋/해시와 기존 기준선을 기록한다. appendix에 revision 증가 대상·생성, stale/legacy 오류, 상태 소유권, 응답 필드·호환 정책을 backend 관점으로 명세한다. 제품 모델/DB 변경은 하지 않는다.
- 구현: pytest-cov, Vitest와 버전이 맞는 coverage provider, PDF/XLSX 내용 검사 도구와 대상 manifest를 준비한다. 기존 전체/변경 모듈 지표를 분리하고 격리 환경·로그인 helper를 정리한다.
- 검증: BE-ALL, FE-ALL, FE-CHECK, 기존 E2E 목록/기준선, COVERAGE. 환경 실패와 제품 결함 구분.
- [x] AC: 올바른 소스/계획을 읽는 격리 환경과 계약 appendix가 준비되고 baseline 실패가 숨겨지지 않음.

### P0-T0.2: 결정적 판정·QC·보고서 fixture

- Status: DONE
- Commit: 77010b0d9956fba11e3547bf21935c953b50b4ca (초기 d6345b6 이후 복잡도 수정)
- Evidence: [P0-T0.2](ui-ux-overhaul/evidence/P0-T0.2.md). 합성 fixture 검증 25개 통과, 생성기 coverage 100%, 최대 복잡도 9.
- 담당: test-specialist
- Depends On: []
- Write Scope: BE/tests/fixtures/ux_followup/, BE/tests/fixtures_ux_followup.py, BE/tests/test_ux_fixtures.py
- 구현: 기존 fixture를 재사용해 값이 다른 20/40사이클·96/384웰·읽기 구간·서로 다른 배수성 마커·ROX 없음/해제·NTC 정상/오염/미존재/불충분을 정의한다. 비공개 파일을 사용하지 않는다.
- 구현: raw/normalized·background별 기대 수치, context 없는 저장 결과, 지연/실패 사례를 포함한다. 새 API는 구현하지 않는다.
- 검증: BE-TEST(test_ux_fixtures.py), 결정성·범위·크기·출처 검사.
- [x] AC: 각 실패 시나리오에 이름과 기대 결과가 있고 반복 생성 입력이 동일함.

### P0-R0-T1: 런타임·인증 의존성 보안 보완

- Status: DONE
- Commit: 009a7627dbbe266b895943884bad9a476e827e0f
- Evidence: [P0-R0-T1](ui-ux-overhaul/evidence/P0-R0-T1.md)
- 담당: security-specialist
- Depends On: [P0-T0.1]
- Write Scope: BE/requirements.txt·requirements-dev.txt, BE/app/auth.py 및 필요한 JWT adapter, BE/tests/의 auth·dependency 보완, evidence/P0-R0-T1.md
- 구현: python-multipart 수정 버전을 고정하고 python-jose/ecdsa 의존 경로를 검증 가능한 JWT 구현으로 교체한다. HS256 제한·토큰 claim·만료·쿠키·ASG 정책과 기존 유효 토큰 호환을 보존한다. 취약점 제외 규칙으로 통과시키지 않는다.
- 검증: TDD_MODE:RED_FIRST, 기존 토큰/잘못된 서명·알고리즘·만료·claim 회귀, BE-ALL, pip check/audit, 변경 코드 coverage/복잡도. 호스트 환경 수정 금지.
- [x] AC: 인증·업로드 정책 회귀 없이 의존성 보안 게이트 통과, 실제 깨끗한 venv에서 재현 가능.

### P0-S0-T1: 프론트엔드 lint·검증 도구 보안 보완

- Status: DONE
- Commit: e9c9b1d5fdb4f608d424a66cca4f0bd078a36a56 (typing 723b551, state a11ece17 및 선행 보완 포함)
- Evidence: [P0-S0-T1](ui-ux-overhaul/evidence/P0-S0-T1.md), [typing](ui-ux-overhaul/evidence/P0-S0-T1-typing.md). Phase 통과는 독립 P0-S0-V 판정으로 확정한다.
- 담당: frontend-specialist
- Depends On: [P0-T0.1]
- Write Scope: FE/package.json·lockfile·vitest/test 설정, SRC의 기존 lint 오류/경고 파일 및 필요한 typed helpers·회귀 테스트, evidence/P0-S0-T1.md
- 구현: Vitest와 coverage를 동일 호환 버전으로 업그레이드하고 필요한 전이 의존성을 보완한다. 기존 lint 문제를 타입/상태 소유권 수정으로 해소하며 규칙 비활성화·무의미한 타이머 우회 금지. 제품 UX/과학 알고리즘 재설계는 후속 작업에 남긴다.
- 확인된 계약 보완: Batch 집계의 실제 `genotypes/ntc_count/unknown_count` 응답 매핑과 SettingsTab의 지원하지 않는 preset algorithm 검증은 typed API 연결에 필요한 최소 회귀 수정으로 포함한다. 임의 응답 타입 추가나 조용한 알고리즘 변경으로 숨기지 않는다.
- 검증: 상태 변경에는 TDD_MODE:RED_FIRST, FE-ALL/CHECK·coverage·npm audit, 분석/ASG 상태·Plotly·화면 smoke 회귀. 변경된 실행 분기는 테스트하고 브라우저 증거를 남긴다.
- [x] AC: lint 오류 0, 기존 테스트/build 통과, high/critical audit 0, 사용 동작 회귀 없음.

두 보완 작업은 사용자 승인된 P0 추가 범위다. BE/FE 파일·환경을 분리해 병렬 실행 가능하나 git index/commit은 오케스트레이터가 슬롯을 지정해 직렬화한다. 총 작업은 33개이며 이후 의존성은 유지한다.

### P0-S0-V: Preflight·ICV 게이트

- Status: DONE
- Gate Commit: 079d23ce449b14a6e8789813f93d40a3fb6bc93d (이전 BLOCKED bc8fc0d는 증거에 보존)
- Evidence: [P0-S0-V](ui-ux-overhaul/evidence/P0-S0-V.md)
- Previous Blocker: 기존 lint 32 errors 및 의존성 audit. 사용자 승인으로 P0-R0-T1/P0-S0-T1에서 해결 후 재검증한다. 이전 BLOCKED 증거는 이력으로 보존한다.
- 담당: test-specialist
- Depends On: [P0-T0.1, P0-T0.2, P0-R0-T1, P0-S0-T1]
- Write Scope: docs/planning/ui-ux-overhaul/evidence/P0-S0-V.md
- 검증: DAG/ID/Write Scope, fixture 연결, 환경/coverage, appendix와 PRD 대조. 미지원 필드에 소비 코드가 의존하지 않도록 순서 확인.
- [x] AC: 기준 커밋·해시·baseline·미해결 범위 밖 문제와 P1 진입 판정을 기록함.

## Phase P1 — 결과 계약과 서버 일관성

### P1-R1-T1: 분석 컨텍스트 모델·DB 왕복 저장

- Status: DONE
- Commit: b7c6e8752aa57de2fb5b9ae44b37e512f60ffee8
- Evidence: [P1-R1-T1](ui-ux-overhaul/evidence/P1-R1-T1.md). 독립 최종 BE 530 passed + 2 subtests, 변경 실행 줄 100%, mypy/Ruff 통과.
- 담당: database-specialist
- Depends On: [P0-S0-V]
- Write Scope: BE/app/models.py·db.py·main.py, BE/tests/test_analysis_context_persistence.py 및 BE/tests/test_marker_catalog.py의 migration 버전 호환 assertion·중복 테스트명 정정
- 구현: context 전체 필드·schema/result/input revision·UTC 완료 시각·마커별 실제 parameters를 모델링하고 결과와 함께 원자 저장한다. 구버전은 추정 없이 legacy_unknown으로 읽는다.
- 구현: SQLite/JSON 호환 migration과 시작 복원을 연결한다. 기존 결과 삭제나 임의 backfill 금지.
- 검증: 새 결과 왕복·구버전 JSON/행·재시작·rollback, 기존 persistence 회귀.
- [x] AC: 조건이 손실 없이 복원되고 기존 DB가 데이터 손실 없이 열림.

### P1-R1-T2: 입력 revision·변경 명령 일원화

- Status: DONE
- Commit: da35b12c01b16c7df75d5eabaee0e0ca9e300f7f
- Evidence: [P1-R1-T2](ui-ux-overhaul/evidence/P1-R1-T2.md). 독립 BE 552 passed + 2 subtests, 변경 실행 줄 91.67–100%, 새 논리 복잡도 최대 8.
- 담당: backend-specialist
- Depends On: [P1-R1-T1]
- Write Scope: BE/app/routers/clustering.py·layouts.py·sample.py·marker_catalog.py, BE/app/models.py·db.py, 신규 BE/app/processing/analysis_state.py, BE/tests/test_analysis_input_revision.py 및 기존 mutation/marker 계약 회귀 테스트
- 구현: welltype set/clear/bulk, ploidy, marker create/update/delete, layout apply 등 모든 판정 입력 변경을 조사해 변경/revision 증가를 같은 transaction·직렬화 경계에 연결한다.
- 구현: mutation 응답 input_revision, undo용 선택적 expected revision·409를 추가한다. 보기·언어·축 변경은 제외하고 stale 결과 정책을 보존한다.
- 접점 확인: 공용 mutation body는 models.py에 있고 session 삭제/정보는 sample.py에 있다. 요청에 포함된 ploidy 변경도 숨은 입력 변경으로 조사한다. 세션 삭제는 결과/마커/진행 요청 상태를 함께 정리하고, 마커 변경 시 결과 삭제를 요구하던 기존 테스트는 새 retained-stale 계약의 명시적 기대값으로 갱신한다.
- 검증: 경로별 증가, 실패/no-op, 권한, stale expected revision, layout/bulk 누락 검사.
- [x] AC: API 직접 변경도 결과를 무효화하고 실패 mutation은 버전을 전진시키지 않음.

### P1-R1-T3: 결과 원자 게시·동시성 제어

- Status: DONE
- Commit: 43a013be8639b90baee6fbff62f4d70f47c05046
- Evidence: [P1-R1-T3](ui-ux-overhaul/evidence/P1-R1-T3.md). 독립 BE 571 passed + 2 subtests, 변경 실행 줄 97.98–100%, 새 논리 복잡도 최대 10.
- 담당: backend-specialist
- Depends On: [P1-R1-T2]
- Write Scope: BE/app/routers/clustering.py 및 sample.py의 세션 상태/삭제 연결, BE/app/processing/analysis_state.py, BE/app/models.py·db.py, BE/tests/test_analysis_revision_races.py
- 구현: 계산 시작 입력/parameters를 고정하고 완료 시 input revision·요청 순서를 검증해 게시한다. DB와 cluster_store가 다른 버전을 가리키지 않게 한다.
- 구현: 계산 중 mutation·늦은 완료·저장 실패·조회 상태를 다룬다. 현재 동기/비동기·프로세스 범위에 맞는 lock/CAS를 기록하고 최신 결과 한 건만 유지한다.
- 검증: A/B 역순 완료, 계산 중 marker/welltype 변경, 저장 실패, 독립 세션 동시 처리.
- [x] AC: 오래된 계산이 최신 결과를 덮어쓰지 않고 context가 실제 계산 입력과 일치함.

### P1-R2-T1: NTC·마커별 QC·상승 평가 계약

- Status: DONE
- Commit: 9c15ff968c5026a41d6e322665e0bccc35767b93 (초기 d514a94 이후 imported Unknown 보완)
- Evidence: [P1-R2-T1](ui-ux-overhaul/evidence/P1-R2-T1.md). 최종 BE 619 passed + 2 subtests, 독립 집중 89 passed, 변경 실행 줄 100%, 새 논리 복잡도 최대 10.
- 담당: backend-specialist
- Depends On: [P1-R1-T3]
- Write Scope: BE/app/routers/qc.py·data.py, BE/app/processing/ntc_detection.py, BE/app/models.py, BE/tests/test_qc_status_contract.py 및 기존 test_a2_region_passthrough.py·test_marker_contract.py·control/cycle 테스트의 QC 계약 setup·회귀 보강. 장비의 일반 시료 Unknown과 명시적 수동 Unknown을 구분하기 위한 clustering.py의 captured manual_well_types 및 관련 test_analysis_revision_races.py 보완 포함.
- 구현: 기존 ok/wells 유지, status·flagged/reason 추가. NTC 없음/평가불가/부분평가/오염을 구분하고 상승 감지 evaluation 상태를 별도로 반환한다. 임계값은 변경하지 않는다.
- 구현: authoritative/markers와 판정 기반 지표의 버전/조건, 현재 보기 NTC 조건을 구분한다. legacy/stale를 정상 최신 QC로 포장하지 않는다.
- 검증: 정상/오염 혼합·0개·불충분·구응답, 두 배수성 QC, 20/40사이클, no-onset/not-evaluated, 기존 control QC·cycle suggestion 회귀.
- [x] AC: 모든 NTC와 flagged 웰이 구분되고 마커별 권위값·조건이 명확함.

### P1-R3-T1: 출력 스냅샷 계약·CSV

- Status: DONE
- Commit: 991dabad1142f7df4a311162eed9077a0014ba74
- Evidence: [P1-R3-T1](ui-ux-overhaul/evidence/P1-R3-T1.md). 최종 BE 678 passed + 2 subtests, 독립 집중 85 passed, 신규 스냅샷 98.34%·CSV 추가 실행 줄 100%.
- 담당: backend-specialist
- Depends On: [P1-R2-T1]
- Write Scope: 신규 BE/app/reporting/result_snapshot.py, BE/app/routers/export.py, BE/app/processing/analysis_state.py, BE/tests/test_export_snapshot_csv.py 및 기존 CSV/마커 출력 테스트의 계약·setup 갱신. 같은 export.py의 기존 XLSX QC dict 타입 불변성 오류는 주석만 보완하며 XLSX 동작 연결은 다음 작업에 둔다.
- 구현: result_revision 지정/생략, input revision/legacy 검증, 409를 공통 snapshot 서비스로 구현한다. 수락 이후 판정·신뢰도·manual 유형·표시 metadata·계산 조건을 고정한다.
- 구현: 전체 실행 CSV의 마커 열·기존 데이터 열을 유지하고 조건 metadata 열을 추가한다. 임의 cycle/ROX/background와 저장 조건 불일치는 명시 오류로 전환한다.
- 검증: 20/40·ROX/background만 차이, legacy/missing/stale, 결과 교체·수락 후 mutation·권한.
- [x] AC: CSV에 혼합 조건이 없고 수락된 snapshot을 끝까지 사용하며 버전/조건을 파일에서 읽을 수 있음.

### P1-R3-T2: PDF·XLSX 일치·연결 소비자 호환

- Status: DONE
- Commit: ccc590fcd31f81417ee947b40f35a30ab44f8ad7
- Evidence: [P1-R3-T2](ui-ux-overhaul/evidence/P1-R3-T2.md). 최종 BE 710 passed + 2 subtests, 독립 집중 80 passed, 신규 모듈 98.5% 이상·변경 실행 줄 93.3% 이상.
- 담당: backend-specialist
- Depends On: [P1-R3-T1]
- Write Scope: BE/app/routers/data.py·export.py·asg.py, BE/app/asg_result.py, BE/app/reporting/* (한글 TrueType 글꼴·라이선스·출처 포함), BE/requirements-dev.txt의 PDF 렌더 검증 도구, BE/tests/test_export_snapshot_reports.py·test_asg_result_save.py 및 기존 PDF/XLSX/ASG 출력 테스트의 계약·setup 갱신
- 구현: PDF max(cycles)·XLSX 독자 조건 선택을 공통 snapshot으로 연결한다. 그림·판정·신뢰도는 같은 결과, Ct 등 전체 곡선 값은 별도 계산 범위를 명시한다.
- 구현: ASG 등 결과 소비자의 추가 필드/오류를 점검하고 필요한 adapter만 적용한다. 스코프·저장 상태 정책은 보존한다.
- 검증: 실제 CSV/PDF/XLSX의 공통 웰·판정·수치·metadata 비교. PDF metadata만이 아니라 렌더에 전달된 수치도 검증. 기존 보고서/ASG 회귀.
- 검증 준비: pypdfium2는 검증된 wheel 버전을 개발 의존성에만 고정하고 audit한다. 한글 TrueType 글꼴은 원본·재배포 라이선스·upstream commit/SHA-256을 함께 보관하고 PDF에 포함한다. 호스트 전용 글꼴 경로나 뷰어의 CJK 대체 글꼴을 배포 검증으로 간주하지 않는다. 긴 한글 이름·모든 페이지의 렌더링과 텍스트를 확인한다.
- [x] AC: 형식별 묵시적 사이클 대체가 없고 정상/legacy/stale·소비자 호환성이 확인됨.

### P1-S0-T1: 프론트 API·분석/탐색 상태 기반

- Status: DONE
- Commit: c880b0a803aa41635237ed9cd0609431670c001a
- Evidence: [P1-S0-T1](ui-ux-overhaul/evidence/P1-S0-T1.md). FE 167개·독립 집중 62개, lint/build/type 통과. 신규 모듈 및 API 변경 실행 줄 각각 100%, 복잡도 ≤10. 실제 화면 연결은 P2/P3 범위.
- 담당: frontend-specialist
- Depends On: [P1-R3-T2]
- Write Scope: SRC/types/api.ts, SRC/lib/api.ts, 신규 SRC/stores/analysis-store.ts·navigation-store.ts, SRC/lib/analysis-context.ts 및 단위 테스트
- 구현: context/QC/revision/409 타입·API를 연결하고 런타임 경계에서 missing/legacy/error를 구분한다. analysis-store에 결과·pending/current/mismatch/error·요청 ID를 둔다.
- 구현: navigation-store와 URL 직렬화/유효성 순수 함수를 정의한다. 실제 App 마운트·URL 복원은 후속 작업에서 연결한다.
- 검증: parameters별 불일치/보기 변경, 구응답·역순 응답, URL 왕복·잘못된 값, 409. FE-TEST, FE-CHECK.
- [x] AC: 소비 화면이 값을 추정하지 않고 조건/버전/탐색의 단일 소유자를 사용할 수 있음.

### P1-S0-V: 계약·서버 품질 게이트

- Status: DONE
- Commit: 4a1a632fcdb73d92273214f10fa572d4fd2c03af
- Evidence: [P1-S0-V](ui-ux-overhaul/evidence/P1-S0-V.md). BE 710개+2 subtests, FE 167개, 브라우저 14개 및 상태 smoke 통과. 누적 변경 코드 모듈별 coverage·정적/보안 검사 통과. 기존 헤더 QC 갱신·onset 의미 구분은 P2-S1/S2 필수이며 최종 UI 승인·배포는 아님.
- 담당: test-specialist
- Depends On: [P1-S0-T1]
- Write Scope: docs/planning/ui-ux-overhaul/evidence/P1-S0-V.md
- 검증: BE-ALL, FE-ALL, FE-CHECK, COVERAGE, migration/동시성/출력/권한 리뷰, 문서·타입·응답 대조.
- [x] AC: UX-01 서버·UX-02 A/서버 출력 기준 통과. 새 필드로 기존 UI가 깨지지 않는 smoke 확인. 필수 소비자 연결 누락 시 진입/배포 불가.

## Phase P2 — 분석 화면의 정확성·입력 동작

### P2-S1-T1: 단일·다중 마커 분석 상태 연결

- Status: DONE
- 담당: frontend-specialist
- Depends On: [P1-S0-V]
- Write Scope: SRC/App.tsx, SRC/components/의 분석 Workspace·AnalysisTab·MultiMarker·CycleControl, 관련 stores/hooks·locales 및 테스트. 기존 SettingsTab·ScatterPlot 분석 진입점과 UploadZone·Batch의 신규/기존 세션 진입 구분도 공통 상태 연결에 필요한 범위만 포함한다(화면 재설계·과학 계산 변경 제외).
- 계약 보완 범위: BE/app/routers/sample.py의 기존 세션 조회 응답에 `cycles: number[]`를 추가하고 focused backend 테스트 및 SRC/types/api.ts의 세션 조회 타입을 갱신한다. 실제 `unified.cycles`를 전달하며 `num_cycles`(개수)를 절대 사이클로 추정하거나 전체 곡선을 재조회하지 않는다. 인증·기존 필드·DB/계산 정책은 보존한다.
- 구현: 분석 결과/입력 revision·pending·실패·불일치를 공통 상태로 표시한다. 단일 분석은 명시 실행/새 업로드 최초 자동 실행, 다중 마커는 입력 안정화 후 기존 220ms 자동 분석을 유지한다.
- 구현: 현재 사이클 재분석과 추천 사이클 분석을 구분한다. 재생/복원 중 자동 분석을 막고 역순 응답을 폐기한다. 탐색 상태를 navigation-store로 이전하되 URL 복원 IO는 P3에서 연결한다.
- 검증: 빠른 연속 변경, 늦은 응답, 실패 후 재실행, 보기 전용 변경, ROX/배경/마커 조건 변경의 컴포넌트 테스트. FE-ALL, FE-CHECK.
- 추가 검증: 세션 조회의 sparse/zero 사이클 목록·접근 권한 backend 테스트와 실제 사이클 기반 초기화·복원 FE 테스트. 서버 응답 변경은 P2 게이트에서 BE-ALL로 재검증한다.
- 호환성 보완: scatter/plate/clustering에 선택적 `cycle_mode=absolute`를 추가한다. P2 실제 선택 사이클은 절대 좌표로 전달하고 모드 생략은 기존 0→마지막 의미를 유지한다. 공통 cycle resolver·ClusteringRequest·data/clustering router·PlateView와 관련 테스트를 범위에 포함한다.
- 검증 기록: [P2-S1-T1 evidence](ui-ux-overhaul/evidence/P2-S1-T1.md). 독립 코드 리뷰 및 Chromium P5 14/14·P2 smoke PASS.
- [x] AC: 표시된 조건과 완료 결과의 관계가 명확하고, 오래된 응답이 최신 결과를 덮어쓰지 않음.

### P2-S2-T1: QC 상태·마커별 결과 표시

- P2-S1 후속 계약: 선택한 실제 cycle 0을 QC 요청에서도 `cycle_mode=absolute`로 전달하고 공유 resolver를 적용한다. 모드 생략 시 기존 0→마지막 cycle 호환성을 유지한다.

- Status: TODO
- 담당: frontend-specialist
- Depends On: [P2-S1-T1]
- Write Scope: SRC/components/의 Header·QC 표시/상세, 관련 hooks/locales, tests/19-qc-status.spec.ts
- 구현: ok/warning/no_ntc/insufficient와 웰별 flagged/reason을 구분한다. NTC 전체 목록을 경고 목록으로 해석하지 않는다. 추천 사이클 미평가/검출 없음도 구분한다.
- 구현: 선택 마커의 서버 QC와 전체 플레이트 NTC 범위를 표시하고, 이전 조건 QC를 현재 조건으로 오인하지 않도록 표시한다. 마커 없는 경우 임의 pooled separation을 만들지 않는다.
- 검증: NTC 없음·정상·경고·부족, 일부 웰만 경고, 마커별 상이한 QC, stale/legacy 시나리오. FE-TEST, ROOT-E2E.
- [ ] AC: UX-01 상태 행렬 전체를 KO/EN으로 확인하고 서버 판정과 화면이 일치함.

### P2-S3-T1: 출력 버전 선택·활성 차트 PNG

- P2-S1 후속 계약: CSV/PDF/XLSX/ASG의 명시적 실제 cycle 0에도 `cycle_mode=absolute`를 연결한다. 모드 생략의 기존 0→마지막 cycle 의미는 유지하며, cycle 생략으로 저장된 context.cycle을 선택하는 출력은 이미 안전하다.

- Status: TODO
- 담당: frontend-specialist
- Depends On: [P2-S2-T1]
- Write Scope: SRC/hooks/의 export, SRC/components/의 출력 메뉴·대화상자·ScatterPlot, 관련 lib/locales, tests/18-result-consistency.spec.ts
- 구현: 모든 출력에 result_revision을 결합한다. CSV/PDF/XLSX는 전체 런, PNG는 활성 차트/마커·필터 범위를 명시한다. 고정 DOM ID 대신 활성 차트 ref/registry를 사용한다.
- 구현: 화면 20/결과 40 불일치에서 재분석 20 후 출력·저장 결과 40 출력·취소를 제공한다. 후자는 화면 20 유지, PNG만 확인 후 결과 40 화면을 렌더하고 출력한다. 입력 revision 변경/legacy에는 이전 결과 출력을 허용하지 않는다.
- 구현: 계산 중 비활성화, 409 재확인, 다운로드 실패/재시도, 조건·버전·시각 metadata/caption을 연결한다.
- 검증: 실제 다운로드 CSV/PDF/XLSX의 값·자료형·metadata, PNG 비어 있지 않음/활성 마커/caption. 단일·다중, ROX/배경, 20/40, pending/409/legacy를 테스트한다.
- [ ] AC: UX-02 C의 선택별 화면·파일 동작이 일치하며 선택 웰 필터가 전체 런 출력을 축소하지 않음.

### P2-S4-T1: 포커스별 키보드 계약

- Status: TODO
- 담당: frontend-specialist
- Depends On: [P2-S3-T1]
- Write Scope: SRC/hooks/의 단축키, SRC/components/의 PlateView·결과 그리드·메뉴/대화상자, tests/20-keyboard.spec.ts 및 단위 테스트
- 구현: defaultPrevented 우선 반환, 위젯 이벤트 소유권, 입력/editable에서 앱 단축키 차단을 적용한다. 일반 버튼/탭/메뉴/대화상자는 Space·Enter·방향키·Escape 기본 동작을 보존한다.
- 구현: 그리드 방향키/Home/End/Shift 선택·Enter/Space 선택·Escape 해제와 유효한 1–7/Ctrl+E를 연결한다. 분석 바깥 재생/사이클/타입 변경을 차단하고 언어/테마/도움말 예외를 PRD대로 제한한다.
- 검증: mouse 없이 포커스 순회, 버튼 Space가 재생하지 않음, 입력 Ctrl+Z는 브라우저 동작. undo/redo 실제 API 성공·실패 검증은 P3-S2-T1에서 완결한다.
- [ ] AC: UX-03 키보드 행렬을 통과하고 기존 PlateView roving focus를 회귀시키지 않음.

### P2-S0-V: 정확성 품질 게이트

- Status: TODO
- 담당: test-specialist
- Depends On: [P2-S4-T1]
- Write Scope: docs/planning/ui-ux-overhaul/evidence/P2-S0-V.md
- 검증: BE-ALL, FE-ALL, FE-CHECK, ROOT-E2E 18–20, COVERAGE, 출력 실파일 증거와 frontend/code 리뷰.
- [ ] AC: UX-01·02·03 통과. UX-03 undo 연결만 명시적으로 P3에 이관하며 나머지 미구현을 통과 처리하지 않음.

## Phase P3 — 복원·실패 복구·수동 편집

### P3-S1-T1: URL·세션 복원 상태 머신

- Status: TODO
- 담당: frontend-specialist
- Depends On: [P2-S0-V]
- Write Scope: SRC/App.tsx, navigation-store, Workspace·MultiMarker·CycleControl 및 세션/설정 hooks, tests/21-workspace-restore.spec.ts
- 구현: 인증 → 세션 → 마커/저장 결과 → 사이클/윈도 검증 → 설정·절대 사이클 원자 적용 → ready 순서로 복원한다. URL은 session/tab/surface/marker/cycle만 사용한다.
- 구현: 탐색은 URL > 저장 결과 사이클/기본 마커 > 데이터 기본값, 분석 설정은 사용자·세션별 sessionStorage > 저장 context > 유효 기본값으로 결정한다. 로그아웃 캐시 제거, 다른 세션 데이터 누출 방지.
- 구현: restoring 중 CycleControl 초기화·App ROX 초기값·다중 자동 분석·URL 쓰기를 차단하고 ready 직후 첫 자동 분석도 생략한다. 불일치는 표시만 한다. 탭/하위 화면/마커 pushState, 사이클 replaceState, popstate는 재생 중지·URL 재기록 금지.
- 검증: 새로고침/직접 링크/뒤로·앞으로, 잘못된 마커·절대 사이클·윈도, ROX 복원, 401 인증 모드별 동작/403/404/5xx 재시도. DB 재시작 후 복원은 서버 유지 동작과 함께 검사한다.
- [ ] AC: UX-06 우선순위와 오류 행렬을 통과하고 복원이 새 분석을 암묵적으로 생성하지 않음.

### P3-S2-T1: 공유 수동 편집 명령·undo/redo

- Status: TODO
- 담당: frontend-specialist
- Depends On: [P3-S1-T1]
- Write Scope: 신규 SRC/stores/undo-store.ts, 수동 웰 타입 변경 hooks/호출부·단축키, 관련 tests, tests/23-undo.spec.ts
- 구현: 모든 수동 타입 변경 진입점을 공유 명령으로 통합한다. 단일/복수 웰 변경을 한 묶음으로 최대 50개 보관하고 API 성공 후에만 히스토리 포인터를 이동한다.
- 구현: 예상 revision 충돌은 히스토리를 무효화하고 오류를 표시한다. 실패는 기존 포인터/값 유지. 세션 전환·새로고침·로그아웃 초기화. 마커/축/분석 결과는 이력 대상에서 제외한다.
- 구현: undo/redo도 입력 revision을 갱신하며 단일 stale/다중 자동 분석 정책을 동일하게 적용한다.
- 검증: 서로 다른 컴포넌트에서 편집 후 undo, 다중 웰 원자 복원, 50개 경계, 실패/409, Ctrl+Z/redo와 텍스트 입력의 격리.
- [ ] AC: UX-10과 UX-03의 undo/redo 조건을 실제 서버 상태까지 확인함.

### P3-S3-T1: 프리셋·최근 세션·배치 업로드 실패 복구

- Status: TODO
- 담당: frontend-specialist
- Depends On: [P3-S2-T1]
- Write Scope: SRC/components/의 프리셋·최근 세션·Upload/Project, 신규 SRC/stores/upload-job-store.ts, 관련 API/hooks/locales, tests/22-error-recovery.spec.ts
- 구현: 저장/삭제/목록 오류와 재시도를 노출하고 작성 입력을 유지한다. 최근 세션 조회 실패와 빈 목록을 구분한다.
- 구현: 배치 업로드별 파일명·상태·실패 원인·성공 sessionID를 메모리에 보관해 탭 이동 후에도 보여준다. 부분 실패 시 자동 이동하지 않고 사용자가 프로젝트 이동을 선택하게 한다.
- 구현: 응답 유실은 성공/실패로 단정하지 않고 unknown과 세션 확인 경로를 제공한다. 새로고침/로그아웃에서 작업 목록 제거; File 바이트 유지·자동 멱등 재업로드는 구현하지 않는다.
- 검증: 500/네트워크 단절/부분 성공/응답 유실, 재시도 입력 보존, 탭 이동·초기화·다른 사용자 접근 방지.
- [ ] AC: UX-05 모든 오류가 조용히 무시되지 않고, 중복 업로드를 유도하는 자동 재시도가 없음.

### P3-S4-T1: 마커 미설정·제외·Empty/Omit 의미 정리

- Status: TODO
- 담당: frontend-specialist
- Depends On: [P3-S3-T1]
- Write Scope: SRC/components/의 PlateSetup·분석 요약/배너, 관련 계산 helpers/locales, FE/e2e/의 기존 관련 spec 및 단위 테스트
- 구현: 마커 0개는 전체 플레이트 분석 안내로 표시한다. 마커 존재 시 미할당 웰 제외 수를 계산하고 Empty/Omit 상태와 섞지 않는다.
- 검증: 0/1/다중 마커, 일부 할당, Empty/Omit 혼합 96/384 fixtures의 개수·문구·진입 경로. 기존 마커 설정 E2E 기대값도 정책에 맞춰 갱신한다.
- [ ] AC: UX-04 통과. 정상 전체 플레이트 분석을 96개 제외로 표시하지 않음.

### P3-S0-V: 연속성 품질 게이트

- Status: TODO
- 담당: test-specialist
- Depends On: [P3-S4-T1]
- Write Scope: docs/planning/ui-ux-overhaul/evidence/P3-S0-V.md
- 검증: BE-ALL, FE-ALL, FE-CHECK, ROOT-E2E 18–23, EXISTING-E2E, COVERAGE, 복원 순서/사용자 격리/오류 복구 리뷰.
- [ ] AC: UX-04·05·06·10 및 UX-03 전체 통과. DB 유지와 화면 복원의 차이를 증거로 설명함.

## Phase P4 — 반응형 레이아웃·탐색·접근성

### P4-S0-T1: 공통 헤더·반응형 기반

- Status: TODO
- 담당: frontend-specialist
- Depends On: [P3-S0-V]
- Write Scope: SRC/components/의 Header·공통 Navigation, 공통 CSS, tests/24-responsive.spec.ts
- 구현: 헤더 두 줄 재배치를 허용하고 viewport overflow를 제거한다. 1280px 이상 2열, 768–1279px 1열, 390–767px 검토 중심 구성을 위한 공통 레이아웃을 만든다.
- 검증: 390/768/1024/1280/1440 × KO/EN × light/dark에서 긴 세션명/사용자명 포함 헤더. 페이지 전체 가로 스크롤 금지, 플레이트 내부 스크롤은 허용.
- [ ] AC: UX-07 헤더 기준 통과. 기능을 숨기기만 해서 overflow를 해결하지 않음.

### P4-S1-T1: 분석 결과 중심 배치·고급 설정 접기

- Status: TODO
- 담당: frontend-specialist
- Depends On: [P4-S0-T1]
- Write Scope: SRC/components/의 단일/다중 분석 Workspace·설정·Plate/요약, 관련 CSS/locales, tests/24-responsive.spec.ts
- 구현: 데스크톱 왼쪽 scatter, 오른쪽 plate+선택 웰 요약으로 배치한다. 고급 설정은 접되 활성 조건·변경 경로가 보이게 한다. 설정 값을 별도 local state로 복제하지 않는다.
- 구현: 384웰/다수 경고는 영역 내부 스크롤, 작은 화면은 순차 검토 흐름으로 제공한다. 긴 런·경고·ASG 문맥에서도 주요 결과/행동을 유지한다.
- 검증: 1440×1000, 100% 배율, 96웰에서 scatter·plate·선택 요약을 페이지 스크롤 없이 확인. 다중 마커·384웰·작은 화면은 별도 기준으로 확인한다.
- [ ] AC: UX-08 및 UX-07 분석 레이아웃 기준 통과, 설정/결과 상태 회귀 없음.

### P4-S2-T1: 품질 경고에서 웰·마커로 이동

- Status: TODO
- 담당: frontend-specialist
- Depends On: [P4-S1-T1]
- Write Scope: SRC/components/의 QualityPanel·마커 선택·웰 상세/필터·PlateSetup 진입, navigation-store, tests/25-secondary-flows.spec.ts
- 구현: 경고 웰 클릭 시 해당 마커/웰 상세로 이동하고 필터에 가린 웰을 임시 노출한다. 사용자 필터의 영구 변경을 피하고 임시 상태를 표시/해제한다.
- 구현: 미할당 웰은 플레이트 설정으로 연결한다. 곡선 품질과 유전형 QC를 다른 지표로 표시하고 범위/버전을 유지한다.
- 검증: 다른 마커·숨겨진 웰·미할당 웰·연속 이동·뒤로가기 및 키보드 조작.
- [ ] AC: UX-09 품질 탐색이 사용자가 찾을 수 있는 실제 웰/화면에 도달함.

### P4-S3-T1: 차트 의미·대비·핵심 문구

- Status: TODO
- 담당: frontend-specialist
- Depends On: [P4-S2-T1]
- Write Scope: SRC/components/의 차트·범례·분석 상태, 공통 색상/심볼 helpers·locales, 관련 단위/E2E 테스트
- 구현: 색상+심볼/텍스트로 상태를 구분하고 dark NTC 가시성을 확보한다. A1 등 웰/판정 식별자가 혼동되지 않게 라벨링한다. 기존 과학적 판정/임계값은 바꾸지 않는다.
- 구현: 분석의 행동·오류·빈 상태 KO/EN을 완결하고 ROX 실제 적용 여부를 표시한다. 누락 키/하드코딩 사용자 문구를 검사한다.
- 검증: 양 테마 범례/산점도/선택 상태와 텍스트 4.5:1·UI 3:1 대비를 검사하고 측정값을 기록한다. 심볼만으로도 구분 가능한지 수동 검토한다.
- [ ] AC: UX-09 핵심 화면 언어/색상 의미 기준 통과. 대비/자동 접근성 검사만으로 전체 접근성을 통과 선언하지 않음.

### P4-S4-T1: 로그인·업로드·설정·프로토콜 보조 화면

- Status: TODO
- 담당: frontend-specialist
- Depends On: [P4-S3-T1]
- Write Scope: SRC/components/의 Login·Upload·Settings·Protocol/Template 관련 화면, 관련 locales/CSS, tests/25-secondary-flows.spec.ts
- 구현: 390/1024/1440에서 폼·대화상자·오류·진행 상태·긴 항목의 조작성을 보완한다. 인증 모드별 기존 권한/경로를 보존한다.
- 검증: KO/EN·양 테마, 키보드 제출/취소, 업로드 부분 실패 기록 보존, 설정 변경 후 분석 무효화/복원 회귀.
- [ ] AC: UX-09 보조 화면 해당 범위의 핵심 행동이 잘리거나 가려지지 않음.

### P4-S4-T2: 라이브러리·프로젝트·사용자·참조·비교 화면

- Status: TODO
- 담당: frontend-specialist
- Depends On: [P4-S4-T1]
- Write Scope: SRC/components/의 Library·Project·Users·Reference·Compare 관련 화면, 관련 locales/CSS, tests/25-secondary-flows.spec.ts
- 구현: 목록/빈 상태/오류/권한/대화상자를 보완하고 비교 런을 이름+날짜+파일명 등으로 식별한다. 파괴적 행동의 기존 확인 절차와 권한 검사를 유지한다.
- 검증: 390/1024/1440, KO/EN·양 테마, 긴 이름·중복 런 이름·조회 실패·권한 없음·키보드 탐색.
- [ ] AC: UX-09 나머지 보조 화면 범위가 검증되며 비교 대상 식별이 모호하지 않음.

### P4-S0-V: UI/UX 품질 게이트

- Status: TODO
- 담당: test-specialist
- Depends On: [P4-S4-T2]
- Write Scope: docs/planning/ui-ux-overhaul/evidence/P4-S0-V.md
- 검증: FE-ALL, FE-CHECK, ROOT-E2E 18–25, EXISTING-E2E, COVERAGE, 아래 시각 매트릭스 및 frontend/code 리뷰.
- [ ] AC: UX-07·08·09 통과, 주요 정확성·복원·키보드 동작 유지. 브라우저 실측/스크린샷 없는 시각 항목은 미검증으로 남김.

## Phase P5 — 통합 검증·인수

### P5-R0-T1: 보안·ASG·경로 호환성 검증

- Status: TODO
- 담당: security-specialist
- Depends On: [P4-S0-V]
- Write Scope: BE/tests/의 auth·ASG·export·startup 회귀 테스트, tests/26-asg-compatibility.spec.ts, docs/planning/ui-ux-overhaul/evidence/P5-R0-T1.md
- 구현: 테스트만 보강한다. 인증 모드/ASG scope·만료·결과 저장, path-prefix, 다른 사용자/세션 snapshot 접근 차단, DB 재시작·legacy migration을 확인한다.
- 검증: BE-ALL, ROOT-E2E 26, 권한별 정상/실패 응답, 기존 업로드 제한·ZIP hardening 회귀. 개인정보/토큰 없는 fixtures와 증거를 사용한다.
- [ ] AC: 권한 우회/데이터 누출/기존 소비자 파손 없음. 발견한 구현 결함은 해당 원 작업을 BLOCKED로 되돌려 담당자가 수정하고 관련 게이트를 재실행함.

### P5-S0-V: 전체 회귀·수용 기준 인수

- Status: TODO
- 담당: test-specialist
- Depends On: [P5-R0-T1]
- Write Scope: docs/planning/ui-ux-overhaul/evidence/P5-S0-V.md 및 통합 테스트 보강
- 검증: BE-ALL, FE-ALL, FE-CHECK, ROOT-E2E 전체, EXISTING-E2E, COVERAGE를 같은 최종 commit에서 실행한다. 실파일 교차 검증, 전체 시각 매트릭스, 복원/동시성/실패/보안 결과를 연결한다.
- 검증: 기존 실패도 원인·기준 commit·영향을 기록하며 신규 실패와 구분한다. 필수 수용 기준 실패/미검증은 waiver 없이 통과시킬 수 없다.
- [ ] AC: 아래 UX-01–10 추적표의 증거가 모두 연결되고 치명/높음 미해결 결함이 없음. 자동 검사와 수동 확인 결과를 구분함.

### P5-T0.1: 실행 결과·운영 인수 문서

- Status: TODO
- 담당: test-specialist
- Depends On: [P5-S0-V]
- Write Scope: docs/planning/06-tasks.md, docs/planning/ui-ux-overhaul/의 인수 문서, 필요한 README/API 문서
- 구현: 검증된 변경·마이그레이션/legacy 재분석 안내·설정/복원·출력 동작·실행 명령·남은 제한을 정리한다. 작업별 실제 commit/증거를 연결하고 PRD와 차이가 생긴 경우 결정 근거를 기록한다.
- 검증: 링크/명령/작업 상태와 실제 실행 로그 대조. 문서만 수정한 뒤에도 diff 검사하며 제품 완료를 새로 추정하지 않는다.
- [ ] AC: 33개 작업의 상태·증거가 추적 가능하고, 후속 운영자가 재현할 수 있음. merge/push는 실행 당시 오케스트레이터 권한 범위에서만 수행함.

## 수용 기준 추적표

| PRD 기준 | 구현 작업 | 최종 검증 |
|---|---|---|
| UX-01 NTC·마커 QC | P1-R2-T1, P2-S2-T1 | 19-qc-status, P2-S0-V |
| UX-02 A 저장 계약·revision | P1-R1-T1/T2/T3, P1-S0-T1 | persistence/revision/races, P1-S0-V |
| UX-02 B 분석 실행 정책 | P2-S1-T1, P3-S1-T1 | 분석 단위/복원 E2E, P3-S0-V |
| UX-02 C CSV/PDF/XLSX/PNG | P1-R3-T1/T2, P2-S3-T1 | 실제 파일 검사·18-result-consistency |
| UX-03 키보드 | P2-S4-T1, P3-S2-T1 | 20-keyboard, 23-undo |
| UX-04 마커 0·제외 의미 | P3-S4-T1 | 집계 단위/기존 설정 E2E, P3-S0-V |
| UX-05 오류 복구 | P3-S3-T1 | 22-error-recovery |
| UX-06 URL·설정 복원 | P3-S1-T1 | 21-workspace-restore, P5-R0-T1 |
| UX-07 반응형·헤더 | P4-S0-T1, P4-S1-T1 | 24-responsive, P4-S0-V |
| UX-08 분석 레이아웃 | P4-S1-T1 | 1440×1000 실측, P4-S0-V |
| UX-09 품질 탐색·언어·접근성·보조 화면 | P4-S2-T1/S3-T1/S4-T1/S4-T2 | 24-responsive, 25-secondary-flows, 수동 검토 |
| UX-10 undo/redo | P3-S2-T1 | 23-undo, P3-S0-V |
| 공통 보안·ASG·기존 기능 | P5-R0-T1 | 26-asg-compatibility, 전체 회귀 |

작업 ID를 `/`로 축약한 셀은 같은 접두사의 각 작업을 의미한다. 최종 인수 증거에는 축약하지 않은 ID와 PRD 수용 기준별 결과를 기록한다.

## 필수 검증 매트릭스

| 축 | 조합/증거 |
|---|---|
| 핵심 UI | 분석·헤더·플레이트: 390/768/1024/1280/1440 × KO/EN × light/dark (20조합), 96/384웰 각각 |
| 보조 UI | 로그인·업로드·설정·프로토콜·라이브러리·프로젝트·사용자·참조·비교: 390/1024/1440 × 양 언어·테마 |
| 결과 | 단일/다중·20/40·ROX on/off·배경·마커 변경·legacy·stale·pending·409·역순 완료 |
| 출력 | 동일 snapshot의 CSV/PDF/XLSX 실제 값/타입/metadata, PNG 활성 마커·필터·caption; empty/error 다운로드 |
| 복원/편집 | URL/cache/context 우선순위·절대 사이클·popstate·세션/로그아웃·undo 실패/충돌·복원 시 자동 분석 억제 |
| 오류/보안 | 프리셋/최근 목록 500·배치 부분 실패/unknown·401/403/404/5xx·ASG scope/만료·path-prefix·DB 재시작 |

전체 조합의 실행 결과와 대표 스크린샷을 함께 보관한다. 대표 스크린샷만으로 생략한 조합을 통과 표시하지 않는다. 각 viewport의 높이·배율도 기록하고 UX-08은 지정된 1440×1000/100%를 별도 검사한다.

## Auto-Orchestrate 시작·재개 절차

1. 이 문서와 PRD가 실행 기준임을 확인하고, 현재 기능 브랜치 변경을 보존한 채 실행 baseline/main 통합 방식을 확정한다. 기존 qPCR 작업서는 archive를 사용한다.
2. `auto-orchestrate`에 `docs/planning/06-tasks.md` 실행을 요청한다. 최초 실행은 P0부터, 권장 동시성 1이다. 전체 자동 진행/merge/push 권한은 그 실행 세션에서 명시한다. 이 작업서 작성 자체는 실행 승인이 아니다.
3. 오케스트레이터는 DAG·Write Scope·환경을 검증하고 phase worktree를 준비한다. shared-file 쓰기/품질 검증/commit은 충돌 없이 직렬화한다.
4. 각 작업은 승인된 scope에서 RED → GREEN → REFACTOR → 검증 → 로컬 commit → 증거 보고 순으로 진행한다. 게이트 실패 시 후속 작업을 시작하지 않는다.
5. 재개 시 계획 hash·branch/commit·상태·증거를 대조한다. 문서의 TODO를 추측으로 DONE 처리하거나 이전 작업서의 상태를 재사용하지 않는다.

현재 상태: **2026-09-07 10/33 완료, P1 PDF·XLSX·ASG 연결 구현 중**. P0 독립 게이트 통과·로컬 통합 후 P1-R1-T1/T2/T3, P1-R2-T1, P1-R3-T1도 독립 검증했다. 사용자가 lint·도구·런타임/인증 의존성 보완과 완료까지 자율 진행을 승인했다. 로컬 Phase 통합·자동 진행하며 원격 push·배포·외부 알림은 제외한다. 실행 상태는 루트 `.claude/orchestrate-state.json`, 검증 증거는 Phase Worktree의 evidence에 기록한다.
