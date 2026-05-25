import json
import socket
import unittest
from io import BytesIO
from unittest.mock import patch
from urllib.error import HTTPError


class _Response:
    def __init__(self, payload: dict):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return self.payload


class ASGClientTest(unittest.TestCase):
    def setUp(self):
        from app import asg_client

        self.asg_client = asg_client

    def test_validate_launch_token_returns_parsed_user_and_context(self):
        payload = {
            "user": {
                "id": "42",
                "email": "asg-user@example.com",
                "display_name": "ASG User",
                "role": "admin",
            },
            "target": {
                "target_type": "marker_version",
                "target_id": "mv-1",
                "context": {"marker_id": "M1", "tag": "S1"},
            },
            "scope": ["snp:read"],
            "expires_at": "2026-05-25T10:00:00+00:00",
        }

        with patch.object(self.asg_client.config, "ASG_SNP_SERVICE_SECRET", "secret"):
            with patch.object(self.asg_client.config, "ASG_BASE_URL", "http://asg.local"):
                with patch.object(self.asg_client, "urlopen", return_value=_Response(payload)) as mock_urlopen:
                    result = self.asg_client.validate_launch_token("raw-token")

        self.assertEqual(result.user.id, "42")
        self.assertEqual(result.user.email, "asg-user@example.com")
        self.assertEqual(result.target.context["marker_id"], "M1")
        request = mock_urlopen.call_args.args[0]
        self.assertEqual(request.headers["X-asg-snp-service-secret"], "secret")

    def test_forbidden_response_maps_to_invalid_token(self):
        error = HTTPError(
            "http://asg.local/api/snp-analysis/launch/validate/",
            403,
            "Forbidden",
            hdrs=None,
            fp=BytesIO(b"{}"),
        )

        with patch.object(self.asg_client.config, "ASG_SNP_SERVICE_SECRET", "secret"):
            with patch.object(self.asg_client, "urlopen", side_effect=error):
                with self.assertRaises(self.asg_client.ASGLaunchValidationError) as ctx:
                    self.asg_client.validate_launch_token("bad-token")

        self.assertEqual(ctx.exception.status_code, 401)
        self.assertEqual(ctx.exception.code, "invalid_launch_token")

    def test_timeout_response_maps_to_gateway_timeout(self):
        with patch.object(self.asg_client.config, "ASG_SNP_SERVICE_SECRET", "secret"):
            with patch.object(self.asg_client, "urlopen", side_effect=socket.timeout()):
                with self.assertRaises(self.asg_client.ASGLaunchValidationError) as ctx:
                    self.asg_client.validate_launch_token("slow-token")

        self.assertEqual(ctx.exception.status_code, 504)
        self.assertEqual(ctx.exception.code, "asg_validation_timeout")


if __name__ == "__main__":
    unittest.main()
