# P0-S0-V — Preflight 게이트

- Contract: `qprism-feedback-20260911-v1`
- 담당: orchestrator (스킬 계약상 Phase 리뷰·QA·게이트는 오케스트레이터가 수행)
- 브랜치: `feedback/p0-preflight` @ `c416841`
- 기준선: main `bbc6657`
- 판정: **PASS**

## 1. Phase 변경 범위

```
docs/planning/06-tasks.md                        (BE-LINT 게이트 정의 수정)
docs/planning/feedback-2026-09-11/evidence/P0-T0.1.md, P0-T0.2.md
snp-analyzer/frontend/src/index.css
snp-analyzer/frontend/src/lib/{plotly-theme,constants,genotype}.ts
snp-analyzer/frontend/src/lib/{plotly-theme,constants}.test.ts        (신규)
snp-analyzer/frontend/src/components/protocol/ProtocolTab.{tsx,test.tsx}
```

**백엔드(`snp-analyzer/app/`, `snp-analyzer/tests/`) 변경 0건.** 따라서 P0-T0.1에서 측정한
BE 기준선(798 passed + 2 subtests, 0 failed)이 그대로 유효하며 재실행하지 않았다.

## 2. 게이트 결과

| 검증 | 기준선 (`bbc6657`) | 현재 (`c416841`) | 판정 |
| --- | --- | --- | --- |
| FE `npx tsc --noEmit` | 0 errors | 0 errors | PASS |
| FE `npm run lint` | 0 errors | 0 errors | PASS |
| FE `npm run test` | 100 files / 666 tests / 0 failed | **102 files / 682 tests / 0 failed** | PASS (테스트 +16) |
| FE `npm run build` | 성공 | 성공 (32.8s) | PASS |
| BE-ALL | 798 passed + 2 subtests | 변경 없음 (백엔드 미변경) | PASS |
| BE-LINT (변경분) | — | 해당 없음 (`.py` 변경 0건) | N/A |

### 변경분 품질 지표

| 지표 | 기준 | 측정 | 판정 |
| --- | --- | --- | --- |
| 새 코드 coverage (stmts) | ≥70% | **93.75%** | PASS |
| 〃 (branch) | — | 85.18% | |
| 〃 (lines) | — | 96.55% | |
| 순환복잡도 | ≤10 | 위반 0건 | PASS |

측정 대상: `plotly-theme.ts`, `constants.ts`, `genotype.ts`, `ProtocolTab.tsx`.
복잡도는 `eslint` `complexity: ['error', 10]` 규칙을 변경 파일에 직접 적용해 확인했다.

## 3. P0-T0.2의 절대 제약 — "색 값 불변" 독립 검증

오케스트레이터가 전문가 보고를 신뢰하지 않고 직접 확인했다.

1. **`index.css` diff**: 기존 토큰 값 **변경 0건**. 추가된 것은 플롯 전용 토큰 4개
   (`--color-plot-grid`, `--color-plot-legend-bg`, `--color-plot-marker-line`, `--color-plot-selected-line`)뿐이며,
   값은 리팩터링 전 `plotly-theme.ts`에 하드코딩되어 있던 것과 동일하다. `@theme`과 `body.dark` 양쪽에 추가됐다.
2. **상수 치환 정확성**: `BRAND_HEX.blue600 = #2563eb`, `red600 = #dc2626`, `green500 = #10b981`,
   `green400 = #34d399` — `genotype.ts`가 치환 전 사용하던 리터럴과 일치.
3. **`--color-fam` / `--color-allele2`**: 값·의미 모두 불변 (qPCR 채널 판독 관례 보존 요건).
4. **폴백**: `plotly-theme.ts`의 `FALLBACK` 상수가 리팩터링 전 HEX를 라이트/다크 각각 그대로 보유.
   `getComputedStyle`이 빈 문자열을 반환하는 환경에서도 색이 유지된다.

## 4. 다크모드 전환 레이스 — 해소 확인

우려: `index.css`의 `body { transition: background-color .3s, color .3s }` 때문에
테마 토글 직후 `getComputedStyle`이 전환 중간값을 읽을 수 있다.

**실제로는 문제가 되지 않는다.** 해당 `transition` 목록에는 `background-color`와 `color`만 있고
커스텀 프로퍼티(`--color-*`)는 포함되지 않는다. `@property`로 등록되지 않은 커스텀 프로퍼티는
애니메이션 대상이 아니므로 `body.dark` 토글 시 **동기적으로** 새 값이 된다.
`plotly-theme.ts`는 커스텀 프로퍼티만 읽으므로 중간값을 볼 수 없다. 코드 주석에도 기록되어 있다.

## 5. 알려진 간헐적 실패 (기준선으로 분리)

`src/components/compare/CompareTab.test.tsx > handles real stats wire shape with nullable Pearson and wrong identity=false`

| 실행 조건 | 결과 |
| --- | --- |
| 전체 스위트 5회 | **4 pass / 1 fail** |
| 해당 파일 단독 2회 | 2 pass |
| 신규 테스트 2개 제외한 전체 | 100 files / 667 tests / 0 failed |

- **P0-T0.2가 원인이 아니다.** 신규 테스트를 제외해도, 포함해도 재현되지 않으며 단독 실행은 항상 통과한다.
- 유일한 실패는 **다른 테스트 프로세스와 CPU를 경합하던 중** 발생했다.
- 원인은 이 파일의 비동기 구조다: `findBy*`(기본 타임아웃 1000ms) + `waitFor` + `act`로 모킹된
  프로미스 해소를 기다린다. 부하가 걸리면 타임아웃을 넘긴다.
- 신규 테스트는 `document.body`를 조작하지만 `afterEach(resetBody)`로 정리하고,
  `vitest.config.ts`에 `isolate: false`가 없어 파일 단위 격리가 적용된다. 교차 오염 경로가 아니다.

**조치**: 기존 취약성으로 기록하고 이번 계약에서 수정하지 않는다(범위 밖).
**P3/P4 주의**: 탭 구조 변경 시 `CompareTab`을 건드리게 되면 이 타임아웃 취약성이 함께 드러날 수 있다.
그때 `findBy` 타임아웃 상향 또는 대기 조건 정밀화를 검토한다.

## 6. 계약 수정 사항 (P0-T0.1에서 확정, 본 게이트에서 승인)

`BE-LINT`를 **변경분 기준**으로 재정의했다. main 기준선이 `ruff check` 36 errors,
`ruff format --check` 122/142 파일 미포맷이므로 절대 기준 게이트는 첫 Phase부터 실패한다.
리포지토리에 ruff 설정 파일이 없어 기본 규칙이 적용되며 코드베이스는 그 규칙으로 작성되지 않았다.
전체 포맷은 122개 파일의 diff·blame을 오염시키므로 별도 계약으로 분리한다.

## 7. 재현 명령

```bash
cd worktree/feedback-p0/snp-analyzer/frontend
npx tsc --noEmit && npm run lint && npm run test && npm run build

npx vitest run --coverage.enabled --coverage.reporter=text \
  --coverage.include='src/lib/plotly-theme.ts' --coverage.include='src/lib/constants.ts' \
  --coverage.include='src/lib/genotype.ts' --coverage.include='src/components/protocol/ProtocolTab.tsx'
```
