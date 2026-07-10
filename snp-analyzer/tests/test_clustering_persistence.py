"""A1 regression: full ClusteringResult must survive a DB save/load round-trip.

Before the fix, save_clustering persisted only labels/method/cycle/confidences,
so ploidy, boundaries, offset, offset_uncertain and low_separation were dropped
and a hexaploid result silently reverted to diploid defaults on reload.
"""
import os

import pytest


@pytest.fixture
def fresh_db(tmp_path):
    import app.db as db

    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "roundtrip.sqlite3"
    db.init_db()
    yield db
    if db._conn is not None:
        db._conn.close()
    db._conn = None


def _minimal_unified():
    from app.models import UnifiedData, WellCycleData

    wells = ["A1", "A2", "B1"]
    data = [
        WellCycleData(well=w, cycle=1, fam=1000.0, allele2=500.0, rox=800.0)
        for w in wells
    ]
    return UnifiedData(
        instrument="CFX Opus",
        allele2_dye="HEX",
        wells=wells,
        cycles=[1],
        data=data,
        has_rox=True,
        ploidy=6,
    )


def test_clustering_result_survives_roundtrip(fresh_db):
    db = fresh_db
    from app.models import ClusteringResult

    sid = "sess-a1"
    db.save_session(sid, _minimal_unified(), filename="x.pcrd", user_id=None)

    result = ClusteringResult(
        algorithm="auto",
        cycle=1,
        assignments={"A1": "AAAAAB", "A2": "AAABBB", "B1": "NTC"},
        confidences={"A1": 0.97, "A2": 0.91},
        ploidy=6,
        boundaries=[0.72, 0.55, 0.38],
        offset=1,
        offset_uncertain=True,
        low_separation=True,
    )
    db.save_clustering(sid, result)

    loaded = {s["session_id"]: s for s in db.load_all_sessions()}
    assert sid in loaded
    cr = loaded[sid]["clustering"]
    assert cr is not None

    # The fields that A1 used to drop:
    assert cr.ploidy == 6
    assert cr.boundaries == [0.72, 0.55, 0.38]
    assert cr.offset == 1
    assert cr.offset_uncertain is True
    assert cr.low_separation is True
    # And the ones that already round-tripped:
    assert cr.assignments == result.assignments
    assert cr.confidences == result.confidences
    assert cr.cycle == 1
    assert cr.algorithm == "auto"
