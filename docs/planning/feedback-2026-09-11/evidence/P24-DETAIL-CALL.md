# P24-DETAIL-CALL — the detail panel invented a genotype for uncalled wells

Contract: feedback/p24, branch `feedback/p24` (main `b2efb9c`).

Prior investigation: `docs/planning/feedback-2026-09-11/evidence/P22-CALL-LOGIC.md`,
finding 3.

## The bug, confirmed

`WellDetailPanel.tsx` (line ~146, before this fix) had a fallback that fired
whenever a well had **no** `manual_type` and **no** `auto_cluster` at all (no
clustering ever ran, or none applies to this well): if the well was diploid
and had any positive signal, it sliced the raw `norm_fam / (norm_fam +
norm_allele2)` ratio at 0.6/0.4 into Allele 1 / Allele 2 / Heterozygous and
displayed that as the genotype anyway.

`ResultsTable.tsx` (`effectiveType`, unchanged by this fix) and the export
snapshot (`app/reporting/result_snapshot.py`'s `_row_call`, unchanged, backend
not touched) both do no such thing — an uncalled well stays uncalled (blank
grid cell / `"Unknown"`+`status: "missing"` in the export). So the SAME well,
at the SAME moment, could show `Heterozygous` in the detail panel and nothing
in the results grid or the exported CSV.

It also did not use the same reference frame the backend actually calls
from: the ratio it cut was the panel's own `norm_fam`/`norm_allele2` (already
origin-shifted per `ratio_origin.py` upstream, but not re-derived the way
`cluster_auto` re-derives its own `ratio` internally), so even where a
"lucky" match happened it was not reproducing the backend's decision, just
coincidentally landing near it.

## Fix

Removed the ratio-fallback entirely. An uncalled well (`manualType ??
autoCluster ?? null` is `null`) now shows `'—'` for genotype — the same
"no data" convention this panel already uses for the sample-name and
confidence cells right next to it. A real call renders exactly as before
(unchanged code path for `effectiveCall` truthy).

`ploidyOverride`/the derived `ploidy` local existed **only** to gate that
ratio fallback to diploid. It is no longer read. The prop itself stays in
`WellDetailPanelProps` (and un-destructured-but-typed) because
`MultiMarkerAnalysisPanel.tsx` — out of scope for this task — still passes
`ploidyOverride={selectedMarker.ploidy}` on its call site; removing the type
field would have broken that file, which this task is not authorized to
touch. The now-unused parameter is discarded with an explicit `void
ploidyOverride;` (documented in place) rather than silently dropped, so a
future reader does not have to guess whether that was an oversight.

## Locking the three-screen agreement with a test

New file: `WellDetailPanel.callConsistency.test.tsx`. It renders
`WellDetailPanel` and `ResultsTable` against the **same** `scatterPoints`
state (no mocking of one against the other) and asserts:

1. A well with `auto_cluster: null, manual_type: null` but a decisive raw
   ratio (`norm_fam=8, norm_allele2=2`, the exact shape that used to trip the
   0.6/0.4 cut into "Allele 1"): the detail panel shows `'—'` and never the
   text for any real genotype; `ResultsTable`'s cell for the same well has
   the accessible name `chartNoDisplayedCall` ("No displayed call") and no
   Het/Hom text.
2. A well with a real `auto_cluster: 'Heterozygous'`: both screens report
   Heterozygous (unchanged behavior, regression guard).
3. A well missing from the plate entirely (present in neither panel's data):
   both report "no data for this well", distinctly from case 1 (no call yet)
   and from the whole-plate-empty state (which `ResultsTable` renders as its
   own dedicated empty state, not per-well).

This is the actual regression lock the task asked for: a future change that
reintroduces ratio-guessing in only one of the two components will fail this
test, not just get discovered later in production.

`WellDetailPanel.test.tsx` also gained four tests: the ratio-guess RED case
directly, a same-file regression case ("still shows the real genotype when a
call exists"), and the two confidence-sentinel cases below.

### RED confirmation

Before the fix, with the new tests added:

```
 ❯ src/components/analysis/WellDetailPanel.test.tsx (20 tests | 3 failed)
   × shows no genotype (matching ResultsTable/export) for an uncalled well instead of guessing one from the raw ratio
   × does not render the no-signal 0.0 confidence sentinel as a plain probability
   × marks the fixed 0.9 small-region confidence ceiling instead of showing it as a plain 90% probability

Expected element not to have text content:
  Allele 1 (FAM)
Received:
  WellA1Sample—GenotypeAllele 1 (FAM)Confidence—
```

```
 ❯ src/components/analysis/WellDetailPanel.callConsistency.test.tsx (3 tests | 1 failed)
   × agree there is no genotype for a well with no manual_type/auto_cluster, even when the raw ratio looks decisive
Expected element not to have text content:
  Allele 1 (FAM)
```

(The other two cross-screen tests passed even before the fix — they only
exercise the already-correct paths — confirming the failure is specific to
the no-call case, not a broken test.)

After the fix, all pass (see verification below).

## `confidence` mixes several kinds of number — what could and could not be done

Per `P22-CALL-LOGIC.md`, the backend's `ClusteringResult.confidences` field
(one `float | None` per well) is filled from several unrelated computations,
with no companion field saying which one produced a given number:

| Source | Code | Range | Meaning |
|---|---|---|---|
| Mixture-model posterior | `clustering.py:655` | `[0.9, 1.0]` for an assigned call, `<0.9` only when Undetermined | a real probability |
| Manual-boundary distance score | `boundary_confidences`, `clustering.py:240` | `[0.0, 1.0]` | how far the ratio sits from the nearest manual cut; not a fitted probability |
| Small-region ceiling | `_SMALL_REGION_CONFIDENCE = 0.9` (`clustering.py:461`) | exactly `0.9` | "no mixture was fit, this is a cap, not a measurement" (the code's own comment) |
| NTC-gap score | `clustering.py:443` | `[0.0, 0.99]` | how far below the plate median a flagged well sits |
| No-signal / outlier sentinel | `clustering.py:404,632,649` | exactly `0.0` | no basis at all |
| Control / declared NTC | `clustering.py:237,356` | exactly `1.0` | fixed, not computed |

I confirmed (by reading `app/routers/clustering.py:161-172`, not by guessing)
that these are NOT distinguishable per well from anything the frontend
currently receives: the branch selection (manual-boundary vs auto) is a
per-marker-region property carried in `threshold_config`, which is not
surfaced to `ScatterPoint`; the `warnings` list that flags `low_n`/`no_signal`
is session-level, not per well, and is not even passed to this component.
**I did not invent a new backend field or infer a per-well "kind" I can't
actually verify — I said so explicitly instead**, per the task's own
instruction.

What IS reliable, because the constants are exact floats and I checked every
call site that writes `confidences[...]`:

- `confidence === 0` always means "no basis was computed" in the current
  code (no-signal branch, tiny-cluster/outlier branch) **except** the
  manual-boundary distance score can, in principle, also land on exactly
  `0.0` for a well sitting precisely on a boundary edge (a real, if
  maximally-uncertain, call). This is a measure-zero edge case on a
  continuous quantity; I chose to treat `0` uniformly as "no confidence
  value" (rendered `'—'`, same convention as the other no-data cells) rather
  than add a second, unverifiable rule to tell the two apart — the label is
  still not wrong even in that rare case (a confidence of exactly 0 is, at
  best, as good as no confidence).
- `confidence === 0.9` is the literal `_SMALL_REGION_CONFIDENCE` sentinel in
  the overwhelmingly likely case, since a genuine mixture posterior for an
  ASSIGNED call is bounded to `[0.9, 1.0]` and landing on the exact
  floating-point value `0.9` from a softmax computation is astronomically
  unlikely. The panel now renders this as `≥90%` with a hint explaining it is
  a capped estimate, not a measured probability — honest for both the
  (overwhelmingly likely) sentinel case and the (vanishingly unlikely)
  genuine-posterior-that-happens-to-equal-0.9 case, since "≥90%" is literally
  true either way.
- Every other confidence value (including any posterior or boundary-distance
  score that only **rounds** to `90%` without being the exact `0.9` literal)
  is left as a plain percentage. **This is a known, stated limitation, not a
  claim that every confidence kind is told apart** — the task asked for the
  two sentinel constants specifically, and that is what this covers.

Implementation: `confidenceDisplay` in `WellDetailPanel.tsx`, plus two new
locale keys (`confidenceNoBasisHint`, `confidenceCeilingHint`, en+ko) surfaced
as a `title` attribute on the confidence cell.

## Verification — all four gates

```
cd snp-analyzer/frontend
npx tsc --noEmit   # clean
npm run lint       # clean
npm run test       # 129 files / 951 tests passed (baseline 128/944 + 7 new tests: 4 in
                    # WellDetailPanel.test.tsx, 3 in the new callConsistency file)
npm run build      # tsc -b (clean) && vite build — success
```

`npx tsc -b` (used by `npm run build`, which also type-checks tests) was run
separately and is clean; it initially caught the now-dead `ploidy` local
(`TS6133`), which is what led to the `void ploidyOverride;` fix described
above.

## E2E

Backend started on port **8231** (own venv borrowed from `worktree/feedback-p0`
— only its already-installed dependencies were reused; the app code served is
this worktree's own `npm run build` output, under this worktree's own,
freshly created `app/data/snp_analyzer.db`). `E2E_BASE_URL=http://localhost:8231`
was set explicitly for every Playwright invocation; the config's default
(`:8002`, production) was never hit — confirmed by the `/api/auth/login`
request in the server log resolving against the freshly created local admin
user, not a pre-existing one.

Root `tests/` (140 tests, not `frontend/e2e/`'s 52):

```
139 passed, 1 failed (2.5m)
  ✘ tests/24-responsive.spec.ts:4:5 › multi-marker 384 review keeps long
    context and warnings inside bounded regions
    Test timeout of 60000ms exceeded (waiting for a marker-pick-button click)
```

This is exactly the pre-flagged, unrelated flake (`tests/24-responsive.spec.ts:4`,
nothing to do with `WellDetailPanel`/confidence/genotype). Re-ran it alone
(single test, same running backend, same port): **passed in 5.4s.** That is
consistent with "flaky under full-suite load", not a repeatable regression —
did not touch the file, per instructions.

Backend/DB cleanup after both the visual capture and the E2E run: process
killed, `app/data/snp_analyzer.db` + `-shm` + `-wal` removed. No production
server or DB was touched at any point (own port 8231 throughout, own
freshly-created local DB, `E2E_BASE_URL` set on every invocation).

## Visual verification

Captured against the real running app (not a mock), using the "Example 2x"
synthetic 96-well demo, before vs. after running clustering — the "before"
state is a genuine, common real-world "no call yet" case (no `manual_type`/
`auto_cluster` on any well), not a fabricated one:

- `P24-DETAIL-CALL-uncalled-light.png` / `-uncalled-dark.png`: well A1
  selected before any clustering ran. Detail panel: `유전자형 —` / `신뢰도 —`
  ("Genotype —" / "Confidence —"). The results grid below shows every well as
  a plain, uncolored label (`A1`, `A2`, ...) — no genotype anywhere, agreeing
  with the detail panel.
- `P24-DETAIL-CALL-called-light.png` / `-called-dark.png`: same well, same
  session, after clustering. Detail panel: `유전자형 Allele 1 (FAM)` /
  `신뢰도 100%`. The results grid shows `A1 Hom-1` (Allele-1-homozygous, short
  form) — the same call, different label convention (unchanged, pre-existing
  difference in short vs. long genotype labels between the two screens; out
  of this task's scope).

Not captured live: the `confidence === 0` / `confidence === 0.9` sentinel
displays. The standard synthetic demo does not naturally produce a no-signal
well or a <4-well marker region, and constructing one would require either
backend changes (out of scope, needs prior approval) or a hand-crafted
upload file; both new `WellDetailPanel.test.tsx` cases exercise these exact
values directly against the real component and are the evidence for that
part of the fix.

## What was intentionally NOT done

- No new genotype inference was added anywhere. The fix is a subtraction
  (removing the ratio guess) plus a display-only reformatting of the
  confidence cell; nothing computes a call that was not already in
  `manual_type`/`auto_cluster`.
- No backend files were touched (`clustering.py`, `models.py`,
  `result_snapshot.py`, `routers/clustering.py` are all read-only references
  in this task).
- `MultiMarkerAnalysisPanel.tsx`, `CycleControl.tsx`, `navigation-store.ts`,
  `normalize.py`, `ratio_origin.py`, `routers/clustering.py`,
  `routers/data.py`, `playwright.config.ts` were not modified.
- P20's `{data, key}` fetch-staleness structure and the `role="alert"` error
  display in `WellDetailPanel.tsx` are untouched (verified: the P20-STALE-DATA
  regression tests in `WellDetailPanel.test.tsx` still pass unmodified).
