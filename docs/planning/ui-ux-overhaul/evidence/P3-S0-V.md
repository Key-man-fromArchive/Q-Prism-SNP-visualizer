# P3-S0-V — Continuity quality gate

Source: `4d9249ee8e71caa65a388d13ea07b369cd155fa1`; phase base: `35d8a14`. Verification date: 2026-09-07. This document records P3 verification, not deployment or completion of the remaining P4/P5 work.

## Final commands and results

Artifacts: `/tmp/qprism-p3-accepted-gate-2qUrNc` (denoted `$G` below). Commands ran in this worktree's backend/frontend/root as appropriate. Python (`$PY`) was the approved existing P1 venv interpreter, `/mnt/docker/Q-Prism-SNP-visualizer/worktree/ux-followup-p1/snp-analyzer/venv/bin/python`; application source was P3, not P1. No host packages or operating database were used.

| Check | Command / result |
|---|---|
| BE-ALL | `DB_PATH=$G/tests.sqlite COVERAGE_FILE=$G/be.coverage $PY -m pytest --tb=short -q --cov=app --cov-report=json:$G/be.json`: **743 passed + 2 subtests**, 33 warnings, 216.80s |
| FE-ALL | `UX_COVERAGE_DIR=$G/fe-final npm run test:coverage`: **481 passed / 76 files** |
| FE-CHECK | `npm run lint`, `npx tsc -b`, `npm run build`: all exit 0; build 43.89s |
| ROOT-E2E | `npx playwright test 'tests/(18–23 regex)-.*\.spec\.ts' --project=chromium --workers=1 --output=$G/root-results`: **13 passed**, 1.3m; exact regex below |
| EXISTING-E2E | `npm run e2e -- --project=chromium --workers=1 --output=$G/existing-results`: **52 passed**, 3.3m (51 browser cases + authentication setup; includes the P5 cases) |
| JS dependencies | Root and frontend `npm audit --json`: exit 0, **0 vulnerabilities** in both reports |
| Python dependencies | `$PY -m pip check` and `$PY -m pip_audit --format=json`: exit 0, no broken requirements or known vulnerabilities |
| Scoped Ruff | `$PY -m ruff check app/models.py app/routers/clustering.py app/routers/sample.py app/services/import_session.py`: passed |
| Whitespace | `git diff --check`: passed; clean source worktree before this evidence file |

Exact ROOT-E2E regex argument: `'tests/(18|19|20|21|22|23)-.*\.spec\.ts'`.

The BE run was started on `0cf275a`; `git diff 0cf275a 4d9249e --name-only` contains only `frontend/src/components/analysis/AnalysisWorkspace.tsx`. Thus the accepted backend tree is identical. FE, static and browser checks were rerun on final `4d9249e`. Logs are `be.log`, `fe-final.log`, `lint-final.log`, `tsc-final.log`, `build-final.log`, `root-browser.log`, and `existing-browser.log` in `$G`.

Existing screenshot specs write fixed paths, so their **unmodified HEAD tests/config/package** were extracted with `git archive` into `$G/e2e-mirror/snp-analyzer/frontend`, with node_modules linked to the worktree. They tested the final worktree Vite server; generated screenshots and authentication state stayed outside Git. Root tests used private `E2E_ADMIN_USERNAME/PASSWORD`; FE tests used `E2E_USERNAME/PASSWORD`. Both used `E2E_BASE_URL=http://127.0.0.1:15266`; FE also used `E2E_PORT=15266` and `VITE_DEV_API_TARGET=http://127.0.0.1:18266`. Credential values are not evidence.

## Coverage and complexity

Method: intersect `git diff --unified=0 35d8a14 HEAD` added lines with LCOV DA / Python executed-or-missing lines, excluding tests and erased types. New modules are evaluated over their whole executable content. Every executable module passes 70%; FE total **725/760**, minimum **5/7 = 71.4%**. The complete mapping, uncovered line numbers and baseline/current ESLint messages are in `$G/fe-final-metrics.txt`.

| FE module (under `src/`) | Covered / executable |
|---|---|
| App; AnalysisResultStatus; AnalysisTab; AnalysisWorkspace | 18/21; 1/1; 1/1; 3/3 |
| PlateScopeSummary; PlateSetupTab; BatchTab; Header | 7/7; 7/7; 5/5; 1/1 |
| PresetFeedback; SettingsTab; ManualEditStatus; RecoveryNotice | 5/5; 3/3; 4/4; 4/5 |
| WorkspaceRestoreNotice; ImportMappingWizard; RecentSessions | 10/13; 19/23; 5/7 |
| SessionRecoveryFeedback; UploadJobSummary; UploadZone | 5/6; 7/7; 58/73 |
| hooks/use-analysis-workspace; use-keyboard-assignment; use-keyboard-shortcuts | 21/21; 6/6; 7/7 |
| hooks/use-marker-scope; use-owned-operation; use-preset-operations | 27/27; 13/13; 49/50 |
| hooks/use-recent-sessions; use-undo-redo; use-well-type-assignments; use-workspace-location | 29/29; 3/3; 22/22; 14/14 |
| lib/auth-bootstrap; import-job; keyboard-authority; manual-commands | 7/9; 24/26; 3/3; 79/79 |
| lib/plate-analysis-scope; recovery-payload; recovery-reason; session-view-cache | 9/9; 6/6; 3/3; 28/28 |
| lib/upload-jobs; upload-response; workspace-history; workspace-location | 30/30; 9/10; 29/29; 33/33 |
| lib/workspace-ready; workspace-restore; xml-upload | 15/15; 13/13; 35/35 |
| locales/en; locales/ko; stores/auth-store; session-store; undo-store; upload-job-store | 2/2; 2/2; 9/9; 3/3; 18/18; 14/14 |

`types/api.ts` adds no runtime statements. BE `models.py` is 1/1 and `routers/clustering.py` 14/14. `routers/sample.py` and `services/import_session.py` have added dictionary/constructor continuation lines but no separate DA entries (0/0); producer/API and DB-reload tests assert the new inventory values. No new backend module is omitted.

New logical functions are **CC ≤10** using ESLint complexity and Radon against the phase base. `_well_type_snapshot` is CC2; the three well-type routes reduce CC3→1. AnalysisWorkspace is now CC10. Existing large functions are not falsely called compliant: App 36→34, AnalysisTab 25→25, PlateSetup 38→38 (save14, callback11 unchanged), Batch25/15 unchanged, Header28 unchanged, Settings13 unchanged, ImportMappingWizard43 and helpers40/11/12/17 unchanged, UploadZone14→13. The old complex drop callback was extracted into bounded helpers.

Whole-application aggregates are distinct from the changed-code gate: FE **3667/5425 = 67.59%**; BE **5353/7441 = 71.94%**. This is not a claim of 70% whole-FE coverage.

Unrestricted `$PY -m mypy --cache-dir <unique-dir> app` was run against both the final backend and a `git archive 35d8a14` backend under the same interpreter. Both exit 1: **84 errors / 19 files / 72 source files**. Normalizing line/column shifts gives 72 unique diagnostics on each side, **NEW=[]; removed=[]**, recorded in `mypy-comparison.json` and both logs. These are retained typing/stub baseline errors, not a clean mypy pass; no follow-imports or missing-import suppression was used for this comparison.

## Behavioral, security and visual evidence

- ROOT21 proves independent tab URLs, initial session URL publication, whitelist restoration, unconditional cached ROX=false, reload/back/forward without analysis, invalid marker/cycle fallback and missing-session recovery. Focused tests additionally cover owner/entry/latest-request invalidation, storage corruption/error/version, auth bootstrap/StrictMode, local/external 401 and sanitized ASG failures.
- Fresh `P3_BACKEND_PID=4064278 node $G/restart-check.cjs` passed: the harness checked the owned process cwd/port before stopping it, restarted the same temporary SQLite DB, reloaded the **same browser URL**, and asserted the same nonempty `analysis_context.result_revision` and exact assignments, with **zero cluster/suggest POSTs**. DB persistence stores scientific input/result; owner-scoped sessionStorage/URL restore separately restores view/settings. The proof does not confuse those mechanisms.
- ROOT23 asserts exact server manual maps, header/keyboard shared history, success-only pointer, failed undo retention, conflict invalidation/no retry and reload. Unit/API tests cover explicit-equal-imported overrides, immutable max50 history, CAS/no-op/rollback and late owner/session responses.
- ROOT22 exercises failed/empty recent lists and rejected opens/retry, preset success versus failed list refresh, preserved input, partial/unknown upload outcomes, explicit Project navigation, no reupload and logout clearing. Jobs retain allowlisted metadata only; no files, bytes, tokens or raw sample records. Preset storage remains the existing global backend JSON; corruption-read/global-ownership limitations are documented in [S3 evidence](P3-S3-T1.md), not silently redesigned here.
- ROOT20 passes native editing, keyboard ownership, menus/help, grid selection and strict axe **critical/serious=0** assertions. 96-well data are live; 384 geometry is mocked. Generated component/backend fixtures separately cover sparse actual inventory, missing cycle, numerical zero, marker 0/partial membership and independent Empty/Omit exclusions. Existing E2E also passes live marker transitions and Omit recovery. This is not proof of every native instrument format at 384 wells.
- Screenshots actually inspected: `root-results/.../preset-recovery.png`, `upload-recovery.png`, `undo-conflict.png`, ROOT21 restored view, and `$G/after-db-restart.png`. Recovery/status text and result/scope provenance are readable; the restart image shows populated plot/plate and matching saved conditions. A crowded header wraps the logout label at these widths; responsive visual polish remains P4, not full visual/deployment approval. Browser screenshot filenames refer to the exact paths within `$G/root-results`.
- Source/spec reviews previously identified and repaired stale marker scope: `0cf275a` withdraws scope and suspends consumers during pending/failed marker refresh while retaining scientific result state. `4d9249e` groups the shared ready fragment to restore CC10. Held/failing/latest-request DOM regressions pass. Pre-repair gate results are historical and not used as final FE/browser acceptance.

## Cleanup and review

The isolated runtime used loopback only and temporary credentials with mode600. Original API PID4064278, restart API PID4110228 and Vite PID4084556 are absent; ports18266/15266 have no listeners. Browser sessions are finished. Temporary DB, logs, screenshots and private credential artifacts are retained outside Git; no operational data, host services or port8002 were touched.

**P3-S0-V PASS.** Final independent evidence/source/spec/security review by `p2_browser_review`: PASS, no Critical/Important issues. Review confirmed final-source/log attribution, changed-versus-whole coverage, mypy limitations and the actual restart proof. No taskbook/state or product files are changed by this gate.
