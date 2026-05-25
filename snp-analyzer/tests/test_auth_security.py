import os
import unittest
from unittest.mock import patch


class AuthSecurityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["AUTH_MAX_USER_FAILURES"] = "3"
        os.environ["AUTH_MAX_IP_FAILURES"] = "50"
        os.environ["AUTH_LOCK_SECONDS"] = "60"

    def setUp(self):
        from app.auth_security import reset_auth_attempts

        reset_auth_attempts()

    def test_weak_password_is_rejected(self):
        from app.auth_security import validate_password_strength

        with self.assertRaises(ValueError) as ctx:
            validate_password_strength("pass", username="weak-user")

        self.assertIn("Password", str(ctx.exception))

    def test_repeated_login_failures_are_rate_limited(self):
        from app.auth_security import (
            AuthLimitExceeded,
            assert_login_allowed,
            record_login_failure,
        )

        username = "admin@example.com"
        ip = "192.0.2.10"

        for _ in range(3):
            assert_login_allowed(username, ip)
            record_login_failure(username, ip)

        with self.assertRaises(AuthLimitExceeded) as ctx:
            assert_login_allowed(username, ip)

        self.assertGreater(ctx.exception.retry_after, 0)

    def test_successful_login_resets_failed_attempt_counter(self):
        from app.auth_security import (
            assert_login_allowed,
            record_login_failure,
            record_login_success,
        )

        username = "admin@example.com"
        ip = "192.0.2.10"

        for _ in range(2):
            record_login_failure(username, ip)

        record_login_success(username, ip)

        for _ in range(2):
            assert_login_allowed(username, ip)
            record_login_failure(username, ip)

        assert_login_allowed(username, ip)

    def test_invalid_auth_mode_is_rejected(self):
        from app.config import get_auth_mode

        with patch.dict(os.environ, {"SNP_AUTH_MODE": "invalid"}, clear=False):
            with self.assertRaises(RuntimeError) as ctx:
                get_auth_mode()

        self.assertIn("SNP_AUTH_MODE", str(ctx.exception))

    def test_asg_launch_mode_rejects_default_jwt_secret(self):
        from app.auth_security import assert_auth_configuration

        defaults = [
            "dev-secret-change-in-production",
            "change-this-to-a-random-32-plus-character-secret",
        ]
        for secret in defaults:
            env = {
                "SNP_AUTH_MODE": "asg_launch",
                "JWT_SECRET_KEY": secret,
            }
            with self.subTest(secret=secret):
                with patch.dict(os.environ, env, clear=False):
                    with self.assertRaises(RuntimeError) as ctx:
                        assert_auth_configuration()

                self.assertIn("JWT_SECRET_KEY", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
