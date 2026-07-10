from __future__ import annotations
from enum import Enum
from pydantic import BaseModel, Field


class WellCycleData(BaseModel):
    well: str          # A1-H12
    cycle: int
    fam: float
    allele2: float     # VIC or HEX
    rox: float | None = None
    normalization_value: float | None = None


class NormalizedPoint(BaseModel):
    well: str
    cycle: int
    norm_fam: float
    norm_allele2: float
    raw_fam: float
    raw_allele2: float
    raw_rox: float | None = None


class DataWindow(BaseModel):
    name: str         # "Pre-read", "Amplification", "Post-read", "End Point"
    start_cycle: int  # inclusive absolute cycle
    end_cycle: int    # inclusive absolute cycle


class UnifiedData(BaseModel):
    instrument: str                  # "QuantStudio 3" or "CFX Opus"
    allele2_dye: str                 # "VIC" or "HEX"
    wells: list[str]                 # sorted list of well IDs
    cycles: list[int]               # sorted list of cycle numbers
    data: list[WellCycleData]       # all raw readings
    has_rox: bool = True
    sample_names: dict[str, str] | None = None  # well -> sample name
    protocol_steps: list[ProtocolStep] | None = None  # from .eds tcprotocol.xml
    data_windows: list[DataWindow] | None = None
    well_groups: dict[str, list[str]] | None = None
    normalization_mode: str | None = None
    normalization_channel: str | None = None
    normalization_dye: str | None = None
    role_channels: dict[str, str] | None = None
    ploidy: int = 2                  # allele copies per locus (2=diploid .. 8)


class UploadResponse(BaseModel):
    session_id: str
    instrument: str
    allele2_dye: str
    num_wells: int
    num_cycles: int
    has_rox: bool
    data_windows: list[DataWindow] | None = None
    suggested_cycle: int | None = None
    well_groups: dict[str, list[str]] | None = None


class UploadPreviewRequiredResponse(BaseModel):
    status: str = "preview_required"
    reason_code: str = "mapping_required"
    message: str
    filename: str
    parser_id: str | None = None
    preview_id: str | None = None
    supported_extensions: list[str] = Field(default_factory=list)


class ScatterPoint(BaseModel):
    well: str
    norm_fam: float
    norm_allele2: float
    raw_fam: float
    raw_allele2: float
    raw_rox: float | None = None
    sample_name: str | None = None
    auto_cluster: str | None = None
    manual_type: str | None = None
    confidence: float | None = None  # 0..1 auto-call confidence


class PlateWell(BaseModel):
    well: str
    row: int
    col: int
    norm_fam: float
    norm_allele2: float
    ratio: float | None = None
    sample_name: str | None = None
    auto_cluster: str | None = None
    manual_type: str | None = None
    confidence: float | None = None  # 0..1 auto-call confidence


class AmplificationCurve(BaseModel):
    well: str
    cycles: list[int]
    norm_fam: list[float]
    norm_allele2: list[float]


class ProtocolStep(BaseModel):
    step: int
    temperature: float
    duration_sec: int
    cycles: int = 1
    label: str = ""
    phase: str = ""        # e.g., "Pre-read", "Amplification 1 (Touchdown)", "Post-read"
    goto_label: str = ""   # e.g., "↩ Repeat Steps 3-4 × 10 cycles"


class WellType(str, Enum):
    NTC = "NTC"
    UNKNOWN = "Unknown"
    POSITIVE_CONTROL = "Positive Control"
    # Allele-control INPUT roles (C1): user-marked homozygous reference wells
    # that anchor the extremes of the dosage ladder (allele-1 control = highest
    # fam-fraction = dosage P; allele-2 control = lowest = dosage 0). Distinct
    # from the RESULT labels ALLELE1_HOMO/ALLELE2_HOMO below, which are what a
    # SAMPLE well is genotyped as -- these are what the operator marks a
    # reference well as, before clustering runs.
    ALLELE1_CONTROL = "Allele 1 Control"
    ALLELE2_CONTROL = "Allele 2 Control"
    ALLELE1_HOMO = "Allele 1 Homo"
    ALLELE2_HOMO = "Allele 2 Homo"
    HETEROZYGOUS = "Heterozygous"
    UNDETERMINED = "Undetermined"
    EMPTY = "Empty"
    OMIT = "Omit"  # well has data but is excluded from plots/clustering (e.g. bad/spiked reading)


class ClusteringAlgorithm(str, Enum):
    THRESHOLD = "threshold"
    KMEANS = "kmeans"
    AUTO = "auto"


class ThresholdConfig(BaseModel):
    ntc_threshold: float = 0.1
    allele1_ratio_max: float = 0.4
    allele2_ratio_min: float = 0.6
    # Polyploid: K-1 descending fam-fraction cuts between the observed dosage
    # classes (from the draggable radial lines). When set, these override the two
    # diploid cutoffs above and label by dosage for the session's ploidy.
    boundaries: list[float] | None = None
    # Dosage of the lowest observed class — places the K observed zones within the
    # full 0..ploidy ladder (see genotype_window / the offset control).
    offset: int = 0


class MarkerRegion(BaseModel):
    """A marker (assay) = an arbitrary set of wells genotyped independently.

    One plate may carry several markers, each with its own ploidy and (optionally)
    its own threshold config. The wells need not be contiguous."""
    id: str
    name: str
    wells: list[str]
    ploidy: int = 2
    threshold_config: ThresholdConfig | None = None


class RegionResult(BaseModel):
    """Per-marker clustering output (mirrors ClusteringResult, scoped to a region)."""
    id: str
    name: str
    wells: list[str]
    ploidy: int
    assignments: dict[str, str]
    confidences: dict[str, float] | None = None
    boundaries: list[float] | None = None
    offset: int = 0
    offset_uncertain: bool = False
    low_separation: bool = False
    genotype_counts: dict[str, int] | None = None
    # Phase 1 diagnostics: non-fatal quality flags for this marker's calls (e.g.
    # "low_n", "relative_ntc"). None (not empty list) when there is nothing to
    # flag, so a clean marker's JSON is unchanged.
    warnings: list[str] | None = None


class ClusteringRequest(BaseModel):
    algorithm: ClusteringAlgorithm = ClusteringAlgorithm.THRESHOLD
    cycle: int = 0
    threshold_config: ThresholdConfig | None = None
    n_clusters: int = 4
    ploidy: int | None = None        # None => use the session's stored ploidy (default 2)
    # Multi-marker: when set, each region is genotyped independently on its own
    # well subset and ploidy. When None, the whole plate is clustered as one
    # marker (the historical single-marker path, unchanged).
    regions: list[MarkerRegion] | None = None


class ClusteringResult(BaseModel):
    algorithm: str
    cycle: int
    assignments: dict[str, str]
    confidences: dict[str, float] | None = None  # well -> 0..1 call confidence
    ploidy: int = 2
    # Observed dosage window for the draggable-line UI: K-1 internal fam-fraction
    # cuts (descending), the dosage of the lowest observed class, and whether that
    # offset is a low-confidence guess (no class near an axis extreme).
    boundaries: list[float] | None = None
    offset: int = 0
    offset_uncertain: bool = False
    # True when adjacent dosage classes overlap (poorly resolved — high ploidy).
    low_separation: bool = False
    # Multi-marker: per-marker results. None for a single-marker (whole-plate)
    # run; ``assignments`` above is then the flat merge across all regions.
    regions: list[RegionResult] | None = None
    # Phase 1 diagnostics: non-fatal quality flags (e.g. "low_n", "relative_ntc")
    # for the single-marker (whole-plate) path. None when clean, so an
    # unaffected/legacy run's JSON is byte-for-byte unchanged.
    warnings: list[str] | None = None


class ManualWellTypeUpdate(BaseModel):
    wells: list[str]
    well_type: WellType


class CtResult(BaseModel):
    well: str
    fam_ct: float | None = None
    fam_threshold: float = 0
    fam_baseline_mean: float = 0
    allele2_ct: float | None = None
    allele2_threshold: float = 0
    allele2_baseline_mean: float = 0


class QualityResult(BaseModel):
    well: str
    score: int
    magnitude_score: float = 0
    noise_score: float = 0
    rise_score: float = 0
    flags: list[str] = []
