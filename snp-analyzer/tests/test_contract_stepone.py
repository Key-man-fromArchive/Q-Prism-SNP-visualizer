"""StepOnePlus / marker / export backend contract (P0-T0.3a).

Fixes shared fields, DB v11, marker selection and presentation stubs. These
tests build their own data and do not depend on the synthetic .eds generators.
"""
import json
from dataclasses import fields
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import app.db as db
from app.models import (
    AlleleLabels, AnalysisContext, AnalysisRegionContext, ClusteringResult,
    MarkerRegion, ReadLabel, RegionResult, UnifiedData, UploadResponse, WellCycleData,
)
from app.reporting.result_snapshot import (
    ExportOptions, ResultSnapshot, filter_snapshot, snapshot_rows,
)
from app.reporting.snapshot_presentation import axis_label, cycle_label, display_genotype
from app.routers.export_params import parse_marker_ids


@pytest.fixture
def fresh_db(tmp_path):
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "contract.sqlite3"
    db.init_db()
    yield db
    db._conn.close()
    db._conn = None


def _unified(**extra) -> UnifiedData:
    wells = ["A1", "A2", "B1", "B2"]
    return UnifiedData(
        instrument="StepOnePlus", allele2_dye="VIC", wells=wells, cycles=[1],
        data=[WellCycleData(well=w, cycle=1, fam=100.0, allele2=50.0, rox=10.0) for w in wells],
        **extra,
    )


def _region(marker_id: str, wells: list[str]) -> AnalysisRegionContext:
    return AnalysisRegionContext(
        marker_id=marker_id, name=marker_id.upper(), wells=wells, ploidy=2,
        algorithm="threshold", parameters={},
    )


def _snapshot() -> ResultSnapshot:
    regions = [_region("m1", ["A1", "A2"]), _region("m2", ["B1", "B2"])]
    context = AnalysisContext(
        schema_version=1, result_revision=uuid4(), analysed_at=datetime.now(timezone.utc),
        cycle=1, use_rox=True, normalization_applied=True, background="none",
        algorithm="threshold", parameters={}, regions=regions, input_revision=0,
    )
    result = ClusteringResult(
        algorithm="threshold", cycle=1, assignments={"A1": "Allele 1", "B1": "Allele 2"},
        analysis_context=context,
    )
    unified = _unified()
    return ResultSnapshot(
        "sid", unified, result, context, 0, {"A2": "NTC"},
        {"A1": "s1", "B2": "s4"}, {"g": ["A1", "B1"]}, {"g": "manual"}, [], "f.eds", "ROX",
    )


# --- models -----------------------------------------------------------------


def test_unified_data_new_fields_default_to_legacy_behaviour():
    data = _unified()
    assert data.default_cycle is None
    assert data.has_amplification_curve is True
    assert data.read_labels is None
    assert data.imported_marker_alleles is None


def test_upload_response_new_fields_have_defaults():
    response = UploadResponse(
        session_id="s", instrument="i", allele2_dye="VIC", num_wells=1, num_cycles=1, has_rox=True,
    )
    assert response.default_cycle is None
    assert response.read_labels is None
    assert response.has_amplification_curve is True


@pytest.mark.parametrize("labels", [
    {"fam": "WT", "allele2": "MT"},
    {"fam": "a" * 32, "allele2": "b"},
])
def test_allele_labels_accept_valid(labels):
    assert MarkerRegion(id="m", name="M", wells=["A1"], allele_labels=labels).allele_labels is not None


@pytest.mark.parametrize("labels", [
    {"fam": "", "allele2": "MT"},
    {"fam": "a" * 33, "allele2": "MT"},
    {"fam": "WT"},
    {"fam": "WT", "allele2": "MT", "other": "x"},
    {"fam": "W\nT", "allele2": "MT"},
    {"fam": "WT", "allele2": "M\x00T"},
])
def test_allele_labels_reject_invalid(labels):
    with pytest.raises(ValidationError):
        AlleleLabels(**labels)


def test_marker_region_allele_labels_default_none():
    assert MarkerRegion(id="m", name="M", wells=["A1"]).allele_labels is None


# --- DB v11 -----------------------------------------------------------------


def _marker_columns(conn) -> list[str]:
    return [r[1] for r in conn.execute("PRAGMA table_info(marker_regions)").fetchall()]


def test_fresh_db_has_allele_labels_column_and_v11(fresh_db):
    conn = fresh_db.get_db()
    assert "allele_labels_json" in _marker_columns(conn)
    assert fresh_db._get_schema_version(conn) == 11


def test_v10_db_migrates_to_v11_without_loss(fresh_db):
    conn = fresh_db.get_db()
    conn.execute("INSERT INTO sessions (session_id, instrument, num_wells, num_cycles, allele2_dye, raw_filename) "
                 "VALUES ('old', 'X', 1, 1, 'VIC', 'old.eds')")
    conn.execute("INSERT INTO marker_regions (session_id, marker_id, name, wells_json) "
                 "VALUES ('old', 'm1', 'Old', '[\"A1\"]')")
    conn.execute("ALTER TABLE marker_regions DROP COLUMN allele_labels_json")
    conn.execute("DELETE FROM schema_version WHERE version = 11")
    conn.commit()
    assert fresh_db._get_schema_version(conn) == 10

    fresh_db.init_db()

    conn = fresh_db.get_db()
    assert fresh_db._get_schema_version(conn) == 11
    assert "allele_labels_json" in _marker_columns(conn)
    loaded = fresh_db.load_marker_regions("old")
    assert loaded[0]["name"] == "Old" and loaded[0]["allele_labels"] is None


def test_migration_is_idempotent(fresh_db):
    fresh_db.init_db()
    fresh_db.init_db()
    assert _marker_columns(fresh_db.get_db()).count("allele_labels_json") == 1


def test_marker_allele_labels_round_trip(fresh_db):
    unified = _unified()
    fresh_db.save_session("s1", unified)
    fresh_db.save_marker_regions("s1", [
        {"id": "m1", "name": "One", "wells": ["A1"], "allele_labels": {"fam": "WT", "allele2": "MT"}},
        {"id": "m2", "name": "Two", "wells": ["B1"]},
    ])
    loaded = {m["id"]: m for m in fresh_db.load_marker_regions("s1")}
    assert loaded["m1"]["allele_labels"] == {"fam": "WT", "allele2": "MT"}
    assert loaded["m2"]["allele_labels"] is None
    assert MarkerRegion(**loaded["m1"]).allele_labels == AlleleLabels(fam="WT", allele2="MT")


# --- metadata_json persistence ---------------------------------------------


def test_new_unified_fields_round_trip_through_session_restore(fresh_db):
    unified = _unified(
        default_cycle=1, has_amplification_curve=False,
        read_labels={1: ReadLabel(stage="Post-read", pcr_cycle=None, temperature=30.0)},
        imported_marker_alleles={"QPrism1": AlleleLabels(fam="MT", allele2="WT")},
    )
    fresh_db.save_session("s2", unified)
    restored = fresh_db.load_session("s2")["unified"]
    assert restored.default_cycle == 1
    assert restored.has_amplification_curve is False
    assert list(restored.read_labels) == [1]
    assert isinstance(next(iter(restored.read_labels)), int)
    assert restored.read_labels[1].stage == "Post-read"
    assert restored.imported_marker_alleles == {"QPrism1": AlleleLabels(fam="MT", allele2="WT")}


def test_session_without_new_fields_restores_with_defaults(fresh_db):
    fresh_db.save_session("s3", _unified())
    metadata = json.loads(fresh_db.get_db().execute(
        "SELECT metadata_json FROM sessions WHERE session_id='s3'").fetchone()[0])
    assert not {"default_cycle", "read_labels", "has_amplification_curve",
                "imported_marker_alleles"} & metadata.keys()
    restored = fresh_db.load_session("s3")["unified"]
    assert restored.default_cycle is None and restored.has_amplification_curve is True
    assert restored.read_labels is None and restored.imported_marker_alleles is None


# --- marker selection -------------------------------------------------------


def test_export_options_marker_ids_is_last_field_with_default():
    names = [f.name for f in fields(ExportOptions)]
    assert names[-2:] == ["marker_ids", "orientation"]
    assert ExportOptions().marker_ids is None
    assert ExportOptions().orientation == "fam_x"
    legacy = ExportOptions(None, 1, True, "none", "legacy_latest")
    assert legacy.marker_ids is None and legacy.cycle == 1


def test_parse_marker_ids_valid():
    assert parse_marker_ids(None) is None
    assert parse_marker_ids("m1") == ("m1",)
    assert parse_marker_ids("m1,m2") == ("m1", "m2")
    assert parse_marker_ids(" m1 , m2 ") == ("m1", "m2")


@pytest.mark.parametrize("raw", ["", "  ", ",", "m1,", ",m1", "m1,,m2", "m1,m1", "m1, m1"])
def test_parse_marker_ids_rejects_bad_input(raw):
    with pytest.raises(HTTPException) as exc:
        parse_marker_ids(raw)
    assert exc.value.status_code == 400


def test_filter_snapshot_without_selection_is_identity():
    snapshot = _snapshot()
    assert filter_snapshot(snapshot, None) is snapshot


def test_filter_snapshot_keeps_only_selected_marker():
    snapshot = _snapshot()
    filtered = filter_snapshot(snapshot, ("m2",))
    assert [r.marker_id for r in filtered.context.regions] == ["m2"]
    assert filtered.unified.wells == ["B1", "B2"]
    assert {d.well for d in filtered.unified.data} == {"B1", "B2"}
    assert filtered.sample_names == {"B2": "s4"}
    assert filtered.overrides == {}
    assert filtered.groups == {"g": ["B1"]}
    assert filtered.group_sources == {"g": "manual"}
    assert [r.well for r in snapshot_rows(filtered)] == ["B1", "B2"]
    # the source snapshot is untouched
    assert snapshot.unified.wells == ["A1", "A2", "B1", "B2"]
    assert len(snapshot.context.regions) == 2


def test_filter_snapshot_preserves_requested_order_irrelevant_to_rows():
    filtered = filter_snapshot(_snapshot(), ("m2", "m1"))
    assert [r.well for r in snapshot_rows(filtered)] == ["A1", "A2", "B1", "B2"]


def test_filter_snapshot_unknown_marker_is_400():
    with pytest.raises(HTTPException) as exc:
        filter_snapshot(_snapshot(), ("m1", "nope"))
    assert exc.value.status_code == 400


# --- presentation stubs / routers ------------------------------------------


def test_presentation_stubs_keep_existing_notation():
    snapshot = _snapshot()
    assert display_genotype("Allele 1") == "Allele 1"
    assert axis_label(snapshot, "fam") == "FAM (norm)"
    assert axis_label(snapshot, "allele2") == "VIC (norm)"
    assert cycle_label(snapshot, 3) == "3"


def test_new_routers_are_registered_with_expected_paths():
    from app.main import app
    from app.routers import export_images, export_pptx

    app_paths = {getattr(r, "path", "") for r in app.routes}
    expected = {
        export_pptx: "/api/data/{sid}/export/pptx",
        export_images: "/api/data/{sid}/export/scatter-png.zip",
    }
    for module, path in expected.items():
        assert path in {r.path for r in module.router.routes}
        assert path in app_paths


# --- P0-C2 contract hardening ----------------------------------------------


def test_allele_labels_strip_surrounding_whitespace():
    labels = AlleleLabels(fam="  WT ", allele2="\tMT  ")
    assert (labels.fam, labels.allele2) == ("WT", "MT")


def test_allele_labels_length_is_measured_after_strip():
    assert AlleleLabels(fam=" " + "a" * 32 + " ", allele2="b").fam == "a" * 32
    with pytest.raises(ValidationError):
        AlleleLabels(fam=" " + "a" * 33 + " ", allele2="b")


@pytest.mark.parametrize("bad", [
    "   ", " ", "‮WT", "W​T", "W T", "W T", "W‏T", "W﻿T", "W\x7fT",
])
@pytest.mark.parametrize("field", ["fam", "allele2"])
def test_allele_labels_reject_blank_and_format_characters(field, bad):
    values = {"fam": "WT", "allele2": "MT"}
    values[field] = bad
    with pytest.raises(ValidationError):
        AlleleLabels(**values)


@pytest.mark.parametrize("pair", [("WT", "wt"), ("Mt", "mT"), (" a ", "A")])
def test_allele_labels_reject_names_equal_ignoring_case(pair):
    with pytest.raises(ValidationError):
        AlleleLabels(fam=pair[0], allele2=pair[1])


def test_allele_labels_distinct_names_still_valid():
    assert AlleleLabels(fam="WT", allele2="MT").allele2 == "MT"


def test_filter_snapshot_filters_result_and_well_keyed_fields():
    snapshot = _snapshot()
    snapshot.result.confidences = {"A1": 0.9, "B1": 0.8}
    snapshot.result.regions = [
        RegionResult(id="m1", name="M1", wells=["A1", "A2"], ploidy=2, assignments={"A1": "Allele 1"}),
        RegionResult(id="m2", name="M2", wells=["B1", "B2"], ploidy=2, assignments={"B1": "Allele 2"},
                     confidences={"B1": 0.8}),
    ]
    snapshot.unified.ntc_wells = ["A2", "B2"]
    snapshot.unified.imported_well_types = {"A1": "Unknown", "B2": "NTC"}
    snapshot.unified.well_groups = {"g": ["A1", "B1"], "h": ["A1"]}
    snapshot.unified.imported_markers = {"M1": ["A1", "A2"], "M2": ["B1", "B2"]}
    snapshot.unified.sample_names = {"A1": "s1", "B2": "s4"}
    before = snapshot.unified.model_dump()
    filtered = filter_snapshot(snapshot, ("m2",))
    assert set(filtered.result.assignments) <= {"B1", "B2"}
    assert filtered.result.assignments == {"B1": "Allele 2"}
    assert filtered.result.confidences == {"B1": 0.8}
    assert [r.id for r in filtered.result.regions] == ["m2"]
    assert filtered.unified.ntc_wells == ["B2"]
    assert filtered.unified.imported_well_types == {"B2": "NTC"}
    assert filtered.unified.well_groups == {"g": ["B1"]}
    assert filtered.unified.imported_markers == {"M2": ["B1", "B2"]}
    assert filtered.unified.sample_names == {"B2": "s4"}
    assert snapshot.unified.model_dump() == before
    assert snapshot.result.assignments == {"A1": "Allele 1", "B1": "Allele 2"}


def test_filter_snapshot_keeps_none_optional_fields_none():
    filtered = filter_snapshot(_snapshot(), ("m1",))
    assert filtered.result.confidences is None
    assert filtered.unified.ntc_wells is None
    assert filtered.unified.imported_markers is None


def test_parse_marker_ids_rejects_oversized_raw_value_before_splitting():
    with pytest.raises(HTTPException) as exc:
        parse_marker_ids("m," * 3000)
    assert exc.value.status_code == 400
    assert "too long" in exc.value.detail.lower()
    assert parse_marker_ids("a" * 4096) == ("a" * 4096,)
