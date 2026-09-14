/**
 * TypeScript types mirroring backend Pydantic models
 * Auto-generated from backend API specification
 */

// ============================================================================
// Core Data Models
// ============================================================================

export type WellCycleData = {
  well: string;
  cycle: number;
  fam: number;
  allele2: number;
  rox: number | null;
};

export type NormalizedPoint = {
  well: string;
  cycle: number;
  norm_fam: number;
  norm_allele2: number;
  raw_fam: number;
  raw_allele2: number;
  raw_rox: number | null;
  /** Whether THIS reading was actually divided by its passive reference --
   *  not the response-wide `normalization_applied`. A well whose ROX read 0
   *  falls back to raw while a neighbour on the same response divides
   *  normally; see P23-NORM-SCALE.md. */
  normalized?: boolean;
};

export type DataWindow = {
  name: string;
  start_cycle: number;
  end_cycle: number;
};

export type ProtocolStep = {
  step: number;
  temperature: number;
  duration_sec: number;
  cycles: number;
  label: string;
  phase: string;
  goto_label: string;
  /** Whether this step actually reads the plate; source of truth for the
   *  camera marker (do NOT infer this from `label`, which is free text). */
  plate_read: boolean;
  /** Per-cycle touchdown temperature delta (signed; e.g. -0.6 for a 0.6°C/cycle
   *  ramp-down). `null` when this step has no touchdown. */
  temp_increment: number | null;
  /** Per-step read channels. Always empty for formats that only carry a
   *  run-wide channel list (see `ProtocolResponse`'s role-label metadata) —
   *  do not treat an empty array as "no channels were read". */
  read_channels: string[];
};

export type UnifiedData = {
  instrument: string;
  allele2_dye: string;
  wells: string[];
  cycles: number[];
  data: WellCycleData[];
  has_rox: boolean;
  sample_names: Record<string, string> | null;
  imported_well_types?: Record<string, string> | null;
  imported_markers?: Record<string, string[]> | null;
  protocol_steps: ProtocolStep[] | null;
  data_windows: DataWindow[] | null;
};

// ============================================================================
// Upload & Session
// ============================================================================

export type UploadResponse = {
  session_id: string;
  /** Operator-facing plate identity, for switching between several open
   *  files — a session id is not something anyone recognises. */
  raw_filename?: string;
  /** Exact run inventory; absent on legacy servers, never infer from the current cycle. */
  well_ids?: string[];
  instrument: string;
  allele2_dye: string;
  num_wells: number;
  num_cycles: number;
  has_rox: boolean;
  data_windows: DataWindow[] | null;
  suggested_cycle: number | null;
  /** Background modes this run can legitimately be read with. The excluded
   *  ones distort rather than baseline it — a per-cycle plate floor changes the
   *  SHAPE of a multi-cycle curve, not its offset, and can erase a Ct outright.
   *  Decided by the backend; the client offers exactly these. */
  background_modes?: BackgroundMode[];
  well_groups: Record<string, string[]> | null;
};

export type ImportRole =
  | 'WT'
  | 'MT1'
  | 'MT2'
  | 'MT3'
  | 'normalization'
  | 'excluded'
  | 'unknown';

export type AssayModeId = 'wt_mt' | 'wt_mt1_mt2' | 'wt_mt1_mt2_mt3';

export type NormalizationMode = 'none' | 'passive_reference' | 'custom' | 'manual';

export type ReporterChannel = {
  channel_id: string;
  dye_name: string | null;
  role: ImportRole;
};

export type ValidationIssue = {
  code: string;
  message: string;
  recoverable: boolean;
  row: number | null;
  column: string | null;
  channel_id: string | null;
  context: Record<string, unknown>;
};

export type MappingConfig = {
  assay_mode: AssayModeId;
  normalization_mode: NormalizationMode;
  channel_roles: Record<string, ImportRole>;
  delimiter: string | null;
  decimal_separator: string | null;
  header_row: number | null;
  first_data_row: number | null;
  well_column: string | null;
  cycle_column: string | null;
  sample_column: string | null;
  target_column: string | null;
  dye_column: string | null;
  role_column: string | null;
  rfu_column: string | null;
  rfu_columns: Record<string, string>;
};

export type ImportPreview = {
  preview_id: string;
  parser_id: string;
  filename: string;
  candidate_tables: string[];
  inferred_delimiter: string | null;
  decimal_separator: string | null;
  header_row: number | null;
  first_data_row: number | null;
  inferred_headers: string[];
  column_candidates: Record<string, string[]>;
  sample_rows: Record<string, unknown>[];
  channel_candidates: ReporterChannel[];
  assay_mode_candidates: AssayModeId[];
  warnings: ValidationIssue[];
  suggested_mapping: MappingConfig | null;
  metadata: Record<string, unknown>;
};

export type ImportParseRequest = {
  preview_id: string;
  mapping: MappingConfig;
};

export type ImportValidationErrorResponse = {
  status: 'validation_failed';
  issues: ValidationIssue[];
};

export type UnsupportedAnalysisModeResponse = {
  status: 'unsupported_analysis_mode';
  reason_code: string;
  assay_mode: AssayModeId;
  message: string;
};

export type ImportPreviewErrorResponse = ImportValidationErrorResponse;

export type ImportPreviewResponse = ImportPreview | ImportPreviewErrorResponse;

export type ImportParseResponse =
  | UploadResponse
  | ImportValidationErrorResponse
  | UnsupportedAnalysisModeResponse;

export type ASGSaveResultResponse = {
  status: string;
  analysis_run_id: string | null;
  created: boolean | null;
  target_type: string;
  target_id: string;
};

/** Where a session's ORIGINAL uploaded file stands, distinguishing three
 *  otherwise-identical-looking "there is no file" cases (P32):
 *  - 'none': no record at all -- predates this feature, or storing it
 *    failed at upload time (best-effort; never blocks the upload itself).
 *  - 'available': on disk, not yet expired.
 *  - 'expired': the retention window closed and it was swept. Historical
 *    metadata below is preserved so the UI can still say what it was.
 *  - 'missing': an anomaly -- the record says it should be there (not
 *    expired) but the bytes are gone from disk. */
export type RawFileStatusValue = 'none' | 'available' | 'expired' | 'missing';
export type RawFileStatus = {
  status: RawFileStatusValue;
  original_filename: string | null;
  size_bytes: number | null;
  sha256: string | null;
  stored_at: string | null;
  expires_at: string | null;
  deleted_at: string | null;
};

export type SessionListItem = {
  session_id: string;
  instrument: string;
  num_wells: number;
  num_cycles: number;
  uploaded_at: string;
  raw_filename?: string;
  raw_file?: RawFileStatus;
};

// ============================================================================
// Visualization Data
// ============================================================================

/** Instrument baseline removed before the reporters are read. "none" (raw
 *  RFU) is the default: this is a KASP-like endpoint assay, so the value at
 *  the read IS the measurement. The others are opt-in, for reading a real
 *  amplification curve or comparing against CFX Maestro's baseline fit. */
export type BackgroundMode = 'none' | 'pre_read' | 'channel_min';

/** Point a fam-fraction of 0.5 is measured from. Raw endpoint RFU carries an
 *  optical background on both channels, so (0, 0) is not where "no signal"
 *  sits and every ratio taken from it collapses toward 0.5. `source` says
 *  whether this came from the plate's NTC wells, a per-channel plate minimum
 *  (no NTC known), or nothing at all. */
export type RatioOrigin = {
  fam: number;
  allele2: number;
  /** `plate_floor` is a low quantile over wells with a sane passive reference
   *  — the fallback when no NTC well is known. `plate_min` is the same idea on
   *  a well set too small for a quantile to mean anything. */
  source: 'ntc' | 'plate_floor' | 'plate_min' | 'zero';
};

export type ScatterPoint = {
  well: string;
  norm_fam: number;
  norm_allele2: number;
  raw_fam: number;
  raw_allele2: number;
  raw_rox: number | null;
  /** See NormalizedPoint.normalized -- this well's own actual state. */
  normalized?: boolean;
  sample_name: string | null;
  auto_cluster: string | null;
  manual_type: string | null;
  confidence?: number | null;
};

export type PlateWell = {
  well: string;
  row: number;
  col: number;
  norm_fam: number;
  norm_allele2: number;
  ratio: number | null;
  normalized?: boolean;
  sample_name: string | null;
  auto_cluster: string | null;
  manual_type: string | null;
  confidence?: number | null;
};

export type AmplificationCurve = {
  well: string;
  effective_type?: string;
  cycles: number[];
  norm_fam: number[];
  norm_allele2: number[];
  /** Per-cycle, aligned with `cycles` -- see NormalizedPoint.normalized.
   *  Only present on `/amplification/all` (the four-endpoint reporting
   *  contract this belongs to); the single-well `/amplification` endpoint
   *  does not echo it. */
  normalized?: boolean[];
};

export type ChannelLabels = {
  fam: string;
  allele2: string;
  normalization?: string | null;
};

export type RoleLabelMetadata = {
  channel_labels?: ChannelLabels;
  role_channel_labels?: Record<string, string>;
  role_channels?: Record<string, string>;
  normalization_mode?: NormalizationMode | null;
  normalization_channel?: string | null;
  normalization_dye?: string | null;
};

// ============================================================================
// Well Types & Clustering
// ============================================================================

export const WellType = {
  NTC: 'NTC',
  UNKNOWN: 'Unknown',
  POSITIVE_CONTROL: 'Positive Control',
  // Allele-control INPUT roles (P4 C1): user-marked homozygous reference wells
  // that anchor the dosage ladder's extremes. Mirrors backend
  // `app.models.WellType.ALLELE1_CONTROL` / `ALLELE2_CONTROL` — distinct from
  // the RESULT labels ALLELE1_HOMO/ALLELE2_HOMO below.
  ALLELE1_CONTROL: 'Allele 1 Control',
  ALLELE2_CONTROL: 'Allele 2 Control',
  ALLELE1_HOMO: 'Allele 1 Homo',
  ALLELE2_HOMO: 'Allele 2 Homo',
  HETEROZYGOUS: 'Heterozygous',
  UNDETERMINED: 'Undetermined',
  EMPTY: 'Empty',
  // Well has data but is excluded from plots/clustering (bad/spiked reading,
  // or a failed/No-Amp well — P4 C6). Mirrors backend `WellType.OMIT`.
  OMIT: 'Omit',
} as const;

export type WellType = typeof WellType[keyof typeof WellType];

export const ClusteringAlgorithm = {
  THRESHOLD: 'threshold',
  KMEANS: 'kmeans',
  AUTO: 'auto',
} as const;

export type ClusteringAlgorithm = typeof ClusteringAlgorithm[keyof typeof ClusteringAlgorithm];

export type ThresholdConfig = {
  ntc_threshold: number;
  ntc_fam_max?: number | null;
  ntc_allele2_max?: number | null;
  allele1_ratio_max: number;
  allele2_ratio_min: number;
  // Polyploid: K-1 descending fam-fraction cuts between the observed dosage
  // classes (from the draggable radial lines). When present, overrides the two
  // diploid cutoffs above.
  boundaries?: number[] | null;
  // Dosage of the lowest observed class (places the window within 0..ploidy).
  offset?: number | null;
  // Highest allele dosage this ASSAY can produce, declared by the operator.
  // null/undefined = not declared, fall back to the organism's ploidy.
  //
  // A polyploid marker usually resolves only part of its ladder — a hexaploid
  // assay commonly tops out at dosage 3, so its classes are 0,1,2,3 out of
  // 0..6 — and that is a property of the assay the operator knows in advance.
  // Declared up front it CONSTRAINS the fit: the class count is capped at
  // dosage_max + 1 and the dosage window may not run past it.
  dosage_max?: number | null;
};

export type ClusteringRequest = {
  expected_input_revision?: number;
  regions?: MarkerRegion[] | null;
  algorithm: ClusteringAlgorithm;
  cycle: number;
  threshold_config?: ThresholdConfig | null;
  n_clusters: number;
  ploidy?: number | null; // allele copies per locus (2=diploid .. 8); null => session value
  // Must match what the plot is showing, or the calls come from different
  // numbers than the operator is looking at. null => 'none' (raw).
  background?: BackgroundMode | null;
  use_rox?: boolean;
};

export type ClusteringResult = {
  algorithm: string;
  cycle: number;
  assignments: Record<string, string>;
  confidences?: Record<string, number> | null;
  ploidy?: number;
  boundaries?: number[] | null; // K-1 internal radial-line positions (descending fam-fraction)
  offset?: number;              // dosage of the lowest observed class
  offset_uncertain?: boolean;   // true when the offset is a low-confidence guess
  /** The operator-declared dosage ceiling the calls were made under. */
  dosage_max?: number | null;
  low_separation?: boolean;     // true when adjacent dosage classes overlap (poorly resolved)
  // Multi-marker (P4): per-marker results. Absent for a single-marker (whole
  // plate) run; `assignments` above is then the flat merge across regions.
  regions?: RegionResult[] | null;
  warnings?: string[] | null;
  // P4-R1-T1 (FB-03 §8): severity-graded mirror of `warnings` above, additive
  // and backward-compatible -- code that only reads `warnings` is unaffected.
  // See snp-analyzer/app/models.py::WARNING_SEVERITY for per-code rationale.
  warning_details?: WarningDetail[] | null;
  analysis_context?: AnalysisContext | null;
  context_status?: 'verified' | 'legacy_unknown';
  input_revision?: number;
  analysis_status?: AnalysisStatus;
  analysis_pending?: boolean;
};

export type AnalysisStatus = 'idle' | 'computing' | 'completed' | 'failed';
export type InputRevision = { input_revision: number };
export type ExpectedRevision = { expected_input_revision?: number };
export type SessionInfoResponse = UploadResponse & InputRevision & {
  cycles: number[];
  analysis_status: AnalysisStatus;
  analysis_pending: boolean;
  raw_file?: RawFileStatus;
};
export type MissingClusteringResult = Omit<ClusteringResult, 'algorithm'> & { algorithm: null };
export type ClusterResponse = ClusteringResult | MissingClusteringResult;
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type AnalysisContext = {
  schema_version: 1;
  result_revision: string;
  analysed_at: string;
  cycle: number;
  use_rox: boolean;
  normalization_applied: boolean;
  /** True when some of this cycle's wells actually divided by their passive
   *  reference and others fell back to raw (e.g. one well's ROX read 0).
   *  Absent on results computed before P23. */
  normalization_mixed?: boolean;
  background: BackgroundMode;
  algorithm: ClusteringAlgorithm | 'mixed';
  parameters: Record<string, JsonValue>;
  regions: AnalysisRegionContext[];
  input_revision: number;
};
export type AnalysisRegionContext = {
  marker_id: string;
  name: string;
  wells: string[];
  ploidy: number;
  algorithm: ClusteringAlgorithm;
  parameters: Record<string, JsonValue>;
};
export type ResolvedThresholdConfig = {
  ntc_threshold: number;
  ntc_fam_max: number | null;
  ntc_allele2_max: number | null;
  allele1_ratio_max: number;
  allele2_ratio_min: number;
  boundaries: number[] | null;
  offset: number;
  dosage_max: number | null;
};
export type AnalysisErrorCode = 'NO_COMPLETED_RESULT' | 'LEGACY_CONTEXT_UNKNOWN'
  | 'INPUT_REVISION_CONFLICT' | 'RESULT_REVISION_CONFLICT' | 'ANALYSIS_SUPERSEDED'
  | 'ANALYSIS_IN_PROGRESS' | 'EXPORT_CONDITION_MISMATCH';
export type AnalysisErrorDetail = {
  code: AnalysisErrorCode;
  message: string;
  current_input_revision?: number;
};

export type ManualWellTypeUpdate = {
  expected_input_revision?: number;
  wells: string[];
  well_type: WellType;
};

// ============================================================================
// Markers (multi-marker-per-plate, P4)
// ============================================================================

/**
 * A marker (assay) = an arbitrary set of wells genotyped independently.
 * Mirrors backend `app.models.MarkerRegion`.
 */
export type MarkerRegion = {
  id: string;
  name: string;
  wells: string[];
  ploidy: number;
  threshold_config?: ThresholdConfig | null;
  /** UI-only tag (plate-view highlight color); not used by clustering. */
  color?: string | null;
  /**
   * Optional link to a durable marker-catalog entry this session marker was
   * attached to (see `POST /api/data/{sid}/markers/{marker_id}/attach-catalog`
   * and `app/routers/marker_catalog.py`). `null`/absent for markers that were
   * never linked to a catalog assay.
   */
  catalog_id?: string | null;
};

export type MarkersResponse = {
  markers: MarkerRegion[];
};

// ============================================================================
// Marker (assay) CATALOG -- durable, per-user assay registry
// Mirrors backend `app.models.MarkerCalibration` / `MarkerValidation` /
// `MarkerCatalogEntry` (app/routers/marker_catalog.py).
// ============================================================================

export type MarkerCalibrationRatioPoint = {
  ratio: number;
  expected_dosage: number;
};

/** Evidence that an assay's dosage-ratio mapping has been empirically
 * anchored (as opposed to assumed from equal-spacing defaults). */
export type MarkerCalibration = {
  controls_present: boolean;
  amplification_verified: boolean;
  defined_ratio_points: MarkerCalibrationRatioPoint[];
  notes: string;
  verified_at: string | null;
};

/** Evidence that an assay's genotype calls have been checked against an
 * independent ground truth (e.g. an orthogonal genotyping method). */
export type MarkerValidation = {
  status: 'none' | 'provisional' | 'validated';
  ground_truth_method: string | null;
  n_compared: number;
  concordance: number | null;
  notes: string;
};

/** A durable, user-owned assay (marker) registry entry. */
export type MarkerCatalogEntry = {
  id: string;
  owner_user_id: string;
  name: string;
  target_gene: string | null;
  snp_id: string | null;
  allele1_base: string | null;
  allele2_base: string | null;
  chemistry: string | null;
  default_ploidy: number;
  color: string | null;
  expected_dosage_classes: number | null;
  interpretation_notes: string;
  asg_target_id: string | null;
  calibration: MarkerCalibration;
  validation: MarkerValidation;
  created_at: string | null;
  updated_at: string | null;
  /** Derived, read-only: "validated" iff validation.status === "validated"
   * AND calibration.amplification_verified; otherwise "putative". */
  dosage_trust: 'putative' | 'validated';
};

export type MarkerCatalogListResponse = {
  entries: MarkerCatalogEntry[];
};

/** Body for `POST /api/marker-catalog`. */
export type MarkerCatalogCreateRequest = {
  name: string;
  target_gene?: string | null;
  snp_id?: string | null;
  allele1_base?: string | null;
  allele2_base?: string | null;
  chemistry?: string | null;
  default_ploidy?: number;
  color?: string | null;
  expected_dosage_classes?: number | null;
  interpretation_notes?: string;
  asg_target_id?: string | null;
  calibration?: MarkerCalibration;
  validation?: MarkerValidation;
};

/** Body for `PUT /api/marker-catalog/{id}` -- partial, only sent fields are
 * applied (mirrors backend `MarkerCatalogUpdate`). */
export type MarkerCatalogUpdateRequest = Partial<MarkerCatalogCreateRequest>;

// ============================================================================
// Layout library (per-user saved plate layouts, P4-S3)
// ============================================================================

/**
 * A reusable PHYSICAL plate design snapshot: the marker (assay) set, plus
 * optionally well-types / sample ids, captured from one session's current
 * state. Mirrors backend `app.routers.layouts._build_snapshot`.
 */
export type LayoutSnapshot = {
  schema_version: number;
  plate: { rows: number; cols: number };
  markers: MarkerRegion[];
  well_types?: Record<string, string>;
  sample_ids?: Record<string, string>;
};

/** Mirrors backend `app.db.get_layout` / `list_layouts` row shape. */
export type SavedLayout = {
  id: string;
  owner_user_id: string;
  name: string;
  snapshot: LayoutSnapshot;
  created_at: string;
  updated_at: string;
};

export type LayoutListResponse = {
  layouts: SavedLayout[];
};

export type LayoutApplyRequest = {
  expected_input_revision?: number;
  sid: string;
  apply_analysis_settings?: boolean;
  force?: boolean;
};

export type LayoutApplyResult = {
  input_revision: number;
  sid: string;
  markers: MarkerRegion[];
  well_types_applied: Record<string, string>;
};

/** Shape of the 409 response body's `detail` (L2 — ploidy conflict). */
export type LayoutApplyConflict = {
  message: string;
  conflicting_marker_ids: string[];
};

export type RegionResult = {
  id: string;
  name: string;
  wells: string[];
  ploidy: number;
  assignments: Record<string, string>;
  confidences?: Record<string, number> | null;
  boundaries?: number[] | null;
  offset: number;
  offset_uncertain: boolean;
  /** The operator-declared dosage ceiling in force for this marker. */
  dosage_max?: number | null;
  low_separation: boolean;
  genotype_counts?: Record<string, number> | null;
  warnings?: string[] | null;
  // P4-R1-T1: see ClusteringResult.warning_details above.
  warning_details?: WarningDetail[] | null;
  input_hash?: string | null;
};

// P4-R1-T1 (FB-03 §8): severity tier for one graded analysis warning.
// "blocking" -- bears on genotype-call reliability; must not be demoted
// below the fold by any future warning-demotion UI.
// "advisory" -- informational; safe to demote.
export type WarningSeverity = 'blocking' | 'advisory';
export type WarningDetail = { code: string; severity: WarningSeverity };

// ============================================================================
// Analysis Results
// ============================================================================

export type CtResult = {
  well: string;
  fam_ct: number | null;
  fam_threshold: number;
  fam_baseline_mean: number;
  allele2_ct: number | null;
  allele2_threshold: number;
  allele2_baseline_mean: number;
};

export type QualityResult = {
  well: string;
  score: number;
  magnitude_score: number;
  noise_score: number;
  rise_score: number;
  flags: string[];
};

// ============================================================================
// API Response Types
// ============================================================================

export type ScatterResponse = RoleLabelMetadata & {
  cycle: number;
  allele2_dye: string;
  /** Points are raw; this is the origin their ratios are measured from. */
  ratio_origin?: RatioOrigin;
  background_mode?: BackgroundMode;
  /** Whether the values really were divided by the passive reference. NOT the
   *  same as the `use_rox` request: a run with no reference comes back raw
   *  either way, and an axis titled "FAM / ROX" over raw RFU is misleading. */
  normalization_applied?: boolean;
  /** True when some points above actually divided and others fell back to
   *  raw -- the response mixes two scales of the same channel. */
  normalization_mixed?: boolean;
  /** Wells whose passive reference is too far from the plate median to divide
   *  by; excluded from the ratio-origin estimate. */
  rox_outlier_wells?: string[];
  points: ScatterPoint[];
};

export type PlateResponse = RoleLabelMetadata & {
  cycle: number;
  allele2_dye: string;
  ratio_origin?: RatioOrigin;
  background_mode?: BackgroundMode;
  normalization_applied?: boolean;
  normalization_mixed?: boolean;
  rox_outlier_wells?: string[];
  wells: PlateWell[];
};

export type AmplificationResponse = RoleLabelMetadata & {
  allele2_dye: string;
  background_mode?: BackgroundMode;
  /** What the curves below actually are (see `normalization_summary()` in
   *  app/processing/normalize.py), NOT what the `use_rox` request asked
   *  for -- a run with no passive reference stays raw regardless of the
   *  request, same distinction ScatterResponse/PlateResponse already make. */
  normalization_applied?: boolean;
  normalization_mixed?: boolean;
  curves: AmplificationCurve[];
};

export type ProtocolResponse = RoleLabelMetadata & {
  steps: ProtocolStep[];
};

export type CtResponse = RoleLabelMetadata & {
  results: CtResult[];
  allele2_dye: string;
};

export type QcResponse = {
  call_rate: number;
  n_called: number;
  n_total: number;
  ntc_check: {
    /** Legacy display-only tooltip; current server omits it. */
    details?: string;
    ok: boolean;
    status: 'ok' | 'warning' | 'no_ntc' | 'insufficient';
    wells: { well: string; signal: number | null; flagged: boolean | null;
      reason: 'none' | 'signal_above_threshold' | 'missing_signal' | 'missing_reference' | 'insufficient_points' }[];
    scope: 'plate';
    cycle: number;
    use_rox: boolean;
    normalization_applied: boolean;
    normalization_mixed?: boolean;
    background: BackgroundMode;
  };
  cluster_separation: number | null;
  warnings?: string[];
  /** QC input_revision is captured, unlike session/result input_revision. */
  input_revision: number | null;
  current_input_revision: number;
  result_revision: string | null;
  analysis_context: AnalysisContext | null;
  context_status: 'verified' | 'legacy_unknown';
  judgment_status: 'verified' | 'stale' | 'legacy_unknown' | 'missing';
  judgment_reason: 'none' | 'input_changed' | 'context_missing' | 'no_completed_result';
  analysis_status: AnalysisStatus;
  analysis_pending: boolean;
  authoritative?: 'markers';
  markers?: MarkerQc[];
};

export type MarkerQc = {
  id: string;
  name: string;
  ploidy: number;
  call_rate: number;
  n_called: number;
  n_total: number;
  cluster_separation: number | null;
  warnings?: string[] | null;
};

export type WellTypesResponse = {
  assignments: Record<string, string>;
  imported_assignments?: Record<string, string>;
  manual_assignments: Record<string, string>;
  input_revision: number;
};

export type WellGroupsResponse = {
  groups: Record<string, { wells: string[]; source: 'parsed' | 'manual' }>;
};

export type SamplesResponse = {
  samples: Record<string, string>;
  imported_samples?: Record<string, string>;
};

// ============================================================================
// Comparison API
// ============================================================================

export type CompareRunData = RoleLabelMetadata & {
  session_id: string;
  instrument: string;
  allele2_dye: string;
  cycle: number;
  num_wells: number;
  points: ScatterPoint[];
};

export type CompareScatterResponse = {
  run1: CompareRunData;
  run2: CompareRunData;
};

export type CompareRunStats = RoleLabelMetadata & {
  session_id: string;
  instrument: string;
  allele2_dye: string;
  n_wells: number;
  mean_fam: number;
  mean_allele2: number;
  std_fam: number;
  std_allele2: number;
};

export type CompareStatsResponse = {
  run1: CompareRunStats;
  run2: CompareRunStats;
  correlation: {
    fam_r: number | null;
    allele2_r: number | null;
    n_matched_wells: number;
  };
};

// ============================================================================
// Statistics API
// ============================================================================

export type StatisticsResponse = {
  allele_frequency: Record<string, number>;
  hwe: {
    chi2: number; p_value: number; expected_aa: number;
    expected_ab: number; expected_bb: number; in_hwe: boolean;
  } | {
    chi2: null; p_value: null; expected_aa: null;
    expected_ab: null; expected_bb: null; in_hwe: null;
  };
  genotype_distribution: Record<string, number>;
  total_wells: number;
};

// ============================================================================
// Presets API
// ============================================================================

export type PresetSettings = {
  algorithm?: ClusteringRequest['algorithm'];
  ntc_threshold?: number;
  allele1_ratio_max?: number;
  allele2_ratio_min?: number;
  n_clusters?: number;
  use_rox?: boolean;
  background?: BackgroundMode;
  fix_axis?: boolean;
  x_min?: number; x_max?: number;
  y_min?: number; y_max?: number;
};

export type PresetResponse = {
  id: string;
  name: string;
  builtin: boolean;
  settings: PresetSettings;
};

export type PresetsListResponse = {
  presets: PresetResponse[];
};

// ============================================================================
// Quality Control API
// ============================================================================

export type QualityResponse = {
  results: Record<string, QualityResult>;
  summary: {
    mean_score: number;
    low_quality_count: number;
    total_wells: number;
  };
};

// ============================================================================
// Project Management API
// ============================================================================

export type ProjectListResponse = {
  projects: Array<{
    id: string;
    name: string;
    created_at: string;
    session_count: number;
  }>;
};

export type ProjectResponse = {
  id: string;
  name: string;
  created_at: string;
  session_ids: string[];
  sessions: SessionListItem[];
};

export type ProjectSummaryResponse = {
  project_id: string;
  project_name: string;
  plates: Array<{
    session_id: string;
    instrument: string;
    num_wells: number;
    raw_filename: string;
    genotypes: Record<string, number>;
    ntc_count: number;
    unknown_count: number;
    mean_quality: number;
    missing?: boolean;
  }>;
  concordance: {
    concordant_wells: number;
    total_compared: number;
    percentage: number | null;
  };
};
// ============================================================================
// In-app user feedback
// ============================================================================

export type FeedbackCategory = 'bug' | 'feature' | 'improvement' | 'question' | 'other';

export type FeedbackStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

/** Where the reporter was when they filed it, collected automatically by the
 *  widget. Holds the run's SHAPE only — never sample names, well ids or
 *  calls, which an admin reading feedback is not entitled to. */
export type FeedbackContext = {
  page_key?: string;
  surface?: string;
  session_id?: string;
  instrument?: string;
  num_wells?: number;
  num_cycles?: number;
  ploidy?: number;
  cycle?: number;
  language?: string;
  viewport?: string;
  user_agent?: string;
};

/** Screenshot metadata. The bytes come from
 *  `GET /api/feedback/attachments/{id}` (see feedbackAttachmentUrl). */
export type FeedbackAttachment = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
};

export type FeedbackComment = {
  id: string;
  feedback_id: string;
  author_user_id: string;
  author_name?: string | null;
  body: string;
  /** Captured when the reply was written, not derived from the author's
   *  current role — a staff answer stays a staff answer. */
  is_admin: boolean;
  created_at?: string | null;
};

export type FeedbackItem = {
  id: string;
  owner_user_id: string;
  owner_name?: string | null;
  category: FeedbackCategory;
  title: string;
  body: string;
  context?: FeedbackContext | null;
  status: FeedbackStatus;
  admin_note?: string | null;
  comments: FeedbackComment[];
  attachments: FeedbackAttachment[];
  created_at?: string | null;
  updated_at?: string | null;
};

export type FeedbackListResponse = {
  items: FeedbackItem[];
  total: number;
  page: number;
  per_page: number;
};

export type FeedbackStats = {
  total: number;
  open: number;
  in_progress: number;
  resolved: number;
  closed: number;
  by_category: Record<string, number>;
};

export type FeedbackSubmitRequest = {
  category: FeedbackCategory;
  title: string;
  body: string;
  context?: FeedbackContext | null;
  attachment_ids?: string[];
};

export type FeedbackUpdateRequest = {
  status?: FeedbackStatus;
  admin_note?: string;
};

/** Build identity of the instance being talked to (GET /api/version). */
export type VersionResponse = {
  version: string;
  /** Empty when the build supplied no provenance. */
  commit: string;
  built_at: string;
};
