"""Request-boundary behaviour: cookie flags, response headers, same-origin
checks for state-changing calls, and id/path handling on delete."""

import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

BASE_ENV = {
    "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-boundary-tests",
    "ASG_SNP_SERVICE_SECRET": "secret",
    "ASG_LAUNCH_COOKIE_NAME": "snp_launch_token",
    "ASG_LAUNCH_COOKIE_PATH": "/snp-analyze/api/auth",
}


@pytest.fixture
def env(tmp_path):
    """Isolated DB + raw-file storage; mode is chosen per test."""
    import app.db as db

    patcher = patch.dict(os.environ, {**BASE_ENV, "RAW_FILE_DIR": str(tmp_path / "raw_uploads")}, clear=False)
    patcher.start()
    os.environ.pop("AUTH_COOKIE_SECURE", None)
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "boundary.sqlite3"
    yield tmp_path
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    patcher.stop()


def _asg_mode():
    return patch.dict(os.environ, {"SNP_AUTH_MODE": "asg_launch"}, clear=False)


def _validation(user_id="91"):
    from app.asg_client import ASGLaunchContext, ASGLaunchUser, ASGLaunchValidation

    return ASGLaunchValidation(
        user=ASGLaunchUser(id=user_id, email=f"u{user_id}@example.com"),
        target=ASGLaunchContext(target_type="ad_hoc", target_id=user_id, context={}),
        scope=["snp:read"],
    )


def _launch(client, headers=None):
    with patch("app.routers.auth_router.validate_launch_token", return_value=_validation()):
        client.cookies.set("snp_launch_token", "cookie-token")
        return client.post("/api/auth/asg-launch-cookie", headers=headers or {})


def _auth_set_cookie(response):
    values = [v for v in response.headers.get_list("set-cookie") if v.startswith("snp_auth=")]
    assert len(values) == 1
    return values[0]


# --- Secure flag on the session cookie ------------------------------------

def test_cookie_is_secure_behind_https_proxy(env):
    from app.main import app

    with _asg_mode(), TestClient(app) as client:
        response = _launch(client, {"X-Forwarded-Proto": "https"})
    assert response.status_code == 200
    assert "secure" in _auth_set_cookie(response).lower()


def test_cookie_uses_first_forwarded_proto_value(env):
    from app.main import app

    with _asg_mode(), TestClient(app) as client:
        response = _launch(client, {"X-Forwarded-Proto": "https, http"})
    assert "secure" in _auth_set_cookie(response).lower()


def test_cookie_is_not_secure_on_plain_http_without_setting(env):
    from app.main import app

    with _asg_mode(), TestClient(app) as client:
        response = _launch(client)
    assert "secure" not in _auth_set_cookie(response).lower()


def test_cookie_secure_setting_false_overrides_https_detection(env):
    from app.main import app

    with _asg_mode(), patch.dict(os.environ, {"AUTH_COOKIE_SECURE": "false"}), TestClient(app) as client:
        response = _launch(client, {"X-Forwarded-Proto": "https"})
    assert "secure" not in _auth_set_cookie(response).lower()


def test_cookie_secure_setting_true_applies_on_plain_http(env):
    from app.main import app

    with _asg_mode(), patch.dict(os.environ, {"AUTH_COOKIE_SECURE": "yes"}), TestClient(app) as client:
        response = _launch(client)
    assert "secure" in _auth_set_cookie(response).lower()


# --- Response headers -------------------------------------------------------

@pytest.mark.parametrize("path", ["/", "/api/version"])
def test_content_security_policy_report_only_is_present(env, path):
    from app.main import app

    with _asg_mode(), TestClient(app) as client:
        response = client.get(path)
    policy = response.headers["content-security-policy-report-only"]
    assert "default-src 'self'" in policy
    assert "frame-ancestors 'none'" in policy
    assert "content-security-policy" not in response.headers


# --- Same-origin check on state-changing calls ------------------------------

@pytest.mark.parametrize("site", ["cross-site", "same-site"])
def test_state_changing_call_from_another_site_is_refused(env, site):
    from app.main import app

    with _asg_mode(), TestClient(app) as client:
        response = client.post("/api/auth/logout", headers={"Sec-Fetch-Site": site})
    assert response.status_code == 403
    assert response.json() == {"detail": "Cross-site request refused"}
    assert "x-content-type-options" in response.headers


@pytest.mark.parametrize("site", ["same-origin", "none", None])
def test_state_changing_call_from_same_origin_or_unlabelled_client_is_handled(env, site):
    from app.main import app

    headers = {"Sec-Fetch-Site": site} if site else {}
    with _asg_mode(), TestClient(app) as client:
        response = client.post("/api/auth/logout", headers=headers)
    assert response.status_code == 200


def test_read_requests_are_not_subject_to_the_origin_check(env):
    from app.main import app

    with _asg_mode(), TestClient(app) as client:
        response = client.get("/api/version", headers={"Sec-Fetch-Site": "cross-site"})
    assert response.status_code == 200


# --- Session id format and storage-root containment on delete ---------------

def _local_admin_client(env):
    """Local-mode client with an admin user inserted directly."""
    from app.auth import create_access_token
    from app.db import get_db, init_db
    from app.main import app

    init_db()
    conn = get_db()
    conn.execute(
        "INSERT INTO users (id, username, hashed_password, display_name, role) VALUES (?, ?, ?, ?, ?)",
        ("adm", "admin", "!test", "Admin", "admin"),
    )
    conn.commit()
    client = TestClient(app)  # no lifespan: the user table is already seeded
    client.cookies.set("snp_auth", create_access_token("adm", "admin", "admin"))
    return client, conn


def _insert_session(conn, session_id):
    conn.execute(
        "INSERT INTO sessions (session_id, instrument, num_wells, num_cycles, allele2_dye, has_rox, raw_filename, user_id)"
        " VALUES (?, 'Test', 96, 40, 'HEX', 1, 'test.xlsx', 'adm')",
        (session_id,),
    )
    conn.commit()


def test_bulk_delete_skips_ids_outside_the_session_id_format(env):
    outside = env / "x"
    outside.mkdir()
    (outside / "keep.txt").write_text("keep")
    (env / "raw_uploads").mkdir()

    with patch.dict(os.environ, {"SNP_AUTH_MODE": "local"}):
        client, _ = _local_admin_client(env)
        response = client.post("/api/sessions/bulk-delete", json={"session_ids": ["../x", "..", "a/b"]})

    assert response.status_code == 200
    assert response.json()["deleted"] == 0
    assert (outside / "keep.txt").read_text() == "keep"


def test_bulk_delete_removes_sessions_with_well_formed_ids(env):
    sid = "0123456789ab"
    raw_dir = env / "raw_uploads" / sid
    raw_dir.mkdir(parents=True)
    (raw_dir / "raw.xlsx").write_text("data")

    with patch.dict(os.environ, {"SNP_AUTH_MODE": "local"}):
        client, conn = _local_admin_client(env)
        _insert_session(conn, sid)
        response = client.post("/api/sessions/bulk-delete", json={"session_ids": [sid, "../x"]})

    assert response.json()["deleted"] == 1
    assert not raw_dir.exists()
    assert conn.execute("SELECT COUNT(*) FROM sessions WHERE session_id = ?", (sid,)).fetchone()[0] == 0


def test_raw_file_delete_refuses_paths_outside_storage_root(env):
    from app.services import raw_file_storage

    root = env / "raw_uploads"
    root.mkdir()
    outside = env / "x"
    outside.mkdir()
    (outside / "keep.txt").write_text("keep")
    inside = root / "abc"
    inside.mkdir()
    (inside / "raw.txt").write_text("gone")

    raw_file_storage.delete_raw_files_for_sessions(["../x", "..", "abc"])

    assert (outside / "keep.txt").exists()
    assert root.exists()
    assert not inside.exists()


def test_raw_file_delete_does_not_follow_a_link_leaving_the_storage_root(env):
    from app.services import raw_file_storage

    root = env / "raw_uploads"
    root.mkdir()
    outside = env / "elsewhere"
    outside.mkdir()
    (outside / "keep.txt").write_text("keep")
    (root / "linked").symlink_to(outside, target_is_directory=True)

    raw_file_storage.delete_raw_files_for_sessions(["linked"])

    assert (outside / "keep.txt").exists()
