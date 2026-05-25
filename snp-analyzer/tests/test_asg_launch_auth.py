import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class ASGLaunchAuthTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(
            os.environ,
            {
                "SNP_AUTH_MODE": "asg_launch",
                "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-asg-launch",
                "ASG_SNP_SERVICE_SECRET": "secret",
            },
            clear=False,
        )
        self.env.start()

        import app.db as db

        if db._conn is not None:
            db._conn.close()
        db._conn = None
        db.DB_PATH = Path(self.tmp.name) / "test.sqlite3"

    def tearDown(self):
        import app.db as db

        if db._conn is not None:
            db._conn.close()
        db._conn = None
        try:
            from app.routers.upload import sessions

            sessions.clear()
        except ImportError:
            pass
        self.env.stop()
        self.tmp.cleanup()

    def test_asg_launch_upserts_shadow_user_and_sets_cookie(self):
        from fastapi.testclient import TestClient

        from app.asg_client import ASGLaunchContext, ASGLaunchUser, ASGLaunchValidation
        from app.auth import get_user_by_id, verify_password
        from app.main import app

        validation = ASGLaunchValidation(
            user=ASGLaunchUser(id="77", email="asg@example.com", display_name="ASG Example"),
            target=ASGLaunchContext(
                target_type="marker_version",
                target_id="mv-77",
                context={"marker_id": "M77", "tag": "S1"},
            ),
            scope=["snp:read"],
        )

        with patch("app.routers.auth_router.validate_launch_token", return_value=validation):
            with TestClient(app) as client:
                response = client.post("/api/auth/asg-launch", json={"token": "raw-token"})

        self.assertEqual(response.status_code, 200)
        self.assertIn("snp_auth=", response.headers.get("set-cookie", ""))
        self.assertEqual(response.json()["user"]["id"], "77")
        self.assertEqual(response.json()["linked_context"]["context"]["marker_id"], "M77")

        user = get_user_by_id("77")
        self.assertIsNotNone(user)
        self.assertEqual(user.username, "asg@example.com")
        self.assertEqual(user.role, "user")
        self.assertFalse(verify_password("anything", user.hashed_password))

    def test_asg_launch_is_idempotent_and_forces_user_role(self):
        from app.asg_client import ASGLaunchUser
        from app.auth import get_user_by_id, upsert_asg_shadow_user
        from app.db import init_db

        init_db()

        first = upsert_asg_shadow_user(
            ASGLaunchUser(id="88", email="first@example.com", display_name="First", role="admin")
        )
        second = upsert_asg_shadow_user(
            ASGLaunchUser(id="88", email="second@example.com", display_name="Second", role="admin")
        )

        self.assertEqual(first.id, second.id)
        user = get_user_by_id("88")
        self.assertEqual(user.username, "second@example.com")
        self.assertEqual(user.display_name, "Second")
        self.assertEqual(user.role, "user")

    def test_local_auth_surfaces_are_disabled_in_asg_launch_mode(self):
        from fastapi.testclient import TestClient

        from app.main import app

        with TestClient(app) as client:
            login = client.post("/api/auth/login", json={"username": "admin", "password": "pw"})
            users = client.get("/api/users")
            admin = client.get("/api/admin/dashboard")

        self.assertEqual(login.status_code, 404)
        self.assertEqual(users.status_code, 404)
        self.assertEqual(admin.status_code, 404)

    def test_local_mode_cookie_is_rejected_after_switching_to_asg_launch(self):
        from fastapi.testclient import TestClient

        from app.auth import create_access_token
        from app.db import get_db, init_db
        from app.main import app

        init_db()
        conn = get_db()
        conn.execute(
            "INSERT INTO users (id, username, hashed_password, display_name, role) VALUES (?, ?, ?, ?, ?)",
            ("local-admin", "admin", "!test", "Admin", "admin"),
        )
        conn.commit()

        with patch.dict(os.environ, {"SNP_AUTH_MODE": "local"}, clear=False):
            local_token = create_access_token("local-admin", "admin", "admin")

        with TestClient(app) as client:
            client.cookies.set("snp_auth", local_token)
            response = client.get("/api/auth/me")

        self.assertEqual(response.status_code, 401)

    def test_asg_project_cannot_attach_another_users_session(self):
        from fastapi.testclient import TestClient

        from app.auth import create_access_token
        from app.db import get_db
        from app.main import app
        from app.routers.upload import sessions

        with TestClient(app) as client:
            conn = get_db()
            self._insert_user(conn, "asg-1", "owner@example.com")
            self._insert_user(conn, "asg-2", "other@example.com")
            self._insert_session(conn, "other-session", "asg-2")
            conn.commit()
            sessions["other-session"] = object()

            client.cookies.set("snp_auth", create_access_token("asg-1", "owner@example.com", "user"))
            response = client.post(
                "/api/projects",
                json={"name": "Blocked", "session_ids": ["other-session"]},
            )

        self.assertEqual(response.status_code, 403)

    def test_asg_orphan_session_is_rejected_and_not_bulk_deleted(self):
        from fastapi.testclient import TestClient

        from app.auth import create_access_token
        from app.db import get_db
        from app.main import app
        from app.routers.upload import sessions

        with TestClient(app) as client:
            conn = get_db()
            self._insert_user(conn, "asg-3", "asg3@example.com")
            self._insert_session(conn, "orphan-session", None)
            conn.commit()
            sessions["orphan-session"] = object()

            client.cookies.set("snp_auth", create_access_token("asg-3", "asg3@example.com", "user"))
            get_response = client.get("/api/sessions/orphan-session")
            delete_response = client.post(
                "/api/sessions/bulk-delete",
                json={"session_ids": ["orphan-session"]},
            )

            remaining = conn.execute(
                "SELECT COUNT(*) FROM sessions WHERE session_id = ?",
                ("orphan-session",),
            ).fetchone()[0]

        self.assertEqual(get_response.status_code, 403)
        self.assertEqual(delete_response.status_code, 200)
        self.assertEqual(delete_response.json()["deleted"], 0)
        self.assertEqual(remaining, 1)

    def _insert_user(self, conn, user_id: str, username: str):
        conn.execute(
            "INSERT INTO users (id, username, hashed_password, display_name, role) VALUES (?, ?, ?, ?, ?)",
            (user_id, username, "!test", username, "user"),
        )

    def _insert_session(self, conn, session_id: str, user_id: str | None):
        conn.execute(
            """
            INSERT INTO sessions
                (session_id, instrument, num_wells, num_cycles, allele2_dye, has_rox, raw_filename, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (session_id, "Test", 96, 40, "HEX", 1, "test.xlsx", user_id),
        )


if __name__ == "__main__":
    unittest.main()
