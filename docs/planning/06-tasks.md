# StepOnePlus · 마커별 분석 · 결과 출력 작업서 — Auto-Orchestrate (초안 r6, 병렬 레인)

- Contract ID: `qprism-stepone-markers-20261002-v1`
- 작성일: 2026-10-02 · r6(리뷰 4차 반영: 사용자 설정 격리·거부 시험·venv 재구축·marker_id 매칭·P0 분할)
- 상태: ACTIVE — 2026-10-02 사용자 승인으로 승격(D-8). 초안 이력은 git log 참조
- 기준 기획서: [`stepone-2026-10-02/00-overview.md`](stepone-2026-10-02/00-overview.md) (r2)
- baseline_commit: `55a7452` (main, v1.3.1). 루트 detached `201e0c7`에서 시작하지 않는다.
- 실행 모드: `/auto-orchestrate --tmux --parallel 4` (Phase 안 레인 병렬, Phase 사이 직렬)

---

## 1. 실행 계약

- 오케스트레이터(루트 세션)는 의존성 선택·위임·상태 갱신·레인 병합·검증·Phase 통합만 한다. 구현은 지정 specialist가 독립 tmux 프로세스에서 한다.
- 로컬 커밋·로컬 Phase 통합까지만. **원격 push·배포·외부 알림 없음.** 이전 계약의 push·배포 권한을 승계하지 않는다.
- 기능 작업은 `TDD_MODE:RED_FIRST`(RED → GREEN → REFACTOR 증거). 준비·문서·검증 작업은 예외.
- specialist는 자기 레인 브랜치에 로컬 커밋 후 완료 신호를 남긴다. Phase 브랜치·main 병합은 오케스트레이터만 한다.
- 호출당 12턴(통합·게이트 15턴). 초과 시 완료 부분·실패 명령·다음 수정점을 결과 파일에 남기고 종료한다.
- 결정 게이트 차단 태스크는 BLOCKED. "비차단" 결정은 권장안으로 진행하고 증거에 기록한다. 사용자가 다른 안을 고르면 해당 태스크만 FAIL로 되돌려 재실행한다.
- 고객 파일(`261002_QPrism_ASG-PCR.eds`)과 그 산출물은 커밋하지 않는다.

### 경로 약어
ROOT = `/mnt/docker/Q-Prism-SNP-visualizer`, BE = `snp-analyzer`, APP = `snp-analyzer/app`, FE = `snp-analyzer/frontend`, SRC = `snp-analyzer/frontend/src`, E2E = 저장소 `tests/`

---

## 2. 병렬 실행 구조

### 2.1 원칙: 계약 선고정 → 레인 병렬 → Phase 통합

1. **P0에서 공유 파일을 한 번에 고정한다.** 새 필드·타입·함수 시그니처·DB 마이그레이션·라우터 등록·공통 파라미터·i18n 키·테스트 ID를 P0-T0.3a(백엔드)·b(프론트)·c(i18n)가 만든다(동작은 기본값/스텁, 기존 동작 불변).
2. **이후 레인은 공유 파일을 수정하지 않는다.** 각 레인은 자기 Write Scope 안의 파일만 바꾼다. 공유 파일 수정이 필요하면 구현을 멈추고 결과 파일에 요청을 남긴다 → 오케스트레이터가 "계약 보정" 태스크(`P*-C<n>`)를 Phase 기준 브랜치 `stepone/pN`에 직렬로 커밋하고, **진행 중인 모든 레인이 `git merge stepone/pN`으로 보정을 받은 뒤** 재개한다(멈춘 레인만이 아니라 전부).
3. **같은 Phase 레인끼리 Write Scope가 겹치지 않는다**(§2.4 소유표). 겹치면 그 Phase를 시작하지 않는다.
4. **레인은 다른 레인의 결과를 기다리지 않는다.** 필요한 입력은 P0 계약 타입으로 합성·모킹한다. 실제 연결 확인은 Phase 게이트에서 한다.

### 2.2 브랜치·Worktree

- Phase 기준 브랜치: `stepone/pN` (Phase 시작 시 `main`에서 생성), worktree `ROOT/worktree/stepone-pN`
- 레인 브랜치: `stepone/pN-<lane>` (Phase 기준 브랜치에서 생성), worktree `ROOT/worktree/stepone-pN-<lane>`
  - 예: `git worktree add worktree/stepone-p1-parser -b stepone/p1-parser stepone/p1`
- 레인 완료 후 오케스트레이터가 `stepone/pN`에 레인을 **정해진 순서로** `--no-ff` 병합 → Phase 게이트 → `main`에 로컬 병합.
- 기존 worktree·브랜치(`ux-followup-*`, `feedback-*`)는 건드리지 않는다. 강제 초기화·삭제 금지.

### 2.3 tmux 실행 규약

**레인 래퍼** `ROOT/.claude/orchestrate/stepone/run-lane.sh <task-id> <worktree> <model> <budget-usd>` (P0-T0.1에서 작성). 레인은 항상 이 래퍼로만 띄운다.
1. 레인 worktree로 이동, 레인 환경변수 export(`DB_PATH`=레인 전용 임시 DB, `QPRISM_STEPONE_EDS`, `API_PORT`, `FE_PORT`, `VITE_DEV_API_TARGET`, `PYTHON`=계약 venv 절대경로) — 레인 명령에 `VAR=값` 접두사를 쓰지 않게 한다.
2. `timeout 90m claude -p "<레인 프롬프트>" --model <model> --setting-sources project --strict-mcp-config --disable-slash-commands --settings ROOT/.claude/orchestrate/stepone/lane-settings.json --permission-mode acceptEdits --max-budget-usd <budget> --output-format json > <signal>/<task-id>.json; echo $? > <signal>/<task-id>.exit`
3. 레인은 결과를 **자기 worktree 안** `.lane/<task-id>.result.md`에 쓴다. `.lane/`은 공용 `.git/info/exclude`(worktree가 공유)에 P0-T0.1이 한 번만 추가한다. 상태 첫 줄 `STATUS: DONE|BLOCKED|PARTIAL`.
4. 래퍼가 종료 후 결과 파일을 신호 디렉터리 `ROOT/.claude/orchestrate/stepone/`로 복사하고, `STATUS: DONE`이고 `git status --porcelain`이 비어 있으면 `<task-id>.done`(내용: `git rev-parse HEAD`)을, 아니면 `<task-id>.blocked`를 쓴다. JSON의 `num_turns`·비용을 기록한다.
- 레인은 신호 디렉터리에 직접 쓰지 않는다(작업 디렉터리 밖 쓰기 권한 불필요).
- **`--setting-sources project`**: 사용자 설정(`~/.claude/settings.json`의 훅 — RTK 명령 재작성 포함 — 과 `settings.local.json`의 넓은 허용 규칙 `Bash(bash:*)`, `Bash(git push:*)`, `Bash(sudo:*)` 등)을 레인에서 불러오지 않는다. 권한은 `lane-settings.json`과 프로젝트 설정만으로 정해진다. RTK 재작성이 없으므로 `git push` 같은 금지 규칙이 그대로 맞는다.

**레인 권한 설정** `lane-settings.json`(D-11, P0-T0.1에서 작성·시험)
- allow: `Read`, `Edit`, `Write`, `Grep`, `Glob`, `Bash($PYTHON *)`, `Bash(<venv>/bin/python *)`, `Bash(<venv>/bin/ruff *)`, `Bash(npm ci*)`, `Bash(npm run test*)`, `Bash(npm run lint*)`, `Bash(npm run build*)`, `Bash(npx tsc*)`, `Bash(npx vitest*)`, `Bash(npx playwright test*)`, `Bash(git status*)`, `Bash(git diff*)`, `Bash(git log*)`, `Bash(git add*)`, `Bash(git commit*)`, `Bash(git merge stepone/*)`, `Bash(git rev-parse*)`, `Bash(ls *)`, `Bash(mkdir -p .lane*)`
- deny: `Bash(git push*)`, `Bash(rtk git push*)`, `Bash(git add -A*)`, `Bash(git add .*)`, `Bash(git add --all*)`, `Bash(git reset --hard*)`, `Bash(git checkout*)`, `Bash(git switch*)`, `Bash(git restore*)`, `Bash(git clean*)`, `Bash(git stash*)`, `Bash(git worktree*)`, `Bash(git branch -D*)`, `Bash(rm -rf*)`, `Bash(bash *)`, `Bash(sh *)`, `Bash(sudo*)`, `Bash(docker*)`, `Bash(pip install*)`, `Bash(npm install*)`, `Bash(claude*)`, `Bash(curl*)`, `Bash(wget*)`, `Edit(.claude/**)`, `Write(.claude/**)`, `Edit(.git/**)`, `Write(.git/**)`, `Edit(**/.env*)`, `Write(**/.env*)`
- 커밋 메시지는 `git commit -F .lane/<task-id>.msg`로 쓴다(heredoc 금지 — 패턴 일치 보장). `git add`는 **파일 이름을 하나씩** 지정한다(`-A`·`.` 금지).
- 레인 프롬프트 명령 규칙: `cd` 금지(래퍼가 이미 worktree에 있음), `&&`·`;` 연결 금지, 파이썬은 `$PYTHON` 문자 그대로 또는 venv 절대경로로 호출(허용 패턴과 글자 그대로 맞아야 함). `-p` 모드에서 허용 밖 명령은 묻지 않고 거부되므로, 막히면 `STATUS: BLOCKED`로 사유를 남긴다.
- **감수하는 위험(명시)**: 빌드 레인은 `$PYTHON`·`npm`·`npx`를 허용하므로 이를 통한 임의 코드 실행(서브프로세스 `git push`, 외부 쓰기, 네트워크)을 패턴으로 막을 수 없다. 한계는 `timeout`·예산·레인 worktree 격리·병합 전 소유표 대조·게이트 리뷰다. 원격 push 차단의 최종 수단으로 P0-T0.1이 공용 `.git/hooks/pre-push`에 계약 기간 동안 모든 push를 거부하는 훅을 둔다(원격 설정은 바꾸지 않음, 기존 훅이 있으면 보존·연결, 계약 종료 시 원복, 증거 기록). 이 훅은 계약 기간 동안 **사용자 본인의 push도 막으므로** 설치·원복 시각을 사용자에게 알리고 `evidence/P0-T0.1.md`에 기록한다. 훅 파일 변조(python 경유)는 각 Phase 게이트에서 해시로 확인한다.
- 레인은 장기 실행 서버를 띄우지 않는다. 서버가 필요한 검증(ROOT-E2E, 스모크)은 **오케스트레이터가 서버를 띄운 뒤** 레인을 실행하거나 게이트에서 직접 한다.
- 네트워크·docker가 필요한 DEP-AUDIT는 레인이 아니라 **오케스트레이터가 게이트에서** 실행한다.

**턴·시간 한도**: 이 CLI(2.1.287)에는 턴 한도 옵션이 없다. 강제 수단은 `timeout 90m`과 `--max-budget-usd`(구현 레인 기본 8, 게이트 10, 문서 2)다. "12턴" 크기 기준은 태스크 설계 기준으로만 쓰고, 실제 `num_turns`를 증거에 남긴다.

**승인 전달**: 레인 프로세스도 전역 `~/.claude/CLAUDE.md`(분석 → 승인 → 실행)를 읽는다. P0-T0.1은 **사용자의 명시적 승인 이후에만** 실행되고, 사용자의 승인 문구를 그대로 `evidence/P0-T0.1.md`에 인용한다. 레인 프롬프트 첫 줄은 "사용자 승인 완료 — 계약 `qprism-stepone-markers-20261002-v1`, 승인 원문 `evidence/P0-T0.1.md`. 이 태스크 범위 안에서 바로 진행"이다. 범위 밖 변경이 필요하면 멈추고 `STATUS: BLOCKED`.

**감시**: 오케스트레이터는 60초마다 `.exit`를 확인한다. `.exit`가 있는데 `.done`이 없으면 FAIL(시간·예산 초과, 비정상 종료 포함). FAIL·BLOCKED는 같은 Phase의 다른 레인을 멈추지 않는다.

**재시도**: 같은 레인 worktree·브랜치에서 이어서(부분 커밋 보존), 예산 1.5배, 1회. 다시 실패하면 태스크 분할안과 함께 사용자에게 보고한다.

**스킬 기본값 재정의**: auto-orchestrate tmux 기본값(`/tmp/task-*.done`, 세션 `vibe`, 5초 폴링·600초 제한, Phase 단일 브랜치)을 위 값으로 바꿔 쓴다. 정리 단계의 삭제 대상은 신호 디렉터리 안으로 한정한다. tmux 세션 `qprism-stepone`, 레인당 패널 1개, 동시 최대 4.

**순차 태스크 레인**: 한 레인은 태스크 여러 개를 순서대로 수행한다(예: P1-A1 → P1-A2). 다음 태스크는 같은 worktree에서 새 래퍼 호출로 시작한다.

### 2.4 Write Scope 소유표

| 파일/영역 | 소유 태스크 | 나머지 |
|---|---|---|
| `APP/models.py`, `APP/db.py`, `APP/db_schema.sql`, `APP/main.py`, `APP/routers/export_params.py`(신규), `APP/routers/{export_pptx,export_images}.py`(**빈 라우터로 신규 생성만**, 내용은 P2-F/G), `BE/tests/test_contract_stepone.py`, `SRC/types/api.ts`, `SRC/lib/api.ts`, `SRC/lib/export-testids.ts`(신규), `BE/requirements.txt` | **P0-T0.3a/b만** | 읽기 전용 |
| `APP/reporting/result_snapshot.py` | P0-T0.3a(`ExportOptions.marker_ids`(마지막 필드·기본값)·`filter_snapshot()` 완성) → P1-C1(`MarkerLabel`·`marker_labels`·현재 이름) | P2는 읽기 |
| `SRC/locales/{en,ko}.ts` | P0-T0.3c(키 전부 생성) | 이후 레인은 **자기 접두사 키의 문구만** 수정: P1-D `markerAllele.*`·`stepone.*`, P2-H `genotypeDisplay.*`, P3-I `exportReport.*` |
| `APP/parsers/**`, `APP/processing/ntc_detection.py` | P1-A | — |
| `APP/routers/{clustering,layouts,marker_catalog,sample,upload,import_api}.py`, `APP/services/{import_session,session_restore}.py` | P1-B | — |
| `APP/reporting/{charts,snapshot_presentation,snapshot_plate}.py`, `APP/reporting/filenames.py`(신규), `APP/reporting/fonts/**` | P0-T0.3a(`snapshot_presentation` 스텁만) → P1-C | **P2는 읽기만**(P2-E·F 포함) |
| `SRC/lib/genotype.ts`(P0-T0.3b 스텁 → P1-D), `SRC/lib/{chart-semantics,scatter-axes}.ts`, `SRC/components/analysis/{PlateSetupTab,MarkerScatterPlot,ScatterPlot,MultiMarkerAnalysisPanel,CycleControl,AmplificationCurvePanel}.tsx`, `SRC/hooks/use-marker-scope*`, `SRC/lib/upload-response.ts` | P1-D | P2-H는 읽기 |
| `APP/reporting/{snapshot_pdf,snapshot_xlsx}.py`, `APP/routers/{export,data,qc}.py` | P2-E | — |
| `APP/reporting/snapshot_pptx.py`, `APP/routers/export_pptx.py` | P2-F | — |
| `APP/reporting/snapshot_images.py`, `APP/routers/export_images.py` | P2-G | — |
| `SRC/components/analysis/{ResultsTable,WellDetailPanel,PlateView,PlateLegend,WellTypePopup,FluorescenceDataCard,AmplificationOverlay}.tsx`, `SRC/components/analysis/MultiMarkerAnalysisPanel.tsx`(P2에서만, prop 전달), `SRC/components/statistics/StatisticsTab.tsx`, `SRC/components/batch/{BatchTab.tsx,project-export.ts,project-summary.ts}`, `SRC/components/shared/KeyboardHelpOverlay.tsx` | P2-H | — |
| `SRC/components/layout/Header.tsx`, `SRC/hooks/use-exports.ts` | P3-I | — |
| `E2E/29-stepone-markers.spec.ts`, `E2E/30-stepone-exports.spec.ts`, `E2E/fixtures/stepone/**` | P3-J | — |
| `README.md`, `FE/package.json`(버전만), `APP/version.py`(버전만), `docs/release-notes/**` | P3-K | — |
| 각 태스크 테스트 파일 | 해당 태스크 | — |

---

## 3. 공통 검증

이전 계약의 별칭(BE-TEST, BE-ALL, BE-LINT, FE-TEST, FE-ALL, FE-CHECK, ROOT-E2E, EXISTING-E2E)과 규칙(worktree별 `npm ci`, ruff 변경분 기준·신규 파일 format, 새 코드 coverage ≥70%, 복잡도 ≤10, 임시 `DB_PATH`·합성 계정)을 그대로 쓴다.
- 백엔드 인터프리터: P0에서 만든 계약 전용 venv `ROOT/worktree/stepone-p0/snp-analyzer/venv/bin/python`을 **절대경로로**. 심볼릭링크·호스트 설치 금지. 루트 `snp-analyzer/venv`는 쓰지 않는다.
- 레인 테스트는 자기 worktree에서 돈다. 포트 배정: P1 8101–8104, P2 8201–8204, P3 8301–8303 (API), +100(프론트 dev: `VITE_DEV_API_TARGET=http://localhost:<API> npm run dev -- --port <API+100>`, `vite.config.ts` 기본 5173을 쓰지 않는다).
- `npm ci`는 프론트 파일을 바꾸거나 FE-CHECK가 필요한 레인만 한다(백엔드 전용 레인은 생략).

추가 별칭:
- REAL-EDS: `QPRISM_STEPONE_EDS=<저장소 밖 실제 파일> BE-TEST tests/test_stepone_real_file.py` (파일 없으면 skip, 증거에 실행 여부 기록)
- EXPORT-INSPECT: PDF 텍스트 추출, PPTX를 `python-pptx`로 열어 슬라이드·표·글꼴 검사, zip 항목 수·이름 검사
- DEP-AUDIT: `pip-audit -r BE/requirements.txt` + `docker compose build backend`(이미지 빌드만)
- LANE-MERGE: 레인을 Phase 브랜치에 병합한 상태에서 BE-ALL + FE-ALL + FE-CHECK

증거: `docs/planning/stepone-2026-10-02/evidence/<task-id>.md` (레인 결과 파일을 오케스트레이터가 옮겨 적는다)

**레인 병합 절차**: 레인마다 ① 병합 **전** 소유표 대조(`git diff --name-only stepone/pN...<lane>` ⊆ Write Scope, 아니면 병합 거부) ② `--no-ff` 병합 ③ 그 레인 관련 테스트(BE-ALL 또는 FE-ALL) — 깨지면 해당 레인을 되돌리고 FAIL.

**Phase 게이트 체인**: LANE-MERGE → 레인별 AC 재확인 → code-review → security(해당 변경) → frontend review(UI 변경). 미해결 중요 이슈 0, 신규 실패 0. 미충족 게이트를 PASS로 처리하지 않는다.

---

## 4. 인터페이스 계약 점검(ICV)

| 소비 동작 | 계약(P0-T0.3a/b/c에서 고정) | 생산(동작 구현) | 소비 |
|---|---|---|---|
| 첫 화면 사이클(복원 포함) | `UnifiedData.default_cycle: int\|None` + metadata_json 영속화 | P1-A(값·`compute_suggested_cycle`, `default_cycle ∈ cycles` 검증) | 세션 복원, 업로드 응답 |
| 사이클 표시 | `UnifiedData.read_labels: dict[int, ReadLabel]\|None` (`stage, pcr_cycle, temperature`), 응답 모델 필드(`UploadResponse`·`SessionInfoResponse`) | P1-A(값) · **P1-B(응답에 채움: `import_session`, `sample.get_session_info`)** | P1-D, P2-E/F/G |
| Ct 표·곡선 패널 | `UnifiedData.has_amplification_curve: bool = True`, 응답 모델 필드 | P1-A(값) · P1-B(응답) | P1-D, P2-E |
| 대립유전자 이름 가져오기 | `UnifiedData.imported_marker_alleles: dict[str, AlleleLabels]\|None` | P1-A | P1-B |
| 이름 저장·편집 | `MarkerRegion.allele_labels`, DB v11 `allele_labels_json`, save/load SQL (P0) · `MarkerUpdate`·`LayoutCreate/Apply` 필드(**P1-B**, 같은 라우터 파일 안 모델) | P1-B(API·가져오기·레이아웃) | P1-D, P2-* |
| 출력의 현재 이름 | `ResultSnapshot.marker_labels: dict[str, MarkerLabel]` — **P0 계약 아님**: `MarkerLabel`과 필드 모두 `result_snapshot.py` 안에서 P1-C1이 정의. P1-C1이 `snapshot_rows` **한 곳에서** 행의 마커 이름·대립유전자 이름을 현재 값으로 바꾼다(`marker_id` 키, 깊은 복사) | P1-C | P2-E/F/G |
| 표시 함수 | BE `snapshot_presentation.display_genotype/axis_label/cycle_label` · FE `lib/genotype.ts displayGenotype` — P0는 기존 표기 반환 | P1-C / P1-D | P2-* |
| 마커 선택 내보내기 | `routers/export_params.parse_marker_ids()` + `ExportOptions.marker_ids` + `result_snapshot.filter_snapshot()` — **P0에서 완성**(검증·적용 포함) | P0-T0.3a | P2-E/F/G, P3-I |
| 플레이트 맵(마커 배치·강조) | 기존 `render_snapshot_plate(rows)`에 키워드 인자 `marker_layout=None, highlight_marker_id=None` 추가(기존 호출 불변) | P1-C3 | P2-E, P2-F |
| 프론트 API 함수·타입 | `lib/api.ts`: `exportPptx`, `exportScatterZip`, 기존 export 함수의 `markerIds` 인자, **`updateMarker` 패치 타입에 `allele_labels`(null 허용)**; `types/api.ts`: `MarkerRegion.allele_labels`, `SavedLayout` 마커 항목, 업로드·세션 응답 새 필드(선택 필드) | P0-T0.3b | P1-D, P2-H, P3-I |
| 신규 라우트 | `routers/export_pptx.py`, `routers/export_images.py` 빈 라우터 + `main.py` 등록 | P2-F / P2-G | P3-I |
| E2E 셀렉터 | `SRC/lib/export-testids.ts` 상수 | P0-T0.3b | P3-I, P3-J |

`AlleleLabels = {"fam": str, "allele2": str}`(키 고정, 각 1–32자, 제어문자 금지).

---

## 5. 결정 게이트

| ID | 항목 | 상태 | 적용 |
|---|---|---|---|
| D-1 | 첫 화면 사이클 | 결정됨 | StepOne = Amplification 첫 읽기 |
| D-2 | 판정 표기 | 비차단 | `WT/WT · WT/MT · MT/MT`(FE·BE 상수 1곳) |
| D-3 | StepOne PDF Ct 표 | 비차단 | 생략(`has_amplification_curve=False`) |
| D-4 | PPTX 의존성 5종 | **차단 → P0-T0.3a requirements 부분, P2-F** | `python-pptx`, `lxml`, `XlsxWriter`, `Pillow`, `typing_extensions` 버전 고정 |
| D-5 | PNG 묶음 | 비차단 | 백엔드 matplotlib zip |
| D-9 | 증폭 곡선 패널 | 비차단 | 표시, x축 읽기 이름 |
| D-10 | 마커 선택 범위 | 비차단 | PDF·PPTX·PNG 묶음 |
| D-8 | 계약 활성화 | **차단 → P0-T0.1** | 사용자 승인 시 승격 |
| D-11 | 헤드리스 레인 권한 모델 | **차단 → P0-T0.1** | 권장: `acceptEdits` + 명령 허용·금지 목록(§2.3). 대안: `--dangerously-skip-permissions`(권장하지 않음) |

---

## Phase P0 — 준비와 계약 고정 (병렬: T0.2 ∥ T0.3a, 이어서 T0.3b ∥ T0.3c)

### P0-T0.1: 계약 승격과 기준선
- 담당: orchestrator · Depends On: - · Status: BLOCKED (D-8, D-11)
- 내용: 완료된 `06-tasks.md`(feedback 계약)를 `archive/06-tasks-feedback-20260911.md`로 보관, 본 초안 승격. 상태 파일은 **루트 `.claude/orchestrate-state.json`**(이전 상태 보존 사본 생성). `CLAUDE.md` Orchestration Handoff를 새 계약 기준으로 갱신(이전 기록 보존). 계약 전용 venv 구축(`bcrypt==4.0.1` 확인). baseline(BE-ALL/FE-ALL 통과 수, ruff 기준선) 기록. 신호 디렉터리·tmux 세션 생성. 사용자 승인 문구와 D-1~D-11 결정을 `evidence/P0-T0.1.md`에 기록(레인 프롬프트가 인용).
- 추가 내용: `run-lane.sh`·`lane-settings.json` 작성, `.git/info/exclude`에 `.lane/` 한 번 추가. **시험 레인 1회**(빈 worktree): 허용 시험 — `git status`, `$PYTHON -m pytest tests/test_version_endpoint.py -q`, `npx tsc --version`, `.lane/` 결과 작성, `git add <파일>`, `git commit -F` → `.done` 생성. **거부 시험** — `git push --dry-run`, `rtk git push --dry-run`, `bash -c 'echo x'`, `sudo -n true`, worktree 밖 파일 쓰기(`Write ROOT/x.txt`), `.claude/` 쓰기, `cd .. && ls`, `git status && ls`가 모두 거부되는지, `pre-push` 훅이 `git push --dry-run`을 막는지 결과 파일에 기록. 시험 브랜치는 보존하되 병합하지 않는다.
- AC: [ ] 상태 파일 해시 = 새 06-tasks.md · [ ] 이전 상태 보존 · [ ] baseline 기록 · [ ] `stepone/p0` worktree 생성 · [ ] 시험 레인: 허용 시험 전부 통과·`.done` 생성 · [ ] 거부 시험 8종 전부 거부 · [ ] `pre-push` 거부 훅 설치·기록 · [ ] 사용자 승인 원문 인용
- 증거: `evidence/P0-T0.1.md`

### P0-T0.2: 합성 `.eds` 생성기 (레인 `fixture`)
- 담당: test-specialist · Depends On: P0-T0.1 · Status: TODO · **병렬: P0-T0.3a**
- Write Scope: `BE/tests/{stepone_fixtures,quantstudio_fixtures,test_stepone_fixtures}.py`
- 내용: 실제 형식 재현 생성기(ZIP: Manifest, experiment.xml(`<Markers>`·Allele·Reporter·InstrumentTypeId), plate_setup.xml, tcprotocol.xml, multicomponent_data.txt). 옵션: 마커 배치(2열 6마커), 대립유전자 이름(전부 기본·부분 기본·사용자·미사용 마커·같은 리포터), 음수, ROX 변동, CRLF, 끝 탭, 붙은 줄, 손상 변형(읽기 수 불일치·잘림·중복·염료 누락·hold 수집). QuantStudio 합성 `.eds` 생성기도 함께(골든 테스트용).
- AC: [ ] 필드 수 분포(6/9/끝 3·4)가 실제와 같다 · [ ] 고객 값 미포함 · [ ] 생성기 자체 테스트
- 검증: BE-TEST, BE-LINT

### P0-T0.3a: 백엔드 계약 (레인 `contract`, 1/2)
- 담당: backend-specialist · Depends On: P0-T0.1 · Status: TODO (requirements 부분만 D-4) · **병렬: P0-T0.2**
- Write Scope: `APP/{models,db,db_schema,main}.py`(db_schema는 `.sql`), `APP/routers/{export_params,export_pptx,export_images}.py`(신규·빈 라우터), `APP/reporting/result_snapshot.py`(필터만), `APP/reporting/snapshot_presentation.py`(시그니처 스텁만), `BE/requirements.txt`, `BE/tests/test_contract_stepone.py`
- 내용: §4 ICV 백엔드 부분 — UnifiedData 4필드, `MarkerRegion.allele_labels`·`AlleleLabels` 검증, 응답 모델(`UploadResponse`) 새 필드(기본값), DB v11 블록(PRAGMA 확인 후 `allele_labels_json`) + `db_schema.sql` + save/load SQL + `metadata_json` 저장·복원, `ExportOptions.marker_ids`(마지막 필드·기본값)·`filter_snapshot()`·`parse_marker_ids()` 완성, 표시 함수 스텁, 신규 라우터 등록, 의존성 고정(D-4 승인 시).
- AC: [ ] 기존 동작 불변(BE-ALL 기준선 동일) · [ ] v10 DB → v11 무손상, 새 DB 스키마 일치 · [ ] 새 필드 없는 기존 세션 복원 정상, 새 필드 왕복, `read_labels` int 키 유지 · [ ] `parse_marker_ids` 검증(없는 id·중복·빈값 400)·`filter_snapshot` 동작 · [ ] 기존 `ExportOptions(...)` 위치 인자 호출(`data.py`, `export.py`) 불변 · [ ] 이 태스크 테스트는 P0-T0.2 생성기에 의존하지 않음
- 검증: BE-TEST, BE-ALL, BE-LINT

### P0-T0.3b: 프론트 계약 (레인 `contract`, 2/2)
- 담당: frontend-specialist · Depends On: P0-T0.3a · Status: TODO · **병렬: P0-T0.3c**
- Write Scope: `SRC/types/api.ts`, `SRC/lib/api.ts`, `SRC/lib/export-testids.ts`(신규), `SRC/lib/genotype.ts`(시그니처 스텁만), 계약 테스트
- 내용: 백엔드 계약을 그대로 옮긴 타입. **응답 새 필드는 모두 선택(`?:`)** 이라 기존 테스트 리터럴(`session-entry.test.ts`, `App.restore.test.tsx` 등)이 깨지지 않는다. `MarkerRegion.allele_labels?`, 레이아웃 마커 항목, `updateMarker` 패치 타입에 `allele_labels`(null 허용), `exportPptx`·`exportScatterZip`·기존 export 함수 `markerIds` 인자, 테스트 ID 상수, `displayGenotype` 스텁(기존 표기 반환).
- AC: [ ] FE-CHECK·FE-ALL 기준선 동일 · [ ] 타입이 P0-T0.3a 응답 모델과 일치(계약 테스트)
- 검증: FE-TEST, FE-ALL, FE-CHECK

### P0-T0.3c: i18n 키 (레인 `i18n`, haiku)
- 담당: frontend-specialist · Depends On: P0-T0.3a · Status: TODO · **병렬: P0-T0.3b**
- Write Scope: `SRC/locales/{en,ko}.ts`
- 내용: 이후 레인이 쓸 키를 접두사별 블록(`markerAllele.*`, `stepone.*`, `genotypeDisplay.*`, `exportReport.*`)으로 미리 만든다(문구 초안). 키 목록은 기획서 §3에서 뽑아 결과 파일에 표로 남긴다.
- AC: [ ] en/ko 키 집합 일치(기존 locale 일치 테스트 통과) · [ ] FE-CHECK
- 검증: FE-ALL, FE-CHECK

### P0-S0-V: 준비 게이트
- 담당: test-specialist(+ 오케스트레이터 직접 단계) · Depends On: P0-T0.2, P0-T0.3b, P0-T0.3c · Status: TODO
- 내용: 레인 병합(fixture → contract → i18n) 후 LANE-MERGE, 소유표 대조. **오케스트레이터가 계약 venv를 새 `requirements.txt`로 다시 설치**(레인은 `pip install` 금지)하고 DEP-AUDIT 1차 실행. `main` 로컬 병합.
- AC: [ ] LANE-MERGE 통과 · [ ] 공유 파일 변경이 P0-T0.3a/b/c에만 있음 · [ ] venv에서 `import pptx, xlsxwriter, lxml` 성공(D-4 승인 시) · [ ] DEP-AUDIT 결과 기록

---

## Phase P1 — 핵심 구현 (병렬 4 레인)

레인 병합 순서: A(A1→A2) → B(B1→B2) → C(C1→C2→C3) → D(D1→D2)

### P1-A1: QuantStudio 골든 테스트와 `eds_common` 분리 (레인 `parser`, 1/2)
- 담당: backend-specialist · Depends On: P0-S0-V · Status: TODO
- Write Scope: `APP/parsers/{eds_common,eds_raw}.py`, `BE/tests/test_eds_quantstudio_golden.py`
- 내용: QuantStudio 합성 `.eds`로 `parse_eds` 골든 테스트(현행 고정) → 공용 함수 이전 → `eds_raw` 재노출.
- AC: [ ] 골든 테스트 전후 동일 · [ ] 기존 import 유지 · [ ] 순환 import 없음
- 검증: BE-TEST, BE-ALL, BE-LINT

### P1-A2: StepOne 파서와 신규 필드 값 (레인 `parser`, 2/2)
- 담당: backend-specialist · Depends On: P1-A1 · Status: TODO
- Write Scope: `APP/parsers/{stepone_eds,eds_raw,detector}.py`(eds_raw는 분기만), `APP/processing/ntc_detection.py`, `BE/tests/{test_stepone_eds,test_stepone_session_restore,test_stepone_real_file}.py`
- 내용: 기획서 §3.1 2–5. 응답 노출은 P1-B 몫이므로 이 태스크는 `UnifiedData` 값과 `compute_suggested_cycle`(이미 `sample.py`·`import_session.py`가 호출)만 다룬다.
- AC
  - [ ] 레코드·붙은 줄·끝 요약(3/4필드)·CRLF, 신호값 = `f[4]` 고정 테스트, 줄 수 상한
  - [ ] 구간 Pre-read 1 / Amplification 2–6 / Post-read 7, `read_labels[2] == (6, 36, 40.0)`
  - [ ] 반복×수집단계, 수집 없는 단계 0, 불일치·hold 수집·48웰은 오류(경로 미노출)
  - [ ] 마커 6개·샘플명·웰 ID, 음수 보존
  - [ ] QPrism1 → `{fam: "WT", allele2: "MT"}`, 기본값 마커 없음, 부분 기본값은 파일 값, 미사용 마커 제외, 같은/지원 외 리포터 건너뜀
  - [ ] 업로드 응답과 **세션 재시작 복원 후** `suggested_cycle == 2` (기존 `sample.py` 호출 경로로 확인), `default_cycle ∉ cycles`이면 무시
  - [ ] QuantStudio·CFX 제안 사이클 불변, `/api/upload` 합성 파일 성공, 7개 사이클 각각 scatter API 정상
- 검증: BE-TEST, BE-ALL, BE-LINT, REAL-EDS

### P1-B1: 마커 이름 API·레이아웃·카탈로그 (레인 `marker-api`, 1/2)
- 담당: backend-specialist · Depends On: P0-S0-V · Status: TODO
- Write Scope: `APP/routers/{clustering,layouts,marker_catalog}.py`, `BE/tests/test_marker_allele_labels_api.py`
- 내용: `MarkerUpdate`·`LayoutCreate/Apply`에 `allele_labels`, GET/POST/PUT 반영(부분 갱신·명시 null 해제), 레이아웃 저장/적용(`model_dump` 경유 확인), 카탈로그 연결 시 빈 이름만 `allele1_base/allele2_base`로 미리 채움.
- AC: [ ] 이름 변경은 판정 입력(`judgment_key`) 불변 — 재분석 불요 테스트 · [ ] PUT 왕복·null 해제 · [ ] 레이아웃 적용 시 이름 전달 · [ ] 잘못된 키·길이 400
- 검증: BE-TEST, BE-ALL, BE-LINT

### P1-B2: 가져오기·응답 필드·복원 (레인 `marker-api`, 2/2)
- 담당: backend-specialist · Depends On: P1-B1 · Status: TODO
- Write Scope: `APP/routers/{sample,upload,import_api}.py`, `APP/services/{import_session,session_restore}.py`, `BE/tests/test_stepone_response_fields.py`
- 내용: 업로드 시 `imported_marker_alleles` → `MarkerRegion.allele_labels`(합성 UnifiedData로 테스트, 파서 레인과 독립). 업로드 응답·`get_session_info`(dict) 응답에 `read_labels`·`has_amplification_curve`·`default_cycle`. 모든 업로드 진입점(`/api/upload`, import 미리보기 경로)이 `import_session`을 거치는지 확인 기록.
- AC: [ ] 업로드·세션 정보 응답에 세 필드, 재시작 복원 후에도 · [ ] 응답이 `types/api.ts` 타입과 일치(계약 테스트) · [ ] 복원 시 `allele_labels` 유지
- 검증: BE-TEST, BE-ALL, BE-LINT

### P1-C1: 현재 이름 스냅샷과 표시 함수 (레인 `report-core`, 1/3)
- 담당: backend-specialist · Depends On: P0-S0-V · Status: TODO
- Write Scope: `APP/reporting/{result_snapshot,snapshot_presentation}.py`, `BE/tests/test_export_presentation.py`
- 내용: `MarkerLabel` 모델과 `ResultSnapshot.marker_labels`를 이 파일에 정의한다. `capture_result_snapshot`이 `input_lock` 아래 `marker_store`(함수 안 `from app.routers.clustering import marker_store`, `clustering.py` 수정 없음)를 `marker_id` 키로 깊은 복사해 `marker_labels`로 담고, `snapshot_rows`에서 행의 마커 이름·대립유전자 이름을 현재 값으로 바꾼다(한 곳). 이때 `report_figures`·판정 수 등 **마커 비교는 객체 동등성이 아니라 `marker_id`로** 바꾸고, 그림 제목은 `marker_labels`의 현재 이름을 쓴다(`snapshot_presentation.py` 같은 레인 소유). 표시 함수: 판정 표기(D-2), 고배체 범례, 축 라벨 `FAM · WT (ROX 정규화)`, 사이클 라벨 `Amplification 1/5 · PCR 36 · 40°C`.
- AC: [ ] 분석 뒤 이름 변경 → **기존 CSV 출력 텍스트**에 새 이름(라우트 수정 없이) · [ ] 이름 변경 후에도 `report_figures`가 마커별 점을 그대로 가짐(빈 그림 0) · [ ] 정규 판정 문자열 불변(ASG 계약 테스트 통과) · [ ] 이름 없는 런 표 구조 불변
- 검증: BE-TEST, BE-ALL, BE-LINT

### P1-C2: scatter 그림 가독성 (레인 `report-core`, 2/3)
- 담당: backend-specialist · Depends On: P1-C1 · Status: TODO
- Write Scope: `APP/reporting/charts.py`, `APP/reporting/fonts/**`, `BE/tests/test_chart_readability.py`
- 내용: `render_scatter_png` — 제목(마커·사이클), 이름 붙은 축, 범례(표시 이름 + n, 그림 밖), 48웰 이하 웰 라벨, NanumGothic 등록, 종횡비 인자(4:3/1:1). 색은 정규 문자열로 조회.
- AC: [ ] 제목·축·범례 문자열·웰 라벨 존재(matplotlib 객체 검사) · [ ] 한글 이름 렌더 시 글리프 누락 경고 0 · [ ] 종횡비 인자 반영
- 검증: BE-TEST, BE-ALL, BE-LINT

### P1-C3: 플레이트 맵 마커 배치와 안전 파일명 (레인 `report-core`, 3/3)
- 담당: backend-specialist · Depends On: P1-C2 · Status: TODO
- Write Scope: `APP/reporting/{snapshot_plate,filenames}.py`, `BE/tests/{test_plate_marker_layout,test_safe_filenames}.py`
- 내용: 기존 `render_snapshot_plate(rows)`에 키워드 인자 `marker_layout=None, highlight_marker_id=None` 추가 — 마커 경계·약칭 + 판정 색, 강조 모드. 기존 호출 결과 불변. `filenames.py`: 안전 파일명(경로 구분자·`..`·제어문자·NUL 제거, 중복 번호, 길이 상한), RFC 5987 `Content-Disposition` 헬퍼.
- AC: [ ] 6마커 맵에 약칭 6개 · [ ] 강조 모드는 해당 마커 웰만 진하게 · [ ] 파일명 공격 문자열 표 테스트
- 검증: BE-TEST, BE-ALL, BE-LINT

### P1-D1: 표시 함수와 플레이트 설정 화면 (레인 `fe-marker`, 1/2)
- 담당: frontend-specialist · Depends On: P0-S0-V · Status: TODO
- Write Scope: `SRC/lib/genotype.ts`, `SRC/lib/upload-response.ts`(새 선택 필드의 가벼운 형태 검사), `SRC/components/analysis/PlateSetupTab.tsx`, `SRC/hooks/use-marker-scope*`, 각 테스트, `SRC/locales/{en,ko}.ts`의 `markerAllele.*` 키 문구
- 내용: 백엔드 응답은 P0 계약 타입으로 모킹(레인 독립). `lib/genotype.ts` 표시 함수(단일 진실 원천, D-2), `PlateSetupTab` 마커별 FAM 쪽 / VIC·HEX 쪽 이름 입력(한 줄 2열)·저장(`updateMarker`), 가져온 이름 표시.
- AC: [ ] 이름 입력·저장·null 해제 · [ ] 가져온 이름 표시 · [ ] 키보드 접근성 · [ ] 이름 없으면 기존 표기 · [ ] 고배체 표기
- 검증: FE-TEST, FE-ALL, FE-CHECK

### P1-D2: scatter·사이클·곡선 (레인 `fe-marker`, 2/2)
- 담당: frontend-specialist · Depends On: P1-D1 · Status: TODO
- Write Scope: `SRC/lib/{chart-semantics,scatter-axes}.ts`, `SRC/components/analysis/{MarkerScatterPlot,ScatterPlot,MultiMarkerAnalysisPanel,CycleControl,AmplificationCurvePanel}.tsx`, 각 테스트, `SRC/locales/{en,ko}.ts`의 `stepone.*` 키 문구
- 내용: scatter 축·범례 이름, `CycleControl`에 PCR 번호·온도(`read_labels`), `AmplificationCurvePanel` x축 읽기 이름(`has_amplification_curve=false`, D-9), PNG 캡션에 마커·이름·사이클 라벨.
- AC: [ ] 축 `FAM · WT` / `VIC · MT` · [ ] 범례 표시 이름 · [ ] 화면에 Ct 값 표시가 있으면 `has_amplification_curve=false`일 때 숨김(없으면 결과 파일에 "해당 없음" 기록) · [ ] 첫 화면 사이클 2에서 "1/5 · PCR 36 · 40°C" · [ ] 곡선 x축 읽기 이름 · [ ] PNG 캡션
- 검증: FE-TEST, FE-ALL, FE-CHECK

### P1-S0-V: 핵심 게이트
- 담당: test-specialist · Depends On: P1-A2, P1-B2, P1-C3, P1-D2 · Status: TODO
- 내용: 레인 병합 후 LANE-MERGE, **오케스트레이터가 서버를 띄우고 직접**(레인 아님, `curl`은 레인 금지) 실제 백엔드로 연결 스모크(합성 파일 업로드 → 마커 6개·이름 → 이름 수정 → 마커 전환 → 스냅샷에 새 이름), 보안 리뷰(파서 입력 상한·ZIP·오류 메시지), `main` 로컬 병합.
- AC: [ ] LANE-MERGE 통과 · [ ] 스모크 통과 · [ ] 마커 E2E(17, 21, 28) 회귀 0 · [ ] 미해결 중요 리뷰 0

---

## Phase P2 — 출력·화면 확장 (병렬 4 레인)

레인 병합 순서: E(E1→E2) → F → G → H(H1→H2)

### P2-E1: PDF (레인 `report-docs`, 1/2)
- 담당: backend-specialist · Depends On: P1-S0-V · Status: TODO
- Write Scope: `APP/reporting/snapshot_pdf.py`, `APP/routers/data.py`(PDF 라우트), `BE/tests/test_export_pdf_markers.py`
- 내용: PDF 마커별 페이지(P1-C2 그림 + 그 마커 판정 수 + P1-C3 강조 맵), `Allele Call` 열(`_column_sections` 화이트리스트 포함), 전체 플레이트 맵(마커 배치), Ct 표 생략(D-3), PDF `marker_ids`(D-10, `parse_marker_ids`·`filter_snapshot`), 안전 파일명(P1-C3).
- AC: [ ] PDF 텍스트에 마커 6개·MT/WT·한글 · [ ] 이름 없는 런 PDF 구조 불변 · [ ] 마커 1개 선택 PDF는 그 마커만 · [ ] 조건 불일치 409 유지 · [ ] StepOne 런 Ct 절 없음
- 검증: BE-TEST, BE-ALL, BE-LINT, EXPORT-INSPECT

### P2-E2: CSV·XLSX·QC (레인 `report-docs`, 2/2)
- 담당: backend-specialist · Depends On: P2-E1 · Status: TODO
- Write Scope: `APP/reporting/snapshot_xlsx.py`, `APP/routers/{export,qc}.py`, `BE/tests/test_export_allele_labels.py`
- 내용: `Allele Call`·사이클 라벨 열, XLSX Summary 그림(P1-C2), QC 표시 이름, 안전 파일명.
- AC: [ ] XLSX/CSV `Allele Call`, `Genotype` 정규 유지 · [ ] 이름 없는 런 출력 불변 · [ ] CSV 수식 주입 방지 유지
- 검증: BE-TEST, BE-ALL, BE-LINT, EXPORT-INSPECT

### P2-F: PPTX 출력 (레인 `report-pptx`)
- 담당: backend-specialist · Depends On: P1-S0-V · Status: BLOCKED (D-4)
- Write Scope: `APP/reporting/snapshot_pptx.py`, `APP/routers/export_pptx.py`, `BE/tests/test_export_pptx.py`
- 내용: 기획서 §3.3 PPTX. 마커 선택은 `parse_marker_ids`·`filter_snapshot`, 그림은 P1-C2 `render_scatter_png`, 맵은 P1-C3 `snapshot_plate.render_snapshot_plate(..., highlight_marker_id=...)`(강조 모드; `charts.render_plate_png`와 다른 함수). 결과표 열은 웰·샘플·마커·`Allele Call`·신뢰도(이름 없는 마커는 정규 판정 문자열을 그대로 표시).
- AC: [ ] 슬라이드 수 = 1 + 마커 수 + 1 + 결과표 장수(3단×16행=48웰/장) · [ ] 결과표 제외 옵션 · [ ] 조건 불일치 409 · [ ] 한글 글꼴 `latin`·`ea` 지정 · [ ] 마커 선택 (DEP-AUDIT는 P2-S0-V에서 오케스트레이터가 실행)
- 검증: BE-TEST, BE-ALL, BE-LINT, EXPORT-INSPECT

### P2-G: 보고서 PNG 묶음 (레인 `report-images`)
- 담당: backend-specialist · Depends On: P1-S0-V · Status: TODO
- Write Scope: `APP/reporting/snapshot_images.py`, `APP/routers/export_images.py`, `BE/tests/test_export_scatter_zip.py`
- AC: [ ] PNG 수 = 선택 마커 수 · [ ] 항목명 안전 처리(경로 구분자·`..`·제어문자·NUL·중복·길이) · [ ] 고정 타임스탬프·외부 속성 없음 · [ ] PDF와 같은 렌더 함수 · [ ] 조건 검사 · [ ] zip 크기 상한
- 검증: BE-TEST, BE-ALL, BE-LINT, EXPORT-INSPECT

### P2-H1: 결과표·상세·플레이트 (레인 `fe-tables`, 1/2)
- 담당: frontend-specialist · Depends On: P1-S0-V · Status: TODO
- Write Scope: `SRC/components/analysis/{ResultsTable,WellDetailPanel,PlateView,PlateLegend,WellTypePopup}.tsx`, `SRC/components/analysis/MultiMarkerAnalysisPanel.tsx`(**prop 전달 부분만**, P1에서 P1-D2 소유였고 P2에서 이 태스크로 이관), 각 테스트, `SRC/locales/{en,ko}.ts`의 `genotypeDisplay.*` 키 문구
- 내용: 받는 컴포넌트에 `alleleLabels` prop을 추가하고 `MultiMarkerAnalysisPanel`에서 선택 마커의 값을 넘긴다, 판정 표시 이름, 플레이트 범례 이름, 분석 화면 플레이트에서 마커 미지정 웰 회색·개수 안내.
- AC: [ ] 판정 표시 이름 · [ ] 플레이트 범례 이름 · [ ] 미지정 웰 표시 · [ ] 이름 없으면 기존 표기
- 검증: FE-TEST, FE-ALL, FE-CHECK

### P2-H2: 통계·Batch·보조 화면 (레인 `fe-tables`, 2/2)
- 담당: frontend-specialist · Depends On: P2-H1 · Status: TODO
- Write Scope: `SRC/components/analysis/{FluorescenceDataCard,AmplificationOverlay}.tsx`, `SRC/components/statistics/StatisticsTab.tsx`, `SRC/components/batch/{BatchTab.tsx,project-export.ts,project-summary.ts}`, `SRC/components/shared/KeyboardHelpOverlay.tsx`, 각 테스트
- AC: [ ] 판정 표시 지점 전수(grep 목록 = P2-H1+H2+P1-D 수정 목록, 증거에 기록. `lib/constants.ts`·`processing/*`의 정규 문자열은 대상 아님) · [ ] Batch 요약 CSV 정규 열 유지 + 표시 열
- 검증: FE-TEST, FE-ALL, FE-CHECK

### P2-S0-V: 출력 게이트
- 담당: test-specialist + security-specialist · Depends On: P2-E2, P2-F, P2-G, P2-H2 · Status: TODO
- 내용: 레인 병합(E→F→G→H) 후 LANE-MERGE, 합성 6마커 파일로 PDF·PPTX·XLSX·CSV·zip 생성·EXPORT-INSPECT, 마커 선택이 세 출력에서 같은 규칙인지 교차 확인, 보안 리뷰(파일명·zip·의존성·Content-Disposition), **오케스트레이터가 DEP-AUDIT 2차 실행**, `main` 로컬 병합.
- AC: [ ] 기존 출력 테스트 회귀 0 · [ ] 세 출력 그림이 같은 렌더 경로 · [ ] 미해결 중요 리뷰 0

---

## Phase P3 — 연결·검증·문서 (병렬 3 레인)

레인 병합 순서: I → J → K

### P3-I: 내보내기 메뉴 (레인 `fe-export`)
- 담당: frontend-specialist · Depends On: P2-S0-V · Status: TODO
- Write Scope: `SRC/components/layout/Header.tsx`, `SRC/hooks/use-exports.ts`(+테스트), `SRC/locales/{en,ko}.ts`의 `exportReport.*` 키 문구
- AC: [ ] PPTX·보고서 PNG 묶음·마커 선택 메뉴, "현재 화면 이미지"와 구분된 이름 · [ ] `ExportKind`·`exportStored` 확장, 조건 불일치 재시도에 마커 선택 유지 · [ ] 테스트 ID는 `export-testids.ts` 상수 · [ ] ko/en
- 검증: FE-TEST, FE-ALL, FE-CHECK

### P3-J: 끝단 E2E (레인 `e2e`)
- 담당: test-specialist · Depends On: P2-S0-V · Status: TODO
- Write Scope: `E2E/29-stepone-markers.spec.ts`, `E2E/30-stepone-exports.spec.ts`, `E2E/fixtures/stepone/**`(합성 생성물)
- 실행 전 오케스트레이터가 P3 API·프론트 서버를 띄운다(레인은 서버를 띄우지 않음).
- 내용: 29 = 업로드 → 첫 화면 사이클 2(PCR 36) → 마커 6개 → 이름 수정 → 마커 전환 → 결과표(P2까지 병합된 main으로 레인 안에서 통과). 30 = `export-testids.ts` 셀렉터로 PDF·PPTX·zip 다운로드 검사(레인 안에서는 작성·정적 검사, 실행은 게이트에서 P3-I 병합 후).
- AC: [ ] 29 레인 안에서 통과 · [ ] 30 게이트에서 통과
- 검증: ROOT-E2E

### P3-K: 문서·버전 (레인 `docs`, haiku)
- 담당: docs-specialist · Depends On: P2-S0-V · Status: TODO
- Write Scope: `README.md`, `FE/package.json`(버전만), `APP/version.py`(버전만), `docs/release-notes/v1.4.0.md`
- AC: [ ] 지원 장비에 StepOnePlus · [ ] ROX 자동 안내 · [ ] 마커 이름·PPTX·PNG 묶음 사용법 · [ ] 버전 1.4.0(`APP/version.py`·`FE/package.json` 동시, 버전 테스트 통과)

### P3-S0-V: 통합 게이트
- 담당: test-specialist · Depends On: P3-I, P3-J, P3-K · Status: TODO
- AC: [ ] LANE-MERGE · [ ] ROOT-E2E 전체(기존 실패는 기준선과 분리) · [ ] 뷰포트 4종 × 라이트/다크 · [ ] `main` 로컬 병합

## Phase P4 — 인수 (직렬)

### P4-S0-V: 실파일 인수
- 담당: test-specialist · Depends On: P3-S0-V · Status: TODO
- 내용: 실제 파일(저장소 밖)로 업로드 → 첫 화면 사이클 2(PCR 36) → 마커 6개 → QPrism1 MT/WT → 이름 수정 → PDF·PPTX·PNG 묶음(전체·마커 1개) 생성. 렌더 스크린샷을 저장소 밖 경로에 두고 경로만 증거에 기록.
- AC: [ ] 기획서 §5 전부 · [ ] BE-ALL·FE-ALL·ROOT-E2E 통과 · [ ] 미해결 중요 리뷰 0 · [ ] 사용자에게 산출물 확인 요청

---

## 6. 태스크 요약 (DAG)

```
P0-T0.1 ─┬─ P0-T0.2 (fixture) ─────────────────────────┐
         └─ P0-T0.3a (contract) ─┬─ P0-T0.3b (contract) ─┤
                                 └─ P0-T0.3c (i18n) ─────┴─ P0-S0-V
P0-S0-V ─┬─ P1-A1 → P1-A2         (parser)      ─┐
         ├─ P1-B1 → P1-B2         (marker-api)  ─┤
         ├─ P1-C1 → P1-C2 → P1-C3 (report-core) ─┤
         └─ P1-D1 → P1-D2         (fe-marker)   ─┴─ P1-S0-V
P1-S0-V ─┬─ P2-E1 → P2-E2 (report-docs)  ─┐
         ├─ P2-F          (report-pptx)  ─┤
         ├─ P2-G          (report-images)─┤
         └─ P2-H1 → P2-H2 (fe-tables)    ─┴─ P2-S0-V
P2-S0-V ─┬─ P3-I fe-export ─┐
         ├─ P3-J e2e ───────┤
         └─ P3-K docs ──────┴─ P3-S0-V ─ P4-S0-V
```
총 30태스크(구현·준비 25 · 게이트 5), 레인 14개. 최대 동시 4. 임계 경로 13단계(r2 직렬 21단계).
즉시 실행 가능: 없음(D-8·D-11 승인 필요). P2-F와 P0-T0.3a requirements 부분은 D-4 승인 필요.
