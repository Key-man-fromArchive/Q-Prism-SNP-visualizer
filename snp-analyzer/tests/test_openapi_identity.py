"""The OpenAPI schema is another screen the product name shows up on.

/docs and /redoc render whatever app.title is set to; it has to say the
same product name as the UI, README, and PDF report, not the retired one.
"""

import os
from unittest.mock import patch

from fastapi.testclient import TestClient


def _client(tmp_path):
    """Startup creates the admin user, so the client needs the same auth
    configuration the other API tests use."""
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-openapi-tests",
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
    db.DB_PATH = tmp_path / "openapi.sqlite3"

    from app.main import app

    return TestClient(app), env, db


def test_openapi_title_matches_the_product_name(tmp_path):
    client, env, db = _client(tmp_path)
    try:
        with client:
            response = client.get("/openapi.json")
    finally:
        if db._conn is not None:
            db._conn.close()
        db._conn = None
        env.stop()

    assert response.status_code == 200
    assert response.json()["info"]["title"] == "Q-prism® Cluster Caller"
