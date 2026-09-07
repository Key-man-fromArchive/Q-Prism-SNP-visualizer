# Coverage and isolation manifest

Contract qprism-ux-followup-20260907-v1. Run from the active Phase worktree only. Full baseline reports do not imply the 70% changed-code gate passed.

## Baseline commands

In `snp-analyzer`, install both requirements into `venv`; verify `venv/bin/python -m pip check`. Set DB_PATH to a fresh temporary directory, not the application's default DB. Run:

```sh
COVERAGE_FILE=/tmp/ux-phase-coverage venv/bin/python -m pytest --tb=short -q --cov=app --cov-report=term --cov-report=json:/tmp/ux-phase-be.json
venv/bin/radon cc app -j > /tmp/ux-phase-complexity.json
```

In the frontend run `npm ci`, `npm run test:coverage`, `npm run lint`, `npm run build` separately and record exit codes. Vitest 2.1.9 uses matching coverage-v8 2.1.9. Default reports live under ignored node_modules/.cache/ux-coverage so lint never scans generated coverage JavaScript; UX_COVERAGE_DIR may select an external phase-specific directory. pypdf inspects PDF text; openpyxl (existing runtime dependency) reads XLSX; stdlib csv reads CSV. Check actual rows and rounded numerical values, not just successful downloads.

## Changed-code gate

Each task records `git diff --name-only <phase-base> HEAD`, then explicitly lists introduced/modified production modules and new executable lines. Missing/unimplemented targets are NOT a passing empty report. Require at least 70% line coverage for each new module and for newly introduced executable lines in modified modules; also report branches/functions and full-project totals without applying an artificial full-project threshold. Use backend coverage JSON `executed_lines`/`missing_lines` and frontend lcov DA entries intersected with added-line ranges (`git diff --unified=0`); save numerator/denominator and unresolved mapping as a gate failure. Excluding difficult production files to raise the metric is prohibited.

| Task group | Mandatory targets (plus all other changed production files) |
| --- | --- |
| P1 persistence/revisions/export | app/models.py, db.py, main.py, processing/analysis_state.py, reporting/result_snapshot.py, changed routers/reporting modules |
| P1 client foundation | src/stores/analysis-store.ts, navigation-store.ts, lib/analysis-context.ts, lib/api.ts |
| P2 result/QC/export/keyboard | changed hooks, analysis panels, QcBadges, chart handles and keyboard widgets |
| P3 continuity | navigation/undo/upload-job stores, restoration hooks, shared manual-type command, changed consumers |
| P4 layout/accessibility | changed components and semantic presentation helpers; browser evidence supplements, does not replace unit coverage |

Example new-module gates, only after those modules exist:

```sh
venv/bin/python -m pytest tests/test_analysis_revision_races.py --cov=app.processing.analysis_state --cov-fail-under=70
npm run test:coverage -- --coverage.include=src/stores/analysis-store.ts --coverage.thresholds.lines=70
```

Complexity: radon JSON for changed Python functions; `npx eslint <changed-ts-files> --rule 'complexity: [error, 10]'` for changed TypeScript functions. Separate preexisting functions from new/changed ones; do not silently waive >10. Data-only files have no executable-line denominator and are explicitly N/A, with schema validation evidence.

## Browser baseline and safety

Root `npx playwright test --list`; frontend `npx playwright test --list`. Representative frontend run: `VITE_DEV_API_TARGET=http://127.0.0.1:<isolated-api> E2E_PORT=<isolated-vite> npm run e2e -- e2e/p4-s0-single-marker-default.spec.ts --workers=1`. Start its own backend with DB_PATH, SNP_AUTH_MODE=local and randomly generated JWT_SECRET_KEY/ADMIN_PASSWORD; supply matching E2E_USERNAME/E2E_PASSWORD. Root helpers use E2E_ADMIN_USERNAME/E2E_ADMIN_PASSWORD instead. Existing helpers already support language-independent login and should be reused; no secret defaults are required for new fixtures. Root old tests target legacy selectors; list/representative failures must identify that compatibility issue rather than weakening tests.

Do not use operational port 8002, operational DBs or shared authentication files. Keep account values, traces/auth state and sample identifiers out of commits. Stop owned servers after tests; artifacts stay in phase-isolated temporary directories or ignored test-results. Record actual command exit status, failure classifications and task ownership before a gate decision.
