from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

from app.import_models import ValidationIssue


class ImportErrorCode(str, Enum):
    UNSUPPORTED_CONTENT = "unsupported_content"
    MAPPING_CONFIG_REQUIRED = "mapping_config_required"
    CQ_ENDPOINT_ONLY = "cq_endpoint_only"
    MISSING_FIELD = "missing_field"
    MALFORMED_WELL = "malformed_well"
    DUPLICATE_READING = "duplicate_reading"
    DUPLICATE_ROLE_BINDING = "duplicate_role_binding"
    MISSING_REQUIRED_ROLE = "missing_required_role"
    MISSING_NORMALIZATION_CHANNEL = "missing_normalization_channel"
    DECIMAL_SEPARATOR_MISMATCH = "decimal_separator_mismatch"
    INCONSISTENT_CYCLE_COUNT = "inconsistent_cycle_count"
    FORMULA_AS_RFU = "formula_as_rfu"
    FILE_LIMIT_EXCEEDED = "file_limit_exceeded"
    INVALID_NUMERIC_VALUE = "invalid_numeric_value"


@dataclass(frozen=True)
class ImportErrorPolicy:
    code: ImportErrorCode
    recoverable: bool
    message: str


_POLICIES: dict[ImportErrorCode, ImportErrorPolicy] = {
    ImportErrorCode.UNSUPPORTED_CONTENT: ImportErrorPolicy(
        ImportErrorCode.UNSUPPORTED_CONTENT,
        False,
        "The file content is not a supported qPCR amplification table.",
    ),
    ImportErrorCode.MAPPING_CONFIG_REQUIRED: ImportErrorPolicy(
        ImportErrorCode.MAPPING_CONFIG_REQUIRED,
        True,
        "Channel-to-role mapping is required before this file can be imported.",
    ),
    ImportErrorCode.CQ_ENDPOINT_ONLY: ImportErrorPolicy(
        ImportErrorCode.CQ_ENDPOINT_ONLY,
        False,
        "This file contains Cq or endpoint values only; per-cycle RFU values are required.",
    ),
    ImportErrorCode.MISSING_FIELD: ImportErrorPolicy(
        ImportErrorCode.MISSING_FIELD,
        True,
        "A required structural field is missing from the selected table.",
    ),
    ImportErrorCode.MALFORMED_WELL: ImportErrorPolicy(
        ImportErrorCode.MALFORMED_WELL,
        True,
        "A well identifier is outside the supported plate geometry.",
    ),
    ImportErrorCode.DUPLICATE_READING: ImportErrorPolicy(
        ImportErrorCode.DUPLICATE_READING,
        False,
        "Duplicate well/cycle/channel RFU rows are blocked by default.",
    ),
    ImportErrorCode.DUPLICATE_ROLE_BINDING: ImportErrorPolicy(
        ImportErrorCode.DUPLICATE_ROLE_BINDING,
        True,
        "A role is bound to more than one channel.",
    ),
    ImportErrorCode.MISSING_REQUIRED_ROLE: ImportErrorPolicy(
        ImportErrorCode.MISSING_REQUIRED_ROLE,
        True,
        "The selected assay mode is missing a required role binding.",
    ),
    ImportErrorCode.MISSING_NORMALIZATION_CHANNEL: ImportErrorPolicy(
        ImportErrorCode.MISSING_NORMALIZATION_CHANNEL,
        True,
        "The selected normalization mode requires a populated normalization channel.",
    ),
    ImportErrorCode.DECIMAL_SEPARATOR_MISMATCH: ImportErrorPolicy(
        ImportErrorCode.DECIMAL_SEPARATOR_MISMATCH,
        True,
        "RFU values appear to use a different decimal separator than the mapping config.",
    ),
    ImportErrorCode.INCONSISTENT_CYCLE_COUNT: ImportErrorPolicy(
        ImportErrorCode.INCONSISTENT_CYCLE_COUNT,
        False,
        "Rows have inconsistent cycle counts and cannot be repaired automatically.",
    ),
    ImportErrorCode.FORMULA_AS_RFU: ImportErrorPolicy(
        ImportErrorCode.FORMULA_AS_RFU,
        False,
        "Formula cells are not accepted as RFU values.",
    ),
    ImportErrorCode.FILE_LIMIT_EXCEEDED: ImportErrorPolicy(
        ImportErrorCode.FILE_LIMIT_EXCEEDED,
        False,
        "The file exceeds the configured import safety limits.",
    ),
    ImportErrorCode.INVALID_NUMERIC_VALUE: ImportErrorPolicy(
        ImportErrorCode.INVALID_NUMERIC_VALUE,
        False,
        "RFU and cycle values must be finite numeric values.",
    ),
}


class ImportValidationError(ValueError):
    def __init__(self, issues: list[ValidationIssue]):
        self.issues = issues
        super().__init__("; ".join(issue.message for issue in issues))


def recovery_policy_for_code(code: ImportErrorCode | str) -> ImportErrorPolicy:
    return _POLICIES[ImportErrorCode(code)]


def make_issue(
    code: ImportErrorCode | str,
    *,
    message: str | None = None,
    row: int | None = None,
    column: str | None = None,
    channel_id: str | None = None,
    context: dict[str, Any] | None = None,
) -> ValidationIssue:
    policy = recovery_policy_for_code(code)
    return ValidationIssue(
        code=policy.code.value,
        message=message or policy.message,
        recoverable=policy.recoverable,
        row=row,
        column=column,
        channel_id=channel_id,
        context=context or {},
    )


def raise_import_error(
    code: ImportErrorCode | str,
    *,
    message: str | None = None,
    row: int | None = None,
    column: str | None = None,
    channel_id: str | None = None,
    context: dict[str, Any] | None = None,
) -> None:
    raise ImportValidationError(
        [
            make_issue(
                code,
                message=message,
                row=row,
                column=column,
                channel_id=channel_id,
                context=context,
            )
        ]
    )
