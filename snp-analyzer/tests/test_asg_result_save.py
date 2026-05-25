import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch


class _Response:
    def __init__(self, payload: dict):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return self.payload


class ASGResultSaveTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(
            os.environ,
            {
                "SNP_AUTH_MODE": "asg_launch",
                "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-asg-save",
                "ASG_SNP_SERVICE_SECRET": "secret",
                "ASG_BASE_URL": "http://asg.local",
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
        for module_name in ("app.routers.upload", "app.routers.clustering", "app.asg_session"):
            try:
                module = __import__(module_name, fromlist=["dummy"])
                getattr(module, "sessions", {}).clear()
                getattr(module, "cluster_store", {}).clear()
                getattr(module, "welltype_store", {}).clear()
                if hasattr(module, "clear_asg_launch_state"):
                    module.clear_asg_launch_state()
            except ImportError:
                pass
        self.env.stop()
        self.tmp.cleanup()

    def test_validate_launch_token_parses_save_credential(self):
        from app import asg_client

        payload = self._launch_payload()

        with patch.object(asg_client.config, "ASG_SNP_SERVICE_SECRET", "secret"):
            with patch.object(asg_client, "urlopen", return_value=_Response(payload)):
                result = asg_client.validate_launch_token("raw-token")

        self.assertEqual(result.launch.id, "launch-1")
        self.assertEqual(result.launch.save_token, "save-secret")

    def test_asg_launch_response_does_not_expose_save_token(self):
        from fastapi.testclient import TestClient

        from app.asg_client import (
            ASGLaunchContext,
            ASGLaunchSaveCredential,
            ASGLaunchUser,
            ASGLaunchValidation,
        )
        from app.main import app

        validation = ASGLaunchValidation(
            user=ASGLaunchUser(id="asg-1", email="owner@example.com"),
            target=ASGLaunchContext(
                target_type="design_run_item",
                target_id="101",
                context={"marker_id": "M101", "tag_alias": "S1"},
            ),
            launch=ASGLaunchSaveCredential(id="launch-1", save_token="save-secret"),
            scope=["snp:read", "snp:upload", "snp:save_result"],
        )

        with patch("app.routers.auth_router.validate_launch_token", return_value=validation):
            with TestClient(app) as client:
                response = client.post("/api/auth/asg-launch", json={"token": "raw-token"})

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertNotIn("save_token", json.dumps(body))

    def test_result_snapshot_contains_summary_without_raw_cycle_arrays(self):
        from app.asg_client import ASGLaunchContext, ASGLaunchSaveCredential
        from app.asg_session import bind_session_to_current_asg_launch, remember_asg_launch
        from app.asg_result import build_result_snapshot
        from app.db import get_db, init_db, save_session
        from app.models import ClusteringResult
        from app.routers.clustering import cluster_store, welltype_store
        from app.routers.upload import sessions

        init_db()
        get_db().execute(
            "INSERT INTO users (id, username, hashed_password, display_name, role) VALUES (?, ?, ?, ?, ?)",
            ("asg-1", "owner@example.com", "!test", "Owner", "user"),
        )
        get_db().commit()
        unified = self._unified()
        sessions["sid-1"] = unified
        save_session("sid-1", unified, filename="plate.xlsx", user_id="asg-1")
        remember_asg_launch(
            "asg-1",
            ASGLaunchContext("design_run_item", "101", {"marker_id": "M101"}),
            ASGLaunchSaveCredential("launch-1", "save-secret"),
            ["snp:save_result"],
            None,
        )
        bind_session_to_current_asg_launch("sid-1", "asg-1")
        cluster_store["sid-1"] = ClusteringResult(
            algorithm="threshold",
            cycle=2,
            assignments={"A1": "Allele 1 Homo", "A2": "Allele 2 Homo"},
        )
        welltype_store["sid-1"] = {"A2": "Heterozygous"}

        snapshot = build_result_snapshot("sid-1", selected_cycle=2)

        self.assertEqual(snapshot["schema_version"], 1)
        self.assertEqual(snapshot["launch"]["id"], "launch-1")
        self.assertEqual(snapshot["launch"]["save_token"], "save-secret")
        self.assertEqual(snapshot["summary"]["genotype_counts"]["AA"], 1)
        self.assertEqual(snapshot["summary"]["genotype_counts"]["AB"], 1)
        self.assertEqual(snapshot["result"]["wells"][1]["manual_type"], "Heterozygous")
        self.assertNotIn("data", snapshot["result"])

    def test_result_snapshot_allows_save_after_bootstrap_launch_expiry(self):
        from app.asg_client import ASGLaunchContext, ASGLaunchSaveCredential
        from app.asg_session import bind_session_to_current_asg_launch, remember_asg_launch
        from app.asg_result import build_result_snapshot
        from app.db import get_db, init_db, save_session
        from app.routers.upload import sessions

        init_db()
        get_db().execute(
            "INSERT INTO users (id, username, hashed_password, display_name, role) VALUES (?, ?, ?, ?, ?)",
            ("asg-1", "owner@example.com", "!test", "Owner", "user"),
        )
        get_db().commit()
        sessions["sid-expired-launch"] = self._unified()
        save_session("sid-expired-launch", sessions["sid-expired-launch"], filename="plate.xlsx", user_id="asg-1")
        remember_asg_launch(
            "asg-1",
            ASGLaunchContext("design_run_item", "101", {"marker_id": "M101"}),
            ASGLaunchSaveCredential("launch-1", "save-secret"),
            ["snp:save_result"],
            datetime.now(timezone.utc) - timedelta(minutes=10),
        )
        bind_session_to_current_asg_launch("sid-expired-launch", "asg-1")

        snapshot = build_result_snapshot("sid-expired-launch", selected_cycle=2)

        self.assertEqual(snapshot["launch"]["id"], "launch-1")

    def test_save_result_posts_bound_session_to_asg(self):
        from fastapi.testclient import TestClient

        from app.asg_client import (
            ASGLaunchContext,
            ASGLaunchSaveCredential,
        )
        from app.auth import create_access_token
        from app.db import get_db
        from app.main import app
        from app.models import ClusteringResult
        from app.routers.clustering import cluster_store
        from app.routers.upload import sessions

        target = ASGLaunchContext(
            target_type="design_run_item",
            target_id="101",
            context={"marker_id": "M101"},
        )
        launch = ASGLaunchSaveCredential(id="launch-1", save_token="save-secret")
        posted_payloads = []

        with patch(
            "app.routers.asg.post_analysis_result",
            return_value={"analysis_run_id": "run-1", "created": True},
        ) as mock_post:
            with TestClient(app) as client:
                conn = get_db()
                conn.execute(
                    "INSERT INTO users (id, username, hashed_password, display_name, role) VALUES (?, ?, ?, ?, ?)",
                    ("asg-1", "owner@example.com", "!test", "Owner", "user"),
                )
                sessions["sid-1"] = self._unified()
                conn.execute(
                    """
                    INSERT INTO sessions
                        (session_id, instrument, num_wells, num_cycles, allele2_dye, has_rox, raw_filename, user_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    ("sid-1", "Test", 2, 2, "HEX", 1, "plate.xlsx", "asg-1"),
                )
                conn.commit()
                cluster_store["sid-1"] = ClusteringResult(
                    algorithm="threshold",
                    cycle=2,
                    assignments={"A1": "Allele 1 Homo", "A2": "Allele 2 Homo"},
                )
                from app.asg_session import bind_session_to_current_asg_launch, remember_asg_launch

                remember_asg_launch(
                    "asg-1",
                    target,
                    launch,
                    ["snp:read", "snp:upload", "snp:save_result"],
                    None,
                )
                bind_session_to_current_asg_launch("sid-1", "asg-1")
                client.cookies.set("snp_auth", create_access_token("asg-1", "owner@example.com", "user"))
                response = client.post("/api/asg/save-result", json={"session_id": "sid-1", "selected_cycle": 2})

            posted_payloads.append(mock_post.call_args.args[0])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["analysis_run_id"], "run-1")
        self.assertEqual(posted_payloads[0]["launch"]["save_token"], "save-secret")

    def test_save_result_rejects_another_users_session(self):
        from fastapi.testclient import TestClient

        from app.auth import create_access_token
        from app.db import get_db
        from app.main import app
        from app.routers.upload import sessions

        with TestClient(app) as client:
            conn = get_db()
            conn.execute(
                "INSERT INTO users (id, username, hashed_password, display_name, role) VALUES (?, ?, ?, ?, ?)",
                ("asg-1", "owner@example.com", "!test", "Owner", "user"),
            )
            conn.execute(
                "INSERT INTO users (id, username, hashed_password, display_name, role) VALUES (?, ?, ?, ?, ?)",
                ("asg-2", "other@example.com", "!test", "Other", "user"),
            )
            conn.execute(
                """
                INSERT INTO sessions
                    (session_id, instrument, num_wells, num_cycles, allele2_dye, has_rox, raw_filename, user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ("other-session", "Test", 2, 2, "HEX", 1, "plate.xlsx", "asg-2"),
            )
            conn.commit()
            sessions["other-session"] = self._unified()
            client.cookies.set("snp_auth", create_access_token("asg-1", "owner@example.com", "user"))

            response = client.post("/api/asg/save-result", json={"session_id": "other-session"})

        self.assertEqual(response.status_code, 403)

    def _launch_payload(self):
        return {
            "user": {"id": "asg-1", "email": "owner@example.com", "display_name": "Owner"},
            "target": {
                "target_type": "design_run_item",
                "target_id": "101",
                "context": {"marker_id": "M101"},
            },
            "launch": {"id": "launch-1", "save_token": "save-secret"},
            "scope": ["snp:read", "snp:upload", "snp:save_result"],
            "expires_at": "2026-05-25T10:00:00+00:00",
        }

    def _unified(self):
        from app.models import UnifiedData, WellCycleData

        return UnifiedData(
            instrument="Test",
            allele2_dye="HEX",
            wells=["A1", "A2"],
            cycles=[1, 2],
            data=[
                WellCycleData(well="A1", cycle=1, fam=1.0, allele2=0.2, rox=1.0),
                WellCycleData(well="A1", cycle=2, fam=2.0, allele2=0.3, rox=1.0),
                WellCycleData(well="A2", cycle=1, fam=0.2, allele2=1.0, rox=1.0),
                WellCycleData(well="A2", cycle=2, fam=0.3, allele2=2.0, rox=1.0),
            ],
            has_rox=True,
            sample_names={"A1": "S1", "A2": "S2"},
        )


if __name__ == "__main__":
    unittest.main()
