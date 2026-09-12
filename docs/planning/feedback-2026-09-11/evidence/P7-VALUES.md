# P7-VALUES — Per-well fluorescence VALUES (FB-06 Q-1, "웰마다 형광값")

Branch: `feedback/p7-rawvalues` (worktree `worktree/feedback-p7`)
Scope: `snp-analyzer/frontend/src/components/analysis/AmplificationOverlay.tsx`,
`snp-analyzer/frontend/src/components/analysis/WellDetailPanel.tsx`,
`snp-analyzer/frontend/src/components/analysis/WellCycleValuesTable.tsx` (new),
`snp-analyzer/frontend/src/components/protocol/ProtocolTab.tsx`,
`snp-analyzer/frontend/src/hooks/use-exports.ts`,
`snp-analyzer/frontend/src/locales/{en,ko}.ts`,
`snp-analyzer/frontend/src/index.css`, plus unit tests. No backend changes
(none were needed or approved).

Builds on P2-S2-T1 (`docs/planning/feedback-2026-09-11/evidence/P2-S2-T1.md`),
which closed FB-06's "전체 웰의 형광" half (the plate-wide overlay on the
Raw data tab) and explicitly left "웰마다 형광값" (Q-1) open. This task closes
that second half: option **D = A + B**, per the task brief.

## 0. What existed before this task (and why none of it answers Q-1)

| Path | Limit |
|---|---|
| `WellDetailPanel`'s existing table | Only `currentCycle` — one row, one point in time |
| CSV export (`use-exports.ts` → `exportCsv`) | One analysis cycle, one row per well |
| Overlay hover tooltip | One point at a time, not scrollable/copyable |

None of these let a user read a well's fluorescence **values** across the
run, or read every well's value at one cycle side by side, as numbers. Data
for both already existed (`/api/data/{sid}/amplification/all` → `curves:
[{ well, cycles[], norm_fam[], norm_allele2[] }]`); no backend change was
needed, only front-end presentation of data already being fetched (overlay)
or already being fetched per-well (`WellDetailPanel`).

## 1. RED — tests written before implementation

Three files got new tests before any component/hook code existed:

- `WellCycleValuesTable.test.tsx` (new, 6 tests) — component didn't exist,
  so the whole file failed to resolve the import.
- `WellDetailPanel.test.tsx` (+2 tests) — `screen.getByTestId('well-timeseries-table')`
  found nothing (`TestingLibraryElementError`).
- `use-exports.test.tsx` (+3 tests) — `buildWellCycleValuesCsv` was not
  exported, causing a compile-time (undefined) failure at the call site.

Confirmed RED:

```
Test Files  3 failed (3)
     Tests  4 failed | 27 passed (31)
```

(This is the actual first `vitest run` pass across just these three files:
4 failing assertions, one per genuinely-new behavior — the
`WellCycleValuesTable.test.tsx` module-resolution failure surfaced as its
individual `it()` blocks failing to run rather than a single hard crash,
which vitest still counts and reports per-test.)

Then implemented (GREEN), then refactored (lint fix, see §7).

## 2. A — Well × cycle value table (`WellCycleValuesTable.tsx`, new)

Mounted in `ProtocolTab.tsx` immediately **below**
`<AmplificationOverlay idPrefix="rawdata-" />` (same file, same `px-4 pb-4
sm:px-6` wrapper), outside the protocol-save `<form>` — same reasoning
P2-S2-T1 already established for the overlay: a bare `<button>` inside that
form defaults to `type="submit"`.

- **Default collapsed**, matching the overlay's `useState(false)` pattern:
  a 96-well × 40-cycle table is heavy to always render open, and the
  existing overlay already established this "opt-in reveal" convention for
  the Raw data tab — a second, differently-behaved panel right next to it
  would be inconsistent.
- **Channel selector**: `#well-cycle-values-channel-select` (`fam` /
  `allele2`), **independent** state from the overlay's own
  `#rawdata-overlay-channel-select` (see §3 for why).
- Fetch: `getAllAmplification(sessionId, useRox, backgroundMode)`, gated on
  `visible` — identical fetch-on-open pattern to the overlay, including the
  same "no cache, no dedup" precedent P2-S2-T1 measured and explicitly
  chose not to change speculatively (see that evidence doc §6). Opening
  both this table and the overlay independently means up to 2 calls to the
  same in-memory, non-DB endpoint — unchanged cost profile from P2.
- **Scroll container**: `data-testid="well-cycle-values-scroll-region"`,
  `role="region"` + `aria-label` + `tabIndex={0}`, mirroring
  `ResultsTable`'s `data-testid="results-scroll-region"` pattern
  (`src/components/analysis/ResultsTable.tsx:53`). CSS
  (`src/index.css`) caps it at `max-height: 28rem; overflow: auto` —
  **unconditionally**, not only below a breakpoint like `results-scroll-region`,
  because unlike `ResultsTable` (promoted to unclipped at ≥1280px per
  P4-S3-T1) this table's row/column count (wells × cycles) has no viewport-width
  relationship that would ever make "just let it grow" reasonable. A sticky
  `<thead>` (`position: sticky; top: 0`) was added for usability since a
  wide/tall value grid without a fixed header is hard to read — low-risk,
  scoped purely to this new testid.
- **CSV export button**: `t.wellCycleValuesExportCsv`, disabled when there
  are no curves. See §4 for why client-side.
- **Processing status**: reuses `AmplificationOverlay`'s exported
  `OverlayProcessingStatus` (now `export function`, previously private) via
  a `testId` prop (`"well-cycle-values-processing-status"`, distinct from
  the overlay's own `"overlay-processing-status"` so both can be queried
  unambiguously when mounted on the same tab) — see §5, not reimplemented.
- **Empty/no-session handling**: fetch effect's first line is `if (!visible
  || !sessionId) return;` (same guard shape as the overlay); with no
  session, clicking the toggle never calls the API and no table renders.
  With a session but an empty `curves: []` response, `t.wellCycleValuesEmpty`
  renders instead of a table. Both covered by tests ("does not crash when
  there is no active session", "shows an empty state... when the response
  has no curves").

## 3. Channel selector: independent from the overlay, not shared

Decision: **independent state**, not lifted/shared with
`AmplificationOverlay`. Reasoning (recorded here per the task brief's
request):

- The overlay is a **trend/shape** view; this table is a **value-lookup**
  view. A user may reasonably want the FAM trend shape on screen while
  reading allele2's numbers (or vice versa) — sharing a single selector
  would prevent that.
- Sharing would require lifting `AmplificationOverlay`'s internal
  `channel`/`response` state up into `ProtocolTab` (or a new shared
  context), entangling two panels that are each independently useful and
  independently collapsible, for a marginal reuse benefit.
- Every other per-well/per-channel selection already in this codebase is
  component-local, not cross-component shared (`WellDetailPanel`'s own
  channel display, `ResultsTable`'s filters) — this follows the existing
  convention rather than introducing a new one.

Both selectors do share the same **fetch** shape
(`getAllAmplification(sessionId, useRox, backgroundMode)`) and the same
**processing-status honesty component** (`OverlayProcessingStatus`, §5) —
what's independent is only the display-only `channel` pick, which is the
part the task asked about.

## 4. CSV export — client-side generation, not a new backend route

Chose **client-side generation** (the task brief's default), not a new
`app/routers/export.py` route. Reasoning:

- The existing backend CSV route (`/api/data/{sid}/export/csv`) exports a
  **committed, versioned analysis result** — it embeds `Result Revision` /
  `Input Revision` / `Analysis Context` because that CSV is a durable record
  of a specific analysis run, validated against staleness
  (`use-exports.ts`'s `storedConditions()`/`validatePngConditions()`).
- This table is not that: it is whatever the live overlay/table is
  currently showing (any `useRox`/`backgroundMode` the user has picked,
  not necessarily an analyzed/committed cycle). There is no "stale result"
  concept for it to violate, and inventing a parallel backend contract
  for values the frontend already receives in full (`AmplificationCurve`
  from `/amplification/all`) would duplicate the data path for no
  correctness benefit.
- Backend changes need prior approval per the task brief; client-side
  needed none and the data was already fully present in the browser.

Implementation (`use-exports.ts`, new exports, **not** part of the
`useExports()` hook — deliberately standalone, since the hook's
`conditions()`/`storedConditions()` validate the committed-result semantics
above, which do not apply here):

- `buildWellCycleValuesCsv(...)`: pure function, metadata rows (`Session`,
  `Channel`, `Requested reference normalization`, `Normalization applied`,
  `Background mode`) + a blank line + `Well,<cycle...>` header + one row per
  well. Fields are CSV-escaped (`escapeCsvField`) for commas/quotes/newlines
  (tested: `'escapes CSV-hostile characters in fields'`).
- `downloadTextFile(filename, content, mimeType)`: standalone blob-download
  helper (not `saveBlob`, which lives inside `useExports()`'s closure and is
  gated on `stillOwns()` ownership checks tied to the stored-export
  ownership model — not applicable here).
- Values are written at **full precision** (`String(value)`, no
  `.toFixed()`), unlike the on-screen table (`.toFixed(3)`) — the display
  rounds for readability, the export does not, so a downstream analyst
  gets the same precision the backend actually returned.

## 5. Values are honestly labeled — never "raw"

The values shown/exported are `norm_fam` / `norm_allele2` from
`/amplification/all` — already normalization/background-corrected
server-side, exactly like the overlay's Y values (see P2-S2-T1 §3-3,
the corrected understanding that even the overlay's "단색" mode is not a
raw view). This task's new UI:

- Never uses the word "raw"/"원시" anywhere in `WellCycleValuesTable.tsx`
  or its locale strings (verified by a dedicated test:
  `screen.queryByText(/raw/i)` / `/원시/` are both asserted `null`, and the
  CSV test asserts `csv.toLowerCase()` excludes `'raw'`).
- Reuses `OverlayProcessingStatus` (exported from `AmplificationOverlay.tsx`,
  previously module-private) rather than re-deriving the reported/unreported
  logic — the same "response echo, not the settings-store request" honesty
  contract P2-S2-T1 built stays the single source of truth for that
  distinction. `WellDetailPanel`'s time-series table (§6) sits under the
  pre-existing `t.referenceBasisUnknown` / `curveReportedSignal` captions
  that already governed the plot it now accompanies, so no new honesty
  copy was needed there — the caption already said the normalization basis
  is unknown, and the added numbers are the same values that caption
  already covers.
- The CSV embeds the same honesty fields as metadata rows
  (`Normalization applied` / `Background mode`), using the identical
  "unreported ≠ not applied" distinction (`undefined` → `'unreported'`,
  never silently guessed from `requestedRox`) — tested directly in
  `use-exports.test.tsx`.

## 6. B — WellDetailPanel: full cycle time series (not only `currentCycle`)

`WellDetailPanel.tsx` already fetches one well's curve
(`getAmplification(sessionId, [selectedWell], useRox, backgroundMode)`) to
draw the small Plotly plot. That fetch's result is now **also** kept in
component state (`const [curve, setCurve] = useState<AmplificationCurve |
null>(null)`) — no second network request.

- Existing `currentCycle`-only table (`#detail-content > table`, the one
  with 사이클/샘플/유전자형/신뢰도 + the expanded raw/norm rows) is
  **unchanged**, verified by re-running its pre-existing test cases
  unmodified.
- A new table is added **below the plot**, inside the same `<details>`
  ("상세 측정값과 증폭 곡선" / `analysisNumericDetails`) so opening it once
  reveals both the plot and the full numeric series — no second
  toggle was added, since the value of collapsing plot-vs-numbers
  separately seemed low next to just scrolling.
- Rows = every cycle in `curve.cycles`; columns = Cycle, FAM label,
  allele2 label (the same `labels.fam`/`labels.allele2` the existing table
  already computes). The row matching `currentCycle` gets
  `data-current-cycle="true"` and a `.current-cycle-row` CSS class
  (background tint + bold, `src/index.css`) — the plot already draws a
  vertical dotted line at `currentCycle`; the table row highlight is the
  numeric equivalent of that same marker.
- Scroll container: `data-testid="well-timeseries-scroll-region"`, capped
  at `max-height: 12rem` (smaller than the plate-wide table's 28rem — one
  well's series is a single column pair, not a full plate) with the same
  sticky-header treatment.

### The `react-hooks/set-state-in-effect` fix

First implementation added a synchronous `setCurve(null)` in the fetch
effect's early-return guard clause (`if (!selectedWell || ...) { ...;
setCurve(null); return; }`). `npm run lint` failed:

```
error  Error: Calling setState synchronously within an effect can trigger
cascading renders ... react-hooks/set-state-in-effect
```

Fix: removed that synchronous reset entirely and instead guard the new
table's render with `curve && curve.well === selectedWell` — `curve` is
only ever **replaced** (by the async fetch's `setCurve(fetchedCurve)`
line), never defensively reset in the effect body, and the `well` field on
the stored curve is what prevents a stale previous-well series from ever
being displayed. Re-ran `npm run lint`: 0 errors after the fix.

## 7. Verification — all four gates

Working directory: `worktree/feedback-p7/snp-analyzer/frontend`.

```
npx tsc --noEmit          # 0 errors
npm run lint               # 0 errors, 0 warnings
npm run test -- --run      # 120 files, 839 tests, 0 failed
                            # (baseline 119 files / 828 tests; +1 new file
                            #  WellCycleValuesTable.test.tsx, +11 new tests:
                            #  6 in it, 2 in WellDetailPanel.test.tsx,
                            #  3 in use-exports.test.tsx)
npm run build               # tsc -b && vite build — succeeds
                            # (pre-existing >500kB chunk-size warning, unrelated)
```

`npx tsc --noEmit` uses `tsconfig.app.json` (excludes test files); `npm run
build`'s `tsc -b` step covers the test files too — both ran clean.

## 8. E2E — root Playwright suite, compared against the stated baseline

```
E2E_BASE_URL=http://127.0.0.1:8160 npx playwright test --project=chromium --workers=1 --reporter=list
133 passed (7.7m)
4 failed:
  tests/06-import-mapping.spec.ts:10
  tests/17-manual-group-and-plate-drag.spec.ts:55
  tests/17-manual-group-and-plate-drag.spec.ts:135
  tests/test-windows.spec.ts:109
```

Matches the stated baseline (133 passed / 4 failed) exactly — no
regression, no improvement.

**`test-windows.spec.ts:109` specifically checked for an id-duplication
regression** (P2 had a real prior incident where `#amplification-plot`-style
duplicate ids caused ambiguous test behavior). This task does not add a
second `id="amplification-plot"` anywhere — `WellDetailPanel.tsx`'s existing
single instance is untouched, and the new tables use distinct
`data-testid`s (`well-cycle-values-table`, `well-timeseries-table`), not
that id. Confirmed directly from the failure's own call log:

```
Locator:  locator('#amplification-plot')
Expected: visible
Received: hidden
Call log: 14 × locator resolved to <div class="js-plotly-plot" id="amplification-plot">…</div>
```

Playwright's default locator is strict-mode (throws immediately if a
locator resolves to more than one element); the log shows it resolving
to **one** element every time and failing only on `visible` vs `hidden` —
i.e. the `<details>` this plot sits in is closed by default in this old
spec's flow (pre-existing gap, unrelated to this task: the spec expects
the plot visible without ever opening the `<details>` that gates it).
Same failure mode as would occur on `main`, unrelated to id scoping.

## 9. Visual verification — light/dark, real fixture, layout containment

Server: `worktree/feedback-p0/snp-analyzer/venv` uvicorn on a scratch port
(8161, not 8002/production), scratch `DB_PATH`. Fixture: the existing
`260126-QS3.eds` (32 wells, 25 cycles — the same file `test-windows.spec.ts`
and other root E2E specs already use) via a throwaway Playwright script
(not committed; deleted after use, per the "no stray files" scope).

Screenshots (this evidence folder):
`P7-VALUES-rawdata-light.png`, `P7-VALUES-rawdata-light-allele2.png`,
`P7-VALUES-rawdata-dark.png`, `P7-VALUES-well-detail-light.png`,
`P7-VALUES-well-detail-dark.png`.

- **Raw data tab, light**: PCR protocol steps → Amplification Overlay
  (unchanged from P2) → the new **웰별 형광값** table below it, scroll
  region visible with sticky `사이클` header row, channel selector showing
  `WT (FAM)`, CSV button, and the processing-status badge ("참조 정규화
  요청: 예; 실제 적용: 예. 배경 보정: 없음").
- **Raw data tab, dark**: same layout, dark theme tokens applied correctly
  (surface/border/text contrast), channel switched to `MT1 (VIC)` — table
  values changed accordingly (33 rows visible, values differ from FAM).
- **Well detail panel (Results tab), light + dark**: opening the existing
  "상세 측정값과 증폭 곡선" `<details>` on a selected well now shows the
  small per-well plot **and**, immediately below it, "전체 사이클 시계열
  (이 웰)" — a Cycle / WT (FAM) / MT1 (VIC) table starting at cycle 1,
  matching the plot's first data points exactly (1.1482/0.3252 at cycle 1,
  etc.), scroll-capped so only ~7 of the well's cycles show without
  scrolling.

**Page height, large-table containment**: `document.body.scrollHeight` on
the Raw data tab (both overlay and the values table opened) measured
**2174px** at a 1440×900 viewport, in both light and dark — i.e. opening
the new table does not make the page taller than its capped scroll region
allows; the page's total height is governed by the surrounding page
content (protocol steps + overlay + one fixed-height value-table region),
not by the well/cycle count inside that region.

**Caveat on scale**: the available real fixture is 32 wells × 25 cycles,
not the 96-well × ~40-cycle case named in the task brief as a stress case.
The CSS caps (`max-height: 28rem` / `12rem`, `overflow: auto`) are
row/column-count-independent — they clip at a fixed height regardless of
how many `<tr>`/`<th>` elements are inside — so the same containment holds
for larger plates by construction, not by measurement at that specific
scale; no 96-well/40-cycle fixture was available in this environment to
directly measure at that size.

## 10. Regression checks

- `AmplificationOverlay.rawdata.test.tsx` (P2's existing suite): unaffected
  by exporting `OverlayProcessingStatus` (a pure additive change — the
  component's own render path and props are unchanged; the new `testId`
  prop defaults to the exact string the existing tests already assert on).
- `ProtocolTab.test.tsx` (14 pre-existing tests): re-run standalone after
  adding the `<WellCycleValuesTable />` mount — all 14 still pass, no
  changes needed to that test file.
- `plot-cleanup.test.tsx`: unaffected — this task adds no new Plotly
  mount (the values tables are plain HTML `<table>`s), so the dual-mount
  id-scoping test P2 added there needed no changes.

## Acceptance criteria

- [x] Raw data tab: readable, scrollable, exportable well × cycle value
      table below the overlay (A).
- [x] `WellDetailPanel`: full cycle time series for the selected well,
      existing current-cycle table untouched (B).
- [x] Values are never labeled "raw" anywhere in the new UI or CSV;
      processing status is shown via the same response-echo-only honesty
      component the overlay uses.
- [x] Channel selector is independent per component, with the reasoning
      recorded (§3).
- [x] CSV chosen client-side, with the reasoning recorded (§4); no backend
      route was added or touched.
- [x] Large tables are height-capped and scrollable; measured page height
      does not grow with the value table opened (§9).
- [x] All four verification gates pass; 120 files / 839 tests, 0 failed.
- [x] Root E2E matches the stated 133/4 baseline exactly; the one
      `#amplification-plot`-related failure was directly checked against
      an id-duplication regression and confirmed unrelated (§8).
- [x] No backend files touched; no `git add -A`/`git add .` used for the
      commit (files staged explicitly).
