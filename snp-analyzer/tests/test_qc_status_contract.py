"""QC provenance and unavailable evaluation are explicit, not clean results."""

from types import SimpleNamespace

import pytest

from test_marker_contract import data_client as _data_client, _plate_unified, _register

data_client = _data_client


@pytest.mark.parametrize("manual_unknown", [False, True])
def test_imported_unknown_preserves_real_auto_calls_but_manual_unknown_overrides(
    plate: SimpleNamespace,
    manual_unknown: bool,
) -> None:
    from app.models import RatioOrigin
    from app.processing.normalize import normalize_for_cycle
    from app.processing.ratio_origin import shift_points_to_origin
    from app.routers.qc import _cluster_separation_for

    unified = plate.upload.sessions["s1"]
    unified.imported_well_types = dict.fromkeys(unified.wells, "Unknown")
    if manual_unknown:
        changed = plate.client.post(
            "/api/data/s1/welltypes", json={"wells": ["A1"], "well_type": "Unknown"}
        )
        assert changed.json()["input_revision"] == 1
    response = plate.client.post(
        "/api/data/s1/cluster",
        json={
            "cycle": 1,
            "use_rox": False,
            "algorithm": "auto",
            "regions": [
                {"id": "m", "name": "Synthetic", "wells": unified.wells, "ploidy": 2}
            ],
        },
    )
    assert response.status_code == 200
    result = plate.clustering.cluster_store["s1"]
    assert len(set(result.assignments.values())) == 2
    points = shift_points_to_origin(
        normalize_for_cycle(unified, 1, use_rox=False),
        RatioOrigin.model_validate(result.analysis_context.parameters["ratio_origin"]),
    )
    expected_calls = dict(result.assignments)
    if manual_unknown:
        expected_calls["A1"] = "Unknown"
    expected = _cluster_separation_for(expected_calls, points)
    assert expected is not None
    before = plate.client.get("/api/data/s1/qc?cycle=1&use_rox=false").json()
    assert before["markers"][0]["cluster_separation"] == expected
    assert result.analysis_context.parameters["manual_well_types"] == (
        {"A1": "Unknown"} if manual_unknown else {}
    )
    plate.client.post(
        "/api/data/s1/welltypes", json={"wells": ["A2"], "well_type": "NTC"}
    )
    after = plate.client.get("/api/data/s1/qc?cycle=3").json()
    assert after["judgment_status"] == "stale"
    assert after["markers"] == before["markers"]


def test_old_context_without_explicit_manual_provenance_is_unavailable(
    plate: SimpleNamespace,
) -> None:
    plate.client.post("/api/data/s1/cluster", json={"cycle": 1})
    result = plate.clustering.cluster_store["s1"]
    result.analysis_context.parameters.pop("manual_well_types", None)
    body = plate.client.get("/api/data/s1/qc").json()
    assert body["judgment_status"] == "legacy_unknown"
    assert body["judgment_reason"] == "context_missing"
    assert body["context_status"] == "verified"
    assert body["cluster_separation"] is None


def test_calculation_captures_explicit_manual_map_before_later_clear(
    plate: SimpleNamespace,
) -> None:
    from app.models import ClusteringRequest
    from app.processing.analysis_state import fail_analysis

    plate.upload.sessions["s1"].imported_well_types = {"A1": "Unknown"}
    plate.client.post(
        "/api/data/s1/welltypes", json={"wells": ["A1"], "well_type": "Unknown"}
    )
    ticket, snapshot = plate.clustering._capture_analysis(
        "s1", ClusteringRequest(cycle=1)
    )
    plate.client.delete("/api/data/s1/welltypes")
    result = plate.clustering._calculate_snapshot(snapshot)
    assert result.analysis_context.parameters["manual_well_types"] == {"A1": "Unknown"}
    assert result.analysis_context.parameters["effective_well_types"]["A1"] == "Unknown"
    fail_analysis(ticket)


@pytest.fixture
def plate(data_client: SimpleNamespace) -> SimpleNamespace:
    _register(data_client, "s1", _plate_unified())
    return data_client


def test_no_ntc_and_missing_judgment(plate: SimpleNamespace) -> None:
    body = plate.client.get("/api/data/s1/qc").json()
    assert body["ntc_check"]["status"] == "no_ntc"
    assert body["judgment_status"] == "missing"
    assert body["judgment_reason"] == "no_completed_result"
    assert body["n_called"] == 0
    assert body["cluster_separation"] is None


def test_declared_missing_and_contaminated_ntcs_are_all_reported(
    plate: SimpleNamespace,
) -> None:
    unified = plate.upload.sessions["s1"]
    unified.imported_well_types = {"A1": "NTC", "A2": "NTC"}
    unified.data = [d for d in unified.data if not (d.well == "A2" and d.cycle == 3)]
    check = plate.client.get("/api/data/s1/qc").json()["ntc_check"]
    assert check["status"] == "warning"
    wells = {w["well"]: w for w in check["wells"]}
    assert wells["A1"]["flagged"] is True
    assert wells["A2"]["signal"] is None
    assert wells["A2"]["flagged"] is None
    assert wells["A2"]["reason"] == "missing_signal"


def test_judgment_uses_completed_conditions_after_input_edit(
    plate: SimpleNamespace,
) -> None:
    from app.models import AnalysisContext

    result = plate.client.post("/api/data/s1/cluster", json={"cycle": 1}).json()
    before = plate.client.get("/api/data/s1/qc?cycle=1").json()
    plate.client.post(
        "/api/data/s1/welltypes", json={"wells": ["A1"], "well_type": "NTC"}
    )
    after = plate.client.get("/api/data/s1/qc?cycle=3").json()
    assert after["judgment_status"] == "stale"
    assert after["input_revision"] == 0
    assert after["current_input_revision"] == 1
    assert after["context_status"] == "verified"
    assert AnalysisContext.model_validate(
        after["analysis_context"]
    ) == AnalysisContext.model_validate(result["analysis_context"])
    assert after["n_called"] == before["n_called"]
    assert after["cluster_separation"] == before["cluster_separation"]
    assert after["ntc_check"]["cycle"] == 3


def test_no_window_onset_is_not_evaluated(plate: SimpleNamespace) -> None:
    body = plate.client.get("/api/data/s1/suggest-cycle").json()
    assert body["ntc_onset_status"] == "not_evaluated"
    assert body["ntc_onset_reason"] == "insufficient_points"


@pytest.mark.parametrize(
    "signal,status,flagged,reason",
    [
        (0.01, "ok", False, "none"),
        (1000.0, "warning", True, "signal_above_threshold"),
        (None, "insufficient", None, "missing_signal"),
    ],
)
def test_current_ntc_evaluation(
    plate: SimpleNamespace,
    signal: float | None,
    status: str,
    flagged: bool | None,
    reason: str,
) -> None:
    unified = plate.upload.sessions["s1"]
    unified.imported_well_types = {"A1": "NTC"}
    for d in unified.data:
        if d.well == "A1":
            d.fam, d.allele2 = signal or 0, 0
    if signal is None:
        unified.data = [d for d in unified.data if d.well != "A1"]
    check = plate.client.get("/api/data/s1/qc?use_rox=true").json()["ntc_check"]
    assert check["status"] == status
    assert check["wells"][0]["flagged"] is flagged
    assert check["wells"][0]["reason"] == reason
    assert check["normalization_applied"] is False  # no ROX retains raw fallback
    assert check["scope"] == "plate"


def test_zero_plate_reference_is_unavailable(plate: SimpleNamespace) -> None:
    unified = plate.upload.sessions["s1"]
    unified.imported_well_types = {"A1": "NTC"}
    for d in unified.data:
        d.fam = d.allele2 = 0
    check = plate.client.get("/api/data/s1/qc").json()["ntc_check"]
    assert check["status"] == "insufficient"
    assert check["wells"][0]["reason"] == "missing_reference"
    assert check["wells"][0]["signal"] == 0


def test_legacy_counts_are_readable_without_invented_separation(
    plate: SimpleNamespace,
) -> None:
    from app.models import ClusteringResult

    plate.clustering.cluster_store["s1"] = ClusteringResult(
        algorithm="threshold", cycle=1, assignments={"A1": "Allele 1 Homo"}
    )
    body = plate.client.get("/api/data/s1/qc").json()
    assert body["judgment_status"] == "legacy_unknown"
    assert body["judgment_reason"] == "context_missing"
    assert body["n_called"] == 1
    assert body["cluster_separation"] is None


@pytest.mark.parametrize(
    "count,missing,flat,status,reason",
    [
        (4, False, False, "not_evaluated", "insufficient_points"),
        (8, False, False, "not_evaluated", "insufficient_points"),
        (10, True, False, "not_evaluated", "missing_signal"),
        (10, False, True, "not_evaluated", "no_ntc"),
        (10, False, False, "not_detected", "none"),
    ],
)
def test_onset_evaluation_reasons(
    plate: SimpleNamespace,
    count: int,
    missing: bool,
    flat: bool,
    status: str,
    reason: str,
) -> None:
    from app.models import DataWindow, WellCycleData

    unified = plate.upload.sessions["s1"]
    unified.cycles = list(range(1, count + 1))
    unified.wells = ["A1", "A2", "A3"]
    unified.data_windows = [
        DataWindow(name="Amplification", start_cycle=1, end_cycle=count)
    ]
    unified.data = [
        WellCycleData(
            well=w, cycle=c, fam=(1 if w == "A1" or flat else c * 100), allele2=0
        )
        for w in unified.wells
        for c in unified.cycles
        if not (missing and w != "A1" and c == 1)
    ]
    body = plate.client.get("/api/data/s1/suggest-cycle").json()
    assert body["ntc_onset_cycle"] is None
    assert body["ntc_onset_status"] == status
    assert body["ntc_onset_reason"] == reason


@pytest.mark.parametrize(
    "cycle,use_rox,background",
    [
        (20, False, "none"),
        (40, True, "none"),
        (20, True, "pre_read"),
        (40, False, "pre_read"),
    ],
)
def test_plate_conditions_do_not_recalculate_stored_judgment(
    plate: SimpleNamespace, cycle: int, use_rox: bool, background: str
) -> None:
    from fixtures_ux_followup import make_ux_plate
    from app.processing.normalize import normalize_for_cycle

    unified = make_ux_plate()
    _register(plate, "synthetic", unified)
    result = plate.client.post(
        "/api/data/synthetic/cluster", json={"cycle": 20, "use_rox": False}
    ).json()
    before = plate.client.get("/api/data/synthetic/qc?cycle=20&use_rox=false").json()
    body = plate.client.get(
        f"/api/data/synthetic/qc?cycle={cycle}&use_rox={str(use_rox).lower()}&background={background}"
    ).json()
    check = body["ntc_check"]
    assert (check["cycle"], check["use_rox"], check["background"]) == (
        cycle,
        use_rox,
        background,
    )
    assert check["normalization_applied"] is use_rox
    points = {
        p.well: p
        for p in normalize_for_cycle(
            unified, cycle, use_rox=use_rox, background=background
        )
    }
    for well in check["wells"]:
        p = points[well["well"]]
        assert well["signal"] == pytest.approx(p.norm_fam + p.norm_allele2)
    assert body["result_revision"] == result["analysis_context"]["result_revision"]
    assert body["cluster_separation"] == before["cluster_separation"]
    assert body["n_called"] == before["n_called"]


def test_pending_and_failed_request_do_not_erase_verified_judgment(
    plate: SimpleNamespace,
) -> None:
    from app.models import ClusteringRequest
    from app.processing.analysis_state import fail_analysis

    plate.client.post("/api/data/s1/cluster", json={"cycle": 1})
    ticket, _ = plate.clustering._capture_analysis("s1", ClusteringRequest(cycle=2))
    pending = plate.client.get("/api/data/s1/qc").json()
    assert pending["analysis_pending"] is True
    assert pending["judgment_status"] == "verified"
    fail_analysis(ticket)
    failed = plate.client.get("/api/data/s1/qc").json()
    assert failed["analysis_status"] == "failed"
    assert failed["judgment_status"] == "verified"


@pytest.mark.parametrize("cohort", ["complete", "missing", "nonfinite"])
def test_real_derivative_onset_is_detected(plate: SimpleNamespace, cohort: str) -> None:
    from app.models import DataWindow, WellCycleData
    from app.processing.ntc_detection import _analyze_amplification

    unified = _plate_unified()
    unified.wells = ["A1", "A2", "A3", "A4"]
    unified.cycles = list(range(1, 13))
    unified.data_windows = [
        DataWindow(name="Amplification", start_cycle=1, end_cycle=12)
    ]
    unified.data = [
        WellCycleData(
            well=w,
            cycle=c,
            fam=(1 + max(c - 8, 0) ** 2 if w == "A1" else c * 100),
            allele2=0,
        )
        for w in unified.wells
        for c in unified.cycles
    ]
    if cohort == "missing":
        unified.data = [
            d for d in unified.data if not (d.well == "A4" and d.cycle == 1)
        ]
    elif cohort == "nonfinite":
        for d in unified.data:
            if d.well == "A4" and d.cycle == 6:
                d.fam = float("nan")
    info = _analyze_amplification(unified)
    assert info is not None
    assert info["ntc_onset_status"] == "detected"
    assert info["ntc_onset_cycle"] is not None
    assert info["ntc_onset_reason"] == "none"


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_nonfinite_ntc_reading_is_unavailable(
    plate: SimpleNamespace, bad: float
) -> None:
    unified = plate.upload.sessions["s1"]
    unified.imported_well_types = {"A1": "NTC"}
    for d in unified.data:
        if d.well == "A1":
            d.fam = bad
    check = plate.client.get("/api/data/s1/qc").json()["ntc_check"]
    assert check["status"] == "insufficient"
    assert check["wells"][0]["signal"] is None
    assert check["wells"][0]["reason"] == "missing_signal"


def test_marker_qc_retains_captured_types_and_definitions(
    plate: SimpleNamespace,
) -> None:
    from fixtures_ux_followup import make_ux_plate, make_ux_markers

    unified = make_ux_plate()
    _register(plate, "markers", unified)
    markers = [m.model_dump() for m in make_ux_markers(unified)]
    plate.client.post("/api/data/markers/markers", json={"markers": markers})
    plate.client.post(
        "/api/data/markers/welltypes", json={"wells": ["A1"], "well_type": "Omit"}
    )
    response = plate.client.post(
        "/api/data/markers/cluster", json={"cycle": 20, "use_rox": False}
    )
    assert response.status_code == 200
    before = plate.client.get("/api/data/markers/qc?cycle=20&use_rox=false").json()
    assert before["authoritative"] == "markers"
    assert before["cluster_separation"] is None
    assert [m["ploidy"] for m in before["markers"]] == [2, 6]
    plate.client.post(
        "/api/data/markers/welltypes", json={"wells": ["A2"], "well_type": "NTC"}
    )
    plate.client.put("/api/data/markers/markers/synthetic-diploid", json={"ploidy": 4})
    after = plate.client.get("/api/data/markers/qc?cycle=40&use_rox=true").json()
    assert after["judgment_status"] == "stale"
    assert after["markers"] == before["markers"]
    assert after["input_revision"] == 2
    assert after["current_input_revision"] == 4


def test_invalid_cycle_and_background_remain_domain_errors(
    plate: SimpleNamespace,
) -> None:
    assert plate.client.get("/api/data/s1/qc?cycle=99").status_code == 400
    assert plate.client.get("/api/data/s1/qc?background=pre_read").status_code == 400


@pytest.mark.parametrize(
    "key,value",
    [
        ("ratio_origin", None),
        ("ratio_origin", {}),
        ("ratio_origin", {"fam": 1, "allele2": 1}),
        ("ratio_origin", {"fam": "bad", "allele2": 1, "source": "ntc"}),
        ("effective_well_types", []),
        ("effective_well_types", {"A1": 3}),
        ("manual_well_types", []),
        ("manual_well_types", {"A1": 3}),
        ("excluded_wells", {}),
        ("excluded_wells", [1]),
    ],
)
def test_incomplete_context_retains_counts_without_inventing_coordinates(
    plate: SimpleNamespace, key: str, value: object
) -> None:
    plate.client.post("/api/data/s1/cluster", json={"cycle": 1})
    result = plate.clustering.cluster_store["s1"]
    if value is None:
        result.analysis_context.parameters.pop(key)
    else:
        result.analysis_context.parameters[key] = value
    body = plate.client.get("/api/data/s1/qc").json()
    assert body["judgment_status"] == "legacy_unknown"
    assert body["judgment_reason"] == "context_missing"
    assert body["context_status"] == "verified"
    assert body["analysis_context"] is not None
    assert body["cluster_separation"] is None


def test_single_separation_uses_measured_not_clamped_coordinates(
    plate: SimpleNamespace,
) -> None:
    from app.models import WellCycleData
    from app.processing.normalize import normalize_for_cycle
    from app.routers.qc import _cluster_separation_for

    plate.client.post("/api/data/s1/cluster", json={"cycle": 1, "use_rox": False})
    unified = plate.upload.sessions["s1"]
    unified.wells = ["A1", "A2", "A3", "A4"]
    unified.data = [
        WellCycleData(well=w, cycle=1, fam=x, allele2=y)
        for w, (x, y) in zip(unified.wells, [(-10, -10), (-5, -5), (10, 0), (12, 0)])
    ]
    result = plate.clustering.cluster_store["s1"]
    result.assignments = {
        "A1": "Allele 1 Homo",
        "A2": "Allele 1 Homo",
        "A3": "Het",
        "A4": "Het",
    }
    result.analysis_context.parameters["ratio_origin"] = {
        "fam": 5.0,
        "allele2": 5.0,
        "source": "ntc",
    }
    expected = _cluster_separation_for(
        result.assignments, normalize_for_cycle(unified, 1, use_rox=False)
    )
    body = plate.client.get("/api/data/s1/qc?cycle=1&use_rox=false").json()
    assert body["cluster_separation"] == expected


def test_partial_curve_cohort_is_not_claimed_fully_evaluated(
    plate: SimpleNamespace,
) -> None:
    from test_cycle_suggestion import _unified_with_amp
    from app.processing.ntc_detection import _analyze_amplification

    unified = _unified_with_amp()
    unified.data = [d for d in unified.data if not (d.well == "A1" and d.cycle == 1)]
    info = _analyze_amplification(unified)
    assert info is not None
    assert info["ntc_onset_cycle"] is None
    assert info["ntc_onset_status"] == "not_evaluated"
    assert info["ntc_onset_reason"] == "missing_signal"


def test_qc_snapshot_is_detached_from_later_mutations(plate: SimpleNamespace) -> None:
    from app.routers.qc import _capture_qc

    plate.client.post("/api/data/s1/cluster", json={"cycle": 1})
    snapshot = _capture_qc("s1")
    original = snapshot.unified.data[0].fam
    plate.upload.sessions["s1"].data[0].fam = original + 100
    plate.clustering.cluster_store["s1"].assignments.clear()
    plate.clustering.welltype_store["s1"] = {"A1": "NTC"}
    assert snapshot.unified.data[0].fam == original
    assert snapshot.result.assignments
    assert snapshot.types == {}


def test_qc_access_is_checked_before_state_disclosure(plate: SimpleNamespace) -> None:
    plate.db.get_db().execute(
        "INSERT INTO users(id,username,hashed_password) VALUES ('another-user','another','unusable')"
    )
    plate.db.get_db().execute(
        "UPDATE sessions SET user_id='another-user' WHERE session_id='s1'"
    )
    plate.db.get_db().commit()
    response = plate.client.get("/api/data/s1/qc")
    assert response.status_code == 403
    assert "current_input_revision" not in response.json()


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_nonfinite_onset_cohort_is_missing_signal(
    plate: SimpleNamespace, bad: float
) -> None:
    from test_cycle_suggestion import _unified_with_amp
    from app.processing.ntc_detection import _analyze_amplification

    unified = _unified_with_amp()
    for d in unified.data:
        if d.well == "H1" and d.cycle == 6:
            d.fam = bad
    info = _analyze_amplification(unified)
    assert info is not None
    assert info["ntc_onset_status"] == "not_evaluated"
    assert info["ntc_onset_reason"] == "missing_signal"
