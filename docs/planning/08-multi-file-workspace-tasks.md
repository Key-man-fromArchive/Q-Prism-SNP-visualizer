# Q-Prism 다중 파일 작업공간 구현 태스크

- Contract: `qprism-multi-file-workspace-20260911-v1`
- 입력: `docs/planning/01-prd.md`, `specs/screens/*.yaml`
- 기존 `docs/planning/06-tasks.md`는 별도 UI/UX 계약이므로 변경하지 않는다.

## P1 — 세션 계약

### [x] P1-R1-T1: 세션 표시명 계약

- `UploadResponse`와 세션 재열기 응답에 `raw_filename`을 추가한다.
- 최근 세션 목록을 최신 업로드 순서로 반환한다.
- 검증: backend focused test.

### [x] P1-S1-T1: 세션별 작업 상태 저장소

- 이번 작업 session IDs와 cycle/filter/selection/surface 설정을 탭 범위로 저장한다.
- 세션 전환 시 이전 projection을 캡처하고 대상 projection을 복원한다.
- stale plot data를 전환 즉시 비운다.
- 검증: Zustand unit tests.

## P2 — 파일 드로어

### [x] P2-S1-T1: 헤더 파일 작업공간

- 인증 후 모든 주요 화면에서 `파일 N` 트리거를 제공한다.
- 우측 drawer, drop zone, 파일/폴더 선택, 이번 작업/최근 파일 목록을 구현한다.
- 닫기는 workspace에서만 제거하고 영구 삭제는 프로젝트 화면에 남긴다.

### [x] P2-S1-T2: 업로드 큐와 형식 분기

- 최대 20개/총 500MB 제한, 항목별 상태·오류·재시도를 구현한다.
- raw는 독립 session, XML은 drop 단위 bundle, table import는 순차 mapping으로 처리한다.
- 업로드 완료가 활성 session을 바꾸지 않게 한다.

### [x] P2-S2-T1: 공통 세션 열기 연결

- drawer 최근/이번 작업과 프로젝트 `불러오기`가 같은 generation-guarded opener를 사용한다.
- 열기 성공 시 Analysis 탭으로 이동한다.

## P3 — 분석 연속성

### [x] P3-S1-T1: 최초 열기 분석 및 기존 결과 복원

- 결과가 있는 단일/다중 marker session은 저장 결과를 먼저 적용한다.
- 결과가 없는 session만 기존 자동 분석 경로로 한 번 실행한다.

### [x] P3-S1-T2: 비동기 응답 격리

- scatter, plate, clustering, well type/group 응답 적용 전에 활성 session을 재검증한다.
- A→B 전환 뒤 A의 늦은 응답이 B projection을 덮지 않게 한다.

## P4 — 검증

### [x] P4-S1-V: 프론트 연결 검증

- drawer component tests, session restoration tests, 전체 unit tests, lint, build를 실행한다.
- 기존 lint baseline과 신규 오류를 분리한다.
- 결과: Vitest 63개, production build, 신규 drawer/store ESLint, Playwright drawer E2E 통과. 전체 lint는 기존 분석 컴포넌트 오류가 남아 별도 baseline으로 기록한다.

### [x] P4-R1-V: 백엔드 연결 검증

- import session contract test와 전체 backend suite를 venv에서 실행한다.
- 결과: 고정된 `bcrypt==4.0.1` venv에서 454개 및 subtest 2개 통과.

### [x] P4-V: 최종 요구사항 대조

- PRD 수용 기준과 실제 구현의 차이를 정리하고 문서를 구현 범위에 맞춘다.
- `git diff --check`와 변경 파일 검토를 수행한다.
- 결과: 기획 01–07과 화면 YAML을 실제 MVP에 맞췄고 YAML 8개 parse 및 diff whitespace 검사를 통과했다.
