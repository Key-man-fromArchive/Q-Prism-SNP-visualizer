# P3-E2E-regressions — fix the 2 P3-caused root E2E regressions

Branch: `feedback/p3-ia` (worktree `worktree/feedback-p3`)

Scope actually touched: `tests/19-feedback.spec.ts` and
`tests/22-error-recovery.spec.ts` only. No file under `snp-analyzer/` was
touched, no other spec was touched. No Phase merge, remote push, deployment
or notification was performed.

`P3-S0-V` (`2252b81`) updated 7 specs for the new plate/rawdata/results IA
and left these 2 unfixed as out of its `tests/**`-adjacent-but-narrower write
scope, reporting them instead (see `docs/planning/feedback-2026-09-11/evidence/P3-E2E.md`,
"remaining 13 specs" section). Both are genuine P3 regressions in the tests,
not in the product: the product changed on purpose (P3-S1-T1/P3-S2-T1), the
assertions/selectors were stale.

## Regression 1 — `tests/19-feedback.spec.ts:144`

**Test**: "reporter files feedback from any screen and reads it back".

**What it does**: logs in with no session/plate loaded, opens the floating
feedback widget (`[data-testid="feedback-open"]`, mounted at the App root,
not inside any tab panel) and submits a report. It then asserts the
`page_key` recorded on the submitted report.

**Root cause**: the test asserted `page_key: 'analysis'`. `FeedbackWidget`
receives `pageKey={activeTab}` from `App.tsx`
(`frontend/src/App.tsx:241`), where `activeTab` is
`resolveDisplayTab(state.tab, state.surface)` from
`frontend/src/stores/navigation-store.ts`. P3-S1-T1 retired `'analysis'` as
a rendered tab id — `resolveDisplayTab` only ever returns it as an input
synonym and always maps it to `'plate'` or `'results'` before use
(`navigation-store.ts:40-42`). With no session, the store's `initial` value
is `{ tab: 'results', surface: 'plate' }` (`navigation-store.ts:29`), and
since `tab !== 'analysis'`, `resolveDisplayTab` returns it unchanged:
`'results'`. So the widget was always going to record `page_key: 'results'`
in this scenario post-P3; the assertion is what went stale, not the report.
I confirmed this by reading the store's default and `resolveDisplayTab`
rather than assuming the general P3-S0-V "analysis → results" mapping
applied here mechanically — this call site has no session and no `surface`
override, so it exercises exactly the `initial` default path.

**Fix**: changed the expectation to `page_key: 'results'` and updated the
adjacent comment to point at the actual code path (`navigation-store.ts`'s
`initial` + `resolveDisplayTab`) instead of the retired tab id.

**Assertion strength**: unchanged. The test still asserts an exact
`page_key` value (not a loosened matcher), still asserts the full round
trip (submit → appears in "My feedback"), and no case/expectation was
removed.

## Regression 2 — `tests/22-error-recovery.spec.ts:33`

**Test**: "preset failure preserves input; successful save and failed
refresh remain distinct without a repeated POST".

**What it does**: loads an example plate, opens Settings, fails one preset
save (asserts the input is preserved and the error is shown without leaking
`private-secret`), retries successfully, then fails the preset list refresh
and retries that independently — the whole point being that a failed
refresh triggers no extra `POST`.

**Root cause**: the test navigated with `page.locator('#tab-settings').click()`.
P3-S1-T1 demoted `settings` into the "More" overflow menu
(`frontend/src/components/layout/TabNavigation.tsx`'s `tabs` array, `overflow: true`
for `settings`); only primary-row tabs get `id="tab-<dataTab>"`
(`TabNavigation.tsx`'s primary `.map`), so `#tab-settings` no longer exists
in the DOM at all and the click was failing outright.

**Fix**: matched the pattern `25-secondary-flows.spec.ts` already uses for
this same navigation (`openOverflowTab`, added in the same P3-S0-V commit):
open the "More" menu (`getByRole('button', { name: /^(More|더보기)$/ })`),
then select the `menuitem` for Settings. `22-error-recovery.spec.ts` doesn't
import the locale files the way `25-secondary-flows.spec.ts` does, so the
label is matched with the same bilingual literal pattern this file already
uses elsewhere in the same test (`/server|서버/`, `/Preset saved|프리셋을 저장/
등) rather than pulling in a new import: `/^(Settings|설정)$/`.

**Assertion strength**: unchanged. All original assertions remain intact —
input preservation after the failed save, the sanitized error message, the
successful save's status message, the "Retry list refresh" affordance
appearing then disappearing, and the `expect(posts).toBe(2)` no-duplicate-
POST check. Only the navigation step to reach Settings changed.

## Verification

Isolated backend, scratch DB, port 8123 (not 8002/8121/8122, not the
production DB):

```
DB_PATH=/tmp/p3fix.db SNP_AUTH_MODE=local ADMIN_USER=admin \
  ADMIN_PASSWORD='StrongerOperatorPassword123!' \
  uvicorn app.main:app --host 127.0.0.1 --port 8123

E2E_BASE_URL=http://127.0.0.1:8123 npx playwright test \
  tests/19-feedback.spec.ts tests/22-error-recovery.spec.ts \
  --project=chromium --workers=1 --reporter=list
```

Run twice in a row (flake check), both green:

```
Running 6 tests using 1 worker
  ✓ 19-feedback.spec.ts:144 reporter files feedback from any screen and reads it back
  ✓ 19-feedback.spec.ts:176 admin triages feedback from the Feedback tab
  ✓ 19-feedback.spec.ts:202 admin answers a thread and records an internal note
  ✓ 22-error-recovery.spec.ts:4 recent sessions distinguish failed list, empty list, and rejected opens with an accessible retry
  ✓ 22-error-recovery.spec.ts:33 preset failure preserves input; successful save and failed refresh remain distinct without a repeated POST
  ✓ 22-error-recovery.spec.ts:66 partial uploads retain unknown outcomes across tabs, never auto-navigate/retry, and clear on logout
  6 passed (14.6s)
  6 passed (14.4s)
```

The other 4 tests in these 2 files were untouched and pass unchanged,
confirming no unrelated regression was introduced by the edits.

Cleanup performed: uvicorn process killed, `/tmp/p3fix.db` and
`/tmp/p3fix.log` removed, `test-results/` and `playwright-report/` removed
from the worktree. `git status --porcelain` after cleanup shows only the 2
intended spec files modified.
