# P6-S0-V — 브랜드 게이트 (최종 Phase)

- Contract: `qprism-feedback-20260911-v1`
- 담당: orchestrator
- 브랜치: `feedback/p6-brand` @ `3a1d5a4`
- 기준선: main `36e9cf3` (P5 통합 후)
- 판정: **PASS**

## 1. 태스크 커밋

| 태스크 | 커밋 | 내용 |
| --- | --- | --- |
| (에셋 반입) | `73bcfb2` | `asg-saas-v2`의 브랜드 킷을 `public/`으로, 가이드를 기획서 옆으로 |
| P6-S1-T1 | `a32668c` | 제품명 `Q-prism® Cluster Caller` 통일 + `Q-Prism`→`Q-prism` 표기 정정 |
| P6-S2-T1 | `998ba58` | Deep Teal 팔레트 적용 |
| P6-S1-T1 후속 | `0a07da0` | `AppFooter` 버전 표기 + 루트 E2E 3곳 |
| P6-S3-T1 | `1318b80` | 브랜드 에셋 적용 + 업로드 히어로 + 파비콘 |
| P6-S1-T1 lint | `3a1d5a4` | `pdf_builder.py` 기존 미사용 import 2건 정리 |

## 2. 게이트 결과

| 검증 | 기준선 (`36e9cf3`) | 현재 (`3a1d5a4`) | 판정 |
| --- | --- | --- | --- |
| BE-ALL | 816 passed + 2 subtests | **816 passed + 2 subtests / 0 failed** | PASS |
| BE `ruff check` (변경 .py) | — | **All checks passed** | PASS |
| BE `ruff check .` (전체 부채) | 36 errors | **34 errors** | 개선 (−2) |
| FE `npx tsc --noEmit` | 0 | 0 | PASS |
| FE `npm run lint` | 0 | 0 | PASS |
| FE `npm run test` | 115 files / 807 tests | **119 files / 828 tests / 0 failed** | PASS (+21) |
| FE `npm run build` | 성공 | 성공 | PASS |
| **루트 E2E** | 133 passed / 4 failed | **133 passed / 4 failed** | PASS (동일) |

남은 4건은 계약 시작 전부터 main에서 실패하던 기존 부채(`06-import-mapping:10`,
`17-manual-group:55`/`:135`, `test-windows:109`). P3-S0-V §4 참조.

## 3. 팔레트 적용이 드러낸 것 — 다크 모드 전역 파손 직전

P6-S2-T1 담당이 `--color-primary` 소비처를 전수 조사하다 발견했다.

앱 전역의 버튼 수십 개가 `bg-primary`와 **하드코딩된 `text-white`**를 짝지어 쓰고 있었다:
`App.tsx`, `LoginPage`, `PlateSetupTab`, `ScatterViewControls`, `WellSelectionToolbar`, `UploadZone`,
`ImportMappingWizard`, `BatchTab`, `MarkerCatalogTab`, `CompareTab`, `LayoutsLibraryPanel`,
`FileWorkspaceDrawer`/`Trigger`, `GroupManager`, `UserManagement`, `AnalysisTab`,
그리고 공용 프리미티브 `components/shared/ui/variants.ts`.

기존 primary(`#2563eb`)는 어두워서 흰 글자가 괜찮았다. **새 다크 primary(`#2dd4bf`)는 밝은 민트라
흰 글자 대비가 ~1.7:1** — 이 버튼들이 전부 **다크 모드에서 거의 보이지 않는 상태로 배포될 뻔했다.**

조치: `--color-on-primary` 토큰 신설(라이트 `#ffffff` / 다크 `#0e1413`) 후 전부 `text-on-primary`로 치환.
**소스 스캔 회귀 테스트**(`src/test/primary-button-contrast.test.ts`)를 추가해 한 버튼씩 되돌아오는 것을 막았다.

> 명시된 Write Scope를 넘었지만 브리프의 "그 밖에 하드코딩 색을 토큰으로 바꾸는 데 꼭 필요한 컴포넌트"에 해당한다.
> 이것 없이는 팔레트 교체가 앱 전체의 다크 모드를 깨뜨렸을 것이다. **올바른 판단이었다.**

부수 수정: 사이클 슬라이더(`input[type="range"]`)에 색 지정이 **아예 없어** 브라우저 기본 파랑이 나오고 있었다.
`accent-color: var(--color-primary)`로 토큰화. 오케스트레이터가 팔레트 시안 실험 중 발견해 전달한 항목이다.

## 4. 제품명 통일에서 빠졌던 곳

`AppFooter.tsx:28`이 모든 화면 하단에 `ASG-PCR SNP v1.0.0`을 렌더하고 있었다.
헤더는 `Q-prism® Cluster Caller`인데 푸터는 구명칭이라 **한 화면 안에서 이름이 갈렸다** —
이 태스크가 해결하려던 문제("이름이 세 개로 갈려 있다") 그 자체였다.

오케스트레이터가 E2E 회귀(`01-homepage.spec.ts` 2건)를 추적하다 발견해 후속(`0a07da0`)으로 처리했다.
버전 숫자는 유지했다 — 그 문자열의 목적이 "운영자가 문제 보고 시 버전을 말할 수 있게" 하는 것이기 때문이다.

## 5. 표기 정정 — 무엇을 고치고 무엇을 두었나

브랜드 가이드가 `Q-prism®`(소문자 p)을 규정하고 `Q-Prism`을 명시적으로 금지한다.

**고친 것**: UI `appTitle`(en/ko), `index.html`(title/OG/description/keywords), `README.md`,
PDF 푸터, `AppFooter`, 현행 계약(`06-tasks.md`), 현행 기획서(`00-overview`/`FB-02`/`FB-07`), 루트 E2E 3곳.

**두고 온 것과 이유**:

| 대상 | 이유 |
| --- | --- |
| 기획서의 `**원문**:` 사용자 인용 블록 | 사용자가 실제로 친 `Qprism`/`Q-Prism` 그대로. **인용을 고치면 기록이 아니게 된다** |
| `docs/planning/archive/**` | 과거 계약의 기록 |
| `docs/planning/ui-ux-overhaul/**` | 완료된 계약의 증거 문서 |
| `qprism-*.csv/tsv` 템플릿 파일명 | 바꾸면 다운로드 링크와 문서가 깨진다 |
| `qprism-file-workspace`, `qprism:view:` | **저장 키.** 바꾸면 사용자의 기존 sessionStorage 데이터를 잃는다 |
| 리포지토리 이름 `Q-Prism-SNP-visualizer` | 클론 URL·경로 식별자 |
| 브랜드 가이드 자체의 "잘못된 표기" 예시 | 그것이 예시의 요지다 |
| `instrument="Q-Prism"` 테스트 픽스처 2곳 | 임의의 **장비명 자리표시자**이지 브랜드 표기가 아니다 |
| `canonical` URL | SEO 영향. 별도 결정 사항으로 기록만 |
| ASG 연동 문구 (`Save result to ASG Designer` 등) | **상대 시스템의 이름**이지 우리 제품명이 아니다 |

## 6. 가이드와의 의도적 이탈 (기록)

### 6-1. 팔레트 — Deep Teal (가이드는 Prism Violet)

가이드의 primary는 `Prism Violet #6B5B95`다. **사용자가 가이드를 확인한 뒤 `#0f766e`를 선택했다.**

근거: 기존 `--color-primary`가 `--color-fam`과 **완전히 같은 값**(`#2563eb`)이라
버튼과 FAM 데이터 점이 구분되지 않았다. 딥 티일은 FAM 파랑과 색상 거리가 가장 멀어 그 혼동을 최소화한다.

> **이후 누군가 "가이드와 다르다"는 이유로 조용히 되돌리면 안 된다.** 의도적 결정이다.

대비비 (전부 WCAG AA 통과):

| | 라이트 | 다크 |
| --- | --- | --- |
| 본문 / surface | 16.52 | 13.82 |
| 보조 / surface | 5.28 | 6.45 |
| primary / surface | 5.47 | 8.93 |
| on-primary / primary | 5.47 | 10.00 |

### 6-2. 채널색 — 앱 관례 유지 (D-4)

`qprism.css`는 FAM=초록 `#2e9b5b`, HEX=앰버 `#e0a12f`, ROX=적 `#e15d44`로 정의하지만
앱은 FAM=파랑 `#2563eb` / allele2=빨강 `#dc2626`을 유지한다.

**사용자 결정**: 어느 색이 어느 염료인지는 실험자가 장비 사이를 오가며 들고 다니는 판독 관례이고
기존 보고서·논문 그림과의 일치가 브랜드 일관성보다 우선한다.
회귀 방지 테스트(`index.css.test.ts`)가 두 토큰의 값을 고정한다.

### 6-3. 로고 이미지 대소문자 불일치 (미해결, 범위 밖)

로고 이미지(`qprism-wide.png`)가 **`Q-Prism®`(대문자 P)**로 렌더링되어 있다.
가이드는 소문자를 규정하므로 **자사 로고가 자사 가이드를 위반**하고 있다.

이미지는 `asg-saas-v2` 소관이라 이 계약에서 고칠 수 없다. **알려진 불일치로 남긴다.**
완화: 히어로에서 **로고 옆에 제품명 텍스트를 중복 표기하지 않아** 대소문자가 나란히 붙어 보이지 않게 했다.

## 7. 에셋 — 생성하지 않고 찾았다

기획 단계에서 오케스트레이터가 **"Q-Prism 브랜드 팔레트가 코드에도 문서에도 존재하지 않는다"**고 보고했다.
**조사 부족이었다.** 사용자 안내로 `asg-saas-v2`를 뒤지자 가이드·디자인 시스템 CSS·로고 4종 락업·
파비콘·apple touch icon·히어로 아트·Invirustech 로고가 전부 있었다. 이미지 생성은 불필요했다.

히어로 원본은 1055×1491 세로 이미지라 그대로 넣으면 업로드 화면이 세로로 늘어진다.
담당이 우측 작은 썸네일로 처리해 드롭존이 화면 상단에 남았다.

다크 모드에서 로고 워드마크가 짙은 남색이라 어두운 배경에서 읽히지 않는다.
흰 배경 칩 위에 올려 판독성을 확보했다(로고 자체는 왜곡하지 않음).

## 8. 수용 기준 검증

| AC | 결과 |
| --- | --- |
| UI·`<title>`·OG·README·PDF·푸터에서 제품명 일관 | PASS |
| `en`/`ko` 양쪽 갱신 + 타입 체크 | PASS |
| ASG 연동 문구 불변 | PASS |
| `canonical` 불변 (검토 필요로 기록) | PASS |
| 라이트·다크 본문 대비 WCAG AA | PASS |
| 채널색 D-4대로 유지 | PASS (회귀 테스트로 고정) |
| 상태색(경고/위험/성공) 의미 보존 | PASS |
| Plotly 차트 색이 앱 팔레트와 일치 | PASS (`plotly-theme.ts` 코드 변경 0 — P0 토큰화 덕) |
| 파비콘이 브라우저 탭에 표시 | PASS |
| 히어로가 세션 없음 상태에서만 표시 | PASS |
| 히어로가 1600px·400px에서 깨지지 않음 | PASS |
| 다크 모드에서 로고 판독 가능 | PASS |
| P5 인라인 트리거·드롭존 회귀 없음 | PASS |

## 9. 정리

임시 uvicorn(8151), 임시 DB, 임시 스펙, `test-results/`·`playwright-report/` 제거.
**포트 8002(프로덕션)와 운영 DB는 이 계약 전 과정에서 사용하지 않았다.**
