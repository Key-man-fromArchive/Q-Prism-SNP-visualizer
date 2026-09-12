# P8-E2E-DEBT — root-causing the 4 long-standing root E2E failures

Branch: `feedback/p8-e2e-debt` (worktree `worktree/feedback-p8`, from `main` at `1e0fb54`).
Isolated server: initially `127.0.0.1:8161`/`/tmp/p8.db`, migrated mid-task to
`127.0.0.1:8165`/`/tmp/p8b.db` at the orchestrator's request (port reassignment to avoid collision
with other agents' isolated servers); both were killed by their own PID, never by port-number
`pkill`. Never touched port 8002 or `/app/data/snp_analyzer.db`.

Baseline reproduced exactly as reported: 4 failed in
`tests/06-import-mapping.spec.ts`, `tests/17-manual-group-and-plate-drag.spec.ts` (x2),
`tests/test-windows.spec.ts` before any change.

## Method

For each failure: `git log -L`/`git log -S` on the asserted string or attribute to find the
commit that introduced it and the commit that broke it, then `git show <commit> -s` to read intent,
then a throwaway diagnostic spec (deleted afterward, never committed) against the isolated server
to confirm the live DOM/state matches the git-history theory before touching anything. No selector
was loosened, no `test.skip`/`test.fixme`, no bare timeout bump without a measured, reproducible
timing gap.

---

## (1) `tests/06-import-mapping.spec.ts:15` — `getByText('Import mapping')` timeout

**Passed from:** `c46063d` (2026-07-24, introduced the 4-step wizard and this assertion) until
`88fa3f5` did nothing to this file (see below) — so, more precisely, **it never passed**, because:

**Root cause:** the app has defaulted to Korean since `79f60ac` ("i18n: default to Korean...",
2026-07-06), which is *before* `c46063d` wrote this test. `t.imwImportMapping` renders
`'가져오기 매핑'` by default, never the English `'Import mapping'` the test asserted — same for
`'Column mapping'`/`imwColumnMapping`→`'열 매핑'`, `'Assay role binding'`/`imwAssayRoleBinding`→
`'분석 역할 지정'`, `'Validation preview'`/`imwValidationPreview`→`'검증 미리보기'` (all confirmed
in `snp-analyzer/frontend/src/locales/{en,ko}.ts` and their call sites in
`ImportMappingWizard.tsx:244,388,425,472`).

Commit `88fa3f5` ("Test what the app does now, not what it did in English", 2026-09-11) fixed this
exact class of bug in `01-05` + `helpers.ts` but its own message says "Five specs" — `06` was not
one of the five (`git show 88fa3f5 --stat` touches only `01,02,03,04,05,helpers.ts`) and was missed.

Separately, `#upload-status` (asserted for `'Parsed'`/`'Generic'`) is unmounted the instant a
session exists (`App.tsx`: `{visibility.upload && <UploadZone .../>}`) — the same stale-expectation
class `88fa3f5`'s commit message describes for the specs it did fix ("a parsed upload now hands
straight over to the workspace, so '#upload-status contains Parsed' can never be observed").

**Verdict:** test bug, not app bug — both the hardcoded-English assertions and the `#upload-status`
read are the identical class of staleness `88fa3f5` already fixed elsewhere; `06` was just missed.
`WT=FAM`/`MT1=VIC` were left untouched — `roleLabel()` in `ImportMappingWizard.tsx` returns the raw
role string for non-normalization roles, so those two are language-independent already.

**Fix (test only):** step-heading assertions changed to `/English|한국어/` regex, matching the
pattern already used in `01-homepage.spec.ts`/`02-upload-quantstudio.spec.ts`; the two
`#upload-status` lines replaced with `#instrument-badge` containing `'Generic'` (also
language-independent — it's the raw parser instrument string, `generic_table.py:202`
`"Generic Long Table"`), following the same convention `02-upload-quantstudio.spec.ts` uses.

**Verified:** `06-import-mapping.spec.ts` — 1 passed.

---

## (2) `tests/17-manual-group-and-plate-drag.spec.ts:92` — drag selects 0 wells

**Passed from:** `4662455` ("Improve manual NTC and well grouping controls", 2026-09-01 07:00,
wrote this test) **until `287ad3f`** ("Complete P2-S4 keyboard interaction contract", 2026-09-07
09:22): `git log --all -S "aria-pressed" -- .../PlateView.tsx` shows `287ad3f`'s diff is
`- aria-pressed={isSelected || isMultiSelected}` / `+ aria-selected={...}` on the well
`<button role="gridcell">`. Confirmed live: after a drag, `document.querySelectorAll('.plate-well')`
has 96 elements, 0 with `aria-pressed` set at all (neither true nor false — the attribute is simply
gone), 6 with `aria-selected="true"`.

**Was this a bug or intended?** `role="gridcell"` is the WAI-ARIA grid-cell role; per the ARIA
Authoring Practices Guide a grid cell's selection state is `aria-selected`, not `aria-pressed`
(`aria-pressed` is exclusively for `role="button"` toggle-buttons). The commit's own title
("Complete P2-S4 **keyboard interaction contract**") and the surrounding diff (adding
`useWellGrid`/roving-tabindex keyboard nav) confirm this was a deliberate accessibility correction,
not an accidental rename.

**Verdict:** app change was correct/intended; test bug. Fixed `.plate-well[aria-pressed="true"]` →
`.plate-well[aria-selected="true"]`.

**Second, independent break in the same assertion block:** at `4662455` the selected well's button
had exactly one `<span>` child (the `✓` badge — `git show 4662455:.../PlateView.tsx` line ~469).
`846b5c2` ("TASK_DONE P4-S3-T1: clarify chart semantics and reference basis", 2026-09-07 13:47) added
a second, always-present `<span>{call.glyph}</span>` genotype-dot glyph *before* it, without touching
this test. `selected.first().locator('span')` (no `.first()`/`.filter()`) then hits a Playwright
strict-mode violation (2 elements) instead of the intended `toHaveText('✓')` check.

**Verdict:** app change (adding the glyph) was an unrelated, legitimate UI addition; test bug (the
locator was never updated to disambiguate). Fixed to
`selected.first().locator('span', { hasText: '✓' })`.

**Verified:** `17-manual-group-and-plate-drag.spec.ts:58` ("dragging from plate whitespace...") — 1
passed, reproducibly (5/5 runs).

---

## (3) `tests/17-manual-group-and-plate-drag.spec.ts:152` — `.plate-well:not(.empty)` finds 0

**Root cause:** `PlateView` fetches well data through its own effect (`fetchPlateData` →
`getPlate(session)`), a second async round trip *after* `/api/upload` resolves. `#analysis-panel`
loses its `hidden` class as soon as the session exists — before that second fetch resolves — so
every `.plate-well` starts out carrying the `.empty` placeholder class. This second test reads the
grid on the same tick `#analysis-panel` becomes visible (unlike test (2)/`uploadAndWait`, which adds
a settle wait), so it always raced the fetch.

Measured directly (throwaway diagnostic, not committed): `.plate-well:not(.empty)` count is `0`
immediately after `#analysis-panel` loses `hidden`, and `96` from the very next 300 ms poll onward,
consistently, over 10 repeated 300 ms samples. This pattern (`getPlate` effect, unrelated to any
Sep-7 commit — `git log -S getPlate` traces it to `28fccb4`, the original React migration) has
existed since before this test was written; it was never a specific regression, just an
always-latent race the test happened not to hit until now.

**Verdict:** test bug (missing synchronization on inherently-async data), not app bug. Fixed by
waiting for `.plate-well:not(.empty)` to actually appear (`expect(...).toBeVisible()`, Playwright's
own auto-retry, no arbitrary sleep) before reading the grid — not by loosening the `toBeGreaterThan(3)`
threshold, which is unchanged.

**Verified:** `17-manual-group-and-plate-drag.spec.ts:143` — passed in isolation and paired with (2)
across 8 runs; see "Known follow-up" below for context on this same test's second assertion.

---

## (4) `tests/test-windows.spec.ts:122` — `#amplification-plot` visible → hidden

**Passed** with the plot rendered unconditionally until `3923909` ("Prioritize analysis results and
compact active settings", 2026-09-07 12:34). Confirmed via `git show 3923909`: this commit wrapped
the well-detail numeric stats table in a new collapsed-by-default `<details className=
"well-detail-expanded">…</details>` disclosure — **and the closing `</details>` tag was placed after
the pre-existing `#amplification-plot` div**, pulling the plot itself inside the same collapsed
disclosure. Confirmed live: `#amplification-plot`'s immediate parent is `<details class=
"well-detail-expanded">` with no `open` attribute; a native, closed `<details>` never renders its
non-`<summary>` children, regardless of what `getComputedStyle` reports on the children (which is why
`05-interactions.spec.ts:161`'s weaker `not.toHaveClass(/hidden/)` still "passes" — there is no
`hidden` *class* anywhere in this chain, it's native disclosure semantics — while `test-windows`'
`toBeVisible()` correctly reports it hidden).

**Is this intended?** Ambiguous, and I am not deciding it unilaterally per the write-scope
constraint (app-source changes need prior approval): the commit's stated goal is "prioritize
analysis **results**" and compact secondary numeric detail — burying the amplification **curve
plot** (a primary graphical result, not a numeric stat row) behind the same disclosure as the stats
table reads like scope creep from the closing-tag placement, not a deliberate design decision to
hide the curve. But I can't rule out that hiding it was intentional without asking.

**Orchestrator decision: (a) app fix, approved.** `#amplification-plot` (and its
`referenceBasisUnknown` normalization-basis caption, which explains the curve and belongs with it,
not with the numeric rows) moved to *after* the closing `</details>`. The numeric stat table and the
P7-added full-cycle time-series table stay inside the disclosure — those genuinely are "detailed
readings". Also found and fixed while doing this: `analysisNumericDetails` ("Detailed readings and
amplification curve" / "상세 측정값과 증폭 곡선") was the *same* string `3923909` wrote to describe
what it put inside the disclosure — accurate then, but it would have become a lie the moment the
curve moved out, so it's now `"Detailed readings"` / `"상세 측정값"` in both locales.

TDD sequence followed: added a new Vitest unit test in `WellDetailPanel.test.tsx`
("shows the amplification curve without expanding the numeric-details disclosure") asserting
`#amplification-plot` is `toBeVisible()` while `details.open === false`; confirmed it failed (RED)
against the pre-fix component (`Received element is not visible`); applied the JSX move; confirmed
it passed (GREEN); ran the full `WellDetailPanel.test.tsx` file — one pre-existing test broke as a
direct, expected consequence (see next paragraph) and was fixed; all 16 tests in the file pass.

**`onToggle`/`Plotly.relayout` handler removed**, per your request to re-examine it: it existed
solely to fix Plotly's layout after the plot was un-hidden by expanding the disclosure it used to
live inside (a Plotly instance created/measured while its container has zero rendered width needs an
explicit `relayout({autosize:true})` once real width is available). Now that the plot is mounted
outside the `<details>` from the start — always at real width — nothing inside the disclosure is a
Plotly instance anymore, so there is nothing left for a toggle-triggered relayout to fix. Confirmed
by removing it and asserting `Plotly.relayout` is never called in the updated
`WellDetailPanel.test.tsx` test (previously named "...resizes the retained curve on disclosure...",
renamed and rewritten since that behavior no longer exists by design, not because the assertion was
wrong).

`tests/05-interactions.spec.ts:161` **strengthened** per your instruction: `not.toHaveClass(/hidden/)`
→ `toBeVisible()`, since the former is exactly the check that let this regression through undetected
for 5 days (native `<details>` semantics use no CSS class at all).

Verified: `test-windows.spec.ts:109` passes; `05-interactions.spec.ts` full file passes; frontend
`tsc -b`/`eslint` clean on all touched files; rebuilt and re-served, confirmed via the isolated
server's index.html referencing the new asset hash.

---

## Newly discovered, out-of-scope: a second, separate flake in
`17-manual-group-and-plate-drag.spec.ts:193` (test 2, NTC-corner-on-scatter)

Fixing (3) let this test progress past its previously-blocking assertion into new territory that
was never reachable before, and it exposed an intermittent failure at a *different* line (`expect(
corner).not.toBeNull()`, after `scatter-tool-edit` is clicked on `marker-scatter`) that was **not**
one of the 4 originally reported failures. Observed pass rate over repeated runs: roughly 60%
in isolation, worse interleaved with test 1. I traced the assertion itself: the trace name it
searches for (`'NTC threshold'`, singular, hardcoded when the test was written at `4662455`) was
also renamed by `846b5c2` to the localized, pluralized `t.chartNtcThreshold` = `'NTC thresholds'`
— I already fixed that string in `ntcCornerAt()`. But even with that fixed, the *timing* of when the
"NTC thresholds" trace's `x`/`y` populate after a programmatic marker POST + `markers-changed` dispatch
is inconsistent — sometimes near-instant, sometimes never resolving within a 10 s poll. Backend logs
(`/tmp/p8.log`) show fast, clean 200 responses in both passing and failing runs, so this is not
server latency; it looks like a client-side race in `MarkerScatterPlot`/`MultiMarkerAnalysisPanel`
state after `markers-changed`. I have not root-caused this further — it needs its own investigation
and is outside this task's write-scope (would mean editing app source under uncertainty, not a
one-line evidenced fix). Flagging it rather than masking it with a longer timeout.

**Update:** the same class of failure also hit test 1 (`17:58`, the drag-select test) during a later
4/5-file batch run, at its own NTC-corner-drag section (`waitForRequest` on `/cluster` timing out
after the corner drag, ~line 129) — passed 3/3 when rerun in isolation immediately after. So this is
not confined to test 2; it's the same underlying NTC-threshold/scatter-state timing issue surfacing
wherever a test interacts with the NTC-corner marker in a longer run. Not fixed, per your direction
to document rather than mask it.

---

## Current state

All 4 originally-reported failures fixed and verified:
- (1) `06-import-mapping.spec.ts`
- (2) both assertions in `17-manual-group-and-plate-drag.spec.ts:58` test
- (3) `17-manual-group-and-plate-drag.spec.ts:143` test's originally-reported assertion
- (4) `test-windows.spec.ts:122` (app fix, approved: `#amplification-plot` moved out of the
  numeric-details disclosure; see above)

Also done per orchestrator direction: `05-interactions.spec.ts:161` strengthened
(`not.toHaveClass(/hidden/)` → `toBeVisible()`).

Remaining, explicitly not fixed and not masked, out of the original 4's scope: the NTC-corner
client-state race documented above (affects both tests in `17-manual-group-and-plate-drag.spec.ts`
under longer runs, ~40% observed failure rate for test 2 in isolation). Flagged for a separate task.

Full-suite runs (isolated server, `--workers=1`, single run each) before this doc's final update:
- Run A: 3 failed (17:143 flake, 26-asg-compatibility:271 flake [unrelated file, not touched, did
  not reproduce on a later run — looks like an unrelated environmental flake], test-windows:122
  pending), 134 passed.
- Run B: 2 failed (17:58 flake this time instead of 17:143 — confirms intermittency is in this file
  under full-suite sequencing, not a fixed regression I introduced), test-windows:122 pending, 135
  passed.
- 5 isolated reruns of just `17-manual-group-and-plate-drag.spec.ts`: 3/5 both tests green, 2/5 the
  second test's *new* (not originally reported) NTC-corner assertion flaked as described above.

**Final full-suite run, after the (4) app fix and `05-interactions.spec.ts` strengthening:**
135 passed, 2 failed:
- `17-manual-group-and-plate-drag.spec.ts:58` — the NTC-corner race described above, this time
  surfacing in test 1 instead of test 2. Reran in isolation 3/3 green immediately after — confirms
  it's the same known, load/sequence-sensitive flake, not a new regression.
- `24-responsive.spec.ts:51` — reran in isolation 3/3 **failed**, but the orchestrator had already
  identified this spec (along with `20-keyboard`) as flaky under concurrent-agent load from P9's
  independent run, and `ps aux`/`uptime` confirmed real contention during my reruns too (P10 running
  two isolated servers simultaneously, load average 2.5-2.85 on this host, vs. ~0.8 during my earlier
  clean-window runs). Per the orchestrator's own instruction not to use load-contaminated rounds as
  evidence, and since this spec is untouched by anything in this task's scope and was independently
  flagged as load-flaky before I ever ran it, I have not investigated it further.

`06-import-mapping.spec.ts`, `test-windows.spec.ts` (all 5 tests), and `05-interactions.spec.ts`
(all tests) passed clean in this same final run. Not yet at a clean 137/0 single-shot run only
because of the two known, evidenced, out-of-scope flakes above — everything in this task's actual
scope (the original 4, plus the disclosure-summary label and the `05-interactions` strengthening) is
green.

---

## Determinism check (requested by orchestrator, after the baseline-flakiness report)

Ran the 4 originally-reported specs together, 5 consecutive times, on the migrated `8165` server,
with `ps aux` confirming **no other agent's isolated uvicorn was running** during this window (load
average ~0.8-2.5 on a multi-core host):

| Run | Failures |
|---|---|
| 1 | `test-windows:109` only |
| 2 | `17:143` (NTC-corner) + `test-windows:109` |
| 3 | `test-windows:109` only |
| 4 | `test-windows:109` only |
| 5 | `17:143` (NTC-corner) + `test-windows:109` |

- `06-import-mapping.spec.ts` and `17-manual-group-and-plate-drag.spec.ts`'s first test: **5/5
  green** — fully deterministic once fixed.
- `17-manual-group-and-plate-drag.spec.ts`'s second test (the newly-found NTC-corner flake): **2/5
  failed (40%)** — confirmed genuinely intermittent, not load-dependent (no concurrent server during
  this run), consistent with what I reported before the port migration.
- `test-windows.spec.ts:109`: **5/5 failed** — this directly answers the orchestrator's timing
  hypothesis: **it is not flaky, it is fully deterministic.** To rule out render-timing specifically
  (Plotly needing more than the test's fixed `waitForTimeout(1000)`), I polled
  `#amplification-plot`'s visibility for up to 10 s after the well click with the "Numeric details"
  disclosure left untouched: **still `false` at 10 s.** Immediately clicking
  `.well-detail-expanded > summary` (no additional wait beyond 300 ms) made it `true`. This rules out
  a race entirely — the plot does not become visible no matter how long you wait while the
  `<details>` stays collapsed; only expanding it does. The structural diagnosis above stands.
