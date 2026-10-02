"""No-amplification QC: algorithm, clustering integration and report output."""
import io
import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from pptx import Presentation

from app.auth import TokenData, get_current_user
from app.models import (
    AmplificationQcConfig, DataWindow, InstrumentDetail, UnifiedData, WellCycleData,
)
from app.processing.amplification_qc import compute_amplification_qc

M1_FAM = [f"A{i}" for i in range(1, 5)]
M1_ALLELE2 = [f"B{i}" for i in range(1, 5)]
FLAT = [f"C{i}" for i in range(1, 9)]
M1 = M1_FAM + M1_ALLELE2
NO_AMP = "No amplification"


def _plate(*, pre_read: bool = True, detail: InstrumentDetail | None = None) -> UnifiedData:
    """Cycle 1 = Pre-read (1000 everywhere), cycle 2 = the read. M1 wells amplify
    one channel by +2000 RFU; the C wells stay at the pre-read level."""
    readings = []
    for well in M1 + FLAT:
        readings.append(WellCycleData(well=well, cycle=1, fam=1000.0, allele2=1000.0, rox=1000.0))
        fam = 3000.0 if well in M1_FAM else 1000.0 + (20.0 if well in FLAT else 0.0)
        allele2 = 3000.0 if well in M1_ALLELE2 else 1000.0 + (10.0 if well in FLAT else 0.0)
        readings.append(WellCycleData(well=well, cycle=2, fam=fam, allele2=allele2, rox=1000.0))
    windows = [DataWindow(name="Amplification", start_cycle=2, end_cycle=2)]
    if pre_read:
        windows.insert(0, DataWindow(name="Pre-read", start_cycle=1, end_cycle=1))
    return UnifiedData(
        instrument="StepOnePlus", allele2_dye="VIC", wells=sorted(M1 + FLAT),
        cycles=[1, 2], data=readings, has_rox=True, data_windows=windows,
        instrument_detail=detail,
    )


def _run(unified: UnifiedData, **config):
    return compute_amplification_qc(unified, 2, unified.wells, AmplificationQcConfig(**config))


def test_auto_thresholds_flag_flat_wells():
    qc = _run(_plate())
    assert qc.enabled and qc.available and qc.source == "auto"
    assert (qc.baseline_cycle, qc.read_cycle) == (1, 2)
    assert qc.no_amplification_wells == sorted(FLAT)
    # dRn (dye/ROX) of an amplified well is 2.0; threshold = 2.0 / 3 of the p90.
    assert qc.fam_threshold == pytest.approx(2.0 / 3, rel=1e-3)
    assert qc.allele2_threshold == pytest.approx(2.0 / 3, rel=1e-3)


def test_no_pre_read_means_unavailable_and_nothing_excluded():
    qc = _run(_plate(pre_read=False))
    assert qc.available is False and qc.no_amplification_wells == []


def test_analysing_the_pre_read_itself_is_unavailable():
    unified = _plate()
    qc = compute_amplification_qc(unified, 1, unified.wells, AmplificationQcConfig())
    assert qc.available is False and qc.no_amplification_wells == []


def test_disabled_excludes_nothing():
    qc = _run(_plate(), enabled=False)
    assert qc.enabled is False and qc.source == "off" and qc.no_amplification_wells == []


def test_manual_threshold_replaces_that_channel_only():
    # FAM manual 5.0 (above every dRn) -> mixed; allele2 stays automatic.
    qc = _run(_plate(), fam_threshold=5.0)
    assert qc.source == "mixed" and qc.fam_threshold == 5.0
    assert qc.allele2_threshold == pytest.approx(2.0 / 3, rel=1e-3)
    # M1_FAM wells only rose in FAM, which the manual threshold now rejects.
    assert set(qc.no_amplification_wells) == set(FLAT) | set(M1_FAM)


def test_both_manual_is_manual_source():
    qc = _run(_plate(), fam_threshold=0.5, allele2_threshold=0.5)
    assert qc.source == "manual" and qc.no_amplification_wells == sorted(FLAT)


def test_fraction_moves_the_automatic_threshold():
    low = _run(_plate(), fraction=0.05)
    assert low.fam_threshold == pytest.approx(0.1, rel=1e-3)


def test_unflagged_candidates_only():
    unified = _plate()
    qc = compute_amplification_qc(unified, 2, ["C1", "A1"], AmplificationQcConfig())
    assert qc.no_amplification_wells == ["C1"]


def test_raw_rfu_when_normalization_is_off():
    qc = compute_amplification_qc(_plate(), 2, _plate().wells, AmplificationQcConfig(), use_rox=False)
    assert qc.fam_threshold == pytest.approx(2000.0 / 3, rel=1e-3)


# --- API integration ---------------------------------------------------------

@pytest.fixture
def api(tmp_path):
    env = patch.dict(os.environ, {
        "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-amp-qc-tests",
        "ADMIN_PASSWORD": "StrongerOperatorPassword123!",
        "SNP_AUTH_MODE": "local",
    }, clear=False)
    env.start()
    import app.db as db
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "amp.sqlite3"
    from app.main import app
    from app.routers import clustering, upload

    async def override():
        return TokenData(user_id="user-1", username="u", role="user")

    app.dependency_overrides[get_current_user] = override
    for store in (upload.sessions, clustering.welltype_store, clustering.cluster_store,
                  clustering.marker_store, clustering.group_store):
        store.clear()
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, upload=upload, db=db)
    app.dependency_overrides.pop(get_current_user, None)
    upload.sessions.clear()
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _register(api, unified, sid="amp-1") -> str:
    conn = api.db.get_db()
    conn.execute(
        "INSERT OR IGNORE INTO users (id, username, hashed_password, display_name, role) "
        "VALUES ('user-1', 'amp-user', 'x', 'amp-user', 'user')"
    )
    conn.commit()
    api.upload.sessions[sid] = unified
    api.db.save_session(sid, unified, filename="plate.eds", user_id="user-1")
    return sid


def _markers(api, sid) -> None:
    body = {"markers": [
        {"id": "m1", "name": "Assay1", "wells": M1, "ploidy": 2},
        {"id": "m2", "name": "Assay2", "wells": FLAT, "ploidy": 2},
    ]}
    assert api.client.post(f"/api/data/{sid}/markers", json=body).status_code == 200


def _cluster(api, sid, **extra):
    response = api.client.post(f"/api/data/{sid}/cluster", json={
        "algorithm": "auto", "cycle": 2, "cycle_mode": "absolute", "ploidy": 2, **extra})
    assert response.status_code == 200, response.text
    return response.json()


def test_single_marker_path_marks_flat_wells_undetermined(api):
    sid = _register(api, _plate())
    body = _cluster(api, sid)
    assert body["amplification_qc"]["no_amplification_wells"] == sorted(FLAT)
    assert body["analysis_context"]["amplification_qc"] == body["amplification_qc"]
    assert {body["assignments"][w] for w in FLAT} == {"Undetermined"}
    assert {body["assignments"][w] for w in M1_FAM} == {"Allele 1 Homo"}
    assert {body["assignments"][w] for w in M1_ALLELE2} == {"Allele 2 Homo"}


def test_marker_path_marks_flat_wells_and_counts_them(api):
    sid = _register(api, _plate())
    _markers(api, sid)
    body = _cluster(api, sid)
    regions = {r["id"]: r for r in body["regions"]}
    assert set(body["amplification_qc"]["no_amplification_wells"]) == set(FLAT)
    assert {regions["m2"]["assignments"][w] for w in FLAT} == {"Undetermined"}
    assert regions["m1"]["genotype_counts"]["AA"] == 4
    assert regions["m1"]["genotype_counts"]["BB"] == 4
    assert regions["m2"]["genotype_counts"]["excluded"] == 8


def test_disabled_qc_keeps_the_legacy_behaviour(api):
    sid = _register(api, _plate())
    body = _cluster(api, sid, amplification_qc={"enabled": False})
    assert body["amplification_qc"]["no_amplification_wells"] == []


def test_no_pre_read_run_has_unavailable_qc(api):
    sid = _register(api, _plate(pre_read=False))
    body = _cluster(api, sid)
    assert body["amplification_qc"]["available"] is False
    assert body["amplification_qc"]["no_amplification_wells"] == []


def test_ntc_wells_are_never_flagged(api):
    unified = _plate()
    unified.imported_well_types = {"C1": "NTC"}
    sid = _register(api, unified)
    body = _cluster(api, sid)
    assert "C1" not in body["amplification_qc"]["no_amplification_wells"]
    assert body["assignments"]["C1"] == "NTC"


# --- Output --------------------------------------------------------------------

def _export(api, sid, path, **params):
    response = api.client.get(f"/api/data/{sid}/export/{path}", params=params)
    assert response.status_code == 200, response.text
    return response


def test_csv_and_xlsx_name_the_no_amplification_wells(api):
    sid = _register(api, _plate())
    _markers(api, sid)
    _cluster(api, sid)
    workbook = load_workbook(io.BytesIO(_export(api, sid, "xlsx").content))
    results = list(workbook["Results"].iter_rows(values_only=True))
    header = list(results[0])
    genotype, call = header.index("Genotype"), header.index("Allele Call")
    flat_rows = [r for r in results[1:] if r[0] in FLAT]
    assert {r[genotype] for r in flat_rows} == {"Undetermined"}
    assert {r[call] for r in flat_rows} == {NO_AMP}
    amplified = [r for r in results[1:] if r[0] in M1_FAM]
    assert {r[call] for r in amplified} == {"Allele 1 Homo"}
    counts = {tuple(r[:3]) for r in workbook["Summary"].iter_rows(values_only=True)}
    assert ("m2", NO_AMP, 8) in counts


def test_pdf_and_pptx_carry_instrument_detail_and_no_amp_rows(api):
    detail = InstrumentDetail(vendor="Applied Biosystems", model="StepOnePlus",
                              software="StepOne Software v2.3")
    sid = _register(api, _plate(detail=detail))
    _markers(api, sid)
    _cluster(api, sid)
    deck = Presentation(io.BytesIO(_export(api, sid, "pptx").content))
    texts = []
    for slide in deck.slides:
        for shape in slide.shapes:
            if shape.has_text_frame:
                texts.append(shape.text_frame.text)
            if shape.has_table:
                texts.extend(c.text for r in shape.table.rows for c in r.cells)
    joined = "\n".join(texts)
    assert "Applied Biosystems StepOnePlus · StepOne Software v2.3" in joined
    assert NO_AMP in joined
    pdf = _export(api, sid, "pdf").content
    assert pdf.startswith(b"%PDF")


def test_instrument_label_falls_back_to_instrument_string():
    from app.reporting.snapshot_presentation import instrument_label
    snapshot = SimpleNamespace(unified=_plate())
    assert instrument_label(snapshot) == "StepOnePlus"
    detail = InstrumentDetail(vendor="Applied Biosystems", model="StepOnePlus")
    snapshot = SimpleNamespace(unified=_plate(detail=detail))
    assert instrument_label(snapshot) == "Applied Biosystems StepOnePlus"


def test_scatter_draws_no_amplification_as_small_grey_legend_entry():
    from app.reporting.charts import build_scatter_figure
    points = [
        {"well": "A1", "norm_fam": 3.0, "norm_allele2": 1.0, "effective_type": "Allele 1 Homo"},
        {"well": "C1", "norm_fam": 1.0, "norm_allele2": 1.0, "effective_type": "Undetermined",
         "no_amplification": True},
        {"well": "C2", "norm_fam": 1.0, "norm_allele2": 1.0, "effective_type": "Undetermined",
         "no_amplification": True},
        {"well": "D1", "norm_fam": 1.5, "norm_allele2": 1.5, "effective_type": "Undetermined"},
    ]
    fig = build_scatter_figure(points)
    try:
        ax = fig.axes[0]
        labels = [t.get_text() for t in ax.get_legend().get_texts()]
        assert "No amplification (n=2)" in labels
        assert "Undetermined (n=1)" in labels
        grey = next(c for c, t in zip(ax.collections, labels) if t == "No amplification (n=2)")
        normal = next(c for c, t in zip(ax.collections, labels) if t == "Undetermined (n=1)")
        assert grey.get_sizes()[0] < normal.get_sizes()[0]
    finally:
        import matplotlib.pyplot as plt
        plt.close(fig)


# --- Real customer file (only when QPRISM_STEPONE_EDS is set) ---------------------

_REAL = os.environ.get("QPRISM_STEPONE_EDS")


@pytest.mark.skipif(not _REAL or not os.path.isfile(_REAL or ""), reason="QPRISM_STEPONE_EDS not set")
def test_real_file_expectations():
    from pathlib import Path
    from app.parsers.detector import detect_and_parse

    unified = detect_and_parse(_REAL, Path(_REAL).name)
    qc = compute_amplification_qc(unified, 7, unified.wells, AmplificationQcConfig())
    assert qc.available
    flagged = set(qc.no_amplification_wells)
    markers = unified.imported_markers
    assay1 = set(markers["QPrism1"]) | set(markers["SNP Assay 1"])
    others = {w for name, wells in markers.items() if name not in ("QPrism1", "SNP Assay 1") for w in wells}
    assert flagged & assay1 == set()
    assert len(flagged & others) == 64 and flagged == others


@pytest.mark.skipif(not _REAL or not os.path.isfile(_REAL or ""), reason="QPRISM_STEPONE_EDS not set")
def test_real_file_cluster_keeps_qprism1_calls(api):
    conn = api.db.get_db()
    conn.execute(
        "INSERT OR IGNORE INTO users (id, username, hashed_password, display_name, role) "
        "VALUES ('user-1', 'amp-user', 'x', 'amp-user', 'user')")
    conn.commit()
    with open(_REAL, "rb") as handle:
        up = api.client.post("/api/upload", files={"file": ("real.eds", handle, "application/octet-stream")})
    assert up.status_code == 200, up.text
    sid = up.json()["session_id"]
    body = api.client.post(f"/api/data/{sid}/cluster", json={
        "cycle": 7, "cycle_mode": "absolute", "use_rox": True, "algorithm": "threshold"}).json()
    regions = {r["name"]: r for r in body["regions"]}
    flat = set(body["amplification_qc"]["no_amplification_wells"])
    assert len(flat) == 64
    assert flat.isdisjoint(regions["QPrism1"]["wells"]) and flat.isdisjoint(regions["SNP Assay 1"]["wells"])
    counts = regions["QPrism1"]["genotype_counts"]
    assert (counts["AA"], counts["BB"], counts["AB"]) == (8, 8, 0)
