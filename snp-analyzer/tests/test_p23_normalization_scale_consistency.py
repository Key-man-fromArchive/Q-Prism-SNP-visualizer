"""P23: normalization reporting has to describe what actually happened, well
by well, and the same way everywhere it is reported.

``normalize()`` (app/processing/normalize.py) falls a single reading back to
raw when its passive reference is 0, negative, or missing -- a run can ask
for normalization and get it on most wells while a handful fall back to raw,
all in the SAME response. Before this file, ``/scatter``, ``/plate`` and
``/amplification/all`` reported one response-wide ``normalization_applied``
boolean derived from ``normalization_applies()`` (run-mode only, blind to
individual references), while ``/analyze`` derived its own, DIFFERENT verdict
(checking for at least one positive reference at the cycle). A plate whose
every well's ROX read 0 was reported "not normalized" by ``/analyze`` and
"normalized" by the other three -- four endpoints, two different answers to
the same question, over the same plate.

See docs/planning/feedback-2026-09-11/evidence/P22-CALL-LOGIC.md (finding 2)
for the prior reproduction this file re-verifies, and
docs/planning/feedback-2026-09-11/evidence/P23-NORM-SCALE.md for the fix.
"""

from __future__ import annotations

import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user
from app.models import UnifiedData, WellCycleData


@pytest.fixture
def data_client(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-p23-norm-scale",
            "ADMIN_PASSWORD": "StrongerOperatorPassword123!",
            "SNP_AUTH_MODE": "local",
        },
        clear=False,
    )
    env.start()

    import app.db as db

    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "test.sqlite3"

    from app.main import app
    from app.routers import upload, clustering

    async def current_user_override():
        return TokenData(user_id="user-1", username="user1", role="user")

    app.dependency_overrides[get_current_user] = current_user_override
    upload.sessions.clear()
    clustering.cluster_store.clear()
    clustering.welltype_store.clear()

    with TestClient(app) as client:
        yield SimpleNamespace(
            client=client, upload=upload, clustering=clustering, db=db
        )

    app.dependency_overrides.pop(get_current_user, None)
    upload.sessions.clear()
    clustering.cluster_store.clear()
    clustering.welltype_store.clear()
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _register(data_client, sid: str, unified: UnifiedData) -> None:
    """Register a session both in memory and in the DB -- ``/cluster``
    publishes provenance to the DB (see app/processing/analysis_state.py),
    which foreign-keys against a ``sessions`` row that a bare
    ``upload.sessions[sid] = ...`` assignment never creates."""
    data_client.upload.sessions[sid] = unified
    data_client.db.save_session(sid, unified, filename="test.eds", user_id=None)


def _mixed_rox_plate() -> UnifiedData:
    """Two wells, same raw magnitude, different passive-reference outcomes.

    A1's ROX (1000.0) is usable -- it divides. A2's ROX reads exactly 0 --
    ``normalize()`` falls it back to raw. Same request, same run, same
    cycle: one well's numbers are a ratio to its reference, the other's are
    still full-scale RFU.
    """
    data = []
    for well, rox in [("A1", 1000.0), ("A2", 0.0)]:
        for cycle in [1, 2]:
            data.append(
                WellCycleData(well=well, cycle=cycle, fam=900.0, allele2=100.0, rox=rox)
            )
    return UnifiedData(
        instrument="QuantStudio 3",
        allele2_dye="VIC",
        wells=["A1", "A2"],
        cycles=[1, 2],
        data=data,
        has_rox=True,
    )


def _all_zero_rox_plate() -> UnifiedData:
    """Every well's passive reference reads 0 -- normalization is requested
    and switched on for the run, but nothing on the plate can actually be
    divided by."""
    data = []
    for well in ["A1", "A2", "A3", "A4"]:
        for cycle in [1, 2]:
            data.append(
                WellCycleData(well=well, cycle=cycle, fam=900.0, allele2=100.0, rox=0.0)
            )
    return UnifiedData(
        instrument="QuantStudio 3",
        allele2_dye="VIC",
        wells=["A1", "A2", "A3", "A4"],
        cycles=[1, 2],
        data=data,
        has_rox=True,
    )


def _all_normal_rox_plate() -> UnifiedData:
    """Every well's passive reference is sane and positive -- the regression
    case: existing behavior (fully normalized, nothing mixed) must survive
    this change untouched."""
    data = []
    for well in ["A1", "A2", "A3", "A4"]:
        for cycle in [1, 2]:
            data.append(
                WellCycleData(
                    well=well, cycle=cycle, fam=900.0, allele2=100.0, rox=1000.0
                )
            )
    return UnifiedData(
        instrument="QuantStudio 3",
        allele2_dye="VIC",
        wells=["A1", "A2", "A3", "A4"],
        cycles=[1, 2],
        data=data,
        has_rox=True,
    )


# ---------------------------------------------------------------------------
# 1. Well-level reporting: one response, two scales, has to say so per well
# ---------------------------------------------------------------------------


def test_scatter_reports_normalization_per_well_not_just_per_response(data_client):
    data_client.upload.sessions["mixed"] = _mixed_rox_plate()

    response = data_client.client.get("/api/data/mixed/scatter?cycle=1&use_rox=true")

    assert response.status_code == 200, response.text
    payload = response.json()
    by_well = {p["well"]: p for p in payload["points"]}
    assert by_well["A1"]["normalized"] is True
    assert by_well["A1"]["norm_fam"] == pytest.approx(0.9)
    assert by_well["A2"]["normalized"] is False
    assert by_well["A2"]["norm_fam"] == pytest.approx(900.0)
    # Response-wide fields have to admit what they're mixing, not just paper
    # over it with one "applied" bit that is true for the plate but false
    # for A2's own numbers.
    assert payload["normalization_applied"] is True
    assert payload["normalization_mixed"] is True


def test_plate_reports_normalization_per_well(data_client):
    data_client.upload.sessions["mixed"] = _mixed_rox_plate()

    response = data_client.client.get("/api/data/mixed/plate?cycle=1&use_rox=true")

    assert response.status_code == 200, response.text
    payload = response.json()
    by_well = {w["well"]: w for w in payload["wells"]}
    assert by_well["A1"]["normalized"] is True
    assert by_well["A2"]["normalized"] is False
    assert payload["normalization_mixed"] is True


def test_amplification_all_reports_normalization_per_well_per_cycle(data_client):
    data_client.upload.sessions["mixed"] = _mixed_rox_plate()

    response = data_client.client.get("/api/data/mixed/amplification/all?use_rox=true")

    assert response.status_code == 200, response.text
    curves = {c["well"]: c for c in response.json()["curves"]}
    assert curves["A1"]["normalized"] == [True, True]
    assert curves["A2"]["normalized"] == [False, False]
    assert response.json()["normalization_mixed"] is True


# ---------------------------------------------------------------------------
# 2. Four endpoints, one definition
# ---------------------------------------------------------------------------


def test_all_zero_rox_reports_not_applied_consistently_across_endpoints(data_client):
    """The reproduced bug: every well's ROX reads 0, so nothing on the plate
    was actually divided -- ``/analyze`` already said so; the other three
    said the opposite. All four must agree now."""
    _register(data_client, "s1", _all_zero_rox_plate())

    scatter = data_client.client.get("/api/data/s1/scatter?cycle=1&use_rox=true").json()
    plate = data_client.client.get("/api/data/s1/plate?cycle=1&use_rox=true").json()
    amp_all = data_client.client.get(
        "/api/data/s1/amplification/all?use_rox=true"
    ).json()
    cluster = data_client.client.post(
        "/api/data/s1/cluster", json={"cycle": 1, "use_rox": True}
    ).json()

    assert scatter["normalization_applied"] is False
    assert plate["normalization_applied"] is False
    assert amp_all["normalization_applied"] is False
    assert cluster["analysis_context"]["normalization_applied"] is False

    # Uniformly raw is not "mixed" -- every well made the same (raw) choice.
    assert scatter["normalization_mixed"] is False
    assert plate["normalization_mixed"] is False
    assert amp_all["normalization_mixed"] is False
    assert cluster["analysis_context"]["normalization_mixed"] is False

    # And every point/well/curve on the plate agrees with the response-level
    # verdict -- nothing partially divided when the plate has nothing sane
    # to divide by.
    assert all(p["normalized"] is False for p in scatter["points"])
    assert all(w["normalized"] is False for w in plate["wells"])
    assert all(all(v is False for v in c["normalized"]) for c in amp_all["curves"])


def test_mixed_rox_cluster_context_reports_the_same_mixed_verdict(data_client):
    _register(data_client, "mixed", _mixed_rox_plate())

    scatter = data_client.client.get(
        "/api/data/mixed/scatter?cycle=1&use_rox=true"
    ).json()
    cluster = data_client.client.post(
        "/api/data/mixed/cluster", json={"cycle": 1, "use_rox": True}
    ).json()

    assert (
        cluster["analysis_context"]["normalization_applied"]
        == scatter["normalization_applied"]
    )
    assert (
        cluster["analysis_context"]["normalization_mixed"]
        == scatter["normalization_mixed"]
    )
    assert cluster["analysis_context"]["normalization_applied"] is True
    assert cluster["analysis_context"]["normalization_mixed"] is True


# ---------------------------------------------------------------------------
# 3. ratio_origin.py:107 -- ROX==0 must not be silently dropped
# ---------------------------------------------------------------------------


def test_zero_rox_well_is_not_silently_excluded_from_reference_outliers():
    """``rox_outlier_wells`` used to filter on ``if p.raw_rox`` -- truthiness,
    not presence -- so a well whose reference read exactly 0 was dropped from
    the comparison entirely: not counted toward the plate median, and never
    reported as an outlier, however abnormal its 0 reading is relative to
    every other well's ~1000."""
    from app.processing.normalize import normalize_for_cycle
    from app.processing.ratio_origin import rox_outlier_wells

    data = []
    for i in range(9):
        data.append(
            WellCycleData(
                well=f"A{i + 1}", cycle=1, fam=900.0, allele2=100.0, rox=1000.0
            )
        )
    # The 10th well's reference reads exactly 0 -- a real value, and a wildly
    # abnormal one next to nine wells reading ~1000.
    data.append(WellCycleData(well="A10", cycle=1, fam=900.0, allele2=100.0, rox=0.0))
    unified = UnifiedData(
        instrument="QuantStudio 3",
        allele2_dye="VIC",
        wells=[d.well for d in data],
        cycles=[1],
        data=data,
        has_rox=True,
    )

    points = normalize_for_cycle(unified, 1, use_rox=True)

    assert rox_outlier_wells(points) == {"A10"}


def test_zero_rox_wells_count_toward_the_plate_reference_median():
    """Including the 0 readings in the candidate list changes what "the plate
    median" even is -- which is exactly why they must not be silently dropped
    from consideration (the old ``if p.raw_rox`` bug excluded them from this
    calculation entirely, so this split would previously have measured its
    median over the five 1000-reading wells ALONE, called that "the plate",
    and flagged nothing).

    An even 5/5 split at 1000 vs 0 puts the true median at 500, so BOTH
    groups now read as roughly 2x/0x that median -- outside the sane range on
    both sides. Correctly counting the zero readings here means the whole
    plate is honestly reported as having no trustworthy reference, not that
    the nine-tenths majority quietly wins and hides the other half.
    """
    from app.processing.ratio_origin import rox_outlier_wells
    from app.models import NormalizedPoint

    points = [
        NormalizedPoint(
            well=f"A{i}",
            cycle=1,
            norm_fam=1.0,
            norm_allele2=1.0,
            raw_fam=900.0,
            raw_allele2=100.0,
            raw_rox=1000.0 if i < 5 else 0.0,
        )
        for i in range(10)
    ]
    assert rox_outlier_wells(points) == {f"A{i}" for i in range(10)}


# ---------------------------------------------------------------------------
# 4. Regression: an all-normal-ROX plate keeps its existing behavior
# ---------------------------------------------------------------------------


def test_all_normal_rox_plate_is_fully_normalized_and_never_mixed(data_client):
    _register(data_client, "s1", _all_normal_rox_plate())

    scatter = data_client.client.get("/api/data/s1/scatter?cycle=1&use_rox=true").json()
    plate = data_client.client.get("/api/data/s1/plate?cycle=1&use_rox=true").json()
    amp_all = data_client.client.get(
        "/api/data/s1/amplification/all?use_rox=true"
    ).json()
    cluster = data_client.client.post(
        "/api/data/s1/cluster", json={"cycle": 1, "use_rox": True}
    ).json()

    for payload in (scatter, plate, amp_all):
        assert payload["normalization_applied"] is True
        assert payload["normalization_mixed"] is False
    assert cluster["analysis_context"]["normalization_applied"] is True
    assert cluster["analysis_context"]["normalization_mixed"] is False

    assert all(p["normalized"] is True for p in scatter["points"])
    assert all(w["normalized"] is True for w in plate["wells"])
    assert all(all(v is True for v in c["normalized"]) for c in amp_all["curves"])
