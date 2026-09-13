# P13-NTC-RACE — investigating the NTC-corner client-state race

Branch: `feedback/p13-investigate` (worktree `worktree/feedback-p13`, from `main` at `b96062a`).
Isolated server: `127.0.0.1:8195` / `/tmp/p13.db`.

## Scope and starting point

P8-E2E-DEBT.md flagged, but explicitly did not root-cause, an intermittent failure in
`tests/17-manual-group-and-plate-drag.spec.ts`'s second test ("dragging the NTC corner saves a
two-channel threshold without freezing genotype rays"): `expect(corner).not.toBeNull()` at what is
now line 202 (`:58` in some historical reports referred to the same failure surfacing in test 1
instead). Reported ~40% failure rate in isolation, worse interleaved with test 1, "not
backend-latency, looks like a client-side race in `MarkerScatterPlot`/`MultiMarkerAnalysisPanel`
state after `markers-changed`."

Reconfirmed the baseline before changing anything: 1/5 isolated reruns failed (matches the
historically observed range).

## Raising the reproduction rate

Ran an instrumented copy of the test with:
- `page.on('request'/'response')` logging every markers/session/scatter/cluster call with
  timestamps.
- An in-page `requestAnimationFrame` loop dumping, every frame: whether
  `[data-testid="single-marker-analysis-view"]` is still mounted, whether
  `[data-testid="marker-scatter"]` exists, and that node's `.data` trace names.
- A CDP `Emulation.setCPUThrottlingRate` session to slow rendering deterministically instead of
  relying on natural timing luck.

At 20x CPU throttle, the timeline showed (all times relative to the `markers-changed` dispatch):

```
t=0     single-marker-analysis-view: mounted,   marker-scatter: absent
t=155   single-marker-analysis-view: unmounted, marker-scatter: absent   <- blank gap starts
t=2024  single-marker-analysis-view: unmounted, marker-scatter: mounted, traces=[Unassigned, NTC thresholds]
```

This pinpoints the exact race and its two competing async flows:

1. **`use-analysis-workspace.ts`'s `markers-changed` handler** (`refreshMarkers`) synchronously
   sets `markerEntry` to `null`, then awaits `Promise.all([getSessionInfo(session),
   getMarkers(session)])` before setting it back. `AnalysisWorkspace.tsx`'s `MarkerAvailability`
   renders nothing at all (not even a loading state) while `markerEntry !== entry`. In this test's
   scenario (0 markers -> 1 marker), that also flips which component is mounted at all
   (`single-marker-analysis-view`'s `AnalysisTab` vs. `MultiMarkerAnalysisPanel`), so the "results"
   surface briefly unmounts entirely, then mounts `MultiMarkerAnalysisPanel` -> `MarkerScatterPlot`
   from scratch once the refetch resolves.
2. **`MarkerScatterPlot`'s own mount effect**, which calls the async `Plotly.newPlot(...)` for the
   first draw. The `[data-testid="marker-scatter"]` div exists (and is "visible") the instant React
   commits it, but `gd.data` -- and therefore the `'NTC thresholds'` trace this test searches for --
   is not populated until that promise resolves.

Neither of these is a genuine state race in the sense of "two writers touching the same value out of
order and corrupting it." The NTC trace is unconditionally `traces.push(...)`'d on every single run
of `MarkerScatterPlot`'s render effect (`MarkerScatterPlot.tsx:368-385`), regardless of `region`,
`assignments`, or `marker.threshold_config` -- confirmed with a new unit test (see below) asserting
it's present in the very first `Plotly.newPlot` call, before any cluster result exists. There is no
code path in `MarkerScatterPlot.tsx`/`MultiMarkerAnalysisPanel.tsx` that ever omits, delays past
mount, or corrupts this trace once Plotly has drawn it.

## Verdict: test debt (two independent test-only bugs), not a client-state product bug

**Bug 1 -- premature "settled" on `null`.** `whenSettled`'s loop returned as soon as two consecutive
polls were textually equal, including two consecutive `null`s. `null` means "not drawn yet", not "a
stable value" -- so any run where the ~150-300ms mount+draw gap above happened to straddle two
250ms-spaced polls would report a false "corner is null, and it's stable" instead of continuing to
wait. This is the mechanism that explains a ~40% failure rate from a gap that's normally only a few
hundred milliseconds: it only takes bad luck in poll phase, not a slow render.

**Bug 2 -- a second, larger contributor found while reproducing under load.** Running test 1
immediately before test 2 (matching the file's real execution order) still failed intermittently
even with bug 1 fixed, but with the poll fully exhausting all attempts (not a premature return).
Dumping the plot's actual trace names on that failure showed `["미지정", "NTC 임계값"]` -- Korean,
not English. `language-store.ts` defaults to `language: 'ko'`; both tests only switch to English via
`if (await english.isVisible()) await english.click()`, a single no-retry visibility check taken the
instant after `page.goto('/')` resolves. `page.goto` only waits for the network `load` event; the
app still does an async auth-check before deciding whether to render `LoginPage` (and its language
toggle) at all. Under host contention that decision can take long enough that the check reads
"not visible yet" and silently skips the switch -- pinning that entire test run to Korean, where the
hardcoded string `'NTC thresholds'` can never match anything, for the full run, not just a narrow
window. A new unit test (`MarkerScatterPlot.ntc-race.test.tsx`) confirms this is real, current
behavior: without an explicit `language: 'en'`, the trace's name is `'NTC 임계값'`, not
`'NTC thresholds'`.

Both are test-harness defects (a polling helper with a false-positive stop condition, and a
locale-switch check with no wait), not application logic that corrupts or "freezes" state for a
real user. Once Plotly finishes its draw, the corner is always at the correct, current position --
nothing lingers stale or wrong.

## Is this reachable by a real user, and what would they see?

The underlying async gap (component swap + `Plotly.newPlot`) is real and would be reachable by an
end user: adding the first marker (or any `markers-changed` event while the Results surface is open)
does briefly unmount the entire Results panel with no loading indicator, then mounts a fresh Plotly
instance. On a normal connection this is on the order of 100-300ms and self-resolves correctly; nothing
is ever stuck in a wrong state afterward. This is a minor, pre-existing UX rough edge (a loading-state
gap with no spinner, and a full Plotly rebuild where an in-place update would be cheaper and
smoother) rooted in `AnalysisWorkspace.tsx`'s `MarkerAvailability`/`use-analysis-workspace.ts`'s
`markerEntry` reset -- **outside this task's write scope** (`MarkerScatterPlot.tsx` /
`MultiMarkerAnalysisPanel.tsx` only). Flagging it for a future task rather than fixing it here, per
the same "document, don't silently expand scope" practice as P8. It is not the "frozen genotype
rays" scenario in the test's title -- that refers to the separate, already-passing
`threshold_config.boundaries` assertion a few lines later, unrelated to this corner-timing issue.

## Fix applied (`tests/17-manual-group-and-plate-drag.spec.ts`, wait-strategy only, no assertions touched)

1. `whenSettled`: `null` can never satisfy the "same value twice" check; only a non-null,
   twice-repeated value counts as settled. `null` always keeps polling until `attempts` (raised from
   12 to 20, i.e. up to 5s) is exhausted.
2. Added `ensureEnglish(page)`, replacing both files' `if (await english.isVisible()) await
   english.click()`. It waits for the login page's language toggle (which always shows exactly one
   of `English`/`한국어`) to actually appear before deciding whether to click, instead of reading
   visibility once with no retry.

Neither change touches any `expect(...)` assertion; both only change how long/how the test waits
before reading state, per the write-scope constraint.

## RED evidence (unit test, `MarkerScatterPlot.ntc-race.test.tsx`)

Two new Vitest tests document the mechanism the fix relies on:

- `includes the NTC thresholds trace in the first newPlot call, before any cluster result exists`:
  asserts the NTC trace is part of the very first `Plotly.newPlot(...)` call, with `region={undefined}`
  and no NTC-assigned wells -- exactly the state right after a fresh marker is created and before
  `analyzeCurrent`'s debounced cluster request resolves. Locks in "the app never conditionally omits
  this trace", so a future regression that made it conditional would fail this test rather than only
  surfacing as an occasional E2E flake.
- ``names the NTC trace in Korean by default, matching language-store's default``: demonstrates that
  without an explicit `language: 'en'`, the trace name is `'NTC 임계값'`, confirming bug 2 above is
  real app behavior, not a hypothesis.

Both pass; `npx vitest run src/components/analysis/MarkerScatterPlot.ntc-race.test.tsx` -> 2/2.

## Reproduction-rate statistics (10+ consecutive runs, per instructions)

All runs against the isolated server at `127.0.0.1:8195`, `--workers=1`.

**Before fix** (baseline reconfirmation): 1/5 isolated single-test reruns failed.

**After fix**, in quiet-host windows (confirmed via `ps aux`/`uptime` no other agent's Chromium/E2E
process active):
- 15/15 consecutive runs of the full spec file (both tests) -- 0 failures.
- 20/20 consecutive isolated runs of test 2 alone (debug copy with full instrumentation) -- 0
  failures.
- 8/8 test-2 passes in a batch that also ran test 1 immediately before it each time (test 1 itself
  flaked 2/8 on its own, separate, out-of-scope `ScatterPlot.tsx` NTC-corner assertion under real
  concurrent-agent host contention -- see below).

**Under real concurrent-agent contention** (mid-session, `ps aux` showed another agent's isolated
`uvicorn` on port 8197 *and* multiple `chrome-headless-shell` renderer processes from
`worktree/feedback-p15`'s own Playwright run active on this shared 32-core host, load average
5-7): a batch of 10 runs of the full spec file showed 4/10 failures on test 2 and re-confirmed the
Korean-locale mechanism as the dominant cause in that window (fully exhausting the 5s poll budget,
not returning early). Once that agent's E2E run finished and load settled (`uptime` back to ~3-3.5,
no other Chromium processes), a fresh batch of 15/15 consecutive runs of the full spec file passed
cleanly with consistent ~9.3-9.9s timings (no poll-budget exhaustion in any run) -- confirming the
fix, not a quieter host alone, is what resolved it: the earlier 15/15 and 20/20 clean batches
already ran successfully before this contention window even started.

**Final full-suite runs** (`npx playwright test --workers=1`, all 27 spec files):
- Run 1: **137/137 passed** (7.3m).
- Run 2 (double-checked immediately after): **136/137 passed** (7.6m) -- the one failure was
  `tests/26-asg-compatibility.spec.ts:271` ("exchanges an ASG launch once..."), a file untouched by
  this task and unrelated to markers/scatter/NTC. `tests/17-manual-group-and-plate-drag.spec.ts`
  passed both tests cleanly in both runs.

## Verification (4/4, `snp-analyzer/frontend`)

```
npx tsc --noEmit   -> clean
npm run lint       -> clean
npm run test       -> 125 files / 908 tests passed (baseline 124/906 + the new
                       MarkerScatterPlot.ntc-race.test.tsx file's 2 tests)
npm run build      -> tsc -b + vite build succeeded
```

## Files touched

- `tests/17-manual-group-and-plate-drag.spec.ts` -- `whenSettled` null-handling fix, `ensureEnglish`
  helper replacing both call sites' unguarded `isVisible()` check. No assertions changed.
- `snp-analyzer/frontend/src/components/analysis/MarkerScatterPlot.ntc-race.test.tsx` -- new,
  2 tests, both passing (regression guard, not a fix to production code -- none was needed in
  `MarkerScatterPlot.tsx`/`MultiMarkerAnalysisPanel.tsx`; both already behave correctly).

## Out of scope, flagged for a future task

- `AnalysisWorkspace.tsx`'s `MarkerAvailability` unmounts the entire Results surface (no loading
  state) while `use-analysis-workspace.ts` refetches markers after `markers-changed`, and the
  0-markers/1-marker transition forces a full `AnalysisTab` -> `MultiMarkerAnalysisPanel` swap
  (full `Plotly.newPlot` instead of a cheaper `Plotly.react` update). A future task could keep
  rendering the previous markers/results during the refetch (dropping the `setMarkerEntry(null)`
  reset) to remove the blank flash and shrink the remount cost -- neither file is in this task's
  write scope.
- Test 1's own NTC-corner assertion (`ScatterPlot.tsx`, whole-plate view) hit the same class of
  failure under real concurrent-agent load in this investigation, consistent with P8's prior note
  that it also surfaces there. `ScatterPlot.tsx` is not in this task's write scope; the shared
  `whenSettled` fix in this spec file benefits it too, but its residual sensitivity to heavy,
  real host contention (GPU driver "stall due to ReadPixels" messages were observed in the console
  during a failing run) is an environmental characteristic of this shared machine, matching the
  same category the orchestrator already established for `24-responsive.spec.ts`/`20-keyboard`.
