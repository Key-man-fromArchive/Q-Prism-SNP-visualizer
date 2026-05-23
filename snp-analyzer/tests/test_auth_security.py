import os
import unittest


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


if __name__ == "__main__":
    unittest.main()
