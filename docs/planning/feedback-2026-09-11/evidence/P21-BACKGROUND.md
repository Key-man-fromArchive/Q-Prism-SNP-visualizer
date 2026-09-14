# P21-BACKGROUND — visibility drift between `surface`, `tab` and real screen state

Branch: `feedback/p21` (worktree `worktree/feedback-p21`, from `main` at `008eb7b`, merged forward
to `main` at `c0b2c08` mid-task -- see "main moved" section below).
Isolated server: `127.0.0.1:8217` / `/tmp/p21.db` (removed after use).

## Scope

External review (Codex) flagged that `MultiMarkerAnalysisPanel.tsx`'s `backgrounded` gate (added by
the P17-MARKER-FLASH follow-up specifically to stop auto-clustering for a panel nobody is looking
at) is incomplete, and that `CycleControl.tsx`'s playback loop has no visibility gate at all. Both
were investigated by reading the code, then confirmed by measuring real network requests against
the isolated server -- not by trusting the report at face value.

## Problem A: `backgrounded` missed leaving the workspace for a plain top-level tab

`MultiMarkerAnalysisPanel.tsx`'s `backgrounded` was `useNavigationStore(state => state.surface) !==
'analysis'`. `navigation-store.ts`'s `setTab` only keeps `surface` in sync with the active tab while
that tab is `plate`/`results`:

```ts
setTab: tab => set(state => ({ tab, surface: tab === 'plate' ? 'plate' : tab === 'results' ? 'analysis' : state.surface })),
```

Moving to any other top-level tab (Settings, Quality, Project, ...) leaves `surface` reading whatever
it was on Results -- even though `App.tsx` CSS-hides the entire workspace (`AnalysisWorkspace`, and
everything mounted inside it, `MultiMarkerAnalysisPanel` included) the moment the active tab stops
being a workspace tab (`isWorkspaceTab(activeTab) ? "" : "hidden"`). So: open Results (surface
becomes `'analysis'`), move to Settings (tab becomes `'settings'`, surface is left at `'analysis'`),
change ROX/background there -- `backgrounded` reads `false` (foregrounded) for a panel the operator
cannot see, and the P17 follow-up's own auto-cluster debounce fires for real.

`fetchScatter` (the scatter fetch that feeds the plot) had no visibility gate at all, foreground or
background -- it was never touched by the P17 follow-up because at the time it wasn't keyed on
`markers` and stayed flat during that task's specific repro (marker edits). It IS keyed on
`useRox`/`backgroundMode`/`cycle`, so the same Settings-tab change also fires it unconditionally.

## Problem B: `CycleControl`'s playback interval has no visibility gate

`CycleControl.tsx` is mounted once (inside both `AnalysisTab` and `MultiMarkerAnalysisPanel`, both
inside `AnalysisWorkspace`) and never unmounted while a session is open -- the same "CSS-hide, never
unmount" design the P17 follow-up's own doc describes for the two workspace panels. Its play
`setInterval` had no check of any kind: `if (!isPlaying || !ready || cycles.length < 2) return;`.
Switching to any other tab while playback is on leaves the interval running every 500ms, advancing
`currentCycle` in `navigation-store` for a screen nobody can see -- which in turn keeps driving
`MultiMarkerAnalysisPanel`'s (and `ScatterPlot`'s, for the single-marker view) per-cycle scatter
fetch.

## Root cause, in one sentence

There was no single, reusable answer to "is the Results surface actually the thing on screen right
now" -- `surface` is a logical flag that survives leaving the workspace, and nothing else checked
`tab` at all. Two independent call sites had already started disagreeing about it (one used `surface`
alone, the other used nothing).

## Fix: one shared visibility primitive

`navigation-store.ts`:

```ts
export function isResultsSurfaceActive(state: Pick<NavigationValue, 'tab' | 'surface'>): boolean {
  return isWorkspaceTab(state.tab) && state.surface === 'analysis';
}
```

`isWorkspaceTab` (pre-existing, exported) is `tab === 'plate' || tab === 'results' || tab ===
'analysis'` -- the same check `App.tsx` already uses to decide whether to CSS-hide the entire
workspace. Combined with `surface === 'analysis'` (the Results half of the two-surface workspace,
as opposed to Plate Setup), this is exactly "is `AnalysisWorkspace`'s Results panel what's on screen
right now", reusable by any consumer instead of each guessing independently.

- `MultiMarkerAnalysisPanel.tsx`: `backgrounded = !useNavigationStore(isResultsSurfaceActive)`,
  replacing the `surface`-only check. Also newly gates the (previously unconditional) `fetchScatter`
  effect: `if (backgrounded) return;` before firing. `backgrounded` flipping back to `false` re-runs
  the effect for exactly one catch-up fetch reflecting whatever the input became while backgrounded
  -- no new state needed, same pattern the P17 follow-up already established for clustering.
- `CycleControl.tsx`: a new `resultsVisible = useNavigationStore(isResultsSurfaceActive)` is added to
  the playback interval's guard: `if (!isPlaying || !ready || !resultsVisible || cycles.length < 2)
  return;`.

### Playback decision: pause the interval, don't advance silently in the background

Two options were considered for what playback should do while hidden: (a) stop the interval
entirely (cycle frozen at whatever it was when the tab was left), or (b) keep the interval ticking
(so the "play" affordance stays true to its label) but suppress only the network side effects.

**(a) was chosen.** `isPlaying` itself is left untouched (not flipped to `false`), so returning to
Results resumes immediately with no extra click -- matching what an operator who glanced away for a
few seconds would expect ("it's still playing, from where I was"), not "it kept running invisibly and
jumped ahead while I wasn't looking". Option (b) would have meant inventing a second concept
("logically playing, cycle frozen, but still fetching once per tick to keep an invisible plot fresh")
for zero observable benefit -- nothing reads `currentCycle` for anything other than driving the
visible plot and its per-cycle fetch, so there is no downstream state that needs to keep advancing
while the screen is hidden. This also sidesteps needing a "how many ticks would have happened"
catch-up computation on return; the single `backgrounded`-gated re-fetch already used by
`MultiMarkerAnalysisPanel` naturally supplies the one catch-up fetch for whatever cycle is current at
return.

### Browser-tab visibility (`document.visibilityState`) was deliberately left out of scope

This fix only addresses in-app tab navigation (`navigation-store`'s `tab`/`surface`), not OS-level
tab-switch/minimize (`document.visibilityState`/`Page Visibility API`). Reasoning: the reported
defect (and the P17 follow-up it extends) is specifically about the app's *own* two-surface
workspace CSS-hiding content that stays mounted -- a problem that exists even with the browser tab
fully focused and visible. Browser-tab backgrounding is a separate, orthogonal condition (the whole
page, canvas included, goes invisible at the OS level) with its own existing browser-level throttling
(background tabs already get `setInterval` throttled to >=1000ms by most browsers, and rAF is paused
entirely) -- a real but different problem, undocumented as a specific complaint here, and adding it
would broaden this fix's blast radius (a new `visibilitychange` listener touching every consumer of
this new primitive) without a corresponding measured complaint. Left as a candidate follow-up, not
folded into this fix.

## Measured, before touching any code (`page.on('request')`, isolated server, real UI clicks)

Real `.eds` upload (`/mnt/ivt-ngs1/.../260126-QS3.eds`, 23 cycles, 3 windows) with one marker created
(so `MultiMarkerAnalysisPanel` -- the component this task's fix touches -- actually mounts, not the
single-marker `AnalysisTab`), background-mode changed via the real Settings-tab `<select>`, playback
via the real Play button, tab switches via the real "More > Settings" / "Results" clicks. "Before"
captured by reverse-applying this fix's diff on top of the already-merged tree (`git apply -R`,
confirmed `tsc --noEmit` clean on the reverted tree too, then rebuilt/restarted the server) so the
comparison isolates exactly this change, not an unrelated older commit.

### Scenario 1: background-mode changed after leaving Results for the Settings tab

| Build | While on Settings (backgrounded), right after the change | After returning to Results |
|---|---|---|
| before this fix | **1x `/cluster`, 1x `/scatter`** -- fired immediately for a panel nobody could see | 1x `/cluster`, 1x `/scatter` (unchanged -- already fired) |
| after this fix | **0x `/cluster`, 0x `/scatter`** | **1x `/cluster`, 1x `/scatter`** -- exactly one catch-up analyze + fetch, reflecting the changed setting |

### Scenario 2: playback left running, tab switched to Settings for 3 seconds

| Build | 1200ms of play on Results (baseline) | 3000ms on Settings while still "playing" | cycle value before switch -> after return | 1200ms back on Results |
|---|---|---|---|---|
| before this fix | 0x `/cluster`, 2x `/scatter` | **0x `/cluster`, 6x `/scatter`** (one every ~500ms, matching the interval exactly) | 2 -> **9** (advanced 7 steps invisibly) | 0x `/cluster`, 3x `/scatter` (continues exactly as if nothing had happened) |
| after this fix | 0x `/cluster`, 2x `/scatter` | **0x `/cluster`, 0x `/scatter`**, flat for the entire 3s | 2 -> **2** (frozen, as designed) | 0x `/cluster`, 3x `/scatter` -- resumes immediately, no extra click |

Clustering is already paused during playback regardless of this fix (`isPlaying` is one of
`settledAnalysisPaused`'s existing reasons), which is why `/cluster` is 0 in every playback row above
-- expected, not a symptom of this bug. The bug is entirely in `/scatter` (and, in Scenario 1, the
one real wasted `/cluster` call).

## TDD (RED first)

- `MultiMarkerAnalysisPanel.requests.test.tsx`: two new tests --
  `does not auto-analyze a settings change made after leaving the workspace for a plain top-level
  tab, but does once back on Results` and `does not re-fetch scatter for a settings change made
  after leaving the workspace for a plain top-level tab, but does once back on Results`. Both use
  the real `setTab('results')` -> `setTab('settings')` -> `setTab('results')` sequence (the same
  action a real "More > Settings" click runs), confirmed RED against the pre-fix code (`runClustering`
  called once instead of zero while backgrounded; `getScatter` called twice instead of once).
- `CycleControl.test.tsx`: one new test -- `pauses cycle advancement while the workspace is not the
  active top-level tab, and resumes on return without re-clicking play`. Confirmed RED against the
  pre-fix code (`currentCycle` kept advancing every 500ms regardless of `tab`).
- No existing assertion was weakened, removed, or skipped. The existing `surface: 'plate'`-backgrounded
  test in `MultiMarkerAnalysisPanel.requests.test.tsx` (the P17 follow-up's own guarantee) was left
  untouched and still passes -- `isResultsSurfaceActive` returns the same `false` for that case
  (`isWorkspaceTab('plate')` is `true`, but `surface !== 'analysis'`), so no regression there.

## Verification (4/4, `snp-analyzer/frontend`)

Baseline received: 125 files / 919 tests. `main` moved forward mid-task (P19/P20/P22/P24/P25 merged
in); merged locally, new baseline **129 files / 951 tests**.

```
npx tsc --noEmit   -> clean
npm run lint       -> clean
npm run test       -> 129 files / 954 tests passed (129/951 baseline + 3 new: 2 in
                       MultiMarkerAnalysisPanel.requests.test.tsx, 1 in CycleControl.test.tsx)
npm run build      -> tsc -b + vite build succeeded
```

One flake unrelated to this change: `CompareTab.test.tsx`'s `handles real stats wire shape with
nullable Pearson and wrong identity=false` failed once in a full-suite run. Reproduced independently
of this fix -- passes 3/3 standalone and file-scoped, and the *baseline* tree (this fix fully
reverted, before the merge) shows the identical intermittent failure in full-suite runs too (2/2
clean runs, then reproduced once more with the fix present, 2/2 clean runs after). Not touched.

### Backend (unaffected -- no backend files touched by this fix)

`pytest` (shared venv): **823 passed + 2 subtests**, matching the post-merge baseline exactly.

## E2E

Isolated server `127.0.0.1:8217` (`/tmp/p21.db`, removed after use).

- Full root-level suite (`tests/`, `--workers=1`, 140 tests across 22 spec files), run twice: once
  before merging `main` (**140/140**) and once after merging `main` and rebuilding (**140/140**),
  both against a freshly-seeded server.
- The two `zz-p21-measure.spec.ts` ad-hoc scripts used for the request-count table above (not part
  of the permanent suite -- deleted after use) also passed in both the before-fix and after-fix
  configurations; they assert nothing beyond the measurement, no result depends on them staying in
  the repo.

## Files touched

- `snp-analyzer/frontend/src/stores/navigation-store.ts` -- new `isResultsSurfaceActive` export.
- `snp-analyzer/frontend/src/components/analysis/MultiMarkerAnalysisPanel.tsx` -- `backgrounded` now
  uses `isResultsSurfaceActive`; `fetchScatter`'s effect gated on it too.
- `snp-analyzer/frontend/src/components/analysis/CycleControl.tsx` -- playback interval gated on
  `isResultsSurfaceActive` (as `resultsVisible`).
- `snp-analyzer/frontend/src/components/analysis/MultiMarkerAnalysisPanel.requests.test.tsx` -- 2 new
  tests (see TDD section).
- `snp-analyzer/frontend/src/components/analysis/CycleControl.test.tsx` -- 1 new test (see TDD
  section).
- `docs/planning/feedback-2026-09-11/evidence/P21-BACKGROUND.md` -- this document.

## Main moved mid-task

`main` advanced past this branch's fork point while this task was in progress (P19 well x cycle
alignment, P20 stale-scatter-response protection in `MultiMarkerAnalysisPanel.tsx` itself, P22
no-signal clustering/`algorithm_version`, P24 well-detail-panel genotype-inference removal, P25 a
documentation-only port correction). Merged locally (`git merge main`, commit `8c6be4c`); the only
overlapping file was `MultiMarkerAnalysisPanel.tsx` (and its `.requests.test.tsx`), which auto-merged
cleanly -- P20's `dataGeneration`/`startedAtGeneration` capture inside `fetchScatter` and this task's
`backgrounded` gate around the effect that calls it are both intact and compose correctly (confirmed
by reading the merged file and by the full verification above, run post-merge). `WellDetailPanel.tsx`
still carries an unused `ploidyOverride` prop (kept, per P24, because `MultiMarkerAnalysisPanel.tsx`
still passes it) -- left untouched here as an unrelated pre-existing cleanup opportunity, out of this
task's scope.

## Out of scope, left for a future task

- `document.visibilityState` (OS-level tab backgrounding/minimizing) -- see rationale above.
- `WellDetailPanel.tsx`'s dead `ploidyOverride` prop -- pre-existing, flagged by another task's
  handoff note, not touched here to keep this fix's diff scoped to visibility gating.
