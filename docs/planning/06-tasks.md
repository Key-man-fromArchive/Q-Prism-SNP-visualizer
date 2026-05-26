# qPCR Import Expansion Tasks

## Scope

This plan implements the qPCR import expansion described in `docs/qpcr-import-expansion-plan.md`. The central contract is role-aware import: raw readings are collected as `well, cycle, reporter channel, RFU`, then channels are mapped to assay roles `WT`, `MT1`, `MT2`, `MT3`, `normalization`, or `excluded`. Dye names are metadata, not fixed allele semantics. Normalization is conditional on the selected assay mode.

## Interface Contract Validation

### Domain Resources

- `ImportRun`: instrument metadata, plate geometry, reporter channels, readings, samples, targets, Cq values.
- `ReporterChannel`: file-stable channel id, optional dye name, assigned role.
- `AssayMode`: supported role set, normalization requirement, validation rules.
- `MappingConfig`: file structure mapping plus channel-to-role binding.
- `ImportPreview`: preview id, candidate tables/sheets, inferred headers, sample rows, channel candidates, warnings.
- `ImportSession`: shared session creation path for direct upload and mapped import.

### Screens & Data Requirements

- Upload screen needs supported formats, template downloads, direct upload result, and ambiguous-file preview routing.
- Mapping wizard needs `ImportPreview`, editable `MappingConfig`, validation messages, and representative curve/scatter previews.
- Analysis screen needs a session created through the same persistence/auth/ASG binding path as existing uploads.

### ICV Result

- Coverage: complete at planning level.
- Known gap: current backend `UnifiedData` is `fam/allele2` oriented. WT/MT duplex can use an adapter, but triplex/quadruplex requires role-aware analysis model work before full visualization.

## Phase P0: Project Setup & Fixtures

### P0-R1-T1: Create Committed Synthetic Import Fixtures

- Add fixture folders for `generic_long`, `generic_wide`, `rdes_extension`, `strict_rdes`, and invalid cases.
- Include WT/MT, WT/MT + normalization, WT/MT1/MT2, and WT/MT1/MT2/MT3 examples.
- Include decimal comma, semicolon delimiter, malformed well, duplicate `(well, cycle, channel)`, missing required role, missing normalization channel, inconsistent cycle count, and Cq/endpoint-only cases.
- Maintain a fixture coverage table that maps each parser to required assay modes and invalid cases.
- Verification: parser fixture files are small, anonymized, deterministic, and documented.

Required fixture matrix:

| Parser path | Required valid cases | Required invalid/recovery cases |
| --- | --- | --- |
| Generic long | WT/MT, WT/MT + normalization, WT/MT1/MT2, WT/MT1/MT2/MT3 | missing role, malformed well, duplicate channel row, decimal comma, semicolon delimiter, Cq-only |
| Generic wide | WT/MT, WT/MT + normalization, WT/MT1/MT2, WT/MT1/MT2/MT3 | missing mapping config, duplicate role binding, missing normalization channel |
| Q-Prism RDES extension | WT/MT, WT/MT + normalization, WT/MT1/MT2 | malformed cycle columns, inconsistent cycle count, missing RFU |
| Strict RDES | mapping-required preview only | direct auto-import blocked with preview-required response |
| RDML | public smoke fixtures, single-run synthetic fixture where possible | multi-run requires selection, missing raw curves, unsupported channel set |

### P0-R1-T2: Collect Public RDML/Roche Smoke Fixtures

- Add source notes for RDML R package, RDML-tools, and tidyqpcr examples.
- Only commit files whose licenses permit repository use; otherwise add fetch instructions.
- Verification: fixture provenance is documented and CI does not depend on unavailable local paths.

### P0-S1-T1: Add Static Template Files

- Add `qprism-rdes-amplification-template.tsv`, `qprism-generic-long-template.csv`, and `qprism-generic-wide-template.csv`.
- Keep template files machine-readable with no comment rows.
- Verification: each downloadable template has a matching strict structure parser or mapping-required validation test.

## Phase P1: Canonical Import Backend

### P1-R1-T1: Define Import Domain Models

- Add Pydantic models for `ImportRun`, `ReporterChannel`, `AssayMode`, `MappingConfig`, `ImportPreview`, and validation errors.
- Represent role binding separately from dye/channel names.
- Support roles `WT`, `MT1`, `MT2`, `MT3`, `normalization`, `excluded`, and `unknown`.
- Verification: unit tests cover model validation and serialization.

### P1-R1-T2: Implement Assay Mode Registry

- Define supported modes: WT/MT, WT/MT + normalization, WT/MT1/MT2, WT/MT1/MT2/MT3.
- Encode required roles, optional roles, and normalization rules.
- Reject duplicate role bindings and missing required roles.
- Verification: tests assert valid/invalid mappings for each assay mode.

### P1-R2-T1: Add Parser Registry Contract

- Implement parser contract: `sniff`, `preview`, `parse`, and `to_unified` or future role-aware conversion.
- Order parser precedence as vendor, standard, generic.
- Preserve existing QuantStudio/Bio-Rad dispatch behavior.
- Verification: detector precedence tests prove existing `.eds`, `.xls`, `.pcrd`, `.xlsx`, and `.zip` behavior is unchanged.

### P1-R2-T2: Define Preview-Required Upload Contract

- Extend direct upload handling with a typed `preview_required` response for ambiguous/RDML/RDES/generic files.
- Preserve the current `UploadResponse` contract for direct vendor uploads.
- Avoid converting ambiguous imports into plain 400 parse failures when preview can recover them.
- Verification: API tests cover direct vendor success, preview-required response, unsupported file rejection, and existing client compatibility.

### P1-R3-T1: Add Shared Import Session Service

- Factor common session creation from current upload flow into `create_session_from_import(...)`.
- Preserve SQLite persistence, ASG binding, suggested cycle calculation, ownership, and cleanup.
- Route direct uploads and mapped imports through the shared service.
- Verification: API tests confirm direct upload response remains backward compatible.

## Phase P2: Strict Template Parsers

### P2-R1-T1: Implement Generic Long Parser

- Parse `well,cycle,dye,role,rfu,sample,target,sample_type`.
- Validate finite RFU values, supported well IDs, cycles, channel uniqueness, and required role coverage.
- Verification: golden tests assert wells, cycles, readings count, role bindings, samples, and expected errors.

### P2-R1-T2: Implement Generic Wide Parser

- Parse exact channel-neutral headers: `ch1_rfu`, `ch2_rfu`, `ch3_rfu`, `ch4_rfu`.
- Require explicit mapping config for channel-to-role binding.
- Verification: tests cover WT/MT, WT/MT + normalization, triplex, quadruplex, and invalid mappings.

### P2-R1-T3: Implement Mapping-Configured Generic Table Parser

- Parse arbitrary CSV/TSV/TXT/XLSX tables using `MappingConfig` from the preview workflow.
- Apply user-confirmed delimiter, decimal separator, header row, first data row, well/cycle/sample/target columns, channel columns or dye rows, and RFU value mapping.
- Support `.txt` as RDES-compatible or generic delimited text when preview detects a tabular structure.
- Verification: tests cover non-template CSV/TSV/TXT/XLSX imports, decimal separator correction, missing structural fields, and Cq/endpoint-only rejection with user-facing messages.

### P2-R2-T1: Implement Q-Prism RDES Extension Parser

- Parse RDES-style cycle columns with Q-Prism `Role` column.
- Treat strict RDES without `Role` as mapping-required, not auto-importable.
- Verification: extension parser round-trips the downloadable template.

### P2-R2-T2: Add File Safety Limits

- Apply upload size, preview row caps, sheet caps, cycle/well/channel caps, and numeric finiteness validation.
- Reuse ZIP hardening for `.rdml`, `.rdm`, `.xlsx`, and `.zip`.
- Use safe XML parsing for RDML/XML.
- Verification: invalid large/malformed inputs, inconsistent cycle count, and formula-as-RFU inputs fail before session creation with structured errors.

### P2-R3-T1: Implement Import Error Recovery Policy

- Encode recoverable vs blocking errors for unsupported content, Cq/endpoint-only files, missing fields, malformed wells, duplicates, missing roles, missing normalization, decimal mismatch, and inconsistent cycle counts.
- Define duplicate and inconsistent-cycle behavior explicitly: block by default, allow future exclusion/repair only through explicit user action.
- Return structured error codes and row/column context for UI recovery.
- Verification: parser and API tests assert each taxonomy item and expected user-facing message.

## Phase P3: Preview APIs & Mapping Workflow

### P3-R1-T1: Implement `POST /api/import/preview`

- Return owner-bound `preview_id`, table/sheet candidates, inferred delimiter, decimal separator, header/data rows, well/cycle/RFU/sample/target column candidates, channel candidates, assay-mode candidates, sample rows, and warnings.
- Store preview uploads with TTL and cleanup.
- Verification: API tests cover CSV, TSV, XLSX, strict RDES, ambiguous files, and unsupported types.

### P3-R1-T2: Implement `POST /api/import/parse`

- Accept `preview_id` plus `MappingConfig`.
- Produce `ImportRun`, validate assay mode, and create a session through shared session service.
- Until P5 role-aware analysis is complete, only WT/MT-compatible mapped imports may create analysis sessions. WT/MT1/MT2 and WT/MT1/MT2/MT3 imports remain preview-only or return a structured unsupported-analysis-mode response.
- Do not create sessions for validation failures.
- Verification: API tests cover success, recoverable validation errors, triplex/quadruplex preview-only gating, expired preview ids, and unauthorized preview access.

### P3-S1-T1: Add Template Download UI

- Add a download menu near the upload zone for RDES extension, generic long CSV, and generic wide CSV.
- Show only templates that can be parsed in the current release.
- Verification: Playwright confirms each template downloads and can be uploaded into preview/import flow.

### P3-S2-T1: Add Mapping Wizard UI

- Build wizard steps: upload preview, worksheet/table selection, delimiter/decimal/header/data row confirmation, format selection, file structure mapping, assay role mapping, validation preview, import.
- Separate channel detection from assay role binding.
- Allow returning to mapping without re-uploading.
- Show Cq/endpoint-only guidance, missing structural field recovery, duplicate blocking, decimal separator correction, and inconsistent cycle count messaging.
- Verification: Playwright covers a successful WT/MT + normalization import, recoverable missing-role error, decimal separator correction, and Cq-only rejection.

### P3-S2-T2: Add Validation Preview UI

- Display wells count, cycles range, detected channels, selected assay mode, role binding, missing values, duplicates, and representative curves/scatter.
- Use role-pair scatter labels, such as WT vs MT1.
- Verification: UI test asserts validation messages and preview summaries for valid and invalid fixtures.

### P3-S3-T1: Define Mapping Preset Persistence Scope

- Decide whether mapping preset save/reuse ships in this release or is explicitly deferred.
- If shipped, persist user-owned presets for repeated file structures and assay role mappings.
- If deferred, keep vendor presets as non-persistent defaults only and document the limitation.
- Verification: tests cover either saved preset reuse or explicit absence of persistence UI.

## Phase P4: RDML & Vendor Expansion

### P4-R1-T1: Implement RDML Preview Parser

- Parse `.rdml`/`.rdm` archives with safe XML parsing.
- Extract runs, targets, dyes, reactions, amplification data points, and candidate channel mappings.
- Default RDML to preview-first because files may contain multiple runs/targets.
- Verification: RDML public smoke fixtures produce candidate previews without direct session creation.

### P4-R1-T2: Implement RDML Mapped Import

- Convert selected RDML run/target/channel mapping into `ImportRun`.
- Require explicit assay role confirmation unless the file has exactly one valid mapping.
- Verification: tests cover single-run, multi-run, missing raw curves, and unsupported channel sets.

### P4-R2-T1: Add Vendor Preset Framework

- Add presets for Roche LightCycler text export, Analytik Jena qPCRsoft CSV/XLSX, and Qiagen Rotor-Gene RDML.
- Presets should prefill mapping, not bypass validation.
- Verification: preset tests prove manual override still works.

## Phase P5: Role-Aware Analysis Extension

### P5-R1-T1: Define Role-Aware Analysis Model

- Extend or replace `UnifiedData` so downstream analysis can represent WT/MT1/MT2/MT3 channels.
- Keep backward-compatible adapter for existing WT/MT duplex flows.
- Verification: existing QuantStudio/Bio-Rad tests remain green.

### P5-R2-T1: Update Normalization Logic

- Refactor normalization to use selected normalization channel and mode, not a hardcoded ROX field.
- Support raw mode when normalization is absent or disabled.
- Verification: tests compare raw vs normalized output for WT/MT + normalization fixtures.

### P5-S1-T1: Update Analysis Visualizations For Role Labels

- Replace dye-fixed labels with role-aware labels while preserving dye metadata in tooltips/reports.
- Support role-pair scatter selection for triplex/quadruplex.
- Verification: Playwright covers WT/MT and WT/MT1/MT2 role labels.

## Phase P6: Release Gates

### P6-V1: Backend Regression Gate

- Run backend parser/API tests.
- Confirm existing vendor import behavior is unchanged.
- Confirm invalid imports do not create sessions.

### P6-V2: Frontend E2E Gate

- Run Playwright upload, template download, mapping wizard, validation error, and existing upload regression specs.
- For every downloadable template, verify template -> upload -> preview -> import -> analysis screen smoke path.
- At minimum, render scatter, plate, amplification curve, and QC entry points for WT/MT and WT/MT + normalization template sessions.
- Confirm UI routes ambiguous files to preview instead of plain failure when applicable.

### P6-V3: Documentation Gate

- Update README supported formats and upload guidance.
- Link template documentation and explain strict RDES vs Q-Prism RDES extension.
- Document that dye/channel names are separate from WT/MT roles.

## Dependency Summary

- P0 fixtures/templates must precede parser implementation.
- P1 canonical models and assay modes must precede P2 parsers.
- P1 shared session service must precede P3 parse API.
- P1 preview-required upload contract must precede frontend ambiguous-file routing.
- P2 strict parsers can run in parallel after P1-R1 and P1-R2.
- P2 mapping-configured generic parser must precede full non-template mapping wizard release.
- P3 UI depends on preview/parse APIs.
- P4 RDML can start after parser registry and preview API exist.
- P5 role-aware visualization should not block strict WT/MT duplex import, but triplex/quadruplex imports must remain preview-only until P5 is complete.

## Definition of Done

- Every downloadable template can be uploaded, previewed, validated, and imported in the same release.
- Every downloadable template can open the analysis screen and render core downstream views when its assay mode is supported for session creation.
- Every import path stores channel/dye metadata separately from WT/MT roles.
- Normalization is selected by assay mode and mapping config, not inferred from the name ROX alone.
- Triplex/quadruplex data cannot create analysis sessions until the role-aware analysis model and visualization support are complete.
- Arbitrary user tables are supported only through mapping-configured parsing, not silent fuzzy auto-import.
- Parser additions do not regress existing QuantStudio/Bio-Rad uploads.
- Tests include parser unit tests, API tests, Playwright mapping tests, and existing upload regressions.
