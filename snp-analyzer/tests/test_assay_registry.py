import pytest

from app.assays.registry import AssayMappingError, validate_mapping_config
from app.import_models import AssayModeId, ImportRole, MappingConfig, NormalizationMode


@pytest.mark.parametrize(
    ("assay_mode", "roles"),
    [
        (AssayModeId.WT_MT, {"ch1": ImportRole.WT, "ch2": ImportRole.MT1}),
        (
            AssayModeId.WT_MT1_MT2,
            {"ch1": ImportRole.WT, "ch2": ImportRole.MT1, "ch3": ImportRole.MT2},
        ),
        (
            AssayModeId.WT_MT1_MT2_MT3,
            {
                "ch1": ImportRole.WT,
                "ch2": ImportRole.MT1,
                "ch3": ImportRole.MT2,
                "ch4": ImportRole.MT3,
            },
        ),
    ],
)
def test_assay_modes_accept_required_role_sets(assay_mode, roles):
    config = MappingConfig(
        assay_mode=assay_mode,
        normalization_mode=NormalizationMode.NONE,
        channel_roles=roles,
    )

    result = validate_mapping_config(config)

    assert result.valid is True
    assert result.issues == []


def test_assay_registry_rejects_missing_required_roles():
    config = MappingConfig(
        assay_mode=AssayModeId.WT_MT1_MT2,
        normalization_mode=NormalizationMode.NONE,
        channel_roles={"ch1": ImportRole.WT, "ch2": ImportRole.MT1},
    )

    result = validate_mapping_config(config)

    assert result.valid is False
    assert [issue.code for issue in result.issues] == ["missing_required_role"]
    assert result.issues[0].context == {"roles": ["MT2"]}


def test_assay_registry_rejects_duplicate_role_bindings():
    config = MappingConfig(
        assay_mode=AssayModeId.WT_MT,
        normalization_mode=NormalizationMode.NONE,
        channel_roles={"ch1": ImportRole.WT, "ch2": ImportRole.WT, "ch3": ImportRole.MT1},
    )

    result = validate_mapping_config(config)

    assert result.valid is False
    assert [issue.code for issue in result.issues] == ["duplicate_role_binding"]
    assert result.issues[0].context == {"role": "WT", "channels": ["ch1", "ch2"]}


@pytest.mark.parametrize(
    "mode",
    [NormalizationMode.PASSIVE_REFERENCE, NormalizationMode.CUSTOM, NormalizationMode.MANUAL],
)
def test_normalization_modes_that_require_channels_reject_missing_binding(mode):
    config = MappingConfig(
        assay_mode=AssayModeId.WT_MT,
        normalization_mode=mode,
        channel_roles={"ch1": ImportRole.WT, "ch2": ImportRole.MT1},
    )

    result = validate_mapping_config(config)

    assert result.valid is False
    assert [issue.code for issue in result.issues] == ["missing_normalization_channel"]


def test_normalization_binding_is_accepted_when_required_channel_is_present():
    config = MappingConfig(
        assay_mode=AssayModeId.WT_MT,
        normalization_mode=NormalizationMode.PASSIVE_REFERENCE,
        channel_roles={
            "ch1": ImportRole.WT,
            "ch2": ImportRole.MT1,
            "ch3": ImportRole.NORMALIZATION,
        },
    )

    result = validate_mapping_config(config)

    assert result.valid is True


def test_raise_on_invalid_mapping_uses_structured_issues():
    config = MappingConfig(
        assay_mode=AssayModeId.WT_MT,
        normalization_mode=NormalizationMode.NONE,
        channel_roles={"ch1": ImportRole.WT},
    )

    with pytest.raises(AssayMappingError) as ctx:
        validate_mapping_config(config, raise_on_error=True)

    assert ctx.value.issues[0].code == "missing_required_role"
