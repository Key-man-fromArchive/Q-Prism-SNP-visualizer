# P0-S0-V — Preflight and ICV gate

## Current resumed decision — PASS, 2026-09-07

Reviewed final delivery `e9c9b1d5fdb4f608d424a66cca4f0bd078a36a56`, including
backend `009a762`, typing repairs `b969b5d`/`723b551`, and frontend lifecycle
repairs `651fbc4`/`a11ece1`. All four prerequisite tasks have committed delivery
and are DONE in the orchestrator-owned task book. P0 may be integrated locally
and P1 may start after that integration; this is not approval of P1–P5 features,
remote push, deployment, or external notifications.

The earlier BLOCKED outcome below remains an accurate historical record. User
approval expanded prerequisite remediation scope; failures were fixed and
retested, not waived. Verification → evaluation → code review → security →
frontend evidence review found no remaining important P0 issue. A preliminary
aggregate frontend coverage result was rejected because AnalysisTab individually
had 0/3 new executable lines covered. The final component regression now covers
all three, including valid assignment and invalid-input rejection.

### Independently checked evidence

| Check | Result |
| --- | --- |
| Backend complete suite, unchanged since backend repair | 502 passed, 2 subtests passed; 54.97s, exit 0 |
| Backend full coverage | 4,678/6,844 = 68.35%; reported baseline, not a whole-project 70% pass |
| Changed auth.py | 114/151 = 75.50%; all changed executable lines covered; complexity 8 |
| Synthetic fixtures | 25 passed; 35/35 lines, 100%; complexity maximum 9; Ruff/mypy pass |
| Final frontend instrumented complete suite | 105 passed, 20 files; 4.48s, exit 0 |
| Final frontend full coverage | Lines 1,217/4,451 = 27.34%; statements 28.18%, branches 26.06%, functions 26.94% |
| Frontend lint and TypeScript | Both exit 0 after final assignment-test commit |
| Production build | Exit 0, 1,813 modules, 33.89s; subsequent commit adds tests/evidence only |
| Python audit | No known vulnerabilities; no exemptions; pip check previously verified clean, requirements unchanged |
| npm full and production audits | Both independently return 0 advisories in every severity category |
| DAG/ICV | 33 unique IDs; every dependency exists and precedes consumer; all Write Scopes present |

The new-module and per-modified-file gate is separate from full legacy totals.
Raw new-side diff/LCOV intersections versus `80c2c8a` are **139/147 (94.56%)**:

| Production file (under frontend/src) | Covered / added instrumentable lines |
| --- | --- |
| components/analysis/AmplificationOverlay.tsx | 5/5 |
| components/analysis/AnalysisTab.tsx | 3/3 |
| components/analysis/ScatterPlot.tsx | 46/54 |
| components/analysis/WellDetailPanel.tsx | 10/10 |
| components/batch/BatchTab.tsx | 6/6 |
| components/batch/project-summary.ts | 1/1 |
| components/compare/CompareTab.tsx | 9/9 |
| components/layout/Header.tsx | 11/11 |
| components/protocol/ProtocolTab.tsx | 3/3 |
| components/quality/QualityTab.tsx | 6/6 |
| components/settings/SettingsTab.tsx | 6/6 |
| components/settings/apply-preset.ts | 18/18 |
| components/statistics/StatisticsTab.tsx | 4/4 |
| lib/plot-coordinates.ts | 10/10 |
| lib/well-type-input.ts | 1/1 |

This raw proxy also captures existing statements with erased type-only edits.
Manual classification excludes Overlay 53/62, detail 73/88, Batch 329, Compare
81/99/141, Protocol 75; their runtime-only counts remain respectively 3/3, 8/8,
5/5, 6/6, 2/2. Scatter type-only declarations/callback annotations are at
277/379/436/462/481/490/592/746; even conservatively removing all eight covered
entries leaves **38/46 = 82.61%**, above the per-file gate. No uncovered runtime
line was discarded. CycleControl dependency-only edits and upload/API type-only
edits have no added executable DA denominator; runtime behavior is checked by
playback, upload baseline, and consumer tests, not an invented empty coverage pass.
New helpers each have 100% line coverage. Browser evidence does not substitute
for these unit coverage measurements.

### Complexity and review disposition

Measured ESLint complexity for new logical units: axisPosition 8, clientPoint 3,
textCustomdata 2, parseWellType 1, applyPreset 8, plot settings 6, threshold
settings 5, ASG presentation hook 4, boundary hook 2, scatter-status hook 4;
the extracted preset callback and narrowed coordinate callback also satisfy 10.
Existing unchanged decision graphs remain separately visible: Header 27,
ScatterPlot root 19, its click callback 11, SettingsTab root 11; other legacy
large render/analysis functions retain their baseline values. Running complexity
10 over whole legacy files still reports these; this report does not mislabel
that command as globally passing. New decisions were extracted into bounded,
tested units, not suppressed with lint exceptions or timers.

Reviewed actual settled image `/tmp/qprism-p0-ui-analysis-settled.png`: genotype
colors agree across scatter, plate and result rows. Specialist's post-repair
Playwright run reports 14 passing existing auth/scatter tests in 49.3s and
settled trace counts 12/12/12/4 with no uncaught browser errors; this reviewer
inspected image/evidence, not a second browser run. The early transitional image
is not used as scientific proof. Quality failure rendering is separately
recorded in P0-S0-T1. Known header QC mismatch, tall layout and later UX contracts
remain P1–P5 scope. Large bundle and existing dependency/short development-key
warnings remain visible; no policy weakening or blanket security claim.

PRD hash remains `973f3ebcb3ed18abdadfc9930939e0a313298cfdf863e126383b0845d012aad4`.
Appendix remains prospective: nullable legacy context, mutation inventory,
snapshot/CAS publication, error envelope, ownership and restoration agree with
PRD. No consumer is assumed to have future result-context fields already.

Reproduction: from frontend, run `UX_COVERAGE_DIR=/tmp/qprism-p0-independent-final
npm run test:coverage`, `npm run lint`, `./node_modules/.bin/tsc -b --pretty false`,
`npm run build`, `npm audit --json`, and `npm audit --omit=dev --json` separately.
Parse added new-side ranges from `git diff 80c2c8a --unified=0` and intersect with
LCOV SF/DA records, then explicitly classify erased type changes as above.
Use ESLint's `complexity: [warn, 0]` to read actual function scores and compare
baseline source with `git show 80c2c8a:<path>`, not only overall command exit.
Backend commands remain those recorded below, with isolated DB_PATH and
COVERAGE_FILE. Final independent artifacts:
`/tmp/qprism-p0-independent-final/`, `/tmp/qprism-p0-resume-gate-be.json`,
`/tmp/qprism-p0-resume-gate-audit.json`, and
`/tmp/qprism-p0-independent-npm-{audit,prod-audit}.json`.
No operational database, port 8002, host interpreter, or private data was used.

## Historical blocked decision — retained verbatim below

Date: 2026-09-07. Contract: `qprism-ux-followup-20260907-v1`.
Decision: **BLOCKED — do not merge P0 or start P1**. Recording this decision
does not mark the gate task DONE or waive any requirement.

## Reviewed baseline and contracts

- Phase branch/worktree: `ux-followup/p0-preflight`, `worktree/ux-followup-p0`.
- Baseline `80c2c8a24e51c1707b12d06b07f0bf83eb18090a`; reviewed preparation
  `9f519ae86cc430c819ee49dbb2bf7b2913a0aefa` and fixtures
  `d6345b66f7780a9d1185f3f7ccd73cab30c51095`.
- Independently reviewed fixture correction
  `77010b0d9956fba11e3547bf21935c953b50b4ca` after the full baseline run.
- PRD SHA-256: `973f3ebcb3ed18abdadfc9930939e0a313298cfdf863e126383b0845d012aad4`.
  Canonical status/scope edits are orchestrator-owned and remain separate from
  this evidence commit; runtime state records their final hash.
- Parsed 31 unique task IDs: every dependency exists and precedes its consumer;
  no cycles, missing dependency declarations or missing Write Scope fields.
  P0's independent document/config and fixture ownership is disjoint. Subsequent
  shared product-file writes are serialized by the DAG.
- Appendix agrees with PRD on nullable legacy context, immutable snapshots,
  input/result revisions, latest-result publication, QC uncertainty, keyboard
  ownership, restoration and limited undo. It explicitly describes future
  contracts, not implemented fields. Resource tasks precede consuming UI tasks.
- Found attach-catalog revision ownership missing from P1-R1-T2; orchestrator
  added `marker_catalog.py` to that task's Write Scope before this handoff.
- Synthetic fixtures supply 96/384 wells, absolute windows, two ploidies,
  independent 20/40 numerical oracles, supported background/ROX combinations,
  NTC uncertainty, legacy payload and named failure schedules. Their expected
  future API outcomes are not falsely asserted as present product behavior.

## Fresh verification

Verification-before-completion, evaluation and code-review were applied in
that order; security disposition is separately attributed below. No product
source or UI changed in P0, so new production-line coverage and visual review
are N/A, not passing empty reports. Fixture executable quality is separate.

| Check | Observed result |
| --- | --- |
| Isolated BE full suite on d6345b6 | **478 passed**, 2 subtests passed, 3 dependency deprecations; exit 0, 53.10 s |
| BE full coverage | 4,673/6,842 lines = **68.299%**; existing baseline, not a 70% gate pass |
| FE `npm run test:coverage` | **53 passed**, 6 files, exit 0; lines 18.01%, branches 72.62%, functions 23.54% |
| FE `npm run lint` | **FAIL**, exit 1: 32 errors, 14 warnings in existing product files |
| BE `venv/bin/python -m pip check` | Exit 0, no broken requirements |
| Corrected fixture focused suite and coverage | **25 passed**, exit 0, 1.23 s; **35/35 statements (100%)** |
| Corrected fixture `radon cc ... -s` | Exit 0, maximum complexity **9** (other functions 6/6/4/3/1) |
| Fixture ruff/mypy availability | Both unavailable (`No module named ...`); no static-check success claimed |
| Independent orchestrator build | `npm run build`, exit 0, 32.14 s; bundle-size warning only |
| Prior representative browser evidence | P0-T0.1: 4 passed; root 58/FE 51 tests listed, **not full E2E execution** |

Reproduction for the full BE run, from `snp-analyzer`:

```sh
gate_tmp=$(mktemp -d /tmp/qprism-p0-gate.XXXXXX)
DB_PATH="$gate_tmp/test.sqlite" COVERAGE_FILE="$gate_tmp/.coverage" venv/bin/python -m pytest --tb=short -q --cov=app --cov-report=term --cov-report=json:"$gate_tmp/coverage.json"
```

Coverage artifact: `/tmp/qprism-p0-gate.pXhfn1/coverage.json`. FE reports:
`snp-analyzer/frontend/node_modules/.cache/ux-coverage/`. No operational database,
server, private samples or credentials were used. The full suite ran before the
fixture complexity repair; the focused 25-test run independently verifies that
correction, not a second complete backend run. Its command was
`COVERAGE_FILE=/tmp/qprism-p0-gate-fixture.coverage venv/bin/python -m pytest tests/test_ux_fixtures.py --tb=short -q -p no:cacheprovider --cov=fixtures_ux_followup --cov-report=term-missing`,
followed by `venv/bin/radon cc tests/fixtures_ux_followup.py -s`.

## Blocking findings and ownership

1. **Existing lint gate remains red.** P0-T0.1's file-level ownership table maps
   repairs to P1/P2/P3/P4 specialists. Those product changes are outside P0's
   write scope. No rules were disabled or baseline failures waived. Obtain an
   explicit prerequisite-remediation scope before changing those files.
2. **Dependency security gate remains unresolved.** Security-specialist triage
   compared the original lockfile (13 findings, 1 critical/7 high) to P0
   (14 findings, 2 critical/7 high). Added coverage-v8 adds a critical metadata
   finding through the already vulnerable Vitest peer; it is not evidence of a
   new independent exploit. A compatible Vitest/provider major upgrade and
   transitive updates require deliberate verification, not `audit fix --force`.
3. **Runtime dependency findings need separate authority.** Triage identifies
   python-multipart advisories fixed by 0.0.31, outside P0's development-only
   dependency scope, and ecdsa 0.19.2 with no reported fixed release. Current
   HS256 usage does not exercise vulnerable ECDSA signing; Docker lacks the
   Node toolchain. These reachability facts reduce exposure but do not equal
   an approved exception or a clean dependency audit. Replacing the mandatory
   python-jose dependency path would touch authentication and requires explicit
   scope/compatibility planning, or a formally approved reachability exception.

**Resolved in-scope finding:** initial generator complexity 17 exceeded the
limit 10. The fixture specialist extracted typed generation helpers and added
the missing invalid-scenario test. Independent focused verification now shows
100% coverage and maximum complexity 9. This is no longer a blocking finding.

Audit artifacts: `/tmp/qprism-p0-npm-audit.json`,
`/tmp/qprism-p0-npm-audit-prod.json`, `/tmp/qprism-p0-pip-audit.json`.
The production-filter npm audit has 3 high/1 low findings; package classification
alone is not deployment reachability proof. Security results above are the
independent security specialist's diagnosis, not a fresh audit run by this gate.

## Resume conditions

The in-scope fixture repair is verified. Obtain scope direction for baseline
lint/dependency remediation or a documented,
explicit risk decision. Re-run affected tests, coverage, lint/build and security
review after changes; only a new passing gate may authorize P1. Existing
full-project coverage deficits remain separately visible under the changed-code
manifest. No Phase merge, remote push, deployment or external notification is
authorized by this report.
