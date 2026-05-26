import json
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user
from app.models import UploadResponse


FIXTURES = Path(__file__).parent / "fixtures" / "import"


@pytest.fixture
def import_api_client(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-import-api",
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
    from app.routers import import_api, upload

    user = SimpleNamespace(value=TokenData(user_id="user-1", username="user1", role="user"))

    async def current_user_override():
        return user.value

    app.dependency_overrides[get_current_user] = current_user_override
    import_api.preview_store.clear()

    with TestClient(app) as client:
        yield SimpleNamespace(client=client, app=app, import_api=import_api, upload=upload, user=user)

    app.dependency_overrides.pop(get_current_user, None)
    import_api.preview_store.clear()
    upload.sessions.clear()
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _upload_preview(client: TestClient, path: Path, content_type: str = "text/csv") -> dict:
    with path.open("rb") as handle:
        response = client.post(
            "/api/import/preview",
            files={"file": (path.name, handle, content_type)},
        )
    assert response.status_code == 200, response.text
    return response.json()


def _wide_mapping(path: Path) -> dict:
    payload = json.loads(path.read_text())
    return {
        "assay_mode": "wt_mt",
        "normalization_mode": "none",
        "channel_roles": {
            channel: role
            for channel, role in payload["channels"].items()
        },
        "well_column": "well",
        "cycle_column": "cycle",
        "sample_column": "sample",
        "target_column": "target",
        "rfu_columns": {
            channel: channel
            for channel in payload["channels"]
        },
    }


def test_import_preview_returns_owner_bound_preview_candidates(import_api_client):
    payload = _upload_preview(
        import_api_client.client,
        FIXTURES / "generic_long" / "wt_mt.csv",
    )

    assert payload["preview_id"]
    assert payload["parser_id"] == "generic-long"
    assert payload["filename"] == "wt_mt.csv"
    assert payload["inferred_delimiter"] == ","
    assert payload["decimal_separator"] == "."
    assert payload["header_row"] == 0
    assert payload["first_data_row"] == 1
    assert "well" in payload["column_candidates"]["well"]
    assert "cycle" in payload["column_candidates"]["cycle"]
    assert "rfu" in payload["column_candidates"]["rfu"]
    assert "wt_mt" in payload["assay_mode_candidates"]
    assert payload["sample_rows"]

    record = import_api_client.import_api.preview_store[payload["preview_id"]]
    assert record.owner_user_id == "user-1"
    assert record.file_path.exists()


@pytest.mark.parametrize(
    ("fixture_path", "content_type", "expected_parser"),
    [
        (FIXTURES / "strict_rdes" / "mapping_required_preview_only.tsv", "text/tab-separated-values", "qprism-rdes"),
        (FIXTURES / "generic_wide" / "wt_mt.csv", "text/csv", "generic-wide"),
    ],
)
def test_import_preview_supports_tsv_and_ambiguous_table_candidates(
    import_api_client,
    fixture_path,
    content_type,
    expected_parser,
):
    payload = _upload_preview(import_api_client.client, fixture_path, content_type)

    assert payload["parser_id"] == expected_parser
    assert payload["candidate_tables"]
    assert payload["sample_rows"]


def test_import_preview_supports_rdml_preview_first(import_api_client):
    payload = _upload_preview(
        import_api_client.client,
        FIXTURES / "rdml" / "wt_mt.rdml",
        "application/xml",
    )

    assert payload["parser_id"] == "rdml"
    assert payload["candidate_tables"] == ["run-1"]
    assert payload["metadata"]["preview_first"] is True
    assert payload["metadata"]["runs"][0]["channels"] == ["FAM", "VIC"]
    assert payload["channel_candidates"]


def test_import_preview_supports_xlsx_tables(import_api_client, tmp_path):
    openpyxl = pytest.importorskip("openpyxl")
    xlsx_path = tmp_path / "plate.xlsx"
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.append(["well", "cycle", "dye", "role", "rfu", "sample", "target", "sample_type"])
    sheet.append(["A1", 1, "FAM", "WT", 120.0, "Sample_01", "SNP1", "unkn"])
    sheet.append(["A1", 1, "VIC", "MT1", 96.0, "Sample_01", "SNP1", "unkn"])
    workbook.save(xlsx_path)

    payload = _upload_preview(
        import_api_client.client,
        xlsx_path,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )

    assert payload["parser_id"] == "generic-table"
    assert payload["candidate_tables"] == ["Sheet"]


def test_import_preview_rejects_unsupported_file_type(import_api_client):
    response = import_api_client.client.post(
        "/api/import/preview",
        files={"file": ("plate.png", b"not an import", "image/png")},
    )

    assert response.status_code == 400
    assert "Unsupported file type" in response.json()["detail"]


def test_import_parse_creates_session_through_shared_service(import_api_client):
    preview = _upload_preview(
        import_api_client.client,
        FIXTURES / "generic_wide" / "wt_mt.csv",
    )
    mapping = _wide_mapping(FIXTURES / "generic_wide" / "wt_mt.mapping.json")

    with patch.object(import_api_client.import_api, "create_session_from_import") as create_session:
        create_session.return_value = UploadResponse(
            session_id="sid-1",
            instrument="Generic Wide Table",
            allele2_dye="ch2_rfu",
            num_wells=1,
            num_cycles=3,
            has_rox=False,
        )
        response = import_api_client.client.post(
            "/api/import/parse",
            json={"preview_id": preview["preview_id"], "mapping": mapping},
        )

    assert response.status_code == 200, response.text
    assert response.json()["session_id"] == "sid-1"
    create_session.assert_called_once()
    kwargs = create_session.call_args.kwargs
    assert kwargs["filename"] == "wt_mt.csv"
    assert kwargs["user_id"] == "user-1"
    assert kwargs["session_store"] is import_api_client.upload.sessions
    assert kwargs["unified"].instrument == "Generic Wide Table"


def test_import_parse_creates_session_from_rdml_wt_mt_mapping(import_api_client):
    preview = _upload_preview(
        import_api_client.client,
        FIXTURES / "rdml" / "wt_mt.rdml",
        "application/xml",
    )
    mapping = {
        "assay_mode": "wt_mt",
        "normalization_mode": "none",
        "channel_roles": {"FAM": "WT", "VIC": "MT1"},
        "rdml_run_id": "run-1",
        "rdml_target_ids": ["WT", "MT"],
    }

    with patch.object(import_api_client.import_api, "create_session_from_import") as create_session:
        create_session.return_value = UploadResponse(
            session_id="rdml-sid",
            instrument="Q-Prism Synthetic RDML",
            allele2_dye="VIC",
            num_wells=2,
            num_cycles=3,
            has_rox=False,
        )
        response = import_api_client.client.post(
            "/api/import/parse",
            json={"preview_id": preview["preview_id"], "mapping": mapping},
        )

    assert response.status_code == 200, response.text
    assert response.json()["session_id"] == "rdml-sid"
    kwargs = create_session.call_args.kwargs
    assert kwargs["filename"] == "wt_mt.rdml"
    assert kwargs["unified"].instrument == "Q-Prism Synthetic RDML"
    create_session.assert_called_once()


def test_import_parse_returns_structured_validation_errors_without_session_creation(import_api_client):
    preview = _upload_preview(
        import_api_client.client,
        FIXTURES / "generic_wide" / "wt_mt.csv",
    )
    mapping = _wide_mapping(FIXTURES / "generic_wide" / "wt_mt.mapping.json")
    mapping["cycle_column"] = "missing_cycle"

    with patch.object(import_api_client.import_api, "create_session_from_import") as create_session:
        response = import_api_client.client.post(
            "/api/import/parse",
            json={"preview_id": preview["preview_id"], "mapping": mapping},
        )

    assert response.status_code == 422
    payload = response.json()
    assert payload["status"] == "validation_failed"
    assert payload["issues"][0]["code"] == "missing_field"
    create_session.assert_not_called()


@pytest.mark.parametrize(
    ("filename", "assay_mode"),
    [
        ("wt_mt1_mt2.csv", "wt_mt1_mt2"),
        ("wt_mt1_mt2_mt3.csv", "wt_mt1_mt2_mt3"),
    ],
)
def test_import_parse_keeps_triplex_and_quadruplex_preview_only(
    import_api_client,
    filename,
    assay_mode,
):
    preview = _upload_preview(
        import_api_client.client,
        FIXTURES / "generic_long" / filename,
    )
    mapping = {
        "assay_mode": assay_mode,
        "normalization_mode": "none",
        "channel_roles": {"FAM": "WT", "VIC": "MT1", "HEX": "MT2", "CY5": "MT3"},
    }

    with patch.object(import_api_client.import_api, "create_session_from_import") as create_session:
        response = import_api_client.client.post(
            "/api/import/parse",
            json={"preview_id": preview["preview_id"], "mapping": mapping},
        )

    assert response.status_code == 409
    assert response.json()["status"] == "unsupported_analysis_mode"
    assert response.json()["assay_mode"] == assay_mode
    create_session.assert_not_called()


def test_import_parse_rejects_expired_preview_id_and_cleans_file(import_api_client):
    preview = _upload_preview(
        import_api_client.client,
        FIXTURES / "generic_wide" / "wt_mt.csv",
    )
    record = import_api_client.import_api.preview_store[preview["preview_id"]]
    record.expires_at = 0

    response = import_api_client.client.post(
        "/api/import/parse",
        json={
            "preview_id": preview["preview_id"],
            "mapping": _wide_mapping(FIXTURES / "generic_wide" / "wt_mt.mapping.json"),
        },
    )

    assert response.status_code == 410
    assert preview["preview_id"] not in import_api_client.import_api.preview_store
    assert not record.file_path.exists()


def test_import_parse_rejects_preview_owned_by_another_user(import_api_client):
    preview = _upload_preview(
        import_api_client.client,
        FIXTURES / "generic_wide" / "wt_mt.csv",
    )
    import_api_client.user.value = TokenData(user_id="user-2", username="user2", role="user")

    response = import_api_client.client.post(
        "/api/import/parse",
        json={
            "preview_id": preview["preview_id"],
            "mapping": _wide_mapping(FIXTURES / "generic_wide" / "wt_mt.mapping.json"),
        },
    )

    assert response.status_code == 403
