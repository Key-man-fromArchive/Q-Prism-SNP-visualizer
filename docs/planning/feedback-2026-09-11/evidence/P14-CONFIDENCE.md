# P14 — Confidence/genotype table renders blank after auto-clustering

Branch: `feedback/p14-investigate`, based on main `b96062a`.

## Verdict: real bug, confirmed and fixed

The report was correct. On a **fresh session's automatic clustering** (the
`#example-select` fixture flow, and any fresh file upload that doesn't
navigate to a different cycle), `scatterPoints` never picked up the
clustering result's per-well call (`auto_cluster`) or `confidence`. The
Confidence and genotype columns in `WellDetailPanel` and `ResultsTable`
read exclusively from `scatterPoints`, so they stayed blank/undetermined
forever, even though the backend had already computed and cached the real
calls and confidences.

## Reproduction path

1. Log in, select the `2x` example (`#example-select` → `selectOption('2')`),
   wait for the clustering POST to resolve.
2. Click well **A1** (a real sample well, not NTC/Empty).
3. Before the fix: Confidence cell renders `—`, in **both** English and
   Korean UI locale. Genotype falls back to the raw 0.6/0.4 ratio heuristic
   (ploidy 2 only) or `Undetermined`/`미결정` for other ploidies, instead
   of showing the actual cluster call.
4. After the fix: Confidence renders `100%`, Genotype renders
   `Allele 1 (FAM)` — the real clustering result.

This was verified live against a real backend/frontend build (port 8196,
`/tmp/p14.db`), not just by reading code:

- Reverted the fix locally (`git apply -R`), rebuilt (`npm run build`), and
  confirmed the `#example-select` flow produced Confidence = `—` for A1.
- Reapplied the fix, rebuilt, and confirmed Confidence = `100%` for the same
  well, in both `ko` (default) and forced `en` locale (`localStorage`
  `snp-analyzer-language` = `en`).

The same code path (`useAnalysisWorkspace`'s `analyzeFreshSession` →
`analyzeCurrent`, no `navigate()` call) also runs for a plain file upload
that doesn't need a cycle recommendation, so the bug was not
`#example-select`-specific; it is general to "fresh session, auto-cluster,
no manual edit, no cycle change" runs. The existing `05-interactions.spec.ts`
CFX-upload test happened to still show a real Confidence value even before
the fix, because in that timing the `GET /scatter` request that mounts
`ScatterPlot` happened to resolve *after* the clustering `POST` had already
cached confidences server-side — this is a race, not a guarantee, which is
exactly why the `#example-select` path (and presumably some real uploads,
depending on network/DB timing) could reproduce reliably while others did
not.

## When backend `confidence: null` is legitimate (not a bug)

Backend `app/routers/data.py` fills each scatter/plate point's `confidence`
from `cluster_store[sid].confidences.get(well)`, which only has entries for
wells that were actually scored:

- `app/processing/clustering.py`'s `boundary_confidences`/`cluster_auto`
  never assign a confidence to a well with no signal above
  `ntc_threshold` for the manual-boundary path, and NTC/no-call wells only
  get a confidence when clustering (or a fixed-control override) actually
  produced one.
- Live-checked against the `2x` example (`POST /api/data/{sid}/cluster`):
  40 of 96 wells got a confidence; the other 56 are `sample_name: "Empty"`
  wells that were never part of clustering at all (`auto_cluster: None`,
  `confidence: None`) — these are unused plate positions, not real samples.
  The 4 NTC wells in this example did get `confidence: 1.0` (fixed-control
  override), so "NTC" alone is not what makes a well blank.

For an `Empty` well, `confidence: —` is correct and should stay that way —
there is no cluster-based confidence to show. See
`docs/planning/feedback-2026-09-11/evidence/P14-CONFIDENCE-legitimate-blank-{light,dark}.png`
(well D5, sample "Empty"): Confidence is `—`. Note the genotype cell still
shows a raw-ratio-derived guess ("Heterozygous") for this ploidy-2 example
even with no cluster call — that is `WellDetailPanel`'s existing (pre-dating
this task) raw-ratio fallback for diploid wells with no `auto_cluster`; it
is a separate, already-documented design decision (the code comment above
it explains the fallback is deliberately diploid-only) and out of this
task's scope. The dash convention itself (`—` = "no value", distinct from a
transient loading state that self-resolves as soon as the projection runs)
already matches how this app renders a missing `sample_name` elsewhere, so
no new display treatment was needed for the legitimately-blank case.

## When this broke

Not a recent regression from P7/P10/P12. The confidence feature itself
(`2d3dd0c`, 2026-07-07, "feat: per-call genotype confidence score") added
`confidence` to `ScatterPoint`/`PlateWell` and to the scatter/plate
endpoints, but never added any mechanism to push a completed clustering
result's `confidences` (or even `assignments`) back onto already-loaded
`scatterPoints` — it relied on `WellDetailPanel`/`ResultsTable` reading a
scatter response that already had a stored assignment, i.e. it implicitly
assumed the clustering had *already run* before the client asked for
scatter data. The Sept 7 2026 versioned-analysis-state refactor
(`8c6c08d`, P2-S1-T1) did not change this gap either — the pre-refactor
`AnalysisTab.tsx` only called `setClusterAssignments(result.assignments)`
(plateWells only), same as the post-refactor `analysis-projection.ts`. The
gap has existed, unnoticed, since the confidence feature's introduction;
`result.confidences` was **never read anywhere in the frontend** before this
fix (`grep -rn "\.confidences\b" src` returned nothing).

## Fix

`snp-analyzer/frontend/src/stores/data-store.ts`:
`setClusterAssignments` now also takes an optional `confidences` map and
merges **both** `assignments` and `confidences` onto `scatterPoints` (not
just `plateWells`, which is what it already did for `auto_cluster` alone).
A well missing from `assignments`/`confidences` is reset to `null` for both
fields — same "assignments are authoritative" semantics the existing
`plateWells` merge already used, just extended to the table the code the
components actually read from, and to `confidence`.

`snp-analyzer/frontend/src/lib/analysis-projection.ts`: passes
`result?.confidences ?? null` through to `setClusterAssignments`.

This makes the Confidence/genotype tables update immediately and reactively
the moment a clustering result is accepted — no scatter refetch, no
`analysis-result-changed` event dance required — which also removes the
race described above for every caller, not just the lucky ones.

## Sibling tables checked

Only three components read `confidence`/`auto_cluster`, and all three read
them off `useDataStore`'s `scatterPoints` (confirmed via
`grep -rln "confidence\b" src/components`):

- `WellDetailPanel.tsx` (Confidence row, genotype row) — fixed by this change.
- `ResultsTable.tsx` (genotype grid, confidence in the hover title) — fixed
  by this change (same store field).
- `ScatterPlot.tsx` (hover tooltip) — fixed by this change (same store
  field); also `MultiMarkerAnalysisPanel.tsx` feeds off the same
  `scatterPoints`, so it is covered too.

`plateWells.confidence` was also always `null` (same missing-merge bug,
one layer removed) even though nothing currently reads it; fixed
symmetrically for future-proofing since the fix was already touching that
exact line.

## Test debt fixed

The store-level regression test (`analysis-projection.test.ts`) previously
only asserted `clusterAssignments`/`boundaries`/`offset` after `accept()` —
never `scatterPoints`, which is what the UI actually reads. Added a new
test that seeds `scatterPoints` with two wells, accepts a clustering result
with `assignments` + `confidences` for only one of them, and asserts:
the addressed well's `auto_cluster`/`confidence` are updated to the new
values, and the other well's are reset to `null` (not left stale). This
was RED against the pre-fix code (`expected null to be 'Allele 1 Homo'`)
and is GREEN after the fix.

Component-level unit tests (`WellDetailPanel.test.tsx`,
`ResultsTable.keyboard.test.tsx`) already asserted actual confidence values
(`'95%'`, `0.9`) — but only by directly seeding `scatterPoints` with a
`confidence` already set, bypassing the real projection code path entirely.
They could not have caught this bug because they never exercised the
`analysis-store` → `analysis-projection` → `data-store` pipeline. The new
`analysis-projection.test.ts` case is what closes that gap.

Added two E2E assertions in `tests/05-interactions.spec.ts`:
- Strengthened the existing "detail table shows FAM and HEX values" test
  (CFX upload) to assert the Confidence row contains a `%` and not `—`,
  instead of just checking FAM/HEX/Genotype/ratio labels are present.
- Added a new test using the exact reported repro path
  (`#example-select`, fresh auto-cluster, no manual edit, no cycle change):
  asserts Confidence shows a percentage and Genotype is not
  `Undetermined`/`미결정`.

## Verification

Frontend (worktree `snp-analyzer/frontend`), final state:

```
npx tsc --noEmit   → clean
npm run lint       → 0 errors/warnings
npm run test       → 124 files / 907 tests passed (baseline 124/906; +1 new test)
npm run build      → tsc -b + vite build succeeded
```

E2E, backend on port 8196 (`DB_PATH=/tmp/p14.db`, cleaned up after):

```
npx playwright test <all specs except 17-manual-group-and-plate-drag.spec.ts>
→ 136 passed, 0 failed
```

(`17-manual-group-and-plate-drag.spec.ts` is explicitly excluded — it has a
known, unrelated NTC-corner race owned by another agent in
`worktree/feedback-p13`; not touched.)

Live verification, not just unit tests:
- Reverted the fix (`git apply -R`), rebuilt, confirmed `#example-select` →
  A1 → Confidence `—` (bug reproduces).
- Reapplied the fix, rebuilt, confirmed the same flow → Confidence `100%`.
- Confirmed in both `ko` (app default) and forced `en` locale.
- Confirmed the legitimate-blank case (well D5, sample "Empty") still shows
  `—` after the fix — the fix does not fabricate confidence for wells that
  were never clustered.

## Visual evidence

- `P14-CONFIDENCE-filled-light.png` / `-dark.png` — well A1, Confidence
  `100%`, Genotype `Allele 1 (FAM)`.
- `P14-CONFIDENCE-legitimate-blank-light.png` / `-dark.png` — well D5
  (sample `Empty`), Confidence `—`.

## Files touched

- `snp-analyzer/frontend/src/stores/data-store.ts` — `setClusterAssignments`
  now merges `confidences` too, onto both `plateWells` and `scatterPoints`.
- `snp-analyzer/frontend/src/lib/analysis-projection.ts` — passes
  `result.confidences` through.
- `snp-analyzer/frontend/src/lib/analysis-projection.test.ts` — new
  regression test (assertion strengthening, nothing weakened/removed).
- `tests/05-interactions.spec.ts` — strengthened one assertion, added one
  new E2E test (assertion strengthening only).
- `docs/planning/feedback-2026-09-11/evidence/P14-CONFIDENCE.md` (this file)
  and four screenshots.

No backend changes. No changes to `worktree/feedback-p13`. No shared stash
used (a `git apply`/`git apply -R` round trip was used instead, to test the
pre-fix behavior without touching the shared stash stack).
