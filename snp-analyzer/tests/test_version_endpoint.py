"""The instance has to be able to say which build it is."""
import importlib
import os
from unittest.mock import patch

from fastapi.testclient import TestClient


def _client(tmp_path):
    """Startup creates the admin user, so the client needs the same auth
    configuration the other API tests use."""
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-version-tests",
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
    db.DB_PATH = tmp_path / "version.sqlite3"

    from app.main import app

    return TestClient(app), env, db


def test_version_is_reported_without_authentication(tmp_path):
    """The footer showing this is on the login screen too, so it cannot be
    behind auth."""
    client, env, db = _client(tmp_path)
    try:
        with client:
            response = client.get("/api/version")
    finally:
        if db._conn is not None:
            db._conn.close()
        db._conn = None
        env.stop()

    assert response.status_code == 200
    body = response.json()
    assert body["version"]
    # A version that is not a version is worse than none: it would be quoted
    # in bug reports as if it meant something.
    assert body["version"][0].isdigit()


def test_build_provenance_is_empty_rather_than_invented():
    import app.version as version_module

    with patch.dict(os.environ, {}, clear=True):
        importlib.reload(version_module)
        assert version_module.BUILD_SHA == ""
        assert version_module.BUILD_TIME == ""

    with patch.dict(
        os.environ,
        {"APP_BUILD_SHA": "0123456789abcdef0123", "APP_BUILD_TIME": "2026-09-11T00:00:00Z"},
        clear=True,
    ):
        importlib.reload(version_module)
        # Short enough to sit in a footer, long enough to identify a commit.
        assert version_module.BUILD_SHA == "0123456789ab"
        assert version_module.BUILD_TIME == "2026-09-11T00:00:00Z"

    importlib.reload(version_module)


def test_version_matches_the_frontend_manifest():
    """Two manifests that disagree make the footer a coin toss."""
    import json
    from pathlib import Path

    import app.version as version_module

    importlib.reload(version_module)
    manifest = json.loads(
        (Path(__file__).resolve().parents[1] / "frontend" / "package.json").read_text()
    )
    assert manifest["version"] == version_module.__version__
