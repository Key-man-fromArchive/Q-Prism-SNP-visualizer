# P5-S0-V — 업로드 진입점 게이트

- Contract: `qprism-feedback-20260911-v1`
- 담당: orchestrator
- 브랜치: `feedback/p5-upload` @ `693b0a4`
- 기준선: main `72741ee` (P4 통합 후)
- 판정: **PASS**

## 1. 게이트 결과

| 검증 | 기준선 | 현재 | 판정 |
| --- | --- | --- | --- |
| FE `npx tsc --noEmit` | 0 | 0 | PASS |
| FE `npm run lint` | 0 | 0 | PASS |
| FE `npm run test` | 112 files / 775 tests | **115 files / 807 tests / 0 failed** | PASS (+32) |
| FE `npm run build` | 성공 | 성공 | PASS |
| BE-ALL | 816 passed | 백엔드 미변경 | PASS |
| **루트 E2E** | 133 passed / 4 failed | **133 passed / 4 failed** | PASS (동일) |

남은 4건은 main에서도 실패하는 기존 부채(`06-import-mapping:10`, `17-manual-group:55`/`:135`, `test-windows:109`).

## 2. 핵심 제약 — 큐 소실 방지

`FileWorkspaceDrawer`의 큐는 컴포넌트 지역 `useState<QueueItem[]>`이고 persist되지 않는다
(`session-store`는 `openSessionIds`/`sessionQueries`만 담는다).

**세션 유무로 드로어를 조건부 마운트하면 업로드가 성공하는 순간 세션이 생기고
`visibility.upload`가 false로 뒤집히면서 큐가 통째로 사라진다.** 이것이 이 태스크의 설계를 규정했다.

해결: `App.tsx`가 `<FileWorkspaceDrawer>`를 **무조건 마운트**하고, 트리거만 위치에 따라 렌더한다.

```tsx
<Header showFileWorkspaceTrigger={!visibility.upload} />
...
<FileWorkspaceDrawer ... />     // 조건 없음
```

드로어는 자기 다이얼로그를 portal로 띄우므로 마운트 위치가 시각적 배치를 구속하지 않는다.
트리거(헤더 1개 + `UploadZone` 안 1개)만 `visibility.upload`에 따라 나타난다.

## 3. D-7 결정 반영 — 통합하지 않고 한도만 일치

사용자 결정(2026-09-12): **역할 분리 유지, 한도·문구만 일치.**

중앙 드롭존은 빠른 업로드, 드로어는 다건 관리라는 역할을 그대로 두고
파일 수·총 용량 한도와 초과 시 문구만 양쪽이 같은 값을 쓰게 했다.

> 참고: 초안은 "중앙 드롭존은 단일/폴더 전용"이라고 서술했으나 **사실이 아니었다.**
> `UploadZone`의 파일 input에 `multiple`이 있고 `runUploadJobs(files)`가 다중 파일을 배치 처리한다.
> 실제 문제는 "멀티가 헤더에만 있다"가 아니라 **같은 일을 하는 구현이 두 벌이고 한도가 달랐다**는 것이다.

## 4. 수용 기준 검증

| AC | 결과 |
| --- | --- |
| 세션 없을 때 헤더에 트리거가 없다 | PASS |
| 세션 없을 때 드롭존 인근에서 워크스페이스를 연다 | PASS |
| 세션 있을 때 헤더 트리거가 카운트 배지와 함께 동작 | PASS |
| **업로드 중 세션 생성으로 트리거가 바뀌어도 큐·열림 상태 유지** | PASS (상시 마운트) |
| 두 트리거 중 어디서 열든 같은 큐 | PASS |
| 닫으면 포커스가 현재 보이는 트리거로 복귀 | PASS |
| 드로어 내부 동작(검증·ZIP 패키징·매핑 마법사) 불변 | PASS |
| 중앙 드롭존의 다중 파일 배치 업로드 회귀 없음 | PASS |
| 두 경로가 같은 한도·문구 | PASS |

## 5. 범위 밖으로 남긴 것

**브랜드 히어로 블록은 이 Phase에서 구현하지 않았다.** FB-02의 §3-3/§3-4(히어로·로고·파비콘)는
P6-S3-T1 소관이며 D-3(에셋)이 이 Phase 착수 시점에 미해결이었다.
이후 에셋을 찾았으므로(아래) P6에서 처리한다.

## 6. P6 준비 — 브랜드 에셋 발견 (D-3 해소)

사용자 안내에 따라 `asgdesigner2` 계열 경로를 탐색해 **`/mnt/docker/asg-saas-v2`**에서 확보했다.
**이미지 생성은 불필요했다.**

| 자산 | 경로 |
| --- | --- |
| 브랜드 가이드 | `docs/brand/Q-PRISM-BRAND-IDENTITY.md` |
| 실무 디자인 시스템 CSS | `static/marketing/assets/qprism.css` |
| 로고 (심볼/워드마크/와이드/세로) | `static/qprism/{1.simple,2.wordmark,3.wide,4.vertical}*.png`, 투명 배경·WebP 포함 |
| 파비콘 | `static/qprism/favicon-32.png`, `apple-touch-icon-180.png` |
| 히어로 아트 | `static/marketing/assets/hero-prism.jpg` (1055×1491) |
| Invirustech 로고 | `static/marketing/assets/logo-ivt.png` |

### 가이드와의 차이 — 의도적 이탈 2건 (기록)

**(1) 표기법**: 가이드는 `Q-prism®`(소문자 p)을 규정하고 `Q-Prism`을 **명시적으로 금지**한다.
이 계약은 그동안 `Q-Prism®`을 써 왔다. **사용자 결정: 가이드를 따라 `Q-prism®`으로 통일.**

> 다만 자사 로고 **이미지 자체가 `Q-Prism®`**으로 렌더링되어 있어 이미지와 텍스트 표기가 어긋난다.
> 이미지 수정은 이 계약 범위 밖이며(`asg-saas-v2` 소관), 알려진 불일치로 남긴다.

**(2) 팔레트**: 가이드의 primary는 **Prism Violet `#6B5B95`**다.
**사용자는 가이드를 확인한 뒤 Deep Teal `#0f766e`를 선택했다.**

> 의도적 이탈이며 나중에 "가이드와 다르다"는 이유로 조용히 되돌리면 안 된다.
> 근거: FAM 파랑(`#2563eb`)과 색상 거리가 가장 멀어 UI 색과 데이터 색의 혼동이 최소화된다.
> 현재 `--color-primary`는 `--color-fam`과 **완전히 같은 값**이라 버튼과 FAM 데이터 점이 구분되지 않는다.

### 채널색 (D-4, 참고)

`qprism.css`는 FAM=초록 `#2e9b5b`, HEX=앰버 `#e0a12f`, ROX=적 `#e15d44`로 정의하나,
앱은 FAM=파랑 / allele2=빨강이다. **D-4 결정에 따라 앱 관례를 유지**하며 가이드를 따르지 않는다.
