# P7-S0-V — 웰 선택 UX 품질 게이트

Accepted source head: `05b60bcf7571324142dee5157e5910044fd8615f`.
P7-S1-T1의 edge-case 보강 커밋이다.

## Automated evidence

- P7 집중 FE 테스트: **23/23 passed** (`PlateView.cycle`,
  `PlateSetupTab.assignment`, `use-well-grid`).
- 전체 FE 테스트: **645/645 passed, 96 files**.
- `npm run lint`: **PASS**.
- `npm run build`: **PASS** (`tsc -b` 포함; 기존 Vite large-chunk warning만 존재).
- `git diff --check`: **PASS**.
- 독립 re-review: **PASS**, blocking finding 없음.

집중 테스트에는 빈 공간 시작, forward/reverse rectangle, 5px threshold, 일반·Ctrl
추가 선택, 빈 marquee clear/보존, pointer capture/cancel, touch 경로와 blue marquee
style을 포함했다.

## Chromium smoke evidence

시스템 Chrome 확장 연결 대신 로컬 `127.0.0.1:8002`에서 자동화 Chromium을 사용했다.

- 96웰 PlateView(1440×1000): 실제 pointer drag 중 marquee가
  `display:block`, `2px solid rgb(37, 99, 235)`, 반투명 blue fill로 보였다.
  forward/reverse 선택 결과는 각각 9개였고 Ctrl additive도 동작했다.
- 96웰 PlateSetupTab: blue marquee와 `user-select:none`을 확인했고 forward drag에서
  3개 웰이 선택되었다. 두 화면 모두 `window.getSelection().toString()`은 빈 문자열이었다.
- 384웰 fixture(1440px): Setup grid 384개, grid width 820px, wrapper
  `scrollWidth=820 > clientWidth=786`, `overflow-x:auto`, `overflow-y:hidden`,
  `scrollHeight=clientHeight=528`을 확인했다.
- 기존 ROOT E2E `tests/24-responsive.spec.ts`: **22/24 실행 테스트 passed**.
  390/768/1024/1280/1440 양언어·테마 대표 테스트와 384 결과 overflow 테스트는
  통과했다. 384 multi-marker setup은 marker fixture 선행 단계에서, 두 `tests/17`
  케이스는 저장소 외부 CFX fixture/환경에서 실패하여 P7 동작 판정에 사용하지 않았다.

제한: `tests/20-keyboard.spec.ts`는 현재 worktree root에 `@axe-core/playwright`가
없어 실행하지 못했다. 키보드 semantics는 기존 FE 전체 테스트와 P7 집중 테스트에서
회귀 없이 확인했으며, 실제 브라우저 keyboard E2E는 의존성 설치 후 재실행해야 한다.
또한 390px에서 API fixture로 384 Setup을 강제하면 기존 3열 레이아웃의 panel 폭이
수축하는 별도 반응형 이슈가 관찰되어 후속 UI 작업으로 남긴다.

**P7-S0-V: PASS.** 원격 push·배포는 수행하지 않았다.
