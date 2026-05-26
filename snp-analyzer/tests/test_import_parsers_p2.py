import json
from pathlib import Path

import pytest

from app.import_errors import ImportValidationError
from app.import_models import AssayModeId, ImportRole, MappingConfig, NormalizationMode
from app.parsers.generic_table import (
    GenericLongParser,
    GenericTableParser,
    GenericWideParser,
)
from app.parsers.rdes import QPrismRDESParser


FIXTURES = Path(__file__).parent / "fixtures" / "import"


ASSAY_MODE_LABELS = {
    "WT/MT": AssayModeId.WT_MT,
    "WT/MT1/MT2": AssayModeId.WT_MT1_MT2,
    "WT/MT1/MT2/MT3": AssayModeId.WT_MT1_MT2_MT3,
}


def _load_wide_mapping(path: Path) -> MappingConfig:
    payload = json.loads(path.read_text())
    return MappingConfig(
        assay_mode=ASSAY_MODE_LABELS[payload["assay_mode"]],
        normalization_mode=NormalizationMode(payload["normalization"]),
        channel_roles={channel: ImportRole(role) for channel, role in payload["channels"].items()},
        well_column="well",
        cycle_column="cycle",
        sample_column="sample",
        target_column="target",
        rfu_columns={channel: channel for channel in payload["channels"]},
    )


def _issue_codes(error: ImportValidationError) -> list[str]:
    return [issue.code for issue in error.issues]


def test_generic_long_parser_reads_wt_mt_fixture():
    run = GenericLongParser().parse(FIXTURES / "generic_long" / "wt_mt.csv", "wt_mt.csv")

    assert run.instrument == "Generic Long Table"
    assert run.samples == {"A1": "Sample_01"}
    assert run.targets == {"A1": "SNP1"}
    assert [channel.role for channel in run.reporter_channels] == [ImportRole.WT, ImportRole.MT1]
    assert len(run.readings) == 6
    assert sorted({reading.cycle for reading in run.readings}) == [1, 2, 3]


@pytest.mark.parametrize(
    ("filename", "expected_roles", "expected_readings"),
    [
        ("wt_mt_rox_norm.csv", [ImportRole.WT, ImportRole.MT1, ImportRole.NORMALIZATION], 9),
        ("wt_mt1_mt2.csv", [ImportRole.WT, ImportRole.MT1, ImportRole.MT2], 9),
        ("wt_mt1_mt2_mt3.csv", [ImportRole.WT, ImportRole.MT1, ImportRole.MT2, ImportRole.MT3], 12),
    ],
)
def test_generic_long_parser_supports_all_fixture_role_sets(filename, expected_roles, expected_readings):
    run = GenericLongParser().parse(FIXTURES / "generic_long" / filename, filename)

    assert [channel.role for channel in run.reporter_channels] == expected_roles
    assert len(run.readings) == expected_readings


def test_generic_long_parser_accepts_semicolon_decimal_comma_fixture():
    run = GenericLongParser().parse(
        FIXTURES / "generic_long" / "decimal_comma_semicolon.csv",
        "decimal_comma_semicolon.csv",
    )

    assert run.readings[0].rfu == pytest.approx(120.1)
    assert run.readings[1].rfu == pytest.approx(98.2)


@pytest.mark.parametrize(
    ("filename", "expected_code", "recoverable"),
    [
        ("cq_only.csv", "cq_endpoint_only", False),
        ("duplicate_channel_row.csv", "duplicate_reading", False),
        ("malformed_well.csv", "malformed_well", True),
        ("missing_required_role.csv", "missing_required_role", True),
    ],
)
def test_generic_long_parser_reports_structured_invalid_fixture_errors(
    filename,
    expected_code,
    recoverable,
):
    with pytest.raises(ImportValidationError) as ctx:
        GenericLongParser().parse(FIXTURES / "invalid" / "generic_long" / filename, filename)

    assert expected_code in _issue_codes(ctx.value)
    assert next(issue for issue in ctx.value.issues if issue.code == expected_code).recoverable is recoverable


@pytest.mark.parametrize(
    ("stem", "expected_readings"),
    [
        ("wt_mt", 6),
        ("wt_mt_rox_norm", 9),
        ("wt_mt1_mt2", 9),
        ("wt_mt1_mt2_mt3", 12),
    ],
)
def test_generic_wide_parser_requires_mapping_and_reads_fixture_matrix(stem, expected_readings):
    parser = GenericWideParser()
    csv_path = FIXTURES / "generic_wide" / f"{stem}.csv"

    with pytest.raises(ImportValidationError) as ctx:
        parser.parse(csv_path, csv_path.name)
    assert _issue_codes(ctx.value) == ["mapping_config_required"]

    run = parser.parse(csv_path, csv_path.name, _load_wide_mapping(csv_path.with_suffix(".mapping.json")))

    assert run.instrument == "Generic Wide Table"
    assert len(run.readings) == expected_readings
    assert run.samples == {"A1": "Sample_01"}


@pytest.mark.parametrize(
    ("stem", "expected_code"),
    [
        ("duplicate_role_binding", "duplicate_role_binding"),
        ("missing_normalization_channel", "missing_normalization_channel"),
    ],
)
def test_generic_wide_parser_reports_invalid_mapping_fixtures(stem, expected_code):
    csv_path = FIXTURES / "invalid" / "generic_wide" / f"{stem}.csv"

    with pytest.raises(ImportValidationError) as ctx:
        GenericWideParser().parse(csv_path, csv_path.name, _load_wide_mapping(csv_path.with_suffix(".mapping.json")))

    assert expected_code in _issue_codes(ctx.value)


def test_mapping_configured_generic_table_parses_dye_rows_from_non_template_txt(tmp_path):
    source = FIXTURES / "generic_long" / "decimal_comma_semicolon.csv"
    txt_path = tmp_path / "instrument-export.txt"
    txt_path.write_text(source.read_text())
    config = MappingConfig(
        assay_mode=AssayModeId.WT_MT,
        normalization_mode=NormalizationMode.NONE,
        channel_roles={"FAM": ImportRole.WT, "VIC": ImportRole.MT1},
        delimiter=";",
        decimal_separator=",",
        header_row=0,
        first_data_row=1,
        well_column="well",
        cycle_column="cycle",
        sample_column="sample",
        target_column="target",
        dye_column="dye",
        rfu_column="rfu",
    )

    run = GenericTableParser().parse(txt_path, txt_path.name, config)

    assert run.instrument == "Generic Mapped Table"
    assert len(run.readings) == 4
    assert run.readings[0].rfu == pytest.approx(120.1)


def test_mapping_configured_generic_table_parses_xlsx_channel_columns(tmp_path):
    openpyxl = pytest.importorskip("openpyxl")
    csv_path = FIXTURES / "generic_wide" / "wt_mt.csv"
    xlsx_path = tmp_path / "wide.xlsx"
    rows = [line.split(",") for line in csv_path.read_text().splitlines()]
    workbook = openpyxl.Workbook()
    worksheet = workbook.active
    for row in rows:
        worksheet.append(row)
    workbook.save(xlsx_path)

    run = GenericTableParser().parse(
        xlsx_path,
        xlsx_path.name,
        _load_wide_mapping(FIXTURES / "generic_wide" / "wt_mt.mapping.json"),
    )

    assert len(run.readings) == 6
    assert run.reporter_channels[0].channel_id == "ch1_rfu"


def test_mapping_configured_generic_table_rejects_missing_structural_fields():
    config = MappingConfig(
        assay_mode=AssayModeId.WT_MT,
        normalization_mode=NormalizationMode.NONE,
        channel_roles={"FAM": ImportRole.WT, "VIC": ImportRole.MT1},
        rfu_column="rfu",
        dye_column="dye",
    )

    with pytest.raises(ImportValidationError) as ctx:
        GenericTableParser().parse(FIXTURES / "generic_long" / "wt_mt.csv", "wt_mt.csv", config)

    assert "missing_field" in _issue_codes(ctx.value)


def test_mapping_configured_generic_table_rejects_cq_endpoint_only_file():
    config = MappingConfig(
        assay_mode=AssayModeId.WT_MT,
        normalization_mode=NormalizationMode.NONE,
        channel_roles={"FAM": ImportRole.WT, "VIC": ImportRole.MT1},
        delimiter=",",
        header_row=0,
        first_data_row=1,
        well_column="well",
        cycle_column="cycle",
        dye_column="dye",
        rfu_column="rfu",
    )

    with pytest.raises(ImportValidationError) as ctx:
        GenericTableParser().parse(FIXTURES / "invalid" / "generic_long" / "cq_only.csv", "cq_only.csv", config)

    assert _issue_codes(ctx.value) == ["cq_endpoint_only"]


def test_generic_table_blocks_formula_as_rfu(tmp_path):
    path = tmp_path / "formula.csv"
    path.write_text("well,cycle,ch1_rfu,ch2_rfu\nA1,1,=1+2,9.0\n")
    config = MappingConfig(
        assay_mode=AssayModeId.WT_MT,
        normalization_mode=NormalizationMode.NONE,
        channel_roles={"ch1_rfu": ImportRole.WT, "ch2_rfu": ImportRole.MT1},
        well_column="well",
        cycle_column="cycle",
        rfu_columns={"ch1_rfu": "ch1_rfu", "ch2_rfu": "ch2_rfu"},
    )

    with pytest.raises(ImportValidationError) as ctx:
        GenericTableParser().parse(path, path.name, config)

    assert _issue_codes(ctx.value) == ["formula_as_rfu"]


def test_generic_table_applies_row_safety_limit(monkeypatch):
    monkeypatch.setattr("app.parsers.generic_table.MAX_IMPORT_ROWS", 2)

    with pytest.raises(ImportValidationError) as ctx:
        GenericLongParser().parse(FIXTURES / "generic_long" / "wt_mt.csv", "wt_mt.csv")

    assert _issue_codes(ctx.value) == ["file_limit_exceeded"]


@pytest.mark.parametrize(
    ("filename", "expected_roles", "expected_readings"),
    [
        ("wt_mt.tsv", [ImportRole.WT, ImportRole.MT1], 6),
        ("wt_mt_rox_norm.tsv", [ImportRole.WT, ImportRole.MT1, ImportRole.NORMALIZATION], 9),
        ("wt_mt1_mt2.tsv", [ImportRole.WT, ImportRole.MT1, ImportRole.MT2], 9),
    ],
)
def test_qprism_rdes_extension_parser_reads_role_column_fixture_matrix(
    filename,
    expected_roles,
    expected_readings,
):
    run = QPrismRDESParser().parse(FIXTURES / "rdes_extension" / filename, filename)

    assert run.instrument == "Q-Prism RDES Extension"
    assert [channel.role for channel in run.reporter_channels] == expected_roles
    assert len(run.readings) == expected_readings
    assert run.metadata["format"] == "qprism_rdes_extension"


def test_qprism_rdes_parser_treats_strict_rdes_without_role_as_mapping_required():
    path = FIXTURES / "strict_rdes" / "mapping_required_preview_only.tsv"
    parser = QPrismRDESParser()

    preview = parser.preview(path, path.name)

    assert preview.parser_id == "qprism-rdes"
    assert preview.warnings[0].code == "mapping_config_required"
    with pytest.raises(ImportValidationError) as ctx:
        parser.parse(path, path.name)
    assert _issue_codes(ctx.value) == ["mapping_config_required"]


@pytest.mark.parametrize(
    ("filename", "expected_code"),
    [
        ("malformed_cycle_columns.tsv", "missing_field"),
        ("inconsistent_cycle_count.tsv", "inconsistent_cycle_count"),
        ("missing_rfu.tsv", "invalid_numeric_value"),
    ],
)
def test_qprism_rdes_parser_reports_invalid_fixture_errors(filename, expected_code):
    with pytest.raises(ImportValidationError) as ctx:
        QPrismRDESParser().parse(FIXTURES / "invalid" / "rdes_extension" / filename, filename)

    assert expected_code in _issue_codes(ctx.value)
