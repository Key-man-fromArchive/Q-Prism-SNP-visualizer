# P5-S0-V — Full regression and acceptance evidence

Accepted source head: `1a3c3471f36d19f2c8fa6a739f7448f6c9297681`.
This gate records the final accepted current test scope; it does not change
product behavior, taskbook state, or orchestration state.

## Automated evidence

- Backend: **755 passed, 39 warnings, 135.70s**; the focused compatibility
  subset was **12 passed, 3 warnings**. See [P5-R0-T1](P5-R0-T1.md) for the
  auth, ASG, export, restart, migration, upload, and ZIP-hardening coverage.
- Frontend: **632 tests / 96 files passed**. Coverage was statements 72.72%,
  branches 68.29%, functions 71.27%, and lines 74.27%. Lint, TypeScript, and
  production build passed; the existing large-bundle warning remains
  non-fatal. Frontend and production dependency audits reported **0
  vulnerabilities**.
- Canonical current browser scope ROOT18–26: **10 specs, 73/73 passed,
  4.4m**. This includes the responsive, result-first, keyboard, restoration,
  recovery, quality-navigation, chart-semantics, and secondary-surface gates.
- Existing frontend E2E: **52/52 passed, 2.7m**. The corresponding repair and
  scope rationale are recorded in [P4-S4-T2](P4-S4-T2.md).

An attempted legacy full-root run was stopped after **20 auth/old-DOM failures
in ROOT01–03**. It is not reported as passing and is not silently waived:
P4 established ROOT18–26 as the canonical current root scope, while ROOT01–03
are preserved legacy suites with incompatible assumptions.

## UX traceability

| Requirement | Strongest implementation and acceptance evidence |
| --- | --- |
| UX-01 QC status | [P1-R2-T1](P1-R2-T1.md), [P2-S2-T1](P2-S2-T1.md), [P2-S0-V](P2-S0-V.md) |
| UX-02 save, analysis, export | [P1-R1-T3](P1-R1-T3.md), [P2-S1-T1](P2-S1-T1.md), [P2-S3-T1](P2-S3-T1.md), [P3-S1-T1](P3-S1-T1.md) |
| UX-03 keyboard interaction | [P2-S4-T1](P2-S4-T1.md), [P3-S2-T1](P3-S2-T1.md) |
| UX-04 whole-run/exclusion meaning | [P3-S4-T1](P3-S4-T1.md) |
| UX-05 failure recovery | [P3-S3-T1](P3-S3-T1.md), [P4-S4-T1](P4-S4-T1.md) |
| UX-06 URL/settings restoration | [P3-S1-T1](P3-S1-T1.md), [P5-R0-T1](P5-R0-T1.md) |
| UX-07 responsive shell | [P4-S0-T1](P4-S0-T1.md), [P4-S0-V](P4-S0-V.md) |
| UX-08 analysis layout | [P4-S1-T1](P4-S1-T1.md) |
| UX-09 quality, language, accessibility, secondary screens | [P4-S2-T1](P4-S2-T1.md), [P4-S3-T1](P4-S3-T1.md), [P4-S4-T1](P4-S4-T1.md), [P4-S4-T2](P4-S4-T2.md) |
| UX-10 undo/redo | [P3-S2-T1](P3-S2-T1.md) |

The prior gates also provide the required cross-cutting evidence: actual CSV/
PDF/XLSX/PNG file checks ([P1-R3-T1](P1-R3-T1.md), [P2-S3-T1](P2-S3-T1.md)),
database restart and legacy migration ([P3-S1-T1](P3-S1-T1.md),
[P5-R0-T1](P5-R0-T1.md)), race/late-owner checks ([P1-R1-T3](P1-R1-T3.md),
[P3-S2-T1](P3-S2-T1.md)), failure/retry handling ([P3-S3-T1](P3-S3-T1.md)),
and permission, token, prefix, upload, and audit checks ([P5-R0-T1](P5-R0-T1.md)).

## Manual and visual evidence

Representative screenshots and visual checks covered the 390/768/1024/1280/
1440 responsive matrix, KO/EN and light/dark states, 1440×1000 result-first
layout, 384-well bounded regions, upload/settings/protocol recovery, and
library/project/compare surfaces. The representative inspections are linked
from [P4-S0-V](P4-S0-V.md), [P4-S3-T1](P4-S3-T1.md), and
[P4-S4-T2](P4-S4-T2.md); they supplement, but do not replace, automated
viewport assertions.

The trace audit distinguishes these manual screenshots from automated claims;
no screenshot or trace is used to infer coverage for an unexecuted state.
Fixtures use synthetic identifiers and private isolated runtimes. No secrets,
tokens, private sample identifiers, or generated browser artifacts are
committed. No critical or high unresolved defect is recorded in the accepted
task evidence. **P5-S0-V: PASS for the canonical current scope.**
