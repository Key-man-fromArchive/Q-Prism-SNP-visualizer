# P32-RAW-FILE — retain the uploaded original file, with an expiry window

Branch: `feat/raw-file-retention` (worktree `worktree/feat-rawfile`, from `main` at `f6c1073` = v1.2.1).
Contract from the team lead's assignment message (product-owner decision): store originals on the
existing `asg_saas_v2_snp_data` volume under `/app/data/`, retain 90 days by default (configurable),
delete only the source bytes on expiry — parsed readings/calls untouched.

## Before

`app/routers/upload.py` parsed an uploaded file into a temp path, then deleted the temp file
immediately after parsing, before a session even existed. `sessions.raw_filename` kept only the
NAME. A parser fix could never be re-applied to a past upload; an operator who lost their own copy
had no way to recover it.

## Design decisions (asked for explicitly; each has a reason)

**Path structure — session ID, not content hash.** `app/services/raw_file_storage.py:_raw_file_dir()`
stores at `<dir>/<session_id>/raw<ext>`. A hash-keyed store would dedupe an identical re-upload, but
then "delete this session's file" and "this file has expired" stop being single, unambiguous
operations the moment two sessions could share one blob — exactly the complication the assignment
flagged. Session-keyed storage keeps deletion trivially per-session at the cost of not deduping
byte-identical re-uploads, which is the right trade at this scale (uploads are infrequent, capped
at 50 MB each; see capacity estimate below).

**Integrity — sha256 stored, not used as a key.** `session_raw_files.sha256` lets a later read
detect silent on-disk corruption; it is never used to look anything up.

**What's recorded** (`app/db_schema.sql`, table `session_raw_files`, migration 10 in
`app/db.py:_run_migrations`): `session_id` (PK, `ON DELETE CASCADE` from `sessions`),
`original_filename`, `stored_path` (relative to the storage root — keeps the DB portable if
`RAW_FILE_DIR` moves), `size_bytes`, `sha256`, `stored_at`, `expires_at`, `deleted_at`,
`delete_reason`. One row per session (at most one raw file per session), not a new column on
`sessions` — this is optional, sparse, one-to-one-or-zero data with its own lifecycle
(created/expired independently of the session row), which is exactly what a satellite table is for;
adding six nullable columns to `sessions` for a feature most existing rows will never populate
would be the wrong normalization.

**Expiry is computed and stored once, at upload time (`expires_at`)** — not derived from
`stored_at + current RAW_FILE_RETENTION_DAYS` on every read. Changing the env var must not
retroactively move the expiry of files already stored under the old window (a config change should
not, invisibly, either resurrect an already-swept file's would-be-expiry into the future, or
suddenly expire a batch of recent uploads early).

**Deletion is request-driven, not a background scheduler.** Checked first: `app.db.py` already has
`cleanup_sessions_older_than()` for the *session* retention window (`SESSION_RETENTION_DAYS`) and it
is **dead code** — grep confirms nothing in `app/` ever calls it; it exists to be run manually/by an
external operator. There is no scheduler, cron, or background thread anywhere in this app. Per the
explicit instruction not to introduce one, `raw_file_storage.sweep_expired_raw_files()` is instead
called from the read paths that already enumerate sessions: `GET /api/sessions` (bulk, one query for
the whole page), `GET /api/sessions/{sid}`, and the two new raw-file endpoints themselves. An expired
file is removed the next time anyone looks at that session — in practice, "opening the workspace" or
"reopening a plate" already happens far more often than 90 days apart for any session anyone still
cares about.

**Storage failure never blocks the upload.** `store_raw_file()` catches every exception, logs it
(`logger.exception`, includes the session id), and returns normally — the session itself (readings +
calls, `db.save_session`) has already been persisted by the time raw storage runs. This is a
convenience layered on an already-successful upload; a full disk or permissions problem must not
turn a successful analysis into a failed one. Verified in
`tests/test_raw_file_retention.py::test_storage_failure_never_blocks_the_upload` — `RAW_FILE_DIR`
pointed at a path a plain file already occupies (so `mkdir` raises), upload still returns 200 with
the correct instrument, and the failure is logged with the session id.

**Download permission reuses `app.auth.check_session_access`** — the exact function every other
per-session endpoint already depends on (own sessions for a `user`, all sessions for an `admin`
outside ASG launch mode). No new authorization logic was written. Verified in
`test_other_users_session_raw_file_is_denied` (403 for both the status and download endpoints when
called as a different user).

**Session deletion takes the raw file with it.** `ON DELETE CASCADE` on `session_raw_files` removes
the DB row when a session is deleted, but not the bytes on disk — `app/routers/sample.py:
_delete_sessions_impl` now also calls `raw_file_storage.delete_raw_files_for_sessions()` (best-effort
`shutil.rmtree`, same failure philosophy as storage). Verified in
`test_deleting_a_session_deletes_its_raw_file_directory`.

## The three (four, counting "none") distinct "not available" states

`app.services.raw_file_storage.RawFileStatus.status` is one of:

| status | meaning | historical fields kept? |
|---|---|---|
| `none` | no record at all — predates this feature, **or** its store failed at upload time (deliberately indistinguishable from the user's point of view: neither is an error to act on; the failure is still logged server-side, see above) | no |
| `available` | on disk, not yet expired | n/a (current) |
| `expired` | retention window closed, swept | yes — `original_filename`/`size_bytes`/`sha256`/`stored_at`/`expires_at`/`deleted_at` all survive the sweep |
| `missing` | **anomaly**: the record says it should be there (not expired) but the bytes are gone from disk | yes, plus a `logger.warning` naming the session id and path, distinct from the routine `expired` path |

Both API responses (`GET /api/sessions/{sid}/raw-file` and the `raw_file` field embedded in
`GET /api/sessions` / `GET /api/sessions/{sid}`) always return this same shape with a 200 — the
distinction is in the `status` field and which of the other fields are non-null, not in the HTTP
status code, so the frontend never has to special-case an error response just to render "why". The
download endpoint (`GET /api/sessions/{sid}/raw-file/download`) returns 200 + bytes only for
`available`; 410 for `expired` (semantically "it existed, it's gone now"); 404 with a structured
`{"detail": {...same shape...}}` body for `none`/`missing` — so even a direct hit or a race (file
expires between the status check and the download click) still reports the right one of the four
states, not a generic error.

Backend proof (`tests/test_raw_file_retention.py`):
`test_legacy_session_with_no_raw_file_record_reports_none_and_does_not_break`,
`test_expired_raw_file_is_swept_and_reported_distinctly_readings_survive` (also asserts the
session's own `GET /api/sessions/{sid}` — instrument, `well_ids` — is completely unaffected by the
sweep), `test_missing_raw_file_is_an_anomaly_distinct_from_expired_and_none` (asserts the log line
fires and the three states never collapse into each other).

## Expiry shown ahead of time, not discovered after the fact

`expires_at` is present in every `available` response from the moment of upload —
`test_expires_at_is_in_the_future_right_after_upload_so_it_can_be_shown_ahead_of_time` proves it is
in the future immediately. On the frontend, the Sessions table's download icon
(`BatchTab.tsx:RawFileAction`) always carries a title/aria-label stating the exact expiry date, and
turns amber (`text-warning`, an existing, already-AA-checked token in this design system — see
`getQualityColor`/`getConcordanceColor` reusing the same token) once the file is within 7 days of
expiry (`rawFileExpiresSoon`), so an operator who needs the original can act before, not after, it is
swept. Verified in `BatchTab.rawfile.test.tsx::flags the download control when the raw file expires
within a week`.

## Retention window is configurable, per-file expiry is frozen at upload time

`RAW_FILE_RETENTION_DAYS` (`app/config.py`, default 90) is read once, at the moment `store_raw_file`
runs, and baked into that file's `expires_at`. Verified in `test_retention_window_is_configurable`
(sets it to 1 day, confirms the stored `expires_at - stored_at` is ~24h, not 90 days).

## Frontend

Minimal, per the assignment: no new screen. `SessionListItem`/`SessionInfoResponse` gained an
optional `raw_file: RawFileStatus` field (`frontend/src/types/api.ts`); the existing Sessions table
in `BatchTab.tsx` (the same table that already showed `raw_filename`) gained one more action-column
control, `RawFileAction`:

- `none` → renders nothing. This is deliberate: the vast majority of sessions today (production: all
  47) predate this feature, and showing a muted icon on every single row for a state that needs no
  action would be pure noise, not information.
- `available` → a `Download` icon button; `aria-label`/`title` state the file name and expiry date;
  click streams `GET .../raw-file/download` and triggers a real browser save-as with the ORIGINAL
  filename (not the session id), via the same `Blob` → `URL.createObjectURL` → temporary `<a
  download>` pattern already used by this component's CSV export.
- `expired` → a muted `Clock` icon, `aria-label` states the exact date it expired. Not clickable.
- `missing` → a `text-danger` `FileX` icon, `aria-label` calls it out as unexpected and directs to an
  administrator — visually and textually distinct from `expired`, so an operator does not read a
  genuine anomaly as routine policy.

Both locales added in parallel (`en.ts`/`ko.ts`; `ko.ts` is typed against `en.ts`'s own keys, so a
missing translation is a compile error, not a runtime gap). No changes to `SessionCalendar.tsx` (out
of scope per the assignment, and it had just had unrelated work land) or to the project-detail
plates table (a different, unrelated endpoint/response shape — `GET
/api/projects/{id}/summary` — extending it was not part of this contract and would have doubled the
backend surface touched for a table that already exists purely as a read-only rollup).

Colour tokens (`text-warning`/`text-danger`/`text-text-muted`) are all pre-existing, already-used
tokens from this design system (see `getQualityColor`/`getConcordanceColor` in the same file) —
no new colours were introduced, so no new WCAG AA contrast pairing needed checking. Icons carry
`aria-label`/`title` together (`role="img"` for the two non-interactive ones), matching the pattern
already established by `BatchTab.icon.test.tsx`'s decorative-icon test.

## Migration verification (schema reproduced, production DB never touched)

`test_migration_10_adds_session_raw_files_without_touching_existing_sessions` builds a temp SQLite
DB with `app/db.py:init_db()` (i.e. the CURRENT schema, session_raw_files included), then manually
reverts it to "as if migration 10 had never run" (`DROP TABLE session_raw_files`;
`DELETE FROM schema_version WHERE version = 10`) while inserting one real session row + one real
`well_cycle_data` row — i.e. reproduces the shape of the production DB (47 sessions, ~100k readings,
schema version 9) without ever opening `/app/data/snp_analyzer.db`. Re-running `init_db()` (exactly
what app startup does) then asserts: the table now exists, `schema_version` is 10, and — the point of
the test — the pre-existing session row and its reading are **byte-for-byte unchanged**, and that
session correctly reports `get_raw_file_record(...) is None` (no synthesized/back-filled row; a
legacy session has nothing, by design — see "none" above).

## Capacity estimate (90-day retention)

Inputs available: per-file cap 50 MB (`MAX_UPLOAD_SIZE_MB`, `app/config.py`), current production
DB holds 47 sessions total (10.1 MB of parsed readings, no raw files ever stored under the old
behaviour) accumulated over the app's history to date. There is no historical "bytes per upload"
sample to draw on (no raw file was ever kept), so this is a bound, not a measurement:

- **Worst case, all 47 sessions re-uploaded at the cap within one 90-day window:** 47 × 50 MB ≈
  **2.35 GB**. This over-estimates badly in practice — real qPCR instrument exports (`.eds`/`.pcrd`)
  are typically well under 50 MB (the cap exists to bound the pathological case, not describe the
  median file).
- **Steady-state formula for future sizing:** `daily_upload_rate × 90 × avg_file_size`. At today's
  lab-scale cadence (47 sessions accumulated since inception per the assignment's own numbers, i.e.
  a small fraction of a session per day on average), 90 days of retention is a small multiple of
  what a single day's `/api/upload` limit already allows (20 files / 500 MB per batch, per
  `frontend/src/lib/upload-jobs.ts`) — i.e. even a single unusually large batch upload, retained for
  the full 90 days, tops out at 500 MB, an order of magnitude under the volume headroom the same
  volume already carries for the DB (`snp_analyzer.db` is 10 MB for the full session history to
  date). No separate volume or quota was requested or added; `RAW_FILE_DIR` defaults to a sibling of
  `DB_PATH` on the existing `asg_saas_v2_snp_data` volume, per the assignment.

## Verification

**Backend** (venv built in-worktree, `bcrypt==4.0.1` pinned per `requirements-dev.txt`):
`pytest tests/ -q` → 855 passed + 2 subtests (baseline 841 passed + 2 subtests; +14 new:
`test_raw_file_retention.py` ×12, `test_import_session.py` ×2). `ruff check` on every changed `.py`
file: clean. `ruff format --check` on the two newly created `.py` files
(`app/services/raw_file_storage.py`, and `tests/test_raw_file_retention.py`, which counts as a `.py`
file for this gate even though the frontend gate below lists `.tsx`): clean (one auto-format pass
applied and re-verified before committing).

Two existing tests were adjusted, not weakened: `tests/test_upload_limits.py
::test_upload_file_accepts_valid_parser_result` now also mocks `raw_file_storage.store_raw_file`
(added an assertion that it IS called, rather than just silencing it) — without this, the test would
attempt a real disk/DB write to whatever `app.db.DB_PATH` happened to be at that point in the suite
(this file never sets it, unlike every other test that touches upload), since `create_session_from_
import` now takes a real temp-file path in the success path. `tests/test_import_session.py`'s
original test is untouched; two new tests added for the `raw_source_path` parameter's two branches
(present/absent).

**Frontend**: `tsc -b --noEmit` → 0 errors. `eslint .` → 0 errors. `vitest run` → 137 files / 1007
tests passed (baseline 136/1002; +5 new in `BatchTab.rawfile.test.tsx`) — one unrelated pre-existing
flake (`CompareTab.test.tsx`, a `Plotly.newPlot` mock-call assertion) was observed on one run and
confirmed to pass both in isolation and on a clean re-run of the full suite; not touched by this
change. `npm run build` → succeeds, `../app/static-react/` produced (pre-existing chunk-size warning
unrelated to this change).

**Migration**: see above — reproduced schema only, verified in-process, production DB never opened.

**E2E**: isolated server on port 8300 (`E2E_BASE_URL=http://localhost:8300`), fresh temp SQLite DB
and `RAW_FILE_DIR` under the session scratchpad (never `/app/data/snp_analyzer.db`), started/stopped
by explicit PID (never a port-based `pkill`). Root `tests/` (140 tests, confirmed via `--list`) run
three times: 139/140, 138/140, 139/140 — a different, unrelated test failed each time
(`24-responsive.spec.ts:4` "multi-marker 384 review...", `02-upload-quantstudio.spec.ts` "scatter
plot renders...", `20-keyboard.spec.ts` "keyboard-only 96-well..."), none of which touch upload,
session-list, or raw-file code paths, and every single one of them passed cleanly when re-run in
isolation immediately after — consistent with pre-existing environmental flakiness under this
sandbox's load (confirmed other, unrelated backend processes from other agents were concurrently
running on this shared machine), not a regression from this change. The upload-specific suite
(`02-upload-quantstudio.spec.ts`, 8 tests) passed 8/8 in isolation. Real E2E uploads did exercise raw
storage for real (156 per-session directories, ~37 MB, created under the isolated `RAW_FILE_DIR`
during the three runs) confirming the upload→store wiring end-to-end outside of mocks. Cleanup:
server killed by PID; temp `.sqlite3`/`-shm`/`-wal` and the entire `raw_uploads` tree removed;
Playwright's `test-results`/`playwright-report` output directories removed. `frontend/e2e/` (the
separate 52-test suite) was not run — out of scope per the assignment.

## RED evidence

All of `tests/test_raw_file_retention.py`'s 12 tests, `BatchTab.rawfile.test.tsx`'s 5 tests, and
`test_import_session.py`'s 2 new tests were written against the pre-implementation tree (backend
service module and endpoints did not exist yet, `raw_file`/`RawFileStatus` did not exist in the
frontend types/API client) and initially failed with `AttributeError`/`ImportError`/"no such
endpoint"/`ReferenceError` as appropriate before the corresponding implementation was written; all
now pass (see Verification above).

## Files

- `snp-analyzer/app/config.py` — `RAW_FILE_RETENTION_DAYS`
- `snp-analyzer/app/db_schema.sql`, `snp-analyzer/app/db.py` — `session_raw_files` table (migration
  10) + CRUD helpers (`save_raw_file_record`, `get_raw_file_record(s)`, `mark_raw_file_deleted`,
  `list_expired_raw_files`)
- `snp-analyzer/app/services/raw_file_storage.py` — new: storage, status, sweep, delete
- `snp-analyzer/app/services/import_session.py` — `create_session_from_import(..., raw_source_path=None)`
- `snp-analyzer/app/routers/upload.py`, `snp-analyzer/app/routers/import_api.py` — wire the still-live
  temp file into raw storage before it is cleaned up
- `snp-analyzer/app/routers/sample.py` — `raw_file` in `GET /api/sessions` (bulk) and `GET
  /api/sessions/{sid}`; new `GET /api/sessions/{sid}/raw-file` and `.../raw-file/download`; raw file
  cleanup wired into `_delete_sessions_impl`
- `snp-analyzer/tests/test_raw_file_retention.py` (new), `test_import_session.py`,
  `test_upload_limits.py`
- `snp-analyzer/frontend/src/types/api.ts` — `RawFileStatus`, `SessionListItem.raw_file`,
  `SessionInfoResponse.raw_file`
- `snp-analyzer/frontend/src/lib/api.ts` — `getRawFileStatus`, `downloadRawFile`
- `snp-analyzer/frontend/src/components/batch/BatchTab.tsx` — `RawFileAction`, download handler
- `snp-analyzer/frontend/src/components/batch/BatchTab.rawfile.test.tsx` (new)
- `snp-analyzer/frontend/src/locales/en.ts`, `ko.ts` — `rawFileDownload`, `rawFileDownloadedTitle`,
  `rawFileExpiredTitle`, `rawFileMissingTitle`, `rawFileDownloadFailed`
