# P19-CYCLE-ALIGN — the well×cycle table and CSV wrote values into the wrong cycle column

Branch: `feedback/p19` (worktree `worktree/feedback-p19`, from `main` at `008eb7b`).
Isolated server: `127.0.0.1:8215` / `/tmp/p19.db` (removed after use).

## The bug (confirmed by reading, then reproduced with a RED test)

`FluorescenceDataCard.tsx:170` (pre-fix):
```ts
const cycles = curves[0]?.cycles ?? [];
```
used **only the first well's** cycle array as the column header set for every row.

`FluorescenceDataCard.tsx:304` (pre-fix) then rendered each row's `<td>` by iterating that well's
own `values` array **by index**, keying each cell with `cycles[i]` — i.e. the *global first well's*
cycle numbers, not this well's own:
```tsx
{values.map((value, i) => (
  <td key={cycles[i]} className="text-right px-2 py-0.5">{value.toFixed(3)}</td>
))}
```

`use-exports.ts`'s `buildWellCycleValuesCsv` (pre-fix) had the identical defect for the CSV: a single
top-level `cycles` array for the header, and each well's `values` joined in array order underneath
it, with no reference to that well's own cycle numbers at all.

**Consequence**: whenever one well's cycle array differs from the first well's (different length,
different starting cycle, or a gap in the middle), that well's later readings silently shift into an
earlier cycle's column — both on screen and in the exported CSV. A user reads (and could act on) the
wrong reading believing it belongs to a different cycle.

## Can the backend actually produce different cycle sets per well? (Yes — read, not assumed)

Read all three files named in the task before writing any test:

- `app/parsers/generic_table.py`'s `_to_duplex_unified()` (~line 605) groups readings into
  `grouped[(well, cycle)]` and only appends a `WellCycleData` row **when both the WT and MT1 channel
  values are present for that exact `(well, cycle)` key** (`if wt.channel_id not in values or
  mt1.channel_id not in values: continue`). If one channel's reading is missing for a given
  `(well, cycle)` — a dropped/incomplete row in the source file, a partial re-read, anything that
  breaks strict rectangularity — that well silently loses that cycle while a sibling well that has
  both channels for the same cycle keeps it. `UnifiedData.cycles` is a **global union**
  (`sorted({reading.cycle for reading in import_run.readings})`), not a per-well set, so nothing
  downstream re-derives or enforces a common per-well cycle list from it.
- `app/import_models.py`'s `ImportRun.validate_readings_reference_channels` (~line 111) only checks
  that every reading references a known `channel_id` and rejects **exact duplicate**
  `(well, cycle, channel_id)` keys. It does not require, and has no mechanism to require, that every
  well report the same set of cycles as every other well.
- `app/routers/data.py`'s `amplification_all()` (backing `/api/data/{sid}/amplification/all`) groups
  `normalize()`'s output points by `p.well` into `well_data`, then builds each curve's `cycles` from
  `sorted(well_data[well], key=lambda p: p.cycle)` **for that well only** — again, whatever readings
  exist for that specific well, with no gap-filling to a shared grid. `normalize()`
  (`app/processing/normalize.py`) is a 1:1 map over `unified.data`; it does not synthesize missing
  `(well, cycle)` points either.

**Verdict**: the three files compose to make this a real, reachable condition, not a purely
theoretical one — any import path that can leave `_to_duplex_unified`'s per-channel grouping
incomplete for some `(well, cycle)` (dropped rows, truncated files, partial merges) produces exactly
the divergent-cycle-arrays shape this task is about. Nothing in the response contract promises equal
cycle arrays across wells, and the frontend was assuming it anyway.

## The fix

New shared module `frontend/src/lib/well-cycle-alignment.ts`:
- `unionCycles(curves)` — every cycle number appearing in **any** well, sorted ascending. This is the
  column set for both the table and the CSV (not just the first well's).
- `cycleValueMap(curve)` — maps a well's **own** cycle numbers to its values, so lookups are by cycle
  number, never by array index.
- `cycleSetsDiffer(curves)` — true when at least one well's own cycle count is narrower than the
  union, i.e. some cell will be a genuine gap rather than a real reading.

`FluorescenceDataCard.tsx` and `use-exports.ts`'s `buildWellCycleValuesCsv` both now build the header
from `unionCycles()` and look up each well's per-cycle value via `cycleValueMap()`, so the table and
the CSV share one alignment rule instead of two independently-written (and, it turned out,
independently-buggy) ones.

### Missing-cell representation: never "0"

A `(well, cycle)` with no reading renders as an em dash (`—`) with a `title`/`aria-label` of
"이 사이클에 대한 판독값 없음" / "No reading for this cycle" — visually and semantically distinct from a
real `0.000` reading (this project's established convention: normalization `unreported`, GOTO
`확인 불가`, etc. — "don't pretend to know what you don't"). The CSV writes an **empty field** for the
same cell (`A2,0.08,0.3,,1.3,`), never the string `"0"`, so a spreadsheet/analysis script reading the
export can tell "no data" from "reads zero" apart too (`Number("")` is not `0` in most tooling's
CSV-typed contexts, and it is visibly blank either way).

### User notice on cycle-set mismatch

When `cycleSetsDiffer()` is true, a `text-warning`-styled notice appears above the table: "일부 웰은
사이클 수가 다릅니다. 값이 없는 칸은 "0"이 아니라 판독값 없음을 뜻합니다." / "Some wells have a different number
of cycles. Blank cells mean no reading, not '0'." This was a deliberate choice over silently unioning
the cycle sets: a user staring at unexplained blank cells has no way to tell whether that's expected
(this scenario) or a new bug, without being told. The notice does **not** appear when every well's
cycle array matches (verified by a regression test using the existing all-wells-share-`[1,2,3]`
fixture).

## TDD — RED first

Before writing any implementation, RED tests were added against the **unmodified** component/hook and
run to confirm they fail against the actual pre-fix code (not merely against a hypothetical):

```
FAIL src/hooks/use-exports.test.tsx > ...cycle NUMBER... : TypeError: Cannot read properties of
  undefined (reading 'map') at use-exports.ts:96 (params.cycles.map — the new call shape has no
  top-level `cycles`, matching the new per-curve-cycles contract)
5 failed | 21 passed (26)
```

```
FAIL src/components/analysis/FluorescenceDataCard.test.tsx > aligns each well's cells...
  A2's row rendered as [A2, 40.000, 60.000] under header [Well, 1, 2, 3] — i.e. A2's real cycle-3
  reading (60.000) landed under the "2" column, and the row was one cell short of the header. This
  is the reported defect, reproduced directly (not inferred).
3 failed | 9 passed (12)
```

After the fix, the same test files: **38/38 passed** (`well-cycle-alignment.test.ts` new, plus the
migrated/extended `use-exports.test.tsx` and `FluorescenceDataCard.test.tsx`).

New/changed tests cover:
- A2 has cycles `[1, 3]` while A1 has `[1, 2, 3]` — A2's cycle-1/cycle-3 values land in the correct
  columns, not shifted (table + CSV).
- A1 has a real `0` at cycle 1; A2 has no cycle-1 reading at all — the two render/export differently
  (table: `0.000` vs `—`; CSV: `0` vs empty field).
- All wells share one cycle set (existing fixture) — output unchanged (regression guard); no mismatch
  notice.
- 0 curves, 0 cycles — empty state, no crash (existing test, still passes: `unionCycles([])` /
  `cycleSetsDiffer([])` both handle the empty array explicitly).

## Verification — all four, plus a rebuild after a `tsc -b` (test-scope) catch

```
npx tsc --noEmit   -> 0 errors
npm run lint       -> 0 errors/warnings
npm run test       -> 126 files / 932 tests passed (baseline 125/919 + 13 new: 8 in
                       well-cycle-alignment.test.ts, 2 in use-exports.test.tsx, 3 in
                       FluorescenceDataCard.test.tsx)
npm run build      -> tsc -b && vite build succeeded
```

`npx tsc --noEmit` alone did **not** catch a real type error: `cycleValueMap`'s parameter type was
originally `Pick<WellCycleCurve, "cycles" | "values">`, and both call sites (the component and the
test file) pass an object literal that also has `well` — TypeScript's excess-property check on
object literals only fires under the full project build (`tsc -b`, which `npm run build` runs and
includes test files), not under `--noEmit`'s narrower scope. Fixed by typing `cycleValueMap`'s
parameter as the full `WellCycleCurve` (its two real callers already have `well` in hand). Re-ran all
four gates clean afterward.

## E2E

Backend on `127.0.0.1:8215` / `/tmp/p19.db`, frontend dev server on `5219` proxying to it
(`VITE_DEV_API_TARGET=http://localhost:8215`).

`frontend/e2e` in this branch state contains 52 specs total (not the 140 mentioned in the task
brief — that figure does not match anything reproducible in this worktree's `main` ancestor; noting
the discrepancy rather than silently accepting either number). Full suite, twice, against a freshly
reset DB each time (determinism check per the task's instruction):

```
Run 1: 47 passed, 5 failed
Run 2 (fresh DB): 47 passed, 5 failed — same 5, deterministic
```

The 5 failures are:
- `p4-s0-single-marker-default.spec.ts` ×2 — `split-marker-banner` testid not found
- `p5-scatter-view-controls.spec.ts` ×2 — `axis-x-min` not found / not disabled
- `screenshots.spec.ts` ×1 — `split-marker-banner` not found

All five concern the multi-marker "split into markers?" banner and the scatter-view manual axis
bounds control — features this branch's checked-out `main` (`008eb7b`) does not implement yet (the
harness's own `README-e2e.md` documents these specs as written RED-first, ahead of the UI). This diff
touches only `FluorescenceDataCard.tsx`, `use-exports.ts`, the new `well-cycle-alignment.ts`, and two
locale files — none of which are reachable from any of those five specs — so these are confirmed
pre-existing, not regressions from this change. (Running `screenshots.spec.ts` as part of the full
suite overwrites checked-in reference PNGs under `frontend/e2e/shots/*.png` as a side effect of its
own design; those were reverted with `git checkout -- frontend/e2e/shots/*.png` after every run so
they are not part of this diff.)

## Visual verification

Screenshots were captured via a throwaway Playwright script (not part of the checked-in suite) that
logs in, loads example dataset "2", and intercepts `GET .../amplification/all` to return a crafted
fixture with three wells:
- `A1`: cycles `[1,2,3,4,5]`, all real readings.
- `A2`: cycles `[1,2,4]` — **missing cycles 3 and 5** (the confirmed-possible backend gap).
- `A3`: cycles `[1,2,3,4,5]`, with a **real `0.000`** reading at cycle 1 (to contrast against A2's
  missing cells).

`P19-CYCLE-ALIGN-light-1440.png`, `-dark-1440.png`, `-light-768.png`, `-dark-768.png` (1440×900 and
768×1024, light and dark): all four show the header as the union `1 2 3 4 5`, A2's cycle-1/2/4
values in their correct columns with `—` at cycles 3 and 5, A3's real `0.000` at cycle 1 rendered
distinctly from A2's `—`, and the orange mismatch notice ("일부 웰은 사이클 수가 다릅니다…") visible and
legible in both themes.

`P19-CYCLE-ALIGN-exported.csv` — the CSV downloaded from the same session:
```
Well,1,2,3,4,5
A1,0.1,0.4,0.9,1.6,2.2
A2,0.08,0.3,,1.3,
A3,0,0.5,1.1,1.7,2.4
```
A2's cycle 3 and 5 fields are empty (not `0`, not shifted into an adjacent column); A3's real `0` at
cycle 1 is written as `0`. Table and CSV agree on every cell.

## Scope discipline

No backend files were touched (read-only investigation confirmed the described divergence is
possible; no repair was needed there for this task). No other worktree, no `main` merge, no remote
push, no `git add -A`/`git add .`.
