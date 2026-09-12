# P3-S0-V (implementation part) — root E2E specs updated for the new IA

Branch: `feedback/p3-ia` (worktree `worktree/feedback-p3`)

Scope actually touched: `tests/**` only (the 7 named specs). No file under
`snp-analyzer/` was touched. No Phase merge, remote push, deployment or
notification was performed.

## Why: what P3-S1-T1 / P3-S2-T1 changed underneath these specs

`e13c349` (P3-S1-T1) replaced the old top-level `analysis` tab (with its
nested `WorkspaceTabs` sub-navigation, `workspace-tab-plate` /
`workspace-tab-analysis`) and the old `protocol` tab with three top-level
tabs: `plate`, `rawdata`, `results`. `settings` was demoted into the "More"
overflow menu. Confirmed directly from the shipped component
(`src/components/layout/TabNavigation.tsx`, `src/stores/navigation-store.ts`,
`src/App.tsx`, `src/components/analysis/AnalysisWorkspace.tsx`):

- Primary `role="tab"` order (only these get an `id="tab-<dataTab>"` and are
  reachable via `ArrowRight`/`Home`/`End`): `plate, rawdata, results, quality,
  statistics, compare, library, project` — **8** tabs, not 10.
- Overflow ("More" menu, `role="menuitem"`, no `id`/`data-testid`, matched
  only by accessible name): `Settings, References, Users(admin), Feedback(admin)`
  — **4** items for an admin account (`tests/helpers.ts`'s `login()` uses the
  admin credentials).
- The former single "Analysis" workspace tab's two sub-surfaces are now each
  a top-level tab: `plate` owns `PlateSetupTab` (`main-panel-plate`,
  `workspace-panel-plate`), `results` owns the legacy single/multi-marker
  view — `PlateView`/`#plate-grid`/`#detail-content`/`#amplification-plot`/
  `ResultsTable`/`#results-plate` (`main-panel-results`,
  `workspace-panel-analysis`). Both panels are always mounted; only one is
  CSS-hidden at a time, toggled by which top-level tab is active.
- `ProtocolTab` (`#protocol-table`, `#add-step-btn`) now renders under
  `activeTab === "rawdata"`, not `"protocol"`.
- Default landing state after a session is analyzed: `tab=results`,
  `surface=analysis` (verified live, see below) — **not** `plate`, so any
  test that used to assume the first/active tab was `analysis` now has to
  target `results` for "currently active", and `plate` for "first in DOM
  order" (these are two different tabs now, whereas before P3-S1-T1 they
  were the same tab).

Verified this live against the built app (temporary probe spec, deleted
before commit) rather than only reading source:

```
URL after analyze: .../?session=...&tab=results&surface=analysis&cycle=40&marker=
active tab id: tab-results
all primary tab ids in order: [tab-plate, tab-rawdata, tab-results, tab-quality,
  tab-statistics, tab-compare, tab-library, tab-project]
overflow menu items: [Settings, References, Users, Feedback]
tab-plate click -> tab=plate&surface=plate (workspace-panel-plate visible, -analysis hidden)
tab-results click -> tab=results&surface=analysis (panel visibility flips back)
```

## Per-spec changes

### `tests/05-interactions.spec.ts`
`Tab Switching`/`Protocol Tab` describes renamed to reflect the surface they
actually exercise: `.tab[data-tab="protocol"]``#tab-protocol` →
`rawdata`; `.tab[data-tab="analysis"]``#tab-analysis` → `results` (this
suite uses a raw CFX upload, not the example session, but lands on the same
default `results` tab — confirmed by running it).

### `tests/20-keyboard.spec.ts`
The keyboard-only tab-cycle assertions assumed `analysis` was both (a) the
active/focusable (`tabIndex=0`) tab and (b) reachable from `settings` via one
more `ArrowRight`. Neither holds anymore: (a) the active tab after analysis
is `results`, and (b) `settings` moved out of the roving-tabindex `role="tab"`
list entirely (it's overflow-only now), so it's unreachable by arrow keys.
Rewrote the sequence to start at `#tab-results`, arrow through `quality` →
`statistics` (both ordinary primary tabs, structurally equivalent
replacements for the removed `settings` stop), confirm `Home` lands on the
new first tab `#tab-plate` (not back on `results` — `Home` always jumps to
DOM index 0, and that index moved), then two more `ArrowRight` presses
(still keyboard-only, no mouse) to land back on `#tab-results` before the
rest of the test exercises `#plate-grid` (which only exists inside the
`results` surface).

### `tests/21-workspace-restore.spec.ts`
- `#tab-settings` click → `More` button + `Settings`/`설정` menuitem click
  (settings is overflow-only, `#tab-settings` no longer exists as an element
  at all — this selector would time out, not just assert the wrong thing).
- `#tab-analysis` click, then `workspace-tab-plate` click (two-step: enter
  the workspace, then switch its inner sub-tab) → single `#tab-plate` click
  (Plate Setup is now reached directly, no inner sub-tab exists anymore).
- `workspace-tab-plate`/`workspace-tab-analysis` (click + `aria-selected`
  assertions across reload/back/forward) → `#tab-plate`/`#tab-results`.
- Second `#tab-analysis` click at the end (return to "the workspace") →
  `#tab-results`, since `surface` was already `analysis` at that point and
  `results` is the tab that actually owns that surface now.
- Left the third test (`tab=analysis&surface=analysis` legacy-URL
  compatibility test) **untouched** — it deliberately exercises
  `remapLegacyQuery`'s (P3-S2-T1) backward-compatibility handling of the old
  query shape, not a stale selector.

### `tests/23-undo.spec.ts`
`workspace-tab-plate` click → `#tab-plate` (one occurrence).

### `tests/24-responsive.spec.ts`
- `workspace-tab-plate`/`workspace-tab-analysis` clicks → `#tab-plate` /
  `#tab-results` (2 occurrences).
- `firstTab = page.locator('#tab-analysis')` → `#tab-plate` (first tab in DOM
  order moved).
- The keyboard tab-cycle loop (`ArrowRight` through every primary tab, then
  `Home`) ends on `plate`, but the very next assertion reads
  `.analysis-grid`'s resolved `grid-template-columns`, and that element only
  renders (is not `display:none`) under the `results` surface. Pre-P3-S1-T1,
  `Home` returned to the same tab (`analysis`) that owned `.analysis-grid`,
  so this was never an issue; now it isn't. Added two more `ArrowRight`
  presses (`plate → rawdata → results`, still keyboard-only) after the `Home`
  assertion before reading the grid, matching the fix already applied in
  `20-keyboard.spec.ts` for the identical structural reason. Root-caused via
  `getComputedStyle` returning the **specified** (raw stylesheet, `"repeat(2,
  minmax(0, 1fr))"` → 3 space-separated tokens) rather than **resolved**
  value for an element that isn't rendered (ancestor `display:none`) — that
  is what produced the "Received: 3" failures before this fix, confirmed by
  reading `src/index.css`'s single `.analysis-grid` media-query rule (only
  ever 1 or 2 real tracks) and by the fix actually clearing the failure.
- Two already-stale assertions (broken before P3, not touched by P3-S1-T1/
  P3-S2-T1 — see below).

### `tests/25-secondary-flows.spec.ts`
- `#tab-settings` click (one leftover occurrence; the file already had an
  `openOverflowTab` helper used elsewhere in the same file for
  References/Users) → `openOverflowTab(page, t.tabSettings)`.
- `#tab-protocol` click → `#tab-rawdata`.
- `workspace-tab-plate`/`workspace-tab-analysis` (4 occurrences, including
  one `aria-selected` assertion) → `#tab-plate`/`#tab-results`.

### `tests/26-chart-semantics.spec.ts`
`workspace-tab-plate`/`workspace-tab-analysis` → `#tab-plate`/`#tab-results`
(1 occurrence each).

Post-edit check (per the assignment's requirement):
```
$ grep -ohE "workspace-tab-|tab-analysis|tab-protocol|main-panel-analysis|main-panel-protocol" tests/*.spec.ts
(no output)
```

## The two already-stale assertions in `24-responsive.spec.ts` (root-caused, not just patched to pass)

Both were wrong **before** P3 too — P3-S1-T1/P3-S2-T1 did not introduce
either bug, they just made the numbers obviously wrong in a different way.

**`role="tab"` count, ~line 171.** Old value `10` = 8 old primary tabs + 2
`WorkspaceTabs` sub-tabs (`workspace-tab-plate`/`workspace-tab-analysis`,
which also carried `role="tab"`, confirmed by reading the pre-P3-S1-T1
component via `git show e13c349^:snp-analyzer/frontend/src/components/analysis/AnalysisWorkspace.tsx`
history referenced in `P3-S1-T1`'s own evidence doc). P3-S1-T1 deleted that
inner `role="tablist"` entirely — there are only ever 8 `role="tab"`
elements in the whole app now (the primary `TabNavigation` list; overflow
items are `role="menuitem"`, not `role="tab"`). New value: **8**.

**"More" overflow `menuitem` count, ~line 174.** Old value `2`. Traced via
`git log -p tests/24-responsive.spec.ts` (this assertion) and
`git log --oneline -- '**/TabNavigation*'`: at `bb7118e` (2026-09-07, when
this assertion was written), the overflow held exactly 2 items —
`references` and `users` (`adminOnly`). `38fda85` (2026-09-11, "Collect user
feedback in the app") added `feedback` as a third `adminOnly` overflow tab,
and this assertion was never bumped to 3 — **it was already broken on `main`
before P3 started** (confirmed: it is not in the list of files P3-S1-T1 or
P3-S2-T1 touched, per those tasks' own evidence docs, and the count mismatch
predates both by commit date). P3-S1-T1 additionally moved `settings` itself
into the same overflow menu, making the current true count 4
(`settings, references, users, feedback`, all visible to the admin account
`tests/helpers.ts login()` uses). New value: **4**. Confirmed by live probe
(see "overflow menu items" list above) and by the fixed assertion passing.

## Execution

Isolated per the assignment's instructions: fresh `DB_PATH=/tmp/p3-e2e.db`,
`SNP_AUTH_MODE=local`, backend on `127.0.0.1:8120` (port 8002 and the
production DB were never touched), frontend built once
(`snp-analyzer/frontend && npm run build`).

### The 7 target specs — all pass

```
$ npx playwright test tests/05-interactions.spec.ts --project=chromium --workers=1
  16 passed

$ npx playwright test tests/20-keyboard.spec.ts --project=chromium --workers=1
  2 passed

$ npx playwright test tests/21-workspace-restore.spec.ts --project=chromium --workers=1
  3 passed

$ npx playwright test tests/23-undo.spec.ts tests/26-chart-semantics.spec.ts --project=chromium --workers=1
  7 passed

$ npx playwright test tests/24-responsive.spec.ts --project=chromium --workers=1
  23 passed

$ npx playwright test tests/25-secondary-flows.spec.ts --project=chromium --workers=1
  27 passed
```

Total: **78/78 passed** across the 7 specs (16+2+3+2+23+5+27, where
23-undo=2 and 26-chart-semantics=5 in the combined run above).

### The other 13 specs — regression check

```
$ npx playwright test tests/01-homepage.spec.ts tests/02-upload-quantstudio.spec.ts \
    tests/03-upload-cfx.spec.ts tests/04-error-files.spec.ts tests/06-import-mapping.spec.ts \
    tests/17-manual-group-and-plate-drag.spec.ts tests/18-file-workspace.spec.ts \
    tests/18-result-consistency.spec.ts tests/19-feedback.spec.ts tests/19-qc-status.spec.ts \
    tests/22-error-recovery.spec.ts tests/26-asg-compatibility.spec.ts tests/test-windows.spec.ts \
    --project=chromium --workers=1
  Run 1: 51 passed, 7 failed
  Run 2 (rerun): 52 passed, 6 failed
```

7 (later 6, see below) failures, individually root-caused and classified
against the pre-P3 baseline (`main`, commit `2f07669` — "Merge P2", the
parent of P3-S1-T1's `e13c349` — checked out into a disposable worktree,
built, and run against a second isolated backend on port 8121/DB
`/tmp/pre-p3-e2e.db`, then torn down):

| Spec / test | P3 branch | Pre-P3 baseline (`2f07669`) | Classification |
|---|---|---|---|
| `06-import-mapping.spec.ts` "generic long CSV opens mapping wizard and imports" | fail (`getByText('Import mapping')` not found) | **fail, identically** | Pre-existing, unrelated to P3 |
| `17-manual-group-and-plate-drag.spec.ts` "dragging from plate whitespace..." | fail (`selected.count()` = 0) | **fail, identically** | Pre-existing, unrelated to P3 |
| `17-manual-group-and-plate-drag.spec.ts` "dragging the NTC corner..." | fail (`wells.length` = 0) | **fail, identically** | Pre-existing, unrelated to P3 |
| `test-windows.spec.ts` "well click shows amplification curve with all 25 points" | fail (`#amplification-plot` hidden) | **fail, identically** | Pre-existing, unrelated to P3 |
| `19-feedback.spec.ts` "reporter files feedback from any screen and reads it back" | fail (`page_key` expected `'analysis'`, got `'results'`) | **pass** | **New P3 regression** (stale assertion — P3-S1-T1/P3-S2-T1 changed the live tab id `FeedbackWidget pageKey` records; see P3-S2-T1's own evidence doc, "Feedback `page_key` — old ↔ new mapping") |
| `22-error-recovery.spec.ts` "preset failure preserves input..." | fail (`locator('#tab-settings')` timeout) | **pass** | **New P3 regression** (stale selector — `#tab-settings` no longer exists, settings moved to overflow) |
| `26-asg-compatibility.spec.ts` "exchanges an ASG launch once..." | fail once (batch run 1), pass (isolated run, batch run 2 rerun) | pass | **Flake, not a regression** — passes in isolation and on immediate rerun of the full 13-spec batch; unrelated to any tab id this task touches (`project` tab, untouched by P3-S1-T1/P3-S2-T1) |

Both `06-import-mapping.spec.ts` and `17-manual-group-and-plate-drag.spec.ts`
and `test-windows.spec.ts` reproduce **byte-for-byte identically** on the
pre-P3 baseline (same locator, same expected/received values), confirming
they predate this whole IA-restructure effort and are out of this task's
(and this Phase's) write scope — reported, not touched.

`19-feedback.spec.ts` and `22-error-recovery.spec.ts` are genuine new
regressions introduced by P3-S1-T1/P3-S2-T1 (both pass cleanly on the
pre-P3 baseline). Both are outside this task's write scope (only the 7
named specs), so **not fixed here** — reported for the orchestrator to
assign as follow-up (likely one-line fixes: `page_key: 'results'` and an
`openOverflowTab`-style Settings click, mirroring what this task already
did in the 7 in-scope specs).

## Cleanup

- Temporary probe spec (`tests/zz-probe.spec.ts`, used only to read live
  tab ids/URL params/overflow contents) deleted before commit — not part of
  the diff.
- Both uvicorn instances (port 8120 `/tmp/p3-e2e.db`, port 8121
  `/tmp/pre-p3-e2e.db`) stopped; both scratch DBs removed.
- Disposable pre-P3 baseline worktree removed; `git worktree list` in the
  main repo shows only the pre-existing Phase worktrees, no leftover entry.
- `test-results/`, `playwright-report/` removed from `worktree/feedback-p3`.
- Port 8002 and the production DB were never started, touched or referenced.

## Commit

`feedback/p3-ia`, local only. No remote push, no Phase merge, no
deployment/notification performed.
