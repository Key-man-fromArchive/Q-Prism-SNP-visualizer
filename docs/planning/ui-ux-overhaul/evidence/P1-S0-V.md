# P1-S0-V — Contract and server phase gate

## Verification scope

**PASS — P1 server/contract foundation and existing no-crash browser compatibility only**, 2026-09-07. This is not QC UI acceptance or deployment approval: the P2 follow-up below remains required for final product acceptance. Source commit `5672e63cb8f05030c2de5ca787cbac75c5658c31`; cumulative phase baseline `0bd509`. All commands ran in `worktree/ux-followup-p1` using its venv and existing frontend dependencies. No source/test changes, operational database, external ASG post, host installation, merge or push.

Artifacts: `/tmp/qprism-p1-final-gate-RoEG71`. The existing isolated runtime uses loopback API 18263 and a separate temporary database; test credentials are not recorded here.

## Fresh commands and results

From `snp-analyzer`, with `DB_PATH`, `COVERAGE_FILE` and `UX_REPORT_ARTIFACTS` set to unique paths within the artifact directory:

```sh
venv/bin/python -m pytest --tb=short -q --cov=app --cov-report=json:/tmp/qprism-p1-final-gate-RoEG71/be.json
venv/bin/python -m pip check
venv/bin/pip-audit --progress-spinner off
venv/bin/radon cc app -j
```

BE: **710 passed, 2 subtests passed, 33 warnings**, exit 0, 185.95 seconds (`be.log`). Dependency consistency and audit passed with no known vulnerabilities. Scoped Ruff passed all 19 changed Python modules; scoped mypy passed 18 modules with `--follow-imports=silent --ignore-missing-imports` (charts excluded from typing scope, three unchanged untyped-body notes). This is not strict whole-repository typing.

From `snp-analyzer/frontend`, separately:

```sh
UX_COVERAGE_DIR=/tmp/qprism-p1-final-gate-RoEG71/frontend npm run test:coverage
npm run lint
npm run build
npm audit --json
```

All exited 0: **167 tests / 24 files**, zero lint errors, successful TypeScript/Vite build, zero npm vulnerabilities. Existing large Plotly bundle warning remains visible in `build.log`.

## Cumulative coverage

`metrics.py` intersects added diff lines against `0bd509` with coverage.py executable lines or LCOV DA entries; new modules use whole-module executable lines. `metrics.txt` retains exact denominators and uncovered lines. Every executable target independently exceeds 70%; no production module was dropped.

| Backend module (`app/`) | Covered / gate lines |
| --- | ---: |
| asg_result.py | 42/45 |
| db.py | 30/31 |
| models.py | 34/34 |
| processing/analysis_state.py (new) | 119/119 |
| processing/ntc_detection.py | 20/20 |
| reporting/charts.py | 3/3 |
| reporting/result_snapshot.py (new) | 178/181 |
| reporting/snapshot_pdf.py (new) | 71/72 |
| reporting/snapshot_plate.py (new) | 20/20 |
| reporting/snapshot_presentation.py (new) | 40/40 |
| reporting/snapshot_xlsx.py (new) | 66/67 |
| routers/asg.py | 5/5 |
| routers/clustering.py | 135/138 |
| routers/data.py | 7/7 |
| routers/export.py | 38/38 |
| routers/layouts.py | 3/3 |
| routers/marker_catalog.py | 8/8 |
| routers/qc.py | 143/143 |
| routers/sample.py | 20/20 |

FE: new `lib/analysis-context.ts` **79/79**, new `stores/analysis-store.ts` **33/33**, new `stores/navigation-store.ts` **51/51**; added `lib/api.ts` **40/40**. `types/api.ts` is type-only, N/A. Font/license assets are non-executable. `main.py` is a manifest inspection target but unchanged against the phase baseline, not a missing implementation.

Uncovered gate lines: ASG 27/30/32; DB 286; snapshot 83/100/140; PDF 75; XLSX 36; clustering 388/411/415. Fresh whole-backend coverage is separately 5333/7424 (71.83%); whole FE is 1454/4612 lines (31.52%), 1262/3833 branches and 546/1709 functions. Backend collection is line-only, not exhaustive branch coverage.

## Complexity and integration review

Fresh Radon comparison (`cc-comparison.txt`) and scoped ESLint (`fe-cc.json`) confirm new logical units <=10. Legacy >10 units are reported separately: DB migrations/save/load 15/16/20; NTC helpers 17/12/11; clustering helpers 16/11/16; amplification 11; QC separation 16. Their decision counts are unchanged. Layout application remains 18 versus baseline 21: existing validation graph is retained, old mutation branches removed, new transaction logic delegated to bounded helpers. This is not a claim that every legacy function meets ten.

Read-only combined review found no remaining blocking authentication, publication, mutation or export boundary issue. Access checks precede revision/result disclosure; commit/rollback precedes memory publication; latest failed/cancelled requests cannot publish older work; deletion and object identity invalidate in-flight results. Input mutation and persistence tests cover migration idempotence, child preservation, rollback and lifespan restoration. Export adapters use one detached authorized snapshot; ASG ownership/linkage/scope and multi-marker rejection precede capture, and rejected saves never post. See P1-R1-T1/T2/T3, P1-R2-T1 and P1-R3-T1/T2 evidence for contract assertions and reviewed PDF rendering.

Foundation review verified existing ApiError identity, import 409/422 compatibility, missing/legacy context guards, current-versus-captured revision semantics, and explicit zero/false request options. P1 supplies reusable ownership/state primitives; actual analysis/QC and URL/App wiring remains explicitly P2/P3 scope, not completed UI functionality.

Deployment guarantee is **single-process only**, documented in `processing/analysis_state.py`, `reporting/result_snapshot.py`, appendix section 1 and P1-R1-T3 evidence. Multi-worker/replica coordination and legacy writers outside the lock are not covered; no startup enforcement is claimed.

## Browser evidence

Independent browser run against the same source: `npx playwright test e2e/p5-scatter-view-controls.spec.ts --project=chromium --workers=1 --output=/tmp/qprism-p1-browser-results`, using isolated Vite 15263/API 18263 and private credential loading: **14 passed**, 1.0 minute. `/tmp/qprism-p1-browser-smoke.cjs` additionally passed empty/loading/injected-error/recovered-normal assertions; zero page errors and one expected injected HTTP 500 console error. Screenshots include `/tmp/qprism-p1-analysis.png` and matching empty/loading/error images. The browser worker stopped its Vite; backend remains parent-controlled.

**Required P2 follow-up, not waived UI correctness:** settled analysis screenshot shows header call rate 0%/NTC warning despite completed plot calls/no-contamination caption. Parent visually reviewed all four screenshots and confirmed the discrepancy. Source diagnosis found unchanged `QcBadges` refresh dependencies only include session/cycle/reference/background, not completed result revision: the badge retains a pre-analysis response. The P1 server correctly returns zero when no completed judgment exists rather than inferring calls from a provisional view. Authenticated completed, matching isolated synthetic runs returned verified current/captured revision 0 and 92/96 (95.83%) call rate, preserving legacy Empty/Omit counting. `getQc` forwards the response without numerical adaptation. The exact screenshot session ID was not recorded; these API diagnostics are **not claimed to be bound to that exact image**.

The NTC warning and onset caption also represent different evaluations: the warning can legitimately exceed the existing threshold with many empty wells, while the unchanged caption equates absent onset with no contamination. This is the already specified PRD F13/UX-01 distinction, not a newly introduced wire failure. P2-S1/S2 must connect result-driven QC refresh and distinguish onset/plate QC semantics before final UI acceptance/deployment. The P1 gate accepts the correct server contract and no-crash compatibility, not those unfinished UI semantics.

Verification Before Completion and Evaluation skills required fresh execution, per-module cumulative metrics and separation of historical evidence from this phase decision.
