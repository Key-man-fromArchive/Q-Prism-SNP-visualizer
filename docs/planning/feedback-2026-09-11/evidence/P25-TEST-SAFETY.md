# P25-TEST-SAFETY — corrected: port 8002 is this repo's own dev port, not production

Branch: `feedback/p25` (worktree `worktree/feedback-p25`). Baseline `b2efb9c`.

## Result: no code or doc change. The original design was already correct.

The task briefing asserted "port 8002 is this machine's production container." That
premise was independently checked and is **wrong**, and every change made on the
strength of it was reverted. This document exists so the next agent/session that
inherits the same wrong premise doesn't repeat this work.

## What was claimed vs. what's actually true

**Claimed**: port 8002 on this host is a live production container for a different
app (`asg-saas-v2`), with real user feedback/session data, and any E2E run that
defaults to it silently attacks that production data.

**Actually true** (verified twice — once by the team lead, once independently by me
before reverting):

```
$ ss -lntp | grep ':8002\b'      → no output: nothing listens on host port 8002
$ docker ps --format '{{.Names}}\t{{.Ports}}' | grep snp-analyzer
asg-saas-v2-snp-analyzer-1      8000/tcp        # container-internal only, no host mapping
```

`asg-saas-v2`'s SNP analyzer container exposes port 8000 **inside the docker
network only**; the actual production entry point is `asg-saas-v2-nginx` on
`9880`/`9443`. It never binds host port 8002, on this host or presumably any other,
because it's reverse-proxied. Port 8002 is free on this host right now.

Port 8002 is, instead, **this repository's own documented convention**:

- `snp-analyzer/docker-compose.yml:7` — `"8002:8000"`, this repo's own compose file.
- `AGENTS.md:11,13,14` and `README.md:78,87` — explicitly tell a developer to run
  `docker compose up` / `uvicorn --port 8002`, open `localhost:8002`, then run root
  Playwright against it.
- The DB a developer's own `docker compose up` instance uses is that developer's own
  local Docker volume, not any shared production data.

So `playwright.config.ts`'s `baseURL: process.env.E2E_BASE_URL || 'http://localhost:8002'`
was the intended one-line workflow (`docker compose up`, then bare `npx playwright
test`), not an accidental foot-gun.

## Why the wrong premise looked plausible

The briefing's author had not checked `ss`/`docker ps` before writing "port 8002 is
production" into the task; the number matches this project's own compose file
(`8002:8000`) purely by convention, and a shared multi-tenant host running dozens of
unrelated services makes "something on a common port is someone else's production"
a reasonable-sounding, but in this case false, guess.

## Work done, then reverted

Before the correction arrived, the following changes were made and verified working,
then fully reverted (`git checkout --` against `b2efb9c`, confirmed clean `git
status`):

- `playwright.config.ts` (root) — added a `resolveBaseURL()` guard that threw if
  `E2E_BASE_URL` was unset, or if it resolved to `localhost:8002`/`127.0.0.1:8002`
  without an `E2E_ALLOW_PROD_PORT=1` escape hatch.
- `tests/26-asg-compatibility.spec.ts` — removed its own independent
  `|| 'http://localhost:8002'` fallback in `upstreamOrigin()`.
- `snp-analyzer/frontend/playwright.config.ts` — added the equivalent guard around
  `VITE_DEV_API_TARGET` (the `frontend/e2e/` harness's backend proxy target, also
  defaulted to `localhost:8002`).
- `AGENTS.md`, `README.md`, `docs/planning/07-coding-convention.md`,
  `snp-analyzer/frontend/README-e2e.md`, `docs/planning/06-tasks.md` — updated the
  documented commands/prose to require the env vars explicitly.

All of the above are now reverted. Keeping them would have changed this project's
actual, intended, documented one-line E2E workflow (`docker compose up` then bare
`npx playwright test`) to work around a hazard that does not exist on this host.

### RED evidence captured while the (now-reverted) guard was in place

With nothing listening on 8002 at the time, running the original code with
`E2E_BASE_URL` unset showed the pre-existing, intended behavior working exactly as
documented — it defaults to `localhost:8002` and, since nothing was up there in this
sandbox at that moment, fails with `net::ERR_CONNECTION_REFUSED` (11/11 tests in
`tests/01-homepage.spec.ts`), not a silent production hit:

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8002/
```

This is not a bug — it's what happens when nobody has run `docker compose up` yet,
which is exactly what `AGENTS.md`/`README.md` tell you to do first.

## Other landmines checked in the same investigation — still valid, unchanged

These findings do not depend on the (wrong) "8002 is production" premise and stand
on their own. No code was changed for either, because both were already safe:

- **`snp-analyzer/app/db.py:11`** — `DB_PATH` defaults to
  `Path(__file__).parent / "data" / "snp_analyzer.db"`, a path *relative to the repo
  checkout*, not the container's mounted `/app/data/snp_analyzer.db` (that absolute
  path is only reachable inside a container with the `docker-compose.yml` volume
  mount and its explicit `DB_PATH=/app/data/snp_analyzer.db` env var — see
  `snp-analyzer/.env.example`). An unset `DB_PATH` outside a container cannot reach
  any production volume. Confirmed every backend test that touches the DB overrides
  `db.DB_PATH` per-test with `tmp_path` (`grep -rn DB_PATH snp-analyzer/tests`).
  No fix needed.
- **`snp-analyzer/frontend/vite.config.ts`** — `VITE_DEV_API_TARGET` also defaults to
  `http://localhost:8002`, for plain `npm run dev` (interactive human development,
  not an automated harness). Given the corrected understanding that 8002 is this
  project's own dev backend port, this default is exactly right and intentional. No
  fix needed.

## Verification performed

- Independently re-confirmed the correction before reverting: `ss -lntp | grep
  ':8002\b'` (no listener) and `docker ps --format '{{.Names}}\t{{.Ports}}'` (the
  `asg-saas-v2-snp-analyzer-1` container publishes no host port).
- `git status --short` after `git checkout --` on all eight touched files: clean,
  matches `b2efb9c` exactly.
- While the (now-reverted) code was live, stood up a disposable backend
  (`SNP_AUTH_MODE=local`, throwaway sqlite DB under the session scratchpad, port
  `8232`, bound to `127.0.0.1` only — never `/app/data/snp_analyzer.db`, never
  `8002`) and ran the full root suite: **140/140 passed** (matches the stated
  baseline), including `tests/24-responsive.spec.ts` passing cleanly (the
  known-flaky test noted in the task briefing did not reproduce this run).
- Frontend 4-gate spot check (config files were about to be reverted regardless,
  this just confirms the working tree is otherwise clean): `npx tsc --noEmit` 0
  errors, `npm run lint` 0 errors/0 warnings, `npm run test` 128 files / 944 tests
  passed (matches stated baseline exactly), `npm run build` succeeded.
- Backend process, throwaway DB file (+ `-shm`/`-wal`), and gitignored
  `test-results/`/`playwright-report/` all cleaned up after the run. Nothing was
  ever pointed at, or read from, `/app/data/snp_analyzer.db` or port 8002.

## Files touched (write scope)

- `docs/planning/feedback-2026-09-11/evidence/P25-TEST-SAFETY.md` (this file) — the
  only surviving change. No production code, tests, or other docs were modified.
