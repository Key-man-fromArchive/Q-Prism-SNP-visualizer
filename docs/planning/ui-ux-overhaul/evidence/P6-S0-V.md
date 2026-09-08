# P6-S0-V — NTC 축 offset 품질 게이트

Accepted source head: `ebd06565bc71c9b56fef00f832cfb1f3a3fe9941`.
이번 게이트는 NTC 기준 하한, 음수 광학값 보존, X/Y offset 입력·Reset,
전체/마커별 Plotly 갱신을 확인했다.

## Automated evidence

- 집중 FE 테스트: **27/27 passed** (`scatter-axes`, controls,
  `MarkerScatterPlot.export`).
- 전체 FE 테스트: **638/638 passed, 96 files**.
- `npm run lint`: **0 errors, 0 warnings**.
- `npx tsc -b --pretty false`: **PASS**.
- `npm run build`: **PASS**. Vite의 기존 500 kB 초과 chunk warning만 남았다.
- `git diff --check`: **PASS**.

단위 테스트에서 NTC `(1000, 2000)` 및 offset `(100, 100)`의 하한이
`(900, 1900)`인지, 음수 데이터가 잘리지 않는지, invalid offset fallback과
기존 auto/manual 범위를 확인했다.

## Browser smoke evidence

최신 이미지(`qprism-p6-axis-smoke-image`)를 임시 컨테이너로 실행하고
Playwright Chromium으로 `tests/26-chart-semantics.spec.ts`를 실행했다.
**5/5 passed**: EN/KO × light/dark 단일·마커 산점도와 basis/no-call 회귀.

추가 직접 smoke에서 실제 Plotly `layout.xaxis.range`를 읽었다. 정규화
예제에서 전체 산점도는 offset X `0.1 → 0.2` 변경 시
`[-1.1041174524, 2.3348646524] → [-1.1541174524, 2.2848646524]`로
갱신되었고 Reset 시 원복되었다. 마커 산점도도 `0.1 → 0.3` 변경 시
`[-0.7054487498, 1.9361040498] → [-0.8054487498, 1.8361040498]`로
갱신되었으며 `uirevision`에 basis·offset·origin이 반영되고 Reset 후
기준 range로 복귀했다. 설정 localStorage에도 offset이 저장되었다.

독립 리뷰는 PASS했다. 잔여 사항은 전체 `ScatterPlot`의 Plotly 내부 range를
검증하는 전용 단위 assertion과 normalized Reset wiring 전용 테스트가 아직
없다는 점이며, 위 브라우저 smoke와 구현 경로로 동작을 직접 확인했다.

**P6-S0-V: PASS.** 원격 push·배포는 수행하지 않았다.
