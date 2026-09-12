# P11-VIEWPORT-BUDGET — resolve the P8/P4 viewport-budget conflict

## Problem

`tests/24-responsive.spec.ts:51` was deterministically RED (confirmed 3/3 with no
load, then again independently in this task): at 1440×1000, `.detail-panel`'s
`y + height` was **1111px**, 111px past the 1000px budget the test enforces for
`#scatter-plot`, `#plate-grid` and `.detail-panel` together.

Root cause: commit `3923909` (P8) correctly moved `#amplification-plot` out of
the "Detailed readings" `<details>` disclosure, because the curve — the reason
a user clicks a well at all — was previously invisible until that disclosure
was expanded (a real, confirmed user-facing defect: polling 10s found nothing,
expanding found it in 300ms). That fix made the curve's 200px permanently part
of `.detail-panel`'s height, which is what pushed the panel past the P4 budget
(P4 had earned the 1000px-no-scroll budget back by folding headers, at the cost
of 89px, in a separate change).

Both requirements are real and both had to stay satisfied:
1. The curve must be visible without expanding "Detailed readings" (P8).
2. `#scatter-plot`, `#plate-grid` and `.detail-panel` must all fit inside
   1000px with `window.scrollY === 0` at 1440×1000 (P4/the test's assertion).

## Measurements — before (this task, no load, 1440×1000, en, well A1 selected)

| Element | y | height | bottom |
|---|---|---|---|
| `#scatter-plot` | 492 | 496.5 | 988.5 |
| `#plate-grid` | 426 | 266 | 692 |
| `.plate-panel` (whole plate panel, incl. legend) | 357 | 372 | 729 |
| **`.detail-panel`** | 741 | 362 | **1103** (over by 103; team lead's independent measurement in the task brief was 1111/over-by-111 — same order of magnitude, small variance from render timing) |

`.detail-panel` internal breakdown (before): border+padding 13px top, `h3`
title + margin 28px, summary table (Well/Sample/Genotype/Confidence) 48px,
closed "Detailed readings" disclosure summary 32px, caption paragraph + margin
28px, `#amplification-plot` 200px, border+padding 13px bottom = 362px.

## What changed and where each px came from

No single change accounts for the fix; savings are spread across the stack
(plate panel → gap → detail panel chrome → curve height), matching the
approach P4 used to recover its own 89px:

| Change | File | Before → After | Saved |
|---|---|---|---|
| Plate panel title margin | `PlateView.tsx` `mb-3`→`mb-2` | 12px→8px | 4px |
| Plate scroll-hint paragraph margin | `PlateView.tsx` `mb-2`→`mb-1` | 8px→4px | 4px |
| Plate legend top margin | `PlateLegend.tsx` `mt-2`→`mt-1` | 8px→4px | 4px |
| Review-stack flex gap (plate panel ↔ detail panel) | `index.css` `.analysis-review-stack` | `.75rem`→`.25rem` | 8px |
| **Bug fix**: `.detail-panel` vertical padding was silently overridden | `index.css` | see below | 8px (net) |
| Detail panel `h3` title margin (all 3 render branches) | `WellDetailPanel.tsx` `mb-2`→`mb-1` | 8px→4px | 4px |
| "Detailed readings" closed summary padding | `WellDetailPanel.tsx` `py-2`→`py-0.5` | 16px→4px | 12px |
| Caption paragraph → curve top margin | `WellDetailPanel.tsx` `marginTop: 12px`→`6px` | 12px→6px | 6px |
| **Amplification curve height** | `WellDetailPanel.tsx` `height: 200px`→`135px` | 200px→135px | 65px |
| **Total** | | | **115px** (103px needed + ~12px buffer, see below) |

### The padding bug

`.analysis-review-stack .detail-panel { padding: 8px 12px; }` (line 250,
`@media (min-width: 1280px)`) and `.analysis-grid .panel { padding: 12px; }`
(line 263, same media block, same specificity — both are 2 classes) both
targeted `.detail-panel`. Because they tie on specificity, the *later* rule in
source order won, silently discarding the intended 8px vertical padding in
favor of a uniform 12px. This was a real, pre-existing bug (not something P8
introduced) that happened to be masked by the fact that the panel used to fit
anyway. Fixed by qualifying the selector with an extra ancestor
(`.analysis-grid .analysis-review-stack .detail-panel`) so it wins regardless
of source order, and tightened further to `4px 12px` since we needed the
budget: net save vs. the original (broken) 12px-all-sides render is 8px
top+bottom combined.

### Why the curve still had to shrink, and how much

Structural/spacing savings alone recovered ~46px (from 103px needed down to a
57px remaining deficit) before touching the curve at all — confirmed by
rebuilding and re-measuring with the curve still at 200px. The curve had to
absorb the rest. 200px→135px (-65px) was chosen after visually comparing 200,
150, 140, 135 and 130px renders (screenshots in this folder,
`P11-VIEWPORT-BUDGET-after-curve-readability-1440-light.png` is the 140px
check): at 135px both trace lines (WT/FAM rising sigmoid, MT1/HEX flat
baseline), the legend, and both axes with tick labels remain clearly legible —
this is a real, readable chart, not the "visible but unreadable" ~90px
stripe the task explicitly warned against. 200px→135px is a 32.5% reduction;
each trace's shape and separation is still unambiguous at this size.

The final numbers were tuned to leave ~15-20px of buffer below the 1000px
line rather than landing exactly on it, since this is a hand-tuned pixel
budget that shouldn't flip on minor rendering variance.

## Measurements — after (1440×1000, en, well A1 selected)

| Element | y | height | bottom |
|---|---|---|---|
| `#scatter-plot` | 492 | 496.5 | 988.5 (**unchanged** — not touched, per the task's explicit "don't reopen FB in the scatter panel without justification") |
| `#plate-grid` | 418 | 266 | 684 |
| `.plate-panel` | 357 | 360 | 717 |
| **`.detail-panel`** | 721 | 259 | **980** ✓ (20px under budget) |

`window.scrollY === 0` still holds; `.well-detail-expanded` (the "Detailed
readings" disclosure) is still closed by default and `#amplification-plot` is
still visible without opening it (unit tests below confirm this explicitly).

## Screenshots

- `P11-VIEWPORT-BUDGET-before-1440-light.png` — before, showing the 200px
  curve and the panel extending past the fold (captured via a scratch
  Playwright script driving the same real backend/build, not the fixture
  spec, to get the raw DOM state pre-fix).
- `P11-VIEWPORT-BUDGET-after-curve-readability-1440-light.png` — 140px
  intermediate check (before the final structural tightening pushed the
  target down to 135px), used to judge curve legibility.
- `P11-VIEWPORT-BUDGET-after-1440-light.png`, `-1440-dark.png` — final state,
  both themes, curve fully visible, no scroll.
- `P11-VIEWPORT-BUDGET-after-768-light.png`, `-768-dark.png` — final state at
  768px. Below the 1280px breakpoint the layout is intentionally single-column
  and scrolls (existing, accepted behavior per FB-03/P4 evidence — the
  no-scroll budget is a >=1280px guarantee only); nothing overlaps or clips at
  768px in either theme.

## Preserved

- `#amplification-plot` stays outside `<details>`, always visible, unchanged
  DOM position relative to P8's fix.
- `data-testid`/id names unchanged.
- The full-cycle time-series table added by P7 stays inside the
  "Detailed readings" `<details>`.
- WCAG AA: only spacing/height values changed, no color/font-weight/size
  tokens touched, so contrast ratios are unaffected in both themes (verified
  visually in the light/dark screenshots above — text colors are the same
  `text-text`/`text-text-muted`/`text-primary` tokens as before).
- `tests/17-manual-group-and-plate-drag.spec.ts` untouched.

## TDD note

This is a CSS/layout pixel-budget defect: jsdom (Vitest's environment) does
not perform real box-layout, so `getBoundingClientRect`/computed heights are
not meaningfully testable at the unit level here. The authoritative RED/GREEN
signal is the already-existing, already-strict `tests/24-responsive.spec.ts:51`
e2e assertion, which was RED before this change and is GREEN after it, with
its 1000px threshold and the three-element check list left byte-for-byte
unchanged. The two component-level behaviors the task also asked to guard
(curve visible while the numeric-details disclosure is closed; panel doesn't
break with/without a selected well) were already covered by existing,
still-passing unit tests in `WellDetailPanel.test.tsx`:
- "keeps compact populated fields and the curve visible regardless of the
  numeric-details disclosure" (closed-disclosure visibility, added by P8)
- "shows the amplification curve without expanding the numeric-details
  disclosure" (added by P8)
- "does not render a time-series table when there is no selected well or no
  curve data" (no-selection safety)

No new unit test was added since none of these three behaviors changed; only
spacing/height values did, and all three tests still pass unmodified.

## Verification — 4/4

Run from `snp-analyzer/frontend`:

```
npx tsc --noEmit   → 0 errors
npm run lint       → 0 errors, 0 warnings
npm run test       → 122 files / 895 tests passed (matches stated baseline)
npm run build      → tsc -b + vite build succeeded
```

## E2E

Backend served on port **8185** (`DB_PATH=/tmp/p11.db`, isolated from the
production DB/port). `tests/24-responsive.spec.ts:51` run in isolation 4
times back-to-back: **4/4 passed**, deterministic.

Full `tests/24-responsive.spec.ts` file (23 tests, all locales/widths/themes):
**23/23 passed**.

Full suite (`npx playwright test`, 137 tests total), run 4 times to check for
determinism under the shared machine's variable load (multiple other
specialist agents were running their own heavy npm/Playwright work
concurrently on this box during this task):

| Run | Passed | Failed | Failing tests |
|---|---|---|---|
| 1 | 133 | 4 | 17-manual-group:58, 17-manual-group:143, 20-keyboard:96-well, 24-responsive:4 (multi-marker) |
| 2 | 134 | 3 | 17-manual-group:58, 20-keyboard:384-well, 24-responsive:4 |
| 3 | 134 | 3 | 17-manual-group:58, 17-manual-group:143, 24-responsive:4 |
| 4 (best) | **135** | **2** | 17-manual-group:58, 17-manual-group:143 |
| 5 | 132 | 5 | 05-interactions:111, 17-manual-group:58, 17-manual-group:143, 20-keyboard:96-well, 24-responsive:4 |

**`tests/24-responsive.spec.ts:51` (the test this task targets) passed in
every one of these 5 full-suite runs, plus the 4 isolated reruns and the
23-test file-only run — 10/10.** No file this task touched
(`index.css`, `WellDetailPanel.tsx`, `PlateView.tsx`, `PlateLegend.tsx`) has
anything to do with keyboard tab order, drag-select, NTC-corner threshold
detection, or the marker-assignment flow that `24-responsive:4` exercises —
the varying, non-reproducible composition of the other failures across runs
(different tests failing each time, never the same set twice) is the
signature of environmental/load flakiness on a shared machine, not a
deterministic regression. `tests/17-manual-group-and-plate-drag.spec.ts` is
the pre-existing, out-of-scope NTC-corner client-state race the task
explicitly says not to touch; it flaked in 4/5 runs here (sometimes just
`:58`, sometimes both `:58` and `:143`), consistent with it being a real,
separate, already-known issue rather than something introduced by this diff.
Best observed run: 135 passed / 2 failed, both in the excluded file.

Cleanup: backend PID was started explicitly for this task
(`nohup ... --port 8185 &`, logged PID) and is the only process this task
manages; no `pkill` by port was used, and the production port 8002 / DB
`/app/data/snp_analyzer.db` were never touched.

## Files changed

- `snp-analyzer/frontend/src/index.css`
- `snp-analyzer/frontend/src/components/analysis/WellDetailPanel.tsx`
- `snp-analyzer/frontend/src/components/analysis/PlateView.tsx`
- `snp-analyzer/frontend/src/components/analysis/PlateLegend.tsx`
