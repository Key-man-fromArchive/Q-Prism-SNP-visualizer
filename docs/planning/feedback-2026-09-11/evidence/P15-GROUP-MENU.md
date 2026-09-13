# P15-GROUP-MENU: collapse the group 1-6 buttons into a menu

## Request

> 결과탭의 그룹 1234-12 이 버튼들 지워도 될거 같아요. 딱히 쓸데가 없네요

Clarified with the user: the buttons are manual group *assignment* (not
display), exercised by three E2E specs. User's choice: **remove the buttons,
keep the feature** — collapse the 6 preset buttons (+ "+ Add group") into a
single trigger + menu, same as a normal "Assign to group ▾" control.

## RED evidence

Before any implementation change, `WellSelectionToolbar.test.tsx` was
rewritten to assert the new (not-yet-built) structure and run against the
untouched component:

```
 ❯ src/components/analysis/WellSelectionToolbar.test.tsx:149:26
    147|   render(<WellSelectionToolbar />);
    148|   await waitFor(() => expect(getWellGroups).toHaveBeenCalled());
    149|   const trigger = screen.getByTestId('manual-group-trigger');
       |                          ^
 Test Files  1 failed (1)
      Tests  10 failed | 1 passed (11)
```

10/11 new/updated tests failed for the expected reason (`manual-group-trigger`,
`manual-group-menu`, `role="menu"` did not exist yet). Only the untouched
"hides when nothing is selected/saved" test passed, since it made no
assumption about the new structure.

## Control shape chosen, and why

**One trigger button (`manual-group-trigger`, "Assign to group ▾") + a
popover `role="menu"`.** Inside the menu: the 6 default presets (`Group 1`…
`Group 6`) plus any other manually-saved group name, a separator, then a
"+ New group" row that expands into the existing inline name input.

Custom menu (not a native `<select>`) because the per-row state the task
requires can't be expressed inside `<option>` elements:
- existing-vs-unused visual distinction (background/border color)
- a `Check` icon + highlighted row for the currently active group
- a live "…" while a `createWellGroup` save is in flight (`savingName`)

A `<select>` would give native accessibility for free but would flatten all
of that back down to plain text, which is exactly the information density
the menu needs to keep. The trade-off was accepted: build the roving-focus/
Escape/outside-click keyboard behavior by hand, following the same pattern
already used by `src/components/shared/ui/Menu.tsx` and
`WellTypePopup.tsx` (`role="menu"`/`role="menuitem"`, the shared
`moveMenuFocus` helper for arrow-key nav, close-on-Escape with focus
restored to the trigger, close-on-outside-click).

**Why the group filter `<select>` and "manage groups" `+` button were left
alone:** they are a *view* operation (which existing group's wells are
shown/filtered) with their own dropdown-of-options shape that already fits
`<select>` perfectly (no per-row extra state needed there — just a name and
a count). The new control is a *write* operation (assign the current
selection to a group). Folding "pick a group to look at" and "assign the
current selection to a group" into one control would conflate reading and
writing through the same widget and likely surprise a user who opens it
expecting a filter and gets an assignment instead. They stay two separate,
adjacently-placed controls, as before.

**Why "+ Add group" also disappears into the menu only in the "any preset
useful" state, and stays a standalone button otherwise:** `showGroupPresets`
(hasSelection || manualNames.length > 0) is unchanged. When it's `false`
(nothing selected, no manual group saved yet), a menu with 6 dead
placeholder rows is not an improvement over 6 dead buttons — the existing
comment at that gate (P4-S3-T1, FB-03 §3-2) already explains why those rows
are suppressed entirely in that state. The standalone "+ Add group" dashed
button (the only entry point in that state) is unchanged from before this
task. Once `showGroupPresets` is true, "+ Add group" moves inside the menu,
below a separator, instead of sitting as a second sibling next to the
trigger.

## Preserved behavior (old → new)

| Behavior | Before | After |
|---|---|---|
| Assign selection to a group | Click one of 6 buttons | Open trigger → click the row |
| Existing vs. unused preset | border/bg color on the button | same border/bg color, now on the menu row |
| Currently active group shown | `Check` icon + amber fill on that button, persists as long as the button is rendered | `Check` icon + amber fill on that row when the menu is (re-)opened; the **trigger's own label** additionally switches from "Assign to group" to the active group's name and stays that way with the menu closed, for the cases where the row itself is not mounted (see next section) |
| Save-in-flight indicator | "…" next to the button label | "…" next to the row label (same `savingName === name` check) |
| Hidden with nothing to act on | `showGroupPresets` gate | same gate, now wraps the trigger+menu instead of the button row |
| Parser-derived "Group 1" not shown as saved | `exists = manualNames.includes(name)`, only `source: "manual"` counts | unchanged; still read from `WellSelectionToolbar.tsx:268`, still driven by the same `getWellGroups` filter on `info.source === "manual"` (`WellSelectionToolbar.tsx:92`) |

## E2E specs updated (guarantee-for-guarantee, not selector renames)

### `tests/17-manual-group-and-plate-drag.spec.ts` (test 1 only — test 2, the
NTC-corner-drag test, is owned by another agent and was not touched)

- Old: `groupOne.click()` directly assigned to Group 1, then asserted
  `aria-pressed="true"` and `toContainText(/Group 1/)` **on that same
  button**, which stayed mounted afterwards.
- New: `manual-group-trigger` is clicked to open the menu first, then
  `manual-group-1` is clicked inside it (same POST `/groups` assertion,
  same payload assertions). Selecting a row closes the menu — the row
  itself unmounts, so `expect(groupTrigger).toContainText(/Group 1|그룹 1/)`
  is checked first (the collapsed control still displays which group is
  active with the menu closed — the part of the old guarantee that a
  closed/collapsed control can still carry). The menu is then re-opened and
  `expect(groupOne).toHaveAttribute('aria-pressed', 'true')` +
  `toContainText` are checked on the row itself, restoring full parity with
  the original guarantee (both symptoms the old assertion checked, now
  checked on the trigger and the row respectively). See "E2E stability
  history" below for why an earlier draft dropped the re-open step and why
  it was restored.

### `tests/18-result-consistency.spec.ts`

- Old: `page.getByTestId('manual-group-1').click()` directly.
- New: `page.getByTestId('manual-group-trigger').click()` then
  `.getByTestId('manual-group-1').click()`. No other assertion in this spec
  depended on the button's post-click DOM state, so nothing else changed.

### `tests/25-secondary-flows.spec.ts`

- Old: assign via direct click, then later — after navigating to the
  Quality tab, doing a temporary-reveal round trip, and returning — assert
  `manual-group-1` still has `aria-pressed="true"`.
- New: assign via trigger-then-row (same as above). The later persistence
  check now reads `expect(manual-group-trigger).toContainText(/Group 1/)`
  instead. This is a *stronger* location for this check, not a weaker one:
  the workspace pane (and this toolbar) stays mounted under the Quality
  tab's `hidden` class rather than unmounting (`AnalysisWorkspace.tsx`'s
  `panelClass` toggles a CSS class, not conditional rendering), and
  Playwright's `toContainText` doesn't require visibility — so this
  assertion is exercising the same "the app remembers which group is
  active across tab navigation" guarantee the original did, just against
  a locator that is still attached to the DOM after the menu auto-closes
  (`manual-group-1`, a `role="menuitem"` row, is not).

## Unit tests (`WellSelectionToolbar.test.tsx`)

RED-first; final 11 tests, all passing:
1. hides the whole control with no selection and no manual group (unchanged
   guarantee, updated testids)
2. shows only the trigger (not 6 rows) once wells are selected
3. shows the trigger for a previously-saved manual group with nothing selected
4. opens the menu on trigger click; all 6 presets are listed as `menuitem`s
5. assigning via the menu calls `createWellGroup` and updates the trigger's
   label to the assigned group
6. existing vs. unused preset get different classes inside the menu
7. the active preset carries `aria-pressed="true"` + Check icon; inactive
   ones carry `aria-pressed="false"`
8. creating a brand-new named group from inside the menu
9. a parser-derived (`source: "parsed"`) "Group 1" is never rendered with
   the "saved" styling
10. keyboard-only: `ArrowDown` from the focused trigger opens the menu with
    focus already on the first row; `Enter` assigns and returns focus to
    the trigger
11. `Escape` closes the menu and returns focus to the trigger

Also updated `AnalysisTab.groupbar.test.tsx` (2 assertions: presence check
now looks for `manual-group-trigger` instead of the retired
`manual-group-presets` container; both were exercising "the control is/isn't
there", not anything about the button count).

## Accessibility

- Trigger: real `<button>` (so `aria-haspopup`/`aria-expanded` add to, not
  replace, the default button semantics), `aria-label`/`title` fixed to
  "Assign to group" regardless of state (the *visible* label is what
  changes to the active group's name, so sighted and screen-reader users
  get different but equally clear signals: one moving label, one stable
  accessible name + a spoken "menu" role change).
- Menu: `role="menu"`, `aria-label` matching the trigger's label. Rows:
  `role="menuitem"`, `aria-pressed` for active/inactive (same attribute the
  old buttons used, so nothing downstream that reads `aria-pressed` lost
  information).
- Keyboard: `ArrowDown`/`ArrowUp` on the trigger opens the menu (mirrors
  `src/components/shared/ui/Menu.tsx`); inside the menu, `ArrowUp`/`ArrowDown`/
  `Home`/`End` move focus via the shared `moveMenuFocus` helper (same helper
  `Menu.tsx` and `WellTypePopup.tsx` use); `Escape` closes and returns focus
  to the trigger; clicking outside closes it. Verified in
  `WellSelectionToolbar.test.tsx` tests 10-11 above.
- Touch target: `min-h-11` (44px) default, shrinking back to the compact
  size only at `lg:` (1024px) and up — so it stays ≥44px through and
  including 768px, not just strictly below it. (First pass used `md:`
  (768px), which is *inclusive* of 768px on the compact side — wrong
  direction for a "≤768px" requirement; caught during the 768px screenshot
  check, where the trigger measured 26px tall instead of 44px, and fixed by
  switching every occurrence to `lg:`.)
- Color: reused the existing amber active/existing palette verbatim (no new
  colors introduced), so the light/dark contrast this control already had
  is unchanged.

## Horizontal space (measured, English locale, 1440×900, wells selected)

| | width (px) |
|---|---|
| Old preset-button row (`manual-group-presets`, 6 buttons, not counting the separate "+ Add group") | 484 |
| New collapsed trigger (`manual-group-trigger`) | 147 |

337px (~70%) less width claimed by this control once wells are selected —
directly answering "그룹 1234-12 이 버튼들... 딱히 쓸데가 없네요" without
removing the ability to assign a group.

## Viewport budget (`tests/24-responsive.spec.ts:51`'s <1000px assertion)

Measured with the menu open (worst case) at both required widths, English
locale:

| width | `#scatter-plot` | `#plate-grid` | `.detail-panel` |
|---|---|---|---|
| 1440 | 662 | 380 | 688 |
| 768 | 686 | 380 | 720 |

All well under the 1000px budget; that spec's own assertions were also run
unmodified as part of the full E2E suite (see below) and pass.

## Screenshots

`docs/planning/feedback-2026-09-11/evidence/P15-GROUP-MENU-{state}-{theme}-{width}.png`,
`state` ∈ {no-selection, selected, menu-open}, `theme` ∈ {light, dark},
`width` ∈ {1440, 768}. `no-selection` shows only "+ Add group" (control
absent, per the preserved `showGroupPresets` gate); `selected` shows the
collapsed trigger next to "Show Empty"/"1 selected"/"Show selected
only"/"Clear" in the same row it used to share with 6 buttons; `menu-open`
shows the 6 presets + "+ Add group" row, in both themes, at both widths (at
768px the rows are visibly taller — the 44px touch target).

## Verification — 4/4 (current)

```
cd snp-analyzer/frontend
npx tsc --noEmit   # 0 errors (test files excluded, per project convention)
npm run lint       # 0 errors, 0 warnings
npm run test       # 125 files / 917 tests passed (post-merge baseline
                   # 125/908 + this task's net new tests)
npm run build      # tsc -b (incl. test files) + vite build — succeeds
```

## E2E — history, correction, and current state

**This section was rewritten after a wrong root-cause diagnosis was caught
and corrected; the incorrect version is not reproduced here, only the
correction and the current, verified state.**

While this task was in progress, another agent (P13) had already merged a
fix for `tests/17-manual-group-and-plate-drag.spec.ts`'s NTC-corner
flakiness into `main`. P13's actual finding: the flake was **in the test
harness, not the app** — `whenSettled()` treated two consecutive `null`
reads (Plotly hadn't drawn the trace yet) as a "settled" value and returned
early, and a no-retry, single-shot language-toggle check right after
`page.goto()` could silently miss switching the page to English, pinning
the rest of that test to Korean and permanently breaking its hardcoded
`'NTC thresholds'` string match. Neither of those is a Plotly-*layout*
timing race.

Before that fix reached this branch (a merge request from the team lead had
not yet been actioned here), an earlier verification pass on this task
mischaracterized the same symptom as a "pre-existing NTC-corner Plotly-layout
race" and spent real effort establishing that this task's diff wasn't the
cause of it (reverting to compare against `main`, re-running the full suite
several times, and — correctly, as it turned out — finding and removing a
menu re-open/re-check step this task's own diff had added right before that
test's fragile measurement, on the theory that the extra interaction was
adding timing pressure onto an already-marginal race). That diagnosis of
*why* the extra step mattered was wrong (there was no Plotly-layout race to
add pressure to), but removing the step was still directionally defensible
under the then-current, still-buggy `whenSettled`. Once `main` was actually
merged (see below) and the real fix was in place, the extra step was
re-evaluated on its own merits and restored, since it now measurably adds
no risk and restores parity with the original per-row `aria-pressed`
guarantee (see "E2E specs updated" above).

**Merging `main`:** merge commit `1d7eb7d` (message: "Merge branch 'main'
into feedback/p15-group-menu"), no conflicts — git's auto-merge combined
P13's `whenSettled`/`ensureEnglish` rewrite in
`tests/17-manual-group-and-plate-drag.spec.ts` with this task's
trigger-then-row selector changes in the same file cleanly, since they
touched different lines. P14's separate confidence-projection fix
(`analysis-projection.ts`/`data-store.ts`) came along in the same merge;
untouched by this task.

**Current E2E state**, backend on port 8197 (`DB_PATH=/tmp/p15.db`,
isolated from prod `/app/data/snp_analyzer.db` and from port
8002/8180/8195/8196), with the menu re-open/re-check step restored in
`tests/17-*.spec.ts`:

- `tests/17-manual-group-and-plate-drag.spec.ts` alone, 3 consecutive runs:
  **2/2 passed** every time (both tests in the file).
- Full suite, `--workers=2`, 3 consecutive runs: **138/138**, **137/138**
  (unrelated flake in `tests/24-responsive.spec.ts:4`, a multi-marker
  column-assignment test that shares no code with this task), **137/138**
  (unrelated flake in `tests/25-secondary-flows.spec.ts:321`, an
  unassigned-inventory-warning test, also unrelated). Both of those flaked
  tests were re-run standalone immediately after and passed; neither
  touches `WellSelectionToolbar`, group assignment, or anything this task
  changed. `tests/17-*.spec.ts` itself did not fail in any of the 3 runs.
- Target restated by the team lead: **137/137** — met (138/138, since P14's
  merge added one more passing test file/case beyond the 137 baseline
  count quoted).

## Not done / explicitly out of scope

- `worktree/feedback-p13`, `worktree/feedback-p14`: untouched.
- `tests/17-manual-group-and-plate-drag.spec.ts` test 2 (NTC corner drag):
  logic untouched.
- `tests/24-responsive.spec.ts:51`: assertions untouched.
- No backend changes.
- No merge to `main`, no remote push.
