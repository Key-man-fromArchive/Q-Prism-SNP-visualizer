from __future__ import annotations
from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import UUID
from pydantic import AwareDatetime, BaseModel, Field, JsonValue, computed_field, field_validator


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
    # Whether THIS reading was actually divided by its passive reference, as
    # opposed to normalization_applies()'s run-wide "would apply if the
    # reference were usable" verdict. A run can ask for normalization and
    # have it, well by well: one well's reference reads 0 (or is missing) and
    # falls back to raw while its neighbour divides normally -- see
    # app/processing/normalize.py:normalize() and
    # docs/planning/feedback-2026-09-11/evidence/P23-NORM-SCALE.md.
    normalized: bool = False


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
    input_revision: int = Field(default=0, ge=0)
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
    # Keep the operator-facing identity with the reload contract. Session IDs
    # are implementation details and are not useful when switching between
    # several plates in the file workspace.
    raw_filename: str | None = None
    well_ids: list[str] = Field(default_factory=list)
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
    # See NormalizedPoint.normalized -- carried through per well so a mixed
    # response (some wells divided, some raw) is visible on the point itself,
    # not just as one response-wide flag.
    normalized: bool = False
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
    normalized: bool = False
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
    # All three default so existing stored JSON (pre-P2-R1-T1) still deserializes.
    plate_read: bool = False               # whether this step captured a fluorescence read
    temp_increment: float | None = None    # per-cycle temperature delta (touchdown; negative = descending)
    read_channels: list[str] = Field(default_factory=list)  # step-level read channels; empty when source format has none


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
    # Highest allele dosage this ASSAY can produce, declared by the operator.
    # None = not declared; fall back to the organism's ploidy.
    #
    # A polyploid marker usually resolves only part of its ladder: a hexaploid
    # assay commonly tops out at dosage 3, so the classes are 0,1,2,3 out of
    # 0..6. That is a property of the assay, which the operator knows and
    # fluorescence often cannot recover -- 0,1,2,3 and 3,4,5,6 fit the same
    # four clusters. Declared up front it is a real CONSTRAINT rather than a
    # correction after the fact: the class-count search is capped at
    # ``dosage_max + 1`` (so the fit cannot split four real classes into seven)
    # and the dosage window may not run past it.
    dosage_max: int | None = Field(default=None, ge=0, le=8)


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


# P4-R1-T1 (FB-03 SS8): severity grading for the analysis warning codes above.
# FB-03 wants low-signal warnings demoted to the bottom of the results screen,
# but that is only safe for warnings that are purely informational. Anything
# that bears on genotype-call RELIABILITY must stay where the operator will
# see it. Two tiers:
#   "blocking" -- affects call reliability; the UI must not demote it below
#                 the fold.
#   "advisory" -- informational; safe to demote.
WarningSeverity = Literal["blocking", "advisory"]

# Per-code classification, decided from what each code actually means (see the
# call sites in app/processing/clustering.py for the full reasoning):
#
#   "relative_ntc" (clustering.py:360) -- flips the affected wells' label from
#     NTC to Undetermined because the auto-NTC gap test was not conclusive
#     (clustering.py:340-348, "C4"). This changes what is reported for those
#     wells' genotype call outcome, so it is "blocking".
#   "low_n" (clustering.py:385) -- fewer than 4 signal wells means no mixture
#     model was fit; the calls that follow are capped at
#     ``_SMALL_REGION_CONFIDENCE`` specifically because there is no
#     statistical evidence behind them ("C3"). A call made without that
#     evidence is exactly what a human should be able to review, so
#     "blocking".
#   "anchor_conflict" (clustering.py:838) -- emitted only when the operator's
#     allele-1/allele-2 anchor wells are mutually inconsistent (inverted or
#     degenerate scale) and the anchor-based dosage scale is discarded
#     entirely, falling back to the unanchored path. Anchors set WHERE
#     dosage 0 and dosage `ploidy` sit on the ratio axis -- i.e. the origin
#     genotype calls are measured against -- so a discarded anchor scale is
#     "blocking".
#   "no_signal" (P22 C5, clustering.py) -- every well in this call (a whole
#     marker region, or the whole plate with no regions) had total <= 0
#     signal, so the relative-NTC detector's own reference (median_total)
#     collapsed to 0 and could never flag anything; the wells are called
#     Undetermined instead of falling through to a real genotype. This is
#     the plainest possible "the reported label is not what a naive read
#     would have given" case, so "blocking".
#
# All known codes are "blocking" as of this task. No warning is demoted
# here -- demoting any of these would be a QC policy decision for the
# product owner to make explicitly, not something to infer from this
# refactor.
WARNING_SEVERITY: dict[str, WarningSeverity] = {
    "relative_ntc": "blocking",
    "low_n": "blocking",
    "anchor_conflict": "blocking",
    "no_signal": "blocking",
}
# An unrecognised diagnostic code (e.g. one added by a future change without
# updating this map) defaults to "blocking": showing an unfamiliar diagnostic
# prominently is safer than silently demoting one nobody has vetted yet.
_DEFAULT_WARNING_SEVERITY: WarningSeverity = "blocking"


class WarningDetail(BaseModel):
    """One graded analysis warning: the raw code plus its severity tier."""
    code: str
    severity: WarningSeverity


def _graded_warnings(codes: list[str] | None) -> list[WarningDetail] | None:
    """Turn a ``warnings`` code list into graded ``WarningDetail`` entries.

    Mirrors the existing ``warnings`` contract: ``None`` (not ``[]``) when
    there is nothing to report, so a clean run's ``warning_details`` is also
    absent rather than an empty list.
    """
    if not codes:
        return None
    return [
        WarningDetail(code=code, severity=WARNING_SEVERITY.get(code, _DEFAULT_WARNING_SEVERITY))
        for code in codes
    ]


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
    # The operator-declared dosage ceiling in force for this marker, echoed so
    # the UI can show what it applied (see ThresholdConfig.dosage_max).
    dosage_max: int | None = None
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

    # P4-R1-T1: additive, backward-compatible severity grading for `warnings`
    # above. Existing consumers that only read `warnings` (a list[str]) are
    # unaffected -- this field is derived, not a replacement.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def warning_details(self) -> list[WarningDetail] | None:
        return _graded_warnings(self.warnings)


class ClusteringRequest(BaseModel):
    cycle_mode: Literal["legacy_latest", "absolute"] = "legacy_latest"
    expected_input_revision: int | None = Field(default=None, ge=0)
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


class AnalysisRegionContext(BaseModel):
    """Actual per-marker inputs, independent of later marker edits."""
    marker_id: str
    name: str
    wells: list[str]
    ploidy: int = Field(ge=1)
    algorithm: ClusteringAlgorithm
    parameters: dict[str, JsonValue]


class AnalysisContext(BaseModel):
    """Complete result provenance; absent on historical unverified results.

    The publisher supplies resolved parameters, rather than reconstructing them
    from current session settings during loading. No inferred field defaults.
    """
    schema_version: Literal[1]
    result_revision: UUID
    analysed_at: AwareDatetime
    cycle: int = Field(ge=0)
    use_rox: bool
    normalization_applied: bool
    # True when some of this cycle's wells were actually divided by their
    # passive reference and others were not (e.g. one well's ROX read 0 and
    # fell back to raw while its neighbours divided normally). Defaults to
    # False so historical persisted contexts (pre-P23) still deserialize.
    normalization_mixed: bool = False
    background: Literal["none", "pre_read", "channel_min"]
    algorithm: ClusteringAlgorithm | Literal["mixed"]
    parameters: dict[str, JsonValue]
    regions: list[AnalysisRegionContext]
    input_revision: int = Field(ge=0)

    @field_validator("analysed_at")
    @classmethod
    def normalize_completion_to_utc(cls, value: datetime) -> datetime:
        return value.astimezone(timezone.utc)


class ClusteringResult(BaseModel):
    analysis_context: AnalysisContext | None = None

    # Pydantic supports this property wrapper; mypy cannot model it (as above
    # for MarkerCatalogEntry.dosage_trust). Keep the precise public return type.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def context_status(self) -> Literal["verified", "legacy_unknown"]:
        return "verified" if self.analysis_context is not None else "legacy_unknown"

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
    # The operator-declared dosage ceiling in force (see
    # ThresholdConfig.dosage_max), echoed back for display.
    dosage_max: int | None = None
    # True when adjacent dosage classes overlap (poorly resolved — high ploidy).
    low_separation: bool = False
    # Multi-marker: per-marker results. None for a single-marker (whole-plate)
    # run; ``assignments`` above is then the flat merge across all regions.
    regions: list[RegionResult] | None = None
    # Phase 1 diagnostics: non-fatal quality flags (e.g. "low_n", "relative_ntc")
    # for the single-marker (whole-plate) path. None when clean, so an
    # unaffected/legacy run's JSON is byte-for-byte unchanged.
    warnings: list[str] | None = None

    # P4-R1-T1: additive, backward-compatible severity grading for `warnings`
    # above (see RegionResult.warning_details and WARNING_SEVERITY for the
    # per-code rationale). Existing consumers that only read `warnings` (a
    # list[str]) are unaffected -- this field is derived, not a replacement.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def warning_details(self) -> list[WarningDetail] | None:
        return _graded_warnings(self.warnings)

    # P22 (C5): which cluster_auto/cluster_threshold/boundary_confidences
    # revision produced this result -- see
    # app.processing.clustering.CLUSTERING_ALGORITHM_VERSION for the format
    # and the bump rule. None for any result computed before this field
    # existed (legacy persisted rows, or a caller that builds a
    # ClusteringResult directly without going through the router) -- additive
    # and backward-compatible, so existing consumers that don't read it are
    # unaffected.
    algorithm_version: str | None = None


class ManualWellTypeUpdate(BaseModel):
    expected_input_revision: int | None = Field(default=None, ge=0)
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


# ---------------------------------------------------------------------------
# In-app user feedback
# ---------------------------------------------------------------------------


class FeedbackCategory(str, Enum):
    BUG = "bug"
    FEATURE = "feature"
    IMPROVEMENT = "improvement"
    QUESTION = "question"
    OTHER = "other"


class FeedbackStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"


class FeedbackContext(BaseModel):
    """Where the reporter was when they filed it.

    Collected automatically by the widget so a report is reproducible without
    asking the operator to describe their screen. Deliberately holds NO plate
    contents -- no sample names, well ids, genotype calls or fluorescence --
    because an admin reading feedback is not otherwise entitled to another
    user's sample identities (see AGENTS.md on private sample identifiers).
    Only the run's shape (instrument, well/cycle counts, ploidy) is carried,
    which is what a parsing or clustering bug actually depends on.
    """
    # The tab the reporter was on ("analysis", "quality", ...) plus the
    # sub-surface within it where one exists ("plate-setup" / "analysis").
    page_key: str | None = None
    surface: str | None = None
    session_id: str | None = None
    instrument: str | None = None
    num_wells: int | None = None
    num_cycles: int | None = None
    ploidy: int | None = None
    cycle: int | None = None
    language: str | None = None
    viewport: str | None = None
    user_agent: str | None = None


class FeedbackAttachment(BaseModel):
    """A stored screenshot. Bytes are fetched separately from
    ``GET /api/feedback/attachments/{id}``; this is metadata only."""
    id: str
    filename: str
    mime_type: str
    size_bytes: int


class FeedbackComment(BaseModel):
    id: str
    feedback_id: str
    author_user_id: str
    author_name: str | None = None
    body: str
    # Captured when the comment was written, not derived from the author's
    # current role -- a staff answer stays a staff answer.
    is_admin: bool = False
    created_at: str | None = None


class FeedbackItem(BaseModel):
    id: str
    owner_user_id: str
    owner_name: str | None = None
    category: FeedbackCategory
    title: str
    body: str
    context: FeedbackContext | None = None
    status: FeedbackStatus = FeedbackStatus.OPEN
    admin_note: str | None = None
    comments: list[FeedbackComment] = []
    attachments: list[FeedbackAttachment] = []
    created_at: str | None = None
    updated_at: str | None = None


class FeedbackListResponse(BaseModel):
    items: list[FeedbackItem]
    total: int
    page: int
    per_page: int


class FeedbackStats(BaseModel):
    total: int = 0
    open: int = 0
    in_progress: int = 0
    resolved: int = 0
    closed: int = 0
    by_category: dict[str, int] = {}
