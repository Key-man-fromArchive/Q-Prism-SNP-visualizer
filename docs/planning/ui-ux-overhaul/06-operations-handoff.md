# Q-Prism Operations Handoff

This handoff covers the accepted local scope at [P5-S0-V](evidence/P5-S0-V.md).
It is an operations guide, not a deployment approval. The canonical current browser
scope is ROOT18–26; ROOT01–03 are retained legacy suites and are not acceptance gates.

## Run, build, and verify

Use the repository commands below from a clean checkout. For backend work, create and
use the isolated environment; do not use a host Python installation.

```sh
(cd snp-analyzer && python -m venv venv && . venv/bin/activate && \
  pip install -r requirements.txt -r requirements-dev.txt)
(cd snp-analyzer && venv/bin/python -m uvicorn app.main:app --reload --port 8002)
# in another shell:
(cd snp-analyzer && venv/bin/python -m pytest --tb=short -q)
(cd snp-analyzer/frontend && npm install && npm run test && npm run build && npm run lint)
# from the repository root, with an isolated app/Vite runtime running:
npm install && npx playwright install chromium
npx playwright test tests/{18,19,20,21,22,23,24,25,26}-*.spec.ts --project=chromium --workers=1
# frontend's existing suite uses its own Vite startup/auth setup:
# its backend must be running with SNP_AUTH_MODE=local for auth.setup.ts
(cd snp-analyzer/frontend && npm run e2e)
```

`requirements.txt` pins `bcrypt==4.0.1` for passlib 1.7.4 and `PyJWT==2.13.0`.
Installing only on the host can make authentication tests fail during import. The
Docker path is `cd snp-analyzer && docker compose up --build` and serves port 8002.

## Configuration and persistence

Set `SNP_AUTH_MODE=local` or `asg_launch`, and keep service secrets in environment
configuration only. In deployed local-auth mode, set a random, non-default
`JWT_SECRET_KEY` of at least 32 characters and use `AUTH_COOKIE_SECURE=1` over HTTPS
(`0` is appropriate for loopback development). For a mounted deployment, set
`SNP_ROOT_PATH=/snp-analyze` and configure the reverse proxy to strip that prefix
before forwarding; set frontend `VITE_APP_BASE_PATH` to the same mounted prefix and
restart after changing either value because the backend root path is read at import
time. Align `SNP_COOKIE_PATH` with the mount. `DB_PATH` must point at persistent
storage. PCRD imports require `PCRD_PASSWORD`. ASG operation uses `ASG_BASE_URL`,
`ASG_SNP_SERVICE_SECRET`, `ASG_SESSION_EXPIRY_MINUTES`, and optionally
`SNP_ASG_HOME_URL`; a live external ASG connection was not exercised here.

The default safety/retention settings are `MAX_UPLOAD_SIZE_MB=50`,
`SESSION_RETENTION_DAYS=30`, `MAX_ZIP_ENTRIES=500`,
`MAX_ZIP_UNCOMPRESSED_MB=100`, and `MAX_ZIP_COMPRESSION_RATIO=100`.

Startup runs the current SQLite migrations and restores persisted sessions, results,
marker assignments, well types, manual groups, and protocol data. Migrations are
idempotent, but do not backfill marker catalogs, layouts, or missing analysis
context. It does not silently reanalyse. URL restoration is owner/session scoped and
does not expose ASG credentials. A result whose saved clustering context is absent is
`legacy_unknown`; reanalyse it before any operation that requires verified context,
including snapshot export or ASG save. For a clean local reset, stop the app, remove
only the intended temporary SQLite file, then restart; never delete shared data
volumes as a test shortcut.

## Snapshot, ASG, and upload boundaries

CSV, PDF, XLSX, and PNG use one authorized detached snapshot bound to the result
revision and captured conditions. Omitted cycle selection preserves the legacy
latest-acquisition behavior; an explicit cycle, including literal `0`, must use
`cycle_mode=absolute`.
Whole-run files retain all wells even when the UI has a selected-well filter. CSV
preserves the established columns and appends revision/context metadata; PDF/XLSX
carry typed values and metadata. PNG uses the active chart scope and records scope,
cycle, reference/background, revision, and timestamp in its caption. Snapshot exports
never contain raw cycle arrays or launch credentials.

ASG verification uses synthetic fixtures and injected/mocked transport only; never
send a real POST from tests. Treat upload files as untrusted. Preserve the 50 MiB
default upload limit and ZIP checks for traversal/absolute names, backslashes, empty
archives, entry count, uncompressed size, and compression ratio. A zero-size entry is
handled safely without divide-by-zero; it is not rejected solely for being zero-size.
Do not commit tokens, credentials, private sample identifiers, or generated browser
artifacts.

## Known non-blocking limits

- Visual evidence is representative across 390/768/1024/1280/1440, KO/EN, and both themes; it is not exhaustive manual inspection of every state.
- The production build retains a non-fatal large-bundle warning.
- 384-well browser checks assert the real bounded DOM using deterministic fixtures; native 384 import/scientific processing is not claimed by that UI evidence.
- Global presets are stored in the shared preset JSON file, so tenant isolation is not claimed. Malformed preset responses are surfaced for retry without discarding current inputs.
- In-memory analysis publication is a single-process guarantee; multi-worker/replica coordination is outside this acceptance scope.
- Live ASG service interoperability and production deployment were not verified; the accepted checks are local-only and no push/deploy was performed.

## Task traceability

The 33 completed task records below use canonical commits from orchestration state and
the evidence files present in this worktree.

| Task | Status | Commit | Evidence |
| --- | --- | --- | --- |
| P0-T0.1 | DONE | `9f519ae86cc430c819ee49dbb2bf7b2913a0aefa` | [evidence](evidence/P0-T0.1.md) |
| P0-T0.2 | DONE | `77010b0d9956fba11e3547bf21935c953b50b4ca` | [evidence](evidence/P0-T0.2.md) |
| P0-R0-T1 | DONE | `009a7627dbbe266b895943884bad9a476e827e0f` | [evidence](evidence/P0-R0-T1.md) |
| P0-S0-T1 | DONE | `e9c9b1d5fdb4f608d424a66cca4f0bd078a36a56` | [evidence](evidence/P0-S0-T1.md) |
| P0-S0-V | DONE | `079d23ce449b14a6e8789813f93d40a3fb6bc93d` | [evidence](evidence/P0-S0-V.md) |
| P1-R1-T1 | DONE | `b7c6e8752aa57de2fb5b9ae44b37e512f60ffee8` | [evidence](evidence/P1-R1-T1.md) |
| P1-R1-T2 | DONE | `da35b12c01b16c7df75d5eabaee0e0ca9e300f7f` | [evidence](evidence/P1-R1-T2.md) |
| P1-R1-T3 | DONE | `43a013be8639b90baee6fbff62f4d70f47c05046` | [evidence](evidence/P1-R1-T3.md) |
| P1-R2-T1 | DONE | `9c15ff968c5026a41d6e322665e0bccc35767b93` | [evidence](evidence/P1-R2-T1.md) |
| P1-R3-T1 | DONE | `991dabad1142f7df4a311162eed9077a0014ba74` | [evidence](evidence/P1-R3-T1.md) |
| P1-R3-T2 | DONE | `ccc590fcd31f81417ee947b40f35a30ab44f8ad7` | [evidence](evidence/P1-R3-T2.md) |
| P1-S0-T1 | DONE | `c880b0a803aa41635237ed9cd0609431670c001a` | [evidence](evidence/P1-S0-T1.md) |
| P1-S0-V | DONE | `4a1a632fcdb73d92273214f10fa572d4fd2c03af` | [evidence](evidence/P1-S0-V.md) |
| P2-S1-T1 | DONE | `8c6c08db7611b2bd35f7625cae92c72c46a1da08` | [evidence](evidence/P2-S1-T1.md) |
| P2-S2-T1 | DONE | `906c261c204d8e7b2d1db495343e5880c9d25e55` | [evidence](evidence/P2-S2-T1.md) |
| P2-S3-T1 | DONE | `ea072ef302d98a9d0db7b5f8980e93c3bd61c977` | [evidence](evidence/P2-S3-T1.md) |
| P2-S4-T1 | DONE | `287ad3f120c2d203bfec813d234cc59ae58f9161` | [evidence](evidence/P2-S4-T1.md) |
| P2-S0-V | DONE | `f5bfbc77a0b1244f3dc5e06a48e54f8b04a1b1af` | [evidence](evidence/P2-S0-V.md) |
| P3-S1-T1 | DONE | `297e98157d6aafc6ad7ca0742d8e89b990c94837` | [evidence](evidence/P3-S1-T1.md) |
| P3-S2-T1 | DONE | `21594a50ddc544c3656f0a18f4e03978a3f09fd6` | [evidence](evidence/P3-S2-T1.md) |
| P3-S3-T1 | DONE | `c8161ba37dede090da061a450067e985888e220e` | [evidence](evidence/P3-S3-T1.md) |
| P3-S4-T1 | DONE | `5681041a06f122d2037c09bea76896187e7aa393` | [evidence](evidence/P3-S4-T1.md) |
| P3-S0-V | DONE | `d288b0b0f7fa97fca31823f66ec6cf6f8fe2936b` | [evidence](evidence/P3-S0-V.md) |
| P4-S0-T1 | DONE | `bb7118e9a9111e1119d4f333b02d2df76f18f305` | [evidence](evidence/P4-S0-T1.md) |
| P4-S1-T1 | DONE | `39239091c5b1ec14b4f122f169295ba2168bd383` | [evidence](evidence/P4-S1-T1.md) |
| P4-S2-T1 | DONE | `2ab2b2d720c208e7ce2f640d2e3b41004af74268` | [evidence](evidence/P4-S2-T1.md) |
| P4-S3-T1 | DONE | `846b5c2194e0aaf7da1f29f335a549692de37821` | [evidence](evidence/P4-S3-T1.md) |
| P4-S4-T1 | DONE | `d9b6901ec3cb6b3177b911bc7d7e8a84d1e203f8` | [evidence](evidence/P4-S4-T1.md) |
| P4-S4-T2 | DONE | `65e6bafd1bf38310f7e993d11334455ed49ba4e2` | [evidence](evidence/P4-S4-T2.md) |
| P4-S0-V | DONE | `fd94306913da7a7c6d316ec7e34833ec3a41950b` | [evidence](evidence/P4-S0-V.md) |
| P5-R0-T1 | DONE | `c54495eebd0232e9ce723d4441d5ead699c6fc9b` | [evidence](evidence/P5-R0-T1.md) |
| P5-S0-V | DONE | `b1cbebd49160d696dfec3f49e3b4c8d9982e7af1` | [evidence](evidence/P5-S0-V.md) |
| P5-T0.1 | DONE | `355a14013f40df36db3986f2dca3bfd086839e74` | [evidence](evidence/P5-T0.1.md) |
