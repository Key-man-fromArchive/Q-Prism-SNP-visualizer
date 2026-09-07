"""JWT migration contracts, signed independently of the runtime JWT library."""

import base64
import hashlib
import hmac
import json
import time
from importlib.metadata import PackageNotFoundError, version

import pytest

from app import auth


def signed_token(
    payload: dict[str, object], algorithm: str = "HS256", key: str | None = None
) -> str:
    def segment(value: dict[str, object]) -> bytes:
        return base64.urlsafe_b64encode(
            json.dumps(value, separators=(",", ":")).encode()
        ).rstrip(b"=")

    message = segment({"alg": algorithm, "typ": "JWT"}) + b"." + segment(payload)
    signature = hmac.new(
        (key or auth.JWT_SECRET_KEY).encode(), message, hashlib.sha256
    ).digest()
    return (message + b"." + base64.urlsafe_b64encode(signature).rstrip(b"=")).decode()


@pytest.fixture
def claims(monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    monkeypatch.setenv("SNP_AUTH_MODE", "local")
    return {
        "sub": "synthetic-user",
        "username": "synthetic",
        "role": "user",
        "exp": int(time.time()) + 600,
    }


def test_old_hs256_payload_and_new_token_roundtrip(claims: dict[str, object]) -> None:
    old = auth.decode_token(signed_token(claims))
    new = auth.decode_token(
        auth.create_access_token("synthetic-user", "synthetic", "user")
    )
    assert (
        old
        == new
        == auth.TokenData(user_id="synthetic-user", username="synthetic", role="user")
    )


def test_python_jose_350_golden_token(
    claims: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    # Generated with python-jose 3.5.0; synthetic fixture, not a live credential.
    monkeypatch.setattr(auth, "JWT_SECRET_KEY", "synthetic-migration-key-not-a-secret")
    token = (
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
        "eyJzdWIiOiJzeW50aGV0aWMtdXNlciIsInVzZXJuYW1lIjoic3ludGhldGljIiwicm9sZSI6InVzZXIiLCJleHAiOjQxMDI0NDQ4MDB9."
        "3E1XtXPPTBKsm3FrVfkb_WwcwSKSLxN8Yb8MJkukkdw"
    )
    assert auth.decode_token(token) == auth.TokenData(
        user_id="synthetic-user", username="synthetic", role="user"
    )


@pytest.mark.parametrize("algorithm", ["none", "HS384", "HS512", "RS256", "ES256"])
def test_algorithm_is_pinned(claims: dict[str, object], algorithm: str) -> None:
    assert auth.decode_token(signed_token(claims, algorithm)) is None


def test_wrong_signature_and_malformed(claims: dict[str, object]) -> None:
    assert auth.decode_token(signed_token(claims, key="another-synthetic-key")) is None
    assert auth.decode_token("not.a.token") is None


@pytest.mark.parametrize(
    "field,value",
    [
        ("exp", 1),
        ("exp", "invalid"),
        ("nbf", 9999999999),
        ("iat", "invalid"),
        ("sub", 1),
        ("sub", ""),
        ("username", ""),
        ("role", ""),
        ("username", ["invalid"]),
        ("role", {"invalid": True}),
        ("aud", "unconfigured-audience"),
        ("jti", 42),
    ],
)
def test_invalid_claims_are_rejected(
    claims: dict[str, object], field: str, value: object
) -> None:
    claims[field] = value
    assert auth.decode_token(signed_token(claims)) is None


def test_legacy_optional_claim_policy(claims: dict[str, object]) -> None:
    claims.pop("exp")  # Existing decoder did not require exp; issuers always add it.
    claims["iat"] = 9999999999  # python-jose checked integer shape, not future iat.
    assert auth.decode_token(signed_token(claims)) is not None


def test_asg_mode_rejects_local_and_accepts_matching_claim(
    claims: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SNP_AUTH_MODE", "asg_launch")
    assert auth.decode_token(signed_token(claims)) is None
    claims["auth_mode"] = "asg_launch"
    assert auth.decode_token(signed_token(claims)) is not None


def test_runtime_dependency_migration() -> None:
    assert version("PyJWT") == "2.13.0"
    assert version("python-multipart") == "0.0.32"
    for package in ("python-jose", "ecdsa"):
        with pytest.raises(PackageNotFoundError):
            version(package)
