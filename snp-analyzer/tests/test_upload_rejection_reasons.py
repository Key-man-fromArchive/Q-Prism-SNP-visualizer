"""Rejected uploads say why, to the user and in the server log.

A StepOne ``.eds`` saved before its run finished (or the setup file) has the
``apldbio/sds`` layout but no ``multicomponent_data.txt``. It used to fall
through to the QuantStudio message ("does not contain multicomponentdata.xml
... unsupported instrument") as a plain string the UI could only show as a
generic rejection. It now carries a stable code, and every rejection is logged
with the user, the file name and the reason -- never the file content.
"""

import io
import logging
import os
import zipfile
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user
from tests.stepone_fixtures import build_stepone_eds


@pytest.fixture
def client(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-upload-rejections",
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
    from app.routers import upload

    async def current_user_override():
        return TokenData(user_id="user-1", username="user1", role="user")

    app.dependency_overrides[get_current_user] = current_user_override
    upload.sessions.clear()

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.pop(get_current_user, None)
    upload.sessions.clear()
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _without(data: bytes, dropped: str) -> bytes:
    source = zipfile.ZipFile(io.BytesIO(data))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as target:
        for info in source.infolist():
            if not info.filename.endswith(dropped):
                target.writestr(info, source.read(info))
    return buffer.getvalue()


def _upload(client, name: str, data: bytes):
    return client.post("/api/upload", files={"file": (name, data, "application/octet-stream")})


def test_stepone_eds_without_reads_is_a_coded_rejection(client, caplog):
    data = _without(build_stepone_eds(), "multicomponent_data.txt")

    with caplog.at_level(logging.WARNING, logger="app.routers.upload"):
        response = _upload(client, "run-not-finished.eds", data)

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "eds_no_measurement_data"
    assert detail["message"].startswith("Failed to parse file: This StepOne .eds file contains no measured")
    logged = [r.getMessage() for r in caplog.records if "Upload rejected" in r.getMessage()]
    assert len(logged) == 1
    assert "user=user-1" in logged[0] and "'run-not-finished.eds'" in logged[0]
    assert "EdsNoMeasurementData" in logged[0]


def test_non_stepone_eds_without_reads_keeps_its_message_with_the_code(client):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("apldbio/sds/experiment.xml", "<Experiment/>")

    response = _upload(client, "empty.eds", buffer.getvalue())

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "eds_no_measurement_data"
    assert "does not contain multicomponentdata.xml" in detail["message"]


def test_other_parse_failures_stay_plain_strings_and_are_logged(client, caplog):
    with caplog.at_level(logging.WARNING, logger="app.routers.upload"):
        response = _upload(client, "broken.eds", b"not a zip archive")

    assert response.status_code == 400
    assert response.json()["detail"].startswith("Failed to parse file: This .eds file appears to be corrupted")
    assert any("'broken.eds'" in r.getMessage() for r in caplog.records)


def test_unsupported_type_is_logged(client, caplog):
    with caplog.at_level(logging.WARNING, logger="app.routers.upload"):
        response = _upload(client, "notes.doc", b"hello")

    assert response.status_code == 400
    assert any("'notes.doc'" in r.getMessage() and "Unsupported file type" in r.getMessage() for r in caplog.records)

