"""Uploads are checked before they are read, and parsing stays off the event loop.

* A request without a usable sign-in cookie is answered 401 before any of the
  body is pulled from the connection.
* A body over the endpoint's size limit is answered 413, from the declared
  Content-Length when there is one and while counting otherwise.
* Parsing runs in a worker thread, and unexpected parser errors are reported
  with a fixed message rather than their own text.
"""

import asyncio
import json
import os
import tempfile
import threading
import zipfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from tests.stepone_fixtures import build_stepone_eds

MB = 1024 * 1024
CHUNK = 64 * 1024


@pytest.fixture
def env(tmp_path):
    patcher = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-upload-boundary",
            "ADMIN_PASSWORD": "StrongerOperatorPassword123!",
            "SNP_AUTH_MODE": "local",
            "RAW_FILE_DIR": str(tmp_path / "raw_uploads"),
        },
        clear=False,
    )
    patcher.start()

    import app.db as db

    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "boundary.sqlite3"
    yield tmp_path
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    patcher.stop()


def _token_for_admin() -> str:
    from app.auth import create_access_token
    from app.db import get_db

    row = get_db().execute("SELECT id, username, role FROM users WHERE role = 'admin' LIMIT 1").fetchone()
    return create_access_token(row["id"], row["username"], row["role"])


def _any_valid_token() -> str:
    """A well-formed token; enough for the checks made before a request is read."""
    from app.auth import create_access_token

    return create_access_token("user-1", "user1", "user")


@pytest.fixture
def client(env):
    from app.main import app
    from app.routers import upload

    upload.sessions.clear()
    with TestClient(app) as test_client:
        yield test_client
    upload.sessions.clear()


@pytest.fixture
def signed_in(client):
    from app.auth import COOKIE_NAME

    client.cookies.set(COOKIE_NAME, _token_for_admin())
    return client


def _post_upload(client, name="plate.eds", data=None):
    data = build_stepone_eds() if data is None else data
    return client.post("/api/upload", files={"file": (name, data, "application/octet-stream")})


def _multipart_head(boundary: bytes) -> bytes:
    return (
        b"--" + boundary + b"\r\n"
        b'Content-Disposition: form-data; name="file"; filename="plate.eds"\r\n'
        b"Content-Type: application/octet-stream\r\n\r\n"
    )


async def _drive(app, path, headers, chunks, total):
    """Call the ASGI app directly with a body fed in ``chunks``.

    Returns (status, body_bytes, bytes_pulled_by_the_app).
    """
    pulled = 0
    sent_chunks = iter(chunks)
    messages = []

    async def receive():
        nonlocal pulled
        try:
            chunk = next(sent_chunks)
        except StopIteration:
            return {"type": "http.request", "body": b"", "more_body": False}
        pulled += len(chunk)
        return {"type": "http.request", "body": chunk, "more_body": True}

    async def send(message):
        messages.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": headers,
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
    }
    await app(scope, receive, send)
    status = next(m["status"] for m in messages if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
    return status, body, pulled


def _chunks(total):
    block = b"x" * CHUNK
    return (block for _ in range(total // CHUNK))


def test_unsigned_upload_is_refused_without_reading_the_body(env):
    from app.main import app

    boundary = b"b0undary"
    total = 20 * MB
    headers = [
        (b"content-type", b"multipart/form-data; boundary=" + boundary),
        (b"content-length", str(total).encode()),
    ]
    status, body, pulled = asyncio.run(_drive(app, "/api/upload", headers, _chunks(total), total))

    assert status == 401
    assert json.loads(body) == {"detail": "Not authenticated"}
    assert pulled == 0


@pytest.mark.parametrize("path", ["/api/upload", "/api/import/preview", "/api/feedback/attachments"])
def test_garbage_cookie_is_refused_on_every_upload_endpoint(client, path):
    from app.auth import COOKIE_NAME

    client.cookies.set(COOKIE_NAME, "not-a-token")
    response = client.post(path, files={"file": ("a.eds", b"abc", "application/octet-stream")})

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


def test_unsigned_request_through_the_test_client_gets_401(client):
    response = _post_upload(client)

    assert response.status_code == 401


@pytest.mark.parametrize(
    "path, limit_name",
    [("/api/upload", "MAX_UPLOAD_SIZE_BYTES"), ("/api/import/preview", "MAX_UPLOAD_SIZE_BYTES")],
)
def test_declared_oversize_body_is_refused_without_reading_it(env, path, limit_name):
    from app.main import app

    token = _any_valid_token()
    from app import upload_limits
    from app.auth import COOKIE_NAME

    total = upload_limits.body_limit_for("upload") + 1
    headers = [
        (b"content-type", b"multipart/form-data; boundary=b0undary"),
        (b"content-length", str(total).encode()),
        (b"cookie", f"{COOKIE_NAME}={token}".encode()),
    ]
    status, body, pulled = asyncio.run(_drive(app, path, headers, iter(()), total))

    assert status == 413
    assert json.loads(body) == {"detail": "File is too large"}
    assert pulled == 0


def test_feedback_attachment_has_its_own_smaller_limit(env):
    from app import upload_limits
    from app.routers.feedback import MAX_ATTACHMENT_BYTES

    assert upload_limits.body_limit_for("feedback_attachment") < upload_limits.body_limit_for("upload")
    assert upload_limits.body_limit_for("feedback_attachment") >= MAX_ATTACHMENT_BYTES


def test_oversize_content_length_with_valid_cookie_is_413(signed_in):
    from app import upload_limits

    with patch.object(upload_limits, "MAX_UPLOAD_SIZE_BYTES", 10 * 1024), patch.object(
        upload_limits, "MULTIPART_OVERHEAD_BYTES", 0
    ):
        response = _post_upload(signed_in, data=b"x" * (20 * 1024))

    assert response.status_code == 413
    assert response.json() == {"detail": "File is too large"}


def test_chunked_oversize_body_is_refused_while_counting(env):
    from app import upload_limits
    from app.auth import COOKIE_NAME
    from app.main import app

    token = _any_valid_token()
    boundary = b"b0undary"
    headers = [
        (b"content-type", b"multipart/form-data; boundary=" + boundary),
        (b"transfer-encoding", b"chunked"),
        (b"cookie", f"{COOKIE_NAME}={token}".encode()),
    ]
    limit = 256 * 1024
    chunks = [_multipart_head(boundary)] + list(_chunks(4 * MB))
    with patch.object(upload_limits, "MAX_UPLOAD_SIZE_BYTES", limit), patch.object(
        upload_limits, "MULTIPART_OVERHEAD_BYTES", 0
    ):
        status, body, pulled = asyncio.run(_drive(app, "/api/upload", headers, chunks, 4 * MB))

    assert status == 413
    assert json.loads(body) == {"detail": "File is too large"}
    assert pulled <= limit + 2 * CHUNK


def test_chunked_oversize_body_through_the_test_client_is_413(signed_in):
    from app import upload_limits

    def body():
        yield b"--b0undary\r\n"
        for _ in range(8):
            yield b"x" * CHUNK

    with patch.object(upload_limits, "MAX_UPLOAD_SIZE_BYTES", 100 * 1024), patch.object(
        upload_limits, "MULTIPART_OVERHEAD_BYTES", 0
    ):
        response = signed_in.post(
            "/api/upload",
            content=body(),
            headers={"content-type": "multipart/form-data; boundary=b0undary"},
        )

    assert response.status_code == 413


def test_small_signed_in_upload_still_works(signed_in):
    response = _post_upload(signed_in)

    assert response.status_code == 200, response.text
    assert response.json()["session_id"]


def test_parsing_runs_in_a_worker_thread(signed_in):
    from app.auth import get_current_user
    from app.main import app
    from app.parsers import detector
    from app.routers import upload

    loop_threads = []
    parse_threads = []
    real = detector.detect_and_parse

    async def current_user_probe():
        from app.auth import TokenData

        loop_threads.append(threading.get_ident())
        return TokenData(user_id=_admin_id(), username="admin", role="admin")

    def recording_parse(*args, **kwargs):
        parse_threads.append(threading.get_ident())
        return real(*args, **kwargs)

    app.dependency_overrides[get_current_user] = current_user_probe
    try:
        with patch.object(upload, "detect_and_parse", recording_parse):
            response = _post_upload(signed_in)
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert response.status_code == 200, response.text
    assert parse_threads and loop_threads
    assert parse_threads[0] != loop_threads[0]
    assert parse_threads[0] != threading.main_thread().ident


def _admin_id() -> str:
    from app.db import get_db

    return get_db().execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1").fetchone()["id"]


def test_unexpected_parser_error_is_reported_with_a_fixed_message(signed_in, caplog):
    from app.routers import upload

    with patch.object(upload, "detect_and_parse", side_effect=KeyError("secret-detail")):
        response = _post_upload(signed_in)

    assert response.status_code == 400
    assert "secret-detail" not in response.text
    assert response.json() == {"detail": "The file could not be read."}
    assert any("secret-detail" in (r.exc_text or "") for r in caplog.records)


def test_message_written_for_the_user_is_kept(signed_in):
    from app.routers import upload

    with patch.object(upload, "detect_and_parse", side_effect=ValueError("This file has no peaks.")):
        response = _post_upload(signed_in)

    assert response.status_code == 400
    assert response.json()["detail"] == "Failed to parse file: This file has no peaks."


def test_corrupt_archive_error_text_is_not_returned(signed_in):
    response = _post_upload(signed_in, name="broken.eds", data=b"PK\x03\x04" + b"\x00" * 64)

    assert response.status_code == 400
    assert "CRC" not in response.text
    assert "zip" not in response.text.lower() or "corrupted" in response.text


def test_import_preview_unexpected_error_is_reported_with_a_fixed_message(signed_in):
    from app.routers import import_api

    with patch.object(import_api.parser_registry, "match", side_effect=KeyError("secret-detail")):
        response = signed_in.post(
            "/api/import/preview", files={"file": ("plate.csv", b"a,b\n1,2\n", "text/csv")}
        )

    assert response.status_code == 400
    assert "secret-detail" not in response.text
    assert response.json() == {"detail": "The file could not be read."}


def test_busy_server_answers_503(signed_in):
    from app import upload_limits

    held = [upload_limits._parse_slots.acquire() for _ in range(upload_limits.MAX_CONCURRENT_PARSES)]
    try:
        with patch.object(upload_limits, "PARSE_SLOT_WAIT_SECONDS", 0.05):
            response = _post_upload(signed_in)
    finally:
        for _ in held:
            upload_limits._parse_slots.release()

    assert response.status_code == 503
    assert response.json() == {"detail": "The server is busy, try again shortly"}


def test_preview_store_keeps_the_newest_ten_per_user(tmp_path):
    from app.routers import import_api

    import_api.preview_store.clear()
    try:
        files = []
        for index in range(11):
            path = tmp_path / f"p{index}.csv"
            path.write_text("x")
            files.append(path)
            import_api._store_preview(
                import_api.PreviewRecord(
                    preview_id=f"p{index}",
                    owner_user_id="u1",
                    file_path=path,
                    filename=path.name,
                    parser_id="x",
                    expires_at=1000.0 + index,
                )
            )
        other = tmp_path / "other.csv"
        other.write_text("x")
        import_api._store_preview(
            import_api.PreviewRecord("other", "u2", other, "other.csv", "x", 1.0)
        )

        assert "p0" not in import_api.preview_store
        assert not files[0].exists()
        assert {f"p{i}" for i in range(1, 11)} <= set(import_api.preview_store)
        assert "other" in import_api.preview_store
    finally:
        import_api.preview_store.clear()


def test_xlsx_fixer_leaves_no_temp_file_when_it_fails(tmp_path, monkeypatch):
    from app.parsers import xlsx_fixer

    scratch = tmp_path / "scratch"
    scratch.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(scratch))
    broken = tmp_path / "broken.xlsx"
    broken.write_bytes(b"this is not a zip archive")

    with pytest.raises(zipfile.BadZipFile):
        xlsx_fixer.fix_cfx_xlsx(str(broken))

    assert list(scratch.iterdir()) == []


def test_project_session_lists_are_capped_at_200(signed_in):
    ids = [f"s{i}" for i in range(201)]

    assert signed_in.post("/api/projects", json={"name": "p", "session_ids": ids}).status_code == 422
    assert signed_in.post("/api/projects/abc/sessions/bulk-add", json={"session_ids": ids}).status_code == 422
    assert signed_in.post("/api/projects/abc/sessions/bulk-remove", json={"session_ids": ids}).status_code == 422
    assert signed_in.put("/api/projects/abc", json={"session_ids": ids}).status_code == 422
