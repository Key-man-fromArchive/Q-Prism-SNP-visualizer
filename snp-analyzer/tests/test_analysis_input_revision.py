"""HTTP mutation boundaries: persisted revisions and retained stale results."""

from types import SimpleNamespace

import pytest

from test_marker_contract import data_client as _data_client, _register, _plate_unified

data_client = _data_client


@pytest.fixture
def plate(data_client: SimpleNamespace) -> SimpleNamespace:
    _register(data_client, "s1", _plate_unified())
    return data_client


def revision(plate: SimpleNamespace) -> int:
    return (
        plate.db.get_db()
        .execute("SELECT input_revision FROM sessions WHERE session_id='s1'")
        .fetchone()[0]
    )


def test_override_noop_conflict_and_fallback(plate: SimpleNamespace) -> None:
    plate.upload.sessions["s1"].imported_well_types = {"A1": "NTC"}
    url = "/api/data/s1/welltypes"
    result = plate.client.post(
        url, json={"wells": ["A1"], "well_type": "Omit", "expected_input_revision": 0}
    )
    assert result.json()["input_revision"] == revision(plate) == 1
    assert (
        plate.client.post(url, json={"wells": ["A1"], "well_type": "Omit"}).json()[
            "input_revision"
        ]
        == 1
    )
    stale = plate.client.delete(url, params={"expected_input_revision": 0})
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "INPUT_REVISION_CONFLICT"
    assert (
        plate.client.delete(url, params={"expected_input_revision": 1}).json()[
            "input_revision"
        ]
        == 2
    )
    assert plate.client.get(url).json()["assignments"] == {"A1": "NTC"}
    assert plate.client.delete(url).json()["input_revision"] == 2


def test_marker_edit_retains_previous_result_and_noop(plate: SimpleNamespace) -> None:
    assert (
        plate.client.post("/api/data/s1/cluster", json={"cycle": 1}).status_code == 200
    )
    previous = plate.clustering.cluster_store["s1"].model_dump()
    marker = {"id": "m1", "name": "Synthetic", "wells": ["A1"], "ploidy": 2}
    url = "/api/data/s1/markers"
    assert (
        plate.client.post(url, json={"markers": [marker]}).json()["input_revision"] == 1
    )
    assert plate.clustering.cluster_store["s1"].model_dump() == previous
    assert (
        plate.client.post(url, json={"markers": [marker]}).json()["input_revision"] == 1
    )
    assert (
        plate.client.put(
            url + "/m1", json={"ploidy": 4, "expected_input_revision": 1}
        ).json()["input_revision"]
        == 2
    )
    assert plate.client.delete(url).json()["input_revision"] == 3
    assert plate.client.delete(url).json()["input_revision"] == 3


def test_bulk_and_ploidy_increment_once(plate: SimpleNamespace) -> None:
    response = plate.client.put(
        "/api/data/s1/welltypes/bulk", json={"assignments": {"A1": "NTC", "A2": "Omit"}}
    )
    assert response.json()["input_revision"] == revision(plate) == 1
    for expected in (2, 2):
        assert (
            plate.client.post("/api/data/s1/ploidy", json={"ploidy": 4}).json()[
                "input_revision"
            ]
            == expected
        )
    assert (
        plate.client.post(
            "/api/data/s1/cluster", json={"cycle": 1, "ploidy": 6}
        ).status_code
        == 200
    )
    assert revision(plate) == 3
    assert plate.client.get("/api/sessions/s1").json()["input_revision"] == 3


def test_layout_and_catalog_are_composite_and_noop(plate: SimpleNamespace) -> None:
    conn = plate.db.get_db()
    conn.execute(
        "INSERT INTO users(id,username,hashed_password) VALUES ('user-1','synthetic','unusable')"
    )
    conn.commit()
    marker = {"id": "m1", "name": "Synthetic", "wells": ["A1"], "ploidy": 2}
    plate.db.save_layout(
        "layout",
        "user-1",
        "Synthetic",
        {"markers": [marker], "well_types": {"A2": "NTC"}},
    )
    for expected in (1, 1):
        response = plate.client.post("/api/layouts/layout/apply", json={"sid": "s1"})
        assert response.json()["input_revision"] == revision(plate) == expected
    plate.db.save_marker_catalog_entry(
        "catalog", "user-1", {"name": "Synthetic", "default_ploidy": 4}
    )
    for expected in (2, 2):
        response = plate.client.post(
            "/api/data/s1/markers/m1/attach-catalog", json={"catalog_id": "catalog"}
        )
        assert response.json()["input_revision"] == revision(plate) == expected


def test_bulk_failure_preserves_db_memory_revision(plate: SimpleNamespace) -> None:
    import sqlite3

    plate.client.post(
        "/api/data/s1/welltypes", json={"wells": ["A1"], "well_type": "NTC"}
    )
    conn = plate.db.get_db()
    conn.execute(
        "CREATE TRIGGER reject_second BEFORE INSERT ON manual_welltypes WHEN NEW.well='A2' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END"
    )
    conn.commit()
    with pytest.raises(sqlite3.IntegrityError, match="synthetic failure"):
        plate.client.put(
            "/api/data/s1/welltypes/bulk",
            json={"assignments": {"A1": "Omit", "A2": "NTC"}},
        )
    assert revision(plate) == 1
    assert plate.clustering.welltype_store["s1"] == {"A1": "NTC"}
    assert dict(conn.execute("SELECT well,welltype FROM manual_welltypes")) == {
        "A1": "NTC"
    }
    assert not conn.in_transaction


def test_invalid_inputs_and_metadata_do_not_increment(plate: SimpleNamespace) -> None:
    assert (
        plate.client.put(
            "/api/data/s1/welltypes/bulk", json={"assignments": {"A1": "bad"}}
        ).status_code
        == 400
    )
    assert (
        plate.client.post(
            "/api/data/s1/welltypes", json={"wells": ["Z99"], "well_type": "NTC"}
        ).status_code
        == 400
    )
    assert (
        plate.client.put(
            "/api/data/s1/samples", json={"samples": {"A1": "Synthetic"}}
        ).status_code
        == 200
    )
    assert revision(plate) == 0


def test_session_delete_db_first_and_marker_cleanup(plate: SimpleNamespace) -> None:
    import sqlite3

    plate.client.post(
        "/api/data/s1/markers",
        json={"markers": [{"id": "m1", "name": "Synthetic", "wells": ["A1"]}]},
    )
    conn = plate.db.get_db()
    conn.execute(
        "CREATE TRIGGER refuse_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'synthetic delete failure'); END"
    )
    conn.commit()
    with pytest.raises(sqlite3.IntegrityError):
        plate.client.delete("/api/sessions/s1")
    assert "s1" in plate.upload.sessions
    assert "s1" in plate.clustering.marker_store
    conn.execute("DROP TRIGGER refuse_delete")
    conn.commit()
    assert plate.client.delete("/api/sessions/s1").status_code == 200
    assert "s1" not in plate.clustering.marker_store


def test_empty_mutations_and_metadata_marker_edits(plate: SimpleNamespace) -> None:
    assert (
        plate.client.post(
            "/api/data/s1/welltypes", json={"wells": [], "well_type": "NTC"}
        ).json()["input_revision"]
        == 0
    )
    assert (
        plate.client.post("/api/data/s1/markers", json={"markers": []}).json()[
            "input_revision"
        ]
        == 0
    )
    assert (
        plate.client.put(
            "/api/data/s1/welltypes/bulk", json={"assignments": {}}
        ).json()["input_revision"]
        == 0
    )
    marker = {"id": "m1", "name": "Synthetic", "wells": ["A1"]}
    plate.client.post("/api/data/s1/markers", json={"markers": [marker]})
    response = plate.client.put(
        "/api/data/s1/markers/m1", json={"name": "Renamed", "color": "blue"}
    )
    assert response.json()["input_revision"] == 1
    assert plate.db.load_marker_regions("s1")[0]["name"] == "Renamed"
    assert (
        plate.client.post(
            "/api/data/s1/cluster", json={"cycle": 1, "expected_input_revision": 0}
        ).status_code
        == 409
    )


def test_composite_layout_failure_rolls_back_all_inputs(plate: SimpleNamespace) -> None:
    import sqlite3

    conn = plate.db.get_db()
    conn.execute(
        "INSERT INTO users(id,username,hashed_password) VALUES ('user-1','synthetic','unusable')"
    )
    conn.commit()
    marker = {"id": "m1", "name": "Synthetic", "wells": ["A1"], "ploidy": 4}
    plate.db.save_layout(
        "layout",
        "user-1",
        "Synthetic",
        {"markers": [marker], "well_types": {"A2": "NTC"}},
    )
    conn.execute(
        "CREATE TRIGGER refuse_type BEFORE INSERT ON manual_welltypes BEGIN SELECT RAISE(ABORT,'synthetic type failure'); END"
    )
    conn.commit()
    with pytest.raises(sqlite3.IntegrityError):
        plate.client.post("/api/layouts/layout/apply", json={"sid": "s1"})
    assert revision(plate) == 0
    assert plate.db.load_marker_regions("s1") == []
    assert plate.clustering.marker_store.get("s1", []) == []
    assert not conn.in_transaction


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("post", "welltypes", {"wells": ["A1"], "well_type": "NTC"}),
        ("put", "welltypes/bulk", {"assignments": {"A1": "NTC"}}),
        ("post", "ploidy", {"ploidy": 4}),
        ("post", "markers", {"markers": []}),
        ("post", "cluster", {"cycle": 1}),
    ],
)
def test_stale_revision_does_not_mutate(
    plate: SimpleNamespace, method: str, path: str, body: dict[str, object]
) -> None:
    response = getattr(plate.client, method)(
        "/api/data/s1/" + path, json={**body, "expected_input_revision": 99}
    )
    assert response.status_code == 409
    assert response.json()["detail"]["current_input_revision"] == 0
    assert revision(plate) == 0


def test_authorization_precedes_revision_disclosure(plate: SimpleNamespace) -> None:
    conn = plate.db.get_db()
    conn.execute(
        "INSERT INTO users(id,username,hashed_password) VALUES ('other','other','unusable')"
    )
    conn.execute("UPDATE sessions SET user_id='other' WHERE session_id='s1'")
    conn.commit()
    response = plate.client.post(
        "/api/data/s1/ploidy", json={"ploidy": 4, "expected_input_revision": 99}
    )
    assert response.status_code == 403
    assert "current_input_revision" not in response.text
    assert revision(plate) == 0


def test_missing_persisted_catalog_row_is_internal_error() -> None:
    from app.routers.marker_catalog import _row_to_entry

    with pytest.raises(RuntimeError, match="Persisted catalog entry unavailable"):
        _row_to_entry(None)


@pytest.mark.parametrize("expected", [0, 99])
@pytest.mark.parametrize(
    "invalid",
    [
        {"ploidy": 1},
        {"regions": [{"id": "m", "name": "Synthetic", "wells": ["A1"], "ploidy": 1}]},
    ],
)
def test_cluster_domain_validation_precedes_conflict(
    plate: SimpleNamespace, expected: int, invalid: dict[str, object]
) -> None:
    response = plate.client.post(
        "/api/data/s1/cluster",
        json={"cycle": 1, "expected_input_revision": expected, **invalid},
    )
    assert response.status_code == 400
    assert revision(plate) == 0


def test_marker_well_order_is_an_analysis_input(plate: SimpleNamespace) -> None:
    marker = {"id": "m1", "name": "Synthetic", "wells": ["A1", "A2"]}
    assert (
        plate.client.post("/api/data/s1/markers", json={"markers": [marker]}).json()[
            "input_revision"
        ]
        == 1
    )
    assert (
        plate.client.put(
            "/api/data/s1/markers/m1", json={"wells": ["A2", "A1"]}
        ).json()["input_revision"]
        == 2
    )


def test_explicit_override_equal_to_imported_type_still_records_command(
    plate: SimpleNamespace,
) -> None:
    plate.upload.sessions["s1"].imported_well_types = {"A1": "NTC"}
    for expected in (1, 1):
        response = plate.client.post(
            "/api/data/s1/welltypes", json={"wells": ["A1"], "well_type": "NTC"}
        )
        assert response.json()["input_revision"] == expected
    assert plate.client.delete("/api/data/s1/welltypes").json()["input_revision"] == 2
    assert plate.client.get("/api/data/s1/welltypes").json()["assignments"] == {
        "A1": "NTC"
    }
