# Q-Prism® Cluster Caller 피드백 대응 작업서 — Auto-Orchestrate

- Contract ID: `qprism-feedback-20260911-v1`
- 작성일: 2026-09-11
- 상태: READY — 정본 승격 완료(2026-09-11). 구현은 이후 auto-orchestrate 실행 요청부터 시작한다.
- 기준 기획서: [`feedback-2026-09-11/00-overview.md`](feedback-2026-09-11/00-overview.md) 및 FB-01~FB-07 (멀티 AI 리뷰 정정 반영본)
- 실행 기준 파일: `docs/planning/06-tasks.md` (**본 문서** — 승격 완료)
- 이전 계약: `qprism-ux-followup-20260907-v1` — 완료 후 [`archive/06-tasks-ux-followup-20260907.md`](archive/06-tasks-ux-followup-20260907.md)로 보관. 보관본의 작업은 실행 대상이 아니다.

---

## 0. 정본 승격 — 완료 (2026-09-11)

auto-orchestrate는 **`docs/planning/06-tasks.md`만** 정본으로 읽는다. 승격은 아래와 같이 수행되었다.

```bash
git mv docs/planning/06-tasks.md docs/planning/archive/06-tasks-ux-followup-20260907.md
mv  docs/planning/06-tasks-feedback-20260911.md docs/planning/06-tasks.md
```

- 이전 계약 `qprism-ux-followup-20260907-v1`은 **완료 상태**였다(태스크 커밋 37건, 체크박스 37/37, `execution.status = "complete"`).
- 이전 계약의 worktree 8개와 브랜치는 **삭제하지 않았다.**

### 남은 정리 — P0-T0.1에서 처리

`.claude/orchestrate-state.json`은 아직 이전 계약을 가리킨다:
`contract_id = qprism-ux-followup-20260907-v1`, `baseline_commit = 80c2c8a`,
`tasks_file_sha256 = b1873340…`(보관본의 해시).

**이 상태 파일은 이제 `06-tasks.md`의 내용과 일치하지 않는다.**
해시 불일치 상태로 auto-orchestrate를 실행하면 완료된 계약을 새 문서에 대해 재개하려 할 수 있다.
P0-T0.1에서 아래를 수행하기 전까지 **실행하지 않는다**:

- `contract_id`를 `qprism-feedback-20260911-v1`로 새로 시작
- `baseline_commit`을 `c2bc854`(main)로 설정
- `tasks_file_sha256`을 현재 `06-tasks.md` 기준으로 재계산
- 이전 계약의 `task_commits` 37건과 `authorization`(원격 push·배포 허용)을 **승계하지 않음**
- 이전 상태는 `.claude/orchestrate-state-ux-followup-20260907.json` 등으로 보존

`CLAUDE.md`의 "Orchestration Handoff" 절도 이전 계약의 진행 기록을 담고 있다.
P0-T0.1에서 이번 계약 기준으로 갱신한다. **기존 기록은 이력으로 남기고 삭제하지 않는다.**

---

## 1. 실행 계약

### 범위와 권한

대상은 프로덕션 피드백 7건(`user_feedback` 상태 `open`, 2026-09-11 수집)에 대응하는 FB-01~FB-07이다.
판정 알고리즘, 클러스터링 수식, QC 임계값, 신규 파서 추가는 **범위 밖**이다.
FB 문서의 멀티 AI 리뷰 정정본이 초안보다 우선한다.

- 오케스트레이터는 의존성 선택·위임·상태 갱신·검증·Phase 통합을 담당한다. 소스·테스트 구현은 지정 specialist가 수행한다.
- **일반 auto-orchestrate 모드**를 기본으로 한다. 작업서 존재만으로 구현·main 병합·원격 push·외부 알림을 수행하지 않는다.
- **원격 push, 배포, 외부 알림은 이번 계약에서 승인되지 않았다.** 로컬 커밋과 로컬 Phase 통합까지만 수행한다.
  (이전 계약의 `remote_push: true` / `deployment: true`를 이번 ID로 승계하지 않는다.)
- ID·Depends On·Status·담당·Write Scope·검증을 파싱해 DAG를 만든다. 선행 FAIL/BLOCKED면 후속을 실행하지 않는다.
  실패를 건너뛰어 Phase 완료로 처리하지 않는다.
- Status는 TODO → IN_PROGRESS → DONE 또는 BLOCKED/FAIL로 갱신한다. 모든 AC·검증 충족 및 로컬 커밋 존재 시에만 DONE으로 표시한다.
- 기능 작업은 `TDD_MODE:RED_FIRST`로 RED → GREEN → REFACTOR 증거를 남긴다. P0 준비·문서·검증 전용 작업에는 인위적 RED를 요구하지 않는다.
- specialist는 로컬 커밋 후 `TASK_DONE:{task_id}:{commit_sha}`를 보고한다. main 병합·push는 specialist가 하지 않는다.
- 호출은 기본 12턴, 통합 태스크는 최대 15턴. 초과 시 완료 부분·실패 명령·다음 수정점을 인계한다.
- **결정 게이트(4절)가 미해결인 태스크는 BLOCKED로 두고 실행하지 않는다.** 추정값으로 진행하지 않는다.

### 기준선

작성 시점 루트 작업트리는 **detached HEAD `201e0c7`** 이고, `main`은 `c2bc854`로 **5커밋 앞서 있다**
(`201e0c7`은 `main`의 조상). `main`은 `worktree/ux-followup-integration`에 체크아웃되어 있다.

- **이번 계약의 baseline_commit은 `c2bc854`(main)다.** `201e0c7`에서 구현을 시작하지 않는다.
- 루트의 미커밋 변경(`.gitignore` 수정, `node_modules` 삭제, `.claude/` 미추적)은 **P0-T0.1에서 정리 방침을 확정**한 뒤 진행한다.
  임의로 커밋하거나 되돌리지 않는다.
- `docs/planning/feedback-2026-09-11/`(기획서 8종)은 미추적 상태다. P0-T0.1에서 main에 커밋한다.

### 브랜치·Worktree·동시성

모든 Phase는 브랜치 기반 Worktree에서 수행한다. Phase N의 시작점은 이전 Phase 검증·통합이 끝난 `main`이다.
기존 경로·브랜치는 확인 후 재사용하고 강제 초기화하지 않는다.

| Phase | 브랜치 | Worktree (루트 기준) | 목적 |
| --- | --- | --- | --- |
| P0 | `feedback/p0-preflight` | `worktree/feedback-p0` | 기준선·색 토큰 단일화·검증 환경 |
| P1 | `feedback/p1-linked-label` | `worktree/feedback-p1` | FB-01 연동 라벨 |
| P2 | `feedback/p2-rawdata` | `worktree/feedback-p2` | FB-05·FB-06 프로토콜/Raw data |
| P3 | `feedback/p3-ia` | `worktree/feedback-p3` | FB-07 정보구조 |
| P4 | `feedback/p4-results` | `worktree/feedback-p4` | FB-04·FB-03 결과 화면 |
| P5 | `feedback/p5-upload` | `worktree/feedback-p5` | FB-02 업로드 진입점 |
| P6 | `feedback/p6-brand` | `worktree/feedback-p6` | FB-07·FB-02 브랜드 |

생성 예: `git worktree add worktree/feedback-p0 -b feedback/p0-preflight main`

- **기본 동시성 1.** P2의 백엔드(R) 작업과 P6의 문서 작업만 Write Scope 분리를 확인한 뒤 최대 2개 병렬화한다.
- 동일 Worktree의 git index/커밋·패키지 설치·서버 조작은 직렬화한다.
- 다음은 **공유 자원**이다. 태스크명이 달라도 동시 수정하지 않는다:
  `app/models.py`, `app/routers/data.py`, `frontend/src/types/api.ts`, `frontend/src/App.tsx`,
  `frontend/src/components/layout/Header.tsx`, `frontend/src/index.css`, `frontend/src/locales/{en,ko}.ts`
- Write Scope 밖 수정이 필요하면 오케스트레이터에 영향 파일을 보고하고 소유권 조정 후 진행한다.

---

## 2. 공통 검증과 증거

약어: BE=`snp-analyzer`, FE=`snp-analyzer/frontend`, SRC=`FE/src`. 명령은 해당 Phase Worktree에서 실행한다.

| 별칭 | 디렉터리 | 명령 |
| --- | --- | --- |
| BE-TEST | BE | `venv/bin/python -m pytest tests/<task_test>.py --tb=short -q` |
| BE-ALL | BE | `venv/bin/python -m pytest --tb=short -q` |
| BE-LINT | BE | `ruff check .` 및 `ruff format --check .` |
| FE-TEST | FE | `npm run test -- src/<task_test>` |
| FE-ALL | FE | `npm run test` |
| FE-CHECK | FE | `npx tsc --noEmit`, `npm run lint`, `npm run build` 각각 실행 |
| ROOT-E2E | 루트 | `E2E_BASE_URL=<이번 Worktree Vite 주소> npx playwright test tests/<NN-feature>.spec.ts --project=chromium --workers=1` |
| EXISTING-E2E | FE | `VITE_DEV_API_TARGET=<격리 API 주소> E2E_PORT=<할당 포트> npm run e2e` |
| VIEWPORT | 브라우저 | 1920x911(피드백 제출 뷰포트) · 1280px · 768px · 400px × 라이트/다크 |

- Python은 `BE/venv`에 두 requirements 파일로 준비하고 `bcrypt==4.0.1`을 확인한다. **호스트 설치 금지.**
- 백엔드는 임시 `DB_PATH`와 합성 계정·local 인증으로 실행한다. **운영 DB(`/app/data/snp_analyzer.db`)는 읽기 조회 외에 사용하지 않는다.**
- 증거는 `docs/planning/feedback-2026-09-11/evidence/<task-id>.md`에 커밋·명령·결과·남은 문제를 기록한다.
  스크린샷·trace는 격리 artifact 경로에 두고 링크한다. 비공개 샘플명·인증 파일은 커밋하지 않는다.
- **Phase 품질 체인**: verification → evaluation → code-review → security(해당 변경) → frontend review(UI 변경).
  관련 테스트·lint/build 성공, 미해결 중요 리뷰 이슈 0, **새 코드** coverage 70% 이상·복잡도 10 이하.
  기존 실패·기존 coverage 부족·기존 보안 이슈는 기준선과 분리해 보고한다. 미충족 게이트를 PASS로 처리하지 않는다.
- **재빌드 검증**: 배포 확인이 필요한 경우 `docker compose build --no-cache frontend`를 쓴다. 캐시 빌드는 낡은 번들을 배포한다.
  단, **이번 계약에 배포 권한은 없다.** 로컬 dev 서버 검증까지만 수행한다.

---

## 3. 인터페이스 계약 점검(ICV)

아래 계약 공백은 Resource(R) 작업으로 먼저 해소한다. Screen(S) 작업은 해당 R 완료 후 실행한다.
**"기획서에 연결을 지정했다"는 것이 "API가 이미 지원한다"는 뜻은 아니다.**

| 소비 동작 | 필요한 계약 / 현재 공백 | 생산 작업 | 소비 작업 |
| --- | --- | --- | --- |
| 프로토콜 판독 단계 표시 | `ProtocolStep.plate_read` / `temp_increment`; 파서가 계산하고도 버림 (`pcrd_raw.py:299-301`, `eds_raw.py:450-451,489`) | P2-R1-T1 | P2-S1-T1 |
| 프로토콜 채널 카드 | 런 채널 목록을 프로토콜/세션 응답 계약으로 제공; 현재 `data-store` 캐시만 (stale 위험) | P2-R1-T1 | P2-S1-T1 |
| 오버레이 처리 상태 표기 | `normalization_applied` / `background_mode` 에코; all-amplification 응답에 없음 (`routers/data.py:254-258`) | P2-R1-T2 | P2-S2-T1 |
| 분석 경고 강등 | 경고 심각도 등급(`blocking`/`advisory`); 현재 `warnings`에 등급 없음 | P4-R1-T1 | P4-S4-T1 |
| 구 URL 복원 | 구 탭 id(`analysis`+`surface`, `protocol`) → 신 탭 id 의미 보존 매핑 | P3-S2-T1 | P3-S1-T1 |

**ICV 비대상 (기존 인프라 재사용, 신규 계약 불필요)**
- 결과 무효화: `AnalysisContext.result_revision` / `input_revision`이 이미 존재 (`app/models.py:380,389`)
- 미지 탭 id 크래시 방지: `navigation-store.ts`의 `parseNavigation` → `tab()` 타입가드가 이미 폴백 처리 (:25,:32-36,:56)

---

## 4. 결정 게이트

**해결된 결정**

| ID | 항목 | 결정 | 근거 |
| --- | --- | --- | --- |
| D-1 | 제품 정식 명칭 | **`Q-Prism® Cluster Caller` 채택.** `Q-Prism`은 인바이러스테크 자사 저작물이므로 `®` 사용 가능 | 2026-09-11 사용자 확인 |

**미해결 — 해당 태스크는 BLOCKED로 시작한다**

| ID | 항목 | 차단 태스크 | 필요한 답 |
| --- | --- | --- | --- |
| **D-2** | Q-Prism 브랜드 팔레트 HEX | P6-S2-T1 | 기존 브랜드 가이드의 HEX 값. 없으면 신규 팔레트 설계 승인 |
| **D-3** | 로고·마크·히어로 아트·파비콘 | P6-S3-T1 | 에셋 파일 제공 또는 제작 승인. 현재 `frontend/public/`에 이미지 0개 |
| **D-4** | 채널색(`--color-fam`/`--color-allele2`) 브랜드화 여부 | P6-S2-T1 | 권장: **유지**(FAM=파랑 등 qPCR 판독 관례 우선). 승인 필요 |
| **D-5** | 탭 ID 전면 변경 승인 | P3-S1-T1 | E2E 대량 수정 동반. 리뷰 결과 라벨만 변경으로는 요구 충족 불가로 판정됨 |
| **D-6** | 산점도 목표 종횡비 | P4-S1-T1 | 정사각(폭 640px, 컬럼 여백 300px) vs 4:3(폭 853px, 여백 87px) |
| **D-7** | 업로드 경로 이원화 처리 | P5-S2-T1 | 통합 vs 역할 분리 후 한도·문구만 일치 (권장: 후자) |
| **D-8** | ASG `target_type` 전체 열거값 | P1-S1-T1 (부분) | 관측값은 `ad_hoc`/`marker_version`/`design_run_item` 셋뿐. ASG 계약 문서 확인 |
| **D-9** | ASG 측 `protocol_steps` 스키마 검증 강도 | P2-R1-T1 (부분) | 필드 추가 사전 협의 필요 여부. `app/asg_result.py:91`이 외부로 직렬화 |

> D-8/D-9는 **부분 차단**이다. 해당 태스크의 나머지 범위는 진행하되, 매핑 테이블 확정과 ASG 협의 결과는
> 미해결 항목으로 증거 문서에 남기고 Phase 게이트에서 보고한다.

---

## Phase P0 — 기준선과 색 체계 단일화

### P0-T0.1: 기준 커밋·계약·검증 환경 확정
- 담당: `orchestrator` (직접 수행)
- Depends On: —
- Status: TODO
- Write Scope: `docs/planning/feedback-2026-09-11/**`, `docs/planning/06-tasks.md`, `docs/planning/archive/**`, `.claude/orchestrate-state.json`, `.gitignore`
- 구현 내용
  - `main`(`c2bc854`)을 baseline으로 확정. 루트 detached HEAD(`201e0c7`)에서 시작하지 않음을 확인한다.
  - 루트 미커밋 변경(`.gitignore` 수정, `node_modules` 삭제, `.claude/` 미추적)의 처리 방침을 확정하고 기록한다.
  - 기획서 8종(`docs/planning/feedback-2026-09-11/`)과 본 작업서를 main에 커밋한다.
  - 0절 승격 절차를 수행한다(이전 계약 archive → 본 문서를 `06-tasks.md`로).
  - `.claude/orchestrate-state.json`을 `contract_id: qprism-feedback-20260911-v1`, `baseline_commit: c2bc854`로 **새로 시작**한다. 이전 계약 파일은 보존한다.
  - BE venv 준비(`bcrypt==4.0.1` 확인)와 FE 의존성 설치를 확인하고, 회귀 기준선(BE-ALL / FE-ALL / FE-CHECK 현재 통과 수)을 기록한다.
- AC
  - [ ] baseline이 `c2bc854`로 기록되고, 이전 계약의 worktree·브랜치가 삭제되지 않았다
  - [ ] `06-tasks.md`가 본 계약 내용이고, 이전 계약이 `archive/`에 보존되었다
  - [ ] 회귀 기준선(현재 통과/실패 수)이 증거 문서에 수치로 남았다
- 검증: BE-ALL, FE-ALL, FE-CHECK (기준선 기록 목적, 실패가 있어도 수치로 남기고 진행)
- 증거: `evidence/P0-T0.1.md`

### P0-T0.2: 색 체계 단일화 (값 불변 리팩터링)
- 담당: `frontend-specialist`
- Depends On: P0-T0.1
- Status: TODO
- Write Scope: `SRC/lib/plotly-theme.ts`, `SRC/lib/constants.ts`, `SRC/lib/genotype.ts`, `SRC/components/protocol/ProtocolTab.tsx`, `SRC/index.css`
- 구현 내용
  - `plotly-theme.ts`의 하드코딩 HEX를 CSS 토큰 읽기(`getComputedStyle(document.body).getPropertyValue('--color-…')`)로 전환한다.
  - `constants.ts` / `genotype.ts` / `ProtocolTab.tsx`의 `PHASE_COLORS`·`AMP_COLORS` HEX를 토큰 또는 단일 색 모듈로 모은다.
  - **다크모드 전환 레이스 방어**: `body`에 `transition: background-color 0.3s`가 걸려 있어 토글 직후 `getComputedStyle`이 중간값을 읽을 수 있다. 전환 완료 후 재렌더하거나 전환 대상이 아닌 토큰에서 읽도록 한다.
  - **색 값 자체는 바꾸지 않는다.** D-2 미확정 상태에서 팔레트를 바꾸지 않는다. 이 태스크는 "한 곳에서 바꿀 수 있게 만드는" 리팩터링이다.
- AC
  - [ ] 라이트/다크 모두에서 변경 전후 렌더 색이 동일하다 (시각 회귀 없음)
  - [ ] Plotly 차트 색이 CSS 토큰에서 유도된다
  - [ ] 다크모드 토글 직후에도 차트가 전환 중간색을 고정하지 않는다
  - [ ] 하드코딩 HEX가 남은 위치가 증거 문서에 목록화되었다
- 검증: FE-ALL, FE-CHECK, VIEWPORT(라이트/다크 토글 왕복)
- 증거: `evidence/P0-T0.2.md`

### P0-S0-V: Preflight 게이트
- 담당: `test-specialist`
- Depends On: P0-T0.1, P0-T0.2
- Status: TODO
- Write Scope: `docs/planning/feedback-2026-09-11/evidence/**`
- 구현 내용: 품질 체인 실행. 기준선 대비 신규 실패 0 확인. 기존 실패는 기준선으로 분리 기록.
- AC
  - [ ] BE-ALL / FE-ALL / FE-CHECK가 기준선 대비 신규 실패 0
  - [ ] 시각 회귀 없음(P0-T0.2)
- 검증: BE-ALL, FE-ALL, FE-CHECK
- 증거: `evidence/P0-S0-V.md`

---

## Phase P1 — 연동 컨텍스트 라벨 (FB-01)

### P1-S1-T1: ASG 연동 컨텍스트 라벨 정상화
- 담당: `frontend-specialist`
- Depends On: P0-S0-V
- Status: TODO (D-8 부분 차단 — 매핑 테이블 확정만 보류)
- Write Scope: `SRC/components/layout/Header.tsx`, `SRC/components/layout/Header.test.tsx`, `SRC/locales/en.ts`, `SRC/locales/ko.ts`
- 기획 근거: [FB-01](feedback-2026-09-11/FB-01-linked-context-label.md)
- 구현 내용
  - `LinkedIdentity`(`Header.tsx:22-28`)가 `target_type` / `target_id` 원시값을 **렌더링하지 않는다.**
  - xl 미만 축약 경로 `<summary>ASG · {context.target_type}</summary>`(`Header.tsx:35`)도 **동일하게 수정한다.** 두 경로 모두 고쳐야 한다.
  - 표시 우선순위: `tag_alias`(비어 있지 않을 때) → `marker_id` → i18n 매핑된 `target_type` 라벨. 셋 다 없으면 블록을 렌더링하지 않는다.
  - `asgTargetLabel: (targetType: string) => string`을 `en.ts` / `ko.ts`에 **동시 추가**한다(`Translations` 타입이 키 동기화를 강제).
  - 관측된 값 기준으로 매핑한다: `ad_hoc`(`tests/test_asg_launch_auth.py:87`), `marker_version`(`:56`), `design_run_item`(`tests/test_asg_result_save.py:105,209,302`). **`marker`/`design_result`/`order_item`은 코드에 존재하지 않는 추정값이므로 쓰지 않는다.**
  - 미지의 `target_type`은 중립 문구로 폴백하고 **원시값을 화면·툴팁 어디에도 흘리지 않는다.**
- AC
  - [ ] `target_type` / `target_id`가 화면(툴팁 포함) 어디에도 나타나지 않는다 — 데스크톱·축약 두 경로 모두
  - [ ] ad_hoc 런치(`tag_alias=""`, `marker_id="Ad hoc SNP Analyze"`)에서 `Ad hoc SNP Analyze`만 표시된다
  - [ ] `tag_alias`가 빈 문자열이면 `marker_id`로 폴백한다
  - [ ] 미지 `target_type`에서 크래시 없이 중립 폴백 또는 블록 숨김이 동작한다
  - [ ] 비연동(local auth) 모드 렌더링이 변하지 않는다
  - [ ] 백엔드 `linked_context` 응답은 변경하지 않았다
- 검증: `FE-TEST src/components/layout/Header.test.tsx`, FE-ALL, FE-CHECK, `ROOT-E2E tests/26-asg-compatibility.spec.ts`
- 증거: `evidence/P1-S1-T1.md` — D-8 미해결 시 확정 못 한 열거값을 명시

### P1-S0-V: 표시 계층 게이트
- 담당: `test-specialist`
- Depends On: P1-S1-T1
- Status: TODO
- Write Scope: `docs/planning/feedback-2026-09-11/evidence/**`
- 검증: FE-ALL, FE-CHECK, EXISTING-E2E
- AC: [ ] 신규 실패 0 · [ ] 미해결 중요 리뷰 이슈 0 · [ ] 새 코드 coverage ≥70%
- 증거: `evidence/P1-S0-V.md`

---

## Phase P2 — 프로토콜·Raw data 콘텐츠 (FB-05, FB-06)

> **현행 `protocol` 탭 ID 위에서 수행한다.** 탭 ID 재편(P3)보다 먼저 콘텐츠를 완성해 두 번 고치는 것을 피한다.

### P2-R1-T1: ProtocolStep 모델 확장 + 파서 전달
- 담당: `backend-specialist`
- Depends On: P1-S0-V
- Status: TODO (D-9 부분 차단 — ASG 협의 결과만 보류)
- Write Scope: `BE/app/models.py`, `BE/app/parsers/pcrd_raw.py`, `BE/app/parsers/eds_raw.py`, `BE/app/routers/data.py`, `BE/tests/test_import_parsers_p2.py`, `BE/tests/<신규 protocol 테스트>`
- 기획 근거: [FB-05](feedback-2026-09-11/FB-05-protocol-visualization.md)
- 구현 내용
  - `ProtocolStep`(`models.py:158-165`)에 세 필드를 **기본값과 함께** 추가한다:
    `plate_read: bool = False`, `temp_increment: float | None = None`, `read_channels: list[str] = Field(default_factory=list)`
  - `pcrd_raw.py`: `_parse_protocol()`이 이미 계산하는 `has_read`(`:299`)와 `inc`/`inc_temp`(`:300-301`)를
    `ProtocolStep(...)` 생성(`:435-443`)에 전달한다. 현재는 라벨 문자열(`:412`)에만 쓰이고 버려진다.
  - `eds_raw.py`: `CollectionFlag`(`:450-451,502`)와 `ext_temp`(`:489`)를 `ProtocolStep` 생성(`:518-526`)에 전달한다.
  - **`read_channels`는 단계별 채널 정보가 원본에 없으면 채우지 않는다(빈 리스트).** 런 전체 채널로 대신 채우면
    "이 단계에서 이 채널을 읽었다"는 거짓 단언이 된다.
  - 런 채널 목록은 별도로 **프로토콜/세션 응답 계약**에 노출해 프론트 채널 카드가 `data-store` 캐시(stale 위험) 대신 이를 읽게 한다.
  - `routers/data.py`의 예제 프로토콜 상수를 신규 필드에 맞춰 갱신한다.
- AC
  - [ ] `.pcrd` 임포트 시 판독 단계의 `plate_read === true`가 API 응답에 담긴다
  - [ ] 터치다운 단계의 `temp_increment`가 부호를 포함해 담긴다
  - [ ] 단계별 채널 정보가 없는 포맷에서 `read_channels`가 **비어 있다** (추측 값 없음)
  - [ ] 기존 저장 프로토콜(신규 필드 없는 JSON)이 `app/db.py:692`·`:753`의 `ProtocolStep(**s)`로 오류 없이 복원된다
  - [ ] `protocol_overrides`에 저장된 사용자 편집본도 복원된다
  - [ ] ASG 저장 payload(`app/asg_result.py:91` `model_dump()`)에 신규 필드가 실려도 직렬화가 정상이다
  - [ ] 런 채널 목록이 응답 계약으로 제공된다
- 검증: `BE-TEST tests/test_import_parsers_p2.py`, BE-ALL, BE-LINT
- 증거: `evidence/P2-R1-T1.md` — ASG 수신측 스키마 검증 강도(D-9) 확인 결과 기록

### P2-R1-T2: 증폭 응답에 처리 상태 에코 추가
- 담당: `backend-specialist`
- Depends On: P1-S0-V
- Status: TODO
- Write Scope: `BE/app/routers/data.py`, `BE/app/models.py`(응답 스키마), `BE/tests/<신규 amplification 테스트>`
- 기획 근거: [FB-06](feedback-2026-09-11/FB-06-rawdata-tab.md) §2
- 구현 내용
  - `/api/data/{sid}/amplification/all` 응답(`routers/data.py:254-258`)에
    `normalization_applied: bool`과 `background_mode`를 **에코**로 추가한다.
  - 현재 응답은 `allele2_dye` + role label metadata + `curves`뿐이라, 프론트가 스토어의 *요청값*으로
    "정규화 적용됨"을 단언할 수밖에 없다. 이는 백엔드가 실제로 적용했는지와 무관한 주장이 된다.
  - 산점도가 이미 쓰는 패턴(`normalizationApplied` 응답 필드 → `ScatterReferenceBasis`가 "요청 예 / 실제 적용 아니오"를 구분 표시)을 따른다.
- AC
  - [ ] 응답에 `normalization_applied` / `background_mode`가 포함된다
  - [ ] 참조 채널이 없는 런에서 `use_rox=true`로 요청해도 `normalization_applied=false`가 정직하게 반환된다
  - [ ] 기존 소비자(프론트 오버레이)가 신규 필드를 무시해도 동작한다 (하위 호환)
- 검증: BE-TEST, BE-ALL, BE-LINT
- 증거: `evidence/P2-R1-T2.md`

### P2-S1-T1: 열 순환 프로파일 다이어그램 + 판독 채널 카드
- 담당: `frontend-specialist`
- Depends On: P2-R1-T1
- Status: TODO
- Write Scope: `SRC/components/protocol/ProtocolThermalProfile.tsx`(신규), `SRC/components/protocol/ProtocolTab.tsx`, `SRC/components/protocol/use-protocol-editor.ts`, `SRC/components/protocol/ProtocolTab.test.tsx`, `SRC/types/api.ts`, `SRC/locales/{en,ko}.ts`
- 기획 근거: [FB-05](feedback-2026-09-11/FB-05-protocol-visualization.md) §3-2, §3-3
- 구현 내용
  - **인라인 SVG** 다이어그램을 신규 컴포넌트로 구현한다. Plotly를 쓰지 않는다 — 이 그림은 탐색이 아니라 요약이며,
    의존성 0·다크모드 `currentColor`·인쇄 안정성이 우선이다.
  - 가로축은 **실제 시간이 아니라 단계 순서**다. Initial Denaturation 300초와 Annealing 5초를 실시간 비례로 그리면 증폭 구간이 보이지 않는다. 지속시간은 라벨로 표기한다.
  - 반복 구간은 `phase`로 묶어 배경 밴드 + `×N` 배지로 표현한다. 기존 `getPhaseColor()` 색 체계를 재사용한다.
  - 판독 마커(📷)는 **`plate_read` 필드 기준**으로 찍는다. 현행 `isReadingStep(label)` 문자열 휴리스틱을 **제거**한다
    (라벨은 사용자가 자유 편집 가능하므로 표시가 데이터가 아닌 문자열에 의존하고 있다).
  - 터치다운은 `temp_increment`로 하강 표시한다.
  - 채널 요약 카드는 P2-R1-T1이 제공한 **응답 계약**에서 읽는다. `--color-fam` / `--color-allele2` 토큰으로 산점도와 색을 맞춘다.
  - `use-protocol-editor.ts`가 편집 시 신규 필드를 **유실시키지 않는지** 확인한다. `handleAddStep`이 만드는 신규 스텝에 기본값을 명시한다.
  - `max-w-[800px]` 제한을 해제하고 넓은 화면에서 다이어그램+표를 배치한다. **표의 편집 기능은 그대로 유지한다.**
- AC
  - [ ] 사용자가 단계 라벨을 바꿔도 📷 표시가 유지된다 (휴리스틱 제거 증명)
  - [ ] 프로토콜 편집 → 저장 → 재조회 시 `plate_read`/`temp_increment`가 보존된다
  - [ ] 채널 정보가 없는 포맷에서 빈 칩/추측 값이 표시되지 않는다
  - [ ] 다이어그램이 라이트/다크 모두에서 판독 가능하고 400px에서 가로 스크롤로 처리된다
  - [ ] 기존 프로토콜 편집·저장·취소 동작이 회귀하지 않는다
- 검증: `FE-TEST src/components/protocol/`, FE-ALL, FE-CHECK, VIEWPORT
- 증거: `evidence/P2-S1-T1.md`

### P2-S2-T1: 증폭 오버레이 개선 + Raw data 화면 배치
- 담당: `frontend-specialist`
- Depends On: P2-R1-T2, P2-S1-T1
- Status: TODO
- Write Scope: `SRC/components/analysis/AmplificationOverlay.tsx`, `SRC/components/protocol/ProtocolTab.tsx`, `SRC/components/analysis/AnalysisTab.tsx`, `SRC/components/analysis/plot-cleanup.test.tsx`, `SRC/types/api.ts`, `SRC/locales/{en,ko}.ts`
- 기획 근거: [FB-06](feedback-2026-09-11/FB-06-rawdata-tab.md) §3
- 구현 내용
  - 프로토콜 화면 하단에 **전체 플레이트 스코프** 오버레이를 추가 마운트한다. 분석 탭의 기존 마운트는 유지하되 보조 영역으로 둔다.
  - **DOM id 스코프화**: `id="overlay-plot"` / `"overlay-container"` / `"toggle-overlay-btn"` / `"overlay-channel-select"`가
    고정값이다. `useId()` 또는 prop 기반으로 바꾼다.
    (참고: 현재는 `AnalysisWorkspace.tsx:104-139`의 삼항 분기로 오버레이가 항상 하나뿐이라 충돌이 없다.
    이번 작업이 **처음으로** 두 인스턴스를 만든다. Plotly는 ref 기반이라 렌더 자체는 안전하지만,
    `plot-cleanup.test.tsx:33,49`의 `querySelector('#overlay-plot')`가 모호해진다.)
  - 헤더에 처리 상태를 **응답 에코 값 기준**으로 표시한다. 스토어 요청값으로 단언하지 않는다.
  - 색 기준 선택기 추가: `유전형`(현행 `effective_type`) / `웰 타입` / `단색`.
    **`단색`을 "raw"라고 표기하지 않는다** — Y값은 여전히 `norm_fam`/`norm_allele2`다(`AmplificationOverlay.tsx:67`).
  - 하드코딩 영어 `"Hide Overlay"` / `"Show Overlay"`를 i18n 처리한다.
  - 요청 중복은 **양쪽을 각각 펼쳤을 때만** 발생한다(기본 `useState(false)`, `if (!visible) return`).
    엔드포인트는 인메모리 조회라 DB를 치지 않으므로 차단 사유는 아니다. 실측 후 필요하면 세션 캐시를 둔다.
- AC
  - [ ] 두 화면에 동시 마운트해도 두 차트가 각각 올바르게 렌더된다
  - [ ] 탭 전환 시 Plotly 인스턴스가 누수되지 않는다 (`plot-cleanup` 통과)
  - [ ] 처리 상태 표시가 응답 에코에 근거한다
  - [ ] `Hide/Show Overlay`가 한국어 UI에서 한국어로 나온다
  - [ ] 마커별 오버레이(`ploidyOverride`)가 회귀하지 않는다
  - [ ] 오버레이는 `chart-export-registry`에 등록되지 않으므로 PNG/PDF 내보내기에 회귀가 없음을 확인했다
- 검증: `FE-TEST src/components/analysis/plot-cleanup.test.tsx`, FE-ALL, FE-CHECK, VIEWPORT
- 증거: `evidence/P2-S2-T1.md` — 요청 중복 실측 결과 포함

### P2-S0-V: 콘텐츠 게이트
- 담당: `test-specialist`
- Depends On: P2-S2-T1
- Status: TODO
- Write Scope: `docs/planning/feedback-2026-09-11/evidence/**`
- 검증: BE-ALL, BE-LINT, FE-ALL, FE-CHECK, EXISTING-E2E
- AC: [ ] 신규 실패 0 · [ ] 새 코드 coverage ≥70%·복잡도 ≤10 · [ ] 미해결 중요 리뷰 이슈 0 · [ ] 하위호환(구 프로토콜 JSON 복원) 확인
- 증거: `evidence/P2-S0-V.md`

---

## Phase P3 — 정보구조 재편 (FB-07 IA)

> **D-5 승인 없이 시작하지 않는다.** 이 Phase는 루트 Playwright 스펙 다수를 깨뜨린다.

### P3-S1-T1: 최상위 탭 ID·라벨·순서 재편
- 담당: `frontend-specialist`
- Depends On: P2-S0-V, **D-5 승인**
- Status: BLOCKED (D-5)
- Write Scope: `SRC/components/layout/TabNavigation.tsx`, `SRC/components/analysis/AnalysisWorkspace.tsx`, `SRC/App.tsx`, `SRC/stores/navigation-store.ts`, `SRC/lib/tab-keyboard.ts`, `SRC/locales/{en,ko}.ts`, 관련 테스트
- 기획 근거: [FB-07](feedback-2026-09-11/FB-07-identity-and-ia.md) §3-1
- 구현 내용
  - 상위 탭을 **플레이트 설정 → Raw data → 결과 → 품질 → 통계 → 비교 → 라이브러리 → 프로젝트 → ⋯더보기(설정·참고자료·사용자·피드백)** 순으로 재편한다.
  - `AnalysisWorkspace`의 2단 `WorkspaceTabs`(플레이트 설정/분석)를 **제거**하고 최상위로 승격한다. 사용자가 가장 먼저 하는 작업이 2계층에 묻혀 있는 문제를 해소한다.
  - **라벨만 바꾸는 안으로는 불가능하다.** 현재 `plate`는 최상위 `TabId`가 아니라 `navigation-store`의 `surface` 값이다. 최상위 탭 두 개(Plate/Results)를 표현하려면 새 탭 ID가 필수다.
  - 탭 ID 매핑:

    | 신 최상위 탭 | 구 상태 |
    | --- | --- |
    | `plate` | `tab='analysis'` + `surface='plate'` |
    | `results` | `tab='analysis'` + `surface='analysis'` |
    | `rawdata` | `tab='protocol'` |

  - `surface` 개념은 최상위 탭으로 흡수한다. `bannerDismissed` 상태와 세션 전환 리셋 로직도 함께 정리한다(FB-03에서 배너가 스코프 선택기로 대체되므로 P4와 조율).
  - `설정` 탭을 더보기로 강등한다(P4에서 정규화·축 설정이 플롯 헤더로 올라가면 사용 빈도가 크게 떨어진다).
- AC
  - [ ] 상위 탭 순서가 `플레이트 설정 → Raw data → 결과 → …`다
  - [ ] 플레이트 설정이 **1회 클릭**으로 도달된다
  - [ ] `en`/`ko` 라벨이 모두 번역되고 타입 체크를 통과한다
  - [ ] 키보드 탭 내비게이션(`navigateTabs`, roving `tabIndex`, `aria-selected`)이 새 순서에서 동작한다
  - [ ] `TabNavigation.keyboard.test.tsx:7,10,14`의 `activeTab="analysis"` / `main-panel-analysis` / `'protocol'` 리터럴 단언이 갱신되었다
- 검증: `FE-TEST src/components/layout/`, FE-ALL, FE-CHECK, EXISTING-E2E
- 증거: `evidence/P3-S1-T1.md`

### P3-S2-T1: 구 URL 매핑 + 연동 계약 갱신
- 담당: `frontend-specialist`
- Depends On: P3-S1-T1
- Status: BLOCKED (D-5)
- Write Scope: `SRC/lib/workspace-history.ts`, `SRC/lib/workspace-location.ts`, `SRC/hooks/use-workspace-location.ts`, `SRC/lib/quality-navigation.ts`, `SRC/stores/session-store.ts`(sessionQueries 해석), `SRC/App.tsx`(FeedbackWidget pageKey), 관련 테스트
- 기획 근거: [FB-07](feedback-2026-09-11/FB-07-identity-and-ia.md) §3-1 호환성 주의
- 구현 내용
  - **`navigation-store`는 persist하지 않는다.** 위치가 살아남는 경로는 두 가지다:
    (i) URL — `lib/workspace-history.ts`의 `pushState`/`replaceState`,
    (ii) `session-store.sessionQueries` — 열린 세션별 쿼리 문자열이 `sessionStorage`(`qprism-file-workspace`)에 persist.
    따라서 필요한 것은 **스토어 마이그레이션이 아니라 legacy URL 파싱 + canonical rewrite**다.
  - 구 URL(`?tab=analysis&surface=plate` 등)을 읽어 신 탭 ID로 **의미를 보존해** 매핑하고 주소를 새 형태로 다시 쓴다.
  - 크래시 방지 폴백은 **이미 구현되어 있다**(`navigation-store.ts`의 `parseNavigation` → `tab()` 타입가드, `:25,:32-36,:56`).
    폴백만 있으면 북마크된 구 URL이 기본 탭으로 떨어져 **사용자 의도가 유실**된다. 매핑이 폴백보다 먼저 동작해야 한다.
  - `lib/quality-navigation.ts`의 `surface: 'plate' | 'analysis'` 복귀 계약을 새 탭 구조에 맞춘다.
  - `FeedbackWidget`의 `pageKey`가 새 탭 ID를 기록하게 한다. **과거 피드백의 `page_key`와 값이 달라지므로** 증거 문서에 매핑표를 남긴다.
- AC
  - [ ] 구 URL로 진입해도 의도한 탭으로 매핑되고 주소가 canonical 형태로 다시 쓰인다
  - [ ] `sessionQueries`에 저장된 구 쿼리 문자열도 동일하게 매핑된다
  - [ ] 미지 탭 ID의 기본 탭 폴백이 회귀하지 않는다
  - [ ] 품질 탭 → 웰/마커 복귀 경로가 새 탭 구조에서 동작한다
  - [ ] 피드백 `page_key` 신·구 매핑표가 증거에 기록되었다
- 검증: `FE-TEST src/lib/workspace-location.test.ts`, `FE-TEST src/lib/quality-navigation.test.ts`, FE-ALL, FE-CHECK, EXISTING-E2E
- 증거: `evidence/P3-S2-T1.md`

### P3-S0-V: 정보구조 게이트
- 담당: `test-specialist`
- Depends On: P3-S2-T1
- Status: BLOCKED (D-5)
- Write Scope: 루트 `tests/**`, `docs/planning/feedback-2026-09-11/evidence/**`
- 구현 내용: 루트 Playwright 스펙 전체의 탭 셀렉터를 일괄 갱신한다. **이 Phase에서 작업량이 가장 큰 부분이다.**
- AC: [ ] 루트 E2E 전체 통과 · [ ] FE-ALL 신규 실패 0 · [ ] 접근성(role/aria/roving tabIndex) 회귀 0 · [ ] 미해결 중요 리뷰 이슈 0
- 검증: FE-ALL, FE-CHECK, ROOT-E2E(전체), EXISTING-E2E
- 증거: `evidence/P3-S0-V.md`

---

## Phase P4 — 결과 화면 (FB-04 + FB-03)

> **두 기획서를 한 Phase로 묶는다.** 같은 `.analysis-grid` / `.analysis-scatter-canvas` 규칙을 바꾸므로 분리하면 서로를 되돌린다.

### P4-R1-T1: 분석 경고 심각도 등급 계약
- 담당: `backend-specialist`
- Depends On: P3-S0-V
- Status: TODO
- Write Scope: `BE/app/models.py`, `BE/app/processing/**`(경고 생성부), `BE/tests/<경고 테스트>`, `SRC/lib/analysis-warnings.ts`, `SRC/types/api.ts`
- 기획 근거: [FB-03](feedback-2026-09-11/FB-03-analysis-density.md) §8
- 구현 내용
  - 현재 `warnings`에는 **심각도 구분이 없다.** 등급 없이 경고를 화면 하단으로 내리는 것은 과학 도구에서 허용할 수 없다.
  - `blocking`(상단 잔류) / `advisory`(하단 강등) 2단 등급을 계약에 추가한다. 기본값은 기존 동작을 보존하는 쪽으로 둔다.
  - 기존 경고 각각을 어느 등급으로 분류할지 **판정 신뢰도 기준**으로 결정하고 근거를 문서화한다.
    예: "저신호 웰을 NTC가 아니라 Undetermined로 두었습니다"는 비율 원점에 직접 영향 → `blocking` 후보.
  - 기존 소비자가 등급 필드를 무시해도 동작하도록 하위 호환을 유지한다.
- AC
  - [ ] 응답의 각 경고가 등급을 갖는다
  - [ ] 등급 분류 근거가 경고별로 문서화되었다
  - [ ] 등급 필드를 무시하는 기존 코드 경로가 회귀하지 않는다
- 검증: BE-TEST, BE-ALL, BE-LINT, FE-CHECK
- 증거: `evidence/P4-R1-T1.md`

### P4-S1-T1: 산점도 캔버스 종횡비
- 담당: `frontend-specialist`
- Depends On: P3-S0-V, **D-6 결정**
- Status: BLOCKED (D-6)
- Write Scope: `SRC/index.css`, `SRC/components/analysis/ScatterPlot.tsx`, `SRC/components/analysis/MarkerScatterPlot.tsx`
- 기획 근거: [FB-04](feedback-2026-09-11/FB-04-scatter-ergonomics.md) §3-1
- 구현 내용
  - **먼저 결함 제거**: `index.css` 1280px 블록에 `.analysis-scatter-canvas`가 두 번 선언된다
    (`:166` `max-height:300px`, `:175` `height:360px`). 서로 다른 속성이라 둘 다 적용되어 **used height가 300px로 눌린다**
    — 넓은 화면일수록 그래프가 작아지는 원인. 중복 선언을 하나로 합친다.
  - **`max-height`로 종횡비를 보장하려는 시도는 실패한다.** 940px 폭에서 4:3은 705px가 필요하지만 911px 뷰포트의 70vh는 638px다.
    높이를 자르면 실제 비율이 1.47:1이 된다. **폭을 종횡비에 맞춰 묶어야 한다**:

    ```css
    .analysis-scatter-canvas {
      --scatter-max-h: min(70vh, 640px);
      aspect-ratio: 4 / 3;              /* D-6 결정에 따라 1/1 가능 */
      height: auto; width: 100%;
      max-width: calc(var(--scatter-max-h) * 4 / 3);
      min-height: 360px;                 /* Plotly 0-height 마운트 방어 */
      margin-inline: auto;
    }
    ```
  - Plotly 마운트 시 `clientHeight > 0`인지 확인한다. 필요하면 `ResizeObserver` + `Plotly.Plots.resize`.
  - `lockAspect`(`lib/scatter-axes.ts`의 `scaleanchor:'x'`, `scaleratio:1`)는 **데이터 축 비율**이며 캔버스 종횡비와 별개다.
    둘 다 켜졌을 때 `constrain:'domain'`이 플롯 영역을 더 줄이지 않는지 확인한다.
  - 두 플롯(`ScatterPlot`, `MarkerScatterPlot`)이 같은 클래스를 공유하므로 함께 검증한다.
- AC
  - [ ] 1920x911에서 캔버스 `boundingBox()`의 width:height가 목표 비율 ±2% 이내다 (300px로 눌리지 않는다)
  - [ ] 1280 / 768 / 400px에서 캔버스가 뷰포트 세로를 넘지 않는다
  - [ ] 마운트 직후 캔버스 높이가 0이 아니어서 Plotly가 정상 렌더된다
  - [ ] `lockAspect` 동작이 회귀하지 않는다
  - [ ] PNG/PDF 내보내기 산출물이 정상이다 (`use-exports.ts`의 캡처가 실측 크기를 쓰는지 확인)
- 검증: `FE-TEST src/components/analysis/`, FE-ALL, FE-CHECK, `ROOT-E2E`(boundingBox 단언), VIEWPORT
- 증거: `evidence/P4-S1-T1.md`

### P4-S2-T1: 플롯 헤더 바 — 정규화·축 설정 승격
- 담당: `frontend-specialist`
- Depends On: P4-S1-T1
- Status: BLOCKED (D-6 경유)
- Write Scope: `SRC/components/analysis/ScatterViewControls.tsx`, `SRC/components/analysis/ScatterPlot.tsx`, `SRC/components/analysis/MarkerScatterPlot.tsx`, `SRC/components/settings/SettingsTab.tsx`, `SRC/locales/{en,ko}.ts`, 관련 테스트
- 기획 근거: [FB-04](feedback-2026-09-11/FB-04-scatter-ergonomics.md) §3-2, §3-3
- 구현 내용
  - 정규화 체크박스(`scatter-use-rox`)와 축 입력(`axis-x-min`/`max`, `axis-y-min`/`max`)은 **이미 존재**하지만
    접힌 `<details data-testid="analysis-advanced-settings">` 안에 매장되어 있다(`ScatterViewControls.tsx:170`, `:250`).
    **기능 추가가 아니라 발견 가능성 문제다.**
  - 항상 보이는 헤더 바로 승격: 정규화 체크박스(+참조 채널명), 축 모드 드롭다운, `축 설정…` 버튼, 드래그 도구 토글.
  - `축 설정…` 클릭 시 x/y min·max 4개 입력을 인라인 팝오버로 열고, **`axisMode`를 자동으로 `manual`로 전환**한다.
    현재는 `numberInput(..., !manual)`이라 manual을 먼저 골라야 입력이 활성화된다 — 사용자 요구와 어긋난다.
  - 접힌 채 유지: NTC 사분면, NTC 축 오프셋, 배수성 상한 (전문가용 저빈도).
  - **`data-testid`를 모두 보존한다.** 위치만 바뀌고 기존 단위 테스트는 통과해야 한다.
  - 참조 채널 드롭다운은 **현재 채널 1개만** 담는다(런타임 재지정은 이번 범위 밖 — 저장 모델 확장이 필요하다).
    참조 채널이 없는 런에서는 `hasNormalizationChannel` prop으로 비활성화하고 사유를 보인다.
  - `SettingsTab`의 `useRox` 중복 노출을 정리한다. **`settings-store.useRox` 필드 자체는 절대 제거하지 않는다** — 프리셋이 이 값을 담는다.
- AC
  - [ ] 정규화 체크박스가 펼치는 동작 없이 플롯 위에 보인다
  - [ ] 참조 채널명이 표시되고, 없는 런에서는 비활성 + 사유가 보인다
  - [ ] `축 설정…` 클릭 → 축 모드를 먼저 바꾸지 않고도 min/max 편집이 가능하다
  - [ ] 기존 `data-testid`가 모두 유지되어 기존 단위 테스트가 통과한다
  - [ ] 두 플롯이 동일한 컨트롤을 갖는다
  - [ ] 프리셋 저장·적용(`apply-preset.ts`)이 회귀하지 않는다
- 검증: `FE-TEST src/components/analysis/ScatterViewControls.test.tsx`, `FE-TEST src/components/settings/`, FE-ALL, FE-CHECK, VIEWPORT
- 증거: `evidence/P4-S2-T1.md`

### P4-S3-T1: 결과 중심 레이아웃
- 담당: `frontend-specialist`
- Depends On: P4-R1-T1, P4-S2-T1
- Status: BLOCKED (D-6 경유)
- Write Scope: `SRC/components/analysis/AnalysisTab.tsx`, `SRC/components/analysis/AnalysisWorkspace.tsx`, `SRC/components/analysis/WellSelectionToolbar.tsx`, `SRC/components/analysis/MultiMarkerAnalysisPanel.tsx`, `SRC/components/analysis/ResultsTable.tsx`, `SRC/index.css`, `SRC/locales/{en,ko}.ts`, 관련 테스트
- 기획 근거: [FB-03](feedback-2026-09-11/FB-03-analysis-density.md) §3
- 구현 내용
  - **경고 강등**: `analysisWarnings` Callout(`AnalysisTab.tsx:286`)을 `analysis-grid`(`:306`) 앞에서 `ResultsTable` 뒤로 옮긴다.
    단 **P4-R1-T1의 등급이 `blocking`인 경고는 상단에 잔류**시킨다. 툴바에 `⚠ 경고 N건` 배지를 두고 클릭 시 하단으로 이동,
    `aria-live`로 실시간 전파를 유지한다.
  - **컨텍스트 요약 접기**: `analysis-context-summary`(`AnalysisResultStatus` + `PlateScopeSummary`)를 `<details>`로 접고 한 줄 요약만 노출.
  - **그룹 프리셋 조건부화**: `WellSelectionToolbar.tsx:8`의 `DEFAULT_GROUPS` 6개는 "현재 선택을 그룹 N으로 저장"하는 프리셋 슬롯이며,
    선택이 없으면 `manualGroupSelectFirst` 오류만 낸다. `hasSelection === true` 이거나 저장된 수동 그룹이 있을 때만 렌더한다.
  - **안내 문구 이동**: "플레이트 웰을 고르거나 산점도에서 영역을 드래그하세요"를 플레이트 뷰 헤더 보조 문구로 옮긴다.
  - **스코프 선택기**: 마커 0개 세션에도 `[전체 플레이트] [+ 마커로 분할]` 선택기를 둔다. 마커 ≥1개면 기존
    `marker-selector-sidebar`(`MultiMarkerAnalysisPanel.tsx:258`)가 같은 자리에 들어간다. `split-marker-banner`는 이 선택기에 흡수되어 **제거**한다
    (`bannerDismissed` 상태와 세션 전환 리셋 로직도 함께 제거 — 부분 제거 시 죽은 상태가 남는다).
  - **`ResultsTable` 승격**: `[data-testid="results-scroll-region"]`의 `max-height: 24rem` 제약을 풀고 1급 영역으로 올린다.
    (현재도 항상 렌더되지만 최하단에서 높이가 잘려 있다.)
- AC
  - [ ] 1920x911에서 스크롤 없이 산점도 전체와 유전형 요약이 보인다
  - [ ] `blocking` 경고는 상단에 남고, `advisory`만 강등된다. 배지 클릭으로 하단 경고에 도달한다
  - [ ] 그룹이 없고 선택도 없는 플레이트에서 그룹 프리셋 버튼이 렌더되지 않는다
  - [ ] 마커 0개 세션에도 스코프 선택기가 보인다
  - [ ] 마커 ≥1개 세션의 기존 마커 선택 동작이 회귀하지 않는다
  - [ ] `split-marker-banner` 제거 후 죽은 상태(`bannerDismissed`)가 남지 않았다
  - [ ] 키보드 배정(`use-keyboard-assignment`)과 `navigateTabs`가 유지된다
- 검증: `FE-TEST src/components/analysis/`, FE-ALL, FE-CHECK, ROOT-E2E, VIEWPORT
- 증거: `evidence/P4-S3-T1.md`

### P4-S0-V: 결과 화면 게이트
- 담당: `test-specialist`
- Depends On: P4-S3-T1
- Status: BLOCKED (D-6 경유)
- Write Scope: `docs/planning/feedback-2026-09-11/evidence/**`
- AC: [ ] 신규 실패 0 · [ ] 새 코드 coverage ≥70%·복잡도 ≤10 · [ ] 접근성 회귀 0 · [ ] 1920x911 육안 확인 완료 · [ ] 미해결 중요 리뷰 이슈 0
- 검증: BE-ALL, FE-ALL, FE-CHECK, ROOT-E2E, EXISTING-E2E, VIEWPORT
- 증거: `evidence/P4-S0-V.md`

---

## Phase P5 — 업로드 진입점 (FB-02 진입점 범위)

### P5-S1-T1: 파일 워크스페이스 드로어 구조 리팩터링
- 담당: `frontend-specialist`
- Depends On: P4-S0-V
- Status: TODO
- Write Scope: `SRC/components/upload/FileWorkspaceDrawer.tsx`, `SRC/components/upload/FileWorkspaceTrigger.tsx`(신규), `SRC/components/layout/Header.tsx`, `SRC/components/upload/UploadZone.tsx`, `SRC/App.tsx`, 관련 테스트
- 기획 근거: [FB-02](feedback-2026-09-11/FB-02-upload-entry-and-brand.md) §3-1
- 구현 내용
  - **핵심 제약**: 드로어 큐는 `FileWorkspaceDrawer.tsx:87`의 지역 `useState<QueueItem[]>`다.
    `session-store`의 persist는 `openSessionIds` / `sessionQueries`만 담는다("Only WHICH plates are open survives a reload").
    → **세션 유무로 드로어를 조건부 마운트/언마운트하면 업로드 중 큐가 소실된다.**
    업로드가 끝나면 세션이 생기고 그 순간 `visibility.upload`가 false가 되므로, 조건부 마운트 설계는 **성공 직후 큐를 지우는 버그**를 낳는다.
  - 패널(상시 마운트)과 트리거(복수 배치)를 분리한다. 패널은 `App.tsx` 최상위에 **항상** 마운트하고 큐 상태를 소유한다.
    열림 상태와 큐는 Context 또는 zustand로 트리거에 노출한다.
  - 트리거는 두 위치에 렌더하고 `visibility.upload`가 어느 쪽을 보일지 결정한다:
    세션 없음 → `UploadZone` 하단 보조 액션 줄(`inline`), 세션 있음 → 헤더(`header`, 현행 아이콘+카운트).
  - 패널은 portal로 렌더해 트리거 위치와 DOM 계층을 분리한다.
  - 닫힘 시 포커스는 **현재 보이는 트리거**로 돌아가야 한다. `triggerRef` 단일 참조를 활성 트리거 레지스트리로 바꾼다.
    포커스 트랩(`FOCUSABLE` 상수) 동작을 유지한다.
- AC
  - [ ] 세션이 없을 때 헤더에 드로어 트리거가 보이지 않는다
  - [ ] 세션이 없을 때 드롭존 인근에서 파일 워크스페이스를 열 수 있다
  - [ ] **업로드 진행 중 세션이 생성되어 트리거 위치가 바뀌어도 큐와 열림 상태가 유지된다** (핵심 회귀 방지)
  - [ ] 두 트리거 중 어디서 열든 동일한 큐가 보인다
  - [ ] 드로어를 닫으면 포커스가 현재 보이는 트리거로 돌아간다
  - [ ] 드로어 내부 동작(파일 검증·ZIP 패키징·매핑 마법사 진입)이 변하지 않는다
- 검증: `FE-TEST src/components/upload/`, `FE-TEST src/components/layout/Header.test.tsx`, FE-ALL, FE-CHECK, ROOT-E2E, VIEWPORT
- 증거: `evidence/P5-S1-T1.md`

### P5-S2-T1: 업로드 경로 한도·문구 일치
- 담당: `frontend-specialist`
- Depends On: P5-S1-T1, **D-7 결정**
- Status: BLOCKED (D-7)
- Write Scope: `SRC/lib/upload-jobs.ts`, `SRC/components/upload/UploadZone.tsx`, `SRC/components/upload/FileWorkspaceDrawer.tsx`, `SRC/locales/{en,ko}.ts`, 관련 테스트
- 기획 근거: [FB-02](feedback-2026-09-11/FB-02-upload-entry-and-brand.md) §3-2
- 구현 내용
  - **중앙 드롭존은 이미 멀티 업로드를 지원한다** — `UploadZone.tsx:418`의 `multiple`, `:157-166`의 `runUploadJobs(files)` 배치.
    문제는 "멀티가 헤더에만 있다"가 아니라 **같은 일을 하는 구현이 두 벌이고 한도·오류 복구가 다르다**는 것이다.

    | | `UploadZone` | `FileWorkspaceDrawer` |
    | --- | --- | --- |
    | 다중 파일 | `runUploadJobs(files)` | 자체 `QueueItem[]` 상태 머신 |
    | 한도 | `lib/upload-jobs.ts` 규칙 | `MAX_FILES_PER_DROP=20`, `MAX_TOTAL_BYTES=500MB` |
    | 오류 복구 | `UploadJobSummary` | 큐 항목 `error` 상태 |

  - D-7 결정에 따라 통합하거나, 역할을 분리(단건 빠른 경로 / 다건 관리 경로)하고 **한도와 오류 문구만 일치**시킨다. 권장은 후자.
- AC
  - [ ] 두 경로의 파일 수·용량 한도가 동일하다
  - [ ] 한도 초과 시 두 경로가 같은 문구를 보인다 (en/ko 모두)
  - [ ] 중앙 드롭존의 다중 파일 배치 업로드가 회귀하지 않는다
- 검증: `FE-TEST src/lib/upload-jobs.test.ts`, `FE-TEST src/components/upload/`, FE-ALL, FE-CHECK
- 증거: `evidence/P5-S2-T1.md`

### P5-S0-V: 업로드 게이트
- 담당: `test-specialist`
- Depends On: P5-S2-T1
- Status: BLOCKED (D-7 경유)
- Write Scope: `docs/planning/feedback-2026-09-11/evidence/**`
- AC: [ ] 신규 실패 0 · [ ] 업로드 중 큐 유지 시나리오 E2E 통과 · [ ] 새 코드 coverage ≥70% · [ ] 미해결 중요 리뷰 이슈 0
- 검증: FE-ALL, FE-CHECK, ROOT-E2E, EXISTING-E2E
- 증거: `evidence/P5-S0-V.md`

---

## Phase P6 — 브랜드 정체성 (FB-07 + FB-02 브랜드 범위)

### P6-S1-T1: 제품명 통일 — Q-Prism® Cluster Caller
- 담당: `frontend-specialist` + `docs-specialist`
- Depends On: P5-S0-V
- Status: TODO (**D-1 해소됨 — 실행 가능**)
- Write Scope: `SRC/locales/{en,ko}.ts`, `FE/index.html`, `README.md`, `BE/app/reporting/pdf_builder.py`
- 기획 근거: [FB-07](feedback-2026-09-11/FB-07-identity-and-ia.md) §3-2
- 구현 내용
  - 현재 리포지토리에 **세 가지 이름이 공존한다**: `ASG-PCR SNP 판별 분석기`(UI `locales:139/141`),
    `Q-Prism® SNP Visualizer`(`README.md:1`), `SNP analyzer`(컨테이너·경로). **하나로 통일한다.**
  - 채택명: **`Q-Prism® Cluster Caller`** (한국어 UI도 동일 표기, 부제로 `SNP 판별 · 대립유전자 클러스터링`).
    `Q-Prism`은 인바이러스테크 자사 저작물이므로 `®` 표기를 사용한다.
  - 변경 지점: `appTitle`(en/ko), `index.html`의 `<title>` · `og:title` · `og:description` · `description` · `keywords`,
    `README.md`, PDF 산출물 브랜드 문자열(`app/reporting/pdf_builder.py`).
  - **ASG 플랫폼 연동 문구는 유지한다** — `Save result to ASG Designer`, `backToAsgDesigner`는 상대 시스템의 이름이다.
  - `canonical`(`https://snpanalyze.ivttools.com/`) 변경 여부는 SEO 영향이 있으므로 **변경하지 않고** 증거에 검토 필요로 기록한다.
- AC
  - [ ] UI·`<title>`·OG·README·PDF 산출물에서 제품명이 일관된다
  - [ ] `en`/`ko` 양쪽이 갱신되고 타입 체크를 통과한다
  - [ ] ASG 연동 문구가 변경되지 않았다
  - [ ] `canonical`이 변경되지 않았고, 변경 필요 여부가 증거에 기록되었다
- 검증: FE-ALL, FE-CHECK, BE-TEST(PDF 산출물), ROOT-E2E
- 증거: `evidence/P6-S1-T1.md`

### P6-S2-T1: Q-Prism 브랜드 팔레트 적용
- 담당: `frontend-specialist`
- Depends On: P6-S1-T1, **D-2 및 D-4 결정**
- Status: BLOCKED (D-2, D-4)
- Write Scope: `SRC/index.css`, `SRC/lib/plotly-theme.ts`(P0-T0.2 결과 위), `SRC/lib/constants.ts`, `SRC/lib/genotype.ts`, `SRC/components/protocol/ProtocolTab.tsx`
- 기획 근거: [FB-07](feedback-2026-09-11/FB-07-identity-and-ia.md) §3-3
- 구현 내용
  - 현재 `--color-primary: #2563eb`는 **Tailwind 기본 blue-600**이다. 브랜드 색이 아니라 프레임워크 기본값이며,
    사용자가 "촌스럽다"고 한 것의 물리적 근거다.
  - D-2로 확정된 HEX를 `@theme` 블록과 `body.dark` 블록에 **동시** 반영한다. 한쪽만 바꾸면 다크 모드가 깨진다.
  - P0-T0.2에서 색을 한 곳으로 모아 두었으므로, 이 태스크는 **값 교체**가 주된 작업이다.
  - **절대 준수 제약**
    1. `--color-fam` / `--color-allele2`는 D-4 결정에 따른다. 권장은 **유지** — FAM/HEX 채널 색은 qPCR 판독 관례이며 실험자 습관에 직결된다. 브랜드보다 과학적 관례가 우선한다.
    2. 대비비: 본문 4.5:1, UI 요소 3:1(WCAG AA). 현행 `#1a1a2e` on `#f5f7fa`는 약 15:1로 여유가 크다 — 새 팔레트가 이를 깎지 않는지 검증한다.
    3. 상태색 의미 보존: 경고=앰버, 위험=적, 성공=녹. 브랜드 색과 충돌하면 브랜드를 양보한다.
- AC
  - [ ] 라이트·다크 모두에서 본문 대비비가 WCAG AA를 만족한다
  - [ ] 채널 색(`--color-fam`/`--color-allele2`)이 D-4 결정대로 처리되었다
  - [ ] Plotly 차트 색이 앱 팔레트와 일치한다
  - [ ] 상태색(경고/위험/성공) 의미가 보존된다
  - [ ] 다크 모드 토글 왕복에서 색이 깨지지 않는다
- 검증: FE-ALL, FE-CHECK, VIEWPORT(라이트/다크 × 4해상도), 대비비 자동 검사
- 증거: `evidence/P6-S2-T1.md`

### P6-S3-T1: 브랜드 에셋 · 업로드 히어로
- 담당: `frontend-specialist`
- Depends On: P6-S2-T1, **D-3 에셋 제공**
- Status: BLOCKED (D-3)
- Write Scope: `FE/public/brand/**`, `FE/public/favicon.svg`, `FE/index.html`, `SRC/components/upload/UploadZone.tsx`, `SRC/components/layout/Header.tsx`, `SRC/locales/{en,ko}.ts`
- 기획 근거: [FB-02](feedback-2026-09-11/FB-02-upload-entry-and-brand.md) §3-3, §3-4
- 구현 내용
  - 현재 `frontend/public/`에는 템플릿 CSV/TSV 3개뿐이며 **이미지 에셋이 0개, 파비콘도 없다.** `index.html`에 `<link rel="icon">`도 없다.
  - 에셋은 **SVG**를 권장한다 — 다크 모드에서 `currentColor`/CSS 변수 추종, 해상도·번들 크기 문제 없음.

    | 에셋 | 경로 |
    | --- | --- |
    | 파비콘 | `frontend/public/favicon.svg` |
    | Q-Prism 마크 | `frontend/public/brand/qprism-mark.svg` |
    | Invirustech 로고 | `frontend/public/brand/invirustech.svg` |
    | 히어로 아트 | `frontend/public/brand/qprism-hero.svg` |

  - `UploadZone` 상단에 브랜드 히어로 블록(마크 + `Q-Prism® Cluster Caller` + 부제)을 추가한다.
    **세션 없음 상태에서만** 표시해 분석 중 화면 공간을 잡아먹지 않는다.
  - `Powered by Invirustech` 링크는 업로드 화면에서 하단 푸터로, 세션 중에는 현행 헤더 위치를 유지한다.
- AC
  - [ ] 파비콘이 브라우저 탭에 표시된다
  - [ ] 히어로 블록이 세션 없음 상태에서만 보인다
  - [ ] 히어로가 1920px과 400px 모두에서 깨지지 않는다
  - [ ] 다크 모드에서 로고·아트가 판독 가능하다
  - [ ] 분석 중 화면에 히어로가 나타나지 않는다
- 검증: FE-ALL, FE-CHECK, ROOT-E2E, VIEWPORT(라이트/다크 × 4해상도)
- 증거: `evidence/P6-S3-T1.md`

### P6-S0-V: 브랜드·최종 인수 게이트
- 담당: `test-specialist` + `security-specialist`
- Depends On: P6-S3-T1
- Status: BLOCKED (D-2, D-3 경유)
- Write Scope: `docs/planning/feedback-2026-09-11/evidence/**`, `CLAUDE.md`(실행 증거 기록)
- 구현 내용
  - 전체 품질 체인 + 보안 리뷰 + 프론트엔드 리뷰.
  - 피드백 7건 각각에 대해 **원문 요구 대비 충족 여부**를 대조표로 남긴다.
  - `CLAUDE.md`에 이번 계약의 실행 증거(Contract ID, Phase별 커밋, 게이트 결과)를 기록한다.
- AC
  - [ ] BE-ALL / FE-ALL / FE-CHECK / ROOT-E2E / EXISTING-E2E 전체 통과
  - [ ] 새 코드 coverage ≥70%, 복잡도 ≤10. 기존 기준선과 분리 보고
  - [ ] 보안 리뷰 신규 이슈 0
  - [ ] 피드백 7건 대조표 작성 완료
  - [ ] 미해결 결정 게이트가 있으면 명시적으로 남았다
- 검증: 전체 체인
- 증거: `evidence/P6-S0-V.md`

---

## 5. 태스크 요약 (DAG)

```
P0-T0.1 ──┬── P0-T0.2 ──┬── P0-S0-V
          │             │
          └─────────────┘
                        │
                   P1-S1-T1 ── P1-S0-V
                                   │
                   ┌───────────────┴───────────────┐
              P2-R1-T1                        P2-R1-T2      (병렬 가능: 최대 2)
                   │                               │
              P2-S1-T1 ──────────┬─────────────────┘
                                 │
                            P2-S2-T1 ── P2-S0-V
                                            │
                            P3-S1-T1 ── P3-S2-T1 ── P3-S0-V      [D-5]
                                                        │
                        ┌───────────────────────────────┤
                   P4-R1-T1                        P4-S1-T1      [D-6]
                        │                               │
                        └──────────┬──── P4-S2-T1 ──────┘
                                   │
                              P4-S3-T1 ── P4-S0-V
                                              │
                              P5-S1-T1 ── P5-S2-T1 ── P5-S0-V    [D-7]
                                                          │
                              P6-S1-T1 ── P6-S2-T1 ── P6-S3-T1 ── P6-S0-V
                                            [D-2,D-4]      [D-3]
```

| Phase | 태스크 수 | 담당 | 착수 가능 여부 |
| --- | --- | --- | --- |
| P0 | 3 | orchestrator, frontend, test | **즉시** |
| P1 | 2 | frontend, test | **즉시** (D-8 부분) |
| P2 | 5 | backend ×2, frontend ×2, test | **즉시** (D-9 부분) |
| P3 | 3 | frontend ×2, test | **D-5 대기** |
| P4 | 5 | backend, frontend ×3, test | **D-6 대기** (P4-R1-T1만 선행 가능) |
| P5 | 3 | frontend ×2, test | P5-S2-T1은 **D-7 대기** |
| P6 | 4 | frontend, docs, test, security | P6-S1-T1 실행 가능 / 나머지 **D-2·D-3·D-4 대기** |
| **합계** | **25** | | |

## 6. 실행 전 확인 목록

- [x] 0절 승격 절차 수행 (이전 계약 archive → 본 문서를 `06-tasks.md`로) — 2026-09-11 완료
- [ ] **`.claude/orchestrate-state.json`을 새 `contract_id`로 시작** (이전 상태 재사용 금지) — 현재 해시 불일치, P0-T0.1 전 실행 금지
- [ ] `CLAUDE.md` Orchestration Handoff를 이번 계약 기준으로 갱신 (기존 이력 보존)
- [ ] baseline = `main` `c2bc854` 확인 (detached `201e0c7` 아님)
- [ ] 이전 계약 worktree·브랜치 보존 확인
- [ ] 결정 게이트 D-2 / D-3 / D-4 / D-5 / D-6 / D-7 답변 수령 (미수령 시 해당 Phase는 BLOCKED 유지)
- [ ] 원격 push·배포·외부 알림은 **이번 계약에 승인되지 않음**을 오케스트레이터가 인지
