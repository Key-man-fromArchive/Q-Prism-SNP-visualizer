# P0-S0-V — Preflight and ICV gate

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
