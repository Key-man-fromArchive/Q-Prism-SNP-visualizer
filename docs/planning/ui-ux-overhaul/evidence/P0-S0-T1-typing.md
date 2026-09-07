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
