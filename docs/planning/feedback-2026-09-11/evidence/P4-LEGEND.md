# P4-LEGEND — Plate view legend

User request (2026-09-12, direct): "플레이트뷰 옆에 범례 필요해" (need a legend next to the plate view).

## Root cause

`PlateView` paints each well with a background color + glyph derived from
`callAppearance(key, ploidy, dark, t)` in `src/lib/chart-semantics.ts`, but
nothing on screen explains what a given color/glyph combination means. The
scatter plot has a Plotly legend; the plate view had none.

## Approach — reuse `callAppearance`, never re-derive color/glyph/label

`PlateLegend` (`src/components/analysis/PlateLegend.tsx`) takes the plate's
wells plus the same `showManualTypes` / `showAutoCluster` / `ploidy` / `dark`
inputs `PlateView` already has, and:

1. Computes the displayed call for every well with `displayedCall()` — the
   exact function `PlateView` uses per-cell — and counts occurrences per key.
2. Skips wells whose displayed call is `null` (no manual or auto call yet);
   these are not "existing calls" and must not appear.
3. Orders the surviving keys with the same convention already used by
   `MarkerScatterPlot.tsx` for its trace legend order: dosage classes highest
   dosage first (via `dosageOfLabel`), then any other assigned type
   alphabetically, `Unassigned` last. This ordering function lives locally in
   `PlateLegend.tsx` since it is presentation-only ordering, not an
   assignment rule — `chart-semantics.ts` itself was not touched (read-only,
   per task scope).
4. For each surviving key, calls `callAppearance(key, ploidy, dark, t)`
   directly — the **same** function `PlateView.tsx:434`'s cell rendering
   calls — so color, glyph and label can never drift from what's painted on
   the grid. If ploidy or the color palette changes (e.g. future P6 palette
   work), both the cells and the legend repaint from the same source and
   stay in sync by construction.
5. Renders nothing (`return null`) when the resulting entry list is empty —
   covers both an empty plate (`wells = []`) and a populated plate where no
   well has a manual or auto call yet.

Existing-calls-only behavior verified in the shipped demo plate: the
built-in ploidy-2 example plate only ever shows `Hom-1`, `Het`, `Hom-2`,
`NTC` in the legend — never `Positive Control`, `Unknown`, `Undetermined`,
`Empty`, `Omit`, or `Unassigned`, none of which occur on that plate (see
screenshot below).

## TDD — RED first

`src/components/analysis/PlateLegend.test.tsx` was written before
`PlateLegend.tsx` existed; first run:

```
FAIL  src/components/analysis/PlateLegend.test.tsx
Error: Failed to resolve import "./PlateLegend" ... Does the file exist?
```

7 tests cover:
- only calls present on the plate are listed (not the full possible set)
- each entry's swatch color + glyph + label match `callAppearance()`'s
  output for that key/ploidy/dark combination
- an absent genotype (e.g. `Allele 1 Homo` with no such well) does not
  appear
- no calls at all → renders nothing (`toBeEmptyDOMElement()`)
- empty plate (`wells: []`) → renders nothing
- ploidy change swaps the dosage label set (diploid trio vs. a
  higher-ploidy dosage label, e.g. `AAAB` at ploidy 4) — same key produces a
  different displayed appearance depending on ploidy, matching what the
  grid would show
- `showManualTypes`/`showAutoCluster` toggle the displayed call the same
  way the plate cells resolve it (manual overrides auto when both are on)
- well counts are correct (3 NTC wells → "NTC: 3")

After adding `PlateLegend.tsx` + the `plateLegendAria` translation key
(en/ko), all 7 pass (GREEN); no changes were needed after that
(REFACTOR was a no-op — the implementation was already reusing
`callAppearance`/`displayedCall`/`dosageOfLabel` from existing modules).

## Placement and vertical-space budget

Rendered directly below the plate grid, inside `.plate-panel`, gated on
`status === "ready"` (same guard as the grid itself) so it never shows
during loading/error and disappears the instant the plate becomes empty.
Internally it's a single `flex-wrap` row (`role="list"`) of compact chips
(swatch + glyph, label, count) — "가로로 흐르는 조밀한 배치" as requested; it
wraps to additional lines only if the plate has enough distinct calls (up
to 9 possible types) to not fit one line at the panel's width.

Measured with Playwright against the running dev server (1440×1000
viewport, `example-select` #2, cell A1 selected — same conditions as
`tests/24-responsive.spec.ts`'s second test):

| | before legend | after legend |
|---|---|---|
| `.plate-panel` height | 348px | 372px (+24px: legend row + `mt-2`) |
| `.detail-panel` bounding box | y 725, h 134 → bottom 859 | y 749, h 134 → bottom 883 |
| slack to the 1000px viewport floor | 141px | 117px |
| `[data-testid="plate-legend"]` | — | y 708, h 16 (single row) |

The legend adds 24px of height in this scenario, well inside the 141px of
slack that existed before this change; `.detail-panel`'s bottom (883px) and
`#scatter-plot`/`#plate-grid` all still fit inside the 1000px viewport.

Screenshots (`docs/planning/feedback-2026-09-11/evidence/plate-legend-light.png`,
`plate-legend-dark.png`) show the built-in demo plate with legend
`▲ Hom-1 12  ● Het 12  ■ Hom-2 12  + NTC 4` directly under the grid, in both
themes; the black NTC swatch keeps a `--color-border` outline
(`.plate-legend-swatch` in `src/index.css`) so it stays distinguishable
from the dark-mode panel background.

## Accessibility

- `role="list"` / `role="listitem"` structure, with `aria-label="Plate
  legend"` (`t.plateLegendAria`, en/ko) on the list.
- Each item's `aria-label` is `"<full call name>: <count>"` (e.g. `"Allele 1
  Homo: 12"`), so a screen reader gets the same information a sighted user
  gets from the swatch + glyph + label + count — not color alone.
- The swatch's inner glyph `<span>` is `aria-hidden` (decorative; the
  glyph character is already surfaced as visible/accessible text via the
  item's own text content, which duplicates the glyph — this is
  intentional: sighted users pattern-match the glyph shape against the
  plate cells, and the label text carries the actual meaning for
  assistive tech).
- No new colors were introduced; swatch colors are `wellInfo(key, ploidy,
  dark).color`, the same values already used (and already
  contrast-checked) for the plate cells and scatter markers.

## Verification

```
cd snp-analyzer/frontend
npx tsc --noEmit   # clean
npm run lint       # clean (eslint .)
npm run test       # 112 files / 775 tests passed (baseline 111/768 + 1 file/7 tests)
npm run build      # succeeds (tsc -b && vite build); pre-existing >500kB chunk-size
                    # warning only, unrelated to this change
```

E2E regression guard:

```
E2E_BASE_URL=http://127.0.0.1:8124 npx playwright test tests/24-responsive.spec.ts \
  --project=chromium --workers=1 --reporter=list
# 23 passed (1.5m) — including the 1440×1000 fit check for
# #scatter-plot / #plate-grid / .detail-panel (test at line 51) and the
# 384-well marquee/scroll test (test at line 4).
```

## Files changed

- `src/components/analysis/PlateLegend.tsx` (new)
- `src/components/analysis/PlateLegend.test.tsx` (new)
- `src/components/analysis/PlateView.tsx` (renders `<PlateLegend>` below the
  grid, gated on `status === "ready"`)
- `src/locales/en.ts`, `src/locales/ko.ts` (`plateLegendAria` key only; all
  displayed labels reuse existing `callLabel`/`wellType*` translations via
  `callAppearance()`)
- `src/index.css` (`.plate-legend-swatch` border, dark-mode legibility)

`chart-semantics.ts` was read-only, as instructed — no changes.
`PlateView.cycle.test.tsx` did not need changes; all its existing
assertions still pass unmodified.
