"""An empty well is not a sample, and it is not this assay's background.

A well the plate setup declares EMPTY holds no reaction mix. Two consequences,
both of which the clustering endpoint has to honor:

  1. There is no genotype in it, so it must stay out of the mixture fit --
     the same reason a well marked Omit does.
  2. Its optical read is LOWER than a well that does contain mix, so it is not
     evidence about where this assay's no-signal floor sits. On a plate whose
     unused wells outnumber its samples (the built-in 96-well demo plates use
     36-64 wells and leave the rest empty) an origin estimated from all wells
     lands on the empty ones, and every ratio measured from it is wrong. With
     the demo 2x plate that collapsed all three genotype classes into a single
     "Heterozygous" blob.

Point 2 is why empty wells are excluded from the ratio origin as well as from
the fit, and it is the one difference from Omit: omitting a well is a statement
about that READING, not about where background is, so an omitted well still
informs the origin.
"""
import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user
from app.models import DataWindow, UnifiedData, WellCycleData, WellType


def _plate_with_unused_wells() -> UnifiedData:
    """12 samples in three clean genotype classes, 4 declared NTC wells, and 60
    declared-empty wells reading well BELOW the NTC wells -- the shape of every
    partially-filled plate."""
    readings: list[WellCycleData] = []
    well_types: dict[str, str] = {}
    wells: list[str] = []

    def add(well: str, fam: float, allele2: float) -> None:
        readings.append(WellCycleData(well=well, cycle=1, fam=fam, allele2=allele2, rox=None))
        wells.append(well)

    # Samples: FAM-homozygous, heterozygous, HEX-homozygous. The assay's own
    # optical floor is 100/100 -- what a well WITH reaction mix reads.
    for i in range(4):
        add(f"A{i + 1}", 1100.0, 100.0)
    for i in range(4):
        add(f"B{i + 1}", 600.0, 600.0)
    for i in range(4):
        add(f"C{i + 1}", 100.0, 1100.0)

    # NTC: reaction mix, no template -- so it sits at the assay floor.
    for i in range(4):
        well = f"D{i + 1}"
        add(well, 100.0, 100.0)
        well_types[well] = WellType.NTC.value

    # Empty: no mix at all, so it reads below the assay floor.
    for row in "EFGH":
        for col in range(1, 13):
            well = f"{row}{col}"
            add(well, 5.0, 5.0)
            well_types[well] = WellType.EMPTY.value
    for col in range(5, 13):
        for row in "ABCD":
            well = f"{row}{col}"
            add(well, 5.0, 5.0)
            well_types[well] = WellType.EMPTY.value

    return UnifiedData(
        instrument="CFX Opus (raw)", allele2_dye="HEX", wells=sorted(set(wells)),
        cycles=[1], data=readings, has_rox=False, background_mode="none",
        imported_well_types=well_types,
        ntc_wells=[f"D{i + 1}" for i in range(4)],
        data_windows=[DataWindow(name="Amplification", start_cycle=1, end_cycle=1)],
    )


@pytest.fixture
def client(tmp_path):
    env = patch.dict(os.environ, {
        "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-empty-well-tests",
        "ADMIN_PASSWORD": "StrongerOperatorPassword123!",
        "SNP_AUTH_MODE": "local",
    }, clear=False)
    env.start()
    import app.db as db
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "t.sqlite3"
    from app.main import app
    from app.routers import upload, clustering

    async def override():
        return TokenData(user_id="u", username="u", role="user")

    app.dependency_overrides[get_current_user] = override
    upload.sessions.clear()
    clustering.welltype_store.clear()
    clustering.cluster_store.clear()
    with TestClient(app) as c:
        yield SimpleNamespace(client=c, upload=upload, db=db)
    app.dependency_overrides.pop(get_current_user, None)
    upload.sessions.clear()
    clustering.welltype_store.clear()
    clustering.cluster_store.clear()
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _register(client, sid, unified):
    client.upload.sessions[sid] = unified
    client.db.save_session(sid, unified, filename="t.pcrd", user_id=None)


def _cluster(client, sid):
    response = client.client.post(
        f"/api/data/{sid}/cluster",
        json={"algorithm": "auto", "cycle": 1, "ploidy": 2, "background": "none"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_the_genotype_classes_survive_a_mostly_empty_plate(client):
    _register(client, "partial", _plate_with_unused_wells())
    assignments = _cluster(client, "partial")["assignments"]

    called = {assignments[f"A{i + 1}"] for i in range(4)}
    assert called == {"Allele 1 Homo"}
    assert {assignments[f"B{i + 1}"] for i in range(4)} == {"Heterozygous"}
    assert {assignments[f"C{i + 1}"] for i in range(4)} == {"Allele 2 Homo"}


def test_empty_wells_are_not_genotyped_at_all(client):
    _register(client, "partial", _plate_with_unused_wells())
    assignments = _cluster(client, "partial")["assignments"]

    # Excluded from the input, so they come back with no call of any kind --
    # not "Undetermined", and certainly not swept into a dosage class.
    assert "E1" not in assignments
    assert "H12" not in assignments


def test_the_declared_ntc_wells_still_set_the_origin_and_keep_their_label(client):
    _register(client, "partial", _plate_with_unused_wells())
    result = _cluster(client, "partial")
    assert {result["assignments"][f"D{i + 1}"] for i in range(4)} == {"NTC"}

    scatter = client.client.get("/api/data/partial/scatter?cycle=1&use_rox=false")
    assert scatter.status_code == 200, scatter.text
    origin = scatter.json()["ratio_origin"]
    # The NTC wells sit at the assay floor (100/100), NOT at the empty wells'
    # level (5/5). Estimating from all 96 wells would put the origin at 5/5.
    assert origin["source"] == "ntc"
    assert origin["fam"] == pytest.approx(100.0)
    assert origin["allele2"] == pytest.approx(100.0)


def test_an_omitted_well_still_informs_the_origin(client):
    """The one place Omit and Empty differ: omitting a well says its READING is
    bad, not that background lives somewhere else."""
    plate = _plate_with_unused_wells()
    # Drop the declared NTCs so the origin has to be estimated, and mark the
    # FAM-homozygous replicates Omit.
    plate = plate.model_copy(update={
        "ntc_wells": None,
        "imported_well_types": {
            well: wtype
            for well, wtype in (plate.imported_well_types or {}).items()
            if wtype != WellType.NTC.value
        },
    })
    _register(client, "omit", plate)
    client.client.post(
        "/api/data/omit/welltypes",
        json={"wells": [f"A{i + 1}" for i in range(4)], "well_type": "Omit"},
    )

    result = _cluster(client, "omit")
    assert "A1" not in result["assignments"]        # excluded from the fit
    scatter = client.client.get("/api/data/omit/scatter?cycle=1&use_rox=false")
    origin = scatter.json()["ratio_origin"]
    # Estimated from the wells that hold mix (the four ex-NTC wells at 100/100
    # are still there, just no longer declared), never from the empty ones.
    assert origin["source"] in {"plate_floor", "plate_min"}
    assert origin["fam"] >= 100.0
