# P17-MARKER-FLASH — the Results panel blanking during a marker refetch

Branch: `feedback/p17-followup` (worktree `worktree/feedback-p17`, from `main` at `e308521`).
Isolated server: `127.0.0.1:8201` / `/tmp/p17.db` (removed after use).

## Scope and starting point

`P13-NTC-RACE.md` (a different task, investigating an unrelated E2E flake) flagged, but explicitly
left unfixed as out of its write scope, that `AnalysisWorkspace.tsx`'s `MarkerAvailability` unmounts
the entire Results surface (no loading state) while `use-analysis-workspace.ts` refetches markers
after a `markers-changed` event, and that a 0<->1 marker transition additionally forces a full
`AnalysisTab` -> `MultiMarkerAnalysisPanel` component swap.

## Reproducing and measuring it (before touching any code)

Confirmed by reading the code first, then measuring against the isolated server with an artificial
network delay via Playwright's `page.route`, not by trusting the prior report at face value.

### Root cause (read, not guessed)

- `use-analysis-workspace.ts`'s `markers-changed` handler (`refreshMarkers`) synchronously calls
  `setMarkerEntry(null)` before awaiting `Promise.all([getSessionInfo(session), getMarkers(session)])`.
  `markersAvailable` (`markerEntry === entry`) goes `false` for the whole fetch.
- `AnalysisWorkspace.tsx`'s old `<MarkerAvailability available={markersAvailable}>` wrapped **both**
  the `MultiMarkerAnalysisPanel` and the whole-plate `single-marker-analysis-view` branches and
  rendered `null` while `markersAvailable` was `false` -- unmounting the entire visible Results
  content (scatter plot, plate grid, well detail, everything), with no loading indicator of any kind.
  The always-visible one-line summary (`analysis-context-summary-line`) was the only surviving signal
  ("… marker scope unknown"), and it's collapsed/small enough to be easy to miss.
- **A second, worse bug on refetch failure**: the `catch` block in `refresh()` called
  `useAnalysisStore.getState().failInputRefresh(error)` but never restored `markerEntry`. A failed
  `markers-changed` refetch (e.g. one dropped request on a flaky connection) left the Results panel
  **permanently blank** -- silently, with nothing in the UI telling the user why, until the next
  successful `markers-changed`/session change. This is worse than the transient flash and matches the
  "does it silently stay wrong" question this task was asked to check.

### Measured reproduction (before the fix, `page.route` 800ms delay on `GET .../markers`)

Polling `single-marker-analysis-view` / the per-marker view every ~35ms after dispatching
`markers-changed` (marker actually added server-side first):

```
t=35..803ms   : both views absent (blank)      <- 24 consecutive samples, ~770ms continuous
t=1117ms      : per-marker view mounted
```

24/25 polls landed on a fully blank Results panel; the blank window tracks the artificial delay
almost exactly (server delay 800ms, observed blank ~770-800ms plus normal request/render overhead).
This is directly reachable by a real user: any `markers-changed` event (adding/removing/editing a
marker from Plate Setup or the Library tab) while the Results surface is open re-triggers this same
refetch, and the blank duration scales with how slow the connection/backend response is that moment
-- not a fixed, always-small gap. On an unthrottled loopback connection (no artificial delay) the
gap is worth measuring too, see below.

**Screenshots** (`P17-MARKER-FLASH-before-*.png`), captured mid-refetch (450ms into a 900ms delay),
1440x1000 and 768x1024, light and dark: all four show a fully blank Results body (only the header,
tab bar and the collapsed one-line summary remain) -- confirmed visually, not just via testids.

### Same measurement after the fix

```
t=22..810ms   : single-marker-analysis-view visible, marker-refresh-indicator visible (aria-busy)
t=1108ms      : per-marker view mounted, indicator cleared
```

0/24 polls blank. The previously-showing content (the whole-plate view in this case) never
disappears; a small `marker-refresh-indicator` badge (role="status", aria-live="polite",
`Loader2` spin icon, absolutely positioned) is overlaid on top of it, then the panel switches to the
per-marker view once the refetch resolves, exactly as before except without ever going blank.
**Screenshots** (`P17-MARKER-FLASH-after-*.png`), same 4 viewport/theme combinations: full content
(scatter plot, plate grid, well detail) stays visible with the "Refreshing marker scope…" badge in
the top-right corner of the panel; legible in both light and dark, no overlap at 768px.

### Failure case (after the fix): `GET .../markers` returns 500

- The panel stays visible immediately after the failed dispatch and 1.5s later (polled, not assumed) --
  never blank, transient or otherwise.
- A `marker-refresh-error` badge (`role="alert"`) replaces the spinner once the request settles,
  reusing the existing `useAnalysisStore().inputRevisionError` the store already tracked (this part of
  the store was already correct; only the UI's `markerEntry`-driven unmount hid the fact that a
  result — stale but still correct — was available to show).
- This also fixes the separate "permanently blank forever after one failed refetch" bug above: the
  panel is no longer gated on `markerEntry`/`markersAvailable` at all, so a failure just leaves the
  last-known-good content up with the error badge, and a later successful `markers-changed` clears it
  normally.

### No artificial delay (local/loopback speed)

A single poll at ~10ms resolution landed with the transition already complete (both testid checks
true in the same tick) at t=229ms after dispatch -- i.e. no blank frame was observable at all at this
polling resolution on an unthrottled local connection, consistent with the "not noticeable on a fast
connection, but scales with latency" expectation. The fix removes the unmount unconditionally, so
this holds by construction regardless of connection speed, not just because the local server happens
to be fast.

## What the unmount actually threw away

Since the previous panel and the new one differ by component tree (whole-plate `AnalysisTab` vs.
`MultiMarkerAnalysisPanel`, or the same component with a fresh instance), a real unmount/remount
also silently drops all local component state carried only in memory for the duration of the
refetch: any in-progress scatter-plot pan/zoom, the "Show selected only" toggle, scroll position
inside the plate view or warnings panel, and (per `P13-NTC-RACE.md`) forces a full `Plotly.newPlot`
redraw where an in-place update would have been cheaper. None of this ever produced a *wrong* result
once redrawn (the underlying store data was never corrupted), but it is exactly the kind of "small
UI state, not analysis state" loss that's easy to miss without deliberately checking for it, per the
task's third question.

## Fix

`snp-analyzer/frontend/src/components/analysis/AnalysisWorkspace.tsx`:

- Removed the `MarkerAvailability` wrapper (and the component) that unmounted the whole panel.
  `ready` is now the *only* gate on whether the panel renders at all; the choice between
  `MultiMarkerAnalysisPanel` and the whole-plate `single-marker-analysis-view` is made from the
  last-known-good `markers` array, which is never cleared during a refetch (only `markerEntry` used
  to be, and only that flag drove the old unmount).
- `markersAvailable` keeps its existing meaning and existing consumers unchanged: it still gates
  `AnalysisResultStatus`/`PlateScopeSummary`'s marker-dependent copy inside the collapsed
  `analysis-context-summary` disclosure (those already had an explicit "unavailable" state designed
  for this, consistent with how `PlateSetupTab`'s own `useMarkerScope` hook already treats a
  `markers-changed` reload -- that hook and its `PlateScopeSummary` usage were never touched or
  broken by this fix, they're a separate, pre-existing, already-correct pattern this change now makes
  the Results surface consistent with).
- Added a small, non-blocking, absolutely-positioned badge overlaid on the panel
  (`aria-busy` on its wrapper, `role="status"`/`aria-live="polite"` + a spinning `Loader2` icon while
  `useAnalysisStore().inputRevisionRefreshing`; `role="alert"` with `useAnalysisStore().inputRevisionError`'s
  message once a refresh has failed). Reuses the analysis store's existing
  `inputRevisionRefreshing`/`inputRevisionError` fields (already correct, already shared with
  `welltypes-changed` refreshes) rather than adding new state.
- New locale keys `wsMarkerRefreshing` / `wsMarkerRefreshFailed` in both `en.ts` and `ko.ts`.

### Candidates considered and not taken

- **Skeleton/spinner replacing the panel** (candidate 2 in the brief): rejected -- it still unmounts
  the panel (loses the same component state) and adds a real layout question (does the skeleton match
  the previous content's height?) that showing the actual previous content sidesteps entirely.
- **Cheaper 0->1 update path** (avoiding `AnalysisTab` -> `MultiMarkerAnalysisPanel`'s full
  `Plotly.newPlot`): out of scope for this task -- it's a rendering-cost/performance concern
  (confirmed real by `P13-NTC-RACE.md`'s CPU-throttle trace), not a "does the screen go blank"
  concern; the blank-flash fix above already removes the visible symptom regardless of which
  component swap strategy is used underneath. Left as a follow-up, same as the prior task flagged it.

## Layout budget (not touched, re-verified)

`tests/24-responsive.spec.ts:51`'s `#scatter-plot`/`#plate-grid`/`.detail-panel` bounding-box budget
at 1440x1000 was not touched -- the new badge is `position: absolute` inside a `position: relative`
wrapper, contributing 0 to document flow height. Full file re-run: 23/23 passed, unmodified
assertions.

## Unit tests (TDD)

`AnalysisWorkspace.readiness.test.tsx`:

- Two existing tests that encoded the old bug as intended behavior were rewritten to assert the
  fixed behavior instead (a test asserting `single-ready`/`multi-ready` disappear during/after a
  `markers-changed` refetch is exactly the defect being fixed here, so keeping it unchanged would
  have meant leaving a regression test *for* the bug in place):
  - `withdraws old marker scope and consumers during an external transition` ->
    `keeps the previous results panel mounted, with an aria-busy refresh badge, while an external
    marker reload is held` (both initial-marker cases): now asserts the previously-visible view stays
    visible, the `marker-refresh-indicator` is present with `role="status"`/`aria-live="polite"` and
    its parent has `aria-busy="true"`, and the indicator clears once the refetch resolves.
  - `keeps failed marker refresh unavailable while preserving the saved result` ->
    `keeps the previous results panel visible and surfaces an inline error when a marker refresh
    fails`: now asserts the panel stays visible and a `role="alert"` `marker-refresh-error` badge
    appears, instead of asserting the (bug) permanent unmount.
  - Neither the disclosure's own `marker-scope-unavailable` assertions nor any other existing test in
    this file were weakened; they still pass because `markersAvailable`'s underlying semantics did
    not change, only what it gates.
- No test was deleted, skipped, or had its assertion strength reduced -- both rewrites replace a
  "the bug's symptom is present" assertion with "the bug's symptom is absent, and the fix's behavior
  is present" assertions, which is strictly more specific, not weaker.

## Verification (4/4, `snp-analyzer/frontend`)

```
npx tsc --noEmit   -> clean
npm run lint       -> clean
npm run test       -> 125 files / 917 tests passed (baseline 125/917, no count change --
                       2 existing tests rewritten in place, 0 added/removed)
npm run build      -> tsc -b + vite build succeeded
```

## E2E (root-level `tests/`, isolated server 127.0.0.1:8201)

- New `tests/28-marker-refresh-flash.spec.ts` (2 tests, both passing): a slow-refetch case (adds a
  marker, delays `GET .../markers` 600ms, asserts the panel and badge stay up, then the per-marker
  view takes over and the badge clears) and a failed-refetch case (500 response, asserts the panel
  stays up and the error badge appears, still up 500ms later).
- `tests/24-responsive.spec.ts` (unmodified): 23/23 passed, including both `y + height <= 1000`
  budget assertions this task was told not to touch.
- Full suite (`npx playwright test --workers=1`, all 28 spec files): **140/140 passed** (baseline 138
  + the 2 new tests above), including `tests/26-asg-compatibility.spec.ts:271` (the test flagged as
  order-dependent/standalone-unsafe by other in-progress work -- untouched here, passed as part of
  the full-file run as expected).

## Files touched

- `snp-analyzer/frontend/src/components/analysis/AnalysisWorkspace.tsx` -- the fix (see above).
- `snp-analyzer/frontend/src/components/analysis/AnalysisWorkspace.readiness.test.tsx` -- two
  existing tests rewritten to assert the fixed behavior instead of the bug (see above); no other
  test in this file changed.
- `snp-analyzer/frontend/src/locales/en.ts`, `ko.ts` -- `wsMarkerRefreshing`/`wsMarkerRefreshFailed`.
- `tests/28-marker-refresh-flash.spec.ts` -- new, 2 tests, both passing.
- `docs/planning/feedback-2026-09-11/evidence/P17-MARKER-FLASH-{before,after}-{1440,768}-{light,dark}.png`
  -- before/after screenshots, 4 viewport/theme combinations each, captured mid-refetch under an
  artificial ~900ms delay.

## Out of scope, left for a future task

- The 0<->1 marker transition's full `AnalysisTab` -> `MultiMarkerAnalysisPanel` component swap (and
  therefore full `Plotly.newPlot` instead of a cheaper in-place update) is unchanged. This fix removes
  the blank-screen symptom of that swap but not the swap itself, which is a rendering-cost concern
  documented separately in `P13-NTC-RACE.md`.
