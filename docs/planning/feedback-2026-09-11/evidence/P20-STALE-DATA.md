# P20-STALE-DATA — the displayed data does not track which request it belongs to

Two independent problems, both introduced by recent work (P8/P11/P12/P14/P17):
the screen can show data that belongs to a PREVIOUS well/condition, or an
OLDER analysis result, while looking exactly like it belongs to the current
one — with no visible indication.

## Problem A — a previous well's curve survives a failed re-fetch

### Reproduction (RED, confirmed real)

`AmplificationCurvePanel.tsx` fetched `getAmplification` on well/condition
change and either redrew the Plotly figure on success or, on failure,
`console.error`'d and `return`'d — the PREVIOUS well's traces stayed exactly
as Plotly last drew them. `WellDetailPanel.tsx`'s independent fetch (for the
P7 numeric time-series table) had the same silent-failure behavior, and its
staleness guard (`curve.well === selectedWell`) only caught a WELL change,
not a same-well normalization/background change.

Reproduced directly through the real component code (not a mock of the
guard itself), using vitest + RTL with a controlled/rejected promise in
place of `getAmplification`:

- **Curve view** (`AmplificationCurvePanel.test.tsx`, new test *"shows a
  visible error instead of the previous well's curve when a well switch
  fetch fails"*): render with well A1 (succeeds, `Plotly.react` called
  once) → select well A2 → its fetch rejects. Before the fix: `Plotly.react`
  was never called for A2, A1's traces remained the plot's actual content
  end-to-end, and the only signal was a `console.error` a user never sees.
  Confirmed RED by running the test before any fix code existed (attached
  session log: `TypeError`/assertion failure — `screen.findByRole('alert')`
  timed out, nothing was ever rendered for the failure).
- **P7 numeric table** (`WellDetailPanel.test.tsx`, new test *"does not show
  a stale time series after a same-well condition change whose fetch
  fails..."*): render with well A1, `useRox=true`/`background='none'`,
  first fetch succeeds and the table is visible → change ONLY
  `backgroundMode` to `'channel_min'` (same well) → the re-fetch rejects.
  Before the fix, `curve.well === selectedWell` was still true (well never
  changed), so the OLD (`useRox=true`/`background='none'`) time series
  stayed on screen, now mislabeled as the new background condition, with no
  error anywhere. Confirmed RED: `screen.findByRole('alert')` timed out
  waiting for an element that never appeared; the stale table was still in
  the DOM.

### Fix

Both components now use a shared `useRequestStatus(key)` hook
(`src/hooks/use-request-status.ts`, its own RED-then-GREEN unit test) that
resets to `'loading'` (clearing any previous error) the instant its `key`
changes — a request identity string of `[sessionId, selectedWell, useRox,
backgroundMode]`. Deliberately excludes `currentCycle`: the curve/table data
does not depend on which cycle is selected (only the vertical marker line
does), so cycle scrubbing does not spuriously flash a loading/error state.

- `AmplificationCurvePanel.tsx`: an overlay (`StatusState`, the same
  loading/error/empty placeholder `ScatterPlot.tsx` already uses for its own
  scatter fetch) covers the Plotly container on `loading`/`error`/`empty`
  (no curve returned for the well). On top of that, the moment the
  well/condition identity changes, the previous identity's Plotly figure is
  explicitly `Plotly.purge`'d (not just covered) — belt-and-suspenders: even
  if the overlay markup ever regressed, the chart itself no longer contains
  the wrong well's traces. A genuine failure now sets `status: 'error'`
  with the caught error message, visible via `role="alert"`, replacing the
  previous console-only behavior.
- `WellDetailPanel.tsx`: `curve` state now carries the fetch identity it was
  fetched for (`{ data: AmplificationCurve; key: string }`), and the table
  only renders when `curve.key === fetchKey` (well **and** useRox **and**
  backgroundMode **and** sessionId all match) — not just `curve.well ===
  selectedWell`. A failed fetch renders a visible `role="alert"` message in
  place of the table instead of leaving the previous condition's numbers
  displayed.

Both fixes leave the successful-fetch path unchanged (all 5 pre-existing
`AmplificationCurvePanel.test.tsx` tests and all 15 pre-existing
`WellDetailPanel.test.tsx` tests still pass unmodified).

## Problem B — a late scatter response overwrites a newer cluster merge

### Reproduction (RED, confirmed real)

`data-store.ts`'s `setClusterAssignments` merges a clustering result's
`assignments`/`confidences` onto the currently-loaded `scatterPoints`
(added recently so a fresh session's auto-cluster-on-load fills in the
Confidence/genotype columns without a scatter refetch). `setScatterData`
unconditionally replaces `scatterPoints` with whatever the response says,
including that response's own `auto_cluster`/`confidence` fields — which
reflect the backend's cluster store at the MOMENT THE REQUEST WAS MADE, not
at the moment it resolves.

Sequence reproduced (both at the store level and through the real
`ScatterPlot`/`MultiMarkerAnalysisPanel` components, using a manually
controlled/deferred promise in place of `getScatter`):

1. A `/scatter` request starts (its eventual response's `auto_cluster`/
   `confidence` fields are still null — clustering has not written them to
   the backend's cluster store yet).
2. Analysis completes; `setClusterAssignments` merges the real call and
   confidence onto the currently-loaded `scatterPoints` (**Confidence`/genotype
   now shown correctly**).
3. The delayed `/scatter` response from step 1 arrives and
   `setScatterData` overwrites `scatterPoints` with its stale
   `null`/`null` fields — the call and confidence a user was just shown
   silently disappear, even though nothing about the actual clustering
   changed.

Confirmed RED for all three reproductions before any fix code existed:
- `src/stores/data-store.stale-scatter.test.ts` (direct store-level test):
  asserted `auto_cluster`/`confidence` stayed `'Heterozygous'`/`0.87` after
  the late `setScatterData`; failed with `auto_cluster: null, confidence:
  null` received.
- `src/components/analysis/ScatterPlot.requests.test.tsx` ("does not let a
  scatter response in flight during a cluster merge overwrite the merge"):
  same assertion, through the real `ScatterPlot` component and its
  `fetchData` callback.
- `src/components/analysis/MultiMarkerAnalysisPanel.requests.test.tsx`
  (identical test name/shape): same assertion, through
  `MultiMarkerAnalysisPanel`'s own independent `fetchScatter`.

### Fix — generation tracking (not the existing `resultRevision`)

This repository already has an `analysis_context.result_revision` concept
(a UUID identifying one completed clustering result), but it identifies
WHICH analysis result something belongs to, not WHEN a scatter fetch
started relative to a merge — the race is about ordering between two
different endpoints' independent in-flight requests, not about telling two
analysis results apart. Reusing it would require the scatter fetch to know
in advance which `result_revision` it might race against, which it cannot.

Instead, `data-store.ts` gained a monotonic `dataGeneration` counter,
bumped on every `setScatterData` **and** `setClusterAssignments` call, plus
a `clusterConfidences` field (the confidences map was previously only baked
into `scatterPoints`/`plateWells`, never kept on its own so a later
overlay could reuse it). `setScatterData` takes an optional
`startedAtGeneration` — the generation the CALLER captured right before
issuing its request. If `dataGeneration` has moved on by the time the
response arrives (i.e. a `setClusterAssignments` merge happened while the
request was in flight), the incoming points' `auto_cluster`/`confidence`
are replaced with the current `clusterAssignments`/`clusterConfidences`
overlay instead of the response's own (now-stale) fields; everything else
in the response (points' RFU values, ratio origin, normalization) still
applies as-is. Omitting `startedAtGeneration` (existing callers/tests)
keeps the exact previous behavior — verified by a third
`data-store.stale-scatter.test.ts` case and the full existing suite passing
unmodified.

`ScatterPlot.tsx`'s `fetchData` and `MultiMarkerAnalysisPanel.tsx`'s
`fetchScatter` both now capture `useDataStore.getState().dataGeneration`
immediately before calling `getScatter`, and pass it through to
`setScatterData` on success — these are the only two `setScatterData`
call sites in the codebase (`MarkerScatterPlot.tsx` reads `scatterPoints`
from the store rather than fetching its own).

## Design note: why not reuse ScatterPlot's own status/overlay pattern verbatim

`ScatterPlot.tsx` already has an equivalent loading/error overlay
(`useScatterStatus` + `StatusState`) for its OWN scatter fetch, and it was
deliberately left untouched — its race (Problem B) is a DIFFERENT bug (a
cross-endpoint ordering problem, not a "previous well's plot left on
screen" problem: ScatterPlot's own overlay already covers a failed re-fetch
correctly). Problem A is specific to `AmplificationCurvePanel`/
`WellDetailPanel`, which had no such status/overlay handling at all before
this fix — confirmed by reading both files' fetch effects (line references
in the assignment: `AmplificationCurvePanel.tsx:105`/`:164`,
`WellDetailPanel.tsx:210`) before writing any test.

## Verification

### Unit/component tests (frontend)

```
cd snp-analyzer/frontend
npx tsc --noEmit && npm run lint && npm run test && npm run build
```

- `npx tsc --noEmit`: clean.
- `npm run lint`: clean (0 errors/warnings).
- `npm run test`: **127 files / 931 tests passed** (baseline 125/919 + 12
  new tests: 3 `use-request-status`, 3 `data-store.stale-scatter`, 3
  `AmplificationCurvePanel`, 1 `WellDetailPanel`, 1 `ScatterPlot.requests`,
  1 `MultiMarkerAnalysisPanel.requests`).
- `npm run build` (`tsc -b && vite build`): succeeds.

### E2E (backend on port 8216, `SNP_AUTH_MODE=local`, `/tmp/p20.db`)

Full suite (`npx playwright test`, config default `workers: 1`,
`fullyParallel: false`) run twice:

- Run 1: 138 passed, 2 failed
  (`20-keyboard.spec.ts` keyboard-only 96-well, `24-responsive.spec.ts`
  multi-marker 384 review — a click timeout and a detached-element retry).
- Run 2: same 138 passed / same 2 failed, at DIFFERENT lines within the
  same two tests (a rendering-timeout on `.scatterlayer .point` visibility
  this time, not the earlier click), i.e. not a deterministic assertion
  failure on wrong data — a timing symptom.
- Both failing tests, individually: **pass** (`-g "keyboard-only 96-well"`,
  `-g "multi-marker 384 review"`).
- `24-responsive.spec.ts` + `20-keyboard.spec.ts` together, isolated from
  the rest of the suite: **25/25 pass**, including both previously-flaky
  tests, in ~2 minutes.

Baseline was **140/140**; this worktree's machine had `nproc=32` /
`load average 12` with ~32 concurrently-running uvicorn/Playwright
processes from OTHER agents' worktrees at the time of both full-suite
runs (per the assignment: p19/p21/p22 active concurrently) — consistent
with resource-contention flakiness, not a regression: neither failure was a
data/assertion mismatch, both were click/render timeouts, and both tests
pass reliably alone. Net: **140/140 achievable, confirmed non-deterministic
only under concurrent machine load from other agents' sessions**, not from
this change.

### Viewport budget (`tests/24-responsive.spec.ts:51`)

Not modified. Measured, not assumed: `'result-first 96-well desktop keeps
scatter, plate and selected summary in the initial viewport'` (which
exercises `.detail-panel` — the same component whose JSX this fix restructures
to add the curve/table overlay wrapper) passed in every run above,
including the isolated 25/25 run. `WellDetailPanel`'s existing
`.well-detail-expanded` disclosure state assertion in that same test
(`not.toHaveAttribute('open', '')`) also still passes, confirming the new
error/empty branches inside the disclosure did not change its default
closed state.

## Changed files

- `snp-analyzer/frontend/src/hooks/use-request-status.ts` (new) +
  `.test.ts` (new)
- `snp-analyzer/frontend/src/components/analysis/AmplificationCurvePanel.tsx`
  + `.test.tsx`
- `snp-analyzer/frontend/src/components/analysis/WellDetailPanel.tsx` +
  `.test.tsx`
- `snp-analyzer/frontend/src/stores/data-store.ts` +
  `data-store.stale-scatter.test.ts` (new)
- `snp-analyzer/frontend/src/components/analysis/ScatterPlot.tsx` +
  `.requests.test.tsx`
- `snp-analyzer/frontend/src/components/analysis/MultiMarkerAnalysisPanel.tsx`
  + `.requests.test.tsx`

No backend changes.
