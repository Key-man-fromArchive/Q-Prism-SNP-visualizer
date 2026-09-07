# P2-S0-V — Independent correctness gate

## Decision and provenance

PASS, 2026-09-07. Final source `3edae4c3aceb42ff185b451a0a3b7732afe0dca6`, phase base `83887a4`. This accepts P2, not deployment or completion of P3–P5. Existing AGENTS.md preserved. Evaluation and verification-before-completion required real runs and per-module metrics; gate owner made no product/test changes.

Initial gate stopped on App coverage6/11 and new export/chart/workspace functions above CC10. Delegated frontend-only repair changed seven files; final App11/11 and all new logical functions pass. Failed initial measurements are not passing evidence.

Artifacts: `/tmp/qprism-p2-final-gate-mGEtaF/`. Isolated DB/COVERAGE_FILE; approved P1 venv executed P2 source, never host pip. Backend app tree is identical at pre-repair `287ad3f` and final: `0250fb8de7bc60ecf646b3d6b953995e2677e590`; backend tests likewise `3378cd66df96c816203b1f83f3df85e1f5f52e78`. Thus the fresh backend run remains applicable after the frontend-only repair.

## Executed verification

| Check | Result |
| --- | --- |
| `pytest --tb=short -q --cov=app --cov-report=json:…/be.json` | 739 passed +2 subtests,33 existing warnings,168.69s |
| `UX_COVERAGE_DIR=…/frontend npm run test:coverage` | 338 passed /53 files after repair |
| `npm run lint`; `npx tsc --noEmit`; `npm run build` | All exit0; existing Vite bundle warning |
| ROOT18–20 Chromium, workers1 | 5/5 PASS,36.1s |
| Frontend P5 scatter controls Chromium, workers1 | 14/14 PASS including login setup,49.1s |
| npm audit: root, frontend full and production-only | All0 vulnerabilities |
| P1 venv pip check / pip-audit | Consistent /0 known vulnerabilities |
| Ruff on10 changed backend modules | PASS |
| Scoped mypy on10 modules | PASS with explicit `--follow-imports=silent --ignore-missing-imports`;3 unchanged untyped-body notes |
| `git diff --check 83887a4 HEAD` | PASS |

Unrestricted transitive mypy is **not clean**: current64 errors in14 imported files versus67 in14 on an extracted untouched phase-base app. Normalized file/message comparison found no new diagnostic; missing library stubs and existing imported implementation typing remain. `mypy-transitive.log` and `mypy-transitive-baseline.log` preserve the distinction. This is not a strict whole-repository typing pass.

## Coverage and complexity

All58 changed production modules mapped in `coverage-metrics.json`/`.log`, using executable added lines against phase base, or whole new module. Minimum80.6%; erased types/api cycles member is explicitly N/A. Repair-only mapping separately passes, minimum83.3% (`coverage-repair.json`). Whole legacy totals: BE5353/7441=71.94%, FE2850/4969=57.35%. FE branches/functions remain separately in `fe-repair.log`, not claimed as whole-app70%.

ESLint complexity10 checked all changed TS modules against baseline; all **new logical functions** now meet10. Legacy component/render aggregates are not claimed to meet10: App32→36, CycleControl20→22, Header27→28, Settings11→13, Scatter render24→32, Marker render16→21. Exact unchanged/decreased legacy functions also remain in `complexity.json`. New PNG validation/wait/ownership, chart publication, ResultsTable callback and Workspace helpers pass after repair. Backend new resolver CC4; changed route complexity decreases, other legacy graphs unchanged.

## Contract, browser and actual files

ROOT18 reads the actual downloaded CSV:97 lines (header+96 wells), paired A1 reporter values, scope/result revision; persisted group and selected-only filter produce byte-identical whole-run output. ROOT19 exercises KO/EN NTC four-state and flagged/null separation with explicit response fixtures. ROOT20 verifies real96/mocked384 geometry, native input undo, tab/header/grid Shift/arrows/Escape, menu/help focus ownership and button Space without playback; scoped axe critical/serious0.

All five final ROOT screenshots in `root-results/` were visually inspected. Known header overflow and untranslated legacy strings remain P4 work, not a responsive/localization completeness claim. S4 additional inspected smoke `/tmp/qprism-p2-s4-smoke-result.json` confirms pointer parity, WellType focus return, duplicate assignment guard and delayed500 selection retention; global announcement is aria-live, not a claimed visible toast.

Retained S3 files: `/tmp/qprism-p2-s3-{stored,current}.csv`, `qprism-p2-s3-report.{pdf,xlsx}`, `qprism-p2-s3-{stored,marker-stored}.png`. Gate owner inspected both PNGs: nonblank charts and actual scope/cycle/reference/background/revision/time captions. Fresh full BE includes actual PDF/XLSX value/render/security tests plus sparse absolute0/10/40, legacy omitted mode and negative ASG rejection. See [S3 evidence](P2-S3-T1.md) for original file/browser proof. Live ASG save and literal-zero browser export are not claimed; backend/API tests cover them. One earlier uninstrumented stored-PNG timeout was not reproduced in final instrumented smoke repeats; retained as a caveat.

Read-only source review retained auth-before-disclosure, locked detached snapshots, whole-run scope, ASG token separation, stale/legacy/pending rejection, owner/entry/revision publication and cancellation/render identity. Production clustering/suggestion calls are centralized in analysis-actions; explicit suggestion remains separate. No new direct result publisher or security regression identified.

## Remaining scope and cleanup

Native384 parsing is not proven by the geometry fixture. Omit selection policy and shared undo/CAS belong to P3; full responsive/theme/contrast matrix and legacy text cleanup to P4; final integrated matrix to P5. QC onset exact browser text remount limitation remains in [S2 evidence](P2-S2-T1.md); unit/source proof is not mislabeled browser proof.

Owned Vite15264 and browsers stopped; parent backend18264 remains. Credentials/auth state and generated reports not staged. No merge, push or deployment.
