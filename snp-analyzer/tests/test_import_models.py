import pytest
from pydantic import ValidationError

from app.import_models import (
    AssayModeId,
    AssayMode,
    ImportPreview,
    ImportReading,
    ImportRole,
    ImportRun,
    MappingConfig,
    NormalizationMode,
    ReporterChannel,
    ValidationIssue,
)


def test_import_run_serializes_role_bindings_separately_from_dye_names():
    run = ImportRun(
        instrument="Q-Prism",
        plate_rows=8,
        plate_cols=12,
        reporter_channels=[
            ReporterChannel(channel_id="ch1", dye_name="FAM", role=ImportRole.WT),
            ReporterChannel(channel_id="ch2", dye_name="HEX", role=ImportRole.MT1),
        ],
        readings=[
            ImportReading(well="A1", cycle=1, channel_id="ch1", rfu=101.5),
            ImportReading(well="A1", cycle=1, channel_id="ch2", rfu=88.0),
        ],
        samples={"A1": "sample-1"},
        targets={"A1": "assay-1"},
    )

    payload = run.model_dump(mode="json")

    assert payload["reporter_channels"][0] == {
        "channel_id": "ch1",
        "dye_name": "FAM",
        "role": "WT",
    }
    assert payload["readings"][0]["channel_id"] == "ch1"
    assert payload["readings"][0]["rfu"] == 101.5


def test_import_run_rejects_duplicate_well_cycle_channel_readings():
    with pytest.raises(ValidationError) as ctx:
        ImportRun(
            instrument="Q-Prism",
            reporter_channels=[ReporterChannel(channel_id="ch1", role=ImportRole.WT)],
            readings=[
                ImportReading(well="A1", cycle=1, channel_id="ch1", rfu=1.0),
                ImportReading(well="A1", cycle=1, channel_id="ch1", rfu=2.0),
            ],
        )

    assert "duplicate reading" in str(ctx.value)


def test_mapping_config_and_preview_are_json_serializable_contracts():
    assay_mode = AssayMode(
        mode_id=AssayModeId.WT_MT,
        label="WT/MT",
        required_roles={ImportRole.WT, ImportRole.MT1},
    )
    mapping = MappingConfig(
        assay_mode=AssayModeId.WT_MT,
        normalization_mode=NormalizationMode.NONE,
        channel_roles={"ch1": ImportRole.WT, "ch2": ImportRole.MT1},
        delimiter=",",
        decimal_separator=".",
    )
    preview = ImportPreview(
        preview_id="preview-1",
        parser_id="generic-long",
        filename="plate.csv",
        candidate_tables=["Sheet1"],
        inferred_headers=["well", "cycle", "dye", "rfu"],
        sample_rows=[{"well": "A1", "cycle": 1, "FAM": 100.0}],
        channel_candidates=[ReporterChannel(channel_id="ch1", dye_name="FAM")],
        warnings=[
            ValidationIssue(
                code="ambiguous_format",
                message="Mapping confirmation is required",
                recoverable=True,
            )
        ],
        suggested_mapping=mapping,
    )

    payload = preview.model_dump(mode="json")

    assert set(assay_mode.model_dump(mode="json")["required_roles"]) == {"WT", "MT1"}
    assert payload["preview_id"] == "preview-1"
    assert payload["warnings"][0]["code"] == "ambiguous_format"
    assert payload["suggested_mapping"]["channel_roles"] == {"ch1": "WT", "ch2": "MT1"}
