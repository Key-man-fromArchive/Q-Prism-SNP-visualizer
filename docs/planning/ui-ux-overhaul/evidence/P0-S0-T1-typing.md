# P0-S0-T1 — Frontend typing and lifecycle slice

Date: 2026-09-07. Branch: `ux-followup/p0-preflight`.
This is a **partial task delivery**, not a claim that the P0 gate or complete
P0-S0-T1 task has passed. Its commit is reported separately to the orchestrator.

## Scope and approved corrections

- Replaced explicit `any` in assigned API/preset/HWE/project contracts and
  Plotly traces/layout/config with server-derived structures and Plotly types.
  No scientific computation, thresholds, dependencies, or backend code changed.
- HWE's all-null insufficient-data response is a union with its numeric response;
  the existing rendering guard narrows that union without defaulting null to zero.
- Plotly axis titles use the current typed `{ text }` shape. Overlay/compare
  cleanup captures the actual plot element; detail's React 19 callback ref also
  cleans a plot first mounted after selecting a well, not only at initial mount.
- Hook dependencies include translated presentation values. Effect events read
  error messages/initial-load callbacks without forcing locale changes to reload
  editable protocol state or clear a batch selection. No lint rule was disabled.
- Parent approved two contract defects discovered while removing `any`:
  project summary uses server `genotypes`, `ntc_count`, and `unknown_count` for
  the plate table, totals, and CSV through one typed helper; unsupported preset
  algorithms are rejected visibly **before any settings are applied**. The
  SettingsTab scope was explicitly expanded for that guard only. Its short KO/EN
  error is local to the guard; broader locale consolidation remains UX-09.

## RED / GREEN evidence

1. `plot-cleanup.test.tsx`: original lifecycle yielded **2 failed** assertions
   (purge never called after overlay unmount/detail deselection). Corrected
   captured-node cleanup yields **2 passed**.
2. `SettingsTab.test.tsx`: original auto preset changed the threshold-only store
   to `auto` (**1 failed**). Guard preserves algorithm and ROX and shows an alert;
   rejection plus threshold/kmeans/unspecified acceptance now **4 passed**.
3. `BatchTab.test.tsx`: regression was rerun against the original HEAD component
   using reversible, scoped patches. Server counts 12/7/8/2/1 rendered as
   0/0/0/0/0 (**1 failed**). Restoring the correction yields **1 passed**.
   `project-summary.test.ts` adds two normal/missing-plate mapping checks. Its
   initial missing-helper import failure is not claimed as behavioral RED;
   the component regression above supplies the actual defect evidence.

## Fresh verification

From `snp-analyzer/frontend`:

- `npm run lint`: exit 0, no errors/warnings. Initial assigned-slice baseline
  was 18 errors and 10 warnings.
- `npm run build`: exit 0, 1810 modules, 32.96s. Existing large-bundle warning
  remains (Plotly-containing JS chunk about 5.51MB); not hidden or waived.
- `npm run test`: latest **72 passed / 14 files**, 1.78s. This combined worktree
  count includes the concurrent state/lifecycle specialist's tests.
- `./node_modules/.bin/tsc -b --pretty false`: exit 0 after final added tests.
- Focused new tests: **9 passed** (2 cleanup, 4 preset, 2 mapping, 1 batch UI).
- `UX_COVERAGE_DIR=/tmp/qprism-p0-typing-coverage npm run test --
  src/components/batch/project-summary.test.ts src/components/settings/SettingsTab.test.tsx
  src/components/analysis/plot-cleanup.test.tsx src/components/batch/BatchTab.test.tsx
  --coverage --coverage.include=src/components/batch/project-summary.ts
  --coverage.reporter=text`: new shared helper **100% statements/functions/branches**
  (1/1 statement/function, 10/10 branch outcomes). That run included 6 tests,
  before adding the three supported-preset cases; latest full test run includes all 9.
- Helper complexity check: `./node_modules/.bin/eslint
  src/components/batch/project-summary.ts --rule 'complexity: [error, 10]'`: exit 0.
- `git diff --check`: exit 0.

Coverage above is **only the new helper**, not the entire changed large legacy
components or changed-line coverage. Types erase at runtime. Full task/Phase
coverage and browser regression remain integration-gate responsibilities. No
generated static build, dependency files, other agent edits, or canonical task
statuses belong to this slice's commit.

## Independent gate correction — execution coverage and complexity

The gate correctly rejected helper-only coverage as insufficient for newly
introduced component execution paths. Added tests now open the amplification
overlay and assert Plotly axis objects, plot and unmount comparisons, handle
session-list rejection, read the **actual downloaded CSV Blob** including totals,
and reject delayed protocol/statistics requests after changing EN→KO. The latter
assert current-language errors and exactly one request, not a locale-driven
refetch. A numeric HWE response exercises the narrowed rendering path.

Extracted `apply-preset.ts`: validation precedes every setter; unavailable
backgrounds are skipped; zero/false and absent values retain their prior meanings.
Four helper tests cover full/empty/unavailable/unsupported cases. The existing
preset component tests remain green. This is a behavior-preserving refactor plus
coverage repair; no new product defect was introduced or claimed as RED.

Fresh commands after all source corrections:

```bash
UX_COVERAGE_DIR=/tmp/qprism-p0-typing-gate npm run test:coverage
npm run lint
./node_modules/.bin/tsc -b --pretty false
./node_modules/.bin/eslint src/components/settings/apply-preset.ts --rule 'complexity: [error, 10]'
```

Results: **103 passed / 19 files**, coverage run 2.68s; lint and compiler exit 0.
Full-worktree coverage is **25.93% statements (1368/5275), 25.38% lines
(1130/4451)**, not a claim that legacy code meets 70%. The earlier build result
above predates this helper refactor; final production build belongs to integration.
Existing Compare UI hides the error when fewer than two sessions are available;
its rejection test asserts handling, not a new visible error affordance (UX-05).

### Added executable line mapping

Compared `git diff 80c2c8a --unified=0 -- snp-analyzer/frontend/src` with fresh
`/tmp/qprism-p0-typing-gate/lcov.info` SF/DA entries. New untracked helper files
were evaluated in full. Each listed line has a positive DA count:

| File under src/components | New executable lines | Covered |
| --- | --- | --- |
| analysis/AmplificationOverlay.tsx | 84,114,116 | 3/3 |
| analysis/WellDetailPanel.tsx | 20–26,103 | 8/8 |
| batch/BatchTab.tsx | 132,133,310–312 | 5/5 |
| compare/CompareTab.tsx | 31,41,75,118,147,150 | 6/6 |
| protocol/ProtocolTab.tsx | 42,55 | 2/2 |
| statistics/StatisticsTab.tsx | 16,31,90,91 | 4/4 |
| settings/SettingsTab.tsx | 18,19,23,28,84,88 | 6/6 |
| settings/apply-preset.ts | 10–14,18–21,28–32,34–37 | 18/18 |
| batch/project-summary.ts | 7 | 1/1 |

Erased-only type annotations excluded: Overlay 53,62; detail 73,88; Batch 329;
Compare 81,99,141; Protocol 75; API types/signatures. Hook dependency-array-only
edits have no separate added DA statement; they are not falsely counted as
covered source lines. All mapped new logic in each file exceeds 70% independently.

ESLint's actual complexity reporter (`complexity: [warn, 0]`) measures:
`applyPreset=8`, `applyPlotSettings=6`, `applyThresholdSettings=5`,
`handleApplyPreset=4`, `PresetError=2`. SettingsTab root returns to **11**, exactly
its original baseline, by isolating the new error rendering decision; unchanged
legacy root complexity is not disguised as a newly passing ≤10 function.
