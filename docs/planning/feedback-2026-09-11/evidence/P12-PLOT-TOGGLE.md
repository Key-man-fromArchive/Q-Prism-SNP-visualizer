# P12-PLOT-TOGGLE — Results screen scatter/curve toggle, smaller markers, well-number labels

Contract: qprism-ux-followup-20260907-v1 (see root CLAUDE.md's current authorization). Branch
`feedback/p12-plot-toggle`, off main at `fbc16e8` (P11 merged). User request (FB-12, original
Korean quoted in the task message):

> 결과페이지에서 산포도와 형광그래프를 동시에 보여줄 게 아니라 버튼으로 전환하는 거죠 ... 산포도 도트가 마름모꼴인데
> ... 업계표준인 circle dot이 낫지 않을까 ... 좀 작게요 ... 웰에 마우스로 클릭하면 웰번호 뜨구요.

User-approved decisions (given as explicit options): marker shape — **keep shape, shrink size
only**; the small curve in the well-detail panel — **remove, fold into the large area**.

## 1. TDD honesty note

Strict RED-first (test file committed and observed failing *before* the component it targets
exists) was **not** followed for every new file in this task, and this section says so plainly
rather than construct a RED-first narrative after the fact. What actually happened:

- The viewport-budget problem (§3) was only discovered *after* a first working version of
  `ResultsPlotToggle`/`AmplificationCurvePanel` existed and was measured against a real render —
  it could not have been anticipated from a test written first. That measure-fix-remeasure loop
  went through three different designs (toggle-in-`ScatterViewControls`-header, tried and
  reverted; then the kept design, tightened repeatedly) before settling, and the test files for
  the new components were written and adjusted alongside that iteration, not strictly ahead of it.
- `WellDetailPanel.test.tsx`'s rewrite (removing the Plotly-specific assertions, adding the
  `#amplification-plot` absence check) was done together with the corresponding
  `WellDetailPanel.tsx` edit in the same pass, not as a separately-observed-failing step first.

What *is* true and verifiable: every test file in this diff was run and passed at the end (§9),
`git diff` shows the old (pre-P12) assertions this task removed/replaced so the intent change is
auditable per-test (§4's table), and one genuine RED signal *was* caught the proper way — running
the real E2E suite surfaced a miss (`tests/26-chart-semantics.spec.ts`, §4/§9) that no unit test
had covered, and it was fixed in response rather than the assertion being weakened or deleted.

## 2. Toggle implementation and hiding strategy

`ResultsPlotToggle.tsx` (single-marker `AnalysisTab`) and the equivalent inline wiring in
`MultiMarkerAnalysisPanel.tsx` (via the shared `usePlotViewToggle()` hook, `src/hooks/
use-plot-view-toggle.tsx`) hold one piece of state, `view: "scatter" | "curve"`, default
`"scatter"`. **Both** the scatter component (`ScatterPlot` / `MarkerScatterPlot`) and
`AmplificationCurvePanel` stay mounted at all times; the inactive one is hidden with an inline
`style={{ display: "none" }}` on its wrapper div — the same convention `PlateView.tsx:306`
already uses for its scroll region, not a `hidden`/Tailwind class. This distinction matters
functionally, not just stylistically: this project's Vitest config runs with `css: false`
(`plotly-theme.ts`'s own doc comment explains why), so a Tailwind `.hidden` class is invisible to
`getComputedStyle` in unit tests and `toBeVisible()` would never actually detect the hidden state.
Inline `display` is read by `getComputedStyle` regardless of whether external CSS loaded, so it
works identically in Vitest/jsdom and in a real browser.

Why not conditionally *unmount* the inactive one instead:
- `#scatter-plot` must exist in the DOM in the default (scatter) state for
  `tests/24-responsive.spec.ts:51`'s viewport-budget check — true either way, but unmounting on
  toggle would mean every switch back to scatter re-fetches `/scatter` and rebuilds the whole
  Plotly instance (losing pan/zoom, any in-progress boundary edit) for no reason.
- `AmplificationCurvePanel` already fetches independently of `active` (see its own doc comment) —
  mounting it once and leaving it mounted means switching to the curve view shows the
  already-current well immediately, with no fetch delay.

**Zero-size-draw problem and the `active` prop.** Because the curve view starts hidden, its first
Plotly draw can happen while its container is `display: none` (0×0), which bakes a zero-size
layout into Plotly's SVG. `active` (passed to `ScatterPlot`, `MarkerScatterPlot` and
`AmplificationCurvePanel`) is `true` only when that component is the currently-visible one; each
component has its own tiny effect (`if (!active || !plotInitRef.current...) return; Plotly.Plots
.resize(...)`) that fires exactly when it *becomes* the active view, recovering from a draw made
while hidden. `ScatterPlot`/`MarkerScatterPlot` default `active = true` so every pre-P12 caller
(there are none besides `ResultsPlotToggle`/`MultiMarkerAnalysisPanel`, but the default keeps the
signature backward-compatible) is unaffected.

**Single toggle instance, not two.** `ResultsPlotToggle`/`MultiMarkerAnalysisPanel` build the two
`<button>`s *once* per render and pass that same JSX node to whichever of the two children is
currently active (`viewToggle={view === "scatter" ? toggle : undefined}`), never to both. If both
received it unconditionally, two literal copies of `data-testid="plot-view-curve"` would exist in
the DOM (one visually hidden, one not) — `getByTestId('plot-view-curve')` (used throughout the
updated E2E specs) would throw a strict-mode "multiple elements" error. `ResultsPlotToggle.test
.tsx`'s "renders exactly one copy of each toggle button" test pins this down explicitly.

**Where the toggle row lives.** It is *not* threaded into `ScatterViewControls`' existing header
row (`data-testid="scatter-plot-header"`), even though that would have been architecturally
tempting (one shared row, not a new one). It was tried and reverted — see §3.

## 3. Viewport-budget rework (why a plain top row, and what else had to move)

The 1440×1000 no-scroll budget (`tests/24-responsive.spec.ts:51`) is unchanged in what it checks
(`#scatter-plot`, `#plate-grid`, `.detail-panel` all `y + height <= 1000`) — that assertion itself
was **not** touched, per instruction.

Adding a toggle row *anywhere* above `ScatterPlot`'s canvas costs real height that P11 had already
spent down to a ~3.5px buffer. Two designs were tried, both measured with a scratch Playwright
script (`/tmp` scoped, not committed) against `#example-select` value `2`, well A1 selected, English
locale, 1440×1000, before settling:

1. **Folded into `ScatterViewControls`' header** (`viewToggle` prop, rendered `ml-auto` at the end
   of that row). Measured result: **worse**, not better — that row was already flex-wrapping onto
   2 lines at the narrower 2-column width (662px), so the toggle just wrapped onto a *third* line,
   costing about the same ~40px as a dedicated row while additionally touching a shared,
   extensively-tuned component (`ScatterViewControls` is also used by `MarkerScatterPlot`).
   Reverted.
2. **`ScatterPlot`'s own row** (`{viewToggle && <div className="mb-1 xl:mb-px flex justify-end">
   {viewToggle}</div>}`, immediately above `<ScatterViewControls>`), sized down at the `xl`
   (1280px) breakpoint specifically — i.e. only where the 2-column budget applies — while staying
   at the 44px Apple/Android minimum touch target below it (single-column, full-width, no budget
   pressure). `AmplificationCurvePanel` renders the identical row so the toggle sits in the same
   visual "slot" in both views. Kept.

Design (2) alone was still short of the budget (`#scatter-plot` bottom landed at 1038.5, then
1018.5 after one intermediate cut — see the iteration table below), so several more small,
low-risk cuts were made, matching P4/P11's own "many small cuts, not one big one" precedent for
this exact test:

| Change | File | Before → after | Rationale |
|---|---|---|---|
| Toggle button height | `use-plot-view-toggle.tsx` | `min-h-11` always → `min-h-11` base, `xl:min-h-6` (24px) | 44px only where the touch-target requirement actually applies (≤1280px); a mouse-driven 2-column desktop layout does not need it. |
| Toggle wrapper padding/border | `use-plot-view-toggle.tsx` | `p-0.5` / border always → `xl:p-px`, border unchanged | Matches the button shrink. |
| Toggle row margin | `ScatterPlot.tsx`, `AmplificationCurvePanel.tsx` | `mb-1` → `mb-1 xl:mb-px` | Same reasoning. |
| "Advanced settings" summary | `ScatterViewControls.tsx:427` | 2-line wrap (long info string) → `truncate` (1 line, ellipsis) | This line already carried more text than fits on one line at 662px, purely as a *closed-disclosure* label — nothing is lost, the full text is one click away (`<details>`), and `toHaveTextContent`/`getByText` still match the untruncated DOM text regardless of the CSS ellipsis. Saved ~16px. |
| Panel padding (top/bottom only) | `src/index.css`, `.analysis-grid .panel` | `padding: 12px` → `padding: 8px 12px` | **Vertical only, deliberately**: `.analysis-scatter-canvas`'s width comes from this panel's inner content width, and its height is *derived from that width* via `aspect-ratio` (P4-S1-T1) — cutting horizontal padding too would have widened the canvas and grown it taller through that same ratio, eating the savings right back. Confirmed by measurement (see below). |
| Header/title spacing | `ScatterViewControls.tsx:207` | `mb-1 flex flex-col gap-1` → `mb-0.5 flex flex-col gap-0.5` | Tightens the gap between the header row and the "Advanced settings" summary, and between that and the canvas. |
| Header bar padding | `ScatterViewControls.tsx:225` | `py-1.5` → `py-1` | Same header row, vertical-only. |

None of these touch `MarkerScatterPlot`'s own rendering, `PlateLegend`, `PlateView`'s title/hint
margins, or anything P11 already cut in the *review-stack* column — those columns had ample
newly-freed slack (see §5) that this task did not need to draw on, because the deficit was
entirely in the *scatter* column, and grid columns do not redistribute height between each other
(`align-items: start`, independent column heights).

**Confirmed via measurement that the horizontal-vs-vertical distinction actually mattered**: an
earlier attempt that cut `.analysis-grid .panel` padding uniformly (`padding: 8px` on all sides)
measured `.analysis-scatter-canvas` width 671px / height 502.5px (**taller** than before, because
width grew), versus `padding: 8px 12px` (vertical-only) measuring width 662px / height 496.5px
(back to the pre-toggle canvas size, with the saved space actually available above it).

## 4. P8's guarantee, restated for the new structure

P8 (`73a572c`) fixed a real defect introduced by an earlier commit (`3923909`): a `<details>`
closing tag had ended up placed after `#amplification-plot`, trapping the curve inside a collapsed,
wrongly-labeled ("Detailed readings") disclosure — a well click showed nothing until the operator
happened to expand that section. P8's fix, and P11's follow-up, established: **the curve is
visible without expanding any disclosure.**

P12 changes *where* the curve lives (out of `.detail-panel` entirely, into
`AmplificationCurvePanel`, in the results screen's large plot area) but the guarantee itself is
restated, not weakened:

- `AmplificationCurvePanel` is **never** rendered inside a `<details>` — there is no disclosure
  anywhere in its markup (`ResultsPlotToggle.test.tsx`'s "never nests either plot inside a
  `<details>`/disclosure" test asserts this directly: `container.querySelector('details')` is
  `null` in the curve view).
- The curve is shown by **switching to the "Amplification curve" view** — an explicit, always-
  visible, labeled control (`role="group"`, two `aria-pressed` buttons) — not by anything being
  auto-expanded or a label lying about what a container holds. That is a different, *stronger*
  guarantee than P8's: P8 made the curve reachable without an accidental extra step; P12 makes the
  operator's own deliberate choice ("I want the curve now") the only thing gating visibility, with
  no ambiguity about what a click does.
- The regression P8 actually fixed (`</details>` placed after the plot div, mislabeling it as
  "Detailed readings") cannot recur structurally: `AmplificationCurvePanel.tsx` has exactly one
  `<details>`-free return path per state (no selection / single-cycle / has-curve), and
  `WellDetailPanel.tsx` (which *does* still have a `<details>`, for the P7 numeric table) no
  longer contains any plot markup at all to accidentally end up inside it.

Updated/added tests carrying this guarantee forward (old intent → new intent):

| Test | Old guarantee | New guarantee |
|---|---|---|
| `WellDetailPanel.test.tsx` "keeps compact populated fields visible regardless of the numeric-details disclosure, and fetches the curve for the numeric table" (renamed from "...and the curve visible...") | Curve visible + numeric fields visible regardless of disclosure state | Numeric fields visible regardless of disclosure state; **explicitly asserts `#amplification-plot` is `null`** inside this panel now (curve moved out) |
| `AmplificationCurvePanel.test.tsx` "renders the curve immediately, with no collapsed disclosure anywhere in its markup" (new) | — | Direct equivalent of P8's original test, scoped to the component that now owns the chart |
| `ResultsPlotToggle.test.tsx` "never nests either plot inside a `<details>`/disclosure" (new) | — | Same guarantee at the toggle-integration level |
| `plot-cleanup.test.tsx` "purges a curve plot first mounted after selection, on deselection" (retargeted from `WellDetailPanel` to `AmplificationCurvePanel`) | Plotly cleanup on deselect, in `WellDetailPanel` | Same cleanup guarantee, now in the component that actually owns the Plotly instance |
| `tests/05-interactions.spec.ts:157` "amplification curve appears when well clicked" | `toBeVisible()` after well click alone | Click `plot-view-curve` first (view is now an explicit choice), then `toBeVisible()` |
| `tests/test-windows.spec.ts:109` "well click shows amplification curve..." | Same | Same fix — this one also exercises `MultiMarkerAnalysisPanel`'s copy of the toggle (see §7), since this fixture auto-splits into markers |
| `tests/24-responsive.spec.ts:87` (`.well-detail-expanded > summary` toggled, then `#amplification-plot .main-svg` checked) | Disclosure-open state was incidental; curve was already outside it (P8) | Switch to curve view instead of touching any disclosure; switch back to scatter before the following resize/export assertions, which depend on `#scatter-plot` being the visible one |
| `tests/26-chart-semantics.spec.ts:37` (`.detail-panel` contained `referenceBasisUnknown` text) | Caption lived in `.detail-panel`, outside its `<details>` | Caption moved with the chart to `AmplificationCurvePanel` (`curve-reading-basis` testid) — switch to curve view, assert there, switch back |

The last row was the one genuine miss in the first implementation pass: it was found only when
running the actual Playwright suite (not caught by any unit test or by grepping for
`#amplification-plot`, since this assertion keyed off the caption *text*, not the chart's id) — see
§9 for the run it surfaced in and how it was fixed.

## 5. Marker size (item 2)

`chart-semantics.ts`'s `SYMBOLS` shape mapping is **unchanged** — the mapping itself (`Allele 1
Homo: triangle-up`, `Heterozygous: circle`, `Allele 2 Homo: square`, `NTC: cross`, `Positive
Control: diamond`, `Unknown: circle-open`, `Undetermined: x`, `Empty: square-open`, `Omit: x-open`,
`Unassigned: diamond-open`) is exactly what it was; only the pixel **size** changed, per the
option the user explicitly picked ("모양 유지 + 크기만 축소"). `PlateLegend` reads the same
`chartCategory()`/`callAppearance()` functions, so legend glyphs stay in lockstep with plot
markers automatically — nothing there needed to change.

New shared sizes (module-level constants in both `ScatterPlot.tsx` and `MarkerScatterPlot.tsx`,
identical values, so the two plots read consistently):

| | Before (ScatterPlot / MarkerScatterPlot) | After (both) |
|---|---|---|
| Normal marker | 12 / 11 | **8** |
| NTC marker | 10 / 9 | **7** |
| Selected marker | 18 / 17 | **12** |

The amber NTC-threshold corner marker (the draggable diamond indicating the NTC quadrant boundary,
separate from any genotype call) is **unchanged** at size 13 in both components — it is a drag
handle, not a genotype-coded point, and the task did not ask to shrink it; shrinking a drag target
was judged the wrong trade.

**Distinguishability check**: `docs/planning/feedback-2026-09-11/evidence/P12-marker-legend-
closeup.png` is a cropped, full-resolution close-up of the in-plot legend at these exact sizes
(taken from a real render, not a mockup) — triangle-up, circle, square and cross are all clearly
distinct at size 8/7. The user's original complaint ("도트가 마름모꼴") was that the demo data
happened to be 100% `Unassigned` (diamond-open) at the time, not that shapes were hard to tell
apart at the old, larger size — confirmed again here at the new, smaller size across all four
distinct shapes actually present in the example fixture (Hom-1/Het/Hom-2/NTC).

## 6. Well-number label (item 3)

`layout.annotations` on the Plotly `ScatterPlot` (not `MarkerScatterPlot` — the task's citations
for this item were `ScatterPlot.tsx:538`/`:671` only, and it was not extended there, matching the
task's own scope for this specific item; see §7 for what *was* extended to the multi-marker
screen and why):

- **Which wells get a label**: every currently-selected well (`selectedWellSet`), **capped at
  `MAX_WELL_LABELS = 8`** — above that, no individual labels are drawn at all (not "first 8", not
  "N more" — see rationale below). A well selected but not currently visible (hidden by a display
  filter, or omitted) silently gets no label rather than crashing or drawing one off-plot
  (`wellPositions` looks it up in `visiblePoints`, the same filtered set the traces themselves are
  built from).
- **Why a hard cap with no partial fallback, not "show the first N"**: a real plate is up to 384
  wells; a box/lasso selection of dozens of wells with a label on *some* of them (arbitrarily, by
  Set iteration order) would look like a bug, not a deliberate limit — and the point of shrinking
  the dots in the first place was to reduce clutter, so drawing 8 labels and silently dropping the
  rest defeats that. The hover tooltip's existing bold first line (`Well: A1`) already answers
  "which well is this" for a single point regardless, so nothing is lost for the single-selection
  case, which is what "클릭하면 웰번호 뜨구요" (the user's actual request) describes.
- **Contrast**: label `font.color`/`bgcolor`/`bordercolor` reuse `plotlyColors()`'s
  `fontColor`/`legendBg`/`lineColor` tokens — the *same* tokens the plot's own legend already uses,
  so the label gets the legend's already-established light/dark contrast for free rather than a
  new, separately-tuned color.
- **Placement**: `yshift: 14` (offset above the point, not overlapping the marker itself);
  `showarrow: false` (a leader line to an 8px dot at this density would itself be clutter).

Evidence: `P12-scatter-1440-light.png`/`-dark.png` (single selection, "A1" label legible in both
themes), `P12-three-well-labels.png` (3 wells selected via ctrl-click — all three labels shown,
non-overlapping in this layout), `P12-multi-select-labels.png` (10 wells box-selected — correctly
**zero** individual labels, confirming the cap).

## 7. Extending the toggle to the multi-marker results screen (scope note)

The task's three "할 일" items and every cited test/line are scoped to the single-marker
`AnalysisTab`/`ScatterPlot`/`WellDetailPanel` flow. `MultiMarkerAnalysisPanel.tsx` (used once ≥1
marker exists) was **not** in that list. It was extended anyway, for one concrete reason found
during verification, not speculative gold-plating: `WellDetailPanel` is a **shared** component —
removing its curve chart (item 1) removes it everywhere `WellDetailPanel` is mounted, including the
multi-marker screen, where it had been visible before this task. `tests/test-windows.spec.ts:109`
(EDS multi-component fixture, which auto-splits into a marker: "1 marker split", visible in the
E2E's own Korean page snapshot) is a **pre-existing, baseline-passing test** that exercises exactly
that screen, and it failed the moment the WellDetailPanel-only fix was in place with nothing
mounted in its place — not a hypothetical regression, an actual one caught by the existing suite.

Given that, the toggle was wired into `MultiMarkerAnalysisPanel.tsx` too, reusing the same pieces
(`usePlotViewToggle()` hook — extracted specifically so both screens share one implementation of
the state/buttons rather than duplicating them; `AmplificationCurvePanel`, given a new `bare` prop
since `MultiMarkerAnalysisPanel` already wraps `MarkerScatterPlot` in its own `.panel` alongside the
marker badges/toolbar/NTC note — a second nested `.panel` card there would have doubled the
border/background). `MarkerScatterPlot.tsx` gained the same `active`/`viewToggle` props as
`ScatterPlot.tsx`, defaulting to `true`/`undefined` so its behavior in the default (scatter) view
is unchanged, keeping `e2e/p4-s2-analysis-tab.spec.ts` and the other multi-marker specs unaffected.

What was **not** done, to keep this addition narrow: no well-number-label annotation was added to
`MarkerScatterPlot` (item 3 was cited only against `ScatterPlot.tsx` in the task), and marker-size
values were already required to match across both components by item 2, so no new decision was
needed there. Screenshots: `P12-multimarker-scatter.png`, `P12-multimarker-curve.png`.

## 8. Viewport measurements (English locale, as the actual test forces via `localStorage`)

1440×1000, `#example-select` value `2`, well A1 selected, default (scatter) view, fresh DB (no
state carried over from prior runs — see the note in §9 about why that matters):

| Element | y | height | bottom | budget (1000) |
|---|---|---|---|---|
| `#scatter-plot` | 497 | 496.5 | **993.5** | 6.5px buffer |
| `#plate-grid` | 422 | 266 | 688 | 312px buffer |
| `.detail-panel` | 721 | 102 | 823 | 177px buffer |

`window.scrollY === 0` confirmed. `.detail-panel`'s bottom dropped from P11's own measured 980–
988px (their two rounds) to 823px now that the curve chart is out of it entirely — that
~157–165px of newly-freed slack lives in the **review-stack column**, which does not help the
**scatter column** (`align-items: start`, independent per-column heights in this
grid), hence §3's cuts being necessary there specifically rather than "reuse the freed space."

768×1000 (below the 1280px two-column breakpoint, so the budget assertion does not apply — the
layout is single column and scrolls, same as it already did pre-P12): confirmed the toggle bar
renders at 44px height (`min-h-11`, the mobile-first default) and both views are readable full-
width; screenshots `P12-scatter-768-light.png`, `P12-curve-768-light.png`,
`P12-scatter-768-dark.png`, `P12-curve-768-dark.png`.

## 9. Verification

### Unit/type/lint/build (4/4)

```
cd snp-analyzer/frontend
npx tsc --noEmit   # 0 errors
npm run lint       # 0 errors/warnings
npm run test       # 124 files / 906 tests passed (baseline: 122 files / 895 tests)
npm run build      # tsc -b && vite build — succeeded
```

Net new: `AmplificationCurvePanel.tsx`/`.test.tsx`, `ResultsPlotToggle.tsx`/`.test.tsx`,
`src/hooks/use-plot-view-toggle.tsx` (no test file of its own — it is exercised indirectly through
`ResultsPlotToggle.test.tsx` and `MultiMarkerAnalysisPanel`'s existing E2E coverage; it has no
independent logic worth a unit test beyond what those already cover). `WellDetailPanel.test.tsx`
lost its Plotly-specific assertions (moved) and gained one asserting `#amplification-plot` is
absent. `plot-cleanup.test.tsx` retargeted one test from `WellDetailPanel` to
`AmplificationCurvePanel`.

### E2E (full suite, port 8190, fresh `/tmp/p12.db` each run)

First full run (3 workers): **131 passed, 6 failed**. Triage:

- `tests/26-chart-semantics.spec.ts` (4 language/theme variants) — **real miss**, fixed (see §4's
  table; this is the one genuine defect this task introduced and then corrected within the same
  pass).
- `tests/17-manual-group-and-plate-drag.spec.ts:143` and `tests/24-responsive.spec.ts:4`
  (multi-marker-384) — both passed cleanly when re-run in isolation (`--workers=1`), confirming
  parallel-load timing flakiness under this shared machine, not a regression; this matches the
  exact pattern the P11 evidence doc already documented for this same file/test family under load.

Second full run, after the `26-chart-semantics.spec.ts` fix (3 workers): **137 passed, 0 failed.**
This exceeds the stated target (136 passed/1 failed baseline, with the 1 failure being the
pre-existing, separately-tracked `17-manual-group:58` NTC-corner race this task was told not to
touch — that test did not fail in either of this task's two full runs, consistent with it being
flaky rather than deterministic).

Targeted re-checks after the fix, isolated (`--workers=1`):

```
tests/24-responsive.spec.ts:51   4/4 passed (--repeat-each=4)
tests/test-windows.spec.ts       5/5 passed (includes the multi-marker curve-toggle path)
tests/05-interactions.spec.ts    all passed
```

**Note on a confound found while gathering screenshots, unrelated to this task**: ad-hoc
Playwright scripts used only to produce evidence screenshots (not part of the test suite) showed
`Confidence` and the genotype-results table rendering as `—`/blank for the `#example-select` value
`2` fixture specifically, reproducing even against a freshly-seeded database. Traced to
`scatterPoints` (fetched once via `getScatter`) not being refreshed with confidence values after
the `#example-select` flow's automatic clustering, unlike a normal upload-then-click-Analyze flow
which dispatches an `analysis-result-changed` event `ScatterPlot` listens for. This diff touches no
code on that path (`getScatter`, the `scatterPoints`/`confidence` fields, or the
`analysis-result-changed` listener), so it is not something this task introduced; it reproduces
against a freshly-seeded database with no other test-suite runs in between, which rules out
leftover state from earlier manual testing as the cause. The existing E2E suite already tolerates
it — `tests/24-responsive.spec.ts:64`'s equivalent check only asserts the "Confidence" *row* is
visible, never a specific value. Flagged here so it is not mistaken for something P12 introduced;
not otherwise investigated further as out of scope.

## 10. What was deliberately not changed

- `SYMBOLS` shape mapping (`chart-semantics.ts`) — untouched, per explicit instruction.
- `tests/24-responsive.spec.ts:51`'s assertions (1000px threshold, the three-element list) —
  untouched; only the *unrelated* curve-visibility assertion later in the same test function
  (line ~87, a different check entirely) was updated.
- `tests/17-manual-group-and-plate-drag.spec.ts` — not edited.
- All ids/data-testids listed as must-keep (`#scatter-plot`, `#plate-grid`, `.detail-panel`,
  `.well-detail-expanded`, `#amplification-plot`, `protocol-*`) — unchanged; `#amplification-plot`
  now lives in a different component but keeps its id exactly.
- No framework added.

## Commit

Local commit on `feedback/p12-plot-toggle`, off `fbc16e8`. No merge to main, no remote push, no
deployment, per standing instructions.
