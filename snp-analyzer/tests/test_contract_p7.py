"""P7 contract: amplification QC config/result, instrument detail, stub."""
import pytest
from pydantic import ValidationError

import app.db as db
from app.models import (
    AmplificationQcConfig, AmplificationQcResult, ClusteringRequest,
    ClusteringResult, InstrumentDetail, UnifiedData, UploadResponse, WellCycleData,
)
from app.processing.amplification_qc import compute_amplification_qc


@pytest.fixture
def fresh_db(tmp_path):
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "p7.sqlite3"
    db.init_db()
    yield db
    db._conn.close()
    db._conn = None


def _unified(**extra) -> UnifiedData:
    wells = ["A1", "A2"]
    return UnifiedData(
        instrument="StepOnePlus", allele2_dye="VIC", wells=wells, cycles=[0, 1],
        data=[WellCycleData(well=w, cycle=c, fam=1.0, allele2=1.0, rox=1.0)
              for w in wells for c in (0, 1)],
        **extra,
    )


def test_config_defaults():
    cfg = AmplificationQcConfig()
    assert cfg.enabled is True
    assert cfg.fraction == pytest.approx(1 / 3)
    assert cfg.fam_threshold is None and cfg.allele2_threshold is None


@pytest.mark.parametrize("kwargs", [
    {"fraction": 0.04}, {"fraction": 0.91}, {"fam_threshold": -1.0},
    {"allele2_threshold": -0.1},
])
def test_config_validation(kwargs):
    with pytest.raises(ValidationError):
        AmplificationQcConfig(**kwargs)


def test_config_bounds_accepted():
    AmplificationQcConfig(fraction=0.05, fam_threshold=0, allele2_threshold=2.5)
    AmplificationQcConfig(fraction=0.9)


def test_clustering_request_default_none():
    assert ClusteringRequest().amplification_qc is None
    req = ClusteringRequest(amplification_qc={"fraction": 0.5})
    assert req.amplification_qc.fraction == 0.5


def test_clustering_request_invalid_rejected():
    with pytest.raises(ValidationError):
        ClusteringRequest(amplification_qc={"fraction": 5})


def test_result_model_and_context_field():
    res = AmplificationQcResult(
        enabled=True, available=True, fraction=0.3, fam_threshold=1.0,
        allele2_threshold=None, source="mixed", baseline_cycle=0, read_cycle=1,
        no_amplification_wells=["A1"],
    )
    cr = ClusteringResult(algorithm="threshold", cycle=1, assignments={},
                          amplification_qc=res)
    assert cr.amplification_qc.no_amplification_wells == ["A1"]
    assert ClusteringResult(algorithm="t", cycle=1, assignments={}).amplification_qc is None
    with pytest.raises(ValidationError):
        AmplificationQcResult(
            enabled=True, available=True, fraction=0.3, fam_threshold=None,
            allele2_threshold=None, source="bogus", baseline_cycle=None,
            read_cycle=None, no_amplification_wells=[],
        )


def test_instrument_detail_defaults_and_upload_response():
    assert _unified().instrument_detail is None
    d = InstrumentDetail()
    assert d.vendor is None and d.model is None and d.software is None
    resp = UploadResponse(session_id="s", instrument="x", allele2_dye="VIC",
                          num_wells=1, num_cycles=1, has_rox=True)
    assert resp.instrument_detail is None


def test_instrument_detail_roundtrip(fresh_db):
    detail = InstrumentDetail(vendor="Applied Biosystems", model="StepOnePlus",
                              software="StepOne Software v2.3")
    unified = _unified(instrument_detail=detail)
    db.save_session("sid-p7", unified, "f.eds")
    entry = db.load_session("sid-p7")
    assert entry["unified"].instrument_detail == detail


def test_instrument_detail_absent_roundtrip(fresh_db):
    db.save_session("sid-p7b", _unified(), "f.eds")
    entry = db.load_session("sid-p7b")
    assert entry["unified"].instrument_detail is None


def test_stub_returns_unavailable():
    cfg = AmplificationQcConfig(enabled=False)
    out = compute_amplification_qc(_unified(), 1, ["A1"], cfg)
    assert out.available is False and out.enabled is False
    assert out.no_amplification_wells == []
    out2 = compute_amplification_qc(_unified(), 1, ["A1"], AmplificationQcConfig())
    assert out2.enabled is True and out2.available is False
