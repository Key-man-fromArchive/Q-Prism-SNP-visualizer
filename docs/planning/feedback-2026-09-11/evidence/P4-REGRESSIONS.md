# P4-REGRESSIONS — root E2E regressions introduced by P4

Branch: `feedback/p4-results` (worktree `worktree/feedback-p4`).
Baseline: orchestrator's full root E2E run showed **131 passed / 6 failed**
against P4's tip, vs. a P3 baseline of **132 passed / 4 failed** — 2
regressions attributable to P4 (`21-workspace-restore.spec.ts:21` and
`24-responsive.spec.ts:51`). The other 4 failures
(`06-import-mapping.spec.ts:10`, `17-manual-group-and-plate-drag.spec.ts:55`
and `:135`, `test-windows.spec.ts:109`) are pre-existing debt on `main` and
were not touched.

Write scope touched:
- `tests/21-workspace-restore.spec.ts`
- `snp-analyzer/frontend/src/components/analysis/ScatterViewControls.tsx`
- `snp-analyzer/frontend/src/components/analysis/ScatterPlot.tsx`

Not touched (in scope but no change needed): `MarkerScatterPlot.tsx`,
`AnalysisTab.tsx`, `AnalysisWorkspace.tsx`, `index.css`,
`locales/{en,ko}.ts`, unit tests.

## Regression 1 — `21-workspace-restore.spec.ts:21` — test updated

**Cause**: not a product bug. P4-S2-T1 intentionally removed the editable
ROX checkbox from the Settings tab (`#rox-normalize-checkbox` no longer
exists there — Settings now shows a read-only `rox-normalize-status` line)
and moved the editable control onto the scatter plot's own header bar
(`data-testid="scatter-use-rox"`), per the user's explicit request:

> ROX normalisation을 설정페이지에 들어가서 하는데, 이러지말고 대립유전자 판별
> 플롯 위에 Normalization 체크박스 만들어서 켜고 끌 수 있게

The test still drove the old Settings path and failed on
`await expect(rox).toBeVisible()` at the removed `#rox-normalize-checkbox`.

**Fix**: updated `tests/21-workspace-restore.spec.ts`'s second test to
toggle ROX via `page.getByTestId('scatter-use-rox')` (visible on the
results tab, no Settings/More-menu detour needed) instead of navigating
through Settings. No assertion was weakened or removed:
- `posts` counter (no `cluster`/`suggest-cycle` POST fired) — unchanged,
  still asserted `0` at the end.
- URL/session/surface restore across reload, `goBack()`/`goForward()` —
  unchanged.
- The final `expect(rox).not.toBeChecked()` still confirms the unchecked
  state survives the plate-tab detour, `reload()`, and back/forward — now
  checked directly against the header checkbox instead of round-tripping
  through Settings to read it.
- The redundant final `#tab-results` click (previously needed to get back
  from Settings to Results before reading `/api/data/.../cluster`) was
  removed since the checkbox lives on Results directly and the preceding
  `goForward()` already lands there (asserted via `aria-selected`).

Verified in isolation:
```
$ E2E_BASE_URL=http://127.0.0.1:8124 npx playwright test tests/21-workspace-restore.spec.ts --project=chromium --workers=1 --reporter=list
  3 passed (10.0s)
```

## Regression 2 — `24-responsive.spec.ts:51` — product fix (chrome reduction, no canvas shrink)

**Cause**: a real regression, introduced when P4-S3-T1's followups grew the
scatter canvas and compacted/re-expanded the chrome above it several times.
Orchestrator's measurement at 1440×1000 before this task:

```
#scatter-plot: top=592  height=497  bottom=1089   (89px over the 1000px viewport)
```

**Approach taken**: reduce chrome above the canvas, not the canvas itself —
per the instruction's stated priority and the user's original ask ("세로가
너무 낮습니다 … 최소한 정사각, 하다못해 4:3"). No `--scatter-max-h` /
`min-height` change was needed; the fix closed the gap entirely from
`ScatterViewControls.tsx`/`ScatterPlot.tsx` markup and spacing.

### What changed

1. **Panel `<h3>` folded into the header bar.** `ScatterPlot.tsx` no longer
   renders its own `<h3 className="mb-2">{t.alleleDiscrimination}</h3>` row
   above `<ScatterViewControls>`. `ScatterViewControls` gained an optional
   `title` prop, rendered as the first item inside the existing
   `data-testid="scatter-plot-header"` flex-wrap row (same row the drag-tool
   buttons, normalization toggle, axis-range and aspect controls already
   share). At 1440px column width the header bar was already wrapping to 2
   rows before this change (see below), so folding a short title into row 1
   added no additional row — it just removed the title's own ~28px block.
   `MarkerScatterPlot.tsx` passes no `title` (it never had one) and is
   unaffected.

2. **"Ratio origin" note moved into the collapsed Advanced Settings body.**
   The always-visible `<p data-testid="ratio-origin-note">` under the header
   bar is gone from `ScatterPlot.tsx`. `ScatterViewControls` gained an
   optional `ratioOrigin?: { note, fam, allele2 }` prop; when present, it
   renders inside the `<details>`'s expanded body (next to the NTC quadrant
   control, which is the conceptually closest existing section), i.e. only
   visible when the operator opens "Advanced settings". This is
   low-frequency, informational content the user's own feedback didn't
   single out as needing to stay always-on. `MarkerScatterPlot.tsx` passes
   no `ratioOrigin` (it never rendered this note) and is unaffected.

3. **Advanced-settings summary: dropped the NTC-margin clause, shortened
   padding.** The collapsed `<summary>` line no longer includes
   `{t.ntcAxisOffsetLabel}: {x}, {y}` ("NTC margin (x/y): 0.1, 0.1") — that
   value is still shown and editable in the expanded `ntc-axis-offsets`
   control directly below, so no information is lost, only its duplicate,
   collapsed-view echo. This let the summary drop from 2 lines to 1 at
   1440px width. **`<ScatterReferenceBasis>` (`data-testid=
   "normalization-state"`) was not touched** — same JSX, same text function
   call, same position in the summary — because
   `tests/26-chart-semantics.spec.ts` asserts its exact substrings
   ("no (reporter scale)", "unknown") directly (re-verified passing below).

4. **Padding/gap trims** (visual density only, no controls removed): header
   bar `px-3 py-2` → `px-3 py-1.5`, `gap-y-2` → `gap-y-1`; summary `p-2` →
   `p-1`; the outer wrapper around the header bar + details,
   `mb-2 flex flex-col gap-2` → `mb-1 flex flex-col gap-1`.

None of the promoted plot-header controls were hidden back into a
`<details>`, and no control/testid was removed:
`scatter-tool-select/edit`, `scatter-use-rox`,
`normalization-channel-select`, `axis-mode`, `axis-fit-to-data`,
`axis-lock-aspect`, `axis-settings-toggle`, `scatter-aspect-select` are
unchanged; everything inside the (still-collapsed-by-default)
`analysis-advanced-settings` body (`ntc-axis-offsets`, `ntc-fam-max`,
`ntc-allele2-max`, `dosage-max-select`, etc.) is unchanged apart from the
new `ratio-origin-note` section added to it.

### Why chrome shrinking, not canvas shrinking, was sufficient

At 1440px the scatter panel's grid column is 662px wide. The canvas's
`aspect-ratio: 4/3` with `width: 100%` (unconstrained by `max-width` at this
column width, since `min(70vh, 640px) * 4/3 = 933px > 662px`) means its
**height is fixed at 662 × 3/4 = 496.5px regardless of where the canvas top
sits** — so recovering the needed headroom is entirely a matter of how much
chrome sits above it, not the canvas's own sizing rule. This is why the fix
targeted `ScatterViewControls`/`ScatterPlot` markup only, and never touched
`index.css`'s `--scatter-max-h`/`min-height`.

### Measurements (1440×1000, `#example-select` → option 2, `.../cluster` settled)

| Landmark | Before this task | After this task |
|---|---|---|
| `.panel.scatter-panel > h3` | 20px + 8px margin (28px) | removed (folded into header row) |
| `scatter-plot-header` | 80px (2 rows) | 72px (still 2 rows, tighter padding/gaps) |
| `analysis-advanced-settings` (collapsed) | 66px (2 lines) | 42px (1 line, tighter padding) |
| `ratio-origin-note` (always visible) | 16px + 12px margin (28px) | 0px (moved inside collapsed details) |
| **`.analysis-scatter-canvas` / `#scatter-plot`** | **top 592, height 496.5, bottom 1088.5** | **top 500, height 496.5, bottom 996.5** |

Bottom moved from **1088.5 (89px over)** to **996.5 (3.5px under)** — the
full deficit was recovered from chrome, canvas height (496.5px) is
byte-for-byte unchanged.

### 1920×911 check (no regression, height floor respected)

| Landmark | Before this task | After this task |
|---|---|---|
| `scatter-plot-header` | 46px (1 row — wider column fit all 4 groups) | 72px (2 rows — the folded-in title pushed the normalization group to row 2 at this width too) |
| `analysis-advanced-settings` (collapsed) | 66px (2 lines) | 42px (1 line) |
| `ratio-origin-note` | 16px + 12px margin (28px) | 0px (moved inside collapsed details) |
| **`.analysis-scatter-canvas`** | **top 512, height 637.6875** | **top 470, height 637.6875** |

Canvas height at 1920×911 is unchanged (637.7px, unaffected by any of these
markup/spacing changes — same column-width-driven aspect-ratio math as
1440px) and comfortably clears the ≥550px requirement from this task's
instructions, despite the header bar itself now wrapping to 2 rows at this
width too (a net-neutral trade against the larger savings from removing the
standalone title and note).

### Verification — both specs

```
$ E2E_BASE_URL=http://127.0.0.1:8124 npx playwright test tests/21-workspace-restore.spec.ts tests/24-responsive.spec.ts --project=chromium --workers=1 --reporter=list
  26 passed (1.5m)
```

(23 tests in `24-responsive.spec.ts` — including the previously-failing
`result-first 96-well desktop keeps scatter, plate and selected summary in
the initial viewport`, the multi-marker 384-well test, and all 20
`responsive header` viewport/theme/language combinations — plus 3 in
`21-workspace-restore.spec.ts`.)

### Verification — full root E2E suite

```
$ E2E_BASE_URL=http://127.0.0.1:8124 npx playwright test --project=chromium --workers=1 --reporter=list
  133 passed (7.7m)
  4 failed:
    tests/06-import-mapping.spec.ts:10   (pre-existing debt, untouched)
    tests/17-manual-group-and-plate-drag.spec.ts:55   (pre-existing debt, untouched)
    tests/17-manual-group-and-plate-drag.spec.ts:135  (pre-existing debt, untouched)
    tests/test-windows.spec.ts:109       (pre-existing debt, untouched)
```

137 total specs ran (133 + 4), matching the orchestrator's 131+6=137 tally
before this fix. Net change: **131 → 133 passed, 6 → 4 failed** — both P4
regressions resolved, the same 4 pre-existing failures remain exactly as
they were (not investigated, per this task's explicit scope).

## Verification — all four gates (from `snp-analyzer/frontend/`)

```
$ npx tsc --noEmit
(no output — clean)

$ npm run lint
> eslint .
(no output — clean)

$ npm run test
 Test Files  111 passed (111)
      Tests  768 passed (768)

$ npm run build
✓ 1890 modules transformed.
✓ built in 32.58s
```

Baseline was 111 files / 768 tests — unchanged (this task modified no unit
test files and added no new component behavior that needed new unit
coverage; both fixes are markup relocation, prop threading and a root E2E
test update, exercised by the E2E suite above).

## Regression check on unrelated specs

- `grep -rn "rox-normalize-checkbox\|ratio-origin-note\|alleleDiscrimination"
  tests/` outside this task's own edit confirms no other root E2E spec
  referenced the removed Settings checkbox, the relocated note, or the
  panel title text.
- `tests/26-chart-semantics.spec.ts` passed unchanged (4/4 in the full run
  above), confirming `ScatterReferenceBasis`/`normalization-state` was not
  disturbed by the summary-line trim.
- `tests/27-scatter-aspect.spec.ts` passed unchanged, confirming the 4:3/1:1
  aspect ratio math (unrelated to this task's chrome-only changes) still
  holds at 1920×911.
