"""Whole-run CSV uses one validated completed-result snapshot."""
import csv
import io
from types import SimpleNamespace

import pytest

from fixtures_ux_followup import make_ux_plate
from test_marker_contract import data_client as _data_client, _register

data_client = _data_client


@pytest.fixture
def plate(data_client: SimpleNamespace) -> SimpleNamespace:
    _register(data_client, "export", make_ux_plate())
    response = data_client.client.post(
        "/api/data/export/cluster",
        json={"cycle": 20, "use_rox": False, "algorithm": "threshold"},
    )
    assert response.status_code == 200, response.text
    return data_client


def test_omitted_conditions_use_completed_cycle_and_metadata(plate: SimpleNamespace) -> None:
    response = plate.client.get("/api/data/export/export/csv")
    assert response.status_code == 200
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert len(rows) == 96
    assert rows[0]["FAM (norm)"] == "90.0"
    assert rows[0]["Cycle"] == "20"
    assert rows[0]["Scope"] == "whole-run"
    assert rows[0]["Algorithm"] == "threshold"
    assert rows[0]["Result Revision"] == str(
        plate.clustering.cluster_store["export"].analysis_context.result_revision
    )
    assert "whole-run_cycle20" in response.headers["content-disposition"]


@pytest.mark.parametrize("query", ["cycle=40", "cycle=0", "use_rox=true", "background=pre_read"])
def test_explicit_mismatch_rejected(plate: SimpleNamespace, query: str) -> None:
    response = plate.client.get(f"/api/data/export/export/csv?{query}")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "EXPORT_CONDITION_MISMATCH"


@pytest.mark.parametrize("state,code", [
    ("missing", "NO_COMPLETED_RESULT"),
    ("legacy", "LEGACY_CONTEXT_UNKNOWN"),
    ("incomplete", "LEGACY_CONTEXT_UNKNOWN"),
    ("stale", "INPUT_REVISION_CONFLICT"),
    ("pending", "ANALYSIS_IN_PROGRESS"),
    ("replaced", "RESULT_REVISION_CONFLICT"),
])
def test_export_state_conflicts(plate: SimpleNamespace, state: str, code: str) -> None:
    from app.models import ClusteringRequest
    from app.processing.analysis_state import fail_analysis

    result = plate.clustering.cluster_store["export"]
    ticket = None
    query = ""
    if state == "missing":
        plate.clustering.cluster_store.pop("export")
    elif state == "legacy":
        result.analysis_context = None
    elif state == "incomplete":
        result.analysis_context.parameters.pop("manual_well_types")
    elif state == "stale":
        plate.upload.sessions["export"].input_revision += 1
    elif state == "pending":
        ticket, _ = plate.clustering._capture_analysis("export", ClusteringRequest(cycle=20))
    else:
        query = "?result_revision=00000000-0000-0000-0000-000000000000"
    try:
        response = plate.client.get(f"/api/data/export/export/csv{query}")
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == code
    finally:
        if ticket is not None:
            fail_analysis(ticket)


@pytest.mark.parametrize("key,value", [
    ("manual_well_types", []), ("manual_well_types", {"A1": 3}),
    ("effective_well_types", None), ("ratio_origin", {}),
    ("threshold_config", None), ("ploidy", "two"), ("requested_algorithm", None),
])
def test_incomplete_provenance_is_not_exportable(plate: SimpleNamespace, key: str, value: object) -> None:
    plate.clustering.cluster_store["export"].analysis_context.parameters[key] = value
    response = plate.client.get("/api/data/export/export/csv")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "LEGACY_CONTEXT_UNKNOWN"


@pytest.mark.parametrize("cycle,use_rox,background,expected", [
    (20, True, "none", 9.0), (40, False, "none", 170.0),
    (40, True, "none", 17.0), (20, True, "pre_read", 8.0),
])
def test_real_numeric_conditions(plate: SimpleNamespace, cycle: int, use_rox: bool, background: str, expected: float) -> None:
    response = plate.client.post("/api/data/export/cluster", json={
        "cycle": cycle, "use_rox": use_rox, "background": background,
    })
    assert response.status_code == 200
    revision = response.json()["analysis_context"]["result_revision"]
    response = plate.client.get(f"/api/data/export/export/csv?result_revision={revision}")
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert float(rows[0]["FAM (norm)"]) == expected
    assert float(rows[0]["FAM (raw)"]) == (80.0 if background == "pre_read" else 10.0 + 4 * cycle)
    assert rows[0]["Raw Coordinate Basis"] == "post-background/pre-reference"


def test_zero_sentinel_and_failed_latest_retained_result(plate: SimpleNamespace) -> None:
    from app.models import ClusteringRequest
    from app.processing.analysis_state import fail_analysis

    assert plate.client.post("/api/data/export/cluster", json={"cycle": 0}).status_code == 200
    ticket, _ = plate.clustering._capture_analysis("export", ClusteringRequest(cycle=20))
    fail_analysis(ticket)
    response = plate.client.get("/api/data/export/export/csv?cycle=0")
    assert response.status_code == 200
    assert next(csv.DictReader(io.StringIO(response.text)))["Cycle"] == "41"


def test_domain_precedes_state_and_access_precedes_disclosure(plate: SimpleNamespace) -> None:
    plate.clustering.cluster_store.pop("export")
    assert plate.client.get("/api/data/export/export/csv?cycle=999").status_code == 400
    assert plate.client.get("/api/data/export/export/csv?background=channel_min").status_code == 400
    assert plate.client.get("/api/data/export/export/csv?background=invalid").status_code == 422
    assert plate.client.get("/api/data/export/export/csv?cycle=-1").status_code == 422
    db = plate.db.get_db()
    db.execute("INSERT INTO users (id,username,hashed_password,role) VALUES ('other','other','unused','user')")
    db.execute("UPDATE sessions SET user_id='other' WHERE session_id='export'")
    db.commit()
    response = plate.client.get("/api/data/export/export/csv?cycle=999")
    assert response.status_code == 403
    assert "current_input_revision" not in response.text
    assert plate.client.get("/api/data/missing/export/csv").status_code == 404


def test_accepted_snapshot_survives_replacement_metadata_mutation_and_delete(plate: SimpleNamespace) -> None:
    from app.auth import TokenData
    from app.models import ProtocolStep
    from app.reporting.result_snapshot import ExportOptions, capture_result_snapshot
    from app.routers.data import protocol_store
    from app.routers.export import render_snapshot_csv
    from app.routers.sample import sample_name_store

    sample_name_store["export"] = {"A1": "captured override"}
    plate.clustering.group_store["export"] = {"captured group": ["A1"]}
    protocol_store["export"] = [ProtocolStep(step=1, temperature=95, duration_sec=10)]
    snapshot = capture_result_snapshot("export", TokenData(user_id="user-1", username="user1", role="user"), ExportOptions())
    before = render_snapshot_csv(snapshot)
    plate.client.post("/api/data/export/cluster", json={"cycle": 40})
    plate.client.put("/api/data/export/samples", json={"samples": {"A1": "later override"}})
    plate.clustering.group_store["export"]["captured group"].append("A2")
    protocol_store["export"][0].temperature = 12
    plate.upload.sessions["export"].data[20].fam = 999
    assert plate.client.delete("/api/sessions/export").status_code == 200
    assert render_snapshot_csv(snapshot) == before
    assert snapshot.sample_names["A1"] == "captured override"
    assert snapshot.groups == {"captured group": ["A1"]}
    assert snapshot.group_sources == {"captured group": "manual"}
    assert snapshot.protocol[0].temperature == 95
    assert snapshot.raw_filename == "test.eds"


@pytest.mark.parametrize("manual", [False, True])
def test_imported_unknown_and_explicit_manual_unknown(plate: SimpleNamespace, manual: bool) -> None:
    unified = plate.upload.sessions["export"]
    unified.imported_well_types = dict.fromkeys(unified.wells, "Unknown")
    if manual:
        plate.client.post("/api/data/export/welltypes", json={"wells": ["A1"], "well_type": "Unknown"})
    assert plate.client.post("/api/data/export/cluster", json={"cycle": 20}).status_code == 200
    result = plate.clustering.cluster_store["export"]
    response = plate.client.get("/api/data/export/export/csv")
    row = next(csv.DictReader(io.StringIO(response.text)))
    assert row["Genotype"] == ("Unknown" if manual else result.assignments["A1"])


def test_heterogeneous_missing_and_unassigned_rows_no_inference(plate: SimpleNamespace) -> None:
    from fixtures_ux_followup import make_ux_markers

    unified = plate.upload.sessions["export"]
    unified.data = [d for d in unified.data if not (d.well == "A1" and d.cycle == 20)]
    plate.client.post("/api/data/export/welltypes", json={"wells": ["A2"], "well_type": "Omit"})
    plate.client.post("/api/data/export/welltypes", json={"wells": ["A3"], "well_type": "Empty"})
    response = plate.client.post("/api/data/export/cluster", json={
        "cycle": 20, "regions": [m.model_dump() for m in make_ux_markers(unified)],
    })
    assert response.status_code == 200, response.text
    result = plate.clustering.cluster_store["export"]
    result.assignments.pop("A4", None)
    result.assignments["A5"] = "Undetermined"
    response = plate.client.get("/api/data/export/export/csv")
    rows = {r["Well"]: r for r in csv.DictReader(io.StringIO(response.text))}
    assert len(rows) == 96
    assert rows["A1"]["Read Status"] == "missing"
    assert rows["A1"]["FAM (norm)"] == ""
    assert rows["A2"]["Genotype"] == "Omit"
    assert rows["A3"]["Genotype"] == "Empty"
    assert rows["A4"]["Genotype"] == "Unknown"
    assert rows["A5"]["Genotype"] == "Undetermined"
    assert rows["H9"]["Genotype"] == "Unassigned"
    assert rows["E1"]["Ploidy"] == "6"
    assert rows["E1"]["Marker ID"] == "synthetic-hexaploid"


@pytest.mark.parametrize("label", [
    "=1+1", "+SUM(A1)", "-cmd", "@SUM(A1)", "\t=1+1", "\ttext", "\rtext", "\ntext",
    "＝1+1", "＋SUM(A1)", "－cmd", "＠SUM(A1)",
])
def test_csv_text_formula_safety_preserves_raw_labels_and_negative_numbers(plate: SimpleNamespace, label: str) -> None:
    from app.auth import TokenData
    from app.reporting.result_snapshot import ExportOptions, capture_result_snapshot
    from app.routers.export import render_snapshot_csv
    from app.routers.sample import sample_name_store

    sample_name_store["export"] = {"A1": label}
    for reading in plate.upload.sessions["export"].data:
        if reading.well == "A1" and reading.cycle == 20:
            reading.fam = -5.5
    snapshot = capture_result_snapshot("export", TokenData(user_id="user-1", username="user1", role="user"), ExportOptions())
    row = next(csv.DictReader(io.StringIO(render_snapshot_csv(snapshot))))
    assert snapshot.sample_names["A1"] == label
    assert row["Sample Name"] == "'" + label
    assert row["FAM (raw)"] == "-5.5"
    assert row["FAM (norm)"] == "-5.5"


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf")])
def test_nonfinite_coordinates_are_unavailable(plate: SimpleNamespace, value: float) -> None:
    for reading in plate.upload.sessions["export"].data:
        if reading.well == "A1" and reading.cycle == 20:
            reading.fam = value
    response = plate.client.get("/api/data/export/export/csv")
    row = next(csv.DictReader(io.StringIO(response.text)))
    assert row["Read Status"] == "unavailable"
    assert row["FAM (raw)"] == ""
    assert row["FAM (norm)"] == ""


@pytest.mark.parametrize("corruption", ["cycle", "absent_cycle", "region_id", "wells", "ploidy", "overlap"])
def test_context_result_consistency_is_required(plate: SimpleNamespace, corruption: str) -> None:
    from fixtures_ux_followup import make_ux_markers

    unified = plate.upload.sessions["export"]
    assert plate.client.post("/api/data/export/cluster", json={
        "cycle": 20, "regions": [m.model_dump() for m in make_ux_markers(unified)],
    }).status_code == 200
    result = plate.clustering.cluster_store["export"]
    context = result.analysis_context
    if corruption == "cycle":
        result.cycle = 40
    elif corruption == "absent_cycle":
        result.cycle = context.cycle = 999
    elif corruption == "region_id":
        context.regions[0].marker_id = "wrong"
    elif corruption == "wells":
        context.regions[0].wells.pop()
    elif corruption == "ploidy":
        context.regions[0].ploidy = 6
    else:
        context.regions[1].wells.append("A1")
        result.regions[1].wells.append("A1")
    response = plate.client.get("/api/data/export/export/csv")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "LEGACY_CONTEXT_UNKNOWN"


def test_csv_delimiters_quotes_and_confidence_remain_exact(plate: SimpleNamespace) -> None:
    from app.routers.sample import sample_name_store

    sample_name_store["export"] = {"A1": 'ordinary,"=literal"\nsecond line'}
    plate.clustering.cluster_store["export"].confidences = {"A1": 0.12345}
    response = plate.client.get("/api/data/export/export/csv")
    row = next(csv.DictReader(io.StringIO(response.text)))
    assert row["Sample Name"] == 'ordinary,"=literal"\nsecond line'
    assert row["Confidence (%)"] == "12.3"


def test_snapshot_retains_parsed_group_source_and_effective_reference_label(plate: SimpleNamespace) -> None:
    from app.auth import TokenData
    from app.reporting.result_snapshot import ExportOptions, capture_result_snapshot
    from app.routers.export import render_snapshot_csv

    unified = plate.upload.sessions["export"]
    unified.well_groups = {"parsed": ["A1"]}
    unified.normalization_dye = "CY5"
    snapshot = capture_result_snapshot("export", TokenData(user_id="user-1", username="user1", role="user"), ExportOptions())
    unified.well_groups["parsed"].append("A2")
    assert snapshot.group_sources == {"parsed": "parsed"}
    assert snapshot.groups == {"parsed": ["A1"]}
    row = next(csv.DictReader(io.StringIO(render_snapshot_csv(snapshot))))
    assert row["Passive Reference Dye"] == "CY5"
    assert row["ROX (raw)"] == "10.0"


@pytest.mark.parametrize("channel,explicit_value,expected", [
    ("CY5", None, "CY5"), (None, 20.0, "unknown"), (None, None, "ROX"),
])
def test_reference_label_does_not_guess_rox(
    plate: SimpleNamespace, channel: str | None, explicit_value: float | None, expected: str,
) -> None:
    unified = plate.upload.sessions["export"]
    unified.normalization_dye = None
    unified.normalization_channel = channel
    for reading in unified.data:
        reading.normalization_value = explicit_value
    response = plate.client.get("/api/data/export/export/csv")
    row = next(csv.DictReader(io.StringIO(response.text)))
    assert row["Passive Reference Dye"] == expected


@pytest.mark.parametrize("label", ["NTC", "Unknown", "Empty", "Omit", None])
def test_outside_marker_membership_is_independent_of_captured_role(
    plate: SimpleNamespace, label: str | None,
) -> None:
    from fixtures_ux_followup import make_ux_markers

    unified = plate.upload.sessions["export"]
    unified.imported_well_types["H9"] = "Unknown"
    if label is not None:
        assert plate.client.post("/api/data/export/welltypes", json={
            "wells": ["H9"], "well_type": label,
        }).status_code == 200
    assert plate.client.post("/api/data/export/cluster", json={
        "cycle": 20, "regions": [m.model_dump() for m in make_ux_markers(unified)],
    }).status_code == 200
    response = plate.client.get("/api/data/export/export/csv")
    rows = {r["Well"]: r for r in csv.DictReader(io.StringIO(response.text))}
    assert rows["H9"]["Assignment Status"] == "outside_marker"
    assert rows["H9"]["Genotype"] == (label or "Unassigned")
    assert rows["H11"]["Assignment Status"] == "outside_marker"
    assert rows["H11"]["Genotype"] == "NTC"
