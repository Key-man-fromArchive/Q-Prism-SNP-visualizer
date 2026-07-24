# Guided Import Wizard — Design Memo

- Status: Draft v0.2 (codex R1 amended)
- Scope: `snp-analyzer/frontend/src/components/upload/ImportMappingWizard.tsx` — convert the flat expert form into a guided 4-step flow. **Frontend only** (no backend/API contract change). Plus finish residual i18n (~22 strings) across the app.
- Goal (user): make preview→import "아주 쉽게" (very easy) — confirm auto-detected mapping in guided steps instead of facing every control at once.

## 1. Current behavior (facts to preserve)

- Single panel renders all at once: summary tiles → table structure (structure/delimiter/decimal/header+firstDataRow) → column mapping (well/cycle/sample/target + long:dye/rfu/role or wide:per-channel rfu) → assay role binding (mode + per-channel role + normalization) → validation summary + issues → collapsible raw-data table → **Import button (always enabled** except while importing/previewing).
- State: `structure` (long|wide), `mapping: MappingConfig`, `issues` (from parse attempt), `unsupported`, `submitError`, `importing`.
- `preview.suggested_mapping` + `preview.column_candidates` + `preview.assay_mode_candidates` drive auto-detected defaults (`buildInitialMapping`).
- `channels = detectChannels(...)`; `localIssues = buildLocalIssues(mapping, channels, t)`; `allIssues = [...previewIssues, ...preview.warnings, ...issues, ...localIssues]`.
- `ValidationIssue.recoverable: boolean` — recoverable (e.g. `decimal_separator_mismatch`) shows a warning + inline fix (e.g. "use comma decimal"); non-recoverable = blocking.
- `handleImport()` calls `parseImportPreview({preview_id, mapping})`; response may be validation (issues), unsupported, or success (`UploadResponse` → `onImported`).
- Selectors/testids and existing i18n keys (`imw*`) must be preserved.

## 2. Guided flow (4 steps)

Step indicator (1..4) with titles; **Back/Next** footer; the collapsible raw-data preview stays available on every step (moved into a persistent footer/side region, `open` only on the last step by default).

| Step | Title | Controls (existing, regrouped) | Complete-when (Next enabled) |
| :-- | :-- | :-- | :-- |
| 1 | 표 구조 | structure long/wide, delimiter, decimal, header_row, first_data_row | always (all have defaults) |
| 2 | 컬럼 매핑 | well, cycle, sample?, target? + long: dye, rfu, role? / wide: per-channel rfu | `well_column` && `cycle_column` set; long: `dye_column` && `rfu_column` set; wide: ≥1 `rfu_columns` entry **and every mapped value ∈ `preview.inferred_headers`** (reject stale/removed columns — server treats any non-empty `rfu_columns` as wide and fails on a bad header) |
| 3 | 역할 배정 | assay_mode, per-channel role, normalization | every `requiredRoles` (from mode) bound to ≥1 channel; no duplicate binding for unique roles; **if `normalization_mode === "passive_reference"`, a `normalization` role must be bound** (server rejects passive-reference without a normalization channel — `assays/registry.py`) |
| 4 | 검토 & 가져오기 | validation summary (mode/normalization/role-binding), issues list, Import | — (terminal) |

- **Step validity** is derived (pure function `stepStatus(step, mapping, structure, channels, localIssues)`), not stored. Next disabled when current step invalid; clicking a completed step in the indicator jumps to it. The step-3 normalization + wide-header checks above are ADDED to `buildLocalIssues` (or a step-validity helper) so they gate consistently and can surface as inline issues.
- **Import gating (key change, scoped honestly)**: Local validity is NOT equivalent to full server validation — row-level problems (malformed wells, formula/invalid RFU, duplicate readings, cycle consistency, size limits, empty channels) are only known after `/parse` (`app/parsers/generic_table.py`). So:
  - Import is enabled when **steps 2 & 3 are complete and there is no *known* blocking (non-recoverable local) issue** — this removes the "obviously-broken mapping → click → error" trap.
  - After submit, server validation issues (from `parseImportPreview`) are still possible. On a returned validation response, surface those issues and **route the user to the most relevant step** (column/role) with the issue shown in context; keep a clear recovery path (edit mapping → re-import, re-preview, or replace file). Import stays enabled for retry after the user changes the mapping.
  - The memo does NOT claim client gating guarantees a successful import — only that it prevents the obviously-invalid submits.
- Note: `buildLocalIssues` filters roles to *detected* channels and marks its issues recoverable; it does not fully mirror server mapping validation. Keep its explicit checks (required/duplicate/normalization) but treat server issues as the source of truth post-submit.
- **Auto-detect badges**: a small "자동 감지됨" badge next to any field whose current value equals the parser's suggestion/candidate (`suggested_mapping[x]` or `column_candidates`), so the user sees "just confirm". Purely visual; no logic change.
- Validation issues relevant to a step also surface **on that step** (not only step 4) so problems are fixed in context; step 4 shows the full list.

## 2a. State reset & re-evaluation (codex R1 #5)

- New `currentStep` state must **reset to Step 1** whenever the mapping is rebuilt: (a) on `preview` change / re-preview (existing effect at wizard `useEffect([preview])`), and (b) on structure change (`setStructureMode` rebuilds the whole mapping). Otherwise the user can sit on Step 3 while step-2 fields were reset underneath.
- Assay-mode change preserves existing roles except normalization (existing `setAssayMode`); Step-3 validity (required/duplicate/normalization) is derived, so it re-evaluates immediately on any role/mode change — no extra wiring needed beyond deriving validity from current `mapping`.
- Channel set changes (wide RFU add/remove, long dye column change) re-run `detectChannels`; step-2/3 validity derives from the current `channels`, so it stays correct.

## 3. Non-goals / constraints

- No live result (scatter/plate) preview — requires a backend mapped-preview endpoint that does not exist (N1: no backend change). Step 4 keeps the validation summary + raw-data preview.
- No change to `MappingConfig`, parse/preview API calls, or `onImported` contract.
- Preserve all `data-testid`/`id` and `imw*` i18n keys; add new keys for step titles/nav/badges (en+ko).
- Reuse existing primitives (`Button`, `Card`, `Callout`, `Field`) and `SegmentedButton`/`ColumnSelect`/`SummaryItem`/`IssueRow`.

## 4. Residual i18n (finish, same change set)

Localize remaining user-facing fallback strings (dev `console.error` excluded):
- `BatchTab` ~15 `'Failed to …'` fallbacks + 3 add-to-project messages
- `ProtocolTab` (2), `CompareTab` (2), `QualityTab` (1), `StatisticsTab` (1), `UploadZone` ("Failed to load example"), `AmplificationOverlay` ("Loading overlay…")
- Approach: generic reusable keys where the fallback is a plain "load/save/delete failed" + specific ones where context differs; add to `en.ts` + `ko.ts`.

## 5. Test / QA

- Vitest: `stepStatus` pure-function unit tests (each step's complete-when), and a render test that Import is disabled with a blocking issue and enabled when clean.
- **e2e WILL break and must be updated**: `tests/06-import-mapping.spec.ts` asserts Column Mapping / Assay Role Binding / Validation Preview are all visible before Import — a stepped UI hides later steps. Update the spec to advance through steps (Next) before asserting later-step content / clicking Import. Add stable step-nav `data-testid`s (`wizard-step-<n>`, `wizard-next`, `wizard-back`, `wizard-import`) and preserve existing accessible names/labels so field interactions still resolve.
- Manual QA: generic long CSV + wide CSV via the templates through all 4 steps, light/dark, ko/en.
