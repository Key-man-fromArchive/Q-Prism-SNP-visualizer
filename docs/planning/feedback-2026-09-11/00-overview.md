# 사용자 피드백 대응 기획 — 2026-09-11

수집 출처: 프로덕션 `user_feedback` 테이블 (SQLite, `asg-saas-v2-snp-analyzer-1:/app/data/snp_analyzer.db`)
조회 시각: 2026-09-11 / 상태 `open` 7건, `in_progress` 0건
제출자: service@invirustech.com (전량 동일 세션 `23cf12a845cc`, CFX Opus raw, 96웰 6사이클, ko, 1920x911)
스크린샷 원본: `feedback-shots/{feedback_id[:8]}-{attachment_id[:6]}.png` (7장)

## 1. 피드백 인벤토리

| # | ID | 카테고리 | 제목 요약 | 복잡도 | 기획문서 |
|---|----|----------|-----------|--------|----------|
| 1 | `35424285daff410a` | bug | 상단에 `ad_hoc 1` 노출 | Simple | [FB-01](FB-01-linked-context-label.md) |
| 2 | `0de8fb3361884951` | bug | 멀티 업로드 진입점 위치 + 브랜딩 부재 | Complex | [FB-02](FB-02-upload-entry-and-brand.md) |
| 3 | `2d1ca7ee9f444564` | improvement | 분석 화면이 과밀 · 텍스트 과다 | Complex | [FB-03](FB-03-analysis-density.md) |
| 4 | `7ec0ec1e5e8a4870` | improvement | 대립유전자 판별 플롯이 낮음 · 정규화/축설정 접근성 | Complex | [FB-04](FB-04-scatter-ergonomics.md) |
| 5 | `18b3fcc92f4f442c` | feature | 프로토콜 시각화 + 판독 채널 표시 | Complex | [FB-05](FB-05-protocol-visualization.md) |
| 6 | `f127b261f35a49e8` | feature | 증폭 오버레이를 Raw data 탭으로 · 탭 개명 | Complex | [FB-06](FB-06-rawdata-tab.md) |
| 7 | `36be23963de2477d` | improvement | 정보구조(탭 명칭·순서) + 컬러 + 제품명 | Complex | [FB-07](FB-07-identity-and-ia.md) |

## 2. 한 줄 진단

7건은 개별 버그가 아니라 **하나의 제품 정체성/정보구조 문제**가 7개 표면으로 드러난 것이다.

- 제품은 `ASG-PCR SNP 판별 분석기`라는 **내부 프로젝트명**으로 자기를 소개하고 (`locales/*.ts:139-141`, `index.html:12`),
- 상단에는 ASG 연동용 **내부 식별자**(`ad_hoc`/`1`)를 그대로 노출하며 (`Header.tsx:22-37`),
- 탭 이름은 데이터 구조(`프로토콜`, `분석`)를 따르지 실험자의 작업 순서(플레이트 → 원시데이터 → 결과)를 따르지 않고,
- 화면은 "무엇을 계산했는가"(경고·요약·상태 텍스트)를 "무엇이 나왔는가"(산점도·유전형)보다 크게 그린다.

따라서 FB-01~07은 **공통 선행 작업(브랜드 토큰 + 정보구조)** 위에 개별 화면 작업이 얹히는 구조로 계획한다.

## 3. 의존 관계 및 단계 제안 (멀티 AI 리뷰 후 수정됨)

```
Phase A — 저위험 선행
  A1  FB-01  연동 컨텍스트 라벨 정상화 (ad_hoc/target_id 노출 제거)    독립, 즉시 착수 가능

Phase B — 안정된 탭 ID 위에서 콘텐츠 먼저
  B1  FB-05  ProtocolStep 모델 확장 + 열순환 프로파일 + 채널 카드
  B2  FB-06  증폭 오버레이 Raw data 화면 배치 + 응답 계약 에코 추가
      (B1/B2는 현행 `protocol` 탭 ID 위에서 수행 — IA 변경 전에 내용을 완성한다)

Phase C — 정보구조
  C1  FB-07  탭 ID/라벨/순서 재편, WorkspaceTabs 흡수, legacy URL 매핑

Phase D — 결과 화면 (단일 커밋)
  D1  FB-04 + FB-03  산점도 종횡비·컨트롤 승격 + 결과 중심 레이아웃
      두 문서가 같은 `.analysis-grid` / `.analysis-scatter-canvas`를 바꾸므로 분리 불가

Phase E — 진입점 및 브랜드
  E1  FB-02(3-1/3-2)  드로어 패널 상시 마운트 + 트리거 재배치 + 업로드 경로 정리
  E2  FB-07(3-3/3-4) + FB-02(3-3/3-4)  팔레트 단일화 + 브랜드 에셋   [D-1~D-4 확정 후]
```

권장 착수 순서: **A1 → B1 → B2 → C1 → D1 → E1 → E2**

### 초안 대비 변경점 (리뷰 반영)

1. **브랜드(A1 구 계획)가 다른 작업의 선행 조건이 아니다.** 산점도 크기·정보밀도 작업은 팔레트 결정과 무관하게 진행 가능하다.
   초안의 `A1 → C1/C2` 의존은 존재하지 않는다.
2. **IA 변경을 콘텐츠보다 뒤로 옮겼다.** 탭 ID가 흔들리는 상태에서 FB-05/06 콘텐츠를 만들면 두 번 고치게 된다.
   안정된 `protocol` ID 위에서 내용을 완성한 뒤 IA를 바꾼다.
3. **FB-03과 FB-04를 한 단계로 합쳤다.** 두 문서가 같은 CSS 규칙과 같은 그리드를 건드린다.
4. **FB-02를 진입점(E1)과 브랜드(E2)로 분리했다.** 진입점 작업은 에셋 없이 가능하고, 실제로는
   드로어 상태 소유권 리팩터링이라 브랜드와 성격이 다르다.

## 4. 사용자 결정이 필요한 항목 (구현 전 확정 필수)

| ID | 항목 | 현재 상태 | 왜 개발자가 정할 수 없는가 |
|----|------|-----------|---------------------------|
| ~~D-1~~ | ~~제품 정식 명칭~~ | **해결 (2026-09-11)** — `Q-Prism® Cluster Caller` 채택. `Q-Prism`은 인바이러스테크 자사 저작물이므로 `®` 사용 가능 | — |
| D-2 | Q-Prism 브랜드 팔레트 실체 | **코드베이스에 존재하지 않음.** `index.css:4-22`는 범용 파랑 `#2563eb` | "Q-Prism 컬러"의 정의(HEX/가이드)가 리포지토리에 없음 |
| D-3 | 로고/아트 에셋 | **존재하지 않음.** `frontend/public/`에 템플릿 CSV 3개뿐, 파비콘도 없음 | 에셋 제공 또는 제작 승인 필요 |
| D-4 | 채널 색상 고정 여부 | `--color-fam`/`--color-allele2`가 파랑/빨강 | 브랜드 컬러 변경 시 과학적 관례(FAM=파랑, HEX=초록/빨강)와 충돌 가능 |
| D-5 | 기존 E2E/시각 회귀 기준 | Playwright 스펙이 한국어 탭 라벨에 의존 | 탭 ID 전면 변경은 테스트 대량 수정 유발 — 범위 승인 필요 (리뷰 결과 라벨만 변경으로는 요구 충족 불가) |
| D-6 | 산점도 목표 종횡비 | 현재 약 3:1 (결함) | 정사각(폭 640px, 여백 300px) vs 4:3(폭 853px, 여백 87px) — 미관·가독성 trade-off |
| D-7 | 업로드 경로 이원화 | `UploadZone`과 `FileWorkspaceDrawer` 둘 다 멀티 업로드 지원, 구현·한도 상이 | 통합할지 역할 분리 후 한도/문구만 일치시킬지 |

> **D-2/D-3이 확정되기 전에는 브랜딩 구현(팔레트·에셋)을 시작할 수 없다.**
> 그 전까지는 색을 한 곳으로 모으는 리팩터링(값 불변)만 선행한다 — 작업서 `P0-T0.2`.
>
> **제품명(D-1)은 해결되었으므로 명칭 통일 작업(`P6-S1-T1`)은 팔레트·에셋과 무관하게 실행 가능하다.**

## 5. 공통 회귀 리스크

1. **i18n 이중 갱신** — `locales/en.ts`와 `ko.ts`는 `Translations` 타입으로 키가 강제 동기화된다(`use-i18n.ts:4`, `en.ts` 말미의 매핑 타입). 한쪽만 고치면 타입 에러.
2. **테스트 셀렉터 결합** — 컴포넌트가 `data-testid`/`id`로 광범위하게 테스트된다(예: `scatter-view-controls`, `workspace-tab-plate`, `tab-protocol`). 구조 변경 시 프론트 단위 테스트 + 루트 Playwright 스펙 동시 수정 필요.
3. **다크 모드 이원화** — 색은 `@theme` 블록과 `body.dark` 블록 양쪽에 정의된다(`index.css:3-46`). 한쪽만 바꾸면 다크 모드가 깨진다.
4. **Plotly 테마 분기** — 차트 색은 CSS 토큰이 아니라 `lib/plotly-theme.ts`에 HEX로 하드코딩되어 있다. 팔레트 변경 시 이 파일도 함께 바뀌어야 시각적으로 일관된다.
5. **레이아웃 CSS 집중** — 분석 화면 크기 규칙 대부분이 `index.css` 하단 미디어쿼리에 모여 있다(`.analysis-grid`, `.analysis-scatter-canvas`, `.analysis-review-stack`). 컴포넌트 내 Tailwind만 고치면 1280px 이상에서 되돌려진다.
6. **위치 상태는 스토어가 아니라 URL에 있다** — `navigation-store`는 persist하지 않는다. 탭/표면 위치는 `lib/workspace-history.ts`가 URL에, `session-store.sessionQueries`가 `sessionStorage`에 기록한다. 탭 ID를 바꾸면 **북마크·저장된 쿼리 문자열**이 영향받는다.
7. **드로어 큐는 컴포넌트 지역 상태다** — `FileWorkspaceDrawer`의 `useState<QueueItem[]>`. 조건부 마운트/언마운트하면 진행 중인 업로드 큐가 소실된다.
8. **색이 다섯 군데에 흩어져 있다** — `index.css`(@theme + body.dark), `lib/plotly-theme.ts`, `lib/constants.ts`, `lib/genotype.ts`, `components/protocol/ProtocolTab.tsx`, 그리고 `app/reporting/pdf_builder.py`. 팔레트 변경은 이 전부를 건드린다.
9. **`ProtocolStep`은 ASG 결과 저장 payload에도 실린다** (`app/asg_result.py`) — 모델 확장이 외부 시스템 계약에 닿는 유일한 변경이다.

## 6. 검증 게이트 (전 작업 공통)

- `cd snp-analyzer/frontend && npx tsc --noEmit && npm run lint && npm test`
- `cd snp-analyzer && pytest` (백엔드 계약 변경이 있는 FB-05에 한정하여 필수)
- `npx playwright test` (루트, 포트 8002 기동 후)
- 재배포 시 `docker compose build --no-cache frontend` — 캐시 빌드는 낡은 번들을 배포한다
- 1920x911(피드백 제출 뷰포트) 및 1280px 경계에서 육안 확인

---

## 7. 멀티 AI 리뷰 기록 (2026-09-11)

| 리뷰어 | 역할 | 전체 판정 |
|--------|------|-----------|
| **Codex CLI** (앵커) | 보안/로직/아키텍처, 코드 대조 검증 | **63/100 — 수정 후 구현 가능** (초안 기준) |
| **Gemini CLI** | 프론트엔드/UX/정보구조 | 88~95/100 (동의 우세) |
| **Sonnet — FrontendAnalyst** | 프론트 코드 대조 | 70~95/100, 사실오류 2건 발견 |
| **Sonnet — BackendAnalyst** | 백엔드/데이터모델 대조 | 55~92/100, 사실오류 1건 + 누락 3건 발견 |
| Claude (의장) | 증거 재검증 및 반영 | 전 지적을 코드로 재확인 후 반영 |

리뷰 점수 격차(FB-02: Codex 35 vs Gemini 90, FB-06: 42 vs 91, FB-01: Backend 55 vs Frontend 95)가 컸으므로
의장이 **모든 쟁점을 직접 코드로 재검증**했다. 결과: **Codex와 두 Sonnet의 사실 지적이 전부 정확했다.**
Gemini는 문서 내부 논리는 평가했으나 코드 대조 검증을 FB-04의 CSS 항목 외에는 수행하지 않아,
사실오류를 하나도 잡아내지 못했다 — 이번 라운드에서 가장 신호가 약했다.

두 Sonnet 분석가는 **초안이 아니라 1차 정정본**을 일부 읽었기 때문에, FB-06의 "동시 마운트" 서술 등
이미 고쳐진 항목은 "과장 없음"으로 평가했다. 아래 표의 [2차]는 Sonnet 라운드에서 **추가로** 발견된 것이다.

### 리뷰로 정정된 사실오류 (전부 반영 완료)

| 문서 | 초안의 오류 | 실제 | 근거 |
|------|-------------|------|------|
| FB-01 | `ad_hoc`은 연동 대상이 없다는 뜻 → 배지 숨김 | ad_hoc도 `marker_id="Ad hoc SNP Analyze"`를 갖는다. 숨길 것은 원시 식별자뿐 | `tests/test_asg_launch_auth.py:85-91` |
| FB-01 | 렌더 경로 1개 | 축약 `<summary>`도 `target_type`을 노출 — 2개 경로 | `Header.tsx:35` |
| FB-02 | 중앙 드롭존은 단일/폴더 전용 | `multiple` + `runUploadJobs(files)` 배치 — 이미 멀티 지원 | `UploadZone.tsx:157,166,418` |
| FB-02 | 큐가 `qprism-file-workspace`에 persist됨 | 큐는 드로어 지역 `useState`. persist는 `openSessionIds`/`sessionQueries`뿐 | `FileWorkspaceDrawer.tsx:87`, `session-store.ts` partialize |
| FB-03 | `ResultsTable`이 접힌 영역 | 항상 렌더되며 24rem 스크롤 제한일 뿐 | `index.css` `results-scroll-region` |
| FB-04 | `aspect-ratio: 4/3` + `max-height: 70vh`로 해결 | 940px 폭에서 4:3은 705px > 638px → **비율이 깨진다.** 폭을 묶어야 함 | 산술 검증 |
| FB-05 | `read_channels`를 런 전체 채널로 채움 | 본문과 모순. 단계별 정보 없으면 비워야 함 | 문서 내부 불일치 |
| FB-06 | 중복 id가 Plotly 오작동 + export registry 오염 | Plotly는 ref 기반. 오버레이는 registry에 등록조차 안 함 | `chart-export-registry.ts:14` |
| FB-06 | 오버레이가 두 곳에 동시 마운트됨 | `AnalysisWorkspace`의 배타 분기로 항상 하나만 존재 | `AnalysisWorkspace.tsx:105` |
| FB-06 | `단색` 모드 = 순수 raw 신호 | Y값은 여전히 `norm_fam`/`norm_allele2` | `AmplificationOverlay.tsx:67` |
| FB-07 | `navigation-store`가 탭 id를 persist | persist 안 함. 위치는 URL + `sessionQueries` | `navigation-store.ts`, `workspace-history.ts` |
| FB-07 | 3-1-b(라벨만 변경)로 충분 | 최상위 Plate/Results 탭 2개는 새 탭 ID 없이 표현 불가 | `navigation-store` `surface` 구조 |
| 00 | `A1(브랜드) → C1/C2` 의존 | 의존 없음. 산점도/밀도 작업은 브랜드와 독립 | — |
| FB-01 [2차] | i18n 매핑 예시로 `marker`/`design_result`/`order_item` 제시 | **코드·테스트 어디에도 없는 추정값.** 실제 관측값은 `ad_hoc`/`marker_version`/`design_run_item` | `test_asg_launch_auth.py:56,87`, `test_asg_result_save.py:105,209,302` |
| FB-07 [2차] | 알 수 없는 탭 id 폴백을 "반드시 구현할 것" | 폴백은 `parseNavigation`의 `tab()` 타입가드로 **이미 구현됨**. 새로 필요한 것은 구→신 id **의미 보존 매핑** | `navigation-store.ts:25,32-36,56` |
| FB-06 [2차] | 두 인스턴스가 각각 요청 → 중복 전송 | 오버레이는 기본 접힘(`useState(false)`)이라 **양쪽을 각각 펼쳤을 때만** 중복. 비용도 인메모리 조회로 낮음 | `AmplificationOverlay.tsx:19,40`, `data.py:36-39,220` |

### 리뷰가 추가로 발굴한 누락 위험 (반영 완료)

- FB-05: `ProtocolStep`이 **ASG 저장 payload에 실린다** — 외부 계약 영향 (`app/asg_result.py`)
- FB-06: all-amplification 응답에 `normalization_applied`/`background_mode` **에코가 없어** 정직한 상태 표시가 불가 (`app/routers/data.py`)
- FB-04: 임의 정규화 채널은 요청 필드가 아니라 **저장 모델 확장**을 요구 (fam/allele2/reference 3슬롯만 보존)
- FB-03: 경고 강등 전에 **심각도 등급 정의가 선행**되어야 함 (현재 `warnings`에 등급 없음)
- FB-03/07: `lib/quality-navigation.ts`의 `surface` 복귀 계약이 IA 변경의 회귀 대상
- FB-07: 색 HEX가 `constants.ts` / `genotype.ts` / `ProtocolTab.tsx` / `pdf_builder.py`에도 분산
- FB-02: 서로 다른 두 업로드 구현의 한도·검증·오류 복구 통합 여부 미결정
- **[2차]** FB-04 Step 2: `app/processing/normalize.py`의 `_normalization_value()` 폴백 체인(`normalization_value`→`rox`)이 변경 범위에서 누락
- **[2차]** FB-04 Step 2: `AnalysisContext`에 `result_revision`/`input_revision`이 **이미 존재** — 무효화 체계를 새로 만들 필요 없음 (`app/models.py:380,389`)
- **[2차]** 다크모드 전환 레이스: `body`의 `transition 0.3s` 중 `getComputedStyle`이 중간값을 읽을 수 있음 — **Plotly를 쓰는 모든 차트**에 공통 적용 (FB-04/06/07)
- **[2차]** 내보내기 캡처 크기: 캔버스 종횡비 변경 시 `use-exports.ts`의 캡처가 실측 크기를 쓰는지 미검증

### 남은 이견

- **경고 강등(FB-03)**: Gemini는 배지 + `aria-live`로 충분하다고 보았고, Codex는 심각도 정책이 선행되어야 한다고 보았다.
  → **Codex 채택.** 판정 신뢰도 경고를 정책 없이 접는 것은 과학적 도구에서 허용할 수 없다.
- **종횡비 목표(FB-04)**: 사용자는 정사각을 먼저 언급했으나 여백이 커진다. → 사용자 결정 대기 (D-6).

---

## 8. 실행 작업서

본 기획서를 auto-orchestrate 실행 계약으로 옮긴 문서:
[`docs/planning/06-tasks.md`](../06-tasks.md) — Contract ID `qprism-feedback-20260911-v1`, 7 Phase / 25 태스크.

2026-09-11 정본 승격 완료. 이전 계약은 `docs/planning/archive/06-tasks-ux-followup-20260907.md`에 보관.
