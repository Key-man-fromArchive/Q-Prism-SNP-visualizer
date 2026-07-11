# E2E harness (Phase 4 — multi-marker-per-plate)

Playwright E2E specs that encode the **agreed** multi-marker frontend UX
*before* the UI exists (TDD RED-first, E2E-level). They are the executable
contract for the P4 implementation — see:

- `docs/multi-marker-ux-decision.md` §0, §1, §3, §3.5 (the UX decisions these
  specs assert)
- `docs/mockups/multimarker-mockup.html` (the interactive mockup they're
  derived from)

These specs are **expected to fail (RED)** against the current UI — the
multi-marker Plate Setup / Analysis workspace has not been built yet. That
failure is the point: once P4 implements the `data-testid` contract below,
these same specs should turn GREEN with no changes to the specs themselves.

## Running

```bash
# 1. Install deps (already done if you're reading this from the repo)
npm install
npx playwright install chromium   # downloads a browser binary once

# 2. Make sure a backend is reachable — see "Auth modes" below, this MUST
#    be running with SNP_AUTH_MODE=local or auth.setup.ts cannot log in.
#    Default target: http://localhost:8002 (override with VITE_DEV_API_TARGET)

# 3. Run
npm run e2e                 # headless, all specs
npm run e2e -- --list       # enumerate specs without running them
npm run e2e:ui              # Playwright's interactive UI runner
npm run e2e:report          # open the HTML report from the last run
```

`playwright.config.ts` starts `npm run dev` itself (`webServer`) on
`http://localhost:5174` (override with `E2E_PORT` / `E2E_BASE_URL`), proxying
`/api` to `VITE_DEV_API_TARGET` (defaults to `http://localhost:8002`, same
default as `vite.config.ts`). If a dev server is already running on that
port, Playwright reuses it (`reuseExistingServer`) instead of starting a
second one.

## Auth modes — read this before your first run

`e2e/auth.setup.ts` (Playwright's "setup project" pattern) logs in once via
the real `LoginPage` UI using `E2E_USERNAME` / `E2E_PASSWORD` env vars
(defaults: `e2e_admin` / `E2eTestPass123!`) and persists the session cookie
to `e2e/.auth/user.json`, which every spec project reuses via `storageState`.

This **only works if the backend is running with `SNP_AUTH_MODE=local`**.
If it's running with `SNP_AUTH_MODE=asg_launch` (the mode this repo's
`docker-compose.yml` / `.env` uses for the production ASG-embedded
deployment), `POST /api/auth/login` returns `404 Local login is disabled`
and the setup project fails immediately with a clear Playwright error at the
`page.getByRole('button', { name: /sign in|로그인/i }).click()` step.

To get a local-mode backend for E2E (any of these work):

- Point `VITE_DEV_API_TARGET` / run the backend against a fresh DB with
  `SNP_AUTH_MODE=local` set. On first boot with an empty `users` table, the
  backend auto-creates an admin from `ADMIN_USER` / `ADMIN_PASSWORD` env vars
  (`app/main.py::_ensure_admin`) — set those to match `E2E_USERNAME` /
  `E2E_PASSWORD`, or set `E2E_USERNAME=admin E2E_PASSWORD=<your ADMIN_PASSWORD>`.
- Or spin up a disposable container from the same image with a fresh volume,
  e.g.:
  ```bash
  docker volume create snp-e2e-data
  docker run -d --name snp-e2e-backend -p 18099:8000 \
    -e SNP_AUTH_MODE=local -e ADMIN_USER=e2e_admin \
    -e ADMIN_PASSWORD='E2eTestPass123!' \
    -e JWT_SECRET_KEY=<any-32+-char-secret> -e AUTH_COOKIE_SECURE=0 \
    -v "$(pwd)/../app:/app/app:ro" -v snp-e2e-data:/app/data \
    <snp-analyzer-image>
  E2E_USERNAME=e2e_admin E2E_PASSWORD='E2eTestPass123!' \
    VITE_DEV_API_TARGET=http://localhost:18099 npm run e2e
  ```

This is exactly how the harness was smoke-tested in the sandbox that
produced it (see "Smoke run" below).

## What `loadExample` gives you

`e2e/helpers/load-example.ts` exports `loadExample(page, ploidy)`, which
drives `UploadZone`'s "Load example" dropdown (`#example-select`, see
`src/components/upload/UploadZone.tsx`) to create a synthetic 2x–8x-ploidy
session with **zero fixtures and no `.pcrd` decryption key** — the example
generator lives entirely server-side (`/api/examples`). Every spec starts
from `loadExample(page, ploidy)` (or navigates further via
`e2e/helpers/define-markers.ts`'s `defineMarkersOnColumns`, a test-only
helper that creates N markers and paints them onto whole plate columns using
only the `data-testid` contract below — not implementation internals).

## Spec files

| File | Covers |
|---|---|
| `e2e/p4-s0-single-marker-default.spec.ts` | Non-blocking single-marker default + "split into markers?" banner (§0, §1 Q1) |
| `e2e/p4-s1-plate-setup.spec.ts` | Plate Setup surface: 2-surface tabs, well/col/row selection, marker create (name+color+ploidy), select→pick→배정 apply, unassigned=gray, per-well sample type incl. No-Amp (§0, §3, §3.5, C6) |
| `e2e/p4-s2-analysis-tab.spec.ts` | Analysis surface: marker selector (dropdown ≤3 / sidebar 4+), per-marker scatter/counts, per-marker NTC/background note, ploidy expected-vs-observed (Q4, Q5, Q8) |
| `e2e/p4-s3-layout.spec.ts` | Per-user layout library: save/load/delete, "apply previous layout" with mandatory confirmation (§3.5, Q3, Q7, L2/L3) |

## The `data-testid` contract (P4 implementation must add these)

None of these exist in the current UI (confirmed — `grep -rn data-testid src`
returns nothing prior to P4). The specs are written against **stable
testids only** (never CSS classes/DOM order), per the task's contract-first
approach. All Korean strings quoted below are the literal ko-locale text the
specs assert (default language is `ko`, see `src/stores/language-store.ts`).

### Single-marker default / split banner (P4-S0)
| testid | Notes |
|---|---|
| `single-marker-analysis-view` | Wraps the existing single-marker scatter+results, auto-rendered on load/upload |
| `split-marker-banner` | Non-blocking banner, contains "마커로 분할" text |
| `split-marker-dismiss` | Closes the banner without navigating |
| `split-marker-cta` | Navigates to Plate Setup (`workspace-panel-plate` becomes visible) |

### Workspace tabs (2-surface, P4-S1/S2)
| testid | Notes |
|---|---|
| `workspace-tab-plate` | Tab button, text "플레이트 설정", `aria-selected` reflects active state |
| `workspace-tab-analysis` | Tab button, text "분석" |
| `workspace-panel-plate` | Visible iff plate tab active |
| `workspace-panel-analysis` | Visible iff analysis tab active |

### Plate grid + selection (P4-S1)
| testid | Notes |
|---|---|
| `well-{WELLID}` e.g. `well-A1`, `well-H12` | One per well. `aria-pressed` = selected on/off. `data-assigned` = `"true"`/`"false"` plain attribute (drives gray-vs-marker-color styling) |
| `col-header-{n}` e.g. `col-header-1` | Toggles the whole column's selection |
| `row-header-{letter}` e.g. `row-header-A` | Toggles the whole row's selection |
| `selection-bar` | Visible iff ≥1 well selected |
| `selection-count` | Text contains the selected well count |
| `marker-pick-button` (repeated, scope inside `selection-bar`) | One per marker; filter by `hasText: markerName` |
| `assign-button` | "배정" — applies the pending marker to selected wells |
| `unassigned-banner` | Visible on Plate tab whenever unassigned wells > 0 |
| `unassigned-count` | Contains the unassigned well count |

### Marker management (P4-S1)
| testid | Notes |
|---|---|
| `add-marker-button` | "+ 마커 추가" — opens `marker-form` |
| `marker-form` | Inline create/edit form |
| `marker-name-input` | Free-text name (no presets — markers start at 0) |
| `marker-color-swatch-{n}` (n = palette index, e.g. `0`..`7`) | `aria-pressed="true"` on the selected swatch |
| `marker-ploidy-select` | `<select>`-like control, values `"2"`..`"8"` |
| `marker-form-save` | Commits create/edit |
| `marker-form-cancel` | Discards |
| `marker-card` (repeated) | One per defined marker; filter by `hasText: markerName`; contains ploidy text e.g. "6배체" |

### Per-well inspector (P4-S1)
| testid | Notes |
|---|---|
| `well-inspector` | Visible iff ≥1 well selected |
| `well-type-sample` / `well-type-ntc` / `well-type-a1` / `well-type-a2` / `well-type-het` / `well-type-no-amp` | Segmented well-type buttons ("샘플"/"NTC"/"Allele 1 대조"/"Allele 2 대조"/"이형접합 대조"/No-Amp per C6); `aria-pressed` reflects current type |
| `unassign-button` | Returns selected well(s) to unassigned/gray |

### Analysis results (P4-S2)
| testid | Notes |
|---|---|
| `marker-selector-dropdown` | Present iff marker count ≤ 3 (Q8) |
| `marker-selector-sidebar` | Present iff marker count ≥ 4 (Q8) |
| `marker-sidebar-card` (repeated, inside sidebar) | Filter by `hasText: markerName`; click switches active marker |
| `marker-scatter` | Per-marker scatter, re-renders on marker switch |
| `genotype-counts` | Per-marker genotype/dosage count summary |
| `marker-ploidy-badge` | e.g. "6배체" |
| `marker-expected-classes` | Expected dosage-class count (ploidy+1), e.g. contains "7" |
| `marker-observed-classes` | Observed dosage-class count, for expected-vs-observed comparison/warning |
| `marker-ntc-note` | States that background/NTC is computed per-marker, not plate-global (Q4/Q5/C4/C7) |

### Layout library (P4-S3, split by feat/library-hub — see below)
| testid | Notes |
|---|---|
| `layout-save-open` | Plate Setup contextual quick action — opens the save-as-name form |
| `layout-save-name-input` | Layout name input |
| `layout-save-confirm` | Commits the save |
| `apply-previous-layout-button` | Plate Setup contextual quick action — "이전 실행 레이아웃 적용" |
| `apply-previous-layout-confirm-dialog` | Mandatory confirmation (L3 — never blind-apply) |
| `apply-previous-layout-confirm` / `apply-previous-layout-cancel` | Dialog actions |

### Library tab (feat/library-hub — consolidated Marker Catalog + Layout library)
Top-level, session-free `library` tab (`#tab-library`), replacing the old
standalone `catalog` tab. Two sub-surfaces (mirrors the
`workspace-tab-plate`/`workspace-tab-analysis` pattern):

| testid | Notes |
|---|---|
| `library-subtab-catalog` / `library-subtab-layouts` | Sub-tab buttons |
| `library-panel-catalog` | Wraps the unchanged `MarkerCatalogTab` (`marker-catalog-tab`, `catalog-*` testids) |
| `library-panel-layouts` | The full layout browse/manage UI (moved out of Plate Setup) |
| `layout-row` (repeated, inside `library-panel-layouts`) | One per saved layout; filter by `hasText: layoutName` |
| `layout-load-button` (scoped inside a `layout-row`) | Only rendered when a session is open — loads that layout onto the CURRENT plate |
| `layout-copy-button` (scoped inside a `layout-row`) | Duplicates the layout into the caller's own library |
| `layout-delete-button` (scoped inside a `layout-row`) | Removes it from the library |
| `layout-load-conflict-dialog` / `layout-load-conflict-cancel` / `layout-load-conflict-confirm` | L2 ploidy-conflict confirmation for a per-row load |
| `library-layouts-no-session-hint` | Shown instead of the load/save actions when no plate is open (read-only browse/copy/delete) |
| `library-layout-save-open` / `library-layout-save-name-input` / `library-layout-save-confirm` / `library-layout-save-cancel` | Optional "현재 배치 저장" convenience, only rendered when a session is open |

## `playwright test --list`

Confirmed working — enumerates all 23 tests across 5 files (1 setup + 22
spec tests) without needing a live backend:

```
Total: 23 tests in 5 files
```

## Smoke run

A live smoke run **was** performed in the sandbox that authored this
harness, against a disposable backend container running the exact same
`app/` code bind-mounted with `SNP_AUTH_MODE=local` (see the docker snippet
above) — the pre-existing `snp-analyzer` container on port 8002 in this
sandbox runs `SNP_AUTH_MODE=asg_launch`, which cannot serve local login (see
"Auth modes"), so a second disposable instance was used purely to validate
the harness end-to-end:

- `[setup] auth.setup.ts › authenticate` — **passed**: logged in via the real
  `LoginPage` form and persisted `e2e/.auth/user.json`.
- All 22 feature specs in the `chromium` project — **failed**, as expected
  (RED): `loadExample()` itself succeeds (the example-dataset endpoint and
  the existing single-marker UI both work today), but every assertion after
  that times out waiting for a `data-testid` from the contract above (e.g.
  `workspace-tab-plate`, `well-A1`, `marker-form`, ...) because the
  multi-marker Plate Setup / Analysis workspace does not exist yet. This is
  exactly the RED state this task asked for.

If you're running this somewhere `npx playwright install chromium` cannot
download a browser (fully offline sandbox) or no backend is reachable at
all, `playwright test --list` still works (pure static parse, no browser/
network needed) — use that to confirm the specs are wired up correctly.
