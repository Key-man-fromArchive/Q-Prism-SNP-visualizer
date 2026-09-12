# P4-EXPORT — PNG export ignores the selected scatter aspect ratio

Branch: `feedback/p4-results` (worktree `worktree/feedback-p4`, shared with
the concurrently-running P4-S3-T1 -- write scope did not overlap).

Write scope touched:
- `snp-analyzer/frontend/src/hooks/use-exports.ts`
- `snp-analyzer/frontend/src/hooks/use-exports.test.tsx`

No file outside this list was written. `src/lib/chart-export-registry.ts`
and `src/components/analysis/ScatterPlot.tsx` /
`src/components/analysis/MarkerScatterPlot.tsx` were read-only references,
as instructed.

## Problem

`useExports().exportPNG` hardcoded the PNG capture size:

```ts
const dataUrl = await Plotly.toImage(chart.element, {
  format: 'png',
  width: 1200,
  height: 900,
  scale: 2,
});
```

1200×900 is exactly 4:3. P4-S1-T1 added a `4:3` / `1:1` scatter-aspect
dropdown (`settings-store.scatterAspect`) that resizes
`.analysis-scatter-canvas` via CSS (`aspect-ratio` var), confirmed by browser
measurement at 850×638 (4:3) and 638×638 (1:1). Selecting `1:1` changed the
on-screen plot to a square, but the exported PNG stayed 4:3 (900px tall for
a plot that renders square) -- the export silently ignored the very control
the user picked the shape with.

## `ActiveChart.element` check (required before implementing)

Read `src/lib/chart-export-registry.ts` and both scatter components' calls
to `setActiveChart`:

- `ScatterPlot.tsx:516` and `MarkerScatterPlot.tsx:483` both call
  `setActiveChart({ element, ... })` where `element` is `plotRef.current`
  -- the Plotly-owned `<div id="scatter-plot">` (or the marker-plot
  equivalent), **not** the outer `.analysis-scatter-canvas` container.
- That inner div is rendered with `style={{ width: '100%', height: '100%' }}`
  as the sole child of `.analysis-scatter-canvas`
  (`ScatterPlot.tsx:1027-1032`), and `.analysis-scatter-canvas` is the
  element carrying the `--scatter-aspect-w/h`-driven `aspect-ratio` CSS
  (P4-S1-T1, `index.css`).
- Because the Plotly div fills its aspect-ratio-constrained parent exactly,
  `chart.element`'s own `getBoundingClientRect()` / `clientWidth`+
  `clientHeight` already reflect the true rendered shape -- 4:3, 1:1, or
  whatever a 70vh clamp forced it to on a short viewport. No change to
  `chart-export-registry.ts` or either scatter component was needed;
  `chart.element` is the right thing to measure.

## Fix

`use-exports.ts` now derives the PNG capture size from the element instead
of a fixed 1200×900:

```ts
const FALLBACK_CAPTURE_SIZE = { width: 1200, height: 900 };
const CAPTURE_LONG_SIDE = 1200;

function pngCaptureSize(element: HTMLElement): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  const width = rect.width || element.clientWidth;
  const height = rect.height || element.clientHeight;
  if (!width || !height) return FALLBACK_CAPTURE_SIZE;
  if (width >= height) {
    return { width: CAPTURE_LONG_SIDE, height: Math.round(CAPTURE_LONG_SIDE * (height / width)) };
  }
  return { width: Math.round(CAPTURE_LONG_SIDE * (width / height)), height: CAPTURE_LONG_SIDE };
}
```

- **Resolution kept constant**: the long side is always pinned to
  `CAPTURE_LONG_SIDE = 1200` (matching the legacy width), and `scale: 2` is
  unchanged, so a 4:3 export still comes out at the same 2400×1800 pixels it
  always did; only a non-4:3 shape now scales the short side to match the
  real ratio instead of forcing 900.
- **Fallback preserved**: if `getBoundingClientRect()` yields 0 (element not
  laid out -- jsdom in tests, or a disconnected/hidden element) and
  `clientWidth`/`clientHeight` are also 0, the export falls back to the
  exact legacy `1200×900` rather than encoding a degenerate image.
  `getBoundingClientRect()` is preferred over `clientWidth`/`clientHeight`
  alone because it reports fractional/subpixel layout sizes under CSS
  `aspect-ratio`, but `clientWidth`/`clientHeight` remain the fallback
  reader for environments where `getBoundingClientRect()` itself returns an
  all-zero rect object rather than throwing.
- Everything else in `exportPNG` (ownership/condition checks, caption
  compositing via `captionPng`, the download anchor) is untouched. The
  `exportPDF`/`exportXlsx`/`exportCsv`/`exportStored`-for-csv/pdf/xlsx paths
  were not touched at all.

## TDD

### RED

Added three tests to `use-exports.test.tsx` and confirmed RED by
temporarily stashing only the `use-exports.ts` implementation change
(`git stash push -u -- src/hooks/use-exports.ts`, then `git stash apply`
+ `git stash drop` on the same entry to restore it -- no other worktree's
concurrent stash entries were touched):

```
 FAIL  src/hooks/use-exports.test.tsx > RED/GREEN: captures a square PNG at
 the rendered element size, not the legacy 4:3 default
AssertionError: expected "vi.fn()" to be called with arguments:
  [ <div></div>, ObjectContaining{…} ]
Received:
  [ <div />, { format: 'png', height: 900, scale: 2, width: 1200 } ]
```

(The other two new tests -- 4:3-shaped element, and zero-size fallback --
pass even against the pre-fix code, since the legacy hardcode already
happens to be 4:3/1200×900; they exist to pin the *replacement* behavior
against regression, and the square-element test is the one that actually
falsifies the pre-fix code.)

New tests added:
1. `captures a square PNG at the rendered element size, not the legacy 4:3
   default` -- element mocked to 638×638 via `getBoundingClientRect` ->
   expects `{ width: 1200, height: 1200 }`.
2. `captures a ~4:3 PNG matching a wider-than-tall rendered element` --
   element mocked to 850×638 -> expects width 1200, height within
   895–905 (≈900, i.e. ~4:3 without demanding bit-exact rounding).
3. `falls back to the legacy 1200x900 capture when the element has no
   rendered size` -- unmocked `document.createElement('div')` (jsdom
   default 0×0) -> expects the exact legacy `{ width: 1200, height: 900 }`.

### GREEN

Restored the implementation; all three new tests pass, plus the full
existing `use-exports.test.tsx` suite (ownership/condition-mismatch,
stored-export staleness/legacy guards, cancellation, stored-PNG
render-and-restore, ownership-changes-during-caption, registry-generation
replacement) is unchanged and still green -- 13/13 tests in the file.

## Verification (all 4, from
`worktree/feedback-p4/snp-analyzer/frontend`)

```
npx tsc --noEmit         # clean, no output
npm run lint             # clean, no errors/warnings
npm run test             # 110 files / 764 tests passed
                          #   (baseline at task start: 110 files / 761 tests;
                          #   +3 are this task's new use-exports tests;
                          #   no other file's test count or pass/fail
                          #   changed, so no P4-S3-T1 concurrent-write
                          #   collateral was observed)
npm run build             # tsc -b && vite build succeeded
```

## Scope discipline

- Only `src/hooks/use-exports.ts` and `src/hooks/use-exports.test.tsx` were
  edited and staged; `git add` was run by explicit path, never `-A`/`.`.
- `src/lib/chart-export-registry.ts` was read but not modified -- confirmed
  `ActiveChart.element` is already the correct measurement target (see
  above), so no registry change was needed.
- `AnalysisTab.tsx`, `WellSelectionToolbar.tsx`, `index.css`,
  `locales/en.ts`, `locales/ko.ts` and their tests (P4-S3-T1's scope) were
  not touched.
- PDF/XLSX/CSV export code paths were not touched.
- No merge to `main`, no remote push, no branch change.
