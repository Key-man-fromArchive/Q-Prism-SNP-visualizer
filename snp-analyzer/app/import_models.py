from __future__ import annotations

import math
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ImportRole(str, Enum):
    WT = "WT"
    MT1 = "MT1"
    MT2 = "MT2"
    MT3 = "MT3"
    NORMALIZATION = "normalization"
    EXCLUDED = "excluded"
    UNKNOWN = "unknown"


class AssayModeId(str, Enum):
    WT_MT = "wt_mt"
    WT_MT1_MT2 = "wt_mt1_mt2"
    WT_MT1_MT2_MT3 = "wt_mt1_mt2_mt3"


class NormalizationMode(str, Enum):
    NONE = "none"
    PASSIVE_REFERENCE = "passive_reference"
    CUSTOM = "custom"
    MANUAL = "manual"


class ReporterChannel(BaseModel):
    channel_id: str
    dye_name: str | None = None
    role: ImportRole = ImportRole.UNKNOWN

    @field_validator("channel_id")
    @classmethod
    def channel_id_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("channel_id must not be blank")
        return value

    @field_validator("dye_name")
    @classmethod
    def dye_name_must_not_be_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class ImportReading(BaseModel):
    well: str
    cycle: int = Field(ge=1)
    channel_id: str
    rfu: float

    @field_validator("well")
    @classmethod
    def well_must_not_be_blank(cls, value: str) -> str:
        value = value.strip().upper()
        if not value:
            raise ValueError("well must not be blank")
        return value

    @field_validator("channel_id")
    @classmethod
    def channel_id_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("channel_id must not be blank")
        return value

    @field_validator("rfu")
    @classmethod
    def rfu_must_be_finite(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("rfu must be finite")
        return value


class CqValue(BaseModel):
    well: str
    channel_id: str
    cq: float | None = None


class AssayMode(BaseModel):
    mode_id: AssayModeId
    label: str
    required_roles: set[ImportRole]
    optional_roles: set[ImportRole] = Field(
        default_factory=lambda: {ImportRole.NORMALIZATION, ImportRole.EXCLUDED, ImportRole.UNKNOWN}
    )


class ImportRun(BaseModel):
    instrument: str
    plate_rows: int = Field(default=8, ge=1)
    plate_cols: int = Field(default=12, ge=1)
    reporter_channels: list[ReporterChannel]
    readings: list[ImportReading]
    samples: dict[str, str] = Field(default_factory=dict)
    targets: dict[str, str] = Field(default_factory=dict)
    cq_values: list[CqValue] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_readings_reference_channels(self) -> ImportRun:
        channel_ids = {channel.channel_id for channel in self.reporter_channels}
        duplicate_keys: set[tuple[str, int, str]] = set()
        seen_keys: set[tuple[str, int, str]] = set()

        for reading in self.readings:
            if reading.channel_id not in channel_ids:
                raise ValueError(f"reading references unknown channel_id: {reading.channel_id}")
            key = (reading.well, reading.cycle, reading.channel_id)
            if key in seen_keys:
                duplicate_keys.add(key)
            seen_keys.add(key)

        if duplicate_keys:
            formatted = ", ".join(f"{well}/{cycle}/{channel}" for well, cycle, channel in sorted(duplicate_keys))
            raise ValueError(f"duplicate reading for well/cycle/channel: {formatted}")
        return self


class MappingConfig(BaseModel):
    assay_mode: AssayModeId
    normalization_mode: NormalizationMode = NormalizationMode.NONE
    channel_roles: dict[str, ImportRole]
    delimiter: str | None = None
    decimal_separator: str | None = None
    header_row: int | None = Field(default=None, ge=0)
    first_data_row: int | None = Field(default=None, ge=0)
    well_column: str | None = None
    cycle_column: str | None = None
    sample_column: str | None = None
    target_column: str | None = None
    dye_column: str | None = None
    role_column: str | None = None
    rfu_column: str | None = None
    rfu_columns: dict[str, str] = Field(default_factory=dict)

    @field_validator("channel_roles")
    @classmethod
    def channel_roles_must_not_be_empty(cls, value: dict[str, ImportRole]) -> dict[str, ImportRole]:
        if not value:
            raise ValueError("channel_roles must not be empty")
        return {channel_id.strip(): role for channel_id, role in value.items()}


class ValidationIssue(BaseModel):
    code: str
    message: str
    recoverable: bool = False
    row: int | None = None
    column: str | None = None
    channel_id: str | None = None
    context: dict[str, Any] = Field(default_factory=dict)


class ValidationResult(BaseModel):
    valid: bool
    issues: list[ValidationIssue] = Field(default_factory=list)


class ImportPreview(BaseModel):
    preview_id: str
    parser_id: str
    filename: str
    candidate_tables: list[str] = Field(default_factory=list)
    inferred_delimiter: str | None = None
    decimal_separator: str | None = None
    header_row: int | None = None
    first_data_row: int | None = None
    inferred_headers: list[str] = Field(default_factory=list)
    column_candidates: dict[str, list[str]] = Field(default_factory=dict)
    sample_rows: list[dict[str, Any]] = Field(default_factory=list)
    channel_candidates: list[ReporterChannel] = Field(default_factory=list)
    assay_mode_candidates: list[AssayModeId] = Field(default_factory=list)
    warnings: list[ValidationIssue] = Field(default_factory=list)
    suggested_mapping: MappingConfig | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PreviewRequiredPayload(BaseModel):
    status: str = "preview_required"
    reason_code: str = "mapping_required"
    message: str
    filename: str
    parser_id: str | None = None
    preview_id: str | None = None
    supported_extensions: list[str] = Field(default_factory=list)
    warnings: list[ValidationIssue] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")
