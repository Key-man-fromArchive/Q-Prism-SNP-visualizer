from __future__ import annotations
from enum import Enum
from pydantic import BaseModel


class WellCycleData(BaseModel):
    well: str          # A1-H12
    cycle: int
    fam: float
    allele2: float     # VIC or HEX
    rox: float | None = None


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


class UploadResponse(BaseModel):
    session_id: str
    instrument: str
    allele2_dye: str
    num_wells: int
    num_cycles: int
    has_rox: bool
    data_windows: list[DataWindow] | None = None


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


class WellType(str, Enum):
    NTC = "NTC"
    UNKNOWN = "Unknown"
    POSITIVE_CONTROL = "Positive Control"
    ALLELE1_HOMO = "Allele 1 Homo"
    ALLELE2_HOMO = "Allele 2 Homo"
    HETEROZYGOUS = "Heterozygous"
    UNDETERMINED = "Undetermined"


class ClusteringAlgorithm(str, Enum):
    THRESHOLD = "threshold"
    KMEANS = "kmeans"


class ThresholdConfig(BaseModel):
    ntc_threshold: float = 0.1
    allele1_ratio_max: float = 0.4
    allele2_ratio_min: float = 0.6


class ClusteringRequest(BaseModel):
    algorithm: ClusteringAlgorithm = ClusteringAlgorithm.THRESHOLD
    cycle: int = 0
    threshold_config: ThresholdConfig | None = None
    n_clusters: int = 4


class ClusteringResult(BaseModel):
    algorithm: str
    cycle: int
    assignments: dict[str, str]


class ManualWellTypeUpdate(BaseModel):
    wells: list[str]
    well_type: WellType
