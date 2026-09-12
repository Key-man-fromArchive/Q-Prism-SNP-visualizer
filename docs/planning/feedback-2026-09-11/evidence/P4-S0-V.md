# P4-S0-V — 결과 화면 게이트

- Contract: `qprism-feedback-20260911-v1`
- 담당: orchestrator
- 브랜치: `feedback/p4-results` @ `ab9c600`
- 기준선: main `a63c332` (P3 통합 후)
- 판정: **PASS**

## 1. 태스크 커밋

| 태스크 | 커밋 | 내용 |
| --- | --- | --- |
| P4-R1-T1 | `995a284` | 경고 심각도 등급 계약 (3개 코드 전부 `blocking`) |
| P4-S1-T1 | `1abdb58` | 산점도 종횡비 기하 + `scatterAspect` 상태, CSS 중복 선언 제거 |
| P4-S1-T1 후속 | `426b8c2` | `Plotly.Plots.resize` 타입 선언 (빌드 복구) |
| (측정) | `d35a80f` | 종횡비 브라우저 회귀 테스트 신설 |
| P4-S2-T1 | `35fcf9a` | 플롯 헤더 바 — 정규화·축 설정·종횡비 승격 |
| P4-S3-T1 | `5fad29d` | 결과 중심 레이아웃 |
| P4-S3-T1 후속 | `45a907c` / `58d618c` / `029b861` | 헤더 압축, 높이 상한 되돌리기, 그룹 바 병합 |
| (계약 정정) | `2a23507` | 오케스트레이터가 만든 잘못된 수용 기준 정정 |
| P4-EXPORT | `61480cf` | PNG 내보내기가 선택 종횡비를 따르도록 |
| P4-REGRESSIONS | `9007c5d` | P4가 만든 E2E 회귀 2건 해소 |
| P4-LEGEND | `ab9c600` | 플레이트 뷰 범례 (사용자 추가 요청) |

## 2. 게이트 결과

| 검증 | 기준선 (`a63c332`) | 현재 (`ab9c600`) | 판정 |
| --- | --- | --- | --- |
| BE-ALL | 810 passed + 2 subtests | **816 passed + 2 subtests / 0 failed** | PASS (+6) |
| BE `ruff check` (변경 .py) | — | All checks passed | PASS |
| BE `ruff format --check` (신규 .py) | — | 1 file already formatted | PASS |
| FE `npx tsc --noEmit` | 0 | 0 | PASS |
| FE `npm run lint` | 0 | 0 | PASS |
| FE `npm run test` | 104 files / 723 tests | **112 files / 775 tests / 0 failed** | PASS (+52) |
| FE `npm run build` | 성공 | 성공 | PASS |
| **루트 E2E** | 132 passed / 4 failed | **133 passed / 4 failed** | PASS (+1) |

남은 4건은 main에서도 동일하게 실패하는 기존 부채다(`06-import-mapping:10`,
`17-manual-group:55`, `17-manual-group:135`, `test-windows:109`). P3-S0-V §4 참조.

## 3. 산점도 크기 — 브라우저 실측

`.analysis-scatter-canvas` `boundingBox()` (`tests/27-scatter-aspect.spec.ts`가 회귀로 고정):

| 뷰포트 | 종횡비 | 캔버스 | 비고 |
| --- | --- | --- | --- |
| 1920×911 | `4:3` | **850 × 638** (ratio 1.3334) | 기존 **300px** 대비 높이 **2.1배** |
| 1920×911 | `1:1` | **638 × 638** (ratio 1.000) | 드롭다운으로 전환 |
| 1440×900 | `4:3` | 662 × 497 | 종횡비 유지 |
| 1280×800 | `4:3` | 582 × 437 | 종횡비 유지 |

원인이었던 CSS 결함: `index.css`의 1280px 미디어쿼리 안에 `.analysis-scatter-canvas`가 **두 번** 선언되어
(`max-height:300px`, `height:360px`) 둘 다 적용되며 used height가 300px로 눌렸다. 넓은 화면일수록 작아지는 구조였다.
이제 **폭을 종횡비에 묶는** 방식이라 높이가 잘려 비율이 깨지지 않는다.

## 4. 오케스트레이터 판단 오류 2건 — 기록

### 4-1. 없는 요구를 만들어 있는 요구를 깎았다

작업서에 `1920x911에서 스크롤 없이 산점도 전체가 보인다`를 넣고, 캔버스가 뷰포트를 넘자
`--scatter-max-h`에 `calc(100dvh - 555px)`를 넣도록 지시했다. 결과:

```
300px(원래 결함) → 638px(P4-S1-T1) → 360px(내 지시, min-height 플로어에 충돌)
```

사용자가 불평한 300px보다 60px 큰 상태로 되돌아갔고 종횡비도 1.318로 깨졌다.
그 시점에 "스크롤 없음은 사용자 요구가 아니라 내가 만든 것"이라 판단해 수용 기준을 고치고 되돌리게 했다(`2a23507`, `58d618c`).

### 4-2. 그런데 그 판단도 틀렸다

`tests/24-responsive.spec.ts:51` — `result-first 96-well desktop keeps scatter, plate and selected summary in the initial viewport` —
는 **이전 UI/UX 계약이 만든 기존 프로젝트 스펙**이고 1440×1000에서
`#scatter-plot`/`#plate-grid`/`.detail-panel`의 `bottom ≤ 1000`과 `scrollY === 0`을 단언한다.
**P3 기준선에서 통과하던 테스트를 P4가 깼다.**

"내 발명이므로 폐기 가능"이라는 결론은 **확인 없이 내린 것**이었다. 리포지토리가 이미 그 요구를 강제하고 있었다.

> **P1에서와 같은 실패 유형**이다. 그때는 "기준선에서도 실패하니 내 환경 탓",
> 이번엔 "요구 문서에 없으니 내 발명" — 둘 다 **반대 증거를 찾아보지 않고 단정**했다.
> E2E 스펙 이름을 grep 한 번 했으면 5분에 끝났을 일이다.

### 4-3. 실제 해법 — 캔버스가 아니라 크롬을 줄였다

`9007c5d`이 1440×1000에서 89px 부족분을 **전부 크롬에서 회수**했다. 캔버스와 종횡비는 무변경:

- 패널 제목 `대립유전자 판별`을 헤더 바 줄에 병합
- `비율 원점` 노트를 접힌 고급 설정 안으로 이동
- 고급 설정 요약에서 중복된 `NTC 여백` 절 제거 (값은 펼친 컨트롤에 그대로 있음)
- 패딩·간격 축소

측정: `#scatter-plot` top 592 → **500**, bottom 1088.5 → **996.5** (여유 3.5px). 캔버스 높이 496.5px 불변.
`ScatterReferenceBasis`(`normalization-state`) 문구는 `26-chart-semantics`가 의존하므로 **바이트 단위로 보존**했다.

## 5. P4가 드러낸 잠복 버그

| 위치 | 증상 |
| --- | --- |
| `ScatterViewControls` `hasNormalizationChannel` | prop이 정의만 되고 **두 플롯 모두 한 번도 전달하지 않아** 기본값 `true` 고정 → 참조 채널이 없는 런에서도 정규화 체크박스가 활성으로 보였다. `sessionInfo.has_rox`에 연결 |
| `use-exports.ts` `exportPNG` | 캡처 크기가 `1200×900` 하드코딩 → `1:1`을 선택해도 PNG는 4:3. 실제 렌더 요소 크기에서 유도하도록 수정 |
| `src/plotly.d.ts` | `Plots` 미선언 → 구현이 `as unknown as {...}`로 우회, 테스트는 컴파일 실패. 실제 타입을 선언하고 캐스팅 제거 |

## 6. 경고 심각도 — 강등된 것은 없다

`relative_ntc` / `low_n` / `anchor_conflict` **전부 `blocking`**으로 분류했다. 근거는
`app/models.py`와 `lib/analysis-warnings.ts` 주석에 호출부 라인과 함께 기록되어 있다
(예: `relative_ntc`는 해당 웰의 라벨을 NTC → Undetermined로 바꿔 **보고되는 판정 결과 자체를 바꾼다**).

등급 체계는 *앞으로 추가될* 정보성 경고를 강등하기 위한 **메커니즘**이며, 지금 있는 셋을 내리지 않는다.
**재분류는 QC 정책 결정이고 사용자 몫이다.** 오케스트레이터·전문가 모두 임의로 내리지 않았다.

## 7. 플레이트 뷰 범례 (사용자 추가 요청, 2026-09-12)

> 플레이트뷰 옆에 범례 필요해

플레이트 셀이 배경색 + 글리프(▲ ● ■ + ◆)로 판정을 표시하는데 설명이 없었다. 산점도에는 범례가 있었다.

- `lib/chart-semantics.ts`의 **`callAppearance()`에서 유도**한다 — 셀을 그리는 것과 같은 함수다.
  색·글리프·라벨을 따로 하드코딩하면 배수성 변경이나 P6 팔레트 교체 때 어긋난다. 같은 함수를 쓰면 구조적으로 어긋날 수 없다.
- **플레이트에 실제로 있는 판정만** 나열한다. 가능한 전체 목록은 사용자가 지적한 "텍스트가 너무 많다"를 되풀이한다.
- 개수를 함께 표시: `▲ Hom-1 12` · `● Het 12` · `■ Hom-2 12` · `+ NTC 4`
- 한 줄 배치라 뷰포트 예산을 깨지 않는다 — `24-responsive.spec.ts` 23개 재실행 통과로 확인.

## 8. 수용 기준 검증

| AC | 결과 |
| --- | --- |
| 1920×911 캔버스 4:3 ±2%, 높이 ≥600px | PASS — 850×638, ratio 1.3334 |
| `1:1` 전환 시 정사각 + 중앙 정렬 | PASS — 638×638 |
| 종횡비 전환 후 Plotly 재렌더 | PASS — `Plotly.Plots.resize` |
| 1280/768/400px에서 종횡비 유지 | PASS |
| 신규 필드 없는 프리셋 적용 시 기본값 복원 | PASS |
| 정규화 체크박스가 펼치지 않고 보인다 | PASS |
| 참조 채널 없는 런에서 비활성 + 사유 | PASS (잠복 버그 수정 포함) |
| `축 설정…` → 축 모드 선행 변경 없이 편집 | PASS |
| 기존 `data-testid` 전부 유지 | PASS — 9개 확인 |
| `blocking` 경고 상단 잔류, `advisory`만 강등 | PASS |
| 경고 배지 + `aria-live` 유지 | PASS |
| 그룹 없고 선택 없으면 프리셋 버튼 미렌더 | PASS |
| 마커 0개 세션에도 스코프 선택기 | PASS |
| `split-marker-banner` 제거 후 죽은 상태 없음 | PASS |
| 뷰포트 예산(`24-responsive:51`) 유지 | PASS — bottom 996.5 / 1000 |
| PNG 내보내기가 선택 종횡비 반영 | PASS |

## 9. 정리

임시 uvicorn(8124), 임시 DB, 임시 스펙, `test-results/`·`playwright-report/` 제거.
포트 8002(프로덕션)와 운영 DB는 전 과정에서 사용하지 않았다.
