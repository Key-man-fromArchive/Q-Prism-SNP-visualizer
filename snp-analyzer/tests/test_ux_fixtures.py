"""Verify fixture evidence, not yet-unimplemented UX API behavior."""
from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from app.models import ClusteringResult
from app.processing.background import BackgroundModeError, available_background_modes
from app.processing.normalize import normalization_applies, normalize_for_cycle
from fixtures_ux_followup import NtcScenario, make_ux_endpoint, make_ux_markers, make_ux_plate

FIXTURES = Path(__file__).parent / "fixtures" / "ux_followup"
MANIFEST = json.loads((FIXTURES / "manifest.json").read_text())


@pytest.mark.parametrize("size,last", [(96, "H12"), (384, "P24")])
def test_plate_shape_provenance_and_determinism(size: int, last: str) -> None:
    first, second = make_ux_plate(size), make_ux_plate(size)
    assert first.model_dump_json() == second.model_dump_json()
    assert len(first.wells) == len(set(first.wells)) == size
    assert first.wells[0] == "A1" and first.wells[-1] == last
    assert len(first.data) == size * 42
    assert len({(row.well, row.cycle) for row in first.data}) == size * 42
    assert all(row.well in first.wells and row.cycle in first.cycles for row in first.data)
    assert all(name.startswith("SYNTHETIC_") for name in (first.sample_names or {}).values())
    first.data[0].fam = -999
    assert second.data[0].fam == 10


@pytest.mark.parametrize("size", [96, 384])
def test_windows_and_heterogeneous_markers(size: int) -> None:
    data = make_ux_plate(size)
    assert [(window.name, window.start_cycle, window.end_cycle) for window in data.data_windows or []] == [
        ("Pre-read", 0, 0), ("Amplification", 1, 40), ("Post-read", 41, 41),
    ]
    markers = make_ux_markers(data)
    assert [marker.ploidy for marker in markers] == [2, 6]
    assert not set(markers[0].wells) & set(markers[1].wells)
    assigned = set(markers[0].wells + markers[1].wells)
    assert set(data.wells) - assigned == set(data.wells[-4:])
    markers[0].wells.clear()
    assert len(make_ux_markers(data)[0].wells) == size // 2


@pytest.mark.parametrize("case", MANIFEST["numeric_expectations"], ids=lambda case: case["id"])
def test_literal_numeric_oracles(case: dict) -> None:
    data = make_ux_plate()
    before = data.model_dump_json()
    point = normalize_for_cycle(data, case["cycle"], use_rox=case["use_rox"], background=case["background"])[0]
    assert point.well == "A1"
    assert point.norm_fam == pytest.approx(case["fam"])
    assert point.norm_allele2 == pytest.approx(case["allele2"])
    assert point.raw_rox == 10
    assert data.model_dump_json() == before


@pytest.mark.parametrize("cycle,expected", [(20, (90, 60)), (40, (170, 100))])
def test_missing_reference_remains_raw(cycle: int, expected: tuple[int, int]) -> None:
    data = make_ux_plate(has_rox=False)
    point = normalize_for_cycle(data, cycle, use_rox=True)[0]
    assert normalization_applies(data, use_rox=True) is False
    assert (point.norm_fam, point.norm_allele2) == expected
    assert all(reading.rox is None for reading in data.data)


@pytest.mark.parametrize("use_rox,expected", [(False, (168, 98)), (True, (16.8, 9.8))])
def test_endpoint_channel_min_oracle(use_rox: bool, expected: tuple[float, float]) -> None:
    endpoint = make_ux_endpoint()
    assert available_background_modes(endpoint) == ["none", "channel_min"]
    point = normalize_for_cycle(endpoint, 40, use_rox=use_rox, background="channel_min")[0]
    assert (point.norm_fam, point.norm_allele2) == pytest.approx(expected)
    assert available_background_modes(make_ux_plate()) == ["none", "pre_read"]
    with pytest.raises(BackgroundModeError):
        normalize_for_cycle(make_ux_plate(), 40, background="channel_min")


@pytest.mark.parametrize("scenario", ["ok", "warning", "no_ntc", "missing_read", "zero_reference"])
def test_ntc_scenarios_have_explicit_evidence(scenario: NtcScenario) -> None:
    data = make_ux_plate(ntc=scenario)
    assert data.model_dump_json() == make_ux_plate(ntc=scenario).model_dump_json()
    case = next(case for case in MANIFEST["ntc_expectations"] if case["id"] == scenario)
    assert set(case["flagged"]) == set(data.ntc_wells or [])
    points = {point.well: point for point in normalize_for_cycle(data, 40, use_rox=False)}
    if scenario == "no_ntc":
        assert data.imported_well_types == {}
    elif scenario == "missing_read":
        assert "H11" in points and "H12" not in points
        assert len(data.data) == 96 * 42 - 1
    elif scenario == "zero_reference":
        assert all(point.norm_fam + point.norm_allele2 == 0 for point in points.values())
    else:
        assert (points["H11"].norm_fam, points["H11"].norm_allele2) == (2, 2)
        expected = (170, 100) if scenario == "warning" else (2, 2)
        assert (points["H12"].norm_fam, points["H12"].norm_allele2) == expected
    assert case["status"] in {"ok", "warning", "no_ntc", "insufficient"}


def test_legacy_payload_is_context_free_and_loadable() -> None:
    payload = json.loads((FIXTURES / "legacy_result.json").read_text())
    assert "analysis_context" not in payload
    result = ClusteringResult.model_validate(payload)
    assert result.cycle == 40
    assert result.assignments["H12"] == "NTC"
    assert result.confidences and result.confidences["A1"] == 0.95


def test_failure_schedules_are_named_and_ordered() -> None:
    cases = MANIFEST["failure_scenarios"]
    assert len({case["id"] for case in cases}) == len(cases) == 12
    assert all(len(case["events"]) >= 2 and case["expected"] for case in cases)
    late = next(case for case in cases if case["id"] == "late_analysis")
    assert late["events"] == ["start_A_cycle20", "start_B_cycle40", "complete_B", "complete_A"]
    assert "synthetic" in MANIFEST["provenance"]
    assert sum(path.stat().st_size for path in FIXTURES.iterdir() if path.is_file()) < 20_000


def test_unsupported_plate_size_is_rejected() -> None:
    with pytest.raises(ValueError, match="96 or 384"):
        make_ux_plate(192)


def test_unsupported_ntc_scenario_is_rejected() -> None:
    with pytest.raises(ValueError, match="Unknown NTC scenario"):
        make_ux_plate(ntc=cast(NtcScenario, "unsupported"))
