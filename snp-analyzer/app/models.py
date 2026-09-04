from __future__ import annotations
from enum import Enum
from typing import Literal
from pydantic import BaseModel, Field, computed_field


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


class RatioOrigin(BaseModel):
    """Origin the fam-fraction ratio is measured from.

    Raw endpoint RFU carries an optical background on both reporter channels
    (~2000-4000 RFU), and a common offset on both axes drags every
    ``fam/(fam+allele2)`` ratio toward 0.5 — which is what ratio-based calling
    and the radial boundary lines are measured against. The plate's own
    no-template wells mark where "no signal" actually sits, so they are the
    origin those ratios are taken from. Displayed and stored values stay raw:
    this shifts the CALLING geometry, not the data.

    ``source`` says where it came from, so a view can state it rather than
    implying an authority the number does not have:
      - ``ntc``         — median of the plate's no-template wells (preferred)
      - ``plate_floor`` — per-channel low quantile of the plate, over wells
                          with a sane passive reference (no NTC well known)
      - ``plate_min``   — per-channel plate-wide minimum; only for a plate too
                          small for a quantile to mean anything
      - ``zero``        — no points at all; ratios measured from (0, 0)
    """
    fam: float = 0.0
    allele2: float = 0.0
    source: str = "zero"


class UnifiedData(BaseModel):
    instrument: str                  # "QuantStudio 3" or "CFX Opus"
    allele2_dye: str                 # "VIC" or "HEX"
    wells: list[str]                 # sorted list of well IDs
    cycles: list[int]               # sorted list of cycle numbers
    data: list[WellCycleData]       # all raw readings
    has_rox: bool = True
    sample_names: dict[str, str] | None = None  # well -> sample name
    # Explicit plate-setup roles declared by the source file. These are kept
    # separate from manual_welltypes so the UI can show file provenance while
    # still allowing an operator override to win.
    imported_well_types: dict[str, str] | None = None
    # Explicit target/assay assignments declared by the instrument. This is
    # deliberately NOT populated from generic CFX wellGroup entries: a group
    # is only an analysis subset, not evidence that it is a marker.
    imported_markers: dict[str, list[str]] | None = None
    protocol_steps: list[ProtocolStep] | None = None  # from .eds tcprotocol.xml
    data_windows: list[DataWindow] | None = None
    well_groups: dict[str, list[str]] | None = None
    normalization_mode: str | None = None
    normalization_channel: str | None = None
    normalization_dye: str | None = None
    role_channels: dict[str, str] | None = None
    ploidy: int = 2                  # allele copies per locus (2=diploid .. 8)
    # What has been subtracted from the reporter channels in ``data``.
    # None/"none" == raw instrument RFU, which is the default for every parser:
    # this is a KASP-like allele-specific endpoint assay, so the raw value at
    # the read IS the measurement (see app/processing/background.py).
    background_mode: str | None = None
    # No-template wells as declared in the instrument's own plate setup.
    # Used as the ratio origin when the operator has not marked NTCs by hand.
    ntc_wells: list[str] | None = None


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
    # Background modes this run can legitimately be read with. The excluded
    # ones distort rather than baseline it, so the client offers only these
    # instead of re-deriving the rule (see processing/background.py).
    background_modes: list[str] = ["none"]


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
    # Optional operator-defined lower-left NTC quadrant, expressed in the raw
    # normalized values shown on the scatter plot.  Both channel values must be
    # at or below their maxima for an untyped well to be called NTC.
    ntc_fam_max: float | None = Field(default=None, ge=0)
    ntc_allele2_max: float | None = Field(default=None, ge=0)
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
    # UI-only tag (e.g. plate-view highlight color); not used by clustering.
    color: str | None = None
    # Optional link to a durable app.routers.marker_catalog entry this
    # session marker was attached to (see POST .../attach-catalog). None for
    # markers that were never linked to a catalog assay.
    catalog_id: str | None = None


# ---------------------------------------------------------------------------
# Marker (assay) CATALOG -- a durable, plate-independent assay registry.
# Distinct from MarkerRegion above: a MarkerRegion is an ephemeral per-session
# well-group selection, while a MarkerCatalogEntry is registered ONCE (e.g.
# "qSwet5.3") and reused across many plates/sessions via attach-catalog.
# See app/routers/marker_catalog.py.
# ---------------------------------------------------------------------------


class MarkerCalibrationRatioPoint(BaseModel):
    """One empirically-observed (fam-fraction ratio -> expected dosage) anchor
    point used to calibrate an assay's dosage-ratio mapping."""
    ratio: float
    expected_dosage: int


class MarkerCalibration(BaseModel):
    """Evidence that an assay's dosage-ratio mapping has been empirically
    anchored (as opposed to assumed from equal-spacing defaults)."""
    controls_present: bool = False
    amplification_verified: bool = False
    defined_ratio_points: list[MarkerCalibrationRatioPoint] = Field(default_factory=list)
    notes: str = ""
    verified_at: str | None = None


class MarkerValidation(BaseModel):
    """Evidence that an assay's genotype calls have been checked against an
    independent ground truth (e.g. a orthogonal genotyping method)."""
    status: Literal["none", "provisional", "validated"] = "none"
    ground_truth_method: str | None = None
    n_compared: int = 0
    concordance: float | None = None
    notes: str = ""


class MarkerCatalogEntry(BaseModel):
    """A durable, user-owned assay (marker) registry entry.

    Scope is the owning user only (``app.auth.TokenData`` has no team/org
    concept) -- "sharing" is an explicit copy
    (``POST /api/marker-catalog/{id}/copy``), mirroring ``saved_layouts``."""
    id: str
    owner_user_id: str
    name: str
    target_gene: str | None = None
    snp_id: str | None = None
    allele1_base: str | None = None
    allele2_base: str | None = None
    chemistry: str | None = None
    default_ploidy: int = 2
    color: str | None = None
    expected_dosage_classes: int | None = None
    interpretation_notes: str = ""
    asg_target_id: str | None = None
    calibration: MarkerCalibration = Field(default_factory=MarkerCalibration)
    validation: MarkerValidation = Field(default_factory=MarkerValidation)
    created_at: str | None = None
    updated_at: str | None = None

    @computed_field  # type: ignore[misc]
    @property
    def dosage_trust(self) -> Literal["putative", "validated"]:
        """Derived, read-only hedge for the UI: an assay's dosage calls are
        only "validated" once BOTH (a) its calls were checked against ground
        truth (``validation.status == "validated"``) AND (b) the underlying
        amplification/ratio mapping itself was verified
        (``calibration.amplification_verified``). Anything short of that is
        "putative" -- a validated status alone does not guarantee the
        dosage-ratio mapping it was validated against is still trustworthy."""
        if self.validation.status == "validated" and self.calibration.amplification_verified:
            return "validated"
        return "putative"


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
    # A5 groundwork: stable hash of (sorted wells, ploidy, cycle) at the time
    # this result was computed. Lets a future dirty-flag UI detect when the
    # marker definition has since changed without needing to diff full state.
    input_hash: str | None = None


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
    # Background subtraction to apply before clustering. Must match what the
    # user is looking at, or the calls would be computed on different numbers
    # than the plot shows. None => "none" (raw), the default everywhere.
    background: Literal["none", "pre_read", "channel_min"] | None = None
    # Must match the scatter coordinates used to place manual thresholds.
    use_rox: bool = True


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
