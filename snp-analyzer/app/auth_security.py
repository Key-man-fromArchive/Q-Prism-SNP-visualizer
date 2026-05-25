"""Security controls for authentication flows."""
from __future__ import annotations

import os
import time
from dataclasses import dataclass

from fastapi import Request

from app.config import get_auth_mode


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


MAX_USER_FAILURES = _int_env("AUTH_MAX_USER_FAILURES", 5)
MAX_IP_FAILURES = _int_env("AUTH_MAX_IP_FAILURES", 30)
LOCK_SECONDS = _int_env("AUTH_LOCK_SECONDS", 15 * 60)
WINDOW_SECONDS = _int_env("AUTH_WINDOW_SECONDS", 15 * 60)
MIN_PASSWORD_LENGTH = _int_env("AUTH_MIN_PASSWORD_LENGTH", 12)
MAX_PASSWORD_LENGTH = _int_env("AUTH_MAX_PASSWORD_LENGTH", 128)

COMMON_WEAK_PASSWORDS = {
    "admin",
    "admin123",
    "changeme",
    "letmein",
    "password",
    "password1",
    "password123",
    "qwerty",
    "test1234",
    "welcome",
}

UNSAFE_JWT_SECRETS = {
    "dev-secret-change-in-production",
    "change-this-to-a-random-32-plus-character-secret",
}


@dataclass
class AuthLimitExceeded(Exception):
    retry_after: int


_user_failures: dict[str, list[float]] = {}
_ip_failures: dict[str, list[float]] = {}
_user_locks: dict[str, float] = {}
_ip_locks: dict[str, float] = {}


def reset_auth_attempts():
    """Clear in-memory throttling state. Intended for tests and admin restarts."""
    _user_failures.clear()
    _ip_failures.clear()
    _user_locks.clear()
    _ip_locks.clear()


def normalize_username(username: str) -> str:
    return username.strip().casefold()


def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def _prune(bucket: dict[str, list[float]], key: str, now: float) -> list[float]:
    attempts = [ts for ts in bucket.get(key, []) if now - ts <= WINDOW_SECONDS]
    bucket[key] = attempts
    return attempts


def _retry_after(*locks: float, now: float) -> int:
    remaining = [int(lock - now) for lock in locks if lock > now]
    return max(remaining) if remaining else 0


def assert_login_allowed(username: str, ip: str):
    now = time.time()
    user_key = normalize_username(username)
    retry_after = _retry_after(
        _user_locks.get(user_key, 0),
        _ip_locks.get(ip, 0),
        now=now,
    )
    if retry_after > 0:
        raise AuthLimitExceeded(retry_after=retry_after)

    _prune(_user_failures, user_key, now)
    _prune(_ip_failures, ip, now)


def record_login_failure(username: str, ip: str):
    now = time.time()
    user_key = normalize_username(username)

    user_attempts = _prune(_user_failures, user_key, now)
    user_attempts.append(now)
    if len(user_attempts) >= MAX_USER_FAILURES:
        _user_locks[user_key] = now + LOCK_SECONDS

    ip_attempts = _prune(_ip_failures, ip, now)
    ip_attempts.append(now)
    if len(ip_attempts) >= MAX_IP_FAILURES:
        _ip_locks[ip] = now + LOCK_SECONDS


def record_login_success(username: str, ip: str):
    user_key = normalize_username(username)
    _user_failures.pop(user_key, None)
    _user_locks.pop(user_key, None)


def validate_password_strength(password: str, username: str = ""):
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    if len(password) > MAX_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at most {MAX_PASSWORD_LENGTH} characters")

    lower = password.casefold()
    if lower in COMMON_WEAK_PASSWORDS:
        raise ValueError("Password is too common")

    normalized_user = normalize_username(username)
    local_part = normalized_user.split("@", 1)[0]
    if local_part and len(local_part) >= 4 and local_part in lower:
        raise ValueError("Password must not contain the username")


def assert_auth_configuration():
    get_auth_mode()

    jwt_secret = os.environ.get("JWT_SECRET_KEY", "")
    if not jwt_secret or jwt_secret in UNSAFE_JWT_SECRETS or len(jwt_secret) < 32:
        raise RuntimeError("JWT_SECRET_KEY must be set to a strong non-default value")

    admin_password = os.environ.get("ADMIN_PASSWORD")
    if admin_password:
        validate_password_strength(admin_password, username=os.environ.get("ADMIN_USER", "admin"))
