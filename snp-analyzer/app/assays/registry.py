from __future__ import annotations

from dataclasses import dataclass

from app.import_models import (
    AssayModeId,
    ImportRole,
    MappingConfig,
    NormalizationMode,
    ValidationIssue,
    ValidationResult,
)


@dataclass(frozen=True)
class AssayModeDefinition:
    mode_id: AssayModeId
    label: str
    required_roles: frozenset[ImportRole]
    optional_roles: frozenset[ImportRole] = frozenset(
        {ImportRole.NORMALIZATION, ImportRole.EXCLUDED, ImportRole.UNKNOWN}
    )


ASSAY_MODES: dict[AssayModeId, AssayModeDefinition] = {
    AssayModeId.WT_MT: AssayModeDefinition(
        mode_id=AssayModeId.WT_MT,
        label="WT/MT",
        required_roles=frozenset({ImportRole.WT, ImportRole.MT1}),
    ),
    AssayModeId.WT_MT1_MT2: AssayModeDefinition(
        mode_id=AssayModeId.WT_MT1_MT2,
        label="WT/MT1/MT2",
        required_roles=frozenset({ImportRole.WT, ImportRole.MT1, ImportRole.MT2}),
    ),
    AssayModeId.WT_MT1_MT2_MT3: AssayModeDefinition(
        mode_id=AssayModeId.WT_MT1_MT2_MT3,
        label="WT/MT1/MT2/MT3",
        required_roles=frozenset({ImportRole.WT, ImportRole.MT1, ImportRole.MT2, ImportRole.MT3}),
    ),
}

NORMALIZATION_MODES_REQUIRING_CHANNEL = {
    NormalizationMode.PASSIVE_REFERENCE,
    NormalizationMode.CUSTOM,
    NormalizationMode.MANUAL,
}

UNIQUE_BINDING_ROLES = {ImportRole.WT, ImportRole.MT1, ImportRole.MT2, ImportRole.MT3, ImportRole.NORMALIZATION}


class AssayMappingError(ValueError):
    def __init__(self, issues: list[ValidationIssue]):
        self.issues = issues
        super().__init__("; ".join(issue.message for issue in issues))


def validate_mapping_config(config: MappingConfig, *, raise_on_error: bool = False) -> ValidationResult:
    definition = ASSAY_MODES[config.assay_mode]
    issues: list[ValidationIssue] = []
    bound_roles = _bound_roles(config)

    missing_roles = sorted(
        (role.value for role in definition.required_roles if role not in bound_roles),
        key=_role_sort_key,
    )
    if missing_roles:
        issues.append(
            ValidationIssue(
                code="missing_required_role",
                message=f"Missing required role binding: {', '.join(missing_roles)}",
                recoverable=True,
                context={"roles": missing_roles},
            )
        )

    issues.extend(_duplicate_role_issues(config))

    if (
        config.normalization_mode in NORMALIZATION_MODES_REQUIRING_CHANNEL
        and ImportRole.NORMALIZATION not in bound_roles
    ):
        issues.append(
            ValidationIssue(
                code="missing_normalization_channel",
                message=f"Normalization mode '{config.normalization_mode.value}' requires a normalization channel",
                recoverable=True,
            )
        )

    if issues and raise_on_error:
        raise AssayMappingError(issues)
    return ValidationResult(valid=not issues, issues=issues)


def _bound_roles(config: MappingConfig) -> set[ImportRole]:
    return {
        role
        for role in config.channel_roles.values()
        if role not in {ImportRole.EXCLUDED, ImportRole.UNKNOWN}
    }


def _duplicate_role_issues(config: MappingConfig) -> list[ValidationIssue]:
    channels_by_role: dict[ImportRole, list[str]] = {}
    for channel_id, role in config.channel_roles.items():
        if role in UNIQUE_BINDING_ROLES:
            channels_by_role.setdefault(role, []).append(channel_id)

    issues: list[ValidationIssue] = []
    for role, channel_ids in sorted(channels_by_role.items(), key=lambda item: _role_sort_key(item[0].value)):
        if len(channel_ids) > 1:
            issues.append(
                ValidationIssue(
                    code="duplicate_role_binding",
                    message=f"Role '{role.value}' is bound to multiple channels",
                    recoverable=True,
                    context={"role": role.value, "channels": sorted(channel_ids)},
                )
            )
    return issues


def _role_sort_key(value: str) -> int:
    order = {
        ImportRole.WT.value: 0,
        ImportRole.MT1.value: 1,
        ImportRole.MT2.value: 2,
        ImportRole.MT3.value: 3,
        ImportRole.NORMALIZATION.value: 4,
    }
    return order.get(value, 99)
