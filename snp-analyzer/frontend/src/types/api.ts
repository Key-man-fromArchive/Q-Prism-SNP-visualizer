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
};

export type UnifiedData = {
  instrument: string;
  allele2_dye: string;
  wells: string[];
  cycles: number[];
  data: WellCycleData[];
  has_rox: boolean;
  sample_names: Record<string, string> | null;
  protocol_steps: ProtocolStep[] | null;
  data_windows: DataWindow[] | null;
};

// ============================================================================
// Upload & Session
// ============================================================================

export type UploadResponse = {
  session_id: string;
  instrument: string;
  allele2_dye: string;
  num_wells: number;
  num_cycles: number;
  has_rox: boolean;
  data_windows: DataWindow[] | null;
  suggested_cycle: number | null;
};

export type SessionListItem = {
  session_id: string;
  instrument: string;
  num_wells: number;
  num_cycles: number;
  uploaded_at: string;
};

// ============================================================================
// Visualization Data
// ============================================================================

export type ScatterPoint = {
  well: string;
  norm_fam: number;
  norm_allele2: number;
  raw_fam: number;
  raw_allele2: number;
  raw_rox: number | null;
  sample_name: string | null;
  auto_cluster: string | null;
  manual_type: string | null;
};

export type PlateWell = {
  well: string;
  row: number;
  col: number;
  norm_fam: number;
  norm_allele2: number;
  ratio: number | null;
  sample_name: string | null;
  auto_cluster: string | null;
  manual_type: string | null;
};

export type AmplificationCurve = {
  well: string;
  cycles: number[];
  norm_fam: number[];
  norm_allele2: number[];
};

// ============================================================================
// Well Types & Clustering
// ============================================================================

export const WellType = {
  NTC: 'NTC',
  UNKNOWN: 'Unknown',
  POSITIVE_CONTROL: 'Positive Control',
  ALLELE1_HOMO: 'Allele 1 Homo',
  ALLELE2_HOMO: 'Allele 2 Homo',
  HETEROZYGOUS: 'Heterozygous',
  UNDETERMINED: 'Undetermined',
} as const;

export type WellType = typeof WellType[keyof typeof WellType];

export const ClusteringAlgorithm = {
  THRESHOLD: 'threshold',
  KMEANS: 'kmeans',
} as const;

export type ClusteringAlgorithm = typeof ClusteringAlgorithm[keyof typeof ClusteringAlgorithm];

export type ThresholdConfig = {
  ntc_threshold: number;
  allele1_ratio_max: number;
  allele2_ratio_min: number;
};

export type ClusteringRequest = {
  algorithm: ClusteringAlgorithm;
  cycle: number;
  threshold_config?: ThresholdConfig | null;
  n_clusters: number;
};

export type ClusteringResult = {
  algorithm: string;
  cycle: number;
  assignments: Record<string, string>;
};

export type ManualWellTypeUpdate = {
  wells: string[];
  well_type: WellType;
};

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

export type ScatterResponse = {
  cycle: number;
  allele2_dye: string;
  points: ScatterPoint[];
};

export type PlateResponse = {
  cycle: number;
  allele2_dye: string;
  wells: PlateWell[];
};

export type AmplificationResponse = {
  allele2_dye: string;
  curves: AmplificationCurve[];
};

export type ProtocolResponse = {
  steps: ProtocolStep[];
};

export type CtResponse = {
  results: CtResult[];
  allele2_dye: string;
};

export type QcResponse = {
  call_rate: number;
  n_called: number;
  n_total: number;
  ntc_check: {
    status: string;
    details: string;
  };
  cluster_separation: number | null;
};

export type WellTypesResponse = {
  assignments: Record<string, string>;
};

export type SamplesResponse = {
  samples: Record<string, string>;
};

// ============================================================================
// Comparison API
// ============================================================================

export type CompareRunData = {
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

export type CompareRunStats = {
  session_id: string;
  instrument: string;
  allele2_dye: string;
  num_wells: number;
  mean_fam: number;
  mean_allele2: number;
  std_fam: number;
  std_allele2: number;
};

export type CompareStatsResponse = {
  run1: CompareRunStats;
  run2: CompareRunStats;
  correlation: {
    fam_r: number;
    allele2_r: number;
    n_matched_wells: number;
  };
};

// ============================================================================
// Statistics API
// ============================================================================

export type StatisticsResponse = {
  allele_frequency: Record<string, number>;
  hwe: Record<string, any>;
  genotype_distribution: Record<string, number>;
  total_wells: number;
};

// ============================================================================
// Presets API
// ============================================================================

export type PresetResponse = {
  id: string;
  name: string;
  builtin: boolean;
  settings: Record<string, any>;
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
  plates: Array<Record<string, any>>;
  concordance: {
    concordant_wells: number;
    total_compared: number;
    percentage: number;
  };
};
