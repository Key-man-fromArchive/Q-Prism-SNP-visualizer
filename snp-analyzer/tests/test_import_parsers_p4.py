from __future__ import annotations

from pathlib import Path
import zipfile

import pytest

from app.import_errors import ImportValidationError
from app.import_models import AssayModeId, ImportRole, MappingConfig, NormalizationMode
from app.parsers.generic_table import GenericTableParser
from app.parsers.rdml import RDMLParser


FIXTURES = Path(__file__).parent / "fixtures" / "import"
RDML_FIXTURES = FIXTURES / "rdml"


def _rdml_mapping(**overrides) -> MappingConfig:
    payload = {
        "assay_mode": AssayModeId.WT_MT,
        "normalization_mode": NormalizationMode.NONE,
        "channel_roles": {"FAM": ImportRole.WT, "VIC": ImportRole.MT1},
        "rdml_run_id": "run-1",
        "rdml_target_ids": ["WT", "MT"],
    }
    payload.update(overrides)
    return MappingConfig(**payload)


def test_rdml_preview_extracts_runs_targets_channels_and_preview_metadata():
    path = RDML_FIXTURES / "wt_mt.rdml"
    preview = RDMLParser().preview(path, path.name)

    assert preview.parser_id == "rdml"
    assert preview.candidate_tables == ["run-1"]
    assert {channel.channel_id for channel in preview.channel_candidates} == {"FAM", "VIC"}
    assert preview.metadata["preview_first"] is True
    assert preview.metadata["runs"][0]["targets"] == ["MT", "WT"]
    assert preview.metadata["runs"][0]["channels"] == ["FAM", "VIC"]
    assert preview.metadata["runs"][0]["data_points"] == 12
    assert preview.metadata["candidate_channel_mappings"]
    assert preview.warnings[0].code == "mapping_config_required"


def test_rdml_mapped_import_builds_import_run_for_wt_mt_fixture():
    path = RDML_FIXTURES / "wt_mt.rdml"
    run = RDMLParser().parse(path, path.name, _rdml_mapping())

    assert run.instrument == "Q-Prism Synthetic RDML"
    assert run.metadata["format"] == "rdml"
    assert run.metadata["rdml_run_id"] == "run-1"
    assert run.metadata["rdml_target_ids"] == ["MT", "WT"]
    assert {channel.channel_id: channel.role for channel in run.reporter_channels} == {
        "FAM": ImportRole.WT,
        "VIC": ImportRole.MT1,
    }
    assert len(run.readings) == 12
    assert run.samples == {"A1": "Sample_01", "A2": "Sample_02"}
    assert run.targets == {"A1": "WT", "A2": "WT"}


def test_rdml_parser_requires_mapping_confirmation():
    path = RDML_FIXTURES / "wt_mt.rdml"

    with pytest.raises(ImportValidationError) as exc_info:
        RDMLParser().parse(path, path.name)

    assert exc_info.value.issues[0].code == "mapping_config_required"


def test_rdml_multi_run_file_requires_run_selection():
    path = RDML_FIXTURES / "multi_run.rdml"
    mapping = _rdml_mapping(rdml_run_id=None)

    with pytest.raises(ImportValidationError) as exc_info:
        RDMLParser().parse(path, path.name, mapping)

    issue = exc_info.value.issues[0]
    assert issue.code == "mapping_config_required"
    assert issue.context["available_runs"] == ["run-1", "run-2"]


def test_rdml_mapped_import_rejects_missing_raw_curves():
    path = RDML_FIXTURES / "missing_raw_curves.rdml"

    with pytest.raises(ImportValidationError) as exc_info:
        RDMLParser().parse(path, path.name, _rdml_mapping())

    assert {issue.code for issue in exc_info.value.issues} == {"missing_field", "missing_required_role"}


def test_rdml_mapped_import_rejects_unsupported_channel_set():
    path = RDML_FIXTURES / "wt_mt.rdml"
    mapping = _rdml_mapping(channel_roles={"FAM": ImportRole.WT, "Cy5": ImportRole.MT1})

    with pytest.raises(ImportValidationError) as exc_info:
        RDMLParser().parse(path, path.name, mapping)

    issue = exc_info.value.issues[0]
    assert issue.code == "unsupported_content"
    assert issue.channel_id == "Cy5"
    assert issue.context["available_channels"] == ["FAM", "VIC"]


def test_rdml_parser_handles_zipped_rdml_archives(tmp_path):
    source = RDML_FIXTURES / "wt_mt.rdml"
    archive = tmp_path / "archive.rdml"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.write(source, "payload/wt_mt.xml")

    preview = RDMLParser().preview(archive, archive.name)

    assert preview.candidate_tables == ["run-1"]
    assert preview.metadata["source_entry"] == "payload/wt_mt.xml"


def test_rdml_parser_rejects_unsafe_xml_declarations(tmp_path):
    path = tmp_path / "unsafe.rdml"
    path.write_text(
        """<?xml version="1.0"?><!DOCTYPE rdml [<!ENTITY x "bad">]><rdml>&x;</rdml>""",
        encoding="utf-8",
    )

    with pytest.raises(ImportValidationError) as exc_info:
        RDMLParser().preview(path, path.name)

    assert exc_info.value.issues[0].code == "unsupported_content"


def test_roche_lightcycler_text_preset_prefills_mapping_but_manual_override_controls_parse(tmp_path):
    path = tmp_path / "LightCycler_export.txt"
    path.write_text(
        "well\tcycle\tfam\tvic\tsample\ttarget\n"
        "A1\t1\t100\t80\tS1\tSNP1\n"
        "A1\t2\t140\t92\tS1\tSNP1\n",
        encoding="utf-8",
    )
    parser = GenericTableParser()
    preview = parser.preview(path, path.name)

    assert preview.metadata["vendor_preset"]["preset_id"] == "roche-lightcycler-text"
    assert preview.suggested_mapping is not None
    assert preview.suggested_mapping.channel_roles == {"fam": ImportRole.WT, "vic": ImportRole.MT1}

    manual_mapping = MappingConfig(
        assay_mode=AssayModeId.WT_MT,
        normalization_mode=NormalizationMode.NONE,
        channel_roles={"fam": ImportRole.MT1, "vic": ImportRole.WT},
        well_column="well",
        cycle_column="cycle",
        sample_column="sample",
        target_column="target",
        rfu_columns={"fam": "fam", "vic": "vic"},
    )
    run = parser.parse(path, path.name, manual_mapping)

    assert {channel.channel_id: channel.role for channel in run.reporter_channels} == {
        "fam": ImportRole.MT1,
        "vic": ImportRole.WT,
    }


def test_analytik_jena_qpcrsoft_preset_prefills_long_table_mapping(tmp_path):
    path = tmp_path / "analytik_qPCRsoft.csv"
    path.write_text(
        "well,cycle,channel,fluorescence,sample,target\n"
        "A1,1,FAM,100,S1,SNP1\n"
        "A1,1,VIC,90,S1,SNP1\n",
        encoding="utf-8",
    )

    preview = GenericTableParser().preview(path, path.name)

    assert preview.metadata["vendor_preset"]["preset_id"] == "analytik-jena-qpcrsoft"
    assert preview.suggested_mapping is not None
    assert preview.suggested_mapping.dye_column == "channel"
    assert preview.suggested_mapping.rfu_column == "fluorescence"


def test_qiagen_rotor_gene_rdml_preset_prefills_mapping_but_manual_override_controls_parse():
    path = RDML_FIXTURES / "qiagen_rotor_gene.rdml"
    parser = RDMLParser()
    preview = parser.preview(path, path.name)

    assert preview.metadata["vendor_preset"]["preset_id"] == "qiagen-rotor-gene-rdml"
    assert preview.suggested_mapping is not None
    assert preview.suggested_mapping.channel_roles == {"FAM": ImportRole.WT, "VIC": ImportRole.MT1}

    manual_mapping = _rdml_mapping(channel_roles={"FAM": ImportRole.MT1, "VIC": ImportRole.WT})
    run = parser.parse(path, path.name, manual_mapping)

    assert {channel.channel_id: channel.role for channel in run.reporter_channels} == {
        "FAM": ImportRole.MT1,
        "VIC": ImportRole.WT,
    }
