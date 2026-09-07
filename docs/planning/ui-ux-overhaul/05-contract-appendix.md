# UI/UX v0.2 API Contract Appendix

P0-T0.1 · Contract `qprism-ux-followup-20260907-v1` · 2026-09-07

This is the P1 implementation contract, not a claim that these fields already exist. PRD §5 remains authoritative. Existing route paths and successful legacy response fields remain unless explicitly restricted below. No scientific algorithm or threshold changes are authorized.

## 1. Persisted result and revisions

`ClusteringResult.analysis_context` is nullable. A missing/null context means `legacy_unknown`; never infer it from current settings. Existing assignments remain readable. Add `context_status: verified | legacy_unknown` to result responses, and `input_revision` (current server input version) to result/session-info responses. Context stores its own captured input revision, so stale results remain distinguishable and inspectable.

Result/session-info responses also expose `analysis_status: idle | computing | completed | failed` and `analysis_pending: boolean`. These describe the latest accepted request, independently of the retained completed result. An obsolete request cannot overwrite this status when it finishes. Missing context remains unknown even when a legacy completed result is available.

| Context field | Type and meaning |
| --- | --- |
| schema_version | integer, initially 1 |
| result_revision | opaque server UUID string, unique per successfully published result |
| analysed_at | timezone-aware ISO-8601 UTC completion timestamp |
| cycle | actual absolute acquisition cycle present in unified.cycles, including 0 when supported by that data window; resolve request cycle=0 sentinel before storing the actual value |
| use_rox | requested boolean |
| normalization_applied | true only when normalization is enabled and at least one captured-cycle reading has a positive effective reference; not a claim that every reading was normalized. Missing/nonpositive references retain existing raw fallback behavior |
| background | `none`, `pre_read`, or `channel_min`, resolved before storing |
| algorithm | actual existing algorithm identifier; context-only `mixed` when marker regions actually used different algorithms. Each region retains its actual identifier; this does not add a calculation algorithm or alter the legacy result.algorithm echo |
| parameters | JSON object of resolved ploidy, n_clusters, threshold_config and all algorithm-specific inputs, including manual boundaries/dosage configuration; defaults must be explicit, never copied from a later request |
| regions | array of marker snapshots: marker_id, name, wells, ploidy, algorithm, parameters; empty for whole-plate mode; resolve inherited defaults independently per marker |
| input_revision | nonnegative integer captured before calculation |

Capture `parameters.manual_well_types` separately from merged `effective_well_types`, including an explicit empty map. Instrument-imported `Unknown` denotes an ordinary sample and must not override its saved genotype; an explicit operator `Unknown` override retains its existing meaning. Judgment/export precedence uses meaningful non-Unknown imported types plus captured explicit manual overrides, then saved calls. Never consult the live override map to reconstruct old provenance. Contexts lacking this distinction are unavailable for verified judgment/export rather than silently backfilled.

Persist context, assignments, confidences and existing result fields together. Initialize each new or migrated session input revision to 0 without assigning a verified context to legacy results. Increment once per effective atomic input mutation; failed and no-op operations do not increment. Revisions survive restart. A result publication does not increment input_revision.

P1 source review clarified two provenance cases: manual boundaries execute threshold even when another algorithm was requested, and marker runs may combine threshold with auto. Record the actual region algorithms and use the context-only aggregate label above, keeping the requested algorithm in `parameters.requested_algorithm`. Client setting comparison/restoration uses that request value, not a misleading comparison against the effective `mixed`/threshold label. Preserve the existing cycle=0 last-cycle request sentinel; this phase does not introduce a new transport mechanism for selecting absolute zero in a multi-cycle run. Store the actual resolved cycle (which can be zero for a zero-only acquisition).

All computation starts by capturing immutable input/parameter copies plus a monotonically increasing per-session request sequence. Publish only if input_revision still matches and no newer request has been accepted. A newer failed request also prevents an older request from publishing. DB commit must succeed before replacing in-memory result; calculation/save failures retain the previous completed result. Use a per-session serialization/CAS boundary, not a global lock. Record whether deployment supports one process only; an in-process lock is not a multi-worker guarantee. Restart must restore identical DB/memory state. Do not use `INSERT OR REPLACE sessions` for a revision bump: it may cascade-delete dependent data.

## 2. Mutation inventory and compatibility

Existing mutation request bodies gain optional `expected_input_revision: int`; DELETE variants accept an optional query parameter with that name. Successful mutation responses add `input_revision`; all existing payload fields remain. Validate authorization and input before comparing/mutating. A mismatch returns 409 without partial changes, including undo/redo. Bulk/layout operations increment once for their complete transaction.

| Existing surface | Revision policy |
| --- | --- |
| POST/DELETE welltypes; PUT welltypes/bulk | Increment when the explicit override map changes, including clear; preserve imported type fallback. An explicit override equal to its imported fallback still changes manual command state; repeating the identical override or clearing an already empty map is a no-op |
| POST ploidy | Increment for changed session ploidy |
| POST cluster with explicit session ploidy | Preserve the existing persisted-ploidy behavior through the same input command. A successful input commit remains effective if subsequent calculation fails; the retained previous result is stale. Invalid input or a failed input transaction does not advance the revision |
| POST/PUT/DELETE markers | Increment for changed assignments or effective marker analysis configuration; marker set deletion also invalidates results |
| POST layouts/{id}/apply | Atomically apply all affected marker/type/ploidy inputs and increment once |
| POST data/{sid}/markers/{id}/attach-catalog | Increment when applied calibration/marker configuration changes; include routers/marker_catalog.py in P1-R1-T2 scope |
| New imported session/data replacement | New session starts at 0; any future in-place raw-data replacement must increment under the same boundary |
| Sample names, protocol display steps, well groups, catalog/library edits not applied to a session | No judgment revision: display/report metadata only; freeze at accepted export |
| Marker selection, chart axes, language/theme, navigation, view cycle/settings | No server input mutation; view mismatch derives from context comparison |

Retain latest completed result after input mutation, marked stale by unequal revisions; do not silently discard its provenance or allow verified export. Session deletion removes all state under existing authorization rules. Capture region definitions even when passed directly in a clustering request rather than stored markers.

## 3. Export and error contract

CSV, PDF, XLSX and ASG report creation use one shared validated snapshot builder. Optional query/body `result_revision` binds the desired latest result; omission selects the latest only after identical validity checks. Legacy cycle/use_rox/background parameters become optional and, when explicitly supplied, must equal stored resolved conditions. Never silently apply endpoint defaults over the snapshot. Check access before exposing revision/state information.

An explicitly supplied legacy cycle sentinel (`cycle=0`) resolves to the run's last acquisition before comparison; omission selects the stored cycle. It is not a new absolute-zero selection mechanism. Latest-request failure alone is not a new export error: a retained completed result may pass the existing revision/condition checks, while a committed input change makes it stale and blocks export. The response/UI must continue distinguishing that retained result from the failed request.

Errors use existing FastAPI envelope with structured detail: `{"detail":{"code":"INPUT_REVISION_CONFLICT","message":"…","current_input_revision":2}}`. New clients branch on code, not English text; tolerate legacy string detail for other errors. Optional revision identifiers are returned only after authorization.

| HTTP/code | Condition and client action |
| --- | --- |
| 409 NO_COMPLETED_RESULT | No result available; analyze first |
| 409 LEGACY_CONTEXT_UNKNOWN | Context missing or required captured provenance incomplete; reanalyze, no last-condition export |
| 409 INPUT_REVISION_CONFLICT | Mutation expected revision or captured calculation input is stale; refresh and retry explicitly |
| 409 RESULT_REVISION_CONFLICT | Requested result was replaced; refresh result and reconfirm |
| 409 ANALYSIS_SUPERSEDED | Older calculation finishes after a newer accepted request; ignore obsolete completion |
| 409 ANALYSIS_IN_PROGRESS | A calculation is active; wait rather than exporting prior data as current |
| 409 EXPORT_CONDITION_MISMATCH | Explicit legacy conditions differ; choose stored conditions or reanalyze |
| 400 / 422 | Preserve existing invalid background/domain validation behavior |
| 401 / 403 / 404 / 5xx | Preserve auth mode, concealed-resource 404, not-found and operational error distinctions |

Once validation accepts an export, deep-copy input coordinates, context, assignments, confidences, region names, sample overrides and report labels within the same serialization boundary. Later mutations cannot change that file. Latest-only history means an already replaced result cannot be requested again. Whole-run reports ignore selected wells/groups; include marker columns and explicit unassigned/empty/omit meanings. CSV retains existing columns and appends context/marker metadata. PDF/XLSX embed equivalent report information. Filename includes whole-run scope and cycle. PNG is client-rendered active-chart scope with result revision, conditions and active filter caption; require matching render completion.

Whole-run rows cover every unified well, including unavailable captured-cycle readings (blank coordinates plus read status). Use captured effective/manual types and saved calls, never export-time ratio inference. Preserve Empty/Omit and saved Undetermined; wells outside captured marker membership are Unassigned, otherwise an absent saved call is Unknown. Keep existing CSV column ordering/precision as a prefix and append provenance/availability fields. Historical raw columns mean post-background, pre-reference values; the passive reference may not be ROX. Add explicit basis/dye metadata rather than silently redefining their numbers. Freeze imported plus overridden sample names, groups, protocol and filename at acceptance. Spreadsheet-safe text encoding must not change numeric negative signals or raw snapshot labels; XLSX text cells must not become formulas.

## 4. QC and recommendation

Keep `ntc_check.ok` and `wells`. Add `status: ok | warning | no_ntc | insufficient`; each well gains `flagged: boolean | null` and `reason: none | signal_above_threshold | missing_signal | missing_reference | insufficient_points`. `flagged=null` means evaluation unavailable. Use current threshold logic: any flagged true gives warning; otherwise any unevaluable NTC gives insufficient; zero NTC gives no_ntc; only all evaluable unflagged gives ok. A legacy `ok=true` with no wells is not proof of clean controls.

Label plate NTC with `scope: plate` and its actual requested cycle/use_rox/normalization_applied/background. Judgment QC carries `result_revision`, captured `input_revision`, current input revision and analysis_context. `authoritative=markers` exposes existing per-marker metrics and hides meaningless pooled separation in clients. With no selected marker show marker summaries. Never compute stored-assignment separation from different view coordinates.

QC adds `judgment_status: verified | stale | legacy_unknown | missing` and `judgment_reason: none | input_changed | context_missing | no_completed_result`, alongside `analysis_status`/`analysis_pending`. Stale verified results retain metrics computed from captured conditions/types/regions, not current manual edits. Contextless results may retain readable assignment counts, but separation is null because its coordinate conditions are unknown. Missing results must not describe ratio-based provisional calls as completed judgment. Current plate NTC remains separately evaluable in both cases.

A present context whose required calculation provenance keys are incomplete also yields unavailable judgment (`legacy_unknown/context_missing`) rather than guessed coordinates or a server error; retain its original context for inspection. `context_status` continues to describe context presence, while `judgment_status` describes QC usability. Preserve existing separation spaces: whole-plate separation uses measured normalized points at the stored conditions; per-marker separation retains the existing origin-adjusted points. Origin clamping must not silently redefine the whole-plate metric.

Enumerate declared effective NTC wells before joining readings: an unavailable reading remains in `wells` with nullable `signal`, `flagged=null` and its reason, never an invented zero. `missing_reference` refers to the usable plate signal reference; absent ROX alone does not invalidate existing raw fallback. Preserve the upper-middle plate median and existing contamination threshold. Onset status annotates actual evaluation; fewer than nine readings cannot support the existing derivative detector even if the outer window check passes.

Cycle recommendation retains `ntc_onset_cycle` and adds `ntc_onset_status: detected | not_detected | not_evaluated` and `ntc_onset_reason: none | no_ntc | missing_signal | insufficient_points`. Detected requires a cycle; not_detected means evaluation actually ran; not_evaluated is not a clean QC result. QC thresholds and onset detection remain distinct. Request generation/session identity prevents late QC overwrites.

If incomplete curves were dropped, absence of detected onset is not proof of a complete negative evaluation: report `not_evaluated/missing_signal`. A genuinely detected onset remains detected. This annotates availability without changing the detector or recommendation's numerical output.

## 5. Client owners and transitions

| Owner | Responsibility |
| --- | --- |
| session-store | Run data and server session identity |
| analysis-store | Latest server result, request generation, idle/computing/completed/failed; derive legacy, input-stale and view-mismatch independently |
| navigation-store | session/tab/surface/marker/absolute cycle, restoring/ready/error; URL sync |
| settings-store / selection-store | Current calculation/view settings and selected wells, respectively |
| undo-store | One shared session-scoped manual-type command history, max 50, pointer moves only after server success |
| upload-job-store | In-memory per-file outcomes including unknown; survives tabs, clears reload/logout |

Restore auth → run → markers/result → validate URL/window → atomically apply settings/cycle → ready. Disable initialization side effects, URL writes and multi-marker auto-analysis throughout restoration and its first ready transition. URL navigation overrides valid stored result defaults; per-user/session sessionStorage settings override context, then data-valid defaults. Preserve existing theme/language storage. Push discrete navigation; replace continuous cycle; popstate restores without rewriting. Late previous-session requests never populate the new session.

Single analysis remains explicit except first new upload without saved result. Multi-marker uses the existing 220 ms input-settle auto policy after restoration, paused during playback. Explicit current-cycle reanalysis must not call recommendation. Export mismatch offers current reanalysis, valid stored result or cancel; PNG stored choice first moves and renders the view. Input-stale/legacy forbids stored choice. Undo conflicts invalidate history; failed calls preserve pointer; sample/marker/history expansion is out of scope.
