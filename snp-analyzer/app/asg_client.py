"""ASG Designer service client for one-time SNP launch token exchange."""
from __future__ import annotations

import json
import socket
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from app import config


class ASGLaunchValidationError(Exception):
    def __init__(self, message: str, *, status_code: int = 400, code: str = "asg_launch_invalid"):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


@dataclass(frozen=True)
class ASGLaunchUser:
    id: str
    email: str
    display_name: str | None = None
    role: str = "user"


@dataclass(frozen=True)
class ASGLaunchContext:
    target_type: str
    target_id: str
    context: dict[str, Any]


@dataclass(frozen=True)
class ASGLaunchSaveCredential:
    id: str
    save_token: str


@dataclass(frozen=True)
class ASGLaunchValidation:
    user: ASGLaunchUser
    target: ASGLaunchContext
    scope: list[str]
    launch: ASGLaunchSaveCredential | None = None
    expires_at: datetime | None = None


class ASGResultSaveError(Exception):
    def __init__(self, message: str, *, status_code: int = 502, code: str = "asg_result_save_failed"):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


def validate_launch_token(raw_token: str) -> ASGLaunchValidation:
    token = str(raw_token or "").strip()
    if not token:
        raise ASGLaunchValidationError("Launch token is required", status_code=400)
    if not config.ASG_SNP_SERVICE_SECRET:
        raise ASGLaunchValidationError(
            "ASG service secret is not configured",
            status_code=503,
            code="asg_secret_missing",
        )

    url = urljoin(f"{config.ASG_BASE_URL}/", "api/snp-analysis/launch/validate/")
    payload = json.dumps({"token": token}).encode("utf-8")
    request = Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-ASG-SNP-Service-Secret": config.ASG_SNP_SERVICE_SECRET,
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=config.ASG_CLIENT_TIMEOUT_SECONDS) as response:
            response_body = response.read()
    except HTTPError as exc:
        if exc.code in {400, 401, 403, 404, 410}:
            raise ASGLaunchValidationError(
                "Invalid ASG launch token",
                status_code=401,
                code="invalid_launch_token",
            ) from exc
        raise ASGLaunchValidationError(
            "ASG launch validation failed",
            status_code=502,
            code="asg_validation_failed",
        ) from exc
    except (TimeoutError, socket.timeout, URLError) as exc:
        raise ASGLaunchValidationError(
            "ASG launch validation timed out",
            status_code=504,
            code="asg_validation_timeout",
        ) from exc

    try:
        data = json.loads(response_body.decode("utf-8"))
        user_data = data["user"]
        target_data = data["target"]
        user = ASGLaunchUser(
            id=str(user_data["id"]),
            email=str(user_data["email"]),
            display_name=user_data.get("display_name") or user_data.get("email"),
            role=str(user_data.get("role") or "user"),
        )
        target = ASGLaunchContext(
            target_type=str(target_data["target_type"]),
            target_id=str(target_data["target_id"]),
            context=dict(target_data.get("context") or {}),
        )
        launch = None
        launch_data = data.get("launch")
        if isinstance(launch_data, dict):
            launch = ASGLaunchSaveCredential(
                id=str(launch_data["id"]),
                save_token=str(launch_data["save_token"]),
            )
        expires_at = _parse_datetime(data.get("expires_at"))
        return ASGLaunchValidation(
            user=user,
            target=target,
            launch=launch,
            scope=list(data.get("scope") or []),
            expires_at=expires_at,
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ASGLaunchValidationError(
            "Malformed ASG launch validation response",
            status_code=502,
            code="asg_response_invalid",
        ) from exc


def post_analysis_result(payload: dict[str, Any]) -> dict[str, Any]:
    if not config.ASG_SNP_SERVICE_SECRET:
        raise ASGResultSaveError(
            "ASG service secret is not configured",
            status_code=503,
            code="asg_secret_missing",
        )

    url = urljoin(f"{config.ASG_BASE_URL}/", "api/snp-analysis/runs/")
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-ASG-SNP-Service-Secret": config.ASG_SNP_SERVICE_SECRET,
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=config.ASG_CLIENT_TIMEOUT_SECONDS) as response:
            response_body = response.read()
    except HTTPError as exc:
        if exc.code in {400, 401, 403, 404, 410, 413}:
            detail = _read_error_detail(exc)
            raise ASGResultSaveError(
                detail or "ASG rejected the analysis result",
                status_code=exc.code,
                code="asg_result_rejected",
            ) from exc
        raise ASGResultSaveError("ASG result save failed") from exc
    except (TimeoutError, socket.timeout, URLError) as exc:
        raise ASGResultSaveError(
            "ASG result save timed out",
            status_code=504,
            code="asg_result_save_timeout",
        ) from exc

    try:
        data = json.loads(response_body.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("ASG response must be an object")
        return data
    except (ValueError, json.JSONDecodeError) as exc:
        raise ASGResultSaveError(
            "Malformed ASG result save response",
            status_code=502,
            code="asg_result_response_invalid",
        ) from exc


def _read_error_detail(exc: HTTPError) -> str:
    try:
        raw = exc.read()
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        return ""
    if isinstance(data, dict):
        detail = data.get("detail") or data.get("error")
        if isinstance(detail, str):
            return detail
    return ""


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value)
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    return datetime.fromisoformat(text)
