"""Deterministic publication barriers plus real scientific snapshot regressions."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

import pytest

from test_marker_contract import data_client as _data_client, _plate_unified, _register
from fixtures_ux_followup import make_ux_plate

data_client = _data_client


@pytest.fixture
def plate(data_client: SimpleNamespace, monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    from app.processing import analysis_state
    monkeypatch.setattr(analysis_state, "publication_states", {})
    _register(data_client, "s1", _plate_unified())
    return data_client


def test_result_captures_resolved_conditions(plate: SimpleNamespace) -> None:
    body = plate.client.post("/api/data/s1/cluster", json={"cycle": 0}).json()
    context = body["analysis_context"]
    assert context["cycle"] == 3
    assert context["input_revision"] == 0
    assert context["normalization_applied"] is False
    assert context["parameters"]["threshold_config"]["ntc_threshold"] == 0.1
    assert context["parameters"]["n_clusters"] == 4
    assert context["parameters"]["requested_algorithm"] == "threshold"
    assert context["parameters"]["manual_well_types"] == {}
    assert body["analysis_status"] == "completed"


def test_save_failure_keeps_previous_memory_and_database(plate: SimpleNamespace, monkeypatch: pytest.MonkeyPatch) -> None:
    plate.client.post("/api/data/s1/cluster", json={"cycle": 1})
    previous = plate.clustering.cluster_store["s1"].model_dump()
    def fail_save(*args: object) -> None:
        raise RuntimeError("synthetic save failure")
    monkeypatch.setattr(plate.db, "save_clustering", fail_save)
    with pytest.raises(RuntimeError, match="synthetic save failure"):
        plate.client.post("/api/data/s1/cluster", json={"cycle": 2})
    assert plate.clustering.cluster_store["s1"].model_dump() == previous
    assert plate.db.load_all_sessions()[0]["clustering"].model_dump() == previous


@pytest.mark.parametrize("newer_fails", [False, True])
def test_newer_request_prevents_old_publication(plate: SimpleNamespace, monkeypatch: pytest.MonkeyPatch, newer_fails: bool) -> None:
    started, release = Event(), Event()
    calculate = plate.clustering._calculate_snapshot
    def paused(snapshot):
        if snapshot.cycle == 1:
            started.set()
            assert release.wait(5)
        elif newer_fails:
            raise RuntimeError("synthetic calculation failure")
        return calculate(snapshot)
    monkeypatch.setattr(plate.clustering, "_calculate_snapshot", paused)
    with ThreadPoolExecutor(max_workers=2) as pool:
        older = pool.submit(plate.client.post, "/api/data/s1/cluster", json={"cycle": 1})
        try:
            assert started.wait(5)
            assert plate.client.get("/api/data/s1/cluster").json()["analysis_pending"] is True
            if newer_fails:
                with pytest.raises(RuntimeError, match="synthetic calculation failure"):
                    plate.client.post("/api/data/s1/cluster", json={"cycle": 2})
            else:
                assert plate.client.post("/api/data/s1/cluster", json={"cycle": 2}).status_code == 200
        finally:
            release.set()
        assert older.result(timeout=5).status_code == 409
    if newer_fails:
        assert plate.clustering.cluster_store.get("s1") is None
        assert plate.client.get("/api/data/s1/cluster").json()["analysis_status"] == "failed"
    else:
        assert plate.clustering.cluster_store["s1"].cycle == 2


@pytest.mark.parametrize("mutation", ["welltype", "marker", "delete"])
def test_input_mutation_or_delete_blocks_inflight_result(plate: SimpleNamespace, monkeypatch: pytest.MonkeyPatch, mutation: str) -> None:
    plate.client.post("/api/data/s1/cluster", json={"cycle": 1})
    previous = plate.clustering.cluster_store["s1"].model_dump()
    started, release = Event(), Event()
    calculate = plate.clustering._calculate_snapshot
    captured = []
    def paused(snapshot):
        captured.append(snapshot)
        started.set()
        assert release.wait(5)
        return calculate(snapshot)
    monkeypatch.setattr(plate.clustering, "_calculate_snapshot", paused)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(plate.client.post, "/api/data/s1/cluster", json={"cycle": 2})
        try:
            assert started.wait(5)
            if mutation == "welltype":
                assert plate.client.post("/api/data/s1/welltypes", json={"wells": ["A1"], "well_type": "Omit"}).status_code == 200
                assert "A1" not in captured[0].welltypes
            elif mutation == "marker":
                assert plate.client.post("/api/data/s1/markers", json={"markers": [{"id": "m", "name": "Synthetic", "wells": ["A1"]}]}).status_code == 200
                assert captured[0].request.regions == []
            else:
                assert plate.client.delete("/api/sessions/s1").status_code == 200
                _register(plate, "s1", _plate_unified())
        finally:
            release.set()
        assert pending.result(timeout=5).status_code == (404 if mutation == "delete" else 409)
    if mutation == "delete":
        assert "s1" not in plate.clustering.cluster_store
        assert plate.client.get("/api/data/s1/cluster").json()["analysis_status"] == "idle"
    else:
        assert plate.clustering.cluster_store["s1"].model_dump() == previous


@pytest.mark.asyncio
async def test_cancelled_worker_cannot_publish_or_leave_pending(plate: SimpleNamespace, monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio
    from app.auth import TokenData
    from app.models import ClusteringRequest
    from app.processing.analysis_state import analysis_status
    started, release, finished = asyncio.Event(), Event(), Event()
    loop = asyncio.get_running_loop()
    calculate = plate.clustering._calculate_snapshot
    def paused(snapshot):
        loop.call_soon_threadsafe(started.set)
        try:
            assert release.wait(5)
            return calculate(snapshot)
        finally:
            finished.set()
    monkeypatch.setattr(plate.clustering, "_calculate_snapshot", paused)
    task = asyncio.create_task(plate.clustering.run_clustering(
        "s1", ClusteringRequest(cycle=1), TokenData(user_id="user-1", username="user1", role="user")))
    try:
        await asyncio.wait_for(started.wait(), 5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert analysis_status("s1") == {"analysis_pending": False, "analysis_status": "failed"}
    finally:
        release.set()
        assert await asyncio.to_thread(finished.wait, 5)
    assert "s1" not in plate.clustering.cluster_store


@pytest.mark.parametrize("reference,expected", [(None, False), (0.0, False), (-1.0, False), (2.0, True)])
def test_actual_zero_cycle_and_reference_fallback(plate: SimpleNamespace, reference: float | None, expected: bool) -> None:
    unified = _plate_unified()
    unified.cycles = [0]
    unified.data = [d.model_copy(update={"cycle": 0, "rox": reference}) for d in unified.data if d.cycle == 1]
    unified.has_rox = True
    _register(plate, "zero", unified)
    response = plate.client.post("/api/data/zero/cluster", json={"cycle": 0, "use_rox": True})
    assert response.status_code == 200
    context = response.json()["analysis_context"]
    assert context["cycle"] == 0
    assert context["normalization_applied"] is expected


def test_auto_regions_do_not_claim_requested_kmeans_count(plate: SimpleNamespace) -> None:
    body = plate.client.post("/api/data/s1/cluster", json={"algorithm": "kmeans", "regions": [
        {"id": "auto", "name": "Auto", "wells": ["A1", "A2"], "ploidy": 2},
    ]}).json()
    assert body["analysis_context"]["algorithm"] == "auto"
    assert body["analysis_context"]["parameters"]["n_clusters_applied"] is False
    assert body["analysis_context"]["regions"][0]["parameters"]["n_clusters_applied"] is False


def test_published_snapshot_survives_connection_reopen(plate: SimpleNamespace) -> None:
    plate.client.post("/api/data/s1/cluster", json={"cycle": 2})
    previous = plate.clustering.cluster_store["s1"].model_dump()
    plate.db.get_db().close()
    plate.db._conn = None
    plate.db.init_db()
    assert plate.db.load_all_sessions()[0]["clustering"].model_dump() == previous


def test_replaced_session_object_does_not_inherit_pending_status(plate: SimpleNamespace) -> None:
    from app.models import ClusteringRequest
    from app.processing.analysis_state import analysis_status, fail_analysis
    old_ticket, _ = plate.clustering._capture_analysis("s1", ClusteringRequest(cycle=1))
    assert analysis_status("s1")["analysis_pending"] is True
    plate.upload.sessions["s1"] = plate.upload.sessions["s1"].model_copy(deep=True)
    assert analysis_status("s1") == {"analysis_pending": False, "analysis_status": "idle"}
    new_ticket, _ = plate.clustering._capture_analysis("s1", ClusteringRequest(cycle=2))
    assert new_ticket.state is not old_ticket.state
    fail_analysis(old_ticket)
    assert analysis_status("s1")["analysis_pending"] is True
    fail_analysis(new_ticket)


def test_another_session_finishes_while_first_worker_paused(plate: SimpleNamespace, monkeypatch: pytest.MonkeyPatch) -> None:
    _register(plate, "s2", _plate_unified())
    started, release = Event(), Event()
    calculate = plate.clustering._calculate_snapshot
    def paused(snapshot):
        if snapshot.cycle == 1:
            started.set()
            assert release.wait(5)
        return calculate(snapshot)
    monkeypatch.setattr(plate.clustering, "_calculate_snapshot", paused)
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(plate.client.post, "/api/data/s1/cluster", json={"cycle": 1})
        try:
            assert started.wait(5)
            assert plate.client.post("/api/data/s2/cluster", json={"cycle": 2}).status_code == 200
        finally:
            release.set()
        assert first.result(timeout=5).status_code == 200


@pytest.mark.parametrize("cycle,use_rox,background", [(20, False, "none"), (40, True, "pre_read")])
def test_real_numeric_inputs_and_defaults_are_preserved(plate: SimpleNamespace, monkeypatch: pytest.MonkeyPatch, cycle: int, use_rox: bool, background: str) -> None:
    from app.processing.normalize import normalize_for_cycle
    _register(plate, "synthetic", make_ux_plate())
    seen = []
    original = plate.clustering._cluster_point_dicts
    def recording(points, *args):
        seen.extend(points)
        return original(points, *args)
    monkeypatch.setattr(plate.clustering, "_cluster_point_dicts", recording)
    body = plate.client.post("/api/data/synthetic/cluster", json={"cycle": cycle, "use_rox": use_rox, "background": background}).json()
    expected = {p.well: p for p in normalize_for_cycle(plate.upload.sessions["synthetic"], cycle, use_rox=use_rox, background=background)}
    assert seen
    for point in seen:
        assert point["plot_fam"] == expected[point["well"]].norm_fam
        assert point["plot_allele2"] == expected[point["well"]].norm_allele2
    context = body["analysis_context"]
    assert context["cycle"] == cycle
    assert context["normalization_applied"] is use_rox
    assert context["background"] == background


def test_mixed_region_algorithms_and_manual_window_are_actual(plate: SimpleNamespace) -> None:
    body = plate.client.post("/api/data/s1/cluster", json={"cycle": 1, "algorithm": "kmeans", "regions": [
        {"id": "manual", "name": "Manual", "wells": ["A1", "A2"], "ploidy": 6,
         "threshold_config": {"boundaries": [0.7, 0.3], "offset": 1}},
        {"id": "auto", "name": "Auto", "wells": ["B1", "B2"], "ploidy": 2},
    ]}).json()
    assert body["algorithm"] == "kmeans"
    context = body["analysis_context"]
    assert context["algorithm"] == "mixed"
    assert context["parameters"]["n_clusters_applied"] is False
    assert [r["algorithm"] for r in context["regions"]] == ["threshold", "auto"]
    assert context["regions"][0]["parameters"]["actual_window"]["boundaries"] == [0.7, 0.3]
    assert context["regions"][1]["parameters"]["threshold_config"]["ntc_threshold"] == 0.1
