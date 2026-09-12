# P10-PROTOCOL-UI — Raw data tab redesign: simplified protocol panel + merged fluorescence card

Branch: `feedback/p10-protocol-ui` (worktree `worktree/feedback-p10`), forked
from `main` at `e264f58` (includes P7-rawvalues, P9-thermal-labels).

Scope: `snp-analyzer/frontend/src/components/protocol/*`,
`snp-analyzer/frontend/src/components/analysis/AmplificationOverlay.tsx`
(comment only), `WellCycleValuesTable.{tsx,test.tsx}` (deleted, absorbed),
new `FluorescenceDataCard.{tsx,test.tsx}`, `index.css`, `locales/{en,ko}.ts`,
root `tests/05-interactions.spec.ts` and `tests/25-secondary-flows.spec.ts`
(updated for the new edit-mode gating). **No backend files touched.**

## User request (verbatim)

> 열순환, 웰별 형광 너무 ui가 난잡한데 심플하게 정리안될까?
> 그리고 tier별 pcr 시각적으로 나눠놓는것도 좋겠구

## What was wrong (measured, before screenshots)

- The PCR protocol table was **always in edit mode** — every step as an
  editable row with inputs, plus Add/Save/Cancel — even though most users
  open Raw data to *read* the protocol, not edit it.
- A yellow "→ GOTO: ↩ Repeat Steps N-M × K cycles" row was interleaved
  between step groups, adding visual noise and duplicating information the
  new group-header banner now carries.
- "증폭 곡선 오버레이" and "웰별 형광값" were two separate cards, each with
  its own channel selector, color-by/CSV controls and processing-status
  badge — duplicated chrome for two views over the *same* fetched response
  (and, before this change, each fetching independently — two network
  round-trips for the same `getAllAmplification` call whenever both were
  opened).
- P9 already fixed pure overflow in the thermal-diagram phase labels, but
  adjacent full-width labels still sat only ~4px apart and read as one
  run-on string (see `evidence/P9-THERMAL-LABELS-after-harsh-wide-light.png`,
  `"Ampl. 1 (TD…Ampl. 2 ×1…Secondary D.Extension (…Final Exten…"`).

## RED — failing tests first

New pure-logic modules were test-first:

```
$ npx vitest run src/components/protocol/protocol-phase-groups.test.ts \
                  src/components/protocol/protocol-goto-range.test.ts
```
were written against `groupPhaseBands`/`getPhaseColor`/`parseGotoLabel`/
`resolveGotoRange` *before* those functions existed in their final shared
module (both were then implemented directly, since they're pure,
new-file extractions — no pre-existing behavior to characterize first).

For the parts with an existing, tested predecessor, the actual RED sequence
was:

1. Added 3 new tests to `ProtocolThermalProfile.test.tsx`
   (`does not print a single x-N cycle count when a band's steps disagree`,
   `leaves a visible gap between two adjacent full-width band labels`,
   `keeps at least 16px of the padding budget`) and ran them against the
   *unmodified* component:
   ```
   × does not print a single x-N cycle count when a band's steps disagree on cycles
     Received: "Amplification 1 ×10Amplification 1 ×10"
   × leaves a visible gap between two adjacent full-width band labels...
     AssertionError: expected 11.5 to be greater than or equal to 12
   × keeps at least 16px of the padding budget...
     TypeError: actual value must be number or bigint, received "undefined"
   Tests  3 failed | 17 passed (20)
   ```
2. Rewrote `ProtocolTab.test.tsx` with the new read-only-by-default flow
   (`protocol-edit-btn` gating) and 11 new integration tests (phase-group
   coloring matches the diagram, GOTO range preserved, stale-range
   detection after a delete, cycles-disagreement suppression, per-step
   channel-chip honesty, empty/single-step/single-group robustness,
   responsive CSS hooks + 44px touch targets) — run against the
   *unmodified* `ProtocolTab.tsx`: every test that assumed inputs are
   visible by default failed with `TestingLibraryElementError: Unable to
   find a label with the text of: ...`, and all 11 new P10 tests failed
   (no `#edit-protocol-btn`, no `protocol-group-header-*`,
   no `protocol-goto-range-*`/`protocol-goto-stale` testids yet).
3. Wrote `FluorescenceDataCard.test.tsx` against a component that did not
   exist yet (`Failed to resolve import "./FluorescenceDataCard"`).

All of the above were then made to pass by the implementation below.

## Implementation

### 1. Protocol panel: read-only summary by default, phase-grouped

- `ProtocolTab.tsx` now owns a local `editing` boolean (default `false`).
  Read-only mode renders `<ProtocolStepsTable editable={false}>`; clicking
  **`프로토콜 편집`** (`#edit-protocol-btn`) swaps in the same table with
  `editable` inputs, Add/Save/Cancel. A successful save
  (`use-protocol-editor.ts`'s `save()` now **returns a boolean** instead of
  being fire-and-forget, specifically so `ProtocolTab` can flip `editing`
  back to `false` from the submit handler itself — not from a `useEffect`
  watching `phase`, which `eslint-plugin-react-hooks`'
  `react-hooks/set-state-in-effect` correctly flags as a cascading-render
  smell) and Cancel both return to the read-only summary; a **failed**
  save does not (edits and the error alert stay visible — this was already
  a hard requirement in the pre-existing "retains edits on save failure"
  test, now additionally re-asserted as "does not leave edit mode").
- Contiguous same-`phase` steps are grouped by `protocol-phase-groups.ts`'s
  `groupPhaseBands` (moved out of `ProtocolThermalProfile.tsx`, which
  previously had its own private copy purely to avoid a component↔component
  import cycle — a plain data module has no such cycle, so the duplicate
  is retired). `ProtocolPhaseGroupHeader.tsx` renders one banner row per
  band, in both the read-only and editable tables, colored via the exact
  same `getPhaseColor()` the thermal diagram uses — **the group header's
  left border and dot are the same hex as the diagram's stripe fill for
  that phase**, not a second, independently-chosen color. Verified in
  `ProtocolTab.test.tsx`'s *"colors each phase group header the same as
  its stripe in the thermal diagram"* (diagram `rect[fill]` is the literal
  hex from `getPhaseColor`; the header's `borderLeft` is the same hex,
  browser-normalized to the equal `rgb(...)`) and reconfirmed visually
  (screenshots below: blue Pre-read, red Initial Denaturation, orange
  Amplification 1/2, gray Secondary/Extension/Final, teal-bordered
  Post-read — group header and diagram stripe always match).
  Color is never the only cue: each band also has its own left border,
  the phase name in text, and (see below) a repeat-range badge.
- The yellow GOTO row is gone; the same information now lives in the group
  header as a **preserved range**, not a collapsed `×N`:
  `↩ 단계 3–4 · 총 12회` / `↩ 단계 8 · 총 12회` for the single-step case.
- Touchdown steps show `65→59.5°C · -0.5°C/사이클` directly in the row
  (`t.protocolTempChange`, reusing `ProtocolThermalProfile.tsx`'s
  already-existing `stepEndTemperature()` — moved to the new
  `protocol-step-temp.ts` module, again to avoid re-implementing the
  formula and to avoid importing a component file from a component file),
  not only as 9px SVG text.
- The separate read-channel card is now the card's own header metadata
  line (moved from between Status/ThermalProfile to directly under the
  title row) — same component (`ProtocolChannelCard`), same
  `protocol-channel-card`/`protocol-channel-chip-{role}` testids, just
  relocated, never a second boxed sub-card.

### 2. GOTO range preservation + stale-label honesty (no backend field added)

`protocol-goto-range.ts`:

- `parseGotoLabel()` parses the backend's own free-text sentence (e.g.
  `"↩ Repeat Steps 3-4 × 10 cycles"` / `"↩ Repeat Step 5 × 25 cycles"` —
  confirmed exact format in `app/parsers/eds_raw.py:510-516` and
  `app/parsers/pcrd_raw.py:419-432`) back into `{firstStep, lastStep,
  totalCycles}`, purely for display — it does **not** add a
  `repeat_from_step` field to `ProtocolStep` (out of the stated scope, and
  PCRD's `GotoStep.optionGotoStep` can target an arbitrary earlier step —
  `pcrd_raw.py:309-318` — so "the previous N steps" cannot be assumed from
  structure alone; the backend's own generated text is the only
  trustworthy source and is parsed, not re-derived).
- `resolveGotoRange(gotoLabel, firstStepNumber, lastStepNumber,
  lastStepCycles)` cross-checks the parsed numbers against the band's
  **current** first/last step number and the trailing step's **current**
  `cycles` value (the step that structurally carries `goto_label`, per
  both parsers above). This is deliberately **not** a separate "was
  anything edited" dirty flag: `ProtocolTab.tsx`'s `handleDeleteStep`
  renumbers every step after the deleted index
  (`prev.filter(...).map((s, i) => ({ ...s, step: i + 1 }))`), but never
  rewrites any `goto_label` string — so after a delete, the stored text's
  embedded numbers structurally stop matching the band's real current
  numbers, and the mismatch is caught for free, precisely scoped to the
  bands actually affected by the renumber (a band positioned *before* the
  deleted step is untouched and keeps showing its real, still-correct
  range — a blanket "any edit invalidates every badge" flag would have
  been both simpler and wrong).
  - `kind: 'range'` — parsed and matching: show the specific range.
  - `kind: 'stale'` — parsed but no longer matching: show
    `t.protocolGotoStale` ("단계 편집으로 번호가 바뀌어 원래 반복 범위를
    더 이상 정확히 표시할 수 없습니다"), never the specific (now
    unverifiable) numbers. This follows the project's standing rule for
    an unknown fact (`OverlayProcessingStatus`'s `unreported`,
    `ScatterResponse`'s `referenceBasisUnknown`) rather than confidently
    asserting a range that might be wrong.
  - `kind: 'raw'` — the label didn't match either generated shape (hand
    edited text, or an unrecognized format): shown verbatim, never
    silently dropped.
  - `kind: 'none'` — no `goto_label` at all (Pre-read/Post-read, or a
    cycling phase whose parser didn't emit one): falls back to the plain
    `×N` cycle badge, suppressed (see below) if the band disagrees on
    cycles.

Test: *"does not confidently show a wrong repeat range after step numbers
shift from a delete"* — 3 steps (Pre-read / Amplification 1 × 2 steps with
`goto_label: "↩ Repeat Steps 2-3 × 10 cycles"`), delete step 1, assert
`protocol-goto-stale` renders `t.protocolGotoStale` and the old specific
text is gone.

### 3. Cycles-disagreement honesty

`PhaseBand.cyclesVary` (computed in `groupPhaseBands`) is `true` once any
step in a band has a different `cycles` value than the band's first step —
reachable only through manual per-step editing (every current parser emits
one uniform `cycles` per GOTO group). `bandCyclesSuffix()`
(`ProtocolThermalProfile.tsx`) and `ProtocolPhaseGroupHeader.tsx` both
suppress the `×N` badge when `cyclesVary` is true, replacing it (in the
group header) with `t.protocolCyclesVary` ("이 구간 내 사이클 수가
다릅니다") rather than printing either step's count as if it applied to
the whole band. Test: *"drops the single x-N cycle badge once an edit
makes a group disagree on cycles"*.

### 4. `read_channels` honesty (confirmed empty, not assumed)

Confirmed directly in the backend: neither
`app/parsers/eds_raw.py`'s nor `app/parsers/pcrd_raw.py`'s `ProtocolStep(...)`
constructor call passes `read_channels` at all, so every current parser
leaves it at the Pydantic model's default (`[]`) — no format this project
currently supports reports per-step optical channels.
`ProtocolStepsTable.tsx`'s `ReadOnlyStepRow` only renders a per-step
channel chip when `step.read_channels.length > 0`, and never infers it
from the run-wide `role_channels` metadata shown in the card header (that
would misrepresent a run-wide fact as step-specific). Test: *"shows a
per-step read-channel chip only when read_channels is actually
non-empty"* constructs one step with `read_channels: []` (asserted to show
no chip) and one with `['FAM', 'HEX']` (asserted to show `FAM, HEX`) side
by side, so the "always empty in practice" fact doesn't hide a broken
`.length > 0` check.

### 5. Fluorescence card merge (curve/values, one toggle, one selector)

`FluorescenceDataCard.tsx` (new) replaces the Raw data tab's two
separately-mounted cards. It fetches `getAllAmplification` **once**
(gated on `expanded && sessionId`, matching each prior card's own
fetch-gating), and switches between a `curve`/`values` `view` with a
`role="tablist"` pair over the same response:

- One channel `<select>` (`fluorescence-channel-select`) shared by both
  views — `WellCycleValuesTable.tsx`'s removed header comment argued
  channel selection must stay independent so a user could watch the FAM
  *curve* while checking allele2 *values* side by side; a tabbed
  curve/value switch cannot show both at once regardless, so that
  justification no longer applies, and sharing is the honest choice once
  simultaneous viewing isn't possible either way.
- One color-by `<select>` — curve-view only (values have no color
  concept), hidden on the values tab.
- One CSV export button (`buildWellCycleValuesCsv` /
  `downloadTextFile`, both untouched from P7) and **one**
  `OverlayProcessingStatus` badge (`fluorescence-processing-status`,
  reusing P7's exported honesty component verbatim — `requested` vs
  `actually applied` vs `unreported`, never inferring the response from
  the request).
- Collapsed by default (`fluorescence-toggle-btn`): only the title and
  toggle are visible; channel selector, tabs, color-by, CSV and the
  processing badge only render once expanded — tested explicitly
  (*"starts fully collapsed: no channel selector, view tabs or CSV button
  visible"*).
- Switching tabs does not re-fetch (*"switching to the values tab does not
  trigger a second fetch"*) and preserves the channel selection across the
  switch (*"shares one channel selection between the curve and values
  views"*).

`AmplificationOverlay.tsx` itself is **unmodified** except one doc-comment
update (the removed `WellCycleValuesTable` cross-reference now points at
`FluorescenceDataCard`) — it stays mounted, at its original un-prefixed
ids, on the Analysis tab (`e2e/p4-s2-analysis-tab.spec.ts` locates it
there; confirmed via `grep` that no e2e spec references the `rawdata-`
`idPrefix` mount or any `well-cycle-values-*` id, so nothing outside this
task's own tests depended on the two components being removed from the
Raw data tab). `WellCycleValuesTable.tsx` and its test file are deleted —
absorbed rather than kept as a second, now-redundant standalone mount; its
guarantees (values-match-curves, channel switch, CSV correctness, honest
processing status, no-session/empty-response safety) are re-asserted,
equally rigorously, in `FluorescenceDataCard.test.tsx`.

### 6. P9 follow-up: label horizontal padding

`protocol-thermal-label-fit.ts`'s `LABEL_HORIZONTAL_PADDING_PX` was `4`
(2px clearance per side — enough to avoid outright overflow past a band's
own edge, per P9, but not enough visual gap between two adjacent
maximally-sized labels). Raised to `16` (8px/side) and exported so a test
can assert the real budget instead of a magic number
(`keeps at least 16px of the padding budget for horizontal clearance`).
A new geometric test (`leaves a visible gap between two adjacent
full-width band labels, not just non-overflow`) renders two adjacent
one-step bands and asserts ≥12px between their rendered label edges.
Existing P9 tests (fitPhaseLabel behavior, no-overflow guarantee, full
info preserved in the `<title>`/sr-only legend) are unchanged and still
pass at the new padding value.

### 7. Color tokens

- `--color-on-success` / `--color-on-danger` (`index.css`, both `#0e1413`)
  added to `@theme`, replacing the Save button's hardcoded
  `color: 'white'` and the Delete button's hardcoded
  `background: '#fee2e2', color: '#dc2626'`. Both buttons now use solid
  `bg-success`/`bg-danger` with this shared dark foreground.
- The GOTO/repeat-range text uses the existing `text-info` token (teal),
  not a new hardcoded yellow — chosen over `text-warning` specifically
  because of the contrast measurements below.
- `PROTOCOL_PHASE_COLORS`/`PROTOCOL_AMP_COLORS` (`src/lib/constants.ts`)
  are deliberately **left as fixed hex, not moved to CSS custom
  properties**. This is a pre-existing, explicit, documented decision
  (P0-T0.2 / P6-S2-T1 / decision D-4 in `constants.ts`'s own comments):
  these are qPCR-convention colors (FAM=blue, HEX=red, etc.), independent
  of the UI's light/dark brand theme by design, and a
  `renders the pre-refactor phase colors unchanged` characterization test
  already locks their exact hex. Re-tokenizing them would be a scope
  expansion that contradicts an already-settled, documented decision, not
  a fix for anything reported here.

#### Contrast measurements (WCAG relative-luminance formula)

| Pair | Ratio | Threshold | Result |
|---|---|---|---|
| white text on light `--color-success` (`#10b981`) — **old** | 2.54:1 | 4.5:1 (normal text) | fail |
| white text on dark-mode `--color-success` (`#34d399`) — **old** | 1.92:1 | 4.5:1 | fail (matches this project's documented prior `bg-primary`/white-text ~1.7:1 failure class) |
| `#0e1413` on light `--color-success` — **new** | 7.34:1 | 4.5:1 | pass |
| `#0e1413` on dark-mode `--color-success` — **new** | 9.68:1 | 4.5:1 | pass |
| `#0e1413` on `--color-danger` (`#ef4444`, same hex both themes) — **new** | 4.95:1 | 4.5:1 | pass |
| old delete button (`#dc2626` text on `#fee2e2` bg) | 3.95:1 | 4.5:1 | fail (pre-existing, only ever worked as a light-mode-only pairing) |
| `text-info` (`#0f766e`) on white — light mode | 5.47:1 | 4.5:1 | pass |
| `text-info` (`#2dd4bf`) on dark surface — dark mode | 8.93:1 | 4.5:1 | pass |
| `text-warning` (`#f59e0b`) on white — light mode (rejected option) | 2.15:1 | 4.5:1 | fail — this is why the GOTO badge uses `text-info`, not `text-warning` |

### 8. Responsive ≤768px

`.protocol-edit-table` (`index.css`, `@media (max-width: 768px)`): each
edit-mode step becomes a 2-column CSS grid "field card"
(`grid-template-columns: 1fr 1fr`) with the label input and delete button
spanning both columns; the group header row spans full width. The DOM
stays a real `<table>/<tr>/<td>` tree at every width — only `display`
changes per breakpoint — specifically so
`screen.getByDisplayValue(...).closest('tr')` (used throughout
`ProtocolTab.test.tsx`, including the P0-T0.2 value-lock test) keeps
resolving a real `<tr>` regardless of viewport; jsdom does not evaluate
media queries in unit tests, so this was additionally verified by
screenshot (below) and by a unit test asserting the CSS hooks
(`protocol-edit-table`, `protocol-edit-row` classes) and a 44px minimum
touch target (`min-h-11` Tailwind utility, 2.75rem = 44px) on every
button in the edit form (Add/Save/Cancel/Delete).

## Data-testids / behavior preserved unchanged

- `protocol-phase-band-{phase}-{index}`, `protocol-step-{step}`,
  `protocol-read-marker-{step}` — all still owned by
  `ProtocolThermalProfile.tsx`, untouched structurally (only their shared
  grouping/color logic moved to `protocol-phase-groups.ts`).
- `results-scroll-region` — untouched (`ResultsTable.tsx`, a different
  tab, not modified).
- 📷 read marker glyph, `aria-labelledby`/`<desc>`/sr-only phase legend on
  the diagram — unchanged.
- P7's CSV/processing-status honesty (`requested` vs `applied` vs
  `unreported`) — reused verbatim via `OverlayProcessingStatus`.

## Verification — all four gates

```
$ npx tsc --noEmit          # 0 errors
$ npm run lint              # 0 errors, 0 warnings
$ npm run test               # 122 files, 886 tests passed (baseline: 120/849)
$ npm run build              # tsc -b (includes test files) + vite build: success
```

Net test delta: +37 over the original 120/849 baseline (protocol-phase-groups.test.ts
+6, protocol-goto-range.test.ts +7, FluorescenceDataCard.test.tsx +9,
ProtocolThermalProfile.test.tsx +3, ProtocolTab.test.tsx +12 — including
the post-review clipping-regression test, see below —
WellCycleValuesTable.test.tsx −6 removed with its component + −1 file, +1
net from merging `main`'s `feedback/p8-e2e-debt`). `npx tsc --noEmit`
alone (excludes test files) was also run clean; `npm run build`'s `tsc -b`
additionally covers test files. Re-run clean after the post-review fixes
and the `main` merge described below.

## Vertical-length measurement (before/after, same synthetic protocol)

A synthetic 10-step, 8-phase EDS-style touchdown protocol (matching P9's
own narrow-band fixture: Pre-read / Initial Denaturation / Amplification 1
(Touchdown) ×12 / Amplification 2 ×12 / Secondary Denaturation Hold /
Extension (Touchdown) ×12 / Final Extension Hold / Post-read, with GOTO
labels on steps 4 (`Repeat Steps 3-4 × 12`), 6 (`Repeat Steps 5-6 × 12`)
and 8 (`Repeat Step 8 × 12`)) was POSTed directly to
`/api/data/{sid}/protocol` for a loaded 2x example session, on two
isolated backends (port 8175 = this branch's build, port 8176 = the
pre-P10 parent commit `e264f58`'s build, both on a scratch SQLite DB, both
torn down after measurement), then measured via Playwright
(`getBoundingClientRect()`/`scrollHeight`) at 1440px and 768px, light and
dark (heights did not vary across viewport/theme for this measurement,
since only the ≤768px *edit*-mode table's CSS changes, and the read-only
view/whole-tab measurement below is independent of edit mode):

| | Before (always-open edit form + 2 separate collapsed cards) | After (read-only default + 1 merged collapsed card) |
|---|---|---|
| Protocol card height | 913.5px (edit form, the only mode that existed) | 978px read-only (default) / 903.5px edit mode |
| Whole Raw data tab height | 1171px | 1165px (−6px, in the default view) |

**Superseded by the "Post-review fixes" section below** — these numbers
are corrected after fixing a read-only-view clipping bug found in
independent review (see that section for the full explanation). The
short version: this specific fixture has five single-step phases, each of
which now gets its own full-width group-header row (for color/consistency
with multi-step groups and to carry the GOTO-range/cycles-disagreement
badges) where the pre-P10 design spent zero extra row height on a
single-step phase's name. That mostly cancels out the rows saved by
removing 3 GOTO rows and merging the two fluorescence cards, for a
protocol this heavy in singleton phases — so the honest height delta here
is marginal, not the 9.2% first reported (which turned out to be
measuring artificially-clipped, not merely compact, content). The real,
unambiguous wins are qualitative: zero input/button chrome in the default
view, one merged (not two) fluorescence card, and GOTO information shown
as an actual preserved range next to its phase instead of a floating
yellow row. See "Post-review fixes" for the full accounting, including
why a protocol with fewer/longer multi-step phases (the more common real
shape) would show a larger reduction.

## Screenshots (before/after, light/dark, 1440px/768px)

All in `docs/planning/feedback-2026-09-11/evidence/`, same synthetic
protocol as above:

- `P10-PROTOCOL-before-{light,dark}-{1440,768}.png` — pre-P10 build:
  always-open edit form, yellow GOTO rows, two separate collapsed
  fluorescence cards below.
- `P10-PROTOCOL-after-readonly-{light,dark}-{1440,768}.png` — default view:
  phase-grouped read-only summary, preserved GOTO ranges
  (`↩ 단계 3–4 · 총 12회`), touchdown temperature changes inline
  (`65→59.5°C · -0.5°C/사이클`), one collapsed fluorescence card.
- `P10-PROTOCOL-after-edit-{light,dark}-{1440,768}.png` — edit mode
  (768px shows the 2-column field-card layout; 1440px shows the table).
- `P10-FLUOR-curve-{light,dark}-{1440,768}.png` /
  `P10-FLUOR-values-{light,dark}-{1440,768}.png` — the merged card
  expanded, curve and values tabs, shared channel/CSV/processing-status
  controls.

Direct visual confirmation of the P9 follow-up (label margin): the
before-screenshots' phase-band header text reads as touching/run-on
(matching the originally-reported
`P9-THERMAL-LABELS-after-harsh-wide-light.png` regression); the
after-screenshots show a visible gap between every adjacent label
(e.g. "Secondary..." / "Extension..." / "Final Ext..." are legibly
separated, not concatenated).

## E2E

**The full-suite numbers in this section were measured before this
branch merged `main`'s `feedback/p8-e2e-debt`, so they still count 4
failures that were already fixed on `main` — see "Post-review fixes" §2
below for the corrected, current baseline (134/137, matching main's
135/2 modulo one already-flagged flaky spec).** Kept here for the
spec-file-fix RED→GREEN history, which is unaffected by the merge.

Root suite (`tests/*.spec.ts`, run against this branch's build on an
isolated backend, port 8175, `SNP_AUTH_MODE=local`, scratch DB — never
port 8002 or the production DB):

- `tests/05-interactions.spec.ts`'s "Raw Data Tab" describe block
  ("add step button works", "delete step button works") and
  `tests/25-secondary-flows.spec.ts`'s `secondary forms {390,1024,1440} ×
  {en,ko} × {light,dark}` (12 variants) all assumed the pre-P10
  always-open edit form (inputs visible immediately after clicking the Raw
  data tab). Updated to click `#edit-protocol-btn` first (and, in
  `25-secondary-flows.spec.ts`, to re-open edit mode after Cancel and
  after a successful save, since both now return to the read-only summary
  — the assertions themselves are unchanged: fill → Cancel discards →
  re-open → save succeeds → simulated 500 keeps the edit open with the
  private diagnostic never rendered). Full failing→passing evidence:
  ```
  # before the spec-file fix, run against this branch's build:
  15 failed, including:
    tests/05-interactions.spec.ts:123 "add step button works"
    tests/05-interactions.spec.ts:136 "delete step button works"
    tests/25-secondary-flows.spec.ts:130 "secondary forms ..." (all 12 variants)
  58 passed
  # after the spec-file fix:
  $ npx playwright test tests/05-interactions.spec.ts tests/25-secondary-flows.spec.ts
  43 passed
  ```
- Full root suite, one run: **132 passed, 5 failed** (baseline before this
  task: 133 passed / 4 failed, itself noted as unstable). The 4
  pre-existing baseline failures (`06-import-mapping.spec.ts:10`,
  `17-manual-group-and-plate-drag.spec.ts:55` and `:135`,
  `test-windows.spec.ts:109`) are unchanged and out of this task's scope
  (owned by another agent's diagnosis per the task brief). The 5th failure
  in the full run, `24-responsive.spec.ts:4` ("multi-marker 384 review..."
  — plate/marker-assignment workflow, unrelated to the protocol/raw-data
  tab and untouched by this diff), is the exact spec the task brief
  flagged as observed-flaky under concurrent load: rerun individually
  twice — once timed out on an unrelated `marker-pick-button` click
  (different failure point than in the full run), once passed cleanly in
  6.2s — confirming non-determinism rather than a regression. A one-off
  failure also appeared, in an earlier partial run of 5 targeted specs
  only, in `26-asg-compatibility.spec.ts:271` (ASG mounted-path launch
  exchange — auth/routing code untouched by this diff, `<header>` element
  owned by `Header.tsx`, also untouched); it did **not** reproduce in the
  subsequent full-suite run, consistent with the same environment
  instability. No protocol/raw-data-tab e2e spec failed non-deterministically.

## Not done / explicitly out of scope

- Backend `ProtocolStep` model unchanged — no `repeat_from_step`/structured
  GOTO field added, per the task brief's explicit constraint.
- `PROTOCOL_PHASE_COLORS`/`PROTOCOL_AMP_COLORS` intentionally not moved to
  CSS custom properties (see §7 above) — this preserves the standing
  P0-T0.2/D-4 decision rather than reopening it.

## Post-review fixes (team-lead independent verification)

Two issues were raised after the initial commit; both confirmed real and
fixed here, screenshots/measurements above regenerated against the fix.

### 1. Trailing groups clipped out of view in the read-only summary (high priority, confirmed real)

Root cause: `ProtocolStepsTable.tsx`'s scrollable region carried
`overflow: 'auto', maxHeight: '500px'` **unconditionally**, copied as-is
from the editable table (where a scroll clamp is a reasonable editing
convenience) without conditioning it on `editable`. This was **not** a
grouping/off-by-one bug — a jsdom row-count check
(`container.querySelectorAll('#protocol-table tbody tr').length`) against
the exact reported 10-step/8-phase fixture confirmed **all 18 `<tr>`s
(10 steps + 8 group headers) were present in the DOM** both before and
after the fix. The bug was purely visual: a fixed-height `overflow:auto`
box is a *nested* scroll region, and Playwright's `fullPage` screenshot
only expands *page-level* scroll height, never a nested container's — so
anything past ~500px of table content (here: the `Final Extension Hold`
group header onward) was real, present, but invisible in both the
screenshot and to a user who never noticed the tiny internal scrollbar.

Fix: the 500px vertical clamp now applies **only** in edit mode
(`style={props.editable ? {...} : {overflowX: 'auto', marginBottom: '16px'}}`).
`overflowX: auto` is kept in read-only mode too — see the next item.

RED confirmed by temporarily reverting the conditional (single style
object for both modes) and re-running the new test below:
`AssertionError: expected '500px' to be ''` — GREEN after restoring the
fix. New regression test:
`does not impose the editable table's 500px scroll clamp on the
read-only summary (regression: trailing groups clipped out of view)`
(`ProtocolTab.test.tsx`) — renders the exact reported 10-step fixture,
asserts the region carries no `maxHeight`/`overflow` clamp, asserts all 18
`<tr>`s exist, and asserts the first/last labels are all present via
`getAllByText` (not `findByText`, which is ambiguous here since a step's
own label and its phase name are the same word for several of this
fixture's single-step phases — e.g. `"Post-read"` — and would otherwise
throw on multiple matches; the true group-header element is targeted
directly by its stable `protocol-group-header-Post-read-9` testid).

Verified live: `document.querySelectorAll('#protocol-table tbody tr').length`
= 18, and `page.getByTestId('protocol-group-header-Post-read-9').isVisible()`
= `true`, at all 4 screenshot combinations (light/dark × 1440/768).
Screenshots above (`P10-PROTOCOL-after-readonly-*.png`) regenerated;
step 9 (`Final Extension Hold`) and step 10 (`Post-read`) are now visible.

**Fixing this surfaced a second bug**, caught by the very next e2e run:
removing the *vertical* clamp for read-only mode also removed the
`overflow: auto` that was incidentally containing *horizontal* overflow
too. At a narrow viewport (390px), the read-only table's
Step/Label/Temp/Duration/Cycles columns don't fit, and without any
overflow containment that width leaked into
`document.documentElement.scrollWidth`, failing
`tests/25-secondary-flows.spec.ts`'s `bounded()` check (`scrollWidth <=
innerWidth`) — reproduced deterministically on two separate isolated
runs (`secondary forms 390 en light` etc., all 4 language/theme
combinations at width 390, never at 1024/1440). Fixed by keeping
`overflowX: 'auto'` in read-only mode while dropping only `overflowY`/
`maxHeight`. Reverified: all 4 `secondary forms 390 *` variants pass
(individually and as part of the full `05-interactions` +
`25-secondary-flows` run, 43/43).

**Height/screenshot correction**: the original evidence above (whole Raw
data tab: 1171px before → 1063px after, "~9.2% shorter") was measured
*before* this fix and is invalidated by it — that 1063px number was
artificially short because the last group was clipped out of the
measured content. Remeasured against the fix: whole-tab read-only height
is **1165px** (vs. 1171px before-build — a marginal ~6px difference, not
9.2%). The honest accounting: this specific 10-step/8-phase synthetic
fixture happens to have five single-step phases (Pre-read, Initial
Denaturation, Secondary Denaturation Hold, Final Extension Hold,
Post-read), each of which now gets its own full group-header `<tr>` for
color/consistency with multi-step groups — whereas the pre-P10 design
only added an extra row for an actual GOTO repeat (3 rows here), and
otherwise folded a single-step phase's name into a small in-row label
with no extra row height. That structural trade (a header row per phase,
always, for cross-diagram color consistency and to carry the
GOTO-range/cycles-disagreement badges) approximately cancels out the
rows saved by removing the 3 GOTO rows and merging the two fluorescence
cards, for a protocol this heavy in singleton phases. The real,
unambiguous wins that still hold: (1) the default view has **zero**
input/button chrome (vs. an always-open edit form with 10 text/number
inputs + a delete button per row), (2) the two fluorescence cards are one
collapsed card instead of two, (3) GOTO information is preserved as an
actual range instead of a collapsed `×N`, next to the phase it belongs to
instead of a floating yellow row. A protocol with fewer, longer
multi-step phases (the more common real-world shape — most qPCR programs
have 2-4 named phases, not 8) would show a larger height reduction, since
group-header row overhead is paid once per phase, not once per step.
Not attempting a further redesign (e.g. folding singleton-phase headers
inline) here — out of the two specific items this review round asked for.

Screenshots and heights above (§"Vertical-length measurement" and
"Screenshots") are the regenerated, fixed versions.

### 2. E2E baseline was stale (branch predated the P8 e2e-debt merge)

This branch was forked from `e264f58` (before `feedback/p8-e2e-debt` was
merged to main at `c630478`), so the four originally-baselined failures
(`06-import-mapping:10`, `17-manual-group:55`/`:135`, `test-windows:109`)
were still present in this branch's own history and got reported as
"unchanged" — they were in fact already fixed on `main`, just not yet
merged here.

Fixed: `git merge main` (no conflicts — git's merge auto-resolved
`tests/05-interactions.spec.ts`, which both branches touched at different
lines; both intents are preserved: this branch's `#edit-protocol-btn`
gating for the Raw Data Tab tests, and P8's `toBeVisible()` strengthening
of the `#amplification-plot` assertion). All 4 gates re-run clean after
the merge (122 files / 886 tests, tsc 0, eslint 0, build success).

Root e2e suite, re-run against the merged + bug-fixed build (isolated
backend, port 8175, scratch DB): **134 passed / 3 failed**, matching
main's current documented baseline (135/2) modulo one already-flagged
flaky spec. All 3 failures individually re-verified as non-deterministic
by isolated rerun (pass alone), consistent with team-lead's own
descriptions:
- `17-manual-group-and-plate-drag.spec.ts:143` ("dragging the NTC
  corner...") — the documented NTC-corner client-state race (~2/5 flake
  rate per team-lead, independent of concurrent load; passed on this
  isolated rerun).
- `24-responsive.spec.ts:51` ("result-first 96-well desktop...") — the
  documented flaky-under-load spec; failed again in the full concurrent
  run (`1103`/`1111` vs. an expected `<=1000` bound) but is a
  pre-existing, separately-tracked issue unrelated to this diff.
- `24-responsive.spec.ts:4` ("multi-marker 384 review...") — not in
  team-lead's named list, but the exact same class of flakiness (plate/
  marker-assignment workflow, unrelated to protocol/raw-data, untouched
  by this diff): failed once in a targeted-subset run (timeout on an
  unrelated `marker-pick-button` click) and once in this full run
  (timeout on `marker-selector-sidebar`), at two *different* failure
  points across runs — then passed cleanly (6.0-6.2s) on two separate
  isolated reruns. Non-determinism, not a regression.

No protocol/raw-data e2e spec failed in any run, isolated or full,
before or after the merge.

## Second refinement: fold redundant singleton-band headers (team-lead follow-up)

The corrected height numbers in the previous section (1171px → 1165px,
~6px) pointed at a remaining real problem, not just a measurement
artifact: **a single-step band whose phase name only repeats its own
step's label produced a header row saying the exact same word the step
row already says, directly above it.** In the reported fixture, 5 of 8
bands were exactly this (`Pre-read`, `Initial Denaturation`, `Secondary
Denaturation Hold`, `Final Extension Hold`, `Post-read`) — the same kind
of literal repetition the user's original complaint was about, and the
reason the height barely moved despite removing GOTO rows and merging
the fluorescence cards.

### Same-name rule (checked against both parsers, not assumed)

`isRedundantSingletonBand(band, steps)` (`protocol-phase-groups.ts`) is
true only for a **single-step** band whose `phase` equals that step's own
`label`, compared **case/whitespace-insensitively**. Confirmed directly
against the backend rather than guessed:

- `app/parsers/pcrd_raw.py` and `app/parsers/eds_raw.py` both emit phase
  `"Pre-read"` / `"Post-read"` (lowercase r) but label `"Pre-Read"` /
  `"Post-Read"` (uppercase R) for the very same step — an exact-string
  compare would wrongly treat these as *different* and keep a genuinely
  redundant header. Case-insensitive comparison is required, not
  optional, to correctly fold these two very common phases.
- A plain single `"Initial Denaturation"` or `"Hold"` step emits an
  identical phase and label string in both parsers, byte for byte —
  already redundant even under exact comparison.
- Multi-step bands are **never** folded regardless of naming (test:
  *"keeps the header row for a real multi-step band even if every step
  happens to share the phase name as its label"*, a synthetic 2-step
  `"Hold"`/`"Hold"` band) — only a band's own single step's own label is
  ever compared, never collapsing a real multi-step group's header.

### What changed, what didn't

- `ProtocolStepsTable.tsx`: for a redundant singleton band, no
  `ProtocolPhaseGroupHeader` row is rendered. The step's own row instead
  gets a `PhaseDot` (same phase-colored dot the header used) placed
  before the label, and — new — `PhaseBandBadges` (refactored out of the
  header component, shared logic, not a second copy) placed *after* the
  label, carrying whatever the header would have: a GOTO range/stale
  notice, or a `×N` cycles badge. Verified with a band that is BOTH
  redundant-by-name AND a genuine repeat (`"Extension (Touchdown)"`, 12
  cycles, `goto_label` present): its GOTO badge renders directly on that
  step's row, not dropped (test: *"inlines a redundant singleton band's
  GOTO/cycles badge onto its own step row instead of dropping it"*).
- The row's own left border (in the phase color) was **already** present
  on every row regardless of band position — this was never a
  color-only cue that needed adding; the dot is the *additional*
  non-color cue team-lead asked for, now attached to the row itself
  instead of a separate line above it.
- `ProtocolThermalProfile.tsx` / `protocol-phase-groups.ts`'s
  `groupPhaseBands` are **untouched** — the diagram still draws all 8
  bands for this fixture exactly as before; `isRedundantSingletonBand` is
  a separate, additive function the table calls, not a change to what a
  "band" is.
- `cyclesVary` is unaffected (a single-step band can't disagree with
  itself, so it's always `false` there; the existing suppression rule for
  multi-step bands is untouched).

### `data-testid` impact (checked, none broken)

`grep`ped every `protocol-group-header-*` reference before touching
anything. Of the pre-existing tests that reference it: the P0-T0.2 value-
lock test (phase ≠ label — synthetic `s1`/`s2`/... labels), the
"colors each phase group header..." test and the "drops the single x-N
cycle badge..." test (both 2-step `Amplification 1` bands) are all
**multi-step or name-distinct**, so none of them were affected — verified
by running the full suite, not just assumed. Two spots *did* need
updating, both because the fixture's phase/label happened to collide
(not because the testid convention itself changed):
- The row-count regression test (previous section) — 6 of its 8 bands
  are now redundant singletons, so `protocol-table tbody tr` count
  changed from `10 + 8` to `10 + 2`, and its wait-condition
  (`findByTestId('protocol-group-header-Post-read-9')`) no longer
  resolves since that header is gone by design; switched to
  `findAllByText('Post-read')` (ambiguous by design against the
  diagram's title/legend, which is fine for a presence check).
- "does not break for a single phase group spanning the whole protocol"
  test kept passing unmodified, since its fixture's `label` (`'Synthetic
  step'`) never matches its `phase` (`'Post-read'`) — it exercises the
  *header-kept* path, which was never in question.

New tests (RED confirmed by running before the corresponding
`ProtocolStepsTable.tsx`/`ProtocolPhaseGroupHeader.tsx` changes existed,
same as this task's established pattern for new pure-logic + integration
pairs):
- `protocol-phase-groups.test.ts`: `isRedundantSingletonBand` — exact
  match, case-insensitive match (Pre-read/Pre-Read), phase-adds-
  information (false), multi-step band never folds (false) even when
  every step's label happens to equal the phase.
- `ProtocolTab.test.tsx` (`describe('redundant singleton phase-band
  header folding')`): no header for same-name singleton; folds across a
  case-only difference; keeps header when phase adds information; keeps
  header for a genuine multi-step band even when every step shares the
  phase name as a label.

### Re-verified height (now a real, not artifact-inflated, reduction)

Same synthetic fixture, labels adjusted to match real parser
capitalization (`"Pre-Read"`/`"Post-Read"`, and generic `"Hold"` for the
two plain single-hold phases, matching `pcrd_raw.py`'s actual output
convention instead of the earlier made-up
`"Secondary Denaturation Hold"`/`"Final Extension Hold"` names):

| | Before (always-open edit form + 2 separate collapsed cards) | After (read-only default, folded headers) |
|---|---|---|
| Protocol card height | 913.5px | **807px** |
| Whole Raw data tab height | 1171px | **994px** (−177px, ~15.1% shorter) |
| Table rows (`tbody tr`) | 13 (10 steps + 3 GOTO rows) | **12** (10 steps + 2 real multi-step headers) |

This is a genuine reduction, not a repeat of the earlier clipping
artifact — `document.querySelectorAll('#protocol-table tbody tr').length`
was checked live (12) and `rowCount`/`headerCount` were logged from the
same Playwright run that produced the screenshots below, not inferred
from a static measurement.

All 4 screenshots regenerated again (`P10-PROTOCOL-after-readonly-*.png`,
`P10-PROTOCOL-after-edit-*.png`): every singleton phase (`Pre-Read`,
`Initial Denaturation`, `Hold` ×2, `Post-Read`) now shows once, as its own
step row with a colored dot, not twice; `Extension (Touchdown)`'s repeat
badge (`↩ 단계 8 · 총 12회`) renders on its own row, right after its
label, not lost.

### Verification (all 4 gates + unit/full suites)

```
$ npx tsc --noEmit          # 0 errors
$ npm run lint              # 0 errors, 0 warnings
$ npm run test               # 122 files, 895 tests passed
$ npm run build              # tsc -b (including test files) + vite build: success
```

(`npm run build`'s `tsc -b` caught one test-file-only error `npx tsc
--noEmit` did not — a missing `describe` import in `ProtocolTab.test.tsx`
after adding a `describe` block — confirming why both are run, per this
evidence doc's own earlier note.)

E2E: full root suite re-run against this refinement's build (isolated
backend, port 8175, scratch DB): **133 passed / 4 failed**. Different
individual specs flaked than the previous section's run (that round:
`17-manual-group:143`, `24-responsive:4`, `24-responsive:51`; this round:
`17-manual-group:58`, `20-keyboard:28`, `24-responsive:4`,
`24-responsive:51`) — consistent with these being genuinely
non-deterministic under concurrent multi-agent load, not a fixed set tied
to this change. All 4 individually reproduced by isolated rerun:
`17-manual-group:58` and `20-keyboard:28` passed cleanly alone;
`24-responsive:4` passed cleanly alone (again); `24-responsive:51` failed
again alone with the identical `1111 > 1000` bound violation, matching
its status as team-lead's own documented, separately-tracked
flaky-under-load spec. No protocol/raw-data e2e spec failed in this run
either.
