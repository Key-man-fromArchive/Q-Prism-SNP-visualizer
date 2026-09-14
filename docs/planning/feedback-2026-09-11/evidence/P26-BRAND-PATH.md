# P26-BRAND-PATH: brand images broken under `/snp-analyze/` mount

## Report

- `https://asgdesigner2.ivttools.com/snp-analyze/` -- many icons broken.
- `https://asgdesigner2.ivttools.com/brand/qprism-hero.jpg` -- no picture.

## Root cause

Production is reverse-proxied under `/snp-analyze/` (`VITE_APP_BASE_PATH`
sets Vite's `base`). Vite's `base` rewrites `index.html` (favicon, script
tag) and every bundler-resolved `import`, but it does **not** rewrite plain
string literals inside JSX (`src="/brand/qprism-wide.png"`). Four such
literals in `UploadZone.tsx` (the wide logo `<picture>`/`<img>`, the hero
art `<img>`, and the footer Invirustech `<img>`) stayed as bare
root-absolute paths, so under the sub-path mount the browser requested
`https://.../brand/qprism-hero.jpg` (which 404s outside the mount) instead
of `https://.../snp-analyze/brand/qprism-hero.jpg`.

`favicon-32.png` already worked (200) because `index.html`'s own `<link>`
tags go through Vite's HTML asset pipeline, which does apply `base`.

## Full inventory (not just the four reported spots)

Searched every `.ts`/`.tsx` file for root-absolute literals in `src=`,
`srcSet=`, `href=` attributes, plus `index.html`, `index.css` (`url(...)`),
and any manifest/meta files:

| Location | Kind | Status before this fix |
|---|---|---|
| `UploadZone.tsx:376,378` | `<source srcSet>` / `<img src>`, wide logo | broken (bare `/brand/...`) |
| `UploadZone.tsx:395` | `<img src>`, hero art | broken (bare `/brand/...`) |
| `UploadZone.tsx:752` | `<img src>`, Invirustech footer logo | broken (bare `/brand/...`) |
| `UploadZone.tsx:29,34,39` (`TEMPLATE_LINKS`) + `:550` (`<a href>`) | template downloads | **already fixed** in an earlier task -- routed through `runtimeAssetPath()` |
| `index.html` (`favicon-32.png`, `apple-touch-icon-180.png`) | `<link href>` | **already correct** -- Vite's HTML asset pipeline applies `base` here; confirmed 200 by the reporter and re-confirmed in the mounted build below |
| `index.css` | no `url(...)` references to `public/` assets | n/a |
| manifest/meta files | none exist | n/a |

Result: only the four brand-image literals in `UploadZone.tsx` needed a
code change. Everything else was either already correct (favicon/apple
icon, via Vite's own HTML handling) or already fixed (templates, via a
helper that existed but wasn't applied consistently).

## Fix: `import.meta.env.BASE_URL` prefixing via the existing helper

`src/lib/runtime-paths.ts` already provided `runtimeAssetPath(path)` --
used for the template download `href`s but not for the four brand images.
Rather than introducing a second mechanism, this fix applies the same
helper to the four remaining literals:

```tsx
<source srcSet={runtimeAssetPath("/brand/qprism-wide.webp")} type="image/webp" />
<img src={runtimeAssetPath("/brand/qprism-wide.png")} ... />
...
<img src={runtimeAssetPath("/brand/qprism-hero.jpg")} ... />
...
<img src={runtimeAssetPath("/brand/invirustech.png")} ... />
```

`runtimeAssetPath()` resolves the mount path from `import.meta.env.BASE_URL`
(what `VITE_APP_BASE_PATH` becomes at runtime), falling back to the first
pathname segment (excluding reserved segments `api`/`assets`/`templates`)
when `BASE_URL` is the default `/`.

### Why prefixing over `import`

Two options existed: (a) `import` the images so the bundler hashes and
base-prefixes them, or (b) keep them in `public/` and prefix the path at
runtime via `BASE_URL`.

Chose (b), matching the existing `runtimeAssetPath()` precedent already in
the codebase for templates, because:
- The task explicitly forbids moving/renaming the asset files (filenames
  are tied to stored user data/template links), and switching to `import`
  would still require touching every reference site the same way `(b)`
  does, with no reduction in touched call sites.
- A second, inconsistent mechanism (some assets `import`ed, some prefixed)
  for the same `public/brand/` directory would be more confusing than
  finishing the one mechanism the codebase had already started.
- `import`-based hashing/cache-busting has no functional value for these
  specific files (logo/hero art change rarely, if ever, and are not
  content-addressed anywhere else in the app).

### Regression guard (item 3 -- the one that matters most)

Two new tests specifically target "this will happen again":

1. `src/test/public-asset-path-literals.test.ts` -- scans every
   `public/` subdirectory (`brand`, `templates`, dynamically discovered via
   `readdirSync`, so a *future* `public/icons/` etc. is covered without
   editing this test) and fails if any `.ts`/`.tsx` source file references
   it via a raw `src=`/`srcSet=`/`href=` literal instead of through
   `runtimeAssetPath()`. Pre-fix: failed on `UploadZone.tsx` (public/brand).
   Post-fix: passes for every public subdirectory.
2. `src/lib/runtime-paths.test.ts` -- direct unit tests for
   `runtimeMountPath`/`runtimeAssetPath`/`runtimeApiBasePath`/
   `trimTrailingSlash`, which had no test coverage at all despite being the
   single place that resolves the production mount path. Covers the
   `BASE_URL` override branch, the pathname-fallback branch, reserved
   segments, and root-mount passthrough.
3. `src/components/upload/UploadZone.brand-path.test.tsx` -- component-level
   RED test: with `BASE_URL` stubbed to `/snp-analyze/`, asserts the
   rendered `<img>`/`<source>` `src`/`srcset` are prefixed; a second test
   confirms root-mount (`BASE_URL="/"`) behavior is unchanged.

## TDD evidence (RED before GREEN)

Before the `UploadZone.tsx` edit:

```
FAIL src/test/public-asset-path-literals.test.ts > ... > checks public/brand is only ever reached through runtimeAssetPath()
  AssertionError: expected [ Array(1) ] to deeply equal []
  + [".../UploadZone.tsx"]

FAIL src/components/upload/UploadZone.brand-path.test.tsx > prefixes every brand image ...
  - "/snp-analyze/brand/qprism-wide.png", ...
  + "/brand/qprism-wide.png", ...

Test Files  2 failed | 1 passed (3)
     Tests  2 failed | 15 passed (17)
```

After applying `runtimeAssetPath()` to the four literals: all 17 tests
(across the 3 new files) pass; full suite below.

## Verification (all 4, from `snp-analyzer/frontend/`)

```
npx tsc --noEmit   -> 0 errors
npm run lint       -> 0 errors, 0 warnings
npm run test       -> Test Files 132 passed (132) | Tests 973 passed (973)
npm run build      -> tsc -b && vite build succeeded
```

Baseline was 129 files / 956 tests; this task added 3 new test files / 17
new tests (129+3=132, 956+17=973), no other test counts changed.

## Mount-path build verification (the actual bug reproduction)

```
$ VITE_APP_BASE_PATH=/snp-analyze/ npm run build
$ grep -o '"/snp-analyze/favicon-32.png"\|"/snp-analyze/assets/[^"]*"' dist/index.html
  href="/snp-analyze/favicon-32.png"
  src="/snp-analyze/assets/index-CiEqtNYI.js"
```

Note on the literal-in-bundle check: `runtimeAssetPath("/brand/...")` still
leaves the *argument* string `"/brand/..."` visible in the minified bundle
(it's a JS string constant passed into a runtime-prefixing function) --
this is expected and identical to how the already-fixed `"/templates/..."`
literals also still appear as constants. Grepping the bundle for the raw
literal is therefore not a valid pass/fail signal by itself; the real
check is what the browser actually requests/renders, verified below with a
live browser against the mounted build.

Served the `/snp-analyze/`-based build with `vite preview` (with
`VITE_APP_BASE_PATH=/snp-analyze/` also set for the preview server itself,
since it re-reads `vite.config.ts` at startup) and loaded it in a real
headless Chromium (Playwright), mocking only the auth/session API calls so
the empty-state upload screen renders without a live backend:

```
IMG SRCS: [
  { "src": "/snp-analyze/brand/qprism-wide.png",  "natW": 660,  "natH": 178  },
  { "src": "/snp-analyze/brand/qprism-hero.jpg",  "natW": 1055, "natH": 1491 },
  { "src": "/snp-analyze/brand/invirustech.png",  "natW": 660,  "natH": 175  }
]
SOURCE SRCSETS: ["/snp-analyze/brand/qprism-wide.webp"]
FAILED REQUESTS: []   (all three images and the webp source returned 200 and decoded -- nonzero naturalWidth/naturalHeight)
```

Before the fix (same setup, pre-edit source), these were bare
`/brand/...` and would 404 once actually reverse-proxied under
`/snp-analyze/` in production (confirmed structurally: the reported bug).

## Screenshots (mounted build, `/snp-analyze/` base)

- `docs/planning/feedback-2026-09-11/evidence/P26-BRAND-PATH-screenshots/upload-hero-mounted.png`
  -- upload screen top: Q-Prism wordmark logo + hero art both visible.
- `docs/planning/feedback-2026-09-11/evidence/P26-BRAND-PATH-screenshots/upload-footer-mounted.png`
  -- page footer: "Powered by Invirustech" logo visible.

## E2E (root `tests/`, port 8250)

Ran the backend directly (isolated venv built in this worktree, since the
shared venv elsewhere was missing `PyJWT`) on `127.0.0.1:8250` with an
isolated SQLite DB and JWT secret (not `/app/data/snp_analyzer.db`), serving
the default (`base: "/"`) production build from `app/static-react` -- E2E
does not exercise the mounted-path build; that is covered by the dedicated
build/browser check above.

```
DB_PATH=<scratch>/tests.sqlite SNP_AUTH_MODE=local JWT_SECRET_KEY=<scratch>
AUTH_COOKIE_SECURE=0 ADMIN_USER=admin ADMIN_PASSWORD=<scratch>
venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8250

E2E_BASE_URL=http://127.0.0.1:8250 npx playwright test --workers=4
  -> 140 passed
```

At the default `--workers=16` two different specs failed intermittently
across repeated runs (`20-keyboard.spec.ts`, `24-responsive.spec.ts`,
`18-result-consistency.spec.ts`, `26-asg-compatibility.spec.ts` -- a
different subset each run), none of which touch `UploadZone.tsx` or any
asset path. Re-running the two initially-failing specs alone with
`--workers=1` passed both. This is worker-count/resource-contention
flakiness in this sandbox, not a regression from this change; `--workers=4`
reproduces the documented **140/140** baseline cleanly and repeatably.

Cleanup: backend process (PID recorded, killed by exact PID, not by name),
isolated `tests.sqlite`/`-shm`/`-wal` removed. Production
`/app/data/snp_analyzer.db` was never referenced or touched. The root
`node_modules/` and Playwright browser install were left in place
(gitignored) for any follow-up verification; the frontend-local `venv/`
created for this task is also gitignored.

## Scope discipline

- No asset files were moved or renamed; `public/brand/**` is unchanged.
- No merge to `main`, no remote push, no deployment, no notifications.
- No `git add -A`/`git add .` used.

## Commit

Local commit on `fix/brand-asset-base`, branched from `main` at `b7ca200`
(v1.1.0).
